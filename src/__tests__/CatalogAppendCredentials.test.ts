import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import catalog from '@/locales/en/catalog.json'
import role from './fixtures/catalogRoleNtp.json'

const { getEntry } = vi.hoisted(() => ({ getEntry: vi.fn() }))
vi.mock('@/composables/useCatalog', () => ({ useCatalog: () => ({ getEntry }) }))
vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

const entry = { name: 'Private role', kind: 'ansible_role', source_id: 'private', path: role.path, sha: role.sha }
const source = { id: 'private', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'pat' as const }, has_token: true,
  repos: [{ owner: 'owner', repo: 'private-catalog', branch: 'main' }] }
const original = { id: 'training', name: 'Training', nodes: [{ id: 'vm', type: 'vm', position: { x: 100, y: 100 }, data: { label: 'VM', config: { template: 9901 } } }], edges: [], files: { 'notes.txt': 'keep' },
  git: { source_id: 'destination', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner', repo_name: 'different-project', working_branch: 'range42-ui/training' } }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function privateProvider(url: string, init?: RequestInit) {
  if (new Headers(init?.headers).get('Authorization') !== 'Bearer private-read-token') return response({ message: 'Not Found' }, 404)
  if (url.includes('/git/trees/')) return response({ tree: role.tree, truncated: false })
  const path = decodeURIComponent(new URL(url).pathname.split('/contents/')[1]) as keyof typeof role.files
  if (!Object.hasOwn(role.files, path)) throw new Error('Unexpected fixture provider request')
  return response({ content: btoa(role.files[path]), encoding: 'base64', sha: role.tree.find(row => row.path === path)!.sha })
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); getEntry.mockResolvedValue(entry) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function modal(savedToken?: string) {
  const pinia = createPinia(); setActivePinia(pinia)
  const backend = useBackendApiStore()
  backend.addHost({ url: 'https://backend-a.test', token: 'backend-only-token' })
  const inventory = useInventoryStore(); inventory.syncSources([source], backend.url)
  if (savedToken) inventory.setToken(source.id, savedToken)
  const projects = useProjectStore(); projects.importProject(structuredClone(original), { generateNewId: false })
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => privateProvider(String(input), init))
  vi.stubGlobal('fetch', fetch)
  const wrapper = mount(CatalogAppendDialog, { props: { entry, initialProjectId: original.id, initialNodeId: 'vm' },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { catalog } } })] } })
  await flushPromises()
  return { wrapper, backend, inventory, projects, fetch }
}
type Wrapper = Awaited<ReturnType<typeof modal>>['wrapper']
async function review(wrapper: Wrapper) { await wrapper.get('[data-testid="catalog-append-review"]').trigger('click'); await flushPromises() }
async function saveToken(wrapper: Wrapper, token = 'private-read-token') {
  await wrapper.get('[data-testid="catalog-read-token"]').setValue(token)
  await wrapper.get('[data-testid="catalog-read-access"] form').trigger('submit')
  await flushPromises()
}

