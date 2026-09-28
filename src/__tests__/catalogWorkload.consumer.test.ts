/** Opt-in local consumer proof: R42_WORKLOAD_BACKEND points to the actual backend checkout.
 * No Docker daemon, SSH, network or hypervisor is used. A disposable fake Docker CLI
 * verifies copied bytes; only guest destinations and connection are remapped for localhost.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import process from 'node:process'
import { parse, stringify } from 'yaml'
import { prepareCatalogWorkload, reviewCatalogWorkload } from '@/services/catalogWorkload'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { assetFromBytes, fileBase64, fileBytes, type ProjectFiles } from '@/services/projectFiles'
import { savedScenario } from './fixtures/savedScenario'
import fixture from './fixtures/catalogComposeApache.json'

const backend = process.env.R42_WORKLOAD_BACKEND
const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
async function setup(mode: string, hostPorts?: number[], document?: object, secretBindings: Record<string, string> = {}, extras: ProjectFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'r42-workload-consumer-')); temporary.push(root)
  const project = savedScenario(); project.scenario.content = []
  project.baseDoc.env.push(...Object.values(secretBindings).map(name => ({ name, secret: true })))
  const sourceFiles: ProjectFiles = { ...fixture.files, ...Object.fromEntries(Object.entries(extras).map(([path, content]) => [`${fixture.path}/${path}`, content])), ...(document ? { [`${fixture.path}/compose.yml`]: stringify(document) } : {}) }
  const tree = [...fixture.tree, ...Object.keys(extras).map(path => ({ path: `${fixture.path}/${path}`, type: 'blob', mode: '100644', sha: 'c'.repeat(40) }))]
  const provider = { listTree: async () => tree, getFile: async () => { throw new Error('text fallback unused') }, getFileContent: async ({ path }: { path: string }) => ({ content: sourceFiles[path], sha: tree.find(row => row.path === path)!.sha }) }
  const result = await prepareCatalogWorkload({ project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'catalog-1', hostPorts, secretBindings,
    entry: { source_id: 'catalog', kind: 'container', name: 'Apache', path: fixture.path, sha: fixture.sha },
    source: { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] } }, provider)
  const emitted = emitConcreteScenario({ ...project, files: result.files, scenario: result.scenario, generatedPaths: project.scenario_generated_paths })
  for (const [name, content] of Object.entries(emitted.files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fileBytes(content)) }
  const python = join(backend!, '.venv/bin/python'), ansible = join(backend!, '.venv/bin/ansible-playbook')
  const accepted = execFileSync(python, ['-c', 'from pathlib import Path; import sys; from app.core.project import resolve_project_scenario; from app.core.bundle_attachments import validate_scenario_bundles; s=resolve_project_scenario(Path(sys.argv[1]), scenario_label="saved", scope="configure"); validate_scenario_bundles(s.playbook.parent); print("accepted:"+str(s.vmids))', root], { cwd: backend, encoding: 'utf8' })
  expect(accepted.trim()).toBe('accepted:[3101]')
  const bin = join(root, 'bin'); mkdirSync(bin)
  const guest = join(root, 'guest'), calls = join(root, 'docker-calls.jsonl')
  const expected = Object.fromEntries(Object.entries(sourceFiles).map(([path, content]) => [path.slice(fixture.path.length + 1), fileBase64(content)]))
  writeFileSync(join(root, 'expected.json'), JSON.stringify(expected))
  const marker = JSON.parse(result.files['scenarios/saved/content/workloads/catalog-1/review.json'] as string).compose_project
  writeFileSync(join(root, 'consumer.json'), JSON.stringify({ mode, marker, services: result.summary.services }))
  mkdirSync(join(root, 'active/secrets'), { recursive: true })
  writeFileSync(join(root, 'active/secrets/default_vault.yml'), mode === 'missing-secret' ? '{}\n' : 'workload_password: consumer-fixture-value\n')
  const stub = readFileSync(join(process.cwd(), 'src/__tests__/fixtures/workloadDockerConsumer.py'), 'utf8')
  writeFileSync(join(bin, 'docker'), `#!${python}\n${stub}`)
  execFileSync('/bin/chmod', ['0755', join(bin, 'docker')])
  function localize() {
    for (const name of ['deploy.yml', 'cleanup.yml']) {
      const playbook = join(root, `scenarios/saved/content/workloads/catalog-1/${name}`)
      const plays = parse(readFileSync(playbook, 'utf8').replaceAll('/opt/range42/workloads', guest))
      plays[0].become = false
      plays[0].environment = { PATH: `${bin}:/usr/bin:/bin`, R42_WORKLOAD_TEST_ROOT: root }
      writeFileSync(playbook, stringify(plays, { lineWidth: 0 }))
    }
  }
  localize()
  const stage = (files: ProjectFiles) => {
    const prefix = 'scenarios/saved/content/workloads/catalog-1/'
    const compiled = emitConcreteScenario({ ...project, files, scenario: result.scenario, generatedPaths: project.scenario_generated_paths })
    for (const [name, content] of Object.entries(compiled.files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fileBytes(content)) }
    writeFileSync(join(root, 'expected.json'), JSON.stringify(Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(`${prefix}payload/`)).map(([path, content]) => [path.slice(`${prefix}payload/`.length), fileBase64(content)]))))
    localize()
  }
  writeFileSync(join(root, 'test-hosts.yml'), stringify({ all: { hosts: { 'saved-vm': { ansible_connection: 'local', ansible_python_interpreter: python }, 'unselected-vm': { ansible_connection: 'local', ansible_python_interpreter: python } } } }))
  writeFileSync(join(root, 'ansible.cfg'), '[defaults]\n')
  const run = (cleanup = false) => {
    try { return { rc: 0, output: execFileSync(ansible, ['-i', join(root, 'test-hosts.yml'), join(root, cleanup ? 'scenarios/saved/content/workloads/catalog-1/cleanup.yml' : 'scenarios/saved/configure.yml'), '-e', 'global_vm_ssh_name=saved-vm'], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, RANGE42_ACTIVE_CONFIG_DIR: join(root, 'active'), ANSIBLE_CONFIG: join(root, 'ansible.cfg'), ANSIBLE_STDOUT_CALLBACK: 'default', ANSIBLE_NOCOLOR: '1', ANSIBLE_LOCAL_TEMP: join(root, 'ansible-tmp') } }) } }
    catch (error) { const failure = error as { status?: number; stdout?: string }; return { rc: failure.status || 1, output: String(failure.stdout || '') } }
  }
  return { root, result, run, calls, guest, marker, project, stage }
}

describe.skipIf(!backend)('actual backend + local Ansible workload consumer', () => {
  it('accepts the generated scenario and copies every pinned byte relative to the imported wrapper on only its target', async () => {
    const f = await setup('ok'), executed = f.run()
    expect(executed.output).not.toContain('unselected-vm :')
    expect({ rc: executed.rc, failure: executed.rc ? executed.output : '' }).toEqual({ rc: 0, failure: '' })
    expect(existsSync(join(f.guest, f.marker, 'payload/hello.sh'))).toBe(true)
    const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(calls.some(args => args.includes('up'))).toBe(true)
  }, 60000)
  it('copies, updates and removes only tracked picture assets through real Ansible then cleans up owned containers', async () => {
    const picture = assetFromBytes(new Uint8Array([137, 80, 78, 71, 0, 255]))
    const f = await setup('ok', undefined, { services: { web: { image: 'nginx:alpine', volumes: ['./site:/srv:ro'] } } }, {}, { 'site/logo.png': picture, 'site/old.png': picture })
    const deployed = f.run()
    expect({ rc: deployed.rc, failure: deployed.rc ? deployed.output : '' }).toEqual({ rc: 0, failure: '' })
    const payload = join(f.guest, f.marker, 'payload')
    expect([...readFileSync(join(payload, 'site/logo.png'))]).toEqual([...fileBytes(picture)])
    writeFileSync(join(payload, 'site/untracked.txt'), 'preserve')
    const prefix = 'scenarios/saved/content/workloads/catalog-1/payload/'
    const files = { ...f.result.files, [`${prefix}site/logo.png`]: assetFromBytes(new Uint8Array([137, 80, 78, 71, 0, 254])) }
    delete files[`${prefix}site/old.png`]
    const reviewed = await reviewCatalogWorkload({ project: { ...f.project, files }, scenario: f.result.scenario, attachmentId: 'catalog-1' })
    f.stage(reviewed.files)
    const updated = f.run()
    expect({ rc: updated.rc, failure: updated.rc ? updated.output : '' }).toEqual({ rc: 0, failure: '' })
    expect([...readFileSync(join(payload, 'site/logo.png'))]).toEqual([...fileBytes(files[`${prefix}site/logo.png`])])
    expect(existsSync(join(payload, 'site/old.png'))).toBe(false)
    expect(readFileSync(join(payload, 'site/untracked.txt'), 'utf8')).toBe('preserve')
    const cleanup = f.run(true)
    expect({ rc: cleanup.rc, failure: cleanup.rc ? cleanup.output : '' }).toEqual({ rc: 0, failure: '' })
  }, 120000)
  it.skipIf(!process.env.R42_WORKLOAD_DOCKER)('validates the copied source and identity override with the actual Compose CLI without a daemon', async () => {
    const f = await setup('ok', [18888]), prefix = join(f.root, 'scenarios/saved/content/workloads/catalog-1')
    const result = execFileSync(process.env.R42_WORKLOAD_DOCKER!, ['--host', 'unix:///nonexistent-r42-test.sock', 'compose', '--project-name', f.marker, '--project-directory', join(prefix, 'payload'), '--env-file', '/dev/null', '-f', join(prefix, 'runtime.compose.yml'), 'config', '--format', 'json'], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, DOCKER_CONFIG: join(f.root, 'empty-docker-config') } })
    const document = JSON.parse(result)
    expect(document.services['apache-cve-2021-42013'].container_name).toBe(`${f.marker}-service`)
    expect(document.services['apache-cve-2021-42013'].build.context).toBe(join(prefix, 'payload'))
    expect(document.services['apache-cve-2021-42013'].ports[0]).toMatchObject({ published: '18888', target: 80 })
    expect(document.networks.default.labels['io.range42.workload']).toMatch(/^[a-f0-9]{64}$/)
  }, 15000)
  it.each([['missing', 'Require Docker Compose'], ['foreign', 'Refuse a foreign container'], ['foreign-network', 'Refuse a foreign workload network'], ['stopped', 'Require the selected workload container to be running']])('fails visibly for %s before claiming applied', async (mode, task) => {
    const f = await setup(mode), executed = f.run()
    expect(executed.rc).not.toBe(0)
    expect(executed.output).toContain(task)
    if (mode !== 'stopped') expect(existsSync(join(f.guest, f.marker, 'payload'))).toBe(false)
  }, 60000)
  it('executes all reviewed services then verifies owned cleanup without removing volumes', async () => {
    const f = await setup('ok', undefined, { services: { web: { image: 'nginx:alpine', depends_on: ['cache'] }, cache: { image: 'redis:7', volumes: ['data:/data'] } }, volumes: { data: {} } })
    const deployed = f.run()
    expect({ rc: deployed.rc, failure: deployed.rc ? deployed.output : '' }).toEqual({ rc: 0, failure: '' })
    const cleaned = f.run(true)
    expect({ rc: cleaned.rc, failure: cleaned.rc ? cleaned.output : '' }).toEqual({ rc: 0, failure: '' })
    const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(calls.find(args => args.includes('up')).slice(-2)).toEqual(['web', 'cache'])
    expect(calls.find(args => args.includes('down'))).not.toContain('--volumes')
    expect(existsSync(join(f.guest, f.marker, 'payload/hello.sh'))).toBe(true)
  }, 60000)
  it('refuses changed installed configuration before cleanup dispatch', async () => {
    const f = await setup('ok'), deployed = f.run()
    expect(deployed.rc).toBe(0)
    writeFileSync(join(f.guest, f.marker, 'runtime.compose.yml'), 'services: {}\n')
    const cleaned = f.run(true)
    expect(cleaned.rc).not.toBe(0)
    expect(cleaned.output).toContain('Refuse changed or linked cleanup configuration')
    expect(readFileSync(f.calls, 'utf8')).not.toContain('"down"')
  }, 60000)
  it.each(['secret', 'missing-secret'])('resolves runtime-only vault bindings for %s without including values in logs or Git', async mode => {
    const f = await setup(mode, undefined, { services: { db: { image: 'postgres:17', environment: { POSTGRES_PASSWORD: '${DB_PASSWORD}' } } } }, { DB_PASSWORD: 'workload_password' })
    const executed = f.run()
    expect(executed.rc).toBe(mode === 'secret' ? 0 : 2)
    expect(executed.output).not.toContain('consumer-fixture-value')
    expect(JSON.stringify(f.result.files)).not.toContain('consumer-fixture-value')
    if (mode === 'secret') expect(readFileSync(f.calls, 'utf8')).toContain('"up"')
    else expect(existsSync(f.calls)).toBe(false)
  }, 60000)
})
