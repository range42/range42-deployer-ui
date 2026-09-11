import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { assetFromBytes } from '@/services/projectFiles'
import FileAssetField from '@/components/project/FileAssetField.vue'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
enableAutoUnmount(afterEach)
const nodes = [{ id: 'vm', type: 'vm', data: { config: { name: 'guest' } } },
  { id: 'net', type: 'network-segment', data: { config: {} } }]
const edges = [{ source: 'vm', target: 'net' }]
function modal(overrides = {}) {
  return mount(ScenarioAuthoringModal, { props: { open: true, nodes, edges, project: {
    id: 'local-project', name: 'Demo', files: {}, scenario: { label: 'demo', network_mode: 'sdn', zone: 'r42lab',
      networks: [{ id: 'net', vnet: 'r42net1', subnet: '10.42.1.0/24', gateway: '10.42.1.1', snat: true }],
      vms: [{ node_id: 'vm', vm_id: 3101, vm_name: 'guest', template_vm_id: 9232, network_id: 'net', ip: '10.42.1.10', ssh_user: 'alice' }], content: [] },
    }, ...overrides }, global: { stubs: { teleport: true, BundleLibraryModal: true, ScenarioAllocationPanel: true, FocusTrap: { template: '<div><slot /></div>' } } } })
}

