import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, type Component } from 'vue'
import { backendRequest } from '@/services/backendApi'

const connection = reactive({url: 'http://test', token: 'alpha', activeHost: {id: 'first'}})
vi.mock('@/stores/backendApiStore', () => ({useBackendApiStore: () => connection}))
vi.mock('@/services/backendApi', () => ({backendRequest: vi.fn(), getBackendScope: () => connection.url}))
const modules = import.meta.glob<{default: Component}>('../components/deployment/DeploymentCapacity.vue')
const empty = {deployment_id: 'run', applicable: true, hold: null, live_verified: false, execution_ready: false, infrastructure_qualified: false}
const storage = {pool_id: '1'.repeat(64), cluster_id: '2'.repeat(64), namespace: '', replicas: 3, logical_bytes: 160 * 2 ** 30}
const requirements = [{vm_id: 46000, memory_mib: 16384, vcpus: 4, storage: [storage], materialization: null},
  {vm_id: 46001, memory_mib: 4096, vcpus: 2, storage: [{...storage, logical_bytes: 32 * 2 ** 30}], materialization: null}]
const review = {deployment_id: 'run', review_revision: '3'.repeat(64), physical_node_id: 'a'.repeat(32), node_name: 'pve-test', observed_at: '2026-10-20T12:00:00+00:00',
  requirements, resources: {logical_cpus: 32, memory_total_mib: 65536, memory_reserve_mib: 16384, max_vcpus: 128},
  assessment: {admissible: true, memory_headroom_mib: 12288, vcpu_headroom: 114, pools: {['1'.repeat(64)]: {cluster_id: '2'.repeat(64), replicas: 3, available_bytes: 300 * 2 ** 30, potential_bytes: 64 * 2 ** 30, held_bytes: 192 * 2 ** 30, logical_headroom_bytes: 44 * 2 ** 30}}, clusters: {['2'.repeat(64)]: {available_bytes: 900 * 2 ** 30, potential_bytes: 192 * 2 ** 30, held_bytes: 576 * 2 ** 30, raw_headroom_bytes: 132 * 2 ** 30}}, blocking_codes: [], allocation_granted: false},
  execution_ready: false, infrastructure_qualified: false}
const pending = {...empty, hold: {id: 'b'.repeat(32), allocation_id: 'c'.repeat(32), physical_node_id: 'a'.repeat(32), status: 'pending_root', revision: 1,
  approval_revision: review.review_revision, approved_by: 'director', created_at: '2026-10-20T12:00:00+00:00', requirements, reservation_recorded: true, root_accepted: false}}
beforeEach(() => { vi.resetAllMocks(); connection.url = 'http://test'; connection.token = 'alpha' })
async function load(state: Record<string, unknown> = empty, role = 'admin') {
  expect(Object.values(modules)).toHaveLength(1)
  const component = await Object.values(modules)[0]()
  const view = mount(component.default, {props: {deploymentId: 'run'}})
  expect(backendRequest).not.toHaveBeenCalled()
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role} : state)
  await view.get('[data-testid="capacity-refresh"]').trigger('click'); await flushPromises()
  return view
}

it('requests physical acceptance with only the original approval and keeps execution closed', async () => {
  const waiting = {...pending, hold: {...pending.hold, native_acceptance_available: true, native_request_may_have_been_sent: false}}
  const view = await load(waiting)
  expect(view.find('[data-testid="capacity-native-accept"]').exists()).toBe(true)
  vi.mocked(backendRequest).mockResolvedValue({...waiting, hold: {...waiting.hold, native_acceptance_available: false, native_request_may_have_been_sent: true, root_accepted: true}})
  await view.get('[data-testid="capacity-native-accept"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/run/capacity/native', expect.objectContaining({method: 'POST', body: JSON.stringify({review_revision: pending.hold.approval_revision})}))
  expect(view.text()).toContain('Physical acceptance recorded')
  expect(view.text()).toContain('execution remains blocked')
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
  expect(view.find('[data-testid="capacity-native-accept"]').exists()).toBe(false); view.unmount()
})

