import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'
import ScenarioAllocationPanel from '@/components/project/ScenarioAllocationPanel.vue'
import allocation from '@/locales/en/allocation.json'
import { replicatedScenario } from './fixtures/replicatedScenario'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/services/backendApi', async load => ({ ...await load(), backendRequest: api.request }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
enableAutoUnmount(afterEach)
afterEach(() => { document.body.innerHTML = '' })

function result(body) {
  return { reservation_id: 'replica-lease', project_key: body.project_key, host_id: 'pve-1', node_name: 'pve',
    expires_at: '2099-01-01T00:00:00Z', checked_at: '2026-09-11T00:00:00Z', limitations: ['Static guest addresses may be invisible.'],
    assignments: body.vms.map((vm, vmIndex) => ({ node_id: vm.node_id, vm_id: vm.vm_id || 3401 + vmIndex,
      nics: vm.nics.map(nic => {
        const network = body.networks.find(network => network.network_id === nic.network_id)
        return { ...nic, bridge: network.bridge, subnet: network.subnet, gateway: network.gateway, prefix: 24,
          ip: nic.ip || network.gateway.replace(/1$/, String(20 + vmIndex)) }
      }),
    })),
  }
}
function fixture(shared = false) {
  const values = replicatedScenario()
  for (const row of Object.values(values.scenario.replication.vm_assignments)) {
    row.vm_id = ''
    row.nics['nic-primary'].ip = ''
  }
  if (shared) {
    values.scenario.replication.node_scopes.vm1 = 'shared'
    values.scenario.replication.network_scopes.net1 = 'shared'
    values.scenario.vms[0].vm_id = ''
    values.scenario.vms[0].nics[0].ip = ''
  }
  return values
}
function modal(values = fixture()) {
  const root = mount(ScenarioAuthoringModal, { attachTo: document.body, props: { open: true, nodes: values.nodes, edges: values.edges,
    project: { id: 'course-project', name: 'Course', scenario: values.scenario, files: values.files } },
  global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: { allocation } } })],
    stubs: { teleport: false, BundleLibraryModal: true, FocusTrap: { template: '<div><slot /></div>' } } } })
  const dom = new DOMWrapper(document.body)
  return {
    get: dom.get.bind(dom), find: dom.find.bind(dom), findAll: dom.findAll.bind(dom), text: dom.text.bind(dom),
    getComponent: root.getComponent.bind(root), findComponent: root.findComponent.bind(root), emitted: root.emitted.bind(root),
  }
}
function post() { return api.request.mock.calls.find(([, options]) => options?.method === 'POST') }
async function reserve(wrapper) {
  await flushPromises()
  await wrapper.get('[data-testid="allocation-reserve"]').trigger('click')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  api.request.mockReset().mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return result(JSON.parse(options.body))
    if (path.startsWith('/v1/proxmox/hosts?')) return { items: [{ id: 'pve-1', node_name: 'pve' }], total: 1 }
    throw new Error(`Unexpected backend request: ${path}`)
  })
})

