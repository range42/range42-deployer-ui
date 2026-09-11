import { describe, expect, it } from 'vitest'
import { buildPushArgs, buildProjectFiles } from '@/composables/useProjectGitSync'
import { inspectProjectAuthoring } from '@/services/projectAuthoring'
import { loadCanvasFromState } from '@/overlay/projectState'
import { replicatedScenario } from './fixtures/replicatedScenario'
import { savedScenario } from './fixtures/savedScenario'
import { emitConcreteScenario } from '@/services/concreteScenario'

function snapshot(project) {
  const files = buildProjectFiles(buildPushArgs(project, project.nodes, project.edges))
  return { meta: JSON.parse(files['meta.json']), topology: files['topology.json'], canvas_layout: files['canvas_layout.json'],
    overlay: files['overlay.json'], files: project.files }
}

describe('saved project authoring metadata', () => {
  it('round-trips verified bundle forms, typed parameters and sealed runtime provenance', () => {
    const project = savedScenario()
    const resolution = { source_id: 'sdn', source_sha: 'a'.repeat(40), path: 'bundles/firewall/in_vm/os_firewall.baseline.ssh',
      entrypoint: 'firewall/in_vm/os_firewall.baseline.ssh/main.yml', bundle_kind: 'GROUP', target_kind: 'VM', proof_kind: 'content_match',
      params: [{ name: 'target_group', type: 'string', target: true }, { name: 'PORT', type: 'int' }], target_vars: ['target_group'],
      runtime: { fingerprint: 'b'.repeat(64), proof: 'server-sealed-proof', dependencies: [{ name: 'roles', revision: 'c'.repeat(40), sha256: 'd'.repeat(64) }] } }
    project.scenario.content.push({ id: 'bundle', kind: 'bundle', target_node: 'vm1', path: resolution.entrypoint, resolution, vars: { PORT: 8080 } })
    const generated = emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths })
    project.files = generated.files; project.scenario_generated_paths = generated.generatedPaths
    const state = snapshot(project)
    const restored = inspectProjectAuthoring(state, loadCanvasFromState(state))
    expect(restored.status).toBe('structured')
    expect(restored.scenario.content.at(-1)).toEqual(project.scenario.content.at(-1))
  })
  it('restores structured configuration, variable declarations and exact generated ownership', () => {
    const project = savedScenario()
    const state = snapshot(project)
    expect(state.meta.ui_project).toMatchObject({ version: 1, project_id: project.id, scenario: project.scenario,
      generated_paths: project.scenario_generated_paths, variables: project.baseDoc.env })
    const inspected = inspectProjectAuthoring(state, loadCanvasFromState(state))
    expect(inspected.status).toBe('structured')
    expect(inspected.scenario).toEqual(project.scenario)
    expect(inspected.generated_paths).toEqual(project.scenario_generated_paths)
  })

  it('does not persist credentials, lease ownership or secret variable values', () => {
    const project = savedScenario()
    project.scenario.allocation = { ownership_token: 'private-lease', reservation: { token: 'private-lease' } }
    project.scenario.vault_password = 'private-vault'
    project.git.token = 'private-git'
    project.baseDoc.env[1].default = 'private-variable'
    project.overlay.param_overrides.env.VAULT_VALUE = 'private-override'
    const state = snapshot(project)
    expect(JSON.stringify(state.meta)).not.toMatch(/private-|ownership_token|vault_password/)
    expect(state.overlay).not.toContain('private-override')
    expect(state.meta.ui_project.variables[1]).toEqual({ name: 'VAULT_VALUE', secret: true, required: true })
  })

  it('retains files-only projects and identifies legacy metadata without claiming ownership', () => {
    const project = savedScenario()
    const state = snapshot(project)
    delete state.meta.ui_project
    expect(inspectProjectAuthoring(state, loadCanvasFromState(state))).toMatchObject({ status: 'legacy', generated_paths: [] })
  })

  it.each(['nested credentials', 'too many edges'])('rejects %s before saving a snapshot its loader cannot restore', reason => {
    const project = savedScenario()
    if (reason === 'nested credentials') project.nodes[0].data.replication = { ownership_token: 'must-not-save' }
    else project.edges = Array.from({ length: 4097 }, (_, index) => ({ id: `edge${index}`, source: 'vm1', target: 'net1' }))
    expect(() => snapshot(project)).toThrow(/credential|edge/i)
  })

  it.each(['changed file', 'missing file', 'forged ownership', 'invalid scenario', 'unknown version'])('refuses structured takeover for %s', reason => {
    const project = savedScenario()
    const state = snapshot(project)
    const path = project.scenario_generated_paths[0]
    if (reason === 'changed file') state.files[path] = 'manual edit\n'
    if (reason === 'missing file') delete state.files[path]
    if (reason === 'forged ownership') state.meta.ui_project.generated_paths.push('notes.txt')
    if (reason === 'invalid scenario') state.meta.ui_project.scenario.vms[0].vm_id = 'invalid'
    if (reason === 'unknown version') state.meta.ui_project.version = 2
    const inspected = inspectProjectAuthoring(state, loadCanvasFromState(state))
    expect(inspected.status).toBe('conflict')
    expect(inspected.issue).toBeTruthy()
    expect(inspected.scenario).toBeUndefined()
    expect(inspected.generated_paths).toEqual([])
  })

  it('reopens the original replication roster and source NIC keys without double expansion or credential values', () => {
    const project = { ...savedScenario(), ...replicatedScenario() }
    project.nodes[0].data.replication = { scope: 'per_team' }
    project.scenario.vms[0].primary_nic_key = 'nic-primary'
    const generated = emitConcreteScenario(project)
    project.files = generated.files
    project.scenario_generated_paths = generated.generatedPaths
    project.scenario.replication.ownership_token = 'private-owner'
    project.scenario.replication.teams[0].credentials = { token: 'private-team' }
    Object.values(project.scenario.replication.vm_assignments)[0].vault_password = 'private-vm'
    const state = snapshot(project)
    expect(state.meta.ui_project.scenario.replication.scenario_id).toBe('course-1')
    expect(JSON.stringify(state.meta)).not.toMatch(/private-|ownership_token|credentials|vault_password/)
    const canvas = loadCanvasFromState(state)
    const reopened = inspectProjectAuthoring(state, canvas)
    expect(reopened.status).toBe('structured')
    expect(reopened.scenario.vms).toHaveLength(1)
    expect(reopened.scenario.vms[0].nics[0].key).toBe('nic-primary')
    expect(reopened.scenario.vms[0].primary_nic_key).toBe('nic-primary')
    expect(canvas.nodes).toHaveLength(2)
    const again = emitConcreteScenario({ scenario: reopened.scenario, ...canvas, files: state.files, generatedPaths: reopened.generated_paths, baseDoc: { env: reopened.variables }, overlay: JSON.parse(state.overlay) })
    expect(again.files).toEqual(project.files)
    expect(JSON.parse(again.files['scenarios/replicated/manifest/scenario_vms.json']).vms).toHaveLength(3)
  })


  it.each(['scenario_id', 'vm_id', 'ip', 'subnet'])('rejects nested data smuggled through replication scalar %s before a Git snapshot', field => {
    const project = { ...savedScenario(), ...replicatedScenario() }
    const unsafe = { credentials: 'private-value' }
    if (field === 'scenario_id') project.scenario.replication.scenario_id = unsafe
    else if (field === 'vm_id') Object.values(project.scenario.replication.vm_assignments)[0].vm_id = unsafe
    else if (field === 'ip') Object.values(project.scenario.replication.vm_assignments)[0].nics['nic-primary'].ip = unsafe
    else Object.values(project.scenario.replication.network_assignments)[0].subnet = unsafe
    expect(() => snapshot(project)).toThrow(/replication|assignment|identifier|scalar/i)
  })

})
