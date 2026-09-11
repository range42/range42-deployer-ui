import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parse } from 'yaml'
import { prepareAttachmentMigration, scenarioReviewSource, reviewedScenarioUpdates } from '@/services/attachmentMigration'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { fileBytes, assetFromBytes } from '@/services/projectFiles'
import { buildPushArgs, buildProjectFiles } from '@/composables/useProjectGitSync'
import { loadGitProject, prepareGitProjectImport } from '@/services/gitProjectOpen'
import { useProjectStore } from '@/stores/projectStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { savedScenario } from './fixtures/savedScenario'
import { replicatedScenario } from './fixtures/replicatedScenario'

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })
const tasks = '\uFEFF# exact bytes\r\n- name: configure\r\n  block:\r\n    - ansible.builtin.debug:\r\n        msg: "{{ MESSAGE }}"\r\n'
const attachment = (id = 'old', order = 0) => ({ id, target_node: 'vm1', stage: 'main', order_in_stage: order,
  scope: 'node', vars: { MESSAGE: 'kept' }, source: { kind: 'inline_yaml', content_inline: tasks } })
function fixture() { return { ...savedScenario(), attachments: [attachment()] } }
function review(project, choices = {}) {
  const migrated = prepareAttachmentMigration({ project, scenario: project.scenario, nodes: project.nodes, choices })
  const generated = emitConcreteScenario({ ...project, ...migrated, generatedPaths: project.scenario_generated_paths })
  return { ...generated, attachments: migrated.attachments, reviewSource: scenarioReviewSource(project, project.nodes, project.edges) }
}