describe('replicated authoring allocation integration', () => {
  it.each([false, true])('reserves literal instances and preserves source authoring when shared=%s', async shared => {
    const values = fixture(shared)
    const before = JSON.stringify(values)
    const wrapper = modal(values)
    await reserve(wrapper)
    const [, options] = post()
    const body = JSON.parse(options.body)
    expect(body.vms).toHaveLength(shared ? 1 : 3)
    expect(body.networks).toHaveLength(shared ? 1 : 2)
    expect(body.vms.every(vm => vm.node_id.startsWith('vm-') && vm.nics[0].nic_key === 'nic-primary')).toBe(true)
    expect(body.vms.every(vm => !Object.hasOwn(vm, 'vm_id'))).toBe(true)
    expect(wrapper.get('[data-testid="replication-allocation-counts"]').text()).toContain(`${body.vms.length} literal VMs`)
    expect(wrapper.text()).toContain('Static guest addresses may be invisible.')
    expect(wrapper.emitted('generated')).toBeUndefined()
    await wrapper.get('[data-testid="allocation-apply"]').trigger('click')
    await flushPromises()
    expect(api.request.mock.calls.map(([path]) => path)).toHaveLength(2)
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="scenario-review"]').trigger('click')
    await wrapper.get('[data-testid="scenario-apply"]').trigger('click')
    const generated = wrapper.emitted('generated')[0][0]
    expect(generated.scenario.vms).toHaveLength(1)
    expect(generated.scenario.vms[0].node_id).toBe('vm1')
    expect(generated.scenario.vms[0].vm_id).toBe(shared ? 3401 : 3100)
    expect(generated.scenario.vms[0].nics[0].network_id).toBe('net1')
    expect(generated.scenario.replication.teams).toEqual(values.scenario.replication.teams)
    expect(generated.scenario.replication.network_assignments).toEqual(values.scenario.replication.network_assignments)
    expect(generated.scenario.replication.vm_assignments[body.vms[0].node_id]).toMatchObject({ vm_id: 3401 })
    expect(generated.scenario.allocation).toMatchObject({ target_host_id: 'pve-1', reservation: { reservation_id: 'replica-lease' } })
    expect(JSON.parse(generated.files['scenarios/replicated/manifest/scenario_vms.json']).vms.map(vm => vm.vm_id)).toEqual(shared ? [3401] : [3401, 3402, 3403])
    expect(JSON.stringify(generated)).not.toContain(options.headers['X-Range42-Reservation-Token'])
    expect(JSON.stringify(values)).toBe(before)
  })

  it('explains incomplete instance subnets and only offers allocation after they are completed', async () => {
    const values = fixture()
    Object.values(values.scenario.replication.network_assignments)[0].subnet = ''
    const wrapper = modal(values)
    await flushPromises()
    expect(wrapper.findComponent(ScenarioAllocationPanel).exists()).toBe(false)
    expect(wrapper.get('[data-testid="replication-allocation-error"]').text()).toMatch(/Complete.*subnet.*gateway/i)
    expect(post()).toBeUndefined()
    await wrapper.findAll('[data-testid="replication-subnet"]')[0].setValue('10.42.10.0/24')
    await flushPromises()
    expect(wrapper.find('[data-testid="replication-allocation-error"]').exists()).toBe(false)
    expect(wrapper.getComponent(ScenarioAllocationPanel).props('vms')).toHaveLength(3)
    expect(post()).toBeUndefined()
  })

  it('blocks a pending mapping after a manual instance address changes', async () => {
    let finish
    const wrapper = modal()
    await flushPromises()
    api.request.mockImplementationOnce((path, options) => new Promise(resolve => { finish = () => resolve(result(JSON.parse(options.body))) }))
    await reserve(wrapper)
    await wrapper.findAll('[data-testid="replication-ip"]')[0].setValue('10.42.10.88')
    finish()
    await flushPromises()
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('draft changed')
    expect(wrapper.findAll('[data-testid="replication-ip"]')[0].element.value).toBe('10.42.10.88')
    expect(wrapper.emitted('generated')).toBeUndefined()
  })

  it('rechecks a stale child event against the current roster before changing source forms', async () => {
    const wrapper = modal()
    await reserve(wrapper)
    const reservation = result(JSON.parse(post()[1].body))
    await wrapper.findAll('[data-testid="replication-team"]')[0].findAll('button').find(button => button.text() === 'Remove team').trigger('click')
    await flushPromises()
    wrapper.getComponent(ScenarioAllocationPanel).vm.$emit('reserved', { reservation, vms: reservation.assignments,
      target_host_id: 'pve-1', backend_url: '' })
    await flushPromises()
    expect(wrapper.findAll('[role="alert"]').some(alert => /Assignments no longer match/.test(alert.text()))).toBe(true)
    expect(wrapper.findAll('[data-testid="replication-vmid"]').map(input => input.element.value)).toEqual([''])
    expect(wrapper.emitted('generated')).toBeUndefined()
  })
})
