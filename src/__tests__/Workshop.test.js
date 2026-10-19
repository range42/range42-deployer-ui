import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Workshop from '@/views/Workshop.vue'
import { backendRequest } from '@/services/backendApi'
vi.mock('@/services/backendApi', () => ({ backendRequest: vi.fn(), backendBlob: vi.fn() }))
const roster = { id: 'native-friday', expires_at: '2026-10-23T18:00:00Z', operations: [], seats: [
  { username: 'user01', account_ready: true, key_ready: true, handout_ready: true,
    proxmox_address: '10.77.32.2', deployer_address: '10.77.32.3', deployment_id: 'seat-one',
    deployment_state: 'succeeded', devices: [{ id: 5, address: '100.80.0.5', online: true, name: 'laptop' }] },
] }
beforeEach(() => { vi.clearAllMocks(); backendRequest.mockResolvedValue(roster) })
describe('workshop administration', () => {
  it('shows per-seat readiness, instance links and verified devices without exposing credentials', async () => {
    const view = mount(Workshop, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(view.text()).toContain('user01')
    expect(view.text()).toContain('100.80.0.5')
    expect(view.find('a[href="https://10.77.32.2:8006"]').exists()).toBe(true)
    expect(view.text()).toContain('Download credentials')
    view.unmount()
  })
  it('enables only the observed online participant device and refreshes the operation status', async () => {
    const view = mount(Workshop, { global: { stubs: ['RouterLink'] } }); await flushPromises()
    backendRequest.mockResolvedValueOnce({ operation_id: 'bind-1', state: 'queued' }).mockResolvedValue(roster)
    await view.get('[data-testid="bind-user01-5"]').trigger('click'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'bind', username: 'user01', node_id: 5 }),
    }))
    view.unmount()
  })
  it('requires the selected seat name before dispatching a destructive reset', async () => {
    const view = mount(Workshop, { global: { stubs: ['RouterLink'] } }); await flushPromises()
    await view.get('[data-testid="reset-user01"]').trigger('click')
    const submit = view.get('[data-testid="confirm-destructive"]')
    expect(submit.attributes('disabled')).toBeDefined()
    await view.get('[data-testid="seat-confirmation"]').setValue('user02')
    expect(submit.attributes('disabled')).toBeDefined()
    await view.get('[data-testid="seat-confirmation"]').setValue('user01')
    backendRequest.mockResolvedValueOnce({ operation_id: 'reset-1', state: 'queued' }).mockResolvedValue(roster)
    await view.get('form').trigger('submit'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
      body: JSON.stringify({ action: 'reset', username: 'user01', confirmation: 'user01' }),
    }))
    view.unmount()
  })
})
