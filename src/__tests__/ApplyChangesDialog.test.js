import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getConfig: vi.fn(), setTags: vi.fn(), setName: vi.fn(), setDescription: vi.fn(),
  setCpu: vi.fn(), setMemory: vi.fn(), stop: vi.fn(), start: vi.fn(),
  getConfigReview: vi.fn(), updateConfig: vi.fn(),
}))
const tasks = vi.hoisted(() => ({ getTaskStatus: vi.fn() }))
const context = vi.hoisted(() => ({ current: true, available: true }))
vi.mock('@/services/proxmox/api', () => ({ vm: api, ...tasks, captureBackendGuard: () => {
  if (!context.available) throw new Error('Ambiguous backend')
  return () => { if (!context.current) throw new Error('Backend context changed') }
} }))
import ApplyChangesDialog from '@/components/ApplyChangesDialog.vue'

function node() {
  return { id: 'canvas-42', type: 'vm', data: {
    type: 'vm', vmId: 42, status: 'running', config: { proxmoxNode: 'pve-b' },
    actualConfig: { name: 'old', cores: 2, memory: 1024, tags: [], description: '' },
    desiredConfig: { name: 'wanted', cores: 4, memory: 2048, tags: ['desired'], description: 'wanted description' },
  } }
}
const pending = [{ field: 'name', actual: 'old', desired: 'wanted', label: 'Name', category: 'live' }]
const button = (wrapper, label) => wrapper.findAll('button').find(item => item.text() === label)
const wrappers = []
function dialog(value = node()) { const wrapper = mount(ApplyChangesDialog, { props: { node: value, pendingChanges: pending } }); wrappers.push(wrapper); return wrapper }
beforeEach(() => { vi.clearAllMocks(); context.current = true; context.available = true; api.getConfig.mockResolvedValue({ name: 'observed', cores: '3', memory: 1536, tags: 'actual;ops', description: 'on PVE' }); api.getConfigReview.mockResolvedValue(configReview()); tasks.getTaskStatus.mockResolvedValue({ status: 'stopped', exitstatus: 'OK' }) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('reviewing desired infrastructure changes', () => {
  it('refreshes current RAM without treating configured pending RAM as actual', async () => {
    const value = node(), desired = structuredClone(value.data.desiredConfig), wrapper = dialog(value)
    const current = { ...configReview().current, memory: 1024 }
    api.getConfig.mockResolvedValue({ ...current, memory: 2048 }) // PVE default includes pending values.
    api.getConfigReview.mockResolvedValue(configReview({ current, configured: { ...current, memory: 2048 }, pending: ['memory'] }))
    await button(wrapper, 'Refresh actual configuration').trigger('click'); await flushPromises()
    expect(value.data.actualConfig.memory).toBe(1024)
    expect(value.data.desiredConfig).toEqual(desired)
    expect(api.getConfig).not.toHaveBeenCalled()
    expect(api.getConfigReview).toHaveBeenCalledWith(42, 'qemu', { node: 'pve-b' })
    expect(wrapper.text()).toContain('Pending in Proxmox: memory')
  })

  it('refuses partial current values even when configured values are complete', async () => {
    const value = node(), before = structuredClone(value.data), wrapper = dialog(value)
    api.getConfigReview.mockResolvedValue(configReview({ current: { ...configReview().current, memory: null } }))
    await button(wrapper, 'Refresh actual configuration').trigger('click'); await flushPromises()
    expect(value.data).toEqual(before)
    expect(wrapper.text()).toContain('Could not refresh')
    expect(wrapper.text()).not.toContain('Actual configuration refreshed')
  })

  it('refuses legacy Apply without writes, optimistic actual values or an applied event', async () => {
    const value = node(); const before = structuredClone(value.data)
    const wrapper = dialog(value)
    expect(wrapper.text()).toMatch(/host.bound|selected host|registered host/i)
    expect(button(wrapper, 'Apply Changes').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Apply Changes').trigger('click')
    await flushPromises()
    expect(Object.values(api).every(call => call.mock.calls.length === 0)).toBe(true)
    expect(value.data).toEqual(before)
    expect(wrapper.emitted('applied')).toBeUndefined()
  })

  it('refreshes only observed values for the exact selected guest and preserves desired edits', async () => {
    const value = node(); const desired = structuredClone(value.data.desiredConfig)
    const wrapper = dialog(value)
    api.getConfigReview.mockResolvedValue(configReview({ current: { name: 'observed', cores: 3, memory: 1536, tags: 'actual;ops', description: 'on PVE' } }))
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    await flushPromises()
    expect(api.getConfigReview).toHaveBeenCalledWith(42, 'qemu', { node: 'pve-b' })
    expect(value.data.actualConfig).toEqual({ name: 'observed', cores: 3, memory: 1536, tags: ['actual', 'ops'], description: 'on PVE' })
    expect(value.data.desiredConfig).toEqual(desired)
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(wrapper.text()).toContain('Actual configuration refreshed')
  })

  it.each(['missing node', 'incomplete response', 'failed read'])('preserves observations and edits on %s', async problem => {
    const value = node()
    if (problem === 'missing node') value.data.config = {}
    if (problem === 'incomplete response') api.getConfigReview.mockResolvedValue(configReview({ current: {} }))
    if (problem === 'failed read') api.getConfigReview.mockRejectedValue(new Error('private upstream detail'))
    const before = structuredClone(value.data)
    const wrapper = dialog(value)
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    await flushPromises()
    expect(value.data).toEqual(before)
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(wrapper.text()).not.toContain('private upstream detail')
    if (problem === 'missing node') expect(api.getConfigReview).not.toHaveBeenCalled()
  })

  it.each(['node', 'backend', 'unmount'])('discards a late read after %s changes', async change => {
    let finish
    api.getConfigReview.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const value = node(); const before = structuredClone(value.data.actualConfig)
    const wrapper = dialog(value)
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    if (change === 'node') await wrapper.setProps({ node: { ...node(), id: 'different' } })
    if (change === 'backend') context.current = false
    if (change === 'unmount') wrapper.unmount()
    finish(configReview({ current: { ...configReview().current, name: 'late', cores: 9, memory: 9000 } }))
    await flushPromises()
    expect(value.data.actualConfig).toEqual(before)
    expect(wrapper.emitted('applied')).toBeUndefined()
  })
})

function configReview(overrides = {}) {
  const current = { name: 'old', cores: 2, memory: 1024, tags: '', description: '' }
  return { host_id: 'selected', node: 'pve-b', vmid: 42, vmtype: 'qemu', digest: 'a'.repeat(64), target_digest: 'c'.repeat(64),
    current, configured: { ...current }, pending: [], ...overrides }
}
async function reviewChanges(wrapper) {
  expect(button(wrapper, 'Review changes')).toBeDefined()
  await button(wrapper, 'Review changes').trigger('click')
  await flushPromises()
}
describe('applying a fresh configuration review', () => {
  it('recovers from an unavailable backend context without leaving review busy', async () => {
    const wrapper = dialog()
    context.available = false
    await reviewChanges(wrapper)
    expect(api.getConfigReview).not.toHaveBeenCalled()
    expect(button(wrapper, 'Review changes').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Could not review')
    context.available = true
    await reviewChanges(wrapper)
    expect(button(wrapper, 'Apply Changes').attributes('disabled')).toBeUndefined()
  })

  it('keeps the explicit registered host when refreshing actual values', async () => {
    const value = node(); value.data.config.proxmoxHostId = 'selected'
    const wrapper = dialog(value)
    await button(wrapper, 'Refresh actual configuration').trigger('click'); await flushPromises()
    expect(api.getConfigReview).toHaveBeenCalledWith(42, 'qemu', { node: 'pve-b', hostId: 'selected' })
  })

  it('reviews fresh values and applies only the displayed supported change, without power actions', async () => {
    const value = node(), wrapper = dialog(value)
    await reviewChanges(wrapper)
    expect(api.getConfigReview).toHaveBeenCalledWith(42, 'qemu', { node: 'pve-b' })
    expect(button(wrapper, 'Apply Changes').attributes('disabled')).toBeUndefined()
    const observed = configReview({ current: { ...configReview().current, name: 'wanted' }, configured: { ...configReview().current, name: 'wanted' } })
    api.updateConfig.mockResolvedValue({ status: 'configured', upid: null, review: observed })
    await button(wrapper, 'Apply Changes').trigger('click'); await flushPromises()
    expect(api.updateConfig).toHaveBeenCalledWith(configReview(), { name: 'wanted' }, expect.any(Function))
    expect(value.data.actualConfig.name).toBe('wanted')
    expect(value.data.actualConfig.cores).toBe(2)
    expect(value.data.desiredConfig.cores).toBe(4)
    expect(wrapper.text()).toContain('Configuration verified')
    expect(api.start).not.toHaveBeenCalled(); expect(api.stop).not.toHaveBeenCalled()
    expect(api.setName).not.toHaveBeenCalled()
  })

  it('keeps queued resources separate from current values and does not submit them twice', async () => {
    const value = node(), wrapper = dialog(value)
    await wrapper.setProps({ pendingChanges: [{ field: 'memory', actual: 1024, desired: 2048, label: 'Memory', category: 'restart' }] })
    const queued = configReview({ configured: { ...configReview().current, memory: 2048 }, pending: ['memory'] })
    api.getConfigReview.mockResolvedValue(queued)
    await reviewChanges(wrapper)
    expect(wrapper.text()).toMatch(/pending|restart/i)
    expect(button(wrapper, 'Apply Changes').attributes('disabled')).toBeDefined()
    expect(value.data.actualConfig.memory).toBe(1024)
    expect(value.data.desiredConfig.memory).toBe(2048)
    expect(api.updateConfig).not.toHaveBeenCalled()
  })

  it.each(['desired', 'node', 'backend'])('invalidates review after %s changes before any write', async change => {
    const value = node(), wrapper = dialog(value)
    await reviewChanges(wrapper)
    if (change === 'desired') value.data.desiredConfig.name = 'changed'
    if (change === 'node') value.data.config.proxmoxNode = 'pve-c'
    if (change === 'backend') context.current = false
    await button(wrapper, 'Apply Changes').trigger('click'); await flushPromises()
    expect(api.updateConfig).not.toHaveBeenCalled()
  })

  it.each(['unconfirmed', 'failed', 'mismatched readback'])('preserves desired edits and refuses success for %s', async result => {
    const value = node(), before = structuredClone(value.data), wrapper = dialog(value)
    await reviewChanges(wrapper)
    if (result === 'failed') api.updateConfig.mockRejectedValue(new Error('private credential detail'))
    else api.updateConfig.mockResolvedValue({ status: result === 'unconfirmed' ? 'unconfirmed' : 'configured', upid: null, review: result === 'unconfirmed' ? null : configReview() })
    await button(wrapper, 'Apply Changes').trigger('click'); await flushPromises()
    expect(value.data).toEqual(before)
    expect(wrapper.text()).not.toContain('Configuration verified')
    expect(wrapper.text()).not.toContain('private credential detail')
    expect(wrapper.text()).toMatch(/unconfirmed|could not|not confirmed/i)
    expect(button(wrapper, 'Apply Changes').attributes('disabled')).toBeDefined()
  })

  it('checks a successful asynchronous task and fresh readback on the reviewed host', async () => {
    const value = node(), wrapper = dialog(value)
    await reviewChanges(wrapper)
    api.updateConfig.mockResolvedValue({ status: 'accepted', upid: 'UPID:pve-b:1', review: null })
    api.getConfigReview.mockResolvedValue(configReview({ current: { ...configReview().current, name: 'wanted' }, configured: { ...configReview().current, name: 'wanted' } }))
    await button(wrapper, 'Apply Changes').trigger('click'); await flushPromises()
    expect(tasks.getTaskStatus).toHaveBeenCalledWith('UPID:pve-b:1', { node: 'pve-b', hostId: 'selected' }, 'c'.repeat(64))
    expect(api.getConfigReview).toHaveBeenLastCalledWith(42, 'qemu', { node: 'pve-b', hostId: 'selected' })
    expect(value.data.actualConfig.name).toBe('wanted')
    expect(wrapper.text()).toContain('Configuration verified')
  })

  it('discards a late write result after closing the dialog', async () => {
    const value = node(), before = structuredClone(value.data), wrapper = dialog(value)
    await reviewChanges(wrapper)
    let resolve
    api.updateConfig.mockReturnValue(new Promise(done => { resolve = done }))
    await button(wrapper, 'Apply Changes').trigger('click')
    wrapper.unmount()
    resolve({ status: 'configured', upid: null, review: configReview({ current: { ...configReview().current, name: 'wanted' }, configured: { ...configReview().current, name: 'wanted' } }) })
    await flushPromises()
    expect(value.data).toEqual(before)
  })

  it('refuses asynchronous completion after the registered Proxmox server changes', async () => {
    const value = node(), before = structuredClone(value.data), wrapper = dialog(value)
    await reviewChanges(wrapper)
    api.updateConfig.mockResolvedValue({ status: 'accepted', upid: 'UPID:pve-b:1', review: null })
    api.getConfigReview.mockResolvedValue(configReview({ target_digest: 'd'.repeat(64), configured: { ...configReview().current, name: 'wanted' }, current: { ...configReview().current, name: 'wanted' } }))
    await button(wrapper, 'Apply Changes').trigger('click'); await flushPromises()
    expect(value.data).toEqual(before)
    expect(wrapper.text()).toContain('unconfirmed')
    expect(wrapper.text()).not.toContain('Configuration verified')
  })
})
