/** Compile fresh UI scenarios, then validate their executable files in the paired API. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backend = resolve(process.argv[2] || resolve(ui, '../range42-backend-api'))
const python = process.env.RANGE42_BACKEND_PYTHON || resolve(backend, '.venv/bin/python')
const temporary = await mkdtemp(resolve(tmpdir(), 'range42-replication-contract-'))
const key = (kind, source, team, user = null) => kind + '-' + createHash('sha256')
  .update(JSON.stringify(['contract', source, team, user])).digest('hex')

try {
  const output = resolve(temporary, 'compiler.cjs')
  await build({ entryPoints: [resolve(ui, 'src/services/concreteScenario.js')], bundle: true,
    platform: 'node', format: 'cjs', outfile: output, alias: { '@': resolve(ui, 'src') }, logLevel: 'silent' })
  const { emitConcreteScenario } = createRequire(import.meta.url)(output)
  for (const mode of ['sdn', 'existing_bridge']) {
    const scenario = {
      label: 'replication_contract', network_mode: mode, zone: 'contract',
      vms: [{ node_id: 'desktop', vm_id: 3100, vm_name: 'desktop', template_vm_id: 9901, ssh_user: 'trainee',
        nics: [{ key: 'primary', network_id: 'lan', ip: '10.60.0.10' }] }],
      networks: [{ id: 'lan', vnet: 'source', subnet: '10.60.0.0/24', gateway: '10.60.0.1', snat: false }],
      content: [],
      replication: { version: 1, scenario_id: 'contract',
        teams: [{ id: 'blue', users: [{ id: 'alice' }, { id: 'bob' }] }, { id: 'red', users: [{ id: 'alice' }] }],
        node_scopes: { desktop: 'per_user' }, network_scopes: { lan: 'per_team' },
        vm_assignments: {}, network_assignments: {},
      },
    }
    let vmid = 3101
    for (const [index, team] of scenario.replication.teams.entries()) {
      scenario.replication.network_assignments[key('net', 'lan', team.id)] = {
        vnet: mode === 'sdn' ? `team${index}` : `vmbr1234567890${index}`,
        subnet: `10.60.${index + 1}.0/24`, gateway: `10.60.${index + 1}.1`, snat: mode === 'sdn',
      }
      for (const [offset, user] of team.users.entries()) {
        scenario.replication.vm_assignments[key('vm', 'desktop', team.id, user.id)] = {
          vm_id: vmid++, nics: { primary: { ip: `10.60.${index + 1}.${offset + 10}` } },
        }
      }
    }
    const result = emitConcreteScenario({ scenario,
      nodes: [{ id: 'desktop', type: 'vm' }, { id: 'lan', type: 'network-segment' }],
      edges: [{ id: 'primary', source: 'desktop', target: 'lan' }],
    })
    assert.equal(result.scenario.vms.length, 1, 'source authoring must remain unexpanded')
    const checkout = resolve(temporary, mode)
    for (const [path, value] of Object.entries(result.files)) {
      assert.equal(typeof value, 'string')
      const destination = resolve(checkout, path)
      assert.ok(destination.startsWith(checkout + '/'))
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, value)
    }
    execFileSync(python, ['-c', `
import json, sys
from pathlib import Path
from app.core.errors import Range42Error
from app.core.project import resolve_project_scenario

root = Path(sys.argv[1])
resolved = resolve_project_scenario(root, scenario_label='replication_contract')
assert resolved.vmids == [3101, 3102, 3103]
path = resolved.playbook.parent / 'manifest/scenario_instances.json'
manifest = json.loads(path.read_text())
assert len(manifest['instances']) == 3 and len(manifest['networks']) == 2
manifest['instances'][0]['nics'][0]['network_instance_key'] = manifest['networks'][1]['instance_key']
path.write_text(json.dumps(manifest))
try:
    resolve_project_scenario(root, scenario_label='replication_contract')
except Range42Error as exc:
    assert exc.code == 'PROJECT_SCENARIO_INVALID'
else:
    raise AssertionError('paired backend accepted a cross-team NIC mapping')
`, checkout], { cwd: backend, env: { ...process.env, PYTHONPATH: backend }, stdio: 'inherit' })
    console.log(`${mode}: UI emitted three user VMs on two team networks; backend accepted them and rejected a cross-team mapping`)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
