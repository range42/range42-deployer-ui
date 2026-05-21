import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogList from '@/views/CatalogList.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import catalogEn from '@/locales/en/catalog.json'
import commonEn from '@/locales/en/common.json'
import sourcesEn from '@/locales/en/sources.json'

// Two entries from the SAME source but DIFFERENT kinds, so that kind filtering
// is exercised in isolation from source filtering.
const PAGE = {
  items: [
    { kind: 'lab', name: 'Web Recon', source_id: 'src-a', path: 'labs/web', tags: ['web'] },
    { kind: 'container', name: 'SQLi Box', source_id: 'src-a', path: 'cve/web/sqli', tags: ['web', 'sqli'] },
  ],
  total: 2,
  offset: 0,
  limit: 500,
}

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { catalog: catalogEn, common: commonEn, sources: sourcesEn } },
  })
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/sources', name: 'sources', component: { template: '<div/>' } },
      { path: '/catalog/:source/:entry', name: 'catalog-entry', component: { template: '<div/>' } },
      { path: '/project/:id', name: 'project', component: { template: '<div/>' } },
    ],
  })
}

async function mountList() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const inv = useInventoryStore()
  inv.addSource({ id: 'src-a', provider: 'gitlab', base_url: 'https://gl.example', auth: { kind: 'none' }, repos: [] })

  const wrapper = mount(CatalogList, {
    global: { plugins: [pinia, makeI18n(), makeRouter()] },
  })
  await flushPromises()
  return wrapper
}

function gridKinds(wrapper) {
  return wrapper
    .findAll('[data-testid="catalog-grid"] article[data-kind]')
    .map((el) => el.attributes('data-kind'))
}

function kindButton(wrapper, label) {
  return wrapper.findAll('button').find((b) => b.text() === label)
}

describe('CatalogList — filter wiring (regression guard for server-narrowing bug)', () => {
  beforeEach(() => {
    // The jsdom localStorage mock persists across tests; clear it so each test
    // starts with a fresh inventory store (addSource throws on a duplicate id).
    localStorage.clear()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => PAGE })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all fetched entries and fetches the full set once (no per-filter refetch)', async () => {
    const wrapper = await mountList()
    expect(gridKinds(wrapper)).toEqual(['lab', 'container'])
    // The grid fetches once on mount; the request carries no narrowing filter
    // params (only a limit), since all filtering is client-side.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const url = globalThis.fetch.mock.calls[0][0]
    expect(url).toContain('/v1/catalog/entries')
    expect(url).not.toMatch(/[?&]kind=/)
    expect(url).not.toMatch(/[?&]source_id=/)
  })

  it('narrows to a single kind, then WIDENS to multiple without a refetch (the bug)', async () => {
    const wrapper = await mountList()

    await kindButton(wrapper, 'lab').trigger('click')
    await flushPromises()
    expect(gridKinds(wrapper)).toEqual(['lab'])

    // Widening the selection must surface the second kind from the already-
    // fetched superset — the previous server-narrowing design dropped it here.
    await kindButton(wrapper, 'container').trigger('click')
    await flushPromises()
    expect(gridKinds(wrapper)).toEqual(['lab', 'container'])

    // Still only the initial fetch — filtering never hit the network again.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('applies the free-text search client-side over the fetched set', async () => {
    const wrapper = await mountList()
    await wrapper.find('input[type="search"]').setValue('sqli')
    await flushPromises()
    expect(gridKinds(wrapper)).toEqual(['container'])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
