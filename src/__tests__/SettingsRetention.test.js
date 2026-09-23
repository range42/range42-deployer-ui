import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RetentionPreferencesPanel from '@/components/settings/RetentionPreferencesPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const policy = { keep_count: 5, keep_days: 7, automatic_enforcement: false, execution: 'reviewed_snapshot_sets_only' }
const access = { actor_id: 'admin', role: 'admin', scope: 'installation', audit_enabled: false }
let wrapper, backend, fetchMock
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia())
  backend = useBackendApiStore()
  backend.addHost({ url: 'https://backend.test', token: 'test-token' })
  fetchMock = vi.fn(async url => new Response(JSON.stringify(url.endsWith('/auth/me') ? access : policy), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { useConfirmDialog().resolve(false); wrapper?.unmount(); vi.unstubAllGlobals() })
async function show() { wrapper = mount(RetentionPreferencesPanel); await flushPromises() }

describe('retention policy safeguards', () => {
  it('asks before reloading over an unsaved draft', async () => {
    await show()
    await wrapper.get('[data-testid="retention-keep-count"]').setValue('9')
    const count = fetchMock.mock.calls.length
    await wrapper.get('[data-testid="retention-reload"]').trigger('click')
    expect(useConfirmDialog().visible.value).toBe(true)
    useConfirmDialog().resolve(false); await flushPromises()
    expect(wrapper.get('[data-testid="retention-keep-count"]').element.value).toBe('9')
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })
  it('rejects fractional policy values without a write', async () => {
    await show()
    await wrapper.get('[data-testid="retention-keep-days"]').setValue('1.5')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('whole number')
    expect(fetchMock.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false)
  })
  it('keeps policy loading unavailable after a malformed response', async () => {
    fetchMock.mockImplementation(async url => new Response(JSON.stringify(url.endsWith('/auth/me') ? access : { keep_count: 8, keep_days: 7 }), { status: 200 }))
    await show()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('unsupported')
  })
  it('discards late responses from another backend', async () => {
    let release
    const held = new Promise(resolve => { release = resolve })
    fetchMock.mockImplementation(async url => {
      if (url === 'https://backend.test/v1/admin/retention') return held
      return new Response(JSON.stringify(url.endsWith('/auth/me') ? access : { ...policy, keep_count: 22 }), { status: 200 })
    })
    await show()
    const other = backend.addHost({ url: 'https://other.test', token: 'other-token' })
    backend.setActiveHost(other); await flushPromises()
    expect(wrapper.get('[data-testid="retention-keep-count"]').element.value).toBe('22')
    release(new Response(JSON.stringify(policy), { status: 200 })); await flushPromises()
    expect(wrapper.get('[data-testid="retention-keep-count"]').element.value).toBe('22')
  })
  it('lets a viewer see the permission refusal without offering writes', async () => {
    fetchMock.mockImplementation(async url => new Response(JSON.stringify(url.endsWith('/auth/me') ? { ...access, role: 'viewer' } : {}), { status: url.endsWith('/auth/me') ? 200 : 403 }))
    await show()
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('access')
  })
})
