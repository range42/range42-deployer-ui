import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import DeploymentDetail from '@/views/DeploymentDetail.vue'
import deployment from '@/locales/en/deployment.json'
import runtime from '@/locales/en/runtime.json'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDeploymentStore, applySseEvent } from '@/stores/deploymentStore'

vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
enableAutoUnmount(afterEach)
const claim = () => ({ deployment_id: 'dep', project_sha: 'a'.repeat(40), host_id: 'target', node_name: 'pve01',
  created_at: '2026-09-11T10:00:00Z', assignments: [{ vm_id: 60000, vm_name: 'training-guest',
    nics: [{ index: 0, bridge: 'r42smk', ip: '10.42.70.20' }, { index: 1, bridge: 'r42smk2', ip: '10.42.71.20' }] }] })
const json = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status })
const missing = () => json({ code: 'ALLOCATION_NOT_FOUND', message: 'No committed allocation record.' }, 404)
let fetchMock, allocationResponse, deleteResponse, deploymentState, attemptRows
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useBackendApiStore().addHost({ url: 'https://backend.test', token: 'operator-token' })
  deploymentState = 'pending'
  attemptRows = []
  allocationResponse = () => json(claim())
  deleteResponse = () => json({ code: 'ALLOCATION_IN_USE', message: 'At least one allocated VM ID still exists. Teardown the guests before releasing.' }, 409)
  fetchMock = vi.fn(async (url, init = {}) => {
    if (url.endsWith('/allocations')) return init.method === 'DELETE' ? deleteResponse(url) : allocationResponse(url)
    if (url.endsWith('/attempts')) return json({ items: attemptRows, total: attemptRows.length })
    return json({ id: 'dep', codename: 'TRAINING', scenario_label: 'lab', state: deploymentState,
      project_id: 'backend-project', target_host_id: 'target', project_sha: 'a'.repeat(40), team_count: 1 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
async function show() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/deployments', name: 'deployments', component: { template: '<div />' } },
    { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div />' } },
    { path: '/deployments/:id/preflight', name: 'deployment-preflight', component: { template: '<div />' } },
  ] })
  await router.push('/deployments/dep')
  const wrapper = mount(DeploymentDetail, { global: {
    plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en: { deployment, runtime } } })],
    stubs: { RuntimeControls: true, RuntimeGitRecords: true },
  } })
  await flushPromises()
  return { wrapper, router }
}
const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')

