import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildProjectFiles, buildPushArgs, useProjectGitSync } from '@/composables/useProjectGitSync'
import { loadGitProject, prepareGitProjectImport } from '@/services/gitProjectOpen'
import { savedScenario } from './fixtures/savedScenario'
import { publicCatalogImports } from '@/services/catalogReference'
import { useInventoryStore } from '@/stores/inventoryStore'

const modules = import.meta.glob('../services/catalogProjectAppend.ts', { eager: true })
const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
async function prepare(input, provider) {
  const fn = Object.values(modules)[0]?.prepareCatalogAppend
  expect(fn, 'Pure catalog append service is missing').toBeTypeOf('function')
  return fn(input, provider)
}
const sha = 'a'.repeat(40)
const source = { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'pat', ref_to_token_id: 'source-private' },
  repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
const binding = { source_id: 'destination', provider: 'github', base_url: 'https://github.com', repo_owner: 'me', repo_name: 'project',
  branch: 'main', working_branch: 'range42-ui/local', branch_strategy: 'shared_repo_subdir', subdir: 'projects/local' }
function project() {
  return { id: 'local', name: 'Existing', git: structuredClone(binding), backend_project_id: 'backend-existing', target_host_id: 'host-existing',
    files: { 'notes.md': 'keep exact bytes\r\n' }, overlay: { param_overrides: { env: { EXISTING: 3 } } },
    baseDoc: { env: [{ name: 'EXISTING', default: 2 }] },
    nodes: [{ id: 'existing', type: 'vm', position: { x: 200, y: 100 }, data: { label: 'web', config: { template: '9901' } } }],
    edges: [], attachments: [], scenario_generated_paths: [],
  }
}
function entry() {
  return { name: 'Web component', kind: 'component', source_id: 'catalog', path: 'components/web', sha,
    document: { schema_version: '1.0', kind: 'component', name: 'Web component', nodes: [
      { id: 'group', kind: 'group', replication: { scope: 'shared' }, children: [
        { id: 'net', kind: 'network', config: { cidr: '10.42.80.0/24', gateway: '10.42.80.1', vnet: 'webnet' } },
        { id: 'admin', kind: 'network', config: { cidr: '10.42.81.0/24' } },
        { id: 'vm', kind: 'vm', template_vmid: 9901, config: { name: 'web', cores: 4, memory_mb: 4096, disk_gb: 32 },
          networks: [{ node_ref: 'net', ip: '10.42.80.5' }, { node_ref: 'admin', dhcp: true }],
          attachments: [{ id: 'setup', source: { kind: 'inline_yaml', content_inline: '- debug: {msg: hello}\n' }, stage: 'configure' }] },
      ] },
    ], env: [{ name: 'PORT', default: 8080 }] } }
}
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); getProvider.mockReset() })

