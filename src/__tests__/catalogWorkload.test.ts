import { describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { assetFromBytes, fileBytes, type ProjectFiles } from '@/services/projectFiles'
import { sha256 } from '@noble/hashes/sha2.js'
import { prepareCatalogWorkload, reviewCatalogWorkload, validateCatalogWorkloadReview } from '@/services/catalogWorkload'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { captureProjectAuthoring } from '@/services/projectAuthoring'
import { savedScenario } from './fixtures/savedScenario'
import fixture from './fixtures/catalogComposeApache.json'

function setup() {
  const files = structuredClone(fixture.files) as ProjectFiles
  const tree = structuredClone(fixture.tree)
  const provider = { listTree: vi.fn(async () => tree), getFileContent: vi.fn(async ({ path }: { path: string }) => ({ content: files[path], sha: tree.find(row => row.path === path)!.sha })), getFile: vi.fn() }
  const project = savedScenario()
  const input = { project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'catalog-1',
    entry: { source_id: 'catalog', kind: 'container', name: 'Apache', path: fixture.path, sha: fixture.sha, document: JSON.parse(files[`${fixture.path}/meta.json`] as string) },
    source: { id: 'catalog', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'none' as const }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] } }
  const compose = () => parse(files[`${fixture.path}/compose.yml`] as string)
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
  it('preserves pinned binary assets for both local builds and read-only mounts with byte hashes', async () => {
    const f = setup(), path = `${fixture.path}/site/logo.png`
    const asset = assetFromBytes(new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]), 'image/png')
    f.files[path] = asset
    f.tree.push({ path, type: 'blob', mode: '100644', sha: 'c'.repeat(40) })
    f.files[`${fixture.path}/Dockerfile`] = 'FROM nginx:alpine\nCOPY site /usr/share/nginx/html\n'
    f.setCompose({ services: { web: { build: '.', volumes: ['./site:/srv:ro'] } } })
    const result = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    expect(result.files[`${prefix}/payload/site/logo.png`]).toEqual(asset)
    const review = JSON.parse(result.files[`${prefix}/review.json`] as string)
    expect(review.file_hashes['site/logo.png']).toBe(Array.from(sha256(fileBytes(asset)), b => b.toString(16).padStart(2, '0')).join(''))
    expect(result.summary.assets).toEqual([{ path: 'site/logo.png', size: 8, media_type: 'image/png' }])
    const changed = { ...result.files, [`${prefix}/payload/site/logo.png`]: assetFromBytes(new Uint8Array([0, 255, 4])) }
    await expect(prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, files: changed }, scenario: result.scenario, attachmentId: 'second' }, f.provider)).rejects.toThrow(/changed.*review/)
    expect(f.input.project.files).not.toHaveProperty(`${prefix}/payload/site/logo.png`)
  })
  it('re-reviews edited assets and images while preserving workload ownership and source provenance', async () => {
    const f = setup()
    f.setCompose({ services: { web: { image: 'nginx:1.26', ports: ['8080:80'] } } })
    const first = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    const files = { ...first.files, [`${prefix}/payload/site/logo.png`]: assetFromBytes(new Uint8Array([0, 255, 7])) }
    files[`${prefix}/payload/compose.yml`] = stringify({ services: { web: { image: 'nginx:1.27', ports: ['8080:80'], volumes: ['./site:/srv:ro'] } } })
    const project = { ...f.input.project, files }, before = structuredClone(project)
    const result = await reviewCatalogWorkload({ project, scenario: first.scenario, attachmentId: 'catalog-1' })
    expect(project).toEqual(before)
    expect(result.summary.compose_project).toBe(first.summary.compose_project)
    expect(result.summary.images).toEqual(['nginx:1.27'])
    expect(result.scenario.content).toEqual(first.scenario.content)
    const review = JSON.parse(result.files[`${prefix}/review.json`] as string), previous = JSON.parse(first.files[`${prefix}/review.json`] as string)
    expect(review.origin).toEqual(previous.origin)
    expect(review.customized).toBe(true)
    expect(review.file_hashes['site/logo.png']).toHaveLength(64)
    expect(review.file_modes['site/logo.png']).toBe('0644')
    expect(parse(result.files[`${prefix}/deploy.yml`] as string)[0].tasks.find(task => task.name === 'Copy the complete pinned workload tree').loop).toContainEqual({ path: 'site/logo.png', mode: '0644' })
    await expect(prepareCatalogWorkload({ ...f.input, project: { ...project, files: result.files }, scenario: result.scenario, attachmentId: 'second', hostPorts: [8081] }, f.provider)).resolves.toBeDefined()
  })
  it('refuses workload identity changes, unknown files, or malformed review during re-review', async () => {
    const f = setup(), first = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1', project = { ...f.input.project, files: first.files }
    await expect(reviewCatalogWorkload({ project: { ...project, id: 'different' }, scenario: first.scenario, attachmentId: 'catalog-1' })).rejects.toThrow(/ownership|identity/)
    for (const compose of [{ services: { other: { image: 'nginx', ports: ['8888:80'] } } }, { services: { 'apache-cve-2021-42013': { image: 'nginx', ports: ['8888:80'], volumes: ['data:/data'] } }, volumes: { data: {} } }]) {
      await expect(reviewCatalogWorkload({ project: { ...project, files: { ...first.files, [`${prefix}/payload/compose.yml`]: stringify(compose) } }, scenario: first.scenario, attachmentId: 'catalog-1' })).rejects.toThrow(/service|volume/)
    }
    await expect(reviewCatalogWorkload({ project: { ...project, files: { ...first.files, [`${prefix}/custom.yml`]: 'user file' } }, scenario: first.scenario, attachmentId: 'catalog-1' })).rejects.toThrow(/unrecognized/)
    await expect(reviewCatalogWorkload({ project: { ...project, files: { ...first.files, [`${prefix}/review.json`]: '{}' } }, scenario: first.scenario, attachmentId: 'catalog-1' })).rejects.toThrow(/review|origin/)
  })
  it('validates the exact reviewed payload, execution config, wrappers and ownership before compilation', async () => {
    const f = setup(), result = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    const validate = (files = result.files, projectId = f.input.project.id) => validateCatalogWorkloadReview({ files, scenarioLabel: 'saved', attachmentId: 'catalog-1', projectId })
    expect(() => validate()).not.toThrow()
    expect(() => validate(result.files, 'other-project')).toThrow(/ownership/)
    for (const path of ['payload/hello.sh', 'runtime.compose.yml', 'deploy.yml', 'cleanup.yml']) {
      expect(() => validate({ ...result.files, [`${prefix}/${path}`]: 'changed' })).toThrow(/review|changed|configuration/i)
    }
    expect(() => validate({ ...result.files, [`${prefix}/payload/new.png`]: assetFromBytes(new Uint8Array([0, 255])) })).toThrow(/review|changed/i)
    const missing = { ...result.files }; delete missing[`${prefix}/payload/hello.sh`]
    expect(() => validate(missing)).toThrow(/review|changed/i)
  })
  it('keeps ownership metadata private while bind-mounted asset directories are readable by application users', async () => {
    const f = setup(), result = await prepareCatalogWorkload(f.input, f.provider)
    const tasks = parse(result.files['scenarios/saved/content/workloads/catalog-1/deploy.yml'] as string)[0].tasks
    const directory = tasks.find(task => task.name === 'Create workload directories')
    expect(directory['ansible.builtin.file'].mode).toBe('{{ item.mode }}')
    expect(directory.loop).toContainEqual({ path: result.summary.destination, mode: '0700' })
    expect(directory.loop).toContainEqual({ path: `${result.summary.destination}/payload`, mode: '0755' })
    expect(tasks.find(task => task.name === 'Record workload ownership')['ansible.builtin.copy'].mode).toBe('0600')
  })
  it('recreates the owned application container so replaced single-file bind mounts use the reviewed bytes', async () => {
    const f = setup(), result = await prepareCatalogWorkload(f.input, f.provider)
    const tasks = parse(result.files['scenarios/saved/content/workloads/catalog-1/deploy.yml'] as string)[0].tasks
    expect(tasks.find(task => task.name === 'Start the selected guest workload')['ansible.builtin.command'].argv).toContain('--force-recreate')
  })
  it('removes only previously recorded obsolete regular payload files after ownership and path checks', async () => {
    const f = setup(), result = await prepareCatalogWorkload(f.input, f.provider)
    const tasks = parse(result.files['scenarios/saved/content/workloads/catalog-1/deploy.yml'] as string)[0].tasks
    const remove = tasks.find(task => task.name === 'Remove previously copied obsolete payload files')
    expect(remove['ansible.builtin.file'].path).toBe(`${result.summary.destination}/payload/{{ item.item }}`)
    expect(remove.when).toBe('item.stat.exists')
    expect(tasks.findIndex(task => task.name === 'Refuse links in the owned payload')).toBeLessThan(tasks.indexOf(remove))
    expect(tasks.findIndex(task => task.name === 'Validate previously copied payload paths')).toBeLessThan(tasks.indexOf(remove))
    const manifest = tasks.find(task => task.name === 'Record copied workload payload files')['ansible.builtin.copy']
    expect(manifest.mode).toBe('0600')
    expect(JSON.parse(manifest.content)).toContain('hello.sh')
  })
  it('preserves reviewed port overrides for asset-only updates but reviews explicit Compose port edits', async () => {
    const f = setup(), first = await prepareCatalogWorkload({ ...f.input, hostPorts: [18888] }, f.provider)
    const input = { project: { ...f.input.project, files: first.files }, scenario: first.scenario, attachmentId: 'catalog-1' }
    expect((await reviewCatalogWorkload(input)).summary.published_ports).toEqual(['18888/tcp'])
    const compose = f.compose(); compose.services['apache-cve-2021-42013'].ports = ['28888:80'];
    input.project.files['scenarios/saved/content/workloads/catalog-1/payload/compose.yml'] = stringify(compose)
    expect((await reviewCatalogWorkload(input)).summary.published_ports).toEqual(['28888/tcp'])
    expect((await reviewCatalogWorkload({ ...input, hostPorts: [38888] })).summary.published_ports).toEqual(['38888/tcp'])
  })
  it('allows independently re-reviewing two edited workloads without a stale-review deadlock', async () => {
    const f = setup(), first = await prepareCatalogWorkload(f.input, f.provider)
    const second = await prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, files: first.files }, scenario: first.scenario, attachmentId: 'second', hostPorts: [18888] }, f.provider)
    const firstPath = 'scenarios/saved/content/workloads/catalog-1/payload/hello.sh', secondPath = 'scenarios/saved/content/workloads/second/payload/hello.sh'
    const project = { ...f.input.project, files: { ...second.files, [firstPath]: '# first update', [secondPath]: '# second update' } }
    const reviewedFirst = await reviewCatalogWorkload({ project, scenario: second.scenario, attachmentId: 'catalog-1' })
    expect(() => validateCatalogWorkloadReview({ files: reviewedFirst.files, scenarioLabel: 'saved', attachmentId: 'second' })).toThrow(/changed/)
    const reviewedSecond = await reviewCatalogWorkload({ project: { ...project, files: reviewedFirst.files }, scenario: second.scenario, attachmentId: 'second' })
    for (const attachmentId of ['catalog-1', 'second']) expect(() => validateCatalogWorkloadReview({ files: reviewedSecond.files, scenarioLabel: 'saved', attachmentId })).not.toThrow()
    const composePath = 'scenarios/saved/content/workloads/second/payload/compose.yml'
    const compose = f.compose(); compose.services['apache-cve-2021-42013'].ports = ['8888:80']
    await expect(reviewCatalogWorkload({ project: { ...project, files: { ...reviewedSecond.files, [composePath]: stringify(compose) } }, scenario: second.scenario, attachmentId: 'second', hostPorts: [8888] })).rejects.toThrow(/already assigned/)
  })
  it('refuses file-to-directory and directory-to-file payload changes before runtime', async () => {
    const f = setup(), first = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1/payload/'
    const nested = { ...first.files, [`${prefix}hello.sh/new.txt`]: 'new file' }
    delete nested[`${prefix}hello.sh`]
    const collapsed = { ...first.files, [`${prefix}poc`]: 'new file' }
    for (const path of Object.keys(collapsed)) if (path.startsWith(`${prefix}poc/`)) delete collapsed[path]
    for (const files of [nested, collapsed]) await expect(reviewCatalogWorkload({ project: { ...f.input.project, files }, scenario: first.scenario, attachmentId: 'catalog-1' })).rejects.toThrow(/file.*directory|directory.*file/)
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
  it('refuses PoC-only metadata instead of inventing a workload', async () => {
    const poc = setup(); poc.input.entry.path += '/poc'; poc.input.entry.document = JSON.parse(poc.files[`${poc.input.entry.path}/meta.json`]); poc.tree.splice(0, poc.tree.length, ...poc.tree.filter(row => row.path.startsWith(`${poc.input.entry.path}/`)))
    await expect(prepareCatalogWorkload(poc.input, poc.provider)).rejects.toThrow(/Compose|compose/)
  })
  it('reviews multiple services, literal environment, dependencies, private volumes and readiness together', async () => {
    const f = setup()
    f.setCompose({ services: {
      web: { image: 'nginx:alpine', ports: ['8080:80'], environment: { APP_MODE: 'training' }, depends_on: ['db'],
        healthcheck: { test: ['CMD', 'curl', '-f', 'http://localhost/'], interval: '5s', timeout: '2s', retries: 3 } },
      db: { image: 'redis:7', volumes: ['data:/data'] },
    }, volumes: { data: {} } })
    const result = await prepareCatalogWorkload(f.input, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    const runtime = parse(result.files[`${prefix}/runtime.compose.yml`] as string)
    expect(Object.keys(runtime.services)).toEqual(['web', 'db'])
    expect(runtime.services.web).toMatchObject({ environment: { APP_MODE: 'training' }, depends_on: ['db'] })
    expect(runtime.services.db.volumes).toEqual(['data:/data'])
    expect(runtime.volumes.data.labels['io.range42.workload']).toMatch(/^[a-f0-9]{64}$/)
    expect(result.summary.services).toEqual(['web', 'db'])
    expect(result.summary.readiness).toContain('health')
    expect(result.files[`${prefix}/deploy.yml`]).toContain('--wait')
    expect(result.files[`${prefix}/cleanup.yml`]).toContain('Refuse a foreign workload volume')
    expect(result.files[`${prefix}/cleanup.yml`]).not.toContain('--volumes')
    expect(result.summary.cleanup_file).toBe(`${prefix}/cleanup.yml`)
  })
  it('rejects duplicate ports across services, dependency cycles and external volume adoption', async () => {
    const f = setup()
    for (const doc of [
      { services: { a: { image: 'nginx', ports: ['80:80'] }, b: { image: 'nginx', ports: ['80:80'] } } },
      { services: { a: { image: 'nginx', depends_on: ['b'] }, b: { image: 'nginx', depends_on: ['a'] } } },
      { services: { a: { image: 'nginx', ports: ['8888:80'], volumes: ['data:/data'] } }, volumes: { data: { external: true } } },
    ]) {
      f.setCompose(doc)
      await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/same host port|cycle|external/i)
    }
  })
  it('allows only complete pinned read-only relative bind mounts and rejects runtime interpolation', async () => {
    const f = setup()
    f.setCompose({ services: { web: { image: 'nginx', volumes: ['./hello.sh:/app/hello.sh:ro'] } } })
    const result = await prepareCatalogWorkload(f.input, f.provider)
    expect(parse(result.files['scenarios/saved/content/workloads/catalog-1/runtime.compose.yml'] as string).services.web.volumes).toEqual(['./hello.sh:/app/hello.sh:ro'])
    for (const volumes of [['./missing:/app:ro'], ['./hello.sh:/app:rw'], ['/etc:/app:ro'], ['../secret:/app:ro']]) {
      f.setCompose({ services: { web: { image: 'nginx', volumes } } })
      await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/mount|path|missing|unsupported/i)
    }
    f.setCompose({ services: { web: { image: 'nginx', environment: { APP_MODE: '${BACKEND_SECRET}' } } } })
    await expect(prepareCatalogWorkload(f.input, f.provider)).rejects.toThrow(/literal|interpolation/i)
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
  it('keeps ports reserved while a workload cleanup is only staged in the project', async () => {
    const f = setup(), first = await prepareCatalogWorkload(f.input, f.provider)
    first.scenario.content.at(-1)!.path = 'content/workloads/catalog-1/cleanup.yml'
    await expect(prepareCatalogWorkload({ ...f.input, project: { ...f.input.project, files: first.files }, scenario: first.scenario, attachmentId: 'catalog-2' }, f.provider)).rejects.toThrow(/8888/)
  })
  it('binds declared vault variables at runtime without storing secret values in the payload or review', async () => {
    const f = setup()
    f.input.project.baseDoc.env.push({ name: 'workload_password', secret: true, required: true })
    f.setCompose({ services: { db: { image: 'postgres:17', environment: { POSTGRES_PASSWORD: '${DB_PASSWORD}' } } } })
    const result = await prepareCatalogWorkload({ ...f.input, secretBindings: { DB_PASSWORD: 'workload_password' } }, f.provider)
    const prefix = 'scenarios/saved/content/workloads/catalog-1'
    const deploy = parse(result.files[`${prefix}/deploy.yml`] as string)[0]
    expect(deploy.vars_files).toEqual(["{{ lookup('env', 'RANGE42_ACTIVE_CONFIG_DIR') }}/secrets/default_vault.yml"])
    const commands = deploy.tasks.filter(task => task['ansible.builtin.command']?.argv.includes('compose') && !task['ansible.builtin.command'].argv.includes('version'))
    expect(commands.length).toBeGreaterThan(1)
    for (const task of commands) {
      expect(task.no_log).toBe(true)
      expect(task.environment.DB_PASSWORD).toBe("{{ lookup('vars', 'workload_password') }}")
    }
    expect(result.summary.required_secrets).toEqual(['workload_password'])
    expect(parse(result.files[`${prefix}/runtime.compose.yml`] as string).services.db.environment.POSTGRES_PASSWORD).toBe('${DB_PASSWORD}')
  })
  it('rejects missing, unused and undeclared runtime secret bindings before changing the project', async () => {
    const f = setup()
    f.setCompose({ services: { db: { image: 'postgres:17', environment: { POSTGRES_PASSWORD: '${DB_PASSWORD}' } } } })
    for (const secretBindings of [undefined, { DB_PASSWORD: 'unknown' }, { UNUSED: 'password' }, { DB_PASSWORD: "name') }}" }]) {
      await expect(prepareCatalogWorkload({ ...f.input, secretBindings }, f.provider)).rejects.toThrow(/secret|declared|variable|interpolation/i)
    }
  })
  it('captures runtime secret names before asynchronous source reads', async () => {
    const f = setup()
    f.input.project.baseDoc.env.push({ name: 'workload_password', secret: true })
    f.setCompose({ services: { db: { image: 'postgres:17', environment: { POSTGRES_PASSWORD: '${DB_PASSWORD}' } } } })
    let release!: (tree: typeof f.tree) => void
    f.provider.listTree.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const input = { ...f.input, secretBindings: { DB_PASSWORD: 'workload_password' } }
    const pending = prepareCatalogWorkload(input, f.provider)
    input.secretBindings.DB_PASSWORD = 'changed'
    release(f.tree)
    expect((await pending).summary.required_secrets).toEqual(['workload_password'])
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