describe('scenario authoring review', () => {
  it('offers review of existing attachments without changing the project on open or cancel', async () => {
    const wrapper = modal()
    const project = JSON.parse(JSON.stringify(wrapper.props('project')))
    project.attachments = [{ id: 'legacy', target_node: 'vm', stage: 'main',
      source: { kind: 'inline_yaml', content_inline: '- ansible.builtin.debug:\n    msg: hello\n' } }]
    await wrapper.setProps({ open: false, project })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(wrapper.find('[data-testid="attachment-migration"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('legacy')
    expect(wrapper.emitted('generated')).toBeUndefined()
    await wrapper.get('[aria-label="Close scenario configuration"]').trigger('click')
    expect(project.attachments).toHaveLength(1)
    expect(project.scenario.content).toEqual([])
  })

  it('converts an attachment only in the reviewed complete candidate', async () => {
    const wrapper = modal()
    const project = JSON.parse(JSON.stringify(wrapper.props('project')))
    const text = '\uFEFF- ansible.builtin.debug:\r\n    msg: "{{ MESSAGE }}"\r\n'
    project.attachments = [{ id: 'old', target_node: 'vm', stage: 'main', vars: { MESSAGE: 'hello' }, source: { kind: 'inline_yaml', content_inline: text } }]
    await wrapper.setProps({ open: false, project }); await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.find('[data-testid="scenario-apply"]').exists()).toBe(false)
    await wrapper.get('[data-testid="migration-confirm"]').setValue(true)
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.get('[data-testid="migration-summary"]').text()).toContain('1 legacy attachments')
    expect(project.attachments).toHaveLength(1)
    expect(project.scenario.content).toEqual([])
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const result = wrapper.emitted('generated')[0][0]
    expect(result.attachments).toEqual([])
    expect(result.files['scenarios/demo/content/legacy-1.tasks.yml']).toBe(text)
    expect(result.scenario.content[0]).toMatchObject({ target_node: 'vm', vars: { MESSAGE: 'hello' } })
  })

  it('lets the user map a binary upload to a destination without re-encoding its bytes', async () => {
    const wrapper = modal()
    const project = JSON.parse(JSON.stringify(wrapper.props('project')))
    project.attachments = [{ id: 'upload', target_node: 'vm', stage: 'main', source: { kind: 'file_upload', content_inline: 'AP+ACg==' } }]
    await wrapper.setProps({ open: false, project }); await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="migration-kind"]').setValue('file')
    await wrapper.get('[data-testid="migration-destination"]').setValue('/tmp/data.bin')
    await wrapper.get('[data-testid="migration-confirm"]').setValue(true)
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    expect(wrapper.emitted('generated')[0][0].files['scenarios/demo/content/legacy-1.bin'].content).toBe('AP+ACg==')
  })

  it('keeps unsupported attachments and rejects changed projects after preview', async () => {
    const wrapper = modal()
    const project = JSON.parse(JSON.stringify(wrapper.props('project')))
    project.attachments = [{ id: 'group-role', target_node: 'vm', scope: 'group_inherited', stage: 'main', source: { kind: 'inline_yaml', content_inline: '- debug: msg=hi' } }]
    await wrapper.setProps({ open: false, project }); await wrapper.setProps({ open: true })
    expect(wrapper.get('[data-testid="migration-issue"]').text()).toContain('Group inheritance')
    await wrapper.get('[data-testid="migration-confirm"]').setValue(true)
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.emitted('generated')).toBeUndefined()
    expect(project.attachments).toHaveLength(1)
    const updated = JSON.parse(JSON.stringify(project)); updated.attachments = []
    await wrapper.setProps({ open: false, project: updated }); await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.setProps({ project: { ...updated, files: { 'new.txt': 'changed' } } })
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Project changed since review')
    expect(wrapper.emitted('generated')).toBeUndefined()
  })

  it('reviews an uploaded file as binary metadata and keeps its bytes when applying the scenario', async () => {
    const wrapper = modal()
    await wrapper.get('[data-testid="scenario-add-file"]').trigger('click')
    const asset = assetFromBytes(Uint8Array.of(0, 255, 128, 10))
    wrapper.findComponent(FileAssetField).vm.$emit('update:modelValue', asset)
    await flushPromises()
    await wrapper.get('[data-testid="content-destination"]').setValue('/tmp/fixture.bin')
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.text()).toContain('4 bytes')
    expect(wrapper.text()).not.toContain(asset.content)
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const result = wrapper.emitted('generated')[0][0]
    expect(result.files['scenarios/demo/content/file-1.txt']).toEqual(asset)
  })

  it('opens the verified bundle library instead of adding an unchecked bundle path', async () => {
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="scenario-add-bundle"]').trigger('click')
    const library = wrapper.findComponent({ name: 'BundleLibraryModal' })
    expect(library.props('open')).toBe(true)
    library.vm.$emit('selected', { id: 'resolved', kind: 'bundle', target_node: 'vm', path: 'generic/demo/main.yml', vars: { PORT: 80 },
      resolution: { source_sha: 'a'.repeat(40), runtime: { fingerprint: 'b'.repeat(64) } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="content-path"]').attributes('readonly')).toBeDefined()
    expect(wrapper.findComponent({ name: 'BundleLibraryModal' }).props('open')).toBe(false)
  })

  it('applies reviewed allocations and preserves their target without storing an ownership token', async () => {
    const wrapper = modal()
    await flushPromises()
    const panel = wrapper.getComponent({ name: 'ScenarioAllocationPanel' })
    expect(panel.props('projectId')).toBe('local-project')
    const vms = JSON.parse(JSON.stringify(panel.props('vms')))
    vms[0].vm_id = 3195
    vms[0].ip = '10.42.1.15'
    vms[0].nics[0].ip = '10.42.1.15'
    const reservation = { reservation_id: 'lease-one', expires_at: '2026-09-11T00:00:00Z', assignments: [] }
    panel.vm.$emit('reserved', { reservation, vms, target_host_id: 'host-one', backend_url: 'https://backend.test', token: 'never-persist-this' })
    await flushPromises()
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const generated = wrapper.emitted('generated')[0][0]
    expect(generated.scenario.allocation).toEqual({ reservation, target_host_id: 'host-one', backend_url: 'https://backend.test' })
    const manifest = JSON.parse(generated.files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.vms[0]).toMatchObject({ vm_id: 3195, ip: '10.42.1.15' })
    expect(JSON.stringify(generated)).not.toContain('never-persist-this')
  })

  it('lets an operator set VM resources before reviewing the generated plan', async () => {
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="scenario-vm-cores"]').setValue(4)
    await wrapper.get('[data-testid="scenario-vm-memory"]').setValue(4096)
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const manifest = JSON.parse(wrapper.emitted('generated')[0][0].files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.vms[0]).toMatchObject({ cores: 4, memory_mb: 4096, nics: [{ index: 0, ip: '10.42.1.10' }] })
  })
  it('reviews concrete files before applying them to the project', async () => {
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.text()).toContain('scenarios/demo/main.yml')
    expect(wrapper.text()).toContain('sdn_network.bootstrap')
    expect(wrapper.emitted('generated')).toBeUndefined()
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    expect(wrapper.emitted('generated')[0][0].scenario.label).toBe('demo')
    expect(wrapper.emitted('generated')[0][0].files['scenarios/demo/hosts.yml']).toContain('10.42.1.10')
  })

  it('authors a text file and executes it as a copy operation for the selected VM', async () => {
    const wrapper = modal()
    await wrapper.get('[data-testid="scenario-add-file"]').trigger('click')
    await wrapper.get('[data-testid="content-destination"]').setValue('/tmp/demo-message.txt')
    await wrapper.get('[data-testid="content-text"]').setValue('message authored in UI\n')
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const result = wrapper.emitted('generated')[0][0]
    expect(Object.values(result.files)).toContain('message authored in UI\n')
    expect(result.files['scenarios/demo/configure.yml']).toContain('/tmp/demo-message.txt')
  })

  it('shows unsupported canvas kinds and does not offer an executable preview', async () => {
    const wrapper = modal({ nodes: [{ ...nodes[0], type: 'docker' }, nodes[1]] })
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Unsupported canvas kind: docker')
    expect(wrapper.find('[data-testid="scenario-apply"]').exists()).toBe(false)
  })

  it('reviews explicit per-team assignments and keeps source forms when applying', async () => {
    const wrapper = modal({ edges: [{ id: 'edge-management', source: 'vm', target: 'net' }] })
    await flushPromises()
    await wrapper.get('[data-testid="replication-enable"]').setValue(true)
    await wrapper.get('[data-testid="replication-add-team"]').trigger('click')
    await wrapper.get('[data-testid="replication-add-team"]').trigger('click')
    await wrapper.get('[data-testid="replication-vm-scope-vm"]').setValue('per_team')
    await wrapper.get('[data-testid="replication-network-scope-net"]').setValue('per_team')
    await flushPromises()
    expect(wrapper.get('[data-testid="replication-counts"]').text()).toMatch(/2 VMs.*2 networks.*2 NICs/)
    expect(wrapper.findComponent({ name: 'ScenarioAllocationPanel' }).exists()).toBe(false)
    for (const [index, row] of wrapper.findAll('[data-testid="replication-network-assignment"]').entries()) {
      await row.get('[data-testid="replication-vnet"]').setValue(`team${index + 1}`)
      await row.get('[data-testid="replication-subnet"]').setValue(`10.42.${index + 20}.0/24`)
      await row.get('[data-testid="replication-gateway"]').setValue(`10.42.${index + 20}.1`)
    }
    for (const [index, row] of wrapper.findAll('[data-testid="replication-vm-assignment"]').entries()) {
      await row.get('[data-testid="replication-vmid"]').setValue(3301 + index)
      await row.get('[data-testid="replication-ip"]').setValue(`10.42.${index + 20}.10`)
    }
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const result = wrapper.emitted('generated')[0][0]
    expect(result.scenario.vms).toHaveLength(1)
    expect(result.scenario.replication.teams).toHaveLength(2)
    expect(JSON.parse(result.files['scenarios/demo/manifest/scenario_vms.json']).vms.map(vm => vm.vm_id)).toEqual([3301, 3302])
  })

})
