import { describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { captureProjectAuthoring } from '@/services/projectAuthoring'
import { savedScenario } from './fixtures/savedScenario'
import fixture from './fixtures/catalogComposeApache.json'

function setup() {
  const files = structuredClone(fixture.files) as Record<string, string>
  const tree = structuredClone(fixture.tree)
  const provider = { listTree: vi.fn(async () => tree), getFileContent: vi.fn(async ({ path }: { path: string }) => ({ content: files[path], sha: tree.find(row => row.path === path)!.sha })), getFile: vi.fn() }
  const project = savedScenario()
  const input = { project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'catalog-1',
    entry: { source_id: 'catalog', kind: 'container', name: 'Apache', path: fixture.path, sha: fixture.sha, document: JSON.parse(files[`${fixture.path}/meta.json`]) },
    source: { id: 'catalog', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'none' as const }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] } }
  const compose = () => parse(files[`${fixture.path}/compose.yml`])
  const setCompose = (value: unknown) => { files[`${fixture.path}/compose.yml`] = stringify(value) }
  return { files, tree, provider, input, compose, setCompose }
}

describe('catalog Compose workload attachment', () => {
  it('preserves the complete pinned actual Apache tree and appends a target-bound compiler-compatible playbook atomically', async () => {
    const f = setup(), before = structuredClone(f.input.project)
    const result = await prepareCatalogWorkload(f.input, f.provider)
    expect(f.input.project).toEqual(before)
    expect(result.scenario.content.slice(0, -1)).toEqual(before.scenario.content)
    const item = result.scenario.content.at(-1)!
    expect(item).toEqual({ id: 'catalog-1', kind: 'playbook', path: 'content/workloads/catalog-1/deploy.yml', target_node: 'vm1', vars: {} })
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    for (const [path, content] of Object.entries(f.files)) expect(result.files[`${prefix}/payload/${path.slice(fixture.path.length + 1)}`]).toBe(content)
    expect(result.summary).toMatchObject({ source_sha: fixture.sha, service: 'apache-cve-2021-42013', published_ports: ['8888/tcp'], addedContentIds: ['catalog-1'] })
    expect(result.summary.prerequisites.join(' ')).toMatch(/Docker.*Compose/)
    expect(result.summary.limitations.join(' ')).toMatch(/registry|image/i)
    expect(f.provider.listTree).toHaveBeenCalledWith({ owner: 'range42', repo: 'range42-catalog', path: fixture.path, ref: fixture.sha })
    expect(f.provider.getFileContent.mock.calls.every(([request]) => request.ref === fixture.sha)).toBe(true)
    const wrapper = parse(result.files[`${prefix}/deploy.yml`] as string)
    expect(wrapper[0]).toMatchObject({ hosts: '{{ global_vm_ssh_name }}', gather_facts: false, become: true })
    const emitted = emitConcreteScenario({ ...before, files: result.files, scenario: result.scenario, generatedPaths: before.scenario_generated_paths })
    expect(parse(emitted.files['scenarios/saved/configure.yml']).at(-1)).toMatchObject({ 'ansible.builtin.import_playbook': item.path, vars: { global_vm_ssh_name: 'saved-vm' } })
    expect(captureProjectAuthoring('project', { scenario: result.scenario }).scenario.content.at(-1)).toEqual(item)
    expect(Object.keys(result.files).filter(path => !Object.hasOwn(before.files, path))).toEqual(result.summary.addedFilePaths)
  })
  it('gives the Compose default network an ownership label and refuses a foreign network before copying', async () => {
    const f = setup(), result = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    expect(parse(result.files[`${prefix}/runtime.compose.yml`] as string).networks.default.labels['io.range42.workload']).toMatch(/^[a-f0-9]{64}$/)
    const tasks = parse(result.files[`${prefix}/deploy.yml`] as string)[0].tasks
    expect(tasks.findIndex(task => task.name === 'Refuse a foreign workload network')).toBeGreaterThan(0)
    expect(tasks.findIndex(task => task.name === 'Refuse a foreign workload network')).toBeLessThan(tasks.findIndex(task => task.name === 'Copy the complete pinned workload tree'))
  })
  it.each([
    ['environment', { ADMIN_PASSWORD: 'never-publish-this' }], ['volumes', ['/etc:/host']], ['privileged', true],
    ['network_mode', 'host'], ['depends_on', ['db']], ['env_file', '.env'], ['secrets', ['credential']],
  ])('refuses unsupported service %s without changing the project', async (key, value) => {
    const f = setup(), before = structuredClone(f.input.project), doc = f.compose()
    doc.services['apache-cve-2021-42013'][key] = value; f.setCompose(doc)
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/unsupported|secret/i)
    expect(f.input.project).toEqual(before)
  })
  it('refuses multiple services and PoC-only metadata instead of inventing a workload', async () => {
    const f = setup(), doc = f.compose(); doc.services.other = { image: 'httpd:2.4.49' }; f.setCompose(doc)
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/one service/)
    const poc = setup(); poc.input.entry.path += '/poc'; poc.input.entry.document = JSON.parse(poc.files[`${poc.input.entry.path}/meta.json`]); poc.tree.splice(0, poc.tree.length, ...poc.tree.filter(row => row.path.startsWith(`${poc.input.entry.path}/`)))
    await expect(prepareCatalogWorkload(poc.input, poc.provider)).rejects.toThrow(/Compose|compose/)
  })
  it.each(['../Dockerfile', 'dockerfile', 'https://example.test/Dockerfile'])('refuses unresolved Dockerfile %s', async path => {
    const f = setup(), doc = f.compose(); doc.services['apache-cve-2021-42013'].build.dockerfile = path; f.setCompose(doc)
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/Dockerfile|dependency|path/)
  })
  it.each(['COPY ../private /etc/private\n', 'ADD https://example.test/payload /app\n', 'COPY missing.conf /app\n', 'FROM alpine AS other\n', 'ARG TOKEN\n'])('refuses unsupported build dependency %s', async instruction => {
    const f = setup(); f.files[`${fixture.path}/Dockerfile`] += instruction
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/Dockerfile|dependency|secret|build|path/i)
  })
  it('refuses unpinned, truncated, changed, symlink and escaping trees before append', async () => {
    const f = setup(); f.input.entry.sha = 'main'
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/SHA|commit/)
    const truncated = setup(); truncated.provider.listTree.mockRejectedValue(new Error('Repository tree is truncated'))
    await expect(prepareCatalogWorkload(truncated.input, truncated.provider)).rejects.toThrow(/truncated/)
    const changed = setup(); changed.provider.getFileContent.mockResolvedValue({ content: 'changed', sha: 'f'.repeat(40) })
    await expect(prepareCatalogWorkload(changed.input, changed.provider)).rejects.toThrow(/pinned|changed/i)
    const link = setup(); link.tree[0].mode = '120000'
    await expect(prepareCatalogWorkload(link.input, link.provider)).rejects.toThrow(/mode|symlink/)
    const escape = setup(); escape.tree[0].path = 'outside/file'
    await expect(prepareCatalogWorkload(escape.input, escape.provider)).rejects.toThrow(/outside/)
  })
  it('allows two actual Apache workloads on one VM with explicit distinct host ports and preserves the original Compose bytes', async () => {
    const f = setup(), first = await prepareCatalogWorkload({ ...f.input, hostPorts: [18888] }, f.provider)
    expect(first.summary.port_mappings).toEqual([{ original_host_port: 8888, host_port: 18888, container_port: 80, protocol: 'tcp' }])
    expect(first.summary.original_ports).toEqual(['8888/tcp'])
    const second = await prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, files: first.files }, scenario: first.scenario, attachmentId: 'catalog-2', hostPorts: [28888] }, f.provider)
    expect(second.scenario.content.slice(-2).map(item => item.id)).toEqual(['catalog-1', 'catalog-2'])
    expect(second.summary.compose_project).not.toBe(first.summary.compose_project)
    for (const [id, port] of [['catalog-1', 18888], ['catalog-2', 28888]]) {
      const prefix = `scenarios/saved/content/workloads/${id}`
      expect(second.files[`${prefix}/payload/compose.yml`]).toBe(f.files[`${fixture.path}/compose.yml`])
      expect(parse(second.files[`${prefix}/runtime.compose.yml`] as string).services['apache-cve-2021-42013'].ports).toEqual([`${port}:80/tcp`])
    }
    await expect(prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, files: second.files }, scenario: second.scenario, attachmentId: 'catalog-3', hostPorts: [18888] }, f.provider)).rejects.toThrow(/18888/)
  })
  it.each([{ ports: [0] }, { ports: [65536] }, { ports: [1.5] }, { ports: [] }, { ports: [8888, 9999] }])('rejects mismatched or invalid explicit host ports $ports', async ({ ports: hostPorts }) => {
    const f = setup(), before = structuredClone(f.input.project)
    await expect(prepareCatalogWorkload({ ...f.input, hostPorts }, f.provider)).rejects.toThrow(/port/i)
    expect(f.input.project).toEqual(before)
  })
  it('captures project and port review inputs before asynchronous source reads', async () => {
    const f = setup(), expected = await prepareCatalogWorkload({ ...f.input, hostPorts: [18888] }, f.provider)
    let release!: (tree: typeof f.tree) => void
    f.provider.listTree.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const input = { ...f.input, hostPorts: [18888] }
    const pending = prepareCatalogWorkload(input, f.provider)
    input.project.id = 'changed-project'; input.hostPorts[0] = 28888
    release(f.tree)
    const actual = await pending
    expect(actual.summary.compose_project).toBe(expected.summary.compose_project)
    expect(actual.summary.published_ports).toEqual(['18888/tcp'])
  })
  it('copies a regular file named __proto__ without dropping it from the tree', async () => {
    const f = setup(), path = `${fixture.path}/__proto__`
    f.files[path] = 'ordinary source file\n'; f.tree.push({ path, type: 'blob', mode: '100644', sha: 'c'.repeat(40) })
    const result = await prepareCatalogWorkload(f.input, f.provider)
    expect(result.files['scenarios/saved/content/workloads/catalog-1/payload/__proto__']).toBe('ordinary source file\n')
  })
  it('refuses stale workload port evidence after copied source changes', async () => {
    const f = setup(); const result = await prepareCatalogWorkload(f.input, f.provider)
    result.files['scenarios/saved/content/workloads/catalog-1/payload/compose.yml'] += '# changed after review\n'
    await expect(prepareCatalogWorkload({ ...f.input, scenario: result.scenario, project: { ...f.input.project, files: result.files }, attachmentId: 'catalog-2' }, f.provider)).rejects.toThrow(/changed.*review|review.*changed/i)
  })
  it('rejects secret files, interpolation and credential URLs without echoing values', async () => {
    for (const [path, value] of [['.env', 'TOKEN=secret'], ['private.key', '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret'], ['config.txt', 'https://user:secret@example.test/path']]) {
      const f = setup(), full = `${fixture.path}/${path}`; f.files[full] = value; f.tree.push({ path: full, type: 'blob', mode: '100644', sha: 'd'.repeat(40) })
      await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/secret|credential/i)
    }
    const f = setup(), doc = f.compose(); doc.services['apache-cve-2021-42013'].ports = ['${PORT}:80']; f.setCompose(doc)
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/literal|interpolation/)
  })
  it('preserves executable regular-file modes and refuses file/target/port identity collisions', async () => {
    const f = setup(); f.tree.find(row => row.path.endsWith('/hello.sh'))!.mode = '100755'
    const result = await prepareCatalogWorkload(f.input, f.provider)
    expect(result.files['scenarios/saved/content/workloads/catalog-1/deploy.yml']).toContain('0755')
    await expect(prepareCatalogWorkload({ ...f.input, scenario: result.scenario, project: { ...f.input.project, files: result.files }, attachmentId: 'catalog-2' }, f.provider)).rejects.toThrow(/port.*8888|8888.*port/i)
    await expect(prepareCatalogWorkload({ ...f.input, targetNode: 'missing' }, f.provider)).rejects.toThrow(/existing VM/)
    await expect(prepareCatalogWorkload({ ...f.input, scenario: result.scenario, project: { ...f.input.project, files: result.files } }, f.provider)).rejects.toThrow(/already|collision/)
    const second = await prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, id: 'another-project' } }, f.provider)
    expect(second.summary.compose_project).not.toBe(result.summary.compose_project)
  })
})
