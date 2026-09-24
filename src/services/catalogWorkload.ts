import { sha256 } from '@noble/hashes/sha2.js'
import { parseDocument, stringify } from 'yaml'
import { composeContract } from './catalogCompose'
import type { CatalogEntry } from '@/composables/useCatalog'
import type { GitSource } from '@/stores/inventoryStore'
import type { GitProviderV1 } from '@/services/git/types'
import { readFileContent } from '@/services/git/fileContent'
import { publicCatalogReference } from '@/services/catalogReference'
import { cloneFiles, fileBytes, fileText, isBinaryFile, validateFileMap, validateFilePath, type FileContent, type ProjectFiles } from '@/services/projectFiles'

type ObjectValue = Record<string, unknown>
type Scenario = ObjectValue & { label: string; vms: ObjectValue[]; content: ObjectValue[] }
type Provider = Pick<GitProviderV1, 'listTree' | 'getFile' | 'getFileContent'>
const exactSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
// Ansible playbook_dir follows the imported playbook (verified by the opt-in consumer test).
// https://docs.ansible.com/projects/ansible/latest/reference_appendices/special_variables.html
// Compose paths follow the first -f file; -p overrides its project name.
// https://docs.docker.com/reference/cli/docker/compose/
const digest = (value: Uint8Array | string) => Array.from(sha256(typeof value === 'string' ? new TextEncoder().encode(value) : value), byte => byte.toString(16).padStart(2, '0')).join('')
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a mapping`)
  return value as ObjectValue
}
function literalPath(path: string): void {
  validateFilePath(path)
  if (!/^[A-Za-z0-9_.\-/]+$/.test(path)) throw new Error('Workload paths must be literal portable file paths without interpolation')
}
export function assertWorkloadFileSafe(path: string, value: FileContent): void {
  const bytes = fileBytes(value)
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path)) throw new Error(`Secret-bearing configuration is unsupported: ${path}`)
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    if (/(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|[^/]+\.(?:ya?ml|json|toml|ini|conf|cfg|env|pem|key))$/i.test(path)) throw new Error(`Workload configuration must be UTF-8 text: ${path}`)
    return
  }
  if (content.includes('\0')) {
    if (typeof value === 'string' || /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|[^/]+\.(?:ya?ml|json|toml|ini|conf|cfg|env|pem|key))$/i.test(path)) throw new Error(`Workload configuration must be UTF-8 text without NUL bytes: ${path}`)
    return
  }
  const literalSecret = content.split(/\r?\n/).some(line => /^\s*["']?(?:password|passwd|token|api[_-]?key|secret|private[_-]?key)["']?\s*[:=]\s*\S/i.test(line)
    && !/:\s*["']?\$\{[A-Za-z_][A-Za-z0-9_]*\}["']?\s*$/.test(line))
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(content)
    || literalSecret) {
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
    assertWorkloadFileSafe(relative, file.content)
    files[relative] = file.content
    modes[relative] = entry.mode === '100755' ? '0755' : '0644'
    validateFileMap(files)
  }
  return { files, modes }
}

function playbook(projectName: string, services: string[], volumes: string[], modes: Record<string, string>, marker: string, runtimeHash: string, secretBindings: Record<string, string>, cleanup = false): string {
  const root = `/opt/range42/workloads/${projectName}`, payload = `${root}/payload`
  const containers = services.map(service => services.length === 1 ? `${projectName}-service` : `${projectName}-${service}`)
  const docker = ['docker', '--host', 'unix:///var/run/docker.sock']
  const compose = [...docker, 'compose', '--project-name', projectName, '--project-directory', payload,
    '--env-file', '/dev/null', '-f', `${root}/runtime.compose.yml`]
  const environment = Object.fromEntries(Object.entries(secretBindings).map(([name, variable]) => [name, `{{ lookup('vars', '${variable}') }}`]))
  const command = (name: string, argv: string[], extra: ObjectValue = {}) => ({ name, 'ansible.builtin.command': { argv }, changed_when: false, ...extra,
    ...(Object.keys(environment).length && argv.includes('--project-name') ? { environment, no_log: true } : {}) })
  const assertion = (name: string, conditions: string[], message: string, extra: ObjectValue = {}) => ({ name, 'ansible.builtin.assert': { that: conditions, fail_msg: message, quiet: true }, ...extra })
  const directories = new Set([root, payload])
  for (const path of Object.keys(modes)) {
    const parts = path.split('/'); parts.pop()
    while (parts.length) { directories.add(`${payload}/${parts.join('/')}`); parts.pop() }
  }
  const tasks: ObjectValue[] = [
    ...Object.values(secretBindings).map(variable => assertion('Require declared workload secret from the backend vault', [`${variable} is defined`, `${variable} is string`, `${variable} | length > 0`], 'A declared workload secret is unavailable in the backend workspace vault', { no_log: true })),
    command('Require Docker Compose on the selected guest (install its prerequisite separately)', [...docker, 'compose', 'version']),
    command('Require the selected guest local Docker daemon', [...docker, 'info'], { no_log: true }),
    { name: 'Inspect workload destination', 'ansible.builtin.stat': { path: root, follow: false }, register: 'r42_workload_root' },
    assertion('Refuse a linked or foreign workload destination', ['not r42_workload_root.stat.exists or (r42_workload_root.stat.isdir | default(false) and not r42_workload_root.stat.islnk | default(false))'], 'Workload destination is not an owned directory'),
    { name: 'Read existing workload ownership', 'ansible.builtin.slurp': { src: `${root}/owner.txt` }, register: 'r42_workload_owner', when: 'r42_workload_root.stat.exists', no_log: true },
    assertion('Require the same workload owner before updating files', [`r42_workload_owner.content | b64decode == '${marker}'`], 'Existing workload belongs to another authored attachment', { when: 'r42_workload_root.stat.exists' }),
    ...containers.flatMap(container => [
      command('Inspect matching container identity', [...docker, 'container', 'ls', '--all', '--filter', `name=^/${container}$`, '--quiet'], { register: 'r42_workload_containers' }),
      command('Read existing container ownership', [...docker, 'container', 'inspect', container], { register: 'r42_workload_inspect', when: 'r42_workload_containers.stdout | trim | length > 0', no_log: true }),
      assertion('Refuse a foreign container with the workload name', [`(r42_workload_inspect.stdout | from_json | length) == 1`, `(r42_workload_inspect.stdout | from_json)[0].Config.Labels['io.range42.workload'] | default('') == '${marker}'`], 'Container identity is already used by another workload', { when: 'r42_workload_containers.stdout | trim | length > 0' }),
    ]),
    ...volumes.flatMap(volume => [
      command('Inspect matching workload volume', [...docker, 'volume', 'ls', '--filter', `name=^${projectName}_${volume}$`, '--quiet'], { register: 'r42_workload_volumes' }),
      command('Read existing volume ownership', [...docker, 'volume', 'inspect', `${projectName}_${volume}`], { register: 'r42_workload_volume', when: 'r42_workload_volumes.stdout | trim | length > 0', no_log: true }),
      assertion('Refuse a foreign workload volume', [`(r42_workload_volume.stdout | from_json | length) == 1`, `(r42_workload_volume.stdout | from_json)[0].Labels['io.range42.workload'] | default('') == '${marker}'`], 'Docker volume identity is already used by another workload', { when: 'r42_workload_volumes.stdout | trim | length > 0' }),
    ]),
    command('Inspect matching workload network', [...docker, 'network', 'ls', '--filter', `name=^${projectName}_default$`, '--quiet'], { register: 'r42_workload_networks' }),
    command('Read existing network ownership', [...docker, 'network', 'inspect', `${projectName}_default`], { register: 'r42_workload_network', when: 'r42_workload_networks.stdout | trim | length > 0', no_log: true }),
    assertion('Refuse a foreign workload network', [`(r42_workload_network.stdout | from_json | length) == 1`, `(r42_workload_network.stdout | from_json)[0].Labels['io.range42.workload'] | default('') == '${marker}'`], 'Docker network identity is already used by another workload', { when: 'r42_workload_networks.stdout | trim | length > 0' }),
  ]
  if (cleanup) {
    tasks.push(
      assertion('Require the deployed workload directory before cleanup', ['r42_workload_root.stat.exists'], 'This workload has no owned installed configuration to clean up'),
      { name: 'Verify installed cleanup configuration', 'ansible.builtin.stat': { path: `${root}/runtime.compose.yml`, follow: false, checksum_algorithm: 'sha256' }, register: 'r42_workload_runtime' },
      assertion('Refuse changed or linked cleanup configuration', [`r42_workload_runtime.stat.isreg | default(false)`, `not r42_workload_runtime.stat.islnk | default(false)`, `r42_workload_runtime.stat.checksum | default('') == '${runtimeHash}'`], 'Installed workload configuration changed; review it before cleanup'),
      command('Stop and remove owned workload containers and network; preserve volumes and images', [...compose, 'down', '--timeout', '30'], { changed_when: true, no_log: true }),
      ...containers.flatMap(container => [
        command('Read workload cleanup state', [...docker, 'container', 'ls', '--all', '--filter', `name=^/${container}$`, '--quiet'], { register: 'r42_workload_remaining' }),
        assertion('Require the owned container to be absent after cleanup', ['r42_workload_remaining.stdout | trim | length == 0'], 'Workload container is still present after cleanup'),
      ]),
    )
  } else tasks.push(
    { name: 'Inspect workload directory paths', 'ansible.builtin.stat': { path: '{{ item }}', follow: false }, loop: [...directories].sort(), register: 'r42_workload_directories' },
    assertion('Refuse linked workload subdirectories', ['not item.stat.exists or (item.stat.isdir | default(false) and not item.stat.islnk | default(false))'], 'Workload directory contains a non-directory or symlink', { loop: '{{ r42_workload_directories.results }}' }),
    { name: 'Create workload directories', 'ansible.builtin.file': { path: '{{ item.path }}', state: 'directory', mode: '{{ item.mode }}' }, loop: [...directories].sort().map(path => ({ path, mode: path === root ? '0700' : '0755' })) },
    { name: 'Record workload ownership', 'ansible.builtin.copy': { content: marker, dest: `${root}/owner.txt`, mode: '0600' } },
    { name: 'Inspect copied payload manifest', 'ansible.builtin.stat': { path: `${root}/payload-files.json`, follow: false }, register: 'r42_payload_manifest' },
    assertion('Refuse a linked payload manifest', ['not r42_payload_manifest.stat.exists or (r42_payload_manifest.stat.isreg | default(false) and not r42_payload_manifest.stat.islnk | default(false))'], 'The workload payload manifest is not a regular owned file'),
    { name: 'Read previously copied payload files', 'ansible.builtin.slurp': { src: `${root}/payload-files.json` }, register: 'r42_payload_previous', when: 'r42_payload_manifest.stat.exists' },
    { name: 'Load previously copied payload paths', 'ansible.builtin.set_fact': { r42_payload_paths: "{{ (r42_payload_previous.content | b64decode | from_json) if r42_payload_manifest.stat.exists else [] }}" } },
    assertion('Require a payload path list', ["r42_payload_paths | type_debug == 'list'"], 'The workload payload manifest must contain a path list'),
    assertion('Validate previously copied payload paths', ["item is string and item is match('^[A-Za-z0-9_.\\/-]+$') and not item.startswith('/') and '..' not in item.split('/') and '.' not in item.split('/') and '' not in item.split('/')"], 'The workload payload manifest contains an unsafe path', { loop: '{{ r42_payload_paths }}' }),
    { name: 'Find links in the owned payload', 'ansible.builtin.find': { paths: payload, recurse: true, follow: false, hidden: true, file_type: 'link' }, register: 'r42_payload_links' },
    assertion('Refuse links in the owned payload', ['r42_payload_links.matched == 0'], 'The owned workload payload contains symlinks; review it before updating'),
    { name: 'Inspect previously copied obsolete payload files', 'ansible.builtin.stat': { path: `${payload}/{{ item }}`, follow: false }, loop: `{{ r42_payload_paths | difference(${JSON.stringify(Object.keys(modes))}) }}`, register: 'r42_payload_obsolete' },
    assertion('Refuse non-file obsolete payload entries', ['not item.stat.exists or (item.stat.isreg | default(false) and not item.stat.islnk | default(false))'], 'A previously copied payload file is no longer a regular file', { loop: '{{ r42_payload_obsolete.results }}' }),
    { name: 'Remove previously copied obsolete payload files', 'ansible.builtin.file': { path: `${payload}/{{ item.item }}`, state: 'absent' }, loop: '{{ r42_payload_obsolete.results }}', when: 'item.stat.exists' },
    { name: 'Copy the complete pinned workload tree', 'ansible.builtin.copy': { src: '{{ playbook_dir }}/payload/{{ item.path }}', dest: `${payload}/{{ item.path }}`, mode: '{{ item.mode }}' }, loop: Object.entries(modes).map(([path, mode]) => ({ path, mode })) },
    { name: 'Record copied workload payload files', 'ansible.builtin.copy': { content: JSON.stringify(Object.keys(modes)), dest: `${root}/payload-files.json`, mode: '0600' } },
    { name: 'Copy the reviewed Compose configuration', 'ansible.builtin.copy': { src: '{{ playbook_dir }}/runtime.compose.yml', dest: `${root}/runtime.compose.yml`, mode: '0600' } },
    command('Validate copied Compose configuration before starting it', [...compose, 'config', '--quiet'], { no_log: true }),
    command('Start the selected guest workload', [...compose, 'up', '--detach', '--build', '--force-recreate', '--wait', '--wait-timeout', '120', ...services], { changed_when: true, no_log: true }),
    ...containers.flatMap(container => [
      command('Read started workload state', [...docker, 'container', 'inspect', container], { register: 'r42_workload_started', no_log: true }),
      assertion('Require the selected workload container to be running', [`(r42_workload_started.stdout | from_json | length) == 1`, `(r42_workload_started.stdout | from_json)[0].Config.Labels['io.range42.workload'] | default('') == '${marker}'`, '(r42_workload_started.stdout | from_json)[0].State.Running == true'], 'Compose returned but the selected workload container is not running'),
    ]),
  )
  return stringify([{ name: cleanup ? 'Clean up owned catalog Compose workload on the selected guest' : 'Catalog Compose workload on the selected guest', hosts: '{{ global_vm_ssh_name }}', gather_facts: false, become: true,
    ...(Object.keys(secretBindings).length ? { vars_files: ["{{ lookup('env', 'RANGE42_ACTIVE_CONFIG_DIR') }}/secrets/default_vault.yml"] } : {}), tasks }], { lineWidth: 0 })
}

function validatedSecretBindings(value: unknown, variables: unknown): Record<string, string> {
  const bindings = object(value === undefined ? {} : value, 'Workload secret bindings')
  const declared = Array.isArray(variables) ? variables : []
  for (const [name, variable] of Object.entries(bindings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof variable !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable)
      || /^(?:ansible_|proxmox_|r42_|global_|deployer_cli_|RANGE42_|DOCKER_|COMPOSE_|PATH$|HOME$|LD_|PYTHON)/i.test(name)
      || /^(?:ansible_|proxmox_|r42_|global_|deployer_cli_)/i.test(variable)
      || ['__proto__', 'constructor', 'prototype', 'hostvars', 'groups', 'inventory_hostname'].includes(variable)) throw new Error('Use literal non-reserved secret environment and vault variable names')
    const definition = declared.find(row => row && typeof row === 'object' && row.name === variable)
    if (!definition?.secret || (definition.default !== undefined && definition.default !== null && definition.default !== '')) throw new Error('Each workload secret must reference a declared secret project variable with no stored default value')
  }
  return bindings as Record<string, string>
}

/** Stage an ordinary project-contained playbook; no provider, backend or guest writes. */
type WorkloadInput = { entry: CatalogEntry; source: GitSource; project: { id: string; files?: ProjectFiles; nodes?: Array<{ id: string; type?: string }>; baseDoc?: { env?: unknown } }; scenario: unknown; targetNode: string; attachmentId: string; hostPorts?: number[]; secretBindings?: Record<string, string> }
type LoadedWorkload = { files: ProjectFiles; modes: Record<string, string> }
export async function prepareCatalogWorkload(input: WorkloadInput, provider: Provider) {
  return prepareWorkload(input, (owner, repo, root, sha) => loadTree(owner, repo, root, sha, provider))
}
async function prepareWorkload(input: WorkloadInput, load: (owner: string, repo: string, root: string, sha: string) => Promise<LoadedWorkload>, reviewing = false) {
  const { entry, source, targetNode, attachmentId, project, hostPorts, secretBindings: requestedBindings, scenario: requestedScenario } = structuredClone(input)
  const secretBindings = validatedSecretBindings(requestedBindings, project.baseDoc?.env)
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
  const loaded = await load(repo.owner, repo.repo, entry.path, entry.sha!)
  const contract = composeContract(loaded.files, hostPorts, secretBindings)
  for (const item of scenario.content) {
    if (item.target_node !== targetNode || item.kind !== 'playbook' || typeof item.path !== 'string' || !/^content\/workloads\/[^/]+\/(?:deploy|cleanup)\.yml$/.test(item.path)) continue
    const reviewPath = `scenarios/${scenario.label}/${item.path.replace(/(?:deploy|cleanup)\.yml$/, 'review.json')}`
    let review: ObjectValue
    try { review = object(JSON.parse(fileText(files[reviewPath])), 'Workload review') } catch { throw new Error('An existing workload review is missing or malformed; review it before adding another workload') }
    if (review.version !== 1 || !Array.isArray(review.published_ports)) throw new Error('An existing workload review cannot establish host-port ownership')
    const payloadPrefix = reviewPath.replace(/review\.json$/, 'payload/')
    const existingFiles = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(payloadPrefix)).map(([path, content]) => [path.slice(payloadPrefix.length), content]))
    const expectedHashes = object(review.file_hashes, 'Existing workload file hashes')
    if (!reviewing && (Object.keys(existingFiles).length !== Object.keys(expectedHashes).length || Object.entries(existingFiles).some(([path, content]) => expectedHashes[path] !== digest(fileBytes(content))))) throw new Error('Existing workload files changed since review; review its current Config before appending another workload')
    const runtimePath = reviewPath.replace(/review\.json$/, 'runtime.compose.yml')
    if (!Object.hasOwn(files, runtimePath) || digest(fileBytes(files[runtimePath])) !== review.runtime_sha256) throw new Error('Existing workload execution config changed since review; review its current Config before appending another workload')
    const bindings = validatedSecretBindings(review.secret_bindings, project.baseDoc?.env)
    if (reviewing) for (const [path, content] of Object.entries(existingFiles)) assertWorkloadFileSafe(path, content)
    const sourcePorts = composeContract(existingFiles, undefined, bindings).portMappings.map(port => port.original_host_port)
    const peerPorts = reviewing && Array.isArray(review.source_host_ports) && JSON.stringify(sourcePorts) !== JSON.stringify(review.source_host_ports) ? sourcePorts : review.host_ports
    const actualPorts = composeContract(existingFiles, peerPorts, bindings).ports
    if (!reviewing && JSON.stringify(actualPorts) !== JSON.stringify(review.published_ports)) throw new Error('Existing workload port review changed; review its current Config before appending another workload')
    const collision = contract.ports.find(port => actualPorts.includes(port))
    if (collision) throw new Error(`Host port ${collision} is already assigned to another workload on this VM; choose different Host ports in the append dialog and review again`)
  }
  const marker = digest(`${project.id}\n${attachmentId}`), projectName = `r42-${marker.slice(0, 24)}`
  const addedFilePaths: string[] = []
  const add = (path: string, content: FileContent) => { files[path] = content; addedFilePaths.push(path) }
  for (const [path, content] of Object.entries(loaded.files)) add(`${prefix}/payload/${path}`, content)
  const runtime = stringify({ ...contract.document, services: Object.fromEntries(contract.rows.map(row => [row.service, { ...row.config,
    ports: row.portMappings.map(port => `${port.host_port}:${port.container_port}/${port.protocol}`),
    container_name: contract.services.length === 1 ? `${projectName}-service` : `${projectName}-${row.service}`, labels: { 'io.range42.workload': marker },
  }])), networks: { default: { labels: { 'io.range42.workload': marker } } },
  ...(contract.volumes.length ? { volumes: Object.fromEntries(contract.volumes.map(name => [name, { labels: { 'io.range42.workload': marker } }])) } : {}) })
  add(`${prefix}/runtime.compose.yml`, runtime)
  const deploy = playbook(projectName, contract.services, contract.volumes, loaded.modes, marker, digest(runtime), secretBindings)
  const cleanup = playbook(projectName, contract.services, contract.volumes, loaded.modes, marker, digest(runtime), secretBindings, true)
  add(`${prefix}/review.json`, JSON.stringify({ version: 1, origin, compose_project: projectName, secret_bindings: secretBindings, published_ports: contract.ports, source_host_ports: contract.portMappings.map(port => port.original_host_port), host_ports: contract.portMappings.map(port => port.host_port), runtime_sha256: digest(runtime), file_hashes: Object.fromEntries(Object.entries(loaded.files).map(([path, content]) => [path, digest(fileBytes(content))])), file_modes: loaded.modes, wrapper_hashes: { 'deploy.yml': digest(deploy), 'cleanup.yml': digest(cleanup) } }, null, 2) + '\n')
  add(`${prefix}/deploy.yml`, deploy)
  add(`${prefix}/cleanup.yml`, cleanup)
  validateFileMap(files)
  scenario.content.push({ id: attachmentId, kind: 'playbook', target_node: targetNode, path: `content/workloads/${attachmentId}/deploy.yml`, vars: {} })
  const assets = Object.entries(loaded.files).filter(([, content]) => isBinaryFile(content)).map(([path, content]) => ({ path, size: fileBytes(content).length, ...(isBinaryFile(content) && content.media_type ? { media_type: content.media_type } : {}) }))
  return { files, scenario, summary: { assets, addedContentIds: [attachmentId], addedFilePaths, source_sha: entry.sha!, service: contract.service, services: contract.services, required_secrets: [...new Set(Object.values(secretBindings))], readiness: contract.readiness, cleanup_file: `${prefix}/cleanup.yml`,
    published_ports: contract.ports, original_ports: contract.portMappings.map(port => `${port.original_host_port}/${port.protocol}`), port_mappings: contract.portMappings, compose_project: projectName, images: contract.images, build: contract.build, destination: `/opt/range42/workloads/${projectName}`, container_names: contract.services.map(service => contract.services.length === 1 ? `${projectName}-service` : `${projectName}-${service}`), ...(contract.services.length === 1 ? { container_name: `${projectName}-service` } : {}), selected_file: `${prefix}/deploy.yml`,
    prerequisites: ['Docker Engine and Docker Compose v2 or later with --wait and --wait-timeout support must already work on the selected guest; the playbook checks both.'],
    limitations: ['Pinned Git files do not pin mutable registry image tags or prove package availability.', 'Up to 32 services; literal public environment values, owned named volumes and pinned read-only relative mounts. Secrets use explicit bindings to declared backend vault variables; literal secret values, arbitrary host mounts, external dependencies are not imported. Binary assets are copied byte-for-byte; they are not inspected as configuration.', contract.readiness, 'The workload must be trusted executable source. Cleanup is an explicit reviewed playbook and preserves named volumes, images and copied files.', 'The reviewed published ports expose the workload on the guest; external port conflicts fail during Compose execution.'] } }
}

/** Explicitly review an edited project payload; source provenance and runtime ownership remain stable. */
export async function reviewCatalogWorkload(input: Pick<WorkloadInput, 'project' | 'scenario' | 'attachmentId' | 'hostPorts' | 'secretBindings'>) {
  const { project, attachmentId, hostPorts, secretBindings, scenario: requestedScenario } = structuredClone(input)
  const scenario = object(requestedScenario, 'Scenario') as Scenario
  if (!Array.isArray(scenario.content) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(attachmentId)) throw new Error('Select one existing workload attachment')
  const selected = scenario.content.filter(item => item.id === attachmentId)
  const item = selected[0]
  if (selected.length !== 1 || item.kind !== 'playbook' || typeof item.target_node !== 'string'
    || ![`content/workloads/${attachmentId}/deploy.yml`, `content/workloads/${attachmentId}/cleanup.yml`].includes(String(item.path))) throw new Error('Select one existing workload attachment')
  const prefix = `scenarios/${scenario.label}/content/workloads/${attachmentId}`
  const files = cloneFiles(project.files || {})
  let review: ObjectValue
  try { review = object(JSON.parse(fileText(files[`${prefix}/review.json`])), 'Workload review') } catch { throw new Error('The existing workload review is missing or malformed') }
  const origin = publicCatalogReference(review.origin)
  if (review.version !== 1 || origin?.version !== 1 || origin.kind !== 'container'
    || !['github', 'gitlab', 'gitea'].includes(String(origin.provider)) || !origin.repo_owner || !origin.repo_name || !origin.base_url || !origin.branch) throw new Error('The existing workload review requires complete pinned source provenance')
  if (review.compose_project !== `r42-${digest(`${project.id}\n${attachmentId}`).slice(0, 24)}`) throw new Error('Workload ownership identity does not match this project and attachment')
  const oldModes = object(review.file_modes, 'Workload file modes'), payload: ProjectFiles = Object.create(null), modes: Record<string, string> = Object.create(null)
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${prefix}/`)) continue
    const relative = path.slice(prefix.length + 1)
    if (relative.startsWith('payload/')) {
      const local = relative.slice(8)
      literalPath(local)
      assertWorkloadFileSafe(local, files[path])
      payload[local] = files[path]
      const mode = Object.hasOwn(oldModes, local) ? oldModes[local] : '0644'
      if (!['0644', '0755'].includes(String(mode))) throw new Error('Unsupported workload file mode in existing review')
      modes[local] = String(mode)
    } else if (!['review.json', 'runtime.compose.yml', 'deploy.yml', 'cleanup.yml'].includes(relative)) throw new Error('The workload directory contains an unrecognized file; move it into payload before reviewing')
    delete files[path]
  }
  if (Object.keys(payload).some(path => Object.keys(oldModes).some(previous => path.startsWith(`${previous}/`) || previous.startsWith(`${path}/`)))) throw new Error('Changing a payload path between a file and a directory requires a new path or a separate attachment')
  const binding = validatedSecretBindings(secretBindings ?? review.secret_bindings, project.baseDoc?.env)
  const sourceContract = composeContract(payload, undefined, binding)
  const sourcePorts = sourceContract.portMappings.map(port => port.original_host_port)
  const reviewedPorts = hostPorts ?? (Array.isArray(review.source_host_ports) && JSON.stringify(sourcePorts) !== JSON.stringify(review.source_host_ports) ? sourcePorts : review.host_ports as number[])
  const contract = composeContract(payload, reviewedPorts, binding)
  const previousRuntime = parseDocument(fileText(project.files![`${prefix}/runtime.compose.yml`]))
  if (previousRuntime.errors.length) throw new Error('Existing runtime configuration is malformed; restore the last reviewed configuration')
  const runtime = object(previousRuntime.toJS({ maxAliasCount: 50 }), 'Existing workload execution config')
  if (digest(fileBytes(project.files![`${prefix}/runtime.compose.yml`])) !== review.runtime_sha256) throw new Error('Existing execution config changed; edit payload/compose.yml and restore the reviewed runtime before reviewing')
  const sameNames = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  if (!sameNames(Object.keys(object(runtime.services, 'Existing services')), contract.services)
    || !sameNames(Object.keys(object(runtime.volumes ?? {}, 'Existing volumes')), contract.volumes)) throw new Error('Changing the workload service or volume identities requires cleanup and a separate attachment')
  const result = await prepareWorkload({ project: { ...project, files }, scenario: { ...scenario, content: scenario.content.filter(row => row.id !== attachmentId) },
    targetNode: item.target_node, attachmentId, hostPorts: reviewedPorts, secretBindings: binding,
    source: { id: String(origin.source_id), provider: origin.provider as GitSource['provider'], base_url: String(origin.base_url), auth: { kind: 'none' },
      repos: [{ owner: String(origin.repo_owner), repo: String(origin.repo_name), branch: String(origin.branch) }], ...(origin.backend_url ? { backend_url: String(origin.backend_url) } : {}) },
    entry: { source_id: String(origin.source_id), kind: 'container', name: attachmentId, path: String(origin.path), sha: String(origin.sha) },
  }, async () => ({ files: payload, modes }), true)
  result.scenario.content = scenario.content
  const revised = JSON.parse(fileText(result.files[`${prefix}/review.json`]))
  result.files[`${prefix}/review.json`] = JSON.stringify({ ...revised, origin, customized: true }, null, 2) + '\n'
  validateFileMap(result.files)
  return result
}

