import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BackendAccessPanel from '@/components/BackendAccessPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
let backend: ReturnType<typeof useBackendApiStore>
let wrapper: ReturnType<typeof mount>
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); backend = useBackendApiStore(); backend.addHost({ url: 'https://backend.test', token: 'public-test-token' }) })
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
describe('backend named access and audit', () => {
  it('explicitly reads the backend identity with its bearer and never treats the local display name as an API role', async () => {
    const fetch = vi.fn(async () => response({ actor_id: 'alice', role: 'viewer', scope: 'installation', audit_enabled: true }))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(BackendAccessPanel)
    expect(fetch).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="check-access"]').trigger('click'); await flushPromises()
    expect(fetch).toHaveBeenCalledWith('https://backend.test/v1/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer public-test-token', Accept: 'application/json' } }))
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('viewer')
    expect(wrapper.find('[data-testid="load-audit"]').exists()).toBe(false)
  })
  it('pages administrator audit results and clears them when the backend credential changes', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/auth/me') ? response({ actor_id: 'admin', role: 'admin', scope: 'installation', audit_enabled: true }) : response({ total: 2, items: [{ id: url.includes('offset=1') ? 'two' : 'one', actor_id: 'alice', role: 'operator', method: 'PUT', route: '/v1/projects/{project_id}', state: 'completed', status_code: 200, created_at: '2026-09-14T12:00:00Z', finished_at: '2026-09-14T12:00:01Z' }] }))
    vi.stubGlobal('fetch', fetch); wrapper = mount(BackendAccessPanel)
    await wrapper.get('[data-testid="check-access"]').trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="load-audit"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('[data-testid="audit-row"]')).toHaveLength(1)
    await wrapper.get('[data-testid="more-audit"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('[data-testid="audit-row"]')).toHaveLength(2)
    backend.updateHost(backend.activeHost!.id, { token: 'different-token' }); await flushPromises()
    expect(wrapper.find('[data-testid="audit-row"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('alice')
  })
  it('rejects late identity responses from a different backend', async () => {
    let complete!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { complete = resolve })))
    wrapper = mount(BackendAccessPanel)
    await wrapper.get('[data-testid="check-access"]').trigger('click')
    backend.updateHost(backend.activeHost!.id, { url: 'https://new.test' }); await flushPromises()
    complete(response({ actor_id: 'old-actor', role: 'admin', scope: 'installation', audit_enabled: true })); await flushPromises()
    expect(wrapper.text()).not.toContain('old-actor')
    expect(wrapper.find('[data-testid="load-audit"]').exists()).toBe(false)
  })
  it('reports denied access without rendering a private server body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'private-diagnostic' }, 403)))
    wrapper = mount(BackendAccessPanel)
    await wrapper.get('[data-testid="check-access"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/denied/i)
    expect(wrapper.text()).not.toContain('private-diagnostic')
  })
})