describe('private catalog append credentials', () => {
  it('recovers a private provider 404 through explicit browser credentials without rebinding the project', async () => {
    const { wrapper, fetch, projects, inventory } = await modal()
    await review(wrapper)
    expect(wrapper.get('#catalog-append-error').text()).toMatch(/404/)
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
    const reads = fetch.mock.calls.length
    await saveToken(wrapper)
    expect(fetch).toHaveBeenCalledTimes(reads)
    expect(getEntry).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="catalog-read-token"]').element).toHaveProperty('value', '')
    expect(wrapper.get('[data-testid="catalog-read-credential-status"]').text()).toMatch(/saved/i)
    expect(inventory.getToken(source.id)).toBe('private-read-token')
    expect(projects.getProject(original.id)?.git).toEqual(original.git)
    expect(wrapper.get('[name="target-node"]').element).toHaveProperty('value', 'vm')
    await review(wrapper)
    expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(true)
    await wrapper.get('[data-testid="catalog-append-keep"]').trigger('click')
    const saved = projects.getProject(original.id)!
    expect(saved.git).toEqual(original.git)
    expect(saved.files?.[`${role.path}/tasks/main.yml`]).toBe(role.files[`${role.path}/tasks/main.yml`])
    expect(saved.scenario?.content).toEqual(expect.arrayContaining([expect.objectContaining({ target_node: 'vm', path: role.path })]))
    expect(JSON.stringify(saved)).not.toContain('private-read-token')
    expect(fetch.mock.calls.every(([url, init]) => String(url).startsWith('https://api.github.com/') && (!init?.method || init.method === 'GET'))).toBe(true)
    expect(fetch.mock.calls.slice(reads).every(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer private-read-token')).toBe(true)
  })

  it('never prefills an existing token and exposes a failed storage write without replacing it', async () => {
    const { wrapper, inventory, fetch, projects } = await modal('previous-token')
    expect(wrapper.get('[data-testid="catalog-read-token"]').element).toHaveProperty('value', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-storage-diagnostic') })
    await saveToken(wrapper)
    expect(wrapper.get('[data-testid="catalog-read-credential-error"]').text()).toMatch(/storage|store/i)
    expect(wrapper.text()).not.toContain('private-storage-diagnostic')
    expect(wrapper.text()).not.toContain('private-read-token')
    expect(wrapper.get('[data-testid="catalog-read-token"]').element).toHaveProperty('value', '')
    expect(inventory.getToken(source.id)).toBe('previous-token')
    expect(projects.getProject(original.id)?.git).toEqual(original.git)
    expect(fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('clears an unsubmitted credential on backend changes and scopes saved tokens to their source and backend', async () => {
    const { wrapper, backend, inventory, projects, fetch } = await modal('token-for-a')
    const first = backend.activeHost!.id
    await wrapper.get('[data-testid="catalog-read-token"]').setValue('unsubmitted-for-a')
    const second = backend.addHost({ url: 'https://backend-b.test', token: 'other-backend-token' })
    backend.setActiveHost(second); inventory.syncSources([source, { ...source, id: 'other-source' }], backend.url)
    await flushPromises()
    expect(wrapper.get('[data-testid="catalog-read-token"]').element).toHaveProperty('value', '')
    expect(inventory.getToken(source.id)).toBeNull()
    await saveToken(wrapper)
    expect(inventory.getToken(source.id)).toBe('private-read-token')
    expect(inventory.getToken('other-source')).toBeNull()
    backend.setActiveHost(first); inventory.syncSources([source], backend.url)
    await flushPromises()
    expect(inventory.getToken(source.id)).toBe('token-for-a')
    expect(wrapper.get('[name="project"]').element).toHaveProperty('value', original.id)
    expect(wrapper.get('[name="target-node"]').element).toHaveProperty('value', 'vm')
    expect(projects.getProject(original.id)?.git).toEqual(original.git)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears an unsubmitted credential when another source is selected', async () => {
    const { wrapper, inventory, backend } = await modal()
    await wrapper.get('[data-testid="catalog-read-token"]').setValue('unsubmitted-for-private')
    inventory.syncSources([source, { ...source, id: 'other-source' }], backend.url)
    await wrapper.setProps({ entry: { ...entry, source_id: 'other-source' } })
    expect(wrapper.get('[data-testid="catalog-read-token"]').element).toHaveProperty('value', '')
    expect(inventory.getToken(source.id)).toBeNull()
    expect(inventory.getToken('other-source')).toBeNull()
  })

  it('invalidates an in-flight review when the browser credential changes', async () => {
    const { wrapper, fetch, projects } = await modal()
    let finish!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('[data-testid="catalog-append-review"]').trigger('click')
    await flushPromises()
    await saveToken(wrapper)
    finish(response({ tree: role.tree, truncated: false })); await flushPromises()
    expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(false)
    expect(projects.getProject(original.id)?.files).toEqual(original.files)
    await review(wrapper)
    expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(true)
  })

  it('invalidates a prepared review after another tab changes the scoped browser credential', async () => {
    const { wrapper, inventory } = await modal('private-read-token')
    await review(wrapper)
    expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(true)
    inventory.setToken(source.id, 'rotated-in-another-tab')
    window.dispatchEvent(new StorageEvent('storage', { key: 'range42_token_https%3A%2F%2Fbackend-a.test:private' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(false)
    expect(wrapper.get('#catalog-append-error').text()).toMatch(/changed/i)
  })
})
