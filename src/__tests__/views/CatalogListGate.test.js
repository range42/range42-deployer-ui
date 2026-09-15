import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogList from '@/views/CatalogList.vue'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogTile from '@/components/ui/CatalogTile.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import catalogEn from '@/locales/en/catalog.json'
import commonEn from '@/locales/en/common.json'
import sourcesEn from '@/locales/en/sources.json'

enableAutoUnmount(afterEach)

const PAGE = {
  items: [
    { kind: 'lab', name: 'Web Recon', source_id: 'src-ro', path: 'labs/web', tags: ['web'] },
    { kind: 'lab', name: 'Net Recon', source_id: 'src-rw', path: 'labs/net', tags: ['net'] },
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
  inv.addSource({ id: 'src-ro', provider: 'gitlab', base_url: 'https://gl.example', auth: { kind: 'none' }, repos: [], writable: false })
  inv.addSource({ id: 'src-rw', provider: 'gitlab', base_url: 'https://gl.example', auth: { kind: 'none' }, repos: [], writable: true })

  const wrapper = mount(CatalogList, {
    global: { plugins: [pinia, makeI18n(), makeRouter()], stubs: { CatalogProjectHandoff: true } },
  })
  await vi.waitFor(() => expect(wrapper.findAll('[data-testid="catalog-grid"] article[data-kind]')).toHaveLength(PAGE.items.length))
  return wrapper
}

function tileFor(wrapper, sourceId) {
  return wrapper.findAllComponents(CatalogTile).find((c) => c.props('entry').source_id === sourceId)
}

describe('CatalogList — customize gating by write access', () => {
  beforeEach(() => {
    localStorage.clear()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => PAGE })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a destination handoff without creating a project for a read-only source', async () => {
    const wrapper = await mountList()
    const projects = useProjectStore()
    const before = projects.projects.length

    await tileFor(wrapper, 'src-ro').vm.$emit('customize', PAGE.items[0])
    await flushPromises()

    expect(projects.projects.length).toBe(before)
    expect(wrapper.findComponent(CatalogProjectHandoff).props()).toMatchObject({ entry: PAGE.items[0], mode: 'customize' })
  })

  it('shows a read-only badge on tiles backed by a read-only source only', async () => {
    const wrapper = await mountList()
    const roTileWrap = tileFor(wrapper, 'src-ro').element.parentElement
    const rwTileWrap = tileFor(wrapper, 'src-rw').element.parentElement
    expect(roTileWrap.querySelector('[data-testid="tile-readonly-badge"]')).not.toBeNull()
    expect(rwTileWrap.querySelector('[data-testid="tile-readonly-badge"]')).toBeNull()
  })

  it('also requires a reviewed destination for a writable source', async () => {
    const wrapper = await mountList()
    const projects = useProjectStore()
    const before = projects.projects.length

    await tileFor(wrapper, 'src-rw').vm.$emit('customize', PAGE.items[1])
    await flushPromises()

    expect(projects.projects.length).toBe(before)
    const handoff = wrapper.findComponent(CatalogProjectHandoff)
    expect(handoff.props()).toMatchObject({ entry: PAGE.items[1], mode: 'customize' })
    await handoff.vm.$emit('close')
    await flushPromises()
    expect(wrapper.findComponent(CatalogProjectHandoff).exists()).toBe(false)
  })
})