it('recovers a lost native reply by reading status and explicitly reconciling the original request', async () => {
  const waiting = {...pending, hold: {...pending.hold, native_acceptance_available: true, native_request_may_have_been_sent: false}}
  const unknown = {...pending, hold: {...pending.hold, native_reconciliation_available: true, native_request_may_have_been_sent: true}}
  const view = await load(waiting)
  vi.mocked(backendRequest).mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') throw new Error('Response lost')
    return unknown
  })
  await view.get('[data-testid="capacity-native-accept"]').trigger('click'); await flushPromises()
  expect(vi.mocked(backendRequest).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  expect(view.find('[data-testid="capacity-native-accept"]').exists()).toBe(false)
  expect(view.find('[data-testid="capacity-native-reconcile"]').exists()).toBe(true)
  vi.mocked(backendRequest).mockResolvedValue({...unknown, hold: {...unknown.hold, native_reconciliation_available: false, root_accepted: true}})
  await view.get('[data-testid="capacity-native-reconcile"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/run/capacity/native/reconcile', expect.objectContaining({method: 'POST', body: '{}'}))
  expect(view.text()).toContain('Physical acceptance recorded')
  expect(view.emitted('changed')?.at(-1)).toEqual([false]); view.unmount()
})

it('refuses a response offering new native acceptance after an uncertain request', async () => {
  const view = await load({...pending, hold: {...pending.hold, native_acceptance_available: true, native_request_may_have_been_sent: true}})
  expect(view.get('[role="alert"]').text()).toContain('verified')
  expect(view.find('[data-testid="capacity-native-accept"]').exists()).toBe(false); view.unmount()
})

describe('deployment capacity reservation in Overview', () => {
  it('shows exact requirements and reserves only the server review reference', async () => {
    const view = await load()
    vi.mocked(backendRequest).mockResolvedValue(review)
    await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('46000'); expect(view.text()).toContain('20 GiB'); expect(view.text()).toContain('12 GiB'); expect(view.text()).toContain('44 GiB'); expect(view.text()).toContain('114')
    vi.mocked(backendRequest).mockResolvedValue(pending)
    await view.get('[data-testid="capacity-reserve"]').trigger('click'); await flushPromises()
    expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/run/capacity', expect.objectContaining({method: 'POST', body: JSON.stringify({review_revision: review.review_revision})}))
    expect(view.text()).toContain('Physical acceptance pending')
    expect(view.text()).toContain('Virtual machine operations remain blocked')
    expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false)
    expect(view.emitted('changed')?.at(-1)).toEqual([false]); view.unmount()
  })

  it('does not reserve an oversubscribed memory budget', async () => {
    const view = await load()
    vi.mocked(backendRequest).mockResolvedValue({...review, assessment: {...review.assessment, admissible: false, memory_headroom_mib: -4096, blocking_codes: ['MEMORY_COMMITTED']}})
    await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('4 GiB over the memory budget')
    expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false); view.unmount()
  })

  it('reads status after a lost reservation reply and never replays automatically', async () => {
    const view = await load()
    vi.mocked(backendRequest).mockResolvedValue(review)
    await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
    vi.mocked(backendRequest).mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw new Error('Response lost')
      return pending
    })
    await view.get('[data-testid="capacity-reserve"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('Response lost'); expect(view.text()).toContain('Physical acceptance pending')
    expect(vi.mocked(backendRequest).mock.calls.filter(([path, options]) => path === '/v1/deployments/run/capacity' && options?.method === 'POST')).toHaveLength(1)
    expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false); view.unmount()
  })

  it('does not load privileged reservation state for an operator', async () => {
    const view = await load(empty, 'operator')
    expect(backendRequest).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain('administrator')
    expect(view.find('[data-testid="capacity-review"]').exists()).toBe(false); view.unmount()
  })

  it('discards a delayed review after backend credentials change', async () => {
    const view = await load()
    let resolve!: (value: unknown) => void
    vi.mocked(backendRequest).mockImplementation(() => new Promise(done => { resolve = done }))
    await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
    connection.token = 'changed'; await flushPromises(); resolve(review); await flushPromises()
    expect(view.text()).not.toContain('46000')
    expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false); view.unmount()
  })

  it.each(['target', 'ready', 'optimistic'])('refuses an inconsistent %s review', async damage => {
    const view = await load(), invalid = structuredClone(review)
    if (damage === 'target') invalid.deployment_id = 'other'
    if (damage === 'ready') invalid.execution_ready = true
    if (damage === 'optimistic') invalid.assessment.memory_headroom_mib = -1
    vi.mocked(backendRequest).mockResolvedValue(invalid)
    await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
    expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('verified'); view.unmount()
  })
})

