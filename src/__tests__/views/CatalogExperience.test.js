import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogList from '@/views/CatalogList.vue'
import CatalogEntryDetail from '@/views/CatalogEntryDetail.vue'
import { useProjectStore } from '@/stores/projectStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import catalog from '@/locales/en/catalog.json'
import common from '@/locales/en/common.json'
import sources from '@/locales/en/sources.json'

vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

const source = { id: 'public', provider: 'github', base_url: 'https://github.com', auth_kind: 'none', has_token: false,
  repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
const machine = { kind: 'component', name: 'Training machine', source_id: source.id, path: 'machines/training', sha: 'a'.repeat(40), tags: ['web'],
  document: { schema_version: '1.0', kind: 'component', name: 'Training machine', nodes: [{ id: 'vm', kind: 'vm', template_vmid: 9901, config: { cores: 2, memory_mb: 2048 } }] } }
let entries, sourcesFail

async function open(path = '/catalog?project=training') {
  const pinia = createPinia(); setActivePinia(pinia)
  const projects = useProjectStore(pinia)
  localStorage.setItem('range42_projects', JSON.stringify([{ id: 'training', name: 'My training', nodes: [], edges: [], files: {} }]))
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/catalog', component: CatalogList },
    { path: '/catalog/:source/:entry', name: 'catalog-entry', component: CatalogEntryDetail },
    { path: '/project/:id', component: { template: '<div />' } },
    { path: '/sources', component: { template: '<div />' } },
  ] })
  await router.push(path)
  const wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: {
    stubs: { VueFlow: true },
    plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en: { catalog, common, sources } } })],
  } })
  await vi.waitFor(() => expect(wrapper.find('h1').exists()).toBe(true))
  await flushPromises()
  return { wrapper, router, projects, inventory: useInventoryStore() }
}

