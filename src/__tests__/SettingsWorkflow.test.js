import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Settings from '@/views/Settings.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useProjectStore } from '@/stores/projectStore'

const policy = { keep_count: 12, keep_days: 30, automatic_enforcement: false, execution: 'reviewed_snapshot_sets_only' }
let wrapper, backend, first, second, fetchMock
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  backend = useBackendApiStore()
  first = backend.addHost({ label: 'Lab A', url: 'https://a.test', token: 'token-a', nodeName: 'pve-a' })
  second = backend.addHost({ label: 'Lab B', url: 'https://b.test', token: 'token-b', nodeName: 'pve-b' })
  fetchMock = vi.fn(async (url, init) => new Response(JSON.stringify(
    url.endsWith('/auth/me') ? { actor_id: 'admin', role: 'admin', scope: 'installation', audit_enabled: false }
      : url.endsWith('/health/ready') ? { ready: true, checks: {} }
        : init?.method === 'PUT' ? { ...JSON.parse(init.body), automatic_enforcement: false, execution: 'reviewed_snapshot_sets_only' } : policy,
  ), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { useConfirmDialog().resolve(false); wrapper?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function show(tab = 'connections') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/settings', component: Settings }, { path: '/sources', component: { template: '<p>Sources</p>' } },
    { path: '/', component: { template: '<p>Projects</p>' } },
  ] })
  await router.push(`/settings?tab=${tab}`)
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return router
}
describe('Settings workflows', () => {
  it('reports a session-only connection and lets unchanged state be saved again', async () => {
    await show()
    await wrapper.get('[data-testid="backend-label"]').setValue('New profile')
    await wrapper.get('[data-testid="backend-url"]').setValue('https://new.test')
    const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    await wrapper.get('[data-testid="backend-connection-form"]').trigger('submit')
    expect(wrapper.get('[data-testid="backend-storage-error"]').text()).toContain('session')
    failed.mockRestore()
    await wrapper.get('[data-testid="retry-backend-storage"]').trigger('click')
    expect(wrapper.find('[data-testid="backend-storage-error"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('range42_backend_api')).hosts).toHaveLength(3)
  })
  it('does not claim identity is persistent when browser storage refuses it', async () => {
    await show('identity')
    await wrapper.get('[data-testid="user-display-name"]').setValue('Training operator')
    const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="identity-storage-error"]').text()).toContain('session')
    expect(wrapper.get('[role="status"]').text()).not.toContain('Identity saved')
    failed.mockRestore()
    await wrapper.get('[data-testid="retry-identity-storage"]').trigger('click')
    expect(JSON.parse(localStorage.getItem('range42_user_settings')).display_name).toBe('Training operator')
  })
  it('asks before leaving an edited connection and keeps it when cancelled', async () => {
    const router = await show()
    await wrapper.get('[data-testid="backend-url"]').setValue('https://new.test')
    const navigation = router.push('/settings?tab=identity')
    await flushPromises()
    expect(useConfirmDialog().visible.value).toBe(true)
    useConfirmDialog().resolve(false); await navigation
    expect(router.currentRoute.value.query.tab).toBe('connections')
    expect(wrapper.get('[data-testid="backend-url"]').element.value).toBe('https://new.test')
  })
  it('clears only the local project list after confirmation', async () => {
    useProjectStore().createProject('Local draft')
    localStorage.setItem('other-app', 'keep-me')
    await show('data')
    await wrapper.get('[data-testid="clear-local-projects"]').trigger('click')
    expect(useProjectStore().projects).toHaveLength(1)
    useConfirmDialog().resolve(true); await flushPromises()
    expect(useProjectStore().projects).toHaveLength(0)
    expect(localStorage.getItem('other-app')).toBe('keep-me')
    expect(backend.hosts).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('range42_backend_api')).hosts).toHaveLength(2)
  })
  it('switches the active backend explicitly and persists the selection', async () => {
    await show()
    const select = wrapper.get('[data-testid="active-backend"]')
    expect(select.element.value).toBe(first)
    await select.setValue(second)
    expect(backend.activeHost.id).toBe(second)
    wrapper.unmount(); setActivePinia(createPinia())
    expect(useBackendApiStore().activeHost.id).toBe(second)
  })
  it('rejects embedded URL credentials without saving them', async () => {
    await show()
    await wrapper.get('[data-testid="backend-url"]').setValue('https://user:password@example.test')
    await wrapper.get('[data-testid="backend-connection-form"]').trigger('submit')
    expect(backend.hosts).toHaveLength(2)
    expect(wrapper.get('[data-testid="backend-url-error"]').text()).toContain('credentials')
  })
  it('checks a saved connection with its own token without activating it', async () => {
    await show()
    const row = wrapper.findAll('[data-testid="backend-host-row"]')[1]
    await row.findAll('button').find(button => button.text() === 'Test').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('https://b.test/v1/health/ready', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-b' }) }))
    expect(backend.activeHost.id).toBe(first)
  })
  it('restores the section from the URL and routes Git setup to Sources', async () => {
    const router = await show('identity')
    expect(wrapper.get('[data-testid="settings-user-identity"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="settings-backend-api"]').exists()).toBe(false)
    await wrapper.get('[data-testid="settings-link-connections"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('connections')
    expect(wrapper.text()).not.toContain('GitHub Authentication')
    expect(wrapper.find('a[href="/sources"]').exists()).toBe(true)
  })
  it('loads backend retention rather than an unrelated browser value', async () => {
    localStorage.setItem('range42_snapshot_retention', JSON.stringify({ keep_count: 1, keep_days: 2 }))
    await show('snapshots')
    expect(wrapper.get('[data-testid="retention-keep-count"]').element.value).toBe('12')
    expect(wrapper.get('[data-testid="retention-keep-days"]').element.value).toBe('30')
    expect(wrapper.get('[data-testid="retention-inactive"]').text()).toBe('Not enforced')
  })
  it('confirms retention only after backend acceptance', async () => {
    await show('snapshots')
    const panel = wrapper.get('[data-testid="settings-snapshot-retention"]')
    await panel.get('[data-testid="retention-keep-count"]').setValue('8')
    await panel.get('form').trigger('submit'); await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('https://a.test/v1/admin/retention', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ keep_count: 8, keep_days: 30 }) }))
    expect(panel.get('[role="status"]').text()).toContain('Saved on this backend')
    expect(localStorage.getItem('range42_snapshot_retention')).toBeNull()
  })
  it('preserves rejected retention edits without claiming success', async () => {
    await show('snapshots')
    const panel = wrapper.get('[data-testid="settings-snapshot-retention"]')
    await panel.get('[data-testid="retention-keep-count"]').setValue('8')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await panel.get('form').trigger('submit'); await flushPromises()
    expect(panel.get('[role="alert"]').text()).toContain('administrator')
    expect(panel.get('[data-testid="retention-keep-count"]').element.value).toBe('8')
    expect(panel.get('[role="status"]').text()).not.toContain('Saved')
  })
  it('clears the previous backend policy when a new backend refuses access', async () => {
    await show('snapshots')
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }))
    backend.setActiveHost(second); await flushPromises()
    expect(wrapper.find('[data-testid="retention-keep-count"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('token')
    expect(wrapper.find('[data-testid="retention-reload"]').exists()).toBe(true)
  })
  it('shows retention read-only for an operator', async () => {
    fetchMock.mockImplementation(async url => new Response(JSON.stringify(url.endsWith('/auth/me')
      ? { actor_id: 'operator', role: 'operator', scope: 'installation', audit_enabled: false } : policy), { status: 200 }))
    await show('snapshots')
    const panel = wrapper.get('[data-testid="settings-snapshot-retention"]')
    expect(panel.text()).toContain('administrator')
    expect(panel.find('button[type="submit"]').exists()).toBe(false)
  })
  it('keeps a newly selected node default when saving other profile fields', async () => {
    await show()
    const row = wrapper.findAll('[data-testid="backend-host-row"]')[0]
    await row.findAll('button').find(button => button.text() === 'Edit').trigger('click')
    backend.updateHost(first, { nodeName: 'new-default' })
    await wrapper.get('[data-testid="backend-label"]').setValue('Renamed lab')
    await wrapper.get('[data-testid="backend-connection-form"]').trigger('submit')
    expect(backend.getHost(first).nodeName).toBe('new-default')
  })
})