describe('reviewed legacy attachment conversion', () => {
  it('keeps task bytes and variables, orders attachments stably and leaves the source untouched', () => {
    const project = fixture()
    project.attachments = [attachment('later', 5), attachment('first', 1), attachment('second', 1)]
    const original = JSON.stringify(project)
    const migrated = prepareAttachmentMigration({ project, scenario: project.scenario, nodes: project.nodes })
    expect(JSON.stringify(project)).toBe(original)
    expect(migrated.attachments).toEqual([])
    expect(migrated.rows.map(row => row.id)).toEqual(['first', 'second', 'later'])
    expect(migrated.scenario.content.slice(1).map(item => item.vars)).toEqual([{ MESSAGE: 'kept' }, { MESSAGE: 'kept' }, { MESSAGE: 'kept' }])
    for (const item of migrated.scenario.content.slice(1)) {
      const wrapper = parse(migrated.files[`scenarios/saved/${item.path}`])
      expect(wrapper[0].hosts).toBe('{{ global_vm_ssh_name }}')
      expect(wrapper[0].become).toBe(true)
      const raw = wrapper[0].tasks[0]['ansible.builtin.import_tasks']
      expect(migrated.files[`scenarios/saved/content/${raw}`]).toBe(tasks)
    }
    expect(JSON.parse(migrated.files['scenarios/saved/content/legacy-attachments.json']).attachments).toEqual(project.attachments)
  })

  it('requires an explicit uploaded-file mapping and preserves binary data', () => {
    const project = fixture()
    project.attachments[0].source = { kind: 'file_upload', content_inline: 'AP+ACg==' }
    expect(() => prepareAttachmentMigration({ project, scenario: project.scenario, nodes: project.nodes })).toThrow(/choose.*kind/i)
    const result = review(project, { old: { kind: 'file', destination: '/tmp/old.bin', mode: '0600' } })
    const item = result.scenario.content.at(-1)
    expect(fileBytes(result.files[`scenarios/saved/${item.path}`])).toEqual(Uint8Array.of(0, 255, 128, 10))
    expect(result.files['scenarios/saved/configure.yml']).toContain('/tmp/old.bin')
  })

  it('preserves uploaded UTF-8 BOM/CRLF script bytes and existing content_ref files', () => {
    const project = fixture()
    const bytes = new TextEncoder().encode('\uFEFF#!/bin/sh\r\nprintf kept\r\n')
    project.files['old-script.sh'] = assetFromBytes(bytes)
    project.attachments[0].source = { kind: 'file_upload', content_ref: 'old-script.sh' }
    const result = review(project, { old: { kind: 'script' } })
    expect(fileBytes(result.files[`scenarios/saved/${result.scenario.content.at(-1).path}`])).toEqual(bytes)
    expect(result.files['old-script.sh']).toEqual(project.files['old-script.sh'])
  })

  it('keeps a full playbook BOM while validating and compiling its selected VM', () => {
    const project = fixture()
    const content = '\uFEFF- hosts: "{{ global_vm_ssh_name }}"\r\n  gather_facts: false\r\n  tasks: []\r\n'
    project.attachments[0].source.content_inline = content
    const result = review(project)
    expect(result.files[`scenarios/saved/${result.scenario.content.at(-1).path}`]).toBe(content)
  })

  it('expands migrated source-VM content onto every assigned instance without changing the roster', () => {
    const project = { ...replicatedScenario(), attachments: [attachment()] }
    const result = review(project)
    expect(result.scenario.replication).toEqual(project.scenario.replication)
    expect(result.scenario.content).toHaveLength(2)
    const imports = parse(result.files['scenarios/replicated/configure.yml']).filter(play => play['ansible.builtin.import_playbook'] === 'content/legacy-1.yml')
    expect(imports).toHaveLength(3)
    expect(new Set(imports.map(play => play.vars.global_vm_ssh_name)).size).toBe(3)
    expect(imports.every(play => play.vars.MESSAGE === 'kept')).toBe(true)
    expect(result.files['scenarios/replicated/content/legacy-1.tasks.yml']).toBe(tasks)
  })

  it.each([
    ['group inheritance', { scope: 'group_inherited' }, /scope|group/i],
    ['missing target', { target_node: 'missing' }, /target.*VM/i],
    ['custom stage', { stage: 'before-bootstrap' }, /stage/i],
    ['handler', { ansible_primitive: 'handler' }, /handler/i],
    ['handler namespace', { handler_namespace: 'service' }, /handler/i],
    ['catalog role', { source: { kind: 'catalog_role', ref: 'roles/x' } }, /bundle library/i],
    ['Git source', { source: { kind: 'external_git', url: 'https://example.test/repo', sha: 'a'.repeat(40) } }, /pinned.*file|Git/i],
    ['notify', { source: { kind: 'inline_yaml', content_inline: '- command: echo hi\n  notify: restart\n' } }, /handler|notify/i],
    ['delegation', { source: { kind: 'inline_yaml', content_inline: '- command: echo hi\n  delegate_to: localhost\n' } }, /delegat|target/i],
    ['connection variable', { source: { kind: 'inline_yaml', content_inline: '- command: echo hi\n  vars:\n    ansible_host: elsewhere\n' } }, /target|connection/i],
    ['legacy module namespace', { source: { kind: 'inline_yaml', content_inline: '- ansible.legacy.import_tasks: nearby.yml\n' } }, /dependenc|relative/i],
    ['included variables', { source: { kind: 'inline_yaml', content_inline: '- ansible.builtin.include_vars: nearby.yml\n' } }, /dependenc|relative/i],
    ['file lookup loop', { source: { kind: 'inline_yaml', content_inline: '- debug: msg=hi\n  with_file: nearby.txt\n' } }, /dependenc|lookup/i],
    ['relative dependency', { source: { kind: 'inline_yaml', content_inline: '- import_tasks: nearby.yml\n' } }, /dependenc|relative/i],
    ['bad base64', { source: { kind: 'file_upload', content_inline: '****' } }, /base64/i],
  ])('retains the whole original project for %s', (_, patch, error) => {
    const project = fixture(); Object.assign(project.attachments[0], patch)
    const original = JSON.stringify(project)
    expect(() => prepareAttachmentMigration({ project, scenario: project.scenario, nodes: project.nodes, choices: { old: { kind: 'file', destination: '/tmp/file' } } })).toThrow(error)
    expect(JSON.stringify(project)).toBe(original)
  })

  it('does not overwrite authored files or ignore conflicting inline/reference bytes', () => {
    const project = fixture()
    project.files['scenarios/saved/content/legacy-1.tasks.yml'] = 'unmanaged'
    expect(() => review(project)).toThrow(/exists|overwrite/i)
    delete project.files['scenarios/saved/content/legacy-1.tasks.yml']
    project.files['reference.yml'] = 'different'
    project.attachments[0].source.content_ref = 'reference.yml'
    expect(() => review(project)).toThrow(/different|conflict/i)
  })

  it('does not invent missing content from a file named undefined', () => {
    const project = fixture()
    project.attachments[0].source = { kind: 'inline_yaml' }
    project.files.undefined = tasks
    expect(() => review(project)).toThrow(/content is missing/)
  })

  it.each(['attachment', 'project'])('rejects a relative lookup in %s variables', location => {
    const project = fixture()
    if (location === 'attachment') project.attachments[0].vars.MESSAGE = "{{ lookup('file', 'nearby.txt') }}"
    else project.baseDoc.env.push({ name: 'TEMPLATE', default: "{{ lookup('file', 'nearby.txt') }}" })
    expect(() => review(project)).toThrow(/lookup|dependency/i)
  })

  it('rejects secret and reserved variables before producing an applicable result', () => {
    const project = fixture()
    project.attachments[0].vars = { VAULT_VALUE: 'must-not-publish' }
    expect(() => review(project)).toThrow(/secret variable/i)
    project.attachments[0].vars = { ansible_host: 'elsewhere' }
    expect(() => review(project)).toThrow(/reserved/i)
  })

  it('rejects stale reviews and keeps attachments/files/scenario together if storage fails', () => {
    const project = fixture()
    const result = review(project)
    const changed = structuredClone(project); changed.attachments[0].vars.MESSAGE = 'new'
    expect(() => reviewedScenarioUpdates(changed, result, changed.nodes, changed.edges)).toThrow(/changed.*review/i)
    const store = useProjectStore(); store.importProject(project, { generateNewId: false })
    const before = JSON.stringify(store.getProject(project.id))
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disk full') })
    try { expect(() => store.updateProject(project.id, reviewedScenarioUpdates(project, result, project.nodes, project.edges))).toThrow(/storage is full/) }
    finally { storage.mockRestore() }
    expect(JSON.stringify(store.getProject(project.id))).toBe(before)
  })

  it('reopens migrated authoring from Git and regenerates byte-identical files', async () => {
    const project = fixture()
    Object.assign(project, reviewedScenarioUpdates(project, review(project), project.nodes, project.edges))
    const files = buildProjectFiles(buildPushArgs(project, project.nodes, project.edges))
    getProvider.mockReturnValue({ listCommits: async () => [{ sha: 'c'.repeat(40) }], getFileContent: async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('missing'), { status: 404 })
      return { content: files[path], sha: 'blob' }
    } })
    useInventoryStore().addSource({ id: 'source', provider: 'github', base_url: 'https://github.com', repos: [], auth: { kind: 'none' } })
    const preview = await loadGitProject(project.git, [])
    expect(preview.authoring.status).toBe('structured')
    const restored = prepareGitProjectImport(preview)
    expect(restored.attachments).toEqual([])
    expect(restored.files).toEqual(project.files)
    expect(emitConcreteScenario({ ...restored, generatedPaths: restored.scenario_generated_paths }).files).toEqual(project.files)
  })
})