/** Check a saved workload's identity without discarding payload edits awaiting review. */
export function validateCatalogWorkloadOwnership({ files, scenarioLabel, attachmentId, projectId }: { files: ProjectFiles; scenarioLabel: string; attachmentId: string; projectId: string }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(scenarioLabel) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(attachmentId)) throw new Error('Invalid workload review identity')
  const prefix = `scenarios/${scenarioLabel}/content/workloads/${attachmentId}`
  let review: ObjectValue
  try { review = object(JSON.parse(fileText(files[`${prefix}/review.json`])), 'Workload review') } catch { throw new Error('Workload review is missing or malformed; import a complete project export') }
  const origin = publicCatalogReference(review.origin)
  if (review.version !== 1 || origin?.version !== 1 || origin.kind !== 'container' || !exactSha.test(String(origin.sha))
    || !Array.isArray(review.published_ports) || !/^[a-f0-9]{64}$/.test(String(review.runtime_sha256))) throw new Error('Workload review is incomplete; import a complete project export')
  object(review.file_hashes, 'Workload review file hashes')
  object(review.file_modes, 'Workload review file modes')
  if (review.compose_project !== `r42-${digest(`${projectId}\n${attachmentId}`).slice(0, 24)}`) throw new Error('Workload ownership does not match the original project ID; import an unchanged project export')
}