it('explains shared storage overage without offering a reservation', async () => {
  const view = await load(), deficit = structuredClone(review)
  deficit.assessment.pools['1'.repeat(64)].available_bytes = 0
  deficit.assessment.pools['1'.repeat(64)].logical_headroom_bytes = -256 * 2 ** 30
  deficit.assessment.clusters['2'.repeat(64)].available_bytes = 0
  deficit.assessment.clusters['2'.repeat(64)].raw_headroom_bytes = -768 * 2 ** 30
  deficit.assessment.admissible = false; deficit.assessment.blocking_codes = ['SHARED_STORAGE_COMMITTED']
  vi.mocked(backendRequest).mockResolvedValue(deficit)
  await view.get('[data-testid="capacity-review"]').trigger('click'); await flushPromises()
  expect(view.text()).toContain('256 GiB over the shared storage budget')
  expect(view.text()).toContain('768 GiB over the shared physical storage budget')
  expect(view.find('[data-testid="capacity-reserve"]').exists()).toBe(false); view.unmount()
})

it('reviews and confirms unused release while preserving allocation and execution gates', async () => {
  const unused = {...pending, hold: {...pending.hold, unused_retirement_review_available: true, native_request_may_have_been_sent: false}}
  const view = await load(unused)
  expect(view.find('[data-testid="capacity-unused-review"]').exists()).toBe(true)
  vi.mocked(backendRequest).mockResolvedValue({...review, unused_retirement_eligible: true})
  await view.get('[data-testid="capacity-unused-review"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="capacity-unused-release"]').trigger('click')
  expect(view.get('[role="dialog"]').text()).toContain('The original allocation is retained')
  expect(vi.mocked(backendRequest).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  vi.mocked(backendRequest).mockResolvedValue({...unused, hold: {...unused.hold, status: 'retired', unused_retirement_review_available: false, retired_by: 'director'}})
  await view.get('form[role="dialog"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/run/capacity', expect.objectContaining({method: 'DELETE', body: JSON.stringify({review_revision: review.review_revision})}))
  expect(view.text()).toContain('Reservation retired')
  expect(view.emitted('changed')?.at(-1)).toEqual([false]); view.unmount()
})

it('recovers a lost release response by reading status rather than replaying deletion', async () => {
  const unused = {...pending, hold: {...pending.hold, unused_retirement_review_available: true, native_request_may_have_been_sent: false}}
  const view = await load(unused)
  vi.mocked(backendRequest).mockResolvedValue({...review, unused_retirement_eligible: true})
  await view.get('[data-testid="capacity-unused-review"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="capacity-unused-release"]').trigger('click')
  vi.mocked(backendRequest).mockImplementation(async (_path, options) => {
    if (options?.method === 'DELETE') throw new Error('Release response lost')
    return {...unused, hold: {...unused.hold, status: 'retired', unused_retirement_review_available: false}}
  })
  await view.get('form[role="dialog"]').trigger('submit'); await flushPromises()
  expect(view.text()).toContain('Reservation retired')
  expect(vi.mocked(backendRequest).mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1)
  expect(view.find('[role="dialog"]').exists()).toBe(false); view.unmount()
})

it('offers no unused release when native acceptance may already have been requested', async () => {
  const view = await load({...pending, hold: {...pending.hold, native_request_may_have_been_sent: true, unused_retirement_review_available: false}})
  expect(view.text()).toContain('Native acceptance may have been requested')
  expect(view.find('[data-testid="capacity-unused-review"]').exists()).toBe(false)
  expect(view.find('[data-testid="capacity-unused-release"]').exists()).toBe(false); view.unmount()
})

it('explains the next foundation step after physical acceptance without claiming general execution readiness', async () => {
  const view = await load({...pending, hold: {...pending.hold, root_accepted: true, native_request_may_have_been_sent: true}})
  await view.setProps({foundation: true})
  // Changing presentation must not open the generic guest execution gate.
  expect(view.text()).toContain('template preparation request below')
  expect(view.text()).not.toContain('execution remains blocked')
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
})