describe('immutable catalog append', () => {
  const rolePath = '02_ansible_layer/admin/roles/service.reload.ntp'
  const roleEntry = { source_id: 'catalog', name: 'NTP', kind: 'ansible_role', path: rolePath, sha }
  function roleProvider(content = '- name: Native task\n  ansible.builtin.debug: {msg: hello}\n') {
    return { listTree: vi.fn(async () => [{ path: `${rolePath}/tasks/main.yml`, mode: '100644', type: 'blob', sha: 'file-sha' }]),
      getFileContent: vi.fn(async () => ({ content, sha: 'file-sha' })), putFile: vi.fn(), createBranch: vi.fn() }
  }
  it('appends an exact pinned role to the chosen existing VM without changing unrelated settings or writing Git', async () => {
    const current = project(); current.scenario = { label: 'kept', zone: 'keptzone', network_mode: 'sdn', networks: [],
      vms: [{ node_id: 'existing', vm_name: 'web', template_vm_id: 9901 }], content: [] }
    const before = structuredClone(current); const provider = roleProvider()
    const result = await prepare({ entry: roleEntry, source, project: current, targetNode: 'existing' }, provider)
    expect(current).toEqual(before)
    expect(result.project.nodes).toEqual(current.nodes)
    expect(result.project.scenario).toMatchObject({ label: 'kept', zone: 'keptzone', vms: current.scenario.vms })
    expect(result.project.scenario.content[0]).toMatchObject({ kind: 'role', target_node: 'existing', path: rolePath, role: { origin: { sha } } })
    expect(result.selectedFile).toBe(`${rolePath}/tasks/main.yml`)
    expect(result.counts).toMatchObject({ nodes: 0, roles: 1, files: 1 })
    expect(provider.listTree).toHaveBeenCalledWith(expect.objectContaining({ ref: sha }))
    expect(provider.getFileContent).toHaveBeenCalledWith(expect.objectContaining({ ref: sha }))
    expect(provider.putFile).not.toHaveBeenCalled(); expect(provider.createBranch).not.toHaveBeenCalled()
    const second = await prepare({ entry: roleEntry, source, project: result.project, targetNode: 'existing' }, provider)
    expect(second.project.scenario.content).toHaveLength(2)
    expect(new Set(second.project.scenario.content.map(item => item.id)).size).toBe(2)
    expect(second.counts.files).toBe(0)
  })
  it('refuses role target omissions/non-VMs before reading files, and preserves conflicting files', async () => {
    const provider = roleProvider(); const current = project()
    await expect(prepare({ entry: roleEntry, source, project: current }, provider)).rejects.toThrow(/target.*VM|VM.*target/i)
    current.nodes[0].type = 'network-segment'
    await expect(prepare({ entry: roleEntry, source, project: current, targetNode: 'existing' }, provider)).rejects.toThrow(/target.*VM|VM.*target/i)
    expect(provider.listTree).not.toHaveBeenCalled()
    current.nodes[0].type = 'vm'; current.files[`${rolePath}/tasks/main.yml`] = 'keep operator edit'
    const before = structuredClone(current)
    await expect(prepare({ entry: roleEntry, source, project: current, targetNode: 'existing' }, provider)).rejects.toThrow(/already exists/i)
    expect(current).toEqual(before)
  })
  it('regenerates only verified owned scenario files for a role and reopens all structured settings', async () => {
    const current = savedScenario(); const before = structuredClone(current)
    const result = await prepare({ entry: roleEntry, source, project: current, targetNode: 'vm1' }, roleProvider())
    expect(current).toEqual(before)
    expect(result.project.scenario.content.map(item => item.kind)).toEqual(['file', 'role'])
    const files = buildProjectFiles(buildPushArgs(result.project, result.project.nodes, result.project.edges))
    const provider = { listCommits: vi.fn(async () => [{ sha }]), getFileContent: vi.fn(async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('Missing'), { status: 404 })
      return { content: files[path], sha: 'blob' }
    }) }
    getProvider.mockReturnValue(provider)
    const preview = await loadGitProject(current.git, [])
    expect(preview.authoring.status).toBe('structured')
    const reopened = prepareGitProjectImport(preview)
    expect(reopened.scenario).toEqual(result.project.scenario)
    expect(reopened.scenario_generated_paths).toEqual(result.project.scenario_generated_paths)
    expect(reopened.catalogImports).toEqual(result.project.catalogImports)
    expect(reopened.files['notes.txt']).toBe(current.files['notes.txt'])
  })
  it.each(['topology', 'edited-generated-role'])('keeps %s changes locally and blocks Git writes until Scenario review', async kind => {
    const current = savedScenario()
    if (kind === 'edited-generated-role') current.files[current.scenario_generated_paths[0]] += '# manual edit\n'
    const before = structuredClone(current)
    const item = entry(); item.document.env = [{ name: 'APPEND_PORT', default: 8080 }]
    const result = await prepare({ entry: kind === 'topology' ? item : roleEntry, source, project: current, targetNode: 'vm1' }, roleProvider())
    expect(current).toEqual(before)
    if (kind === 'edited-generated-role') expect(result.project.files[current.scenario_generated_paths[0]]).toBe(current.files[current.scenario_generated_paths[0]])
    const args = buildPushArgs(result.project, result.project.nodes, result.project.edges)
    getProvider.mockClear()
    expect(() => useProjectGitSync().pushToGit(args)).toThrow(/Review Scenario and generate files before saving catalog additions/)
    expect(getProvider).not.toHaveBeenCalled()
    expect(result.project.catalogImports).toHaveLength(1)
  })
  it('attaches a supported Compose workload to an existing VM and preserves structured Git ownership', async () => {
    const current = savedScenario(); const before = structuredClone(current)
    const item = { ...roleEntry, name: 'Public web image', kind: 'container', path: '03_container_layer/docker/web' }
    const provider = { listTree: vi.fn(async () => [{ path: `${item.path}/compose.yml`, mode: '100644', type: 'blob', sha: 'b'.repeat(40) }]),
      getFileContent: vi.fn(async () => ({ content: 'services:\n  web:\n    image: nginx:stable\n    ports: ["8080:80"]\n', sha: 'b'.repeat(40) })), putFile: vi.fn() }
    const result = await prepare({ entry: item, source, project: current, targetNode: 'vm1' }, provider)
    expect(current).toEqual(before)
    expect(result.project.nodes).toEqual(current.nodes)
    expect(result.counts.nodes).toBe(0)
    expect(result.review).toMatchObject({ service: 'web', build: 'image', source_sha: sha })
    expect(result.review.published_ports).toHaveLength(1)
    expect(result.warnings.join(' ')).toMatch(/Docker.*Compose/)
    expect(result.project.scenario.content.at(-1)).toMatchObject({ kind: 'playbook', target_node: 'vm1' })
    expect(result.selectedFile).toMatch(/content\/workloads\/catalog-1\/deploy.yml$/)
    expect(result.project.files[result.selectedFile]).toMatch(/ansible.builtin.command/)
    expect(result.provenance.content_ids).toEqual(['catalog-1'])
    const files = buildProjectFiles(buildPushArgs(result.project, result.project.nodes, result.project.edges))
    getProvider.mockReturnValue({ listCommits: vi.fn(async () => [{ sha }]), getFileContent: vi.fn(async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('Missing'), { status: 404 })
      return { content: files[path], sha: 'blob' }
    }) })
    const preview = await loadGitProject(current.git, [])
    expect(preview.authoring.status).toBe('structured')
    expect(prepareGitProjectImport(preview).scenario).toEqual(result.project.scenario)
    expect(provider.putFile).not.toHaveBeenCalled()
    await expect(prepare({ entry: item, source, project: result.project, targetNode: 'vm1' }, provider)).rejects.toThrow(/port|conflict/i)
    const second = await prepare({ entry: item, source, project: result.project, targetNode: 'vm1', hostPorts: [8081] }, provider)
    expect(second.review.published_ports).toEqual(['8081/tcp'])
    expect(second.review.port_mappings[0]).toMatchObject({ original_host_port: 8080, host_port: 8081, container_port: 80 })
    expect(second.project.scenario.content.map(item => item.id)).toEqual(['asset', 'catalog-1', 'catalog-2'])
    expect(() => buildProjectFiles(buildPushArgs(second.project, second.project.nodes, second.project.edges))).not.toThrow()
  })
  it('refuses a container append without an existing VM before provider reads', async () => {
    const provider = roleProvider()
    await expect(prepare({ entry: { ...roleEntry, kind: 'container' }, source, project: project() }, provider)).rejects.toThrow(/target.*VM|VM.*target/i)
    expect(provider.listTree).not.toHaveBeenCalled()
  })
  it('uses one captured project snapshot across asynchronous pinned source reads', async () => {
    const current = savedScenario(); const before = structuredClone(current)
    const provider = roleProvider(); let release
    provider.getFileContent.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const pending = prepare({ entry: roleEntry, source, project: current, targetNode: 'vm1' }, provider)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    current.scenario = { changed: 'while source is loading' }
    current.files = {}
    release({ content: '- ansible.builtin.debug: {msg: hello}\n', sha: 'file-sha' })
    const result = await pending
    expect(result.project.scenario.label).toBe(before.scenario.label)
    expect(result.project.files['notes.txt']).toBe(before.files['notes.txt'])
    expect(result.project.scenario.content.at(-1).kind).toBe('role')
    expect(current.scenario).toEqual({ changed: 'while source is loading' })
  })
  it('preserves the existing project, files and bindings while remapping an entire typed component', async () => {
    const original = project(); const before = structuredClone(original)
    const result = await prepare({ entry: entry(), source, project: original })
    expect(original).toEqual(before)
    expect(result.project.id).toBe(original.id)
    for (const key of ['git', 'backend_project_id', 'target_host_id', 'files', 'overlay']) expect(result.project[key]).toEqual(original[key])
    expect(result.project.nodes[0]).toEqual(original.nodes[0])
    expect(result.counts).toMatchObject({ nodes: 4, edges: 2, attachments: 1, roles: 0 })
    const added = result.project.nodes.slice(1)
    const vm = added.find(node => node.type === 'vm'); const group = added.find(node => node.type === 'group')
    expect(vm.data.config).toMatchObject({ template: '9901', cores: 4, memory_mb: 4096, disk_gb: 32 })
    expect(vm.data.config.name).not.toBe('web')
    expect(vm.parentNode).toBe(group.id)
    expect(result.project.edges.every(edge => edge.source === vm.id && added.some(node => node.id === edge.target))).toBe(true)
    expect(result.project.attachments[0].target_node).toBe(vm.id)
    expect(result.project.attachments[0].source.content_inline).toBe('- debug: {msg: hello}\n')
    expect(result.project.baseDoc.env).toEqual([...before.baseDoc.env, { name: 'PORT', default: 8080 }])
    expect(JSON.stringify(result.provenance)).not.toContain('source-private')
  })
  it('repeated imports get distinct graph, attachment and VM names without changing prior additions', async () => {
    const first = await prepare({ entry: entry(), source, project: project() })
    const before = structuredClone(first.project)
    const second = await prepare({ entry: entry(), source, project: first.project })
    expect(first.project).toEqual(before)
    for (const rows of [second.project.nodes, second.project.edges, second.project.attachments]) expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    const names = second.project.nodes.filter(node => node.type === 'vm').map(node => node.data.config.name || node.data.label)
    expect(new Set(names).size).toBe(names.length)
    expect(second.project.catalogImports).toHaveLength(2)
    expect(second.project.baseDoc.env.filter(row => row.name === 'PORT')).toHaveLength(1)
  })
  it('refuses conflicting variables before changing any project data', async () => {
    const current = project(); current.baseDoc.env.push({ name: 'PORT', default: 9000 })
    const before = structuredClone(current)
    await expect(prepare({ entry: entry(), source, project: current })).rejects.toThrow(/variable.*PORT|PORT.*conflict/i)
    expect(current).toEqual(before)
  })
  it('refuses a hidden existing variable override that would alter the imported behavior', async () => {
    const current = project(); current.baseDoc.env.push({ name: 'PORT', default: 8080 })
    current.overlay.param_overrides.env.PORT = 9000
    const before = structuredClone(current)
    await expect(prepare({ entry: entry(), source, project: current })).rejects.toThrow(/override.*PORT|PORT.*override/i)
    expect(current).toEqual(before)
  })
  it('keeps long generated VM names unique within the supported naming bound', async () => {
    const item = entry(); item.document.nodes[0].children[2].config.name = 'a'.repeat(32)
    const current = project(); current.nodes[0].data.config.name = 'a'.repeat(32)
    const first = await prepare({ entry: item, source, project: current })
    const second = await prepare({ entry: item, source, project: first.project })
    const names = second.project.nodes.filter(node => node.type === 'vm').map(node => node.data.config.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => name.length <= 32)).toBe(true)
  })
  it('keeps prior allocation and scenario review state while copying no source execution state', async () => {
    const current = project()
    current.scenario = { label: 'already-reviewed', vms: [], networks: [], content: [] }
    current.allocation = { token: 'private-existing-lease', revision: 2 }
    const before = structuredClone(current)
    const result = await prepare({ entry: entry(), source, project: current })
    expect(result.project.scenario).toEqual(before.scenario)
    expect(result.project.allocation).toEqual(before.allocation)
    expect(result.warnings.join(' ')).toMatch(/fresh.*allocation/i)
    expect(JSON.stringify(result.provenance)).not.toContain('private-existing-lease')
  })
  it('validates append metadata on reopening and retains only public provenance fields', async () => {
    const result = await prepare({ entry: entry(), source, project: project() })
    const row = result.provenance
    expect(publicCatalogImports([{ ...row, token: 'private', origin: { ...row.origin, token: 'private' } }])).toEqual([row])
    expect(() => publicCatalogImports([row, row])).toThrow(/identity/)
    expect(() => publicCatalogImports([{ ...row, origin: { ...row.origin, sha: 'main' } }])).toThrow(/SHA/)
    expect(() => publicCatalogImports([{ ...row, node_ids: ['duplicate', 'duplicate'] }])).toThrow(/node_ids/)
  })
  it.each(['vmid', 'vm_id', 'allocation', 'deployment_id', 'actualConfig'])('refuses imported execution identity %s without cloning it', async key => {
    const item = entry(); item.document.nodes[0].children[2].config[key] = 'live-identity'
    await expect(prepare({ entry: item, source, project: project() })).rejects.toThrow(/execution|identity|allocation/i)
  })
  it('refuses unresolved dependencies, foreign NIC refs and unsupported behavior', async () => {
    const foreign = entry(); foreign.document.nodes[0].children[2].networks[0].node_ref = 'existing'
    await expect(prepare({ entry: foreign, source, project: project() })).rejects.toThrow(/endpoint|reference|missing/i)
    const unresolved = entry(); unresolved.document.nodes[0].children[2].attachments[0].source = { kind: 'file_upload', content_ref: 'missing.sh' }
    await expect(prepare({ entry: unresolved, source, project: project() })).rejects.toThrow(/missing.sh/)
    const unsupported = entry(); unsupported.document.execution = { stages: ['special'] }
    await expect(prepare({ entry: unsupported, source, project: project() })).rejects.toThrow(/execution/)
  })
  it('pins a single source and refuses malformed or ambiguous source identity', async () => {
    await expect(prepare({ entry: { ...entry(), sha: 'main' }, source, project: project() })).rejects.toThrow(/exact.*SHA/i)
    await expect(prepare({ entry: entry(), source: { ...source, repos: [...source.repos, source.repos[0]] }, project: project() })).rejects.toThrow(/one repository/i)
    await expect(prepare({ entry: entry(), source: { ...source, base_url: 'https://user:private@example.org' }, project: project() })).rejects.toThrow(/credentials/i)
  })
  it('remaps a canonical container host reference instead of binding to an existing namesake', async () => {
    const item = entry(); item.document.nodes[0].children.push({ id: 'container', kind: 'docker', host_ref: 'vm', config: { image: 'nginx:stable' } })
    const result = await prepare({ entry: item, source, project: project() })
    const docker = result.project.nodes.find(node => node.type === 'docker')
    expect(docker.data.host_ref).toBe(result.project.nodes.slice(1).find(node => node.type === 'vm').id)
    expect(result.warnings.join(' ')).toMatch(/deployment|unsupported/i)
  })
  it('persists provenance for every addition through actual Git serialization and reopening without credentials', async () => {
    const result = await prepare({ entry: entry(), source, project: project() })
    const saved = buildProjectFiles(buildPushArgs(result.project, result.project.nodes, result.project.edges))
    expect(JSON.parse(saved['meta.json']).ui_catalog_imports).toEqual(result.project.catalogImports)
    expect(JSON.stringify(saved)).not.toContain('source-private')
    const provider = { listCommits: vi.fn(async () => [{ sha: 'c'.repeat(40) }]), getFileContent: vi.fn(async ({ path }) => {
      const relative = path.slice(`${binding.subdir}/`.length)
      if (!(relative in saved)) throw Object.assign(new Error('Missing'), { status: 404 })
      return { content: saved[relative], sha: 'blob' }
    }) }
    useInventoryStore().addSource({ id: 'destination', provider: 'github', base_url: 'https://github.com', repos: [], auth: { kind: 'none' } })
    getProvider.mockReturnValue(provider)
    const reopened = prepareGitProjectImport(await loadGitProject(binding, []))
    expect(reopened.catalogImports).toEqual(result.project.catalogImports)
    expect(reopened.nodes.map(node => node.id)).toEqual(result.project.nodes.map(node => node.id))
  })
})
