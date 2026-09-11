/** Local disposable Ansible consumer only. No provider, Proxmox or guest calls. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { build } from 'esbuild'

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backend = resolve(process.argv[2] || resolve(ui, '../range42-backend-api'))
const python = process.env.RANGE42_BACKEND_PYTHON || resolve(backend, '.venv/bin/python')
const ansible = process.env.RANGE42_ANSIBLE_PLAYBOOK || 'ansible-playbook'
const temporary = await mkdtemp(resolve(tmpdir(), 'range42-role-consumer-'))
const write = async (path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content) }
try {
  const bundle = resolve(temporary, 'entry.cjs')
  await build({ stdin: { contents: `export { savedScenario } from './src/__tests__/fixtures/savedScenario.js';
export { prepareRoleAttachment } from './src/services/catalogRoleExecution.ts';
export { emitConcreteScenario } from './src/services/concreteScenario.js';
export { fileBytes } from './src/services/projectFiles.ts';
export { default as fixture } from './src/__tests__/fixtures/catalogRoleNtp.json';`, resolveDir: ui },
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, alias: { '@': resolve(ui, 'src') }, logLevel: 'silent' })
  const { savedScenario, prepareRoleAttachment, emitConcreteScenario, fileBytes, fixture } = createRequire(import.meta.url)(bundle)
  const origin = { version: 1, kind: 'ansible_role', mode: 'customize', source_id: 'catalog', provider: 'github',
    base_url: 'https://github.com', repo_owner: 'range42', repo_name: 'range42-catalog', path: fixture.path, sha: fixture.sha }
  const vault = resolve(temporary, 'workspace/secrets/default_vault.yml')
  await write(vault, '{}\n')
  const inventory = resolve(temporary, 'local-only.yml')
  await write(inventory, 'all:\n  hosts:\n    saved-vm:\n      ansible_connection: local\n    unselected-vm:\n      ansible_connection: local\n')
  const environment = { ...process.env, RANGE42_ACTIVE_CONFIG_DIR: dirname(dirname(vault)), ANSIBLE_NOCOLOR: '1',
    ANSIBLE_ROLES_PATH: resolve(temporary, 'decoy-roles'), ANSIBLE_LOCAL_TEMP: resolve(temporary, 'ansible-local') }
  await write(resolve(environment.ANSIBLE_ROLES_PATH, 'service.reload.ntp/tasks/main.yml'), '- ansible.builtin.fail:\n    msg: Incorrect installed role selected\n')
  const project = savedScenario()
  project.scenario.content = []
  const compile = async (roleFiles, scenarioContent, directory) => {
    const role = prepareRoleAttachment({ sourceProject: { catalogRef: origin, files: roleFiles }, targetFiles: project.files, targetNode: 'vm1', id: 'role' })
    const generated = emitConcreteScenario({ ...project, files: role.files,
      scenario: { ...project.scenario, content: scenarioContent(role.item) }, generatedPaths: project.scenario_generated_paths })
    for (const [path, value] of Object.entries(generated.files)) await write(resolve(directory, path), fileBytes(value))
    return generated
  }
  const named = resolve(temporary, 'named-catalog')
  await compile(fixture.files, item => [item], named)
  execFileSync(ansible, [resolve(named, 'scenarios/saved/configure.yml'), '-i', inventory, '--syntax-check', '-e', JSON.stringify({ r42_project_dir: named })], { env: environment, stdio: 'pipe' })
  console.log(`Default catalog ${fixture.path}@${fixture.sha}: all seven source files preserved; actual Ansible syntax accepted. Package/service tasks were not executed.`)

  // Safe authored replacement proves lookup, variables, exact host selection and sequence;
  // its reviewed hashes differ from the retained original catalog provenance.
  const safeFiles = structuredClone(fixture.files)
  safeFiles[`${fixture.path}/tasks/main.yml`] = '- name: Record selected role and phase locally\n  ansible.builtin.lineinfile:\n    path: "{{ receipt_path }}"\n    line: "{{ inventory_hostname }}:{{ phase }}:{{ PORT }}"\n    create: true\n    mode: "0600"\n'
  safeFiles[`${fixture.path}/vars/main.yml`] = 'phase: role-default\nPORT: 1111\n'
  const receipt = resolve(temporary, 'receipt.txt'), execution = resolve(temporary, 'safe-authored')
  await compile(safeFiles, item => [{ ...item, id: 'first', vars: { phase: 'first', receipt_path: receipt } },
    { ...item, id: 'second', vars: { phase: 'second', receipt_path: receipt } }], execution)
  execFileSync(ansible, [resolve(execution, 'scenarios/saved/configure.yml'), '-i', inventory,
    '-e', JSON.stringify({ r42_project_dir: execution, ansible_become: false, ansible_python_interpreter: '/usr/bin/python3' })],
  { env: environment, stdio: 'pipe', timeout: 60000 })
  assert.equal(await readFile(receipt, 'utf8'), 'saved-vm:first:8443\nsaved-vm:second:8443\n')
  console.log('Actual local Ansible: project role wins over installed-name decoy; selected host only, per-item variables, project variables and ordered repeated roles verified.')
  execFileSync(python, ['-c', `
import json, sys
from pathlib import Path
from app.core.project import resolve_project_scenario
from app.core.errors import Range42Error
root = Path(sys.argv[1])
resolved = resolve_project_scenario(root, scenario_label='saved')
assert resolved.vmids == [3101]
manifest = root / 'scenarios/saved/manifest/scenario_roles.json'
role_data = json.loads(manifest.read_text())
assert len(role_data['attachments']) == 2
# This optional manifest is descriptive, not backend-sealed. Do not claim otherwise.
role_data['attachments'][0]['inventory_host'] = 'descriptive-tamper'
manifest.write_text(json.dumps(role_data))
assert resolve_project_scenario(root, scenario_label='saved').vmids == [3101]
vm_manifest = root / 'scenarios/saved/manifest/scenario_vms.json'
vms = json.loads(vm_manifest.read_text()); vms['vms'][0]['vm_id'] = -1
vm_manifest.write_text(json.dumps(vms))
try:
    resolve_project_scenario(root, scenario_label='saved')
except Range42Error:
    pass
else:
    raise AssertionError('Backend accepted invalid authoritative VMID')
`, execution], { cwd: backend, env: { ...process.env, PYTHONPATH: backend }, stdio: 'pipe' })
  console.log('Paired backend: pinned project resolves; invalid authoritative VMID rejected; non-replicated host-name cross-check is not provided by this resolver. Optional role provenance remains descriptive (not sealed).')
} finally { await rm(temporary, { recursive: true, force: true }) }
