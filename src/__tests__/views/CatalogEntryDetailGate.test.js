import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogEntryDetail from '@/views/CatalogEntryDetail.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import catalogEn from '@/locales/en/catalog.json'
import commonEn from '@/locales/en/common.json'

const ENTRY = {
  kind: 'lab',
  name: 'Web Recon',
  source_id: 'src-ro',
  path: 'labs/web',
  sha: 'abc1234',
  tags: ['web'],
}

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { catalog: catalogEn, common: commonEn } },
  })
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/catalog', name: 'catalog', component: { template: '<div/>' } },
      { path: '/catalog/:source/:entry', name: 'catalog-entry', component: { template: '<div/>' } },
      { path: '/project/:id', name: 'project', component: { template: '<div/>' } },
    ],
  })
}

async function mountDetail({ writable }) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const inv = useInventoryStore()
  inv.addSource({
    id: 'src-ro',
    provider: 'gitlab',
    base_url: 'https://gl.example',
    auth: { kind: 'none' },
    repos: [],
    writable,
  })
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ENTRY })

  const router = makeRouter()
  router.push('/catalog/src-ro/labs%2Fweb')
  await router.isReady()

  const wrapper = mount(CatalogEntryDetail, {
    global: { plugins: [pinia, makeI18n(), router], stubs: { CatalogProjectHandoff: true } },
  })
  // Entry loading includes IndexedDB and dynamic imports. Wait for its rendered
  // result instead of assuming a fixed number of event-loop turns completes it.
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper.find('[data-testid="entry-verbs"]').exists()).toBe(true)
  })
  return wrapper
}

function customizeButton(wrapper) {
  return wrapper
    .findAll('[data-testid="entry-verbs"] button')
    .find((b) => b.text() === catalogEn.verbs.customize)
}

describe('CatalogEntryDetail — customize gating by write access', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows customizing a read-only original through a separate destination review', async () => {
    const wrapper = await mountDetail({ writable: false })
    const btn = customizeButton(wrapper)
    expect(btn).toBeTruthy()
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(wrapper.findComponent(CatalogProjectHandoff).props()).toMatchObject({ entry: ENTRY, mode: 'customize' })
  })

  it('enables the customize button when the source is writable', async () => {
    const wrapper = await mountDetail({ writable: true })
    const btn = customizeButton(wrapper)
    expect(btn).toBeTruthy()
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('enables the customize button when write access is unknown', async () => {
    const wrapper = await mountDetail({ writable: undefined })
    const btn = customizeButton(wrapper)
    expect(btn).toBeTruthy()
    expect(btn.attributes('disabled')).toBeUndefined()
  })
})
