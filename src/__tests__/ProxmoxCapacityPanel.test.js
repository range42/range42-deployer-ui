import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProxmoxCapacityPanel from '@/components/proxmox/ProxmoxCapacityPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

enableAutoUnmount(afterEach)
const gib = 1024 ** 3
const report = (host = 'pve-1', node = 'pve01') => ({ host_id: host, node_name: node, observed_at: '2026-09-10T12:00:00Z', status: 'available',
  cpu: { logical_cpus: 8, utilization: 0.25 }, memory: { total_bytes: 16 * gib, used_bytes: 4 * gib, free_bytes: 12 * gib },
  storage: [{ storage: 'local-lvm', type: 'lvmthin', content: ['images'], enabled: true, active: true, shared: false,
    total_bytes: 100 * gib, used_bytes: 25 * gib, free_bytes: 75 * gib }], issues: [], limitations: ['Measurements are not reservations.'] })
const host = (id = 'pve-1', node = 'pve01') => ({ id, name: `Target ${id}`, node_name: node, api_url: 'https://pve.test:8006' })
const response = body => new Response(JSON.stringify(body))
let backend, first, second, fetchMock
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); backend = useBackendApiStore()
  first = backend.addHost({ url: 'https://first.test', token: 'first-token' })
  second = backend.addHost({ url: 'https://second.test', token: 'second-token' })
  fetchMock = vi.fn(async url => response(String(url).includes('/capacity') ? report() : { items: [host()], total: 1 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const show = props => mount(ProxmoxCapacityPanel, { props: { backendId: first, nodeName: 'pve01', ...props } })
async function refresh(wrapper) { await wrapper.get('[data-testid="capacity-refresh"]').trigger('click'); await flushPromises() }

describe('measured Proxmox capacity panel', () => {
  it('loads on request, names its backend/target, and refreshes measured values', async () => {
    const wrapper = show()
    expect(fetchMock).not.toHaveBeenCalled()
    await refresh(wrapper)
    expect(wrapper.text()).toContain('https://first.test')
    expect(wrapper.text()).toContain('pve01')
    expect(wrapper.text()).toContain('8 logical CPUs')
    expect(wrapper.text()).toContain('25%')
    expect(wrapper.text()).toContain('12 GiB')
    expect(wrapper.text()).toContain('75 GiB')
    expect(wrapper.text()).toContain('exclusive free cores')
    expect(wrapper.text()).toContain('Measurements are not reservations')
    await refresh(wrapper)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
  it('shows partial and unavailable readings with explicit unknown values and issues', async () => {
    fetchMock.mockImplementation(async url => response(String(url).includes('/capacity') ? { ...report(), status: 'partial',
      cpu: { logical_cpus: null, utilization: null }, memory: { total_bytes: null, used_bytes: null, free_bytes: 0 }, storage: [],
      issues: [{ code: 'NODE_CAPACITY_UNAVAILABLE', resource: 'node', message: 'Check Sys.Audit permissions.' }] } : { items: [host()], total: 1 }))
    const wrapper = show()
    await refresh(wrapper)
    expect(wrapper.text()).toContain('Partial measurements')
    expect(wrapper.text()).toContain('Unknown')
    expect(wrapper.text()).toContain('0 B')
    expect(wrapper.text()).toContain('Check Sys.Audit permissions.')
    expect(wrapper.text()).toContain('No storage pools')
  })
  it('requires an explicit selection when several registered targets match the node', async () => {
    fetchMock.mockImplementation(async url => response(String(url).includes('/capacity') ? report('pve-2') : { items: [host(), host('pve-2')], total: 2 }))
    const wrapper = show()
    await refresh(wrapper)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="capacity-target"]').setValue('pve-2')
    await flushPromises()
    expect(fetchMock.mock.calls[1][0]).toContain('/hosts/pve-2/capacity')
  })
  it.each(['backend', 'token', 'node', 'url'])('clears existing readings when the %s context changes', async context => {
    const wrapper = show()
    await refresh(wrapper)
    if (context === 'backend') await wrapper.setProps({ backendId: second })
    else if (context === 'node') await wrapper.setProps({ nodeName: 'pve02' })
    else if (context === 'url') backend.updateHost(first, { url: 'https://replacement.test' })
    else backend.updateHost(first, { token: 'rotated' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('75 GiB')
    expect(wrapper.find('[data-testid="capacity-target"]').exists()).toBe(false)
  })
  it('ignores a late response after switching backend and aborts the old request', async () => {
    let resolve
    fetchMock.mockImplementationOnce(async () => response({ items: [host()], total: 1 }))
      .mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const wrapper = show()
    await refresh(wrapper)
    const oldSignal = fetchMock.mock.calls[1][1].signal
    await wrapper.setProps({ backendId: second })
    resolve(response(report()))
    await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    expect(wrapper.text()).not.toContain('75 GiB')
    expect(wrapper.text()).toContain('https://second.test')
  })
  it('does not request capacity for an unregistered URL or an unmatched node', async () => {
    const missing = show({ backendId: '' })
    expect(missing.get('[data-testid="capacity-refresh"]').attributes('disabled')).toBeDefined()
    const wrapper = show({ nodeName: 'other' })
    await refresh(wrapper)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('No registered Proxmox target matches')
  })
  it('discards a late response when a different target is selected', async () => {
    let finishOld
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('/pve-1/capacity')) return new Promise(done => { finishOld = done })
      return response(String(url).includes('/capacity') ? { ...report('pve-2'), cpu: { logical_cpus: 16, utilization: 0 } }
        : { items: [host(), host('pve-2')], total: 2 })
    })
    const wrapper = show()
    await refresh(wrapper)
    await wrapper.get('[data-testid="capacity-target"]').setValue('pve-1')
    await flushPromises()
    const oldSignal = fetchMock.mock.calls[1][1].signal
    await wrapper.get('[data-testid="capacity-target"]').setValue('pve-2')
    await flushPromises()
    finishOld(response(report()))
    await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    expect(wrapper.text()).toContain('16 logical CPUs')
    expect(wrapper.text()).not.toContain('8 logical CPUs')
  })
  it('clears stale readings on refresh failure and never silently switches a removed target', async () => {
    const wrapper = show()
    await refresh(wrapper)
    fetchMock.mockRejectedValueOnce(new TypeError('network failure'))
    await refresh(wrapper)
    expect(wrapper.text()).not.toContain('75 GiB')
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be reached')
    fetchMock.mockImplementation(async () => response({ items: [host('replacement')], total: 1 }))
    const before = fetchMock.mock.calls.length
    await refresh(wrapper)
    expect(fetchMock).toHaveBeenCalledTimes(before + 1)
    expect(wrapper.get('[data-testid="capacity-target"]').element.value).toBe('')
    expect(wrapper.get('[role="alert"]').text()).toContain('previously selected target')
  })
  it('aborts in-flight work on unmount', async () => {
    let finish
    fetchMock.mockImplementationOnce(() => new Promise(done => { finish = done }))
    const wrapper = show()
    await refresh(wrapper)
    const signal = fetchMock.mock.calls[0][1].signal
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    finish(response({ items: [host()], total: 1 }))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
