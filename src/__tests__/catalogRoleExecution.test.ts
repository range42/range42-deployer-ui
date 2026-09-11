import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { prepareRoleAttachment, validateRoleAttachment } from '@/services/catalogRoleExecution'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { savedScenario } from './fixtures/savedScenario'
import { replicatedScenario } from './fixtures/replicatedScenario'
import fixture from './fixtures/catalogRoleNtp.json'
const origin = { version: 1, kind: 'ansible_role', mode: 'customize', source_id: 'catalog', provider: 'github',
  base_url: 'https://github.com', repo_owner: 'range42', repo_name: 'catalog', path: fixture.path, sha: fixture.sha }
const source = () => ({ id: 'role-project', name: 'NTP role', catalogRef: { ...origin }, files: structuredClone(fixture.files) })
const attach = (overrides = {}) => prepareRoleAttachment({ sourceProject: source(), targetFiles: {}, targetNode: 'vm1', id: 'role-1', ...overrides })

describe('imported role execution', () => {
  it('copies the actual default role tree and separates its original revision from edited authored file digests', () => {
    const role = source()
    role.files[`${fixture.path}/tasks/main.yml`] += '\n# reviewed local edit\n'
    const result = attach({ sourceProject: role })
    expect(result.files).toEqual(role.files)
    expect(result.item).toMatchObject({ kind: 'role', target_node: 'vm1', path: fixture.path, role: { version: 1, origin } })
    expect(Object.keys(result.item.role.file_hashes)).toHaveLength(7)
    expect(validateRoleAttachment(result.item, result.files).path).toBe(fixture.path)
    result.files[`${fixture.path}/tasks/main.yml`] += '# later edit\n'
    expect(() => validateRoleAttachment(result.item, result.files)).toThrow(/changed.*review/i)
  })
  it('rejects target-file collisions and remains a pure candidate on failure', () => {
    const targetFiles = { [`${fixture.path}/tasks/main.yml`]: 'manual local tasks' }
    expect(() => attach({ targetFiles })).toThrow(/already exists/)
    expect(targetFiles[`${fixture.path}/tasks/main.yml`]).toBe('manual local tasks')
  })
  it.each(['delegate_to: localhost', 'connection: local', 'add_host: {name: outside}', 'vars: {ansible_host: 203.0.113.1}', 'vars: {r42_project_dir: /tmp/elsewhere}', 'vars: {inventory_hostname: outside}', 'remote_user: outside'])('refuses role-supplied target override %s', field => {
    const role = source()
    role.files[`${fixture.path}/tasks/main.yml`] = `- name: unsafe target\n  debug: {msg: hello}\n  ${field}\n`
    expect(() => attach({ sourceProject: role })).toThrow(/managed|target/i)
  })
  it('refuses a controller lookup hidden in an executed template', () => {
    const role = source()
    role.files[`${fixture.path}/templates/config.j2`] = "{{ lookup('file', '/controller/private') }}"
    expect(() => attach({ sourceProject: role })).toThrow(/lookup/)
  })
  it('retains the catalog category.action.target naming requirement for saved role metadata', () => {
    const role = source()
    role.catalogRef.path = 'roles/arbitrary'
    role.files = Object.fromEntries(Object.entries(role.files).map(([path, content]) => [path.replace(fixture.path, 'roles/arbitrary'), content]))
    expect(() => attach({ sourceProject: role })).toThrow(/naming/)
  })
  it('generates role execution on the exact VM between preceding and following content with managed project-root lookup', () => {
    const project = savedScenario()
    const role = attach({ targetFiles: project.files })
    role.item.vars = { service_label: 'reviewed' }
    project.files = role.files
    project.scenario.content.push(role.item, { ...project.scenario.content[0], id: 'after' })
    const generated = emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths })
    const plays = parse(generated.files['scenarios/saved/configure.yml'])
    expect(plays).toHaveLength(3)
    expect(plays[1]).toMatchObject({ hosts: 'saved-vm', gather_facts: true, become: true,
      vars: { service_label: 'reviewed', PORT: 8443 }, roles: [{ role: `{{ r42_project_dir }}/${fixture.path}` }] })
    const manifest = JSON.parse(generated.files['scenarios/saved/manifest/scenario_roles.json'])
    expect(manifest.attachments[0]).toMatchObject({ vm_id: 3101, inventory_host: 'saved-vm', role: role.item.role })
    expect(generated.files[`${fixture.path}/tasks/main.yml`]).toBe(fixture.files[`${fixture.path}/tasks/main.yml`])
    role.item.vars.r42_project_dir = '/tmp/other'
    expect(() => emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths })).toThrow(/Reserved/)
  })
  it('expands a role to the exact replicated VM cohort in the original content order', () => {
    const project = replicatedScenario()
    const node = project.scenario.vms[0].node_id
    const role = attach({ targetNode: node, targetFiles: project.files || {} })
    project.scenario.content = [role.item]
    const generated = emitConcreteScenario({ ...project, files: role.files, generatedPaths: [] })
    const instances = JSON.parse(generated.files[`scenarios/${project.scenario.label}/manifest/scenario_instances.json`])
    const roles = JSON.parse(generated.files[`scenarios/${project.scenario.label}/manifest/scenario_roles.json`])
    expect(roles.attachments.map(item => item.inventory_host)).toEqual(instances.instances.map(item => item.hostname))
  })
})
