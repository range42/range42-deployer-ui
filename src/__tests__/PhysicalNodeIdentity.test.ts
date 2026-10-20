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
beforeEach(() => { vi.clearAllMocks(); vi.mocked(backendRequest).mockReset(); connection.url = 'http://test'; connection.token = 'alpha' })

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

const capacitySnapshot = {
  target_host_id: 'host-a', observed_at: '2026-10-20T12:00:00+00:00',
  observation: {protocol: 'range42-capacity-observation-v1', node: {...review, supported_operations: ['inspect', 'capacity']},
    resources: {logical_cpus: 32, memory_total_mib: 65536, max_vcpus: 128, memory_reserve_mib: 16384,
      guests: [{vm_id: 45000, kind: 'qemu', state: 'stopped', template: false, resumable: true, vmgenid: review.boot_id,
        memory_mib: 57344, vcpus: 8, configuration_revision: 'f'.repeat(64)}],
      storage: [{storage: 'ceph-range', namespace: '', pool_id: '1'.repeat(64), cluster_id: '2'.repeat(64), rados_pool_id: 7, replicas: 3,
        logical_available_bytes: 3000000, cluster_raw_available_bytes: 9000000, potential_bytes: 1048576,
        volumes: [{volume: 'vm-45000-disk-0', size_bytes: 1048576}]}], execution_ready: false, infrastructure_qualified: false}},
  summary: {configured_memory_mib: 57344, memory_headroom_mib: -8192, configured_vcpus: 8, vcpu_headroom: 120,
    resumable_guests: 1, allocation_granted: false, execution_ready: false, infrastructure_qualified: false},
}

it('reads full configured resources and explains a deficit without granting deployment', async () => {
  vi.mocked(backendRequest).mockResolvedValueOnce(saved).mockResolvedValueOnce(capacitySnapshot)
  const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
  await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="read-physical-capacity"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/proxmox/hosts/host-a/physical-node/capacity/review', expect.objectContaining({method: 'POST', body: '{}'}))
  const report = view.get('[data-testid="physical-capacity-observation"]')
  expect(report.text()).toContain('8 GiB over the memory budget')
  expect(view.text()).toContain('Stopped guests retain their configured resources')
  expect(report.text()).toContain('No capacity has been reserved')
  expect(report.text()).toContain('45000')
  expect(report.get('[role="region"][aria-label="Guest resource commitments"]').attributes('tabindex')).toBe('0')
  view.unmount()
})

it.each(['target', 'physical-node', 'ready', 'optimistic-summary'])('refuses inconsistent capacity observations: %s', async damage => {
  const invalid = structuredClone(capacitySnapshot)
  if (damage === 'target') invalid.target_host_id = 'other'
  if (damage === 'physical-node') invalid.observation.node.physical_node_id = '9'.repeat(32)
  if (damage === 'ready') invalid.summary.allocation_granted = true
  if (damage === 'optimistic-summary') invalid.summary.memory_headroom_mib = 8192
  vi.mocked(backendRequest).mockResolvedValueOnce(saved).mockResolvedValueOnce(invalid)
  const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
  await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="read-physical-capacity"]').trigger('click'); await flushPromises()
  expect(view.find('[data-testid="physical-capacity-observation"]').exists()).toBe(false)
  expect(view.get('[data-testid="physical-capacity-error"]').text()).toContain('does not match')
  view.unmount()
})

it('clears resource evidence on refresh failure or a changed backend credential', async () => {
  vi.mocked(backendRequest).mockResolvedValueOnce(saved).mockResolvedValueOnce(capacitySnapshot).mockRejectedValueOnce(new Error('Inspector unavailable'))
  const view = mount(PhysicalNodeIdentity, {props: {hostId: 'host-a'}})
  await view.get('[data-testid="load-physical-node"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="read-physical-capacity"]').trigger('click'); await flushPromises()
  expect(view.find('[data-testid="physical-capacity-observation"]').exists()).toBe(true)
  await view.get('[data-testid="read-physical-capacity"]').trigger('click'); await flushPromises()
  expect(view.find('[data-testid="physical-capacity-observation"]').exists()).toBe(false)
  expect(view.get('[data-testid="physical-capacity-error"]').text()).toContain('Inspector unavailable')
  connection.token = 'changed'; await flushPromises()
  expect(view.find('[data-testid="read-physical-capacity"]').exists()).toBe(false)
  view.unmount()
})
