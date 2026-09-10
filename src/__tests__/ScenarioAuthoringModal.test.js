import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
enableAutoUnmount(afterEach)
const nodes = [{ id: 'vm', type: 'vm', data: { config: { name: 'guest' } } },
  { id: 'net', type: 'network-segment', data: { config: {} } }]
const edges = [{ source: 'vm', target: 'net' }]
function modal(overrides = {}) {
  return mount(ScenarioAuthoringModal, { props: { open: true, nodes, edges, project: {
    name: 'Demo', files: {}, scenario: { label: 'demo', network_mode: 'sdn', zone: 'r42lab',
      networks: [{ id: 'net', vnet: 'r42net1', subnet: '10.42.1.0/24', gateway: '10.42.1.1', snat: true }],
      vms: [{ node_id: 'vm', vm_id: 3101, vm_name: 'guest', template_vm_id: 9232, network_id: 'net', ip: '10.42.1.10', ssh_user: 'alice' }], content: [] },
    }, ...overrides }, global: { stubs: { teleport: true, FocusTrap: { template: '<div><slot /></div>' } } } })
}

describe('scenario authoring review', () => {
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
})
