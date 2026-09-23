import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { reactive } from 'vue'
import SnapshotSets from '@/components/deployment/SnapshotSets.vue'
import messages from '@/locales/en/snapshots.json'

const api = vi.hoisted(() => ({ list: vi.fn(), planCreate: vi.fn(), planExisting: vi.fn(), execute: vi.fn(), reconcile: vi.fn(), cancel: vi.fn(), planRetention: vi.fn(), guard: vi.fn() }))
const state = reactive({ url: 'https://api.test', token: 'one', activeHost: { id: 'backend' } })
vi.mock('@/services/snapshotSets', () => ({ createSnapshotClient: () => api, SnapshotRequestError: class extends Error {} }))
vi.mock('@/stores/backendApiStore', () => ({ useBackendApiStore: () => state }))
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => state.url }))
vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
enableAutoUnmount(afterEach)
const item = () => ({ id: 'set', deployment_id: 'dep', host_id: 'host', project_sha: 'a'.repeat(40), target_digest: 'b'.repeat(64),
  name: 'Checkpoint', state: 'planned', members: [{ vm_id: 60000, vm_name: 'guest', uuid: 'owned-uuid' }],
  operation: { id: 'op', kind: 'create', state: 'planned', recovery: 'none', expires_at: new Date(Date.now() + 300000).toISOString(),
    plan_digest: 'd'.repeat(64), reviewed_members: [{ vm_id: 60000, vm_name: 'guest', uuid: 'owned-uuid', status: 'stopped' }], members: [{ vm_id: 60000, state: 'planned' }] } })
const page = (items = []) => ({ items, total: items.length, offset: 0, limit: 20 })
async function show() {
  const wrapper = mount(SnapshotSets, { props: { deploymentId: 'dep', projectSha: 'a'.repeat(40), hostId: 'host' },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { snapshots: messages } } })] } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks(); state.token = 'one'; api.list.mockResolvedValue(page()); api.planCreate.mockResolvedValue(item())
  api.cancel.mockResolvedValue(undefined); api.guard.mockImplementation(() => {})
})

describe('snapshot set review and explicit dispatch', () => {
  it('loads metadata only, reviews exact members and waits for explicit confirmation', async () => {
    const wrapper = await show()
    expect(api.planCreate).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="snapshot-plan-create"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="snapshot-review"]').text()).toContain('60000')
    expect(api.execute).not.toHaveBeenCalled()
    api.execute.mockResolvedValue({ ...item(), state: 'creating', operation: { ...item().operation, state: 'running', recovery: 'poll_saved_tasks' } })
    await wrapper.get('[data-testid="snapshot-confirm"]').trigger('click'); await flushPromises()
    expect(api.execute).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Running')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(api.reconcile).not.toHaveBeenCalled()
  })

  it('discards a late review after changing deployment or credentials', async () => {
    let resolve
    api.planCreate.mockReturnValue(new Promise(done => { resolve = done }))
    const wrapper = await show()
    await wrapper.get('[data-testid="snapshot-plan-create"]').trigger('click')
    state.token = 'two'; await flushPromises(); resolve(item()); await flushPromises()
    expect(wrapper.find('[data-testid="snapshot-review"]').exists()).toBe(false)
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('clears a submitted review after unknown outcome and never retries automatically', async () => {
    const wrapper = await show()
    await wrapper.get('[data-testid="snapshot-plan-create"]').trigger('click'); await flushPromises()
    api.execute.mockRejectedValue(new Error('private raw failure'))
    await wrapper.get('[data-testid="snapshot-confirm"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="snapshot-confirm"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('could not be confirmed')
    expect(wrapper.text()).not.toContain('private raw failure')
    expect(api.execute).toHaveBeenCalledTimes(1)
  })

  it('shows partial members and reconciles known tasks only on operator action', async () => {
    const current = item(); current.state = 'needs_review'; current.operation.state = 'needs_review'; current.operation.recovery = 'operator_required'
    current.operation.members[0].state = 'unconfirmed'; api.list.mockResolvedValue(page([current])); api.reconcile.mockResolvedValue(current)
    const wrapper = await show()
    expect(wrapper.text()).toContain('Operator recovery')
    expect(wrapper.text()).toContain('Unconfirmed')
    expect(api.reconcile).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="snapshot-reconcile"]').trigger('click'); await flushPromises()
    expect(api.reconcile).toHaveBeenCalledTimes(1)
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('requires a separate rollback review and explains the stopped state', async () => {
    const completed = item(); completed.state = 'complete'; completed.operation.state = 'succeeded'
    api.list.mockResolvedValue(page([completed])); api.planExisting.mockResolvedValue({ ...completed, operation: { ...item().operation, kind: 'rollback' } })
    const wrapper = await show()
    await wrapper.get('[data-testid="snapshot-plan-rollback"]').trigger('click'); await flushPromises()
    expect(api.planExisting).toHaveBeenCalledWith(completed, 'rollback')
    expect(wrapper.get('[data-testid="snapshot-review"]').text()).toContain('stopped')
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('reviews retention candidates without deleting and can cancel the unused plans', async () => {
    const candidate = item(); candidate.operation.kind = 'delete'
    api.planRetention.mockResolvedValue({ policy: { keep_count: 5, keep_days: 7 }, automatic_enforcement: false, eligible_count: 1, candidates: [candidate] })
    const wrapper = await show()
    await wrapper.get('[data-testid="snapshot-plan-retention"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="snapshot-review"]').text()).toContain('5')
    expect(api.execute).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="snapshot-cancel-plan"]').trigger('click'); await flushPromises()
    expect(api.cancel).toHaveBeenCalledWith(candidate)
    expect(api.execute).not.toHaveBeenCalled()
  })
  it('renders partial outcomes without offering rollback or claiming every VM succeeded', async () => {
    const partial = item(); partial.state = 'partial'; partial.operation.state = 'partial'
    partial.operation.members = [{ vm_id: 60000, state: 'succeeded' }, { vm_id: 60001, state: 'failed' }]
    api.list.mockResolvedValue(page([partial]))
    const wrapper = await show(), record = wrapper.get('[data-testid="snapshot-record"]')
    expect(record.text()).toContain('Partial')
    expect(record.text()).toContain('60000 · Succeeded')
    expect(record.text()).toContain('60001 · Failed')
    expect(record.find('[data-testid="snapshot-plan-rollback"]').exists()).toBe(false)
    expect(record.find('[data-testid="snapshot-plan-delete"]').exists()).toBe(true)
    expect(api.execute).not.toHaveBeenCalled()
  })

})
