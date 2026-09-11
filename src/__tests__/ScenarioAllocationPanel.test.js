import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ScenarioAllocationPanel from '@/components/project/ScenarioAllocationPanel.vue'
import allocation from '@/locales/en/allocation.json'
import { useBackendApiStore } from '@/stores/backendApiStore'

const api = vi.hoisted(() => ({ request: vi.fn(), reserve: vi.fn(), restore: vi.fn(), release: vi.fn() }))
vi.mock('@/services/backendApi', async load => ({ ...await load(), backendRequest: api.request }))
vi.mock('@/services/scenarioAllocation', async load => ({ ...await load(), reserveScenarioAllocation: api.reserve, restoreScenarioAllocation: api.restore, releaseScenarioAllocation: api.release }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
enableAutoUnmount(afterEach)
const vms = [{ node_id: 'web', vm_name: 'Web', vm_id: '', nics: [{ network_id: 'blue', ip: '' }] }]
const networks = [{ id: 'blue', vnet: 'blue', subnet: '10.1.0.0/24', gateway: '10.1.0.1' }]
const result = () => ({ reservation_id: 'lease-1', project_key: 'project-1', host_id: 'pve-1', node_name: 'pve', expires_at: '2099-01-01T00:00:00Z', checked_at: '2026-09-10T00:00:00Z', limitations: ['Unmanaged static guests may not be visible.'], assignments: [
  { node_id: 'web', vm_id: 2000, nics: [{ index: 0, network_id: 'blue', bridge: 'blue', subnet: '10.1.0.0/24', ip: '10.1.0.2', prefix: 24 }] },
] })
function panel(props = {}) {
  setActivePinia(createPinia())
  return mount(ScenarioAllocationPanel, { props: { projectId: 'project-1', vms, networks, ...props },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { allocation } } })] } })
}
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks()
  api.request.mockResolvedValue({ items: [{ id: 'pve-1', name: 'Range42', node_name: 'pve' }], total: 1 })
  api.restore.mockResolvedValue(null); api.reserve.mockResolvedValue(result()); api.release.mockResolvedValue(undefined)
})
async function reserve(wrapper) { await flushPromises(); await wrapper.get('[data-testid="allocation-reserve"]').trigger('click'); await flushPromises() }

describe('scenario allocation review', () => {
  it('selects the only registered target and requires review before applying', async () => {
    const wrapper = panel()
    await reserve(wrapper)
    expect(api.reserve).toHaveBeenCalledWith({ projectKey: 'project-1', targetHostId: 'pve-1', vms, networks, vmidStart: 2000, vmidEnd: 8999 })
    expect(wrapper.text()).toContain('10.1.0.2')
    expect(wrapper.text()).toContain('Unmanaged static guests')
    expect(wrapper.emitted('reserved')).toBeUndefined()
    await wrapper.get('[data-testid="allocation-apply"]').trigger('click')
    expect(wrapper.emitted('reserved')[0][0]).toMatchObject({ reservation: result(), target_host_id: 'pve-1', backend_url: '', vms: [{ vm_id: 2000, nics: [{ ip: '10.1.0.2' }] }] })
    expect(JSON.stringify(wrapper.emitted('reserved'))).not.toContain('token')
  })
  it('restores a saved reservation on reopen without acquiring a second lease', async () => {
    api.restore.mockResolvedValue(result())
    const wrapper = panel({ targetHostId: 'pve-1' })
    await flushPromises()
    expect(api.restore).toHaveBeenCalledWith('project-1', 'pve-1')
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeUndefined()
    expect(api.reserve).not.toHaveBeenCalled()
  })
  it('blocks applying a reservation after the draft subnet changes', async () => {
    const wrapper = panel()
    await reserve(wrapper)
    await wrapper.setProps({ networks: [{ ...networks[0], subnet: '10.3.0.0/24' }] })
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('changed')
  })
  it('blocks an expired reservation and lets the same project reserve again', async () => {
    api.restore.mockResolvedValue({ ...result(), expires_at: '2000-01-01T00:00:00Z' })
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('expired')
    await reserve(wrapper)
    expect(wrapper.get('[data-testid="allocation-apply"]').attributes('disabled')).toBeUndefined()
  })
  it.each([
    ['ALLOCATION_PROTECTED', 'protected'], ['ALLOCATION_OCCUPIED', 'occupied'], ['ALLOCATION_POOL_EXHAUSTED', 'pool'],
    ['ALLOCATION_OCCUPANCY_UNAVAILABLE', 'occupancy'], ['ALLOCATION_OWNERSHIP', 'another browser'],
    ['ALLOCATION_BUSY', 'Retry'],
  ])('explains %s while preserving the entered draft', async (code, hint) => {
    api.reserve.mockRejectedValue(Object.assign(new Error('Target check failed'), { code }))
    const wrapper = panel()
    await reserve(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain(hint)
    expect(wrapper.get('[role="alert"]').text()).toContain('Target check failed')
    expect(wrapper.emitted('reserved')).toBeUndefined()
  })
  it('discards a pending reservation after the project changes', async () => {
    let finish
    api.reserve.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = panel()
    await reserve(wrapper)
    await wrapper.setProps({ projectId: 'project-2' })
    await flushPromises()
    finish(result()); await flushPromises()
    expect(wrapper.find('[data-testid="allocation-apply"]').exists()).toBe(false)
    expect(wrapper.emitted('reserved')).toBeUndefined()
  })
  it('releases explicitly and does not erase the caller VM rows', async () => {
    const wrapper = panel()
    await reserve(wrapper)
    await wrapper.get('[data-testid="allocation-release"]').trigger('click'); await flushPromises()
    expect(api.release).toHaveBeenCalledWith('project-1', 'pve-1', 'lease-1')
    expect(wrapper.find('[data-testid="allocation-apply"]').exists()).toBe(false)
    expect(wrapper.emitted('reserved')).toBeUndefined()
    expect(vms[0].vm_id).toBe('')
  })
  it('invalidates the old preview when renewal discovers a conflict', async () => {
    const wrapper = panel()
    await reserve(wrapper)
    api.reserve.mockRejectedValueOnce(Object.assign(new Error('Now occupied'), { code: 'ALLOCATION_OCCUPIED' }))
    await reserve(wrapper)
    expect(wrapper.find('[data-testid="allocation-apply"]').exists()).toBe(false)
  })
  it('reloads hosts after a backend token is supplied without reopening the panel', async () => {
    api.request.mockRejectedValueOnce(new Error('Authentication required'))
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Authentication required')
    useBackendApiStore().addHost({ url: '', token: 'new-backend-token' })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="allocation-reserve"]').attributes('disabled')).toBeUndefined()
  })
  it('shows the field and reason when a declared subnet fails backend validation', async () => {
    api.reserve.mockRejectedValueOnce(Object.assign(new Error('Request validation failed'), { code: 'VALIDATION', details: [{ field: 'body.networks.0.subnet', reason: 'Use a canonical IPv4 network' }] }))
    const wrapper = panel()
    await reserve(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('networks.0.subnet: Use a canonical IPv4 network')
  })
})