/** Detect edits since explicit workload review before compiling or staging its lifecycle action. */
export function validateCatalogWorkloadReview({ files, scenarioLabel, attachmentId, projectId }: { files: ProjectFiles; scenarioLabel: string; attachmentId: string; projectId?: string }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(scenarioLabel) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(attachmentId)) throw new Error('Invalid workload review identity')
  const prefix = `scenarios/${scenarioLabel}/content/workloads/${attachmentId}`
  let review: ObjectValue
  try { review = object(JSON.parse(fileText(files[`${prefix}/review.json`])), 'Workload review') } catch { throw new Error('Workload review is missing or malformed; review its current Config') }
  if (review.version !== 1 || !Array.isArray(review.published_ports)) throw new Error('Workload review is missing its version or published ports')
  if (projectId !== undefined && review.compose_project !== `r42-${digest(`${projectId}\n${attachmentId}`).slice(0, 24)}`) throw new Error('Workload ownership does not match this project')
  const payloadPrefix = `${prefix}/payload/`, payload = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(payloadPrefix)).map(([path, content]) => [path.slice(payloadPrefix.length), content]))
  const hashes = object(review.file_hashes, 'Workload review file hashes'), modes = object(review.file_modes, 'Workload review file modes')
  if (Object.keys(payload).length !== Object.keys(hashes).length || Object.keys(payload).length !== Object.keys(modes).length
    || Object.entries(payload).some(([path, content]) => hashes[path] !== digest(fileBytes(content)) || !['0644', '0755'].includes(String(modes[path])))) throw new Error('Workload payload changed since review; review its current Config')
  if (!Object.hasOwn(files, `${prefix}/runtime.compose.yml`) || digest(fileBytes(files[`${prefix}/runtime.compose.yml`])) !== review.runtime_sha256) throw new Error('Workload execution configuration changed since review; review its current Config')
  // Earlier v1 imports predate wrapper hashes; their payload and runtime reviews still apply.
  if (review.wrapper_hashes !== undefined) {
    const wrappers = object(review.wrapper_hashes, 'Workload wrapper review')
    for (const name of ['deploy.yml', 'cleanup.yml']) if (!Object.hasOwn(files, `${prefix}/${name}`) || digest(fileBytes(files[`${prefix}/${name}`])) !== wrappers[name]) throw new Error('Workload playbook changed since review; review its current Config')
  }
  const bindings = object(review.secret_bindings ?? {}, 'Workload reviewed secret bindings') as Record<string, string>
  const contract = composeContract(payload, review.host_ports, bindings)
  if (JSON.stringify(contract.ports) !== JSON.stringify(review.published_ports)) throw new Error('Workload port configuration changed since review')
  return review
}
