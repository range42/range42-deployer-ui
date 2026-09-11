import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import catalog from '@/locales/en/catalog.json'
import publishing from '@/locales/en/publishing.json'

const { getEntry, provider } = vi.hoisted(() => ({ getEntry: vi.fn(), provider: { canWrite: vi.fn(), listCommits: vi.fn(), listTree: vi.fn() } }))
vi.mock('@/composables/useCatalog', () => ({ useCatalog: () => ({ getEntry }) }))
vi.mock('@/services/git', () => ({ getProvider: () => provider }))
vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)
const entry = { name: 'Example', kind: 'lab', source_id: 'source', path: 'labs/example', sha: 'a'.repeat(40), document: {
  schema_version: '1.0', kind: 'lab', name: 'Example', nodes: [{ id: 'vm', kind: 'vm', template_vmid: 9901 }],
} }
const binding = { source_id: 'source', provider: 'github', base_url: 'https://github.com', repo_owner: 'me', repo_name: 'work',
  branch: 'main', branch_strategy: 'shared_repo_subdir', subdir: 'projects/example', fork_policy: 'upstream' }
async function modal() {
  const pinia = createPinia(); setActivePinia(pinia)
  const inventory = useInventoryStore()
  inventory.sources = [{ id: 'source', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' },
    repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }], writable: false }]
  inventory.setToken('source', 'test-owner')
  const wrapper = mount(CatalogProjectHandoff, { props: { entry, mode: 'customize' }, global: {
    plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { catalog, publishing } } })],
    stubs: { ProjectRepositoryConnection: { name: 'ProjectRepositoryConnection', props: ['open', 'binding'], emits: ['close', 'connected'], template: '<div data-testid="connection" />' } },
  } })
  await flushPromises()
  return { wrapper, inventory, projects: useProjectStore() }
}
async function review(wrapper) {
  wrapper.findComponent({ name: 'ProjectRepositoryConnection' }).vm.$emit('connected', binding)
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  getEntry.mockResolvedValue(structuredClone(entry))
  provider.canWrite.mockResolvedValue(true)
  provider.listTree.mockResolvedValue([])
  provider.listCommits.mockImplementation(async ({ ref }) => {
    if (ref.startsWith('range42-ui/')) throw Object.assign(new Error('Missing'), { status: 404 })
    return [{ sha: 'b'.repeat(40) }]
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('catalog project handoff dialog', () => {
  it('requires reviewed confirmation and persists a bound populated project without replacing the catalog source', async () => {
    const { wrapper, inventory, projects } = await modal()
    await review(wrapper)
    expect(projects.projects).toHaveLength(0)
    expect(wrapper.get('[data-testid="catalog-handoff-preview"]').text()).toContain('b'.repeat(40))
    await wrapper.get('[data-testid="catalog-handoff-import"]').trigger('click')
    expect(projects.projects).toHaveLength(1)
    const saved = JSON.parse(localStorage.getItem('range42_projects'))[0]
    expect(saved.nodes[0].id).toBe('vm')
    expect(saved.git.repo_owner).toBe('me')
    expect(saved.catalogRef.repo_owner).toBe('range42')
    expect(inventory.sources[0].writable).toBe(false)
    expect(wrapper.emitted('opened')[0][0].id).toBe(saved.id)
  })
  it('cancels without a project and ignores a late destination response after unmount', async () => {
    const { wrapper, projects } = await modal()
    let finish
    provider.canWrite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await review(wrapper)
    await wrapper.get('[data-testid="catalog-handoff-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount(); finish(true); await flushPromises()
    expect(projects.projects).toHaveLength(0)
    expect(wrapper.emitted('opened')).toBeUndefined()
  })
  it('invalidates preview on credential rotation before import', async () => {
    const { wrapper, inventory, projects } = await modal()
    await review(wrapper)
    inventory.setToken('source', 'replacement-owner')
    await wrapper.get('[data-testid="catalog-handoff-import"]').trigger('click')
    expect(projects.projects).toHaveLength(0)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
  })
  it('reports a changed source during initial loading instead of leaving an endless spinner', async () => {
    let finish
    getEntry.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, inventory, projects } = await modal()
    inventory.sources[0].base_url = 'https://different.example'
    await flushPromises()
    finish(entry)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
    expect(projects.projects).toHaveLength(0)
  })
  it.each([{ sha: 'c'.repeat(40) }, { kind: 'ansible_role' }])('invalidates same-path refreshed selections %j without reusing the old detail', async change => {
    const { wrapper, projects } = await modal()
    await review(wrapper)
    await wrapper.setProps({ entry: { ...entry, ...change } })
    await flushPromises()
    expect(wrapper.find('[data-testid="catalog-handoff-import"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
    expect(wrapper.findComponent({ name: 'ProjectRepositoryConnection' }).exists()).toBe(false)
    expect(projects.projects).toHaveLength(0)
  })
  it.each(['base_url', 'repos'])('requires reopening after origin %s changes so old detail cannot be relabeled', async field => {
    const { wrapper, inventory, projects } = await modal()
    await review(wrapper)
    if (field === 'base_url') inventory.sources[0].base_url = 'https://new-origin.example'
    else inventory.sources[0].repos = [{ owner: 'different', repo: 'repository', branch: 'main' }]
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
    expect(wrapper.find('[data-testid="catalog-handoff-import"]').exists()).toBe(false)
    expect(wrapper.findAll('button').map(button => button.text())).not.toContain(catalog.handoff.back)
    expect(projects.projects).toHaveLength(0)
  })
  it('keeps existing projects intact on local storage failure and permits retry', async () => {
    const { wrapper, projects } = await modal()
    projects.createProject('existing')
    await review(wrapper)
    const storage = localStorage
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota') } })
    await wrapper.get('[data-testid="catalog-handoff-import"]').trigger('click')
    expect(projects.projects.map(project => project.name)).toEqual(['existing'])
    expect(wrapper.get('[role="alert"]').text()).toMatch(/storage/i)
    vi.unstubAllGlobals()
    await wrapper.get('[data-testid="catalog-handoff-import"]').trigger('click')
    expect(projects.projects).toHaveLength(2)
  })
  it('reports unresolved content with the original source visible and creates nothing', async () => {
    getEntry.mockResolvedValueOnce({ ...entry, document: { ...entry.document, defaults: { files: ['missing.bin'] } } })
    const { wrapper, projects } = await modal()
    await review(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('defaults')
    expect(wrapper.text()).toContain('labs/example')
    expect(projects.projects).toHaveLength(0)
  })
})
