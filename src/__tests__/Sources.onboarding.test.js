import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import Sources from '@/views/Sources.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import sourcesEn from '@/locales/en/sources.json'
import commonEn from '@/locales/en/common.json'

vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))

const source = {
  id: 'catalog-public', provider: 'github', base_url: 'https://github.com/',
  auth_kind: 'none', has_token: false,
  repos: [{ id: 'repo-1', owner: 'range42', repo: 'range42-catalog', branch: 'main' }],
}
const page = (items) => ({ items, total: items.length, offset: 0, limit: 100 })
const response = (body, status = 200) => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
)
let wrapper
let fetchMock

async function mountPage() {
  wrapper = mount(Sources, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { sources: sourcesEn, common: commonEn } } })],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  fetchMock = vi.fn().mockResolvedValue(response(page([])))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

describe('catalog source onboarding', () => {
  it('loads backend Page.items and displays the repository and branch', async () => {
    fetchMock.mockResolvedValueOnce(response(page([source])))
    await mountPage()
    expect(wrapper.find('[data-source-id="catalog-public"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('range42/range42-catalog')
    expect(wrapper.text()).toContain('main')
  })

  it('connects the public default without a token and displays the refresh count', async () => {
    fetchMock
      .mockResolvedValueOnce(response(page([])))
      .mockResolvedValueOnce(response(source))
      .mockResolvedValueOnce(response({ source_id: source.id, repos_seen: 1, entries_indexed: 42, finished_at: '2026-09-10T12:00:00Z' }))
    await mountPage()
    const connect = wrapper.find('[data-testid="connect-default-source"]')
    expect(connect.exists()).toBe(true)
    await connect.trigger('click')
    await flushPromises()
    const request = fetchMock.mock.calls.find(([url]) => url.endsWith('/sources/default'))
    expect(request[1].method).toBe('POST')
    expect(request[1].body).toBeUndefined()
    expect(wrapper.find('[data-source-id="catalog-public"]').text()).toContain('42')
    expect(useInventoryStore().getToken(source.id)).toBeNull()
  })

  it.each([
    { auth_kind: 'pat', has_token: true },
    { auth_kind: 'ssh' },
    { provider: 'generic' },
    { repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'development' }] },
    { repos: [...source.repos, { owner: 'range42', repo: 'another-repository', branch: 'main' }] },
  ])('still offers the recommended default when an existing source differs: %j', async (override) => {
    fetchMock.mockResolvedValueOnce(response(page([{ ...source, ...override }])))
    await mountPage()
    expect(wrapper.find('[data-testid="connect-default-source"]').exists()).toBe(true)
  })

  it('retains a source and reports an API error when backend deletion fails', async () => {
    fetchMock
      .mockResolvedValueOnce(response(page([source])))
      .mockResolvedValueOnce(response({ message: 'Source is in use' }, 409))
    await mountPage()
    const remove = wrapper.find('[data-source-id="catalog-public"] button[aria-label^="Remove"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-source-id="catalog-public"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('Source is in use')
  })

  it('keeps a newly registered default visible when repository refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(response(page([])))
      .mockResolvedValueOnce(response(source))
      .mockResolvedValueOnce(response({ message: 'Repository is unreachable' }, 502))
    await mountPage()
    const connect = wrapper.find('[data-testid="connect-default-source"]')
    expect(connect.exists()).toBe(true)
    await connect.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-source-id="catalog-public"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('Repository is unreachable')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(useInventoryStore().getSource(source.id).health.status).toBe('down')
  })

  it('routes sources to the selected backend and drops the previous backend mirror on switch', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://backend-a.test', token: 'gateway-token' })
    fetchMock.mockResolvedValueOnce(response(page([source])))
    await mountPage()
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend-a.test/v1/catalog/sources')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer gateway-token')
    const other = backend.addHost({ url: 'https://backend-b.test' })
    fetchMock.mockResolvedValueOnce(response(page([])))
    backend.setActiveHost(other)
    await flushPromises()
    expect(wrapper.find('[data-source-id="catalog-public"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('https://backend-b.test/v1/catalog/sources')
  })

  it('saves a rotated token on the backend without persisting it in browser storage', async () => {
    fetchMock
      .mockResolvedValueOnce(response(page([source])))
      .mockResolvedValueOnce(response({ ...source, auth_kind: 'pat', has_token: true }))
    await mountPage()
    const rotate = wrapper.find('[data-source-id="catalog-public"] button[aria-label^="Rotate"]')
    expect(rotate.exists()).toBe(true)
    await rotate.trigger('click')
    await wrapper.find('[data-testid="rotate-token-input"]').setValue('new-private-token')
    await wrapper.find('[data-testid="save-source-token"]').trigger('click')
    await flushPromises()
    const [, init] = fetchMock.mock.calls.find(([, options]) => options.method === 'PATCH')
    expect(JSON.parse(init.body)).toEqual({ auth_kind: 'pat', token_ref: 'new-private-token' })
    expect(useInventoryStore().getToken(source.id)).toBeNull()
    expect(localStorage.getItem('range42_git_sources')).not.toContain('new-private-token')
  })

  it('keeps repository input and API errors in the dialog after failed registration', async () => {
    fetchMock
      .mockResolvedValueOnce(response(page([])))
      .mockResolvedValueOnce(response({ message: 'Repository already registered' }, 409))
    await mountPage()
    await wrapper.find('header button').trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    await dialog.find('input[type="text"]').setValue('https://github.com/acme/inventory.git')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[role="dialog"] [role="alert"]').text()).toContain('Repository already registered')
    expect(wrapper.find('[role="dialog"] input[type="text"]').element.value).toBe('https://github.com/acme/inventory.git')
    expect(useInventoryStore().sources).toHaveLength(0)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      provider: 'github', base_url: 'https://github.com', auth_kind: 'none',
      repos: [{ owner: 'acme', repo: 'inventory', branch: 'main' }],
    })
  })

  it('ignores a previous backend source list that finishes after switching hosts', async () => {
    let finishPrevious
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishPrevious = resolve }))
    await mountPage()
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://backend-new.test' })
    await flushPromises()
    finishPrevious(response(page([source])))
    await flushPromises()
    expect(useInventoryStore().sources).toHaveLength(0)
    expect(useInventoryStore().sourcesBackendScope).toBe('https://backend-new.test')
  })
})
