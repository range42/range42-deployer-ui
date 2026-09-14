import { sha256 } from '@noble/hashes/sha2.js'
import { parseDocument, stringify } from 'yaml'
import type { CatalogEntry } from '@/composables/useCatalog'
import type { GitSource } from '@/stores/inventoryStore'
import type { GitProviderV1 } from '@/services/git/types'
import { readFileContent } from '@/services/git/fileContent'
import { publicCatalogReference } from '@/services/catalogReference'
import { cloneFiles, fileBytes, fileText, validateFileMap, validateFilePath, type ProjectFiles } from '@/services/projectFiles'

type ObjectValue = Record<string, unknown>
type Scenario = ObjectValue & { label: string; vms: ObjectValue[]; content: ObjectValue[] }
type Provider = Pick<GitProviderV1, 'listTree' | 'getFile' | 'getFileContent'>
const exactSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const composeNames = ['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml']
// Ansible playbook_dir follows the imported playbook (verified by the opt-in consumer test).
// https://docs.ansible.com/projects/ansible/latest/reference_appendices/special_variables.html
// Compose paths follow the first -f file; -p overrides its project name.
// https://docs.docker.com/reference/cli/docker/compose/
const digest = (value: Uint8Array | string) => Array.from(sha256(typeof value === 'string' ? new TextEncoder().encode(value) : value), byte => byte.toString(16).padStart(2, '0')).join('')
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a mapping`)
  return value as ObjectValue
}
function yaml(value: string, label: string): ObjectValue {
  const doc = parseDocument(value)
  if (doc.errors.length) throw new Error(`Invalid YAML in ${label}; review the source before import`)
  return object(doc.toJS({ maxAliasCount: 50 }), label)
}
function keys(value: ObjectValue, allowed: string[], label: string): void {
  const unsupported = Object.keys(value).find(key => !allowed.includes(key))
  if (unsupported) throw new Error(`Unsupported ${label} field ${unsupported}; use a separately reviewed playbook for this workload`)
}
function literalPath(path: string): void {
  validateFilePath(path)
  if (!/^[A-Za-z0-9_.\-/]+$/.test(path)) throw new Error('Workload paths must be literal portable file paths without interpolation')
}
function secretFree(path: string, content: string): void {
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(content)
    || /^\s*["']?(?:password|passwd|token|api[_-]?key|secret|private[_-]?key)["']?\s*[:=]\s*\S/im.test(content)) {
    throw new Error(`Secret-bearing or credential configuration is unsupported: ${path}; remove it from the source before import`)
  }
}

/** Providers reject truncated trees and exhaust pagination; every blob read stays at this SHA. */
async function loadTree(owner: string, repo: string, root: string, sha: string, provider: Provider) {
  literalPath(root)
  const tree = await provider.listTree({ owner, repo, path: root, ref: sha })
  if (!tree.length || tree.length > 512) throw new Error('Choose a complete workload tree with 1–512 entries')
  const files: ProjectFiles = Object.create(null), modes: Record<string, string> = Object.create(null), seen = new Set<string>()
  for (const entry of tree) {
    if (!entry.path.startsWith(`${root}/`)) {
      if (entry.path === root && entry.type === 'tree') continue
      throw new Error('Repository returned a path outside the selected workload')
    }
    literalPath(entry.path)
    if (seen.has(entry.path)) throw new Error('Repository returned a duplicate workload path')
    seen.add(entry.path)
    if (entry.type === 'tree') continue
    if (!['100644', '100755'].includes(entry.mode || '')) throw new Error('Unsupported workload file mode; symlinks and submodules need a full repository workflow')
    if (!exactSha.test(entry.sha)) throw new Error('Workload tree is missing an exact file SHA')
    const file = await readFileContent(provider, { owner, repo, path: entry.path, ref: sha })
    if (file.sha !== entry.sha) throw new Error('Pinned workload file changed or resolved outside its reviewed tree')
    const relative = entry.path.slice(root.length + 1)
    // The initial adapter cannot inspect arbitrary binary configuration for credentials.
    if (typeof file.content !== 'string') throw new Error(`Binary workload file needs separate review: ${relative}`)
    secretFree(relative, file.content)
    files[relative] = file.content
    modes[relative] = entry.mode === '100755' ? '0755' : '0644'
    validateFileMap(files)
  }
  return { files, modes }
}
function imageReference(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(value) || value.includes('://')) throw new Error('Use a literal public image reference without interpolation or credentials')
  return value
}
function validateDockerfile(path: string, files: ProjectFiles): string[] {
  literalPath(path)
  if (!Object.hasOwn(files, path)) throw new Error(`Dockerfile dependency is missing with this exact case: ${path}`)
  if (Object.keys(files).some(name => name.endsWith('.dockerignore'))) throw new Error('Dockerfile ignore rules require separate build-dependency review')
  let stages = 0
  const images: string[] = []
  for (const line of fileText(files[path]).split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const [instruction, ...parts] = text.split(/\s+/), action = instruction.toUpperCase()
    if (text.endsWith('\\') || !['FROM', 'COPY', 'RUN', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'WORKDIR', 'USER', 'STOPSIGNAL', 'LABEL'].includes(action)) throw new Error('Unsupported Dockerfile instruction or multiline build dependency')
    if (action === 'FROM') {
      if (++stages !== 1 || parts.length !== 1) throw new Error('Only a single literal Dockerfile build stage is supported')
      images.push(imageReference(parts[0]))
    }
    if (action === 'COPY') {
      let paths: unknown = parts
      if (text.slice(4).trim().startsWith('[')) { try { paths = JSON.parse(text.slice(4)) } catch { throw new Error('Invalid Dockerfile COPY dependency') } }
      if (!Array.isArray(paths) || paths.length < 2 || paths.some(value => typeof value !== 'string')) throw new Error('Invalid Dockerfile COPY dependency')
      for (const source of paths.slice(0, -1) as string[]) {
        const local = source.replace(/^\.\//, '').replace(/\/$/, '')
        literalPath(local)
        if (!Object.hasOwn(files, local) && !Object.keys(files).some(name => name.startsWith(`${local}/`))) throw new Error(`Dockerfile COPY dependency is missing: ${local}`)
      }
    }
  }
  if (stages !== 1) throw new Error('Dockerfile must declare exactly one image build stage')
  return images
}
function composeContract(files: ProjectFiles, hostPorts?: unknown) {
  const choices = composeNames.filter(path => Object.hasOwn(files, path))
  if (choices.length !== 1) throw new Error('Select a workload containing exactly one root Compose file; PoC metadata alone cannot run')
  const entrypoint = choices[0], document = yaml(fileText(files[entrypoint]), entrypoint)
  keys(document, ['services', 'version'], 'Compose')
  const services = object(document.services, 'Compose services'), names = Object.keys(services)
  if (names.length !== 1) throw new Error('This adapter supports exactly one service; multi-service workloads need separate dependency review')
  const service = names[0]
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(service)) throw new Error('Use a literal Compose service name')
  const config = object(services[service], 'Compose service')
  keys(config, ['image', 'build', 'container_name', 'ports', 'restart'], 'Compose service')
  if (config.container_name !== undefined && (typeof config.container_name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(config.container_name))) throw new Error('Use a literal container name; the adapter assigns a project-scoped identity')
  if (config.restart !== undefined && !['no', 'always', 'on-failure', 'unless-stopped'].includes(String(config.restart))) throw new Error('Unsupported Compose restart policy')
  if ((config.image === undefined) === (config.build === undefined)) throw new Error('Choose one image or local build; combined image/build publishing needs separate review')
  let images: string[]
  if (config.image !== undefined) images = [imageReference(config.image)]
  else {
    const build = typeof config.build === 'string' ? { context: config.build } : object(config.build, 'Compose build')
    keys(build, ['context', 'dockerfile'], 'Compose build')
    if (build.context !== '.') throw new Error('Only the complete local workload build context "." is supported')
    if (build.dockerfile !== undefined && typeof build.dockerfile !== 'string') throw new Error('Dockerfile path must be literal')
    images = validateDockerfile(String(build.dockerfile || 'Dockerfile'), files)
  }
  if (config.ports !== undefined && !Array.isArray(config.ports)) throw new Error('Compose ports must be a literal list')
  const portMappings = (config.ports as unknown[] || []).map(value => {
    if (typeof value !== 'string' || !/^[0-9]+:[0-9]+(?:\/(?:tcp|udp))?$/.test(value)) throw new Error('Use literal host:container ports without interpolation, host addresses or ranges')
    const [host, target] = value.split(':'), [port, protocol = 'tcp'] = target.split('/')
    if (![host, port].every(number => Number(number) >= 1 && Number(number) <= 65535)) throw new Error('Compose ports must be between 1 and 65535')
    return { original_host_port: Number(host), host_port: Number(host), container_port: Number(port), protocol }
  })
  if (hostPorts !== undefined) {
    if (!Array.isArray(hostPorts) || hostPorts.length !== portMappings.length || hostPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Supply one integer host port (1–65535) for each original port mapping')
    portMappings.forEach((mapping, index) => { mapping.host_port = hostPorts[index] })
  }
  const ports = portMappings.map(mapping => `${mapping.host_port}/${mapping.protocol}`)
  if (new Set(ports).size !== ports.length) throw new Error('A workload cannot publish the same host port twice')
  return { entrypoint, service, ports, portMappings, document, config, images, build: config.build === undefined ? 'image' as const : 'local' as const }
}

function playbook(projectName: string, service: string, modes: Record<string, string>, marker: string): string {
  const root = `/opt/range42/workloads/${projectName}`, payload = `${root}/payload`, container = `${projectName}-service`
  const docker = ['docker', '--host', 'unix:///var/run/docker.sock']
  const compose = [...docker, 'compose', '--project-name', projectName, '--project-directory', payload,
    '--env-file', '/dev/null', '-f', `${root}/runtime.compose.yml`]
  const command = (name: string, argv: string[], extra: ObjectValue = {}) => ({ name, 'ansible.builtin.command': { argv }, changed_when: false, ...extra })
  const assertion = (name: string, conditions: string[], message: string, extra: ObjectValue = {}) => ({ name, 'ansible.builtin.assert': { that: conditions, fail_msg: message, quiet: true }, ...extra })
  const directories = new Set([root, payload])
  for (const path of Object.keys(modes)) {
    const parts = path.split('/'); parts.pop()
    while (parts.length) { directories.add(`${payload}/${parts.join('/')}`); parts.pop() }
  }
  const tasks: ObjectValue[] = [
    command('Require Docker Compose on the selected guest (install its prerequisite separately)', [...docker, 'compose', 'version']),
    command('Require the selected guest local Docker daemon', [...docker, 'info'], { no_log: true }),
    { name: 'Inspect workload destination', 'ansible.builtin.stat': { path: root, follow: false }, register: 'r42_workload_root' },
    assertion('Refuse a linked or foreign workload destination', ['not r42_workload_root.stat.exists or (r42_workload_root.stat.isdir | default(false) and not r42_workload_root.stat.islnk | default(false))'], 'Workload destination is not an owned directory'),
    { name: 'Read existing workload ownership', 'ansible.builtin.slurp': { src: `${root}/owner.txt` }, register: 'r42_workload_owner', when: 'r42_workload_root.stat.exists', no_log: true },
    assertion('Require the same workload owner before updating files', [`r42_workload_owner.content | b64decode == '${marker}'`], 'Existing workload belongs to another authored attachment', { when: 'r42_workload_root.stat.exists' }),
    command('Inspect matching container identity', [...docker, 'container', 'ls', '--all', '--filter', `name=^/${container}$`, '--quiet'], { register: 'r42_workload_containers' }),
    command('Read existing container ownership', [...docker, 'container', 'inspect', container], { register: 'r42_workload_inspect', when: 'r42_workload_containers.stdout | trim | length > 0', no_log: true }),
    assertion('Refuse a foreign container with the workload name', [`(r42_workload_inspect.stdout | from_json | length) == 1`, `(r42_workload_inspect.stdout | from_json)[0].Config.Labels['io.range42.workload'] | default('') == '${marker}'`], 'Container identity is already used by another workload', { when: 'r42_workload_containers.stdout | trim | length > 0' }),
    command('Inspect matching workload network', [...docker, 'network', 'ls', '--filter', `name=^${projectName}_default$`, '--quiet'], { register: 'r42_workload_networks' }),
    command('Read existing network ownership', [...docker, 'network', 'inspect', `${projectName}_default`], { register: 'r42_workload_network', when: 'r42_workload_networks.stdout | trim | length > 0', no_log: true }),
    assertion('Refuse a foreign workload network', [`(r42_workload_network.stdout | from_json | length) == 1`, `(r42_workload_network.stdout | from_json)[0].Labels['io.range42.workload'] | default('') == '${marker}'`], 'Docker network identity is already used by another workload', { when: 'r42_workload_networks.stdout | trim | length > 0' }),
    { name: 'Inspect workload directory paths', 'ansible.builtin.stat': { path: '{{ item }}', follow: false }, loop: [...directories].sort(), register: 'r42_workload_directories' },
    assertion('Refuse linked workload subdirectories', ['not item.stat.exists or (item.stat.isdir | default(false) and not item.stat.islnk | default(false))'], 'Workload directory contains a non-directory or symlink', { loop: '{{ r42_workload_directories.results }}' }),
    { name: 'Create private workload directories', 'ansible.builtin.file': { path: '{{ item }}', state: 'directory', mode: '0700' }, loop: [...directories].sort() },
    { name: 'Record workload ownership', 'ansible.builtin.copy': { content: marker, dest: `${root}/owner.txt`, mode: '0600' } },
    { name: 'Copy the complete pinned workload tree', 'ansible.builtin.copy': { src: '{{ playbook_dir }}/payload/{{ item.path }}', dest: `${payload}/{{ item.path }}`, mode: '{{ item.mode }}' }, loop: Object.entries(modes).map(([path, mode]) => ({ path, mode })) },
    { name: 'Copy the reviewed Compose configuration', 'ansible.builtin.copy': { src: '{{ playbook_dir }}/runtime.compose.yml', dest: `${root}/runtime.compose.yml`, mode: '0600' } },
    command('Validate copied Compose configuration before starting it', [...compose, 'config', '--quiet'], { no_log: true }),
    command('Start the selected guest workload', [...compose, 'up', '--detach', '--build', service], { changed_when: true, no_log: true }),
    command('Read started workload state', [...docker, 'container', 'inspect', container], { register: 'r42_workload_started', no_log: true }),
    assertion('Require the selected workload container to be running', [`(r42_workload_started.stdout | from_json | length) == 1`, `(r42_workload_started.stdout | from_json)[0].Config.Labels['io.range42.workload'] | default('') == '${marker}'`, '(r42_workload_started.stdout | from_json)[0].State.Running == true'], 'Compose returned but the selected workload container is not running'),
  ]
  return stringify([{ name: 'Catalog Compose workload on the selected guest', hosts: '{{ global_vm_ssh_name }}', gather_facts: false, become: true, tasks }], { lineWidth: 0 })
}

/** Stage an ordinary project-contained playbook; no provider, backend or guest writes. */
export async function prepareCatalogWorkload(input: { entry: CatalogEntry; source: GitSource; project: { id: string; files?: ProjectFiles; nodes?: Array<{ id: string; type?: string }> }; scenario: unknown; targetNode: string; attachmentId: string; hostPorts?: number[] }, provider: Provider) {
  const { entry, source, targetNode, attachmentId, project, hostPorts, scenario: requestedScenario } = structuredClone(input)
  const scenario = object(requestedScenario, 'Scenario') as Scenario
  const files = cloneFiles(project.files || {})
  if (entry.kind !== 'container' || source.id !== entry.source_id || source.repos.length !== 1) throw new Error('Choose one exact catalog container repository')
  if (!exactSha.test(entry.sha || '')) throw new Error('Refresh the catalog item to obtain its exact commit SHA')
  if (!project.id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(attachmentId)) throw new Error('A workload requires a project and literal unique attachment ID')
  if (!Array.isArray(scenario.vms) || scenario.vms.filter(vm => vm.node_id === targetNode).length !== 1
    || project.nodes?.filter(node => node.id === targetNode && node.type === 'vm').length !== 1) throw new Error('Select one existing VM from this scenario')
  if (typeof scenario.label !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(scenario.label) || !Array.isArray(scenario.content)) throw new Error('Save a concrete scenario before attaching a workload')
  if (scenario.content.some(item => item.id === attachmentId)) throw new Error('This content ID already exists')
  const prefix = `scenarios/${scenario.label}/content/workloads/${attachmentId}`
  if (Object.keys(files).some(path => path === prefix || path.startsWith(`${prefix}/`))) throw new Error('Workload files already exist; choose a new attachment ID')
  const repo = source.repos[0]
  const origin = publicCatalogReference({ version: 1, mode: 'use', kind: 'container', source_id: source.id, provider: source.provider, base_url: source.base_url,
    repo_owner: repo.owner, repo_name: repo.repo, branch: repo.branch, path: entry.path, sha: entry.sha, ...(source.backend_url ? { backend_url: source.backend_url } : {}) })!
  const loaded = await loadTree(repo.owner, repo.repo, entry.path, entry.sha!, provider)
  const contract = composeContract(loaded.files, hostPorts)
  for (const item of scenario.content) {
    if (item.target_node !== targetNode || item.kind !== 'playbook' || typeof item.path !== 'string' || !/^content\/workloads\/[^/]+\/deploy\.yml$/.test(item.path)) continue
    const reviewPath = `scenarios/${scenario.label}/${item.path.replace(/deploy\.yml$/, 'review.json')}`
    let review: ObjectValue
    try { review = object(JSON.parse(fileText(files[reviewPath])), 'Workload review') } catch { throw new Error('An existing workload review is missing or malformed; review it before adding another workload') }
    if (review.version !== 1 || !Array.isArray(review.published_ports)) throw new Error('An existing workload review cannot establish host-port ownership')
    const payloadPrefix = reviewPath.replace(/review\.json$/, 'payload/')
    const existingFiles = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(payloadPrefix)).map(([path, content]) => [path.slice(payloadPrefix.length), content]))
    const expectedHashes = object(review.file_hashes, 'Existing workload file hashes')
    if (Object.keys(existingFiles).length !== Object.keys(expectedHashes).length || Object.entries(existingFiles).some(([path, content]) => expectedHashes[path] !== digest(fileBytes(content)))) throw new Error('Existing workload files changed since review; review its current Config before appending another workload')
    const runtimePath = reviewPath.replace(/review\.json$/, 'runtime.compose.yml')
    if (!Object.hasOwn(files, runtimePath) || digest(fileBytes(files[runtimePath])) !== review.runtime_sha256) throw new Error('Existing workload execution config changed since review; review its current Config before appending another workload')
    const actualPorts = composeContract(existingFiles, review.host_ports).ports
    if (JSON.stringify(actualPorts) !== JSON.stringify(review.published_ports)) throw new Error('Existing workload port review changed; review its current Config before appending another workload')
    const collision = contract.ports.find(port => (review.published_ports as unknown[]).includes(port))
    if (collision) throw new Error(`Host port ${collision} is already assigned to another workload on this VM; choose different Host ports in the append dialog and review again`)
  }
  const marker = digest(`${project.id}\n${attachmentId}`), projectName = `r42-${marker.slice(0, 24)}`
  const addedFilePaths: string[] = []
  const add = (path: string, content: string) => { files[path] = content; addedFilePaths.push(path) }
  for (const [path, content] of Object.entries(loaded.files)) add(`${prefix}/payload/${path}`, fileText(content))
  const runtime = stringify({ ...contract.document, services: { [contract.service]: { ...contract.config,
    ports: contract.portMappings.map(port => `${port.host_port}:${port.container_port}/${port.protocol}`), container_name: `${projectName}-service`, labels: { 'io.range42.workload': marker } } }, networks: { default: { labels: { 'io.range42.workload': marker } } } })
  add(`${prefix}/runtime.compose.yml`, runtime)
  add(`${prefix}/review.json`, JSON.stringify({ version: 1, origin, compose_project: projectName, published_ports: contract.ports, host_ports: contract.portMappings.map(port => port.host_port), runtime_sha256: digest(runtime), file_hashes: Object.fromEntries(Object.entries(loaded.files).map(([path, content]) => [path, digest(fileBytes(content))])), file_modes: loaded.modes }, null, 2) + '\n')
  add(`${prefix}/deploy.yml`, playbook(projectName, contract.service, loaded.modes, marker))
  validateFileMap(files)
  scenario.content.push({ id: attachmentId, kind: 'playbook', target_node: targetNode, path: `content/workloads/${attachmentId}/deploy.yml`, vars: {} })
  return { files, scenario, summary: { addedContentIds: [attachmentId], addedFilePaths, source_sha: entry.sha!, service: contract.service,
    published_ports: contract.ports, original_ports: contract.portMappings.map(port => `${port.original_host_port}/${port.protocol}`), port_mappings: contract.portMappings, compose_project: projectName, images: contract.images, build: contract.build, destination: `/opt/range42/workloads/${projectName}`, container_name: `${projectName}-service`, selected_file: `${prefix}/deploy.yml`,
    prerequisites: ['Docker Engine and Docker Compose v2 must already work on the selected guest; the playbook checks both.'],
    limitations: ['Pinned Git files do not pin mutable registry image tags or prove package availability.', 'One service only; no environment secrets, host mounts, external dependencies or binary source files.', 'The workload must be trusted executable source. Running state is checked; application readiness and automatic Docker cleanup are not provided.', 'The reviewed published ports expose the workload on the guest; external port conflicts fail during Compose execution.'] } }
}
