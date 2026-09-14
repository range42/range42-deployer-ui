import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getConfig: vi.fn(), setTags: vi.fn(), setName: vi.fn(), setDescription: vi.fn(),
  setCpu: vi.fn(), setMemory: vi.fn(), stop: vi.fn(), start: vi.fn(),
}))
const context = vi.hoisted(() => ({ current: true }))
vi.mock('@/services/proxmox/api', () => ({ vm: api, captureBackendGuard: () => () => {
  if (!context.current) throw new Error('Backend context changed')
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
beforeEach(() => { vi.clearAllMocks(); context.current = true; api.getConfig.mockResolvedValue({ name: 'observed', cores: '3', memory: 1536, tags: 'actual;ops', description: 'on PVE' }) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('reviewing desired infrastructure changes', () => {
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
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    await flushPromises()
    expect(api.getConfig).toHaveBeenCalledWith(42, 'qemu', { node: 'pve-b' })
    expect(value.data.actualConfig).toEqual({ name: 'observed', cores: 3, memory: 1536, tags: ['actual', 'ops'], description: 'on PVE' })
    expect(value.data.desiredConfig).toEqual(desired)
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(wrapper.text()).toContain('Actual configuration refreshed')
  })

  it.each(['missing node', 'incomplete response', 'failed read'])('preserves observations and edits on %s', async problem => {
    const value = node()
    if (problem === 'missing node') value.data.config = {}
    if (problem === 'incomplete response') api.getConfig.mockResolvedValue({})
    if (problem === 'failed read') api.getConfig.mockRejectedValue(new Error('private upstream detail'))
    const before = structuredClone(value.data)
    const wrapper = dialog(value)
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    await flushPromises()
    expect(value.data).toEqual(before)
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(wrapper.text()).not.toContain('private upstream detail')
    if (problem === 'missing node') expect(api.getConfig).not.toHaveBeenCalled()
  })

  it.each(['node', 'backend', 'unmount'])('discards a late read after %s changes', async change => {
    let finish
    api.getConfig.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const value = node(); const before = structuredClone(value.data.actualConfig)
    const wrapper = dialog(value)
    await button(wrapper, 'Refresh actual configuration').trigger('click')
    if (change === 'node') await wrapper.setProps({ node: { ...node(), id: 'different' } })
    if (change === 'backend') context.current = false
    if (change === 'unmount') wrapper.unmount()
    finish({ name: 'late', cores: 9, memory: 9000 })
    await flushPromises()
    expect(value.data.actualConfig).toEqual(before)
    expect(wrapper.emitted('applied')).toBeUndefined()
  })
})
