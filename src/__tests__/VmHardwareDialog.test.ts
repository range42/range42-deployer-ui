import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getHardwareReview: vi.fn(), updateHardwareNic: vi.fn(), growHardwareDisk: vi.fn() }))
const context = vi.hoisted(() => ({ valid: true, task: vi.fn() }))
vi.mock('@/services/proxmox/api', () => ({ vm: api, getTaskStatus: context.task, captureBackendGuard: () => () => {
  if (!context.valid) throw new Error('Backend context changed')
} }))
import VmHardwareDialog from '@/components/VmHardwareDialog.vue'

enableAutoUnmount(afterEach)
const target = { hostId: 'selected', node: 'pve-b', vmid: 60001 }
function review() {
  const values = { nics: [{ id: 'net0', model: 'virtio', mac: '52:54:00:00:00:01', bridge: 'vmbr0', tag: 5, firewall: false, link_down: false, editable: true }],
    disks: [{ id: 'scsi0', size_bytes: 16 * 1024 ** 3, pool: 'local-lvm', volume_fingerprint: 'c'.repeat(64), editable: true }] }
  return { host_id: 'selected', node: 'pve-b', vmid: 60001, vmtype: 'qemu', digest: 'a'.repeat(64), target_digest: 'b'.repeat(64),
    current: structuredClone(values), configured: structuredClone(values), pending: [] as string[] }
}
async function dialog() { const wrapper = mount(VmHardwareDialog, { props: { target }, global: { stubs: { teleport: true } } }); await flushPromises(); return wrapper }
beforeEach(() => {
  vi.clearAllMocks(); context.valid = true
  api.getHardwareReview.mockResolvedValue(review())
  context.task.mockResolvedValue({ status: 'stopped', exitstatus: 'OK' })
})

describe('imported hardware review', () => {
  it('retains the same target observation across parent object replacements', async () => {
    const wrapper = await dialog()
    await wrapper.setProps({ target: { ...target } })
    expect(wrapper.find('[data-testid="hardware-bridge"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('selected guest changed')
  })
  it('sends only a reviewed NIC patch and waits for task plus configured readback', async () => {
    const wrapper = await dialog()
    await wrapper.get('[data-testid="hardware-bridge"]').setValue('vmbr1')
    expect(api.updateHardwareNic).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="hardware-review"]').trigger('click'); await flushPromises()
    const after = review(); after.digest = 'd'.repeat(64); after.configured.nics[0].bridge = 'vmbr1'; after.pending = ['net0']
    api.updateHardwareNic.mockResolvedValue({ status: 'accepted', upid: 'UPID:pve-b:1:2:3:qmconfig:60001:user@pam:', review: null })
    api.getHardwareReview.mockResolvedValue(after)
    await wrapper.get('[data-testid="hardware-apply"]').trigger('click'); await flushPromises()
    expect(api.updateHardwareNic).toHaveBeenCalledTimes(1)
    expect(api.updateHardwareNic.mock.calls[0].slice(1, 3)).toEqual(['net0', { bridge: 'vmbr1' }])
    expect(context.task).toHaveBeenCalledWith(expect.any(String), { hostId: 'selected', node: 'pve-b' }, 'b'.repeat(64))
    expect(wrapper.text()).toContain('pending')
    expect(wrapper.text()).not.toContain('hotplug succeeded')
  })
  it('reviews growth as an absolute size and verifies the same disk volume', async () => {
    const wrapper = await dialog()
    await wrapper.get('[data-testid="hardware-kind"]').setValue('disk')
    await wrapper.get('[data-testid="hardware-size"]').setValue(24)
    await wrapper.get('[data-testid="hardware-review"]').trigger('click'); await flushPromises()
    const after = review(); after.configured.disks[0].size_bytes = 24 * 1024 ** 3; after.current = structuredClone(after.configured)
    api.growHardwareDisk.mockResolvedValue({ status: 'configured', upid: null, review: after })
    await wrapper.get('[data-testid="hardware-apply"]').trigger('click'); await flushPromises()
    expect(api.growHardwareDisk).toHaveBeenCalledTimes(1)
    expect(api.growHardwareDisk.mock.calls[0].slice(1, 3)).toEqual(['scsi0', 24])
    expect(wrapper.text()).toContain('filesystem')
  })
  it.each(['credential', 'target', 'draft'])('invalidates a prepared review after %s changes', async kind => {
    const wrapper = await dialog()
    await wrapper.get('[data-testid="hardware-bridge"]').setValue('vmbr1')
    await wrapper.get('[data-testid="hardware-review"]').trigger('click'); await flushPromises()
    if (kind === 'credential') context.valid = false
    else if (kind === 'target') await wrapper.setProps({ target: { ...target, vmid: 60002 } })
    else await wrapper.get('[data-testid="hardware-bridge"]').setValue('vmbr2')
    const button = wrapper.find('[data-testid="hardware-apply"]')
    if (button.exists()) await button.trigger('click')
    await flushPromises()
    expect(api.updateHardwareNic).not.toHaveBeenCalled()
    expect(api.growHardwareDisk).not.toHaveBeenCalled()
  })
  it('refuses stale configuration during review and preserves typed intent', async () => {
    const wrapper = await dialog()
    await wrapper.get('[data-testid="hardware-bridge"]').setValue('vmbr1')
    const changed = review(); changed.digest = 'd'.repeat(64)
    api.getHardwareReview.mockResolvedValue(changed)
    await wrapper.get('[data-testid="hardware-review"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toMatch(/changed|stale/i)
    expect((wrapper.get('[data-testid="hardware-bridge"]').element as HTMLInputElement).value).toBe('vmbr1')
    expect(api.updateHardwareNic).not.toHaveBeenCalled()
  })
  it('keeps an ambiguous write unconfirmed and never retries it automatically', async () => {
    const wrapper = await dialog()
    await wrapper.get('[data-testid="hardware-bridge"]').setValue('vmbr1')
    await wrapper.get('[data-testid="hardware-review"]').trigger('click'); await flushPromises()
    api.updateHardwareNic.mockResolvedValue({ status: 'unconfirmed', upid: null, review: null })
    await wrapper.get('[data-testid="hardware-apply"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('unconfirmed')
    expect(api.updateHardwareNic).toHaveBeenCalledTimes(1)
    expect((wrapper.get('[data-testid="hardware-bridge"]').element as HTMLInputElement).value).toBe('vmbr1')
  })
})
