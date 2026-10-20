import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import PhysicalNodeIdentity from '@/components/settings/PhysicalNodeIdentity.vue'
import { backendRequest } from '@/services/backendApi'

const connection = reactive({url: 'http://test', token: 'alpha'})
vi.mock('@/stores/backendApiStore', () => ({useBackendApiStore: () => connection}))
vi.mock('@/services/backendApi', () => ({backendRequest: vi.fn(), getBackendScope: () => connection.url}))
const empty = {target_host_id: 'host-a', configuration_state: 'enrolled', binding: null, needs_review: true}
const review = {revision: 'r'.repeat(64).replaceAll('r', 'a'), target_host_id: 'host-a', physical_node_id: 'b'.repeat(32), node_name: 'pve-test',
  hardware_binding: 'c'.repeat(64), api_certificate_sha256: 'd'.repeat(64), node_certificate_sha256: 'e'.repeat(64), boot_id: '11111111-2222-4333-8444-555555555555',
  configuration_revision: 'e'.repeat(64), supported_operations: ['inspect'], execution_ready: false, infrastructure_qualified: false}
const binding = {...review, binding_recorded: true, live_verified: false, alias_count: 2, recorded_at: '2026-10-20T00:00:00+00:00'}
const saved = {...empty, binding, needs_review: false}
beforeEach(() => { vi.clearAllMocks(); connection.url = 'http://test'; connection.token = 'alpha' })

describe('physical node identity in environment setup', () => {
  it('loads only after a deliberate click and describes missing canonical enrollment', async () => {
    vi.mocked(backendRequest).mockResolvedValue({...empty, configuration_state: 'unavailable'})
    const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
    expect(backendRequest).not.toHaveBeenCalled()
    await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('not enrolled')
    expect(view.find('[data-testid="inspect-physical-node"]').exists()).toBe(false)
    expect(view.text()).toContain('capacity')
    view.unmount()
  })

  it('reviews actual server evidence and saves only its opaque revision', async () => {
    vi.mocked(backendRequest).mockResolvedValueOnce(empty).mockResolvedValueOnce(review).mockResolvedValueOnce(binding).mockResolvedValueOnce(saved)
    const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
    await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
    await view.get('[data-testid="inspect-physical-node"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('Verified SSH and HTTPS refer to this node')
    expect(view.text()).toContain(review.physical_node_id)
    await view.get('[data-testid="save-physical-node"]').trigger('click'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledWith('/v1/proxmox/hosts/host-a/physical-node/review', expect.objectContaining({method: 'POST', body: '{}'}))
    expect(backendRequest).toHaveBeenCalledWith('/v1/proxmox/hosts/host-a/physical-node', expect.objectContaining({method: 'POST', body: JSON.stringify({review_revision: review.revision})}))
    expect(view.text()).toContain('2 registered targets')
    expect(view.text()).toContain('Preparation and capacity admission are still required')
    expect(view.find('[data-testid="save-physical-node"]').exists()).toBe(false)
    view.unmount()
  })

  it.each([{...review, target_host_id: 'other'}, {...review, execution_ready: true}, {...review, infrastructure_qualified: true}, {...review, node_certificate_sha256: undefined}])('refuses inconsistent readiness or target proof', async bad => {
    vi.mocked(backendRequest).mockResolvedValueOnce(empty).mockResolvedValueOnce(bad)
    const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
    await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
    await view.get('[data-testid="inspect-physical-node"]').trigger('click'); await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('does not match')
    expect(view.find('[data-testid="save-physical-node"]').exists()).toBe(false)
    view.unmount()
  })

  it('refreshes a committed save after a lost reply and clears the old review', async () => {
    vi.mocked(backendRequest).mockResolvedValueOnce(empty).mockResolvedValueOnce(review).mockRejectedValueOnce(new Error('Reply lost')).mockResolvedValueOnce(saved)
    const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
    await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
    await view.get('[data-testid="inspect-physical-node"]').trigger('click'); await flushPromises()
    await view.get('[data-testid="save-physical-node"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain(binding.physical_node_id)
    expect(view.get('[role="alert"]').text()).toContain('Reply lost')
    expect(view.find('[data-testid="save-physical-node"]').exists()).toBe(false)
    expect(vi.mocked(backendRequest).mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(2)
    view.unmount()
  })

  it('drops a pending old-target reply after target or backend credentials change', async () => {
    let resolveEarlier!: (value: unknown) => void
    vi.mocked(backendRequest).mockImplementationOnce(() => new Promise(resolve => {resolveEarlier = resolve}))
    const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
    await view.get('[data-testid="load-physical-node"]').trigger('click')
    await view.setProps({hostId: 'host-b'}); connection.token = 'bravo'; await flushPromises()
    resolveEarlier(saved); await flushPromises()
    expect(view.text()).not.toContain(binding.physical_node_id)
    expect(view.find('[data-testid="save-physical-node"]').exists()).toBe(false)
    view.unmount()
  })
})
