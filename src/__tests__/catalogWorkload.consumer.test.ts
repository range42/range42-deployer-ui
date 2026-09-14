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
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { fileBytes } from '@/services/projectFiles'
import { savedScenario } from './fixtures/savedScenario'
import fixture from './fixtures/catalogComposeApache.json'

const backend = process.env.R42_WORKLOAD_BACKEND
const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
async function setup(mode: string, hostPorts?: number[]) {
  const root = mkdtempSync(join(tmpdir(), 'r42-workload-consumer-')); temporary.push(root)
  const project = savedScenario(); project.scenario.content = []
  const provider = { listTree: async () => fixture.tree, getFile: async () => { throw new Error('text fallback unused') }, getFileContent: async ({ path }: { path: string }) => ({ content: fixture.files[path as keyof typeof fixture.files], sha: fixture.tree.find(row => row.path === path)!.sha }) }
  const result = await prepareCatalogWorkload({ project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'catalog-1', hostPorts,
    entry: { source_id: 'catalog', kind: 'container', name: 'Apache', path: fixture.path, sha: fixture.sha },
    source: { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] } }, provider)
  const emitted = emitConcreteScenario({ ...project, files: result.files, scenario: result.scenario, generatedPaths: project.scenario_generated_paths })
  for (const [name, content] of Object.entries(emitted.files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fileBytes(content)) }
  const python = join(backend!, '.venv/bin/python'), ansible = join(backend!, '.venv/bin/ansible-playbook')
  const accepted = execFileSync(python, ['-c', 'from pathlib import Path; import sys; from app.core.project import resolve_project_scenario; from app.core.bundle_attachments import validate_scenario_bundles; s=resolve_project_scenario(Path(sys.argv[1]), scenario_label="saved", scope="configure"); validate_scenario_bundles(s.playbook.parent); print("accepted:"+str(s.vmids))', root], { cwd: backend, encoding: 'utf8' })
  expect(accepted.trim()).toBe('accepted:[3101]')
  const bin = join(root, 'bin'); mkdirSync(bin)
  const guest = join(root, 'guest'), calls = join(root, 'docker-calls.jsonl')
  const expected = Object.fromEntries(Object.entries(fixture.files).map(([path, content]) => [path.slice(fixture.path.length + 1), content]))
  writeFileSync(join(root, 'expected.json'), JSON.stringify(expected))
  const marker = JSON.parse(result.files['scenarios/saved/content/workloads/catalog-1/review.json'] as string).compose_project
  writeFileSync(join(bin, 'docker'), `#!${python}\nimport json, pathlib, sys\nroot=pathlib.Path(${JSON.stringify(root)})\nmode=${JSON.stringify(mode)}\nargs=sys.argv[1:]\nassert args[:2]==['--host','unix:///var/run/docker.sock']\nargs=args[2:]\nwith (root/'docker-calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\\n')\nif args==['compose','version']:\n print('Docker Compose version v2.39.0'); sys.exit(1 if mode=='missing' else 0)\nif args==['info']: sys.exit(0)\nif args[:2]==['container','ls']:\n print('collision' if mode=='foreign' else ''); sys.exit(0)\nif args[:2]==['network','ls']:\n print('collision' if mode=='foreign-network' else ''); sys.exit(0)\nif args[:2]==['network','inspect']:\n print(json.dumps([{'Labels':{'io.range42.workload':'foreign'}}])); sys.exit(0)\nif args[:2]==['container','inspect']:\n owner=(root/'guest'/${JSON.stringify(marker)}/'owner.txt')\n label=owner.read_text() if owner.exists() else 'foreign'\n print(json.dumps([{'Config':{'Labels':{'io.range42.workload':label}},'State':{'Running':mode!='stopped'}}])); sys.exit(0)\nassert args[0]=='compose'\npayload=pathlib.Path(args[args.index('--project-directory')+1])\nexpected=json.loads((root/'expected.json').read_text())\nassert all((payload/name).read_bytes()==value.encode() for name,value in expected.items()), 'copy bytes/path mismatch'\nassert args[args.index('--env-file')+1]=='/dev/null'\nassert (payload/'compose.yml').is_file()\nassert len([x for x in args if x=='-f'])==1\nassert args[-2:]==['config','--quiet'] or args[-4:]==['up','--detach','--build','apache-cve-2021-42013']\n`)
  execFileSync('/bin/chmod', ['0755', join(bin, 'docker')])
  const playbook = join(root, 'scenarios/saved/content/workloads/catalog-1/deploy.yml')
  const plays = parse(readFileSync(playbook, 'utf8').replaceAll('/opt/range42/workloads', guest))
  plays[0].become = false
  plays[0].environment = { PATH: `${bin}:/usr/bin:/bin` }
  writeFileSync(playbook, stringify(plays, { lineWidth: 0 }))
  writeFileSync(join(root, 'test-hosts.yml'), stringify({ all: { hosts: { 'saved-vm': { ansible_connection: 'local', ansible_python_interpreter: python }, 'unselected-vm': { ansible_connection: 'local', ansible_python_interpreter: python } } } }))
  writeFileSync(join(root, 'ansible.cfg'), '[defaults]\n')
  const run = () => {
    try { return { rc: 0, output: execFileSync(ansible, ['-i', join(root, 'test-hosts.yml'), join(root, 'scenarios/saved/configure.yml')], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, ANSIBLE_CONFIG: join(root, 'ansible.cfg'), ANSIBLE_STDOUT_CALLBACK: 'default', ANSIBLE_NOCOLOR: '1', ANSIBLE_LOCAL_TEMP: join(root, 'ansible-tmp') } }) } }
    catch (error) { const failure = error as { status?: number; stdout?: string }; return { rc: failure.status || 1, output: String(failure.stdout || '') } }
  }
  return { root, result, run, calls, guest, marker }
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
  it.skipIf(!process.env.R42_WORKLOAD_DOCKER)('validates the copied source and identity override with the actual Compose CLI without a daemon', async () => {
    const f = await setup('ok', [18888]), prefix = join(f.root, 'scenarios/saved/content/workloads/catalog-1')
    const result = execFileSync(process.env.R42_WORKLOAD_DOCKER!, ['--host', 'unix:///nonexistent-r42-test.sock', 'compose', '--project-name', f.marker, '--project-directory', join(prefix, 'payload'), '--env-file', '/dev/null', '-f', join(prefix, 'runtime.compose.yml'), 'config', '--format', 'json'], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, HOME: f.root, DOCKER_CONFIG: join(f.root, 'empty-docker-config') } })
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
})