beforeEach(() => {
  localStorage.clear(); entries = [machine]; sourcesFail = false
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url), 'http://localhost').pathname
    if (path === '/v1/catalog/sources') return sourcesFail
      ? { ok: false, status: 503, json: async () => ({ message: 'Source service unavailable' }) }
      : { ok: true, json: async () => ({ items: [source], total: 1 }) }
    if (path === '/v1/catalog/entries') return { ok: true, json: async () => ({ items: entries, total: entries.length }) }
    const entry = entries.find(item => path === `/v1/catalog/entries/${item.source_id}/${item.path}`)
    if (entry) return { ok: true, json: async () => entry }
    throw new Error(`Unexpected request ${path}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Catalog browsing and onboarding', () => {
  it.each(['/catalog?project=training', '/catalog/public/machines%2Ftraining?project=training'])('reviews a public item in a fresh browser at %s without visiting Sources', async path => {
    const { wrapper, projects, inventory } = await open(path)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="catalog-add-to-project"]').exists()).toBe(true))
    await wrapper.get('[data-testid="catalog-add-to-project"]').trigger('click')
    await wrapper.get('[data-testid="catalog-append-review"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="catalog-append-preview"]').exists()).toBe(true))
    expect(inventory.getSource('public').repos[0].repo).toBe('catalog')
    expect(projects.getProject('training').nodes).toHaveLength(0)
    await wrapper.get('[data-testid="catalog-append-keep"]').trigger('click')
    expect(projects.getProject('training').nodes).toHaveLength(1)
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  it('keeps entries readable and offers retry when source hydration fails', async () => {
    sourcesFail = true
    const { wrapper } = await open()
    await vi.waitFor(() => expect(wrapper.find('[data-testid="catalog-source-error"]').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.text()).toContain('Training machine'))
    expect(wrapper.get('[data-testid="catalog-add-to-project"]').attributes('disabled')).toBeDefined()
    sourcesFail = false
    await wrapper.get('[data-testid="catalog-source-retry"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="catalog-add-to-project"]').attributes('disabled')).toBeUndefined())
  })

  it('offers only supported actions for containers and unknown entries on cards and detail', async () => {
    entries = [{ ...machine, kind: 'container', name: 'Compose workload' }, { ...machine, kind: 'unknown', name: 'Other format', path: 'other' }]
    const { wrapper, router } = await open()
    await vi.waitFor(() => expect(wrapper.findAll('article[data-kind]')).toHaveLength(2))
    const container = wrapper.get('article[data-kind="container"]')
    expect(container.find('[data-testid="catalog-add-to-project"]').exists()).toBe(true)
    expect(container.text()).not.toContain(catalog.verbs.use)
    expect(container.text()).not.toContain(catalog.verbs.customize)
    expect(container.text()).not.toContain(catalog.verbs.fork)
    expect(wrapper.get('article[data-kind="unknown"]').find('button').exists()).toBe(false)
    await router.push('/catalog/public/machines%2Ftraining')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="entry-verbs"]').exists()).toBe(true))
    expect(wrapper.get('[data-testid="entry-verbs"]').findAll('button')).toHaveLength(1)
  })

  it('renders readable Markdown headings, paragraphs, lists and code while keeping raw source available', async () => {
    entries = [{ ...machine, readme_md: '# Install\n\nRead the **instructions**.\n\n- First\n- Second\n\n```sh\necho hello\n```' }]
    const { wrapper } = await open('/catalog/public/machines%2Ftraining')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="catalog-readme-preview"] h3').exists()).toBe(true))
    const preview = wrapper.get('[data-testid="catalog-readme-preview"]')
    expect(preview.get('h3').text()).toBe('Install')
    expect(preview.get('p strong').text()).toBe('instructions')
    expect(preview.findAll('ul li').map(item => item.text())).toEqual(['First', 'Second'])
    expect(preview.get('pre code').element.textContent).toBe('echo hello\n')
    expect(wrapper.get('[data-testid="catalog-readme-source"] pre').element.textContent).toBe(entries[0].readme_md)
  })

  it.each([
    '[bad](javascript:alert%281%29)',
    '[bad](jav&#x61;script:alert%281%29)',
    '[bad](vbscript:msgbox%281%29)',
    '[bad](data:text/html;base64,PHNjcmlwdD4=)',
    '<a href="javascript:alert(1)">bad</a><img src="https://images.example/tracker" onerror="alert(1)">',
    '<script>window.catalogXss = true</script><iframe src="https://images.example/embed"></iframe>',
  ])('keeps unsafe README content inert while rendering safe links: %s', async dangerous => {
    entries = [{ ...machine, readme_md: `[Documentation](https://docs.example/guide)\n\n${dangerous}\n\n![Diagram](https://images.example/diagram.svg)` }]
    const { wrapper } = await open('/catalog/public/machines%2Ftraining')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="catalog-readme-preview"] a').exists()).toBe(true))
    const preview = wrapper.get('[data-testid="catalog-readme-preview"]')
    expect(preview.find('script, iframe, img, object, style, [onerror], [onclick]').exists()).toBe(false)
    expect(preview.findAll('a').map(link => link.attributes('href'))).toEqual(['https://docs.example/guide', 'https://images.example/diagram.svg'])
    expect(preview.get('a').attributes('rel')).toContain('noreferrer')
    expect(window.catalogXss).toBeUndefined()
  })

  it('retains filters, shown results and project context through detail links and browser history', async () => {
    entries = Array.from({ length: 55 }, (_, index) => ({ ...machine, name: `Training machine ${index}`, path: `machines/${index}` }))
    const { wrapper, router } = await open('/catalog?project=training&node=original&q=Training&kind=component&shown=48')
    await vi.waitFor(() => expect(wrapper.findAll('article[data-kind]')).toHaveLength(48))
    expect(wrapper.get('#catalog-search').element.value).toBe('Training')
    const link = wrapper.get('article h3 a')
    await link.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="entry-verbs"]').exists()).toBe(true))
    await wrapper.get('a[href^="/catalog?"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('article[data-kind]')).toHaveLength(48))
    expect(router.currentRoute.value.query).toMatchObject({ project: 'training', node: 'original', q: 'Training', kind: 'component', shown: '48' })
    await wrapper.get('#catalog-search').setValue('machine 54')
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('machine 54')
    expect(router.currentRoute.value.query.shown).toBeUndefined()
    expect(wrapper.findAll('article[data-kind]')).toHaveLength(1)
    await router.push('/catalog?q=absent')
    await flushPromises()
    expect(wrapper.get('#catalog-search').element.value).toBe('absent')
    router.back()
    await vi.waitFor(() => expect(wrapper.get('#catalog-search').element.value).toBe('machine 54'))
  })
})