describe('deployment allocation read and guarded release', () => {
  it('shows the durable claim and every NIC from the selected authenticated backend', async () => {
    const { wrapper } = await show()
    const panel = wrapper.get('[data-testid="deployment-allocations"]')
    expect(panel.text()).toContain('training-guest')
    expect(panel.text()).toContain('60000')
    expect(panel.text()).toContain('net0 · r42smk · 10.42.70.20')
    expect(panel.text()).toContain('net1 · r42smk2 · 10.42.71.20')
    expect(panel.text()).toContain('pve01')
    expect(panel.text()).toContain('a'.repeat(40))
    expect(panel.text()).toContain('do not expire')
    const [url, init] = fetchMock.mock.calls.find(([url]) => url.endsWith('/allocations'))
    expect(url).toBe('https://backend.test/v1/deployments/dep/allocations')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer operator-token')
    expect(deletes()).toHaveLength(0)
  })

  it('explains a404 as no claim and offers no release action', async () => {
    allocationResponse = missing
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="allocation-absent"]').text()).toContain('No committed allocation')
    expect(wrapper.find('[data-testid="allocation-review-release"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="allocation-error"]').exists()).toBe(false)
    expect(deletes()).toHaveLength(0)
  })

  it('keeps the full claim and backend409 reason after an explicitly confirmed release is refused', async () => {
    const { wrapper } = await show()
    await wrapper.get('[data-testid="allocation-review-release"]').trigger('click')
    expect(deletes()).toHaveLength(0)
    expect(wrapper.get('[data-testid="allocation-release-review"]').text()).toContain('history')
    await wrapper.get('[data-testid="allocation-confirm-release"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="allocation-error"]').text()).toContain('At least one allocated VM ID still exists')
    expect(wrapper.get('[data-testid="deployment-allocations"]').text()).toContain('10.42.71.20')
    expect(wrapper.find('[data-testid="allocation-absent"]').exists()).toBe(false)
    const [url, init] = deletes()[0]
    expect(url).toBe('https://backend.test/v1/deployments/dep/allocations')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer operator-token')
    expect(new Headers(init.headers).has('X-Range42-Reservation-Token')).toBe(false)
  })

  it('refreshes after204 and displays confirmed absence without deleting deployment history', async () => {
    deleteResponse = () => { allocationResponse = missing; return json(null, 204) }
    const { wrapper } = await show()
    await wrapper.get('[data-testid="allocation-review-release"]').trigger('click')
    await wrapper.get('[data-testid="allocation-confirm-release"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="allocation-absent"]').text()).toContain('released')
    expect(wrapper.find('[data-testid="allocation-review-release"]').exists()).toBe(false)
    expect(wrapper.get('h1').text()).toBe('TRAINING')
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/allocations') && init?.method !== 'DELETE')).toHaveLength(2)
    expect(deletes()).toHaveLength(1)
  })

  it.each(['deploying', 'running_attempt', 'preflight_running', 'unknown'])('keeps claim visible but disables release while deployment is %s', async state => {
    deploymentState = state
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="deployment-allocations"]').text()).toContain('training-guest')
    expect(wrapper.get('[data-testid="allocation-review-release"]').element.disabled).toBe(true)
    expect(wrapper.get('[data-testid="allocation-busy-reason"]').text()).toContain('operation')
    expect(deletes()).toHaveLength(0)
  })

  it('also blocks release for a known nonterminal attempt when metadata appears idle', async () => {
    deploymentState = 'failed'
    attemptRows = [{ id: 'current-attempt', state: 'pending', scope: 'runtime' }]
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="allocation-review-release"]').element.disabled).toBe(true)
  })

  it.each(['deploying', 'unknown'])('invalidates an open release review when live state becomes %s', async state => {
    const { wrapper } = await show()
    await wrapper.get('[data-testid="allocation-review-release"]').trigger('click')
    const record = useDeploymentStore().getOrCreateRecord('dep')
    applySseEvent(record, { event_type: 'state_transition', event_seq: 1, payload: { to: state } })
    await flushPromises()
    expect(wrapper.find('[data-testid="allocation-confirm-release"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="allocation-review-release"]').element.disabled).toBe(true)
    expect(deletes()).toHaveLength(0)
  })

  it('rejects a claim for a different deployment instead of offering release', async () => {
    allocationResponse = () => json({ ...claim(), deployment_id: 'different' })
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="allocation-error"]').text()).toContain('invalid allocation')
    expect(wrapper.find('[data-testid="allocation-review-release"]').exists()).toBe(false)
  })

  it('ignores a late read from the previous backend', async () => {
    let resolveOld
    allocationResponse = url => url.startsWith('https://backend.test') ? new Promise(resolve => { resolveOld = resolve })
      : json({ ...claim(), assignments: [{ vm_id: 60001, vm_name: 'new-backend-guest', nics: [] }] })
    const { wrapper } = await show()
    const backend = useBackendApiStore()
    backend.setActiveHost(backend.addHost({ url: 'https://new.test', token: 'new-operator' }))
    await flushPromises()
    resolveOld(json(claim()))
    await flushPromises()
    expect(wrapper.get('[data-testid="deployment-allocations"]').text()).toContain('new-backend-guest')
    expect(wrapper.text()).not.toContain('training-guest')
    expect(deletes()).toHaveLength(0)
  })

  it('prevents duplicate release while waiting and ignores late errors after a backend switch', async () => {
    let rejectOld
    deleteResponse = () => new Promise((_, reject) => { rejectOld = reject })
    const { wrapper } = await show()
    await wrapper.get('[data-testid="allocation-review-release"]').trigger('click')
    await wrapper.get('[data-testid="allocation-confirm-release"]').trigger('click')
    expect(wrapper.get('[data-testid="allocation-confirm-release"]').element.disabled).toBe(true)
    await wrapper.get('[data-testid="allocation-confirm-release"]').trigger('click')
    expect(deletes()).toHaveLength(1)
    const backend = useBackendApiStore()
    backend.setActiveHost(backend.addHost({ url: 'https://new.test', token: 'new-operator' }))
    await flushPromises()
    rejectOld(new Error('Old backend release failed'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Old backend release failed')
    expect(wrapper.find('[data-testid="allocation-confirm-release"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="allocation-review-release"]').element.disabled).toBe(false)
  })

  it.each([undefined, 'DEPLOYMENT_NOT_FOUND'])('does not call an unrelated404 an absent claim (%s)', async code => {
    allocationResponse = () => json({ ...(code ? { code } : {}), message: 'Deployment endpoint not found' }, 404)
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="allocation-error"]').text()).toContain('Deployment endpoint not found')
    expect(wrapper.get('[data-testid="allocation-error"]').text()).toContain('selected backend')
    expect(wrapper.find('[data-testid="allocation-absent"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="allocation-review-release"]').exists()).toBe(false)
  })

  it('does not treat an authentication failure as absence or offer release', async () => {
    allocationResponse = () => json({ message: 'Unauthorized' }, 401)
    const { wrapper } = await show()
    expect(wrapper.get('[data-testid="allocation-error"]').text()).toContain('Connect with your backend API token')
    expect(wrapper.find('[data-testid="allocation-absent"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="allocation-review-release"]').exists()).toBe(false)
  })
})
