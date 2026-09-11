import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogList from '@/views/CatalogList.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import catalogEn from '@/locales/en/catalog.json'
import commonEn from '@/locales/en/common.json'
import sourcesEn from '@/locales/en/sources.json'

enableAutoUnmount(afterEach)

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

async function mountList(seedSource = true) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const inv = useInventoryStore()
  if (seedSource) inv.addSource({ id: 'src-a', provider: 'gitlab', base_url: 'https://gl.example', auth: { kind: 'none' }, repos: [] })

  const wrapper = mount(CatalogList, {
    global: {
      plugins: [pinia, makeI18n(), makeRouter()],
      stubs: {
        PublishTargetsModal: {
          name: 'PublishTargetsModal',
          props: ['open', 'projectId', 'files', 'message', 'createOnly', 'componentPath'],
          template: '<div v-if="open" data-testid="publish-role-targets" />',
        },
      },
    },
  })
  await vi.waitFor(() => expect(wrapper.findAll('[data-testid="catalog-grid"] article[data-kind]')).toHaveLength(PAGE.items.length))
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

  it('shows backend entries on a fresh browser without a local source mirror', async () => {
    const wrapper = await mountList(false)
    expect(gridKinds(wrapper)).toEqual(['lab', 'container'])
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

  it('passes reviewed new role files to the shared publisher with create-only protection', async () => {
    const wrapper = await mountList()
    await wrapper.get('[data-testid="new-catalog-role"]').trigger('click')
    const role = wrapper.findComponent({ name: 'NewRoleModal' })
    await role.get('[name="target"]').setValue('example')
    await role.get('[name="description"]').setValue('Install example')
    await role.get('[name="tasks"]').setValue('- name: Install example\n  ansible.builtin.package:\n    name: example\n')
    await role.get('form').trigger('submit')
    await role.get('[data-testid="role-continue"]').trigger('click')
    const publisher = wrapper.findComponent({ name: 'PublishTargetsModal' })
    expect(publisher.props('open')).toBe(true)
    expect(publisher.props('createOnly')).toBe(true)
    expect(publisher.props('componentPath')).toBe('02_ansible_layer/admin/roles/software.install.example')
    expect(Object.keys(publisher.props('files'))).toHaveLength(4)
    expect(publisher.props('projectId')).toMatch(/^catalog-role-/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    await publisher.vm.$emit('close')
    await flushPromises()
    expect(role.get('[name="target"]').element.value).toBe('example')
  })
})
