import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import CatalogList from '@/views/CatalogList.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
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

async function mountList(seedSource = true, backendHost, visibleCount = PAGE.items.length) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (backendHost) useBackendApiStore().addHost(backendHost)
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
  await vi.waitFor(() => expect(wrapper.findAll('[data-testid="catalog-grid"] article[data-kind]')).toHaveLength(visibleCount))
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

  it('reloads and clears private catalog list when backend authentication changes', async () => {
    const wrapper = await mountList()
    expect(wrapper.find('[data-testid="catalog-grid"]').exists()).toBe(true)
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'Denied' }) })
    useBackendApiStore().addHost({ url: 'https://other.example', token: 'different-identity' })
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(wrapper.text()).toContain('backend API token'))
    expect(wrapper.find('[data-testid="catalog-grid"]').exists()).toBe(false)
  })

  it('waits for the complete backend edit before sending its new credential', async () => {
    await mountList(true, { url: 'https://first.example', token: 'old-credential' })
    globalThis.fetch.mockClear()
    const backend = useBackendApiStore()
    backend.updateHost(backend.activeHost.id, { url: 'https://second.example', token: 'new-credential' })
    await flushPromises()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch.mock.calls[0][0]).toContain('https://second.example/')
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer new-credential')
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

  it('offers adding a catalog item to an existing project without starting a repository handoff', async () => {
    const wrapper = await mountList()
    const button = wrapper.find('[data-testid="catalog-add-to-project"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.find('[data-testid="catalog-append-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="connection"]').exists()).toBe(false)
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

  it('renders bounded batches while searching the complete catalog and resets the batch after filtering', async () => {
    const items = Array.from({ length: 73 }, (_, index) => ({
      kind: 'component', name: `Machine ${index}`, source_id: 'src-a', path: `machines/${index}`, tags: [],
    }))
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ items, total: 73, offset: 0, limit: 500 }) })
    const wrapper = await mountList(true, undefined, 24)
    expect(wrapper.get('[data-testid="catalog-visible-count"]').text()).toContain('24 of 73')
    await wrapper.get('[data-testid="catalog-load-more"]').trigger('click')
    expect(gridKinds(wrapper)).toHaveLength(48)
    await wrapper.get('#catalog-search').setValue('Machine 72')
    expect(gridKinds(wrapper)).toHaveLength(1)
    expect(wrapper.find('[data-testid="catalog-load-more"]').exists()).toBe(false)
    await wrapper.get('#catalog-search').setValue('')
    expect(gridKinds(wrapper)).toHaveLength(24)
    for (let i = 0; i < 3; i++) await wrapper.get('[data-testid="catalog-load-more"]').trigger('click')
    expect(gridKinds(wrapper)).toHaveLength(73)
    expect(wrapper.find('[data-testid="catalog-load-more"]').exists()).toBe(false)
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

  it('reviews a portable machine blueprint before passing its files to create-only publication', async () => {
    const wrapper = await mountList()
    await wrapper.get('[data-testid="new-catalog-machine"]').trigger('click')
    const modal = wrapper.findComponent({ name: 'NewMachineModal' })
    await modal.get('[name="target"]').setValue('training_vm')
    await modal.get('[name="description"]').setValue('Training VM with cloud-init')
    await modal.get('[name="os"]').setValue('Ubuntu24.04')
    await modal.get('form').trigger('submit')
    expect(modal.findAll('[data-testid="machine-file-preview"]')).toHaveLength(2)
    await modal.get('[name="cores"]').setValue(4)
    expect(modal.find('[data-testid="machine-continue"]').exists()).toBe(false)
    await modal.get('form').trigger('submit')
    await modal.get('[data-testid="machine-continue"]').trigger('click')
    const publisher = wrapper.findComponent({ name: 'PublishTargetsModal' })
    expect(publisher.props('createOnly')).toBe(true)
    expect(publisher.props('componentPath')).toBe('05_topology_layer/box_templates/systems.clone.training_vm/v1.0.0')
    expect(publisher.props('files')['05_topology_layer/box_templates/systems.clone.training_vm/v1.0.0/range42.yaml']).toContain('cores: 4')
    expect(publisher.props('message')).toContain('VM blueprint')
    await publisher.vm.$emit('close')
    await flushPromises()
    expect(modal.get('[name="target"]').element.value).toBe('training_vm')
  })
  it('reviews a new Compose workload and keeps the draft when returning from publication', async () => {
    const wrapper = await mountList()
    await wrapper.get('[data-testid="new-catalog-container"]').trigger('click')
    const modal = wrapper.findComponent({ name: 'NewContainerModal' })
    await modal.get('[name="target"]').setValue('training_web')
    await modal.get('[name="description"]').setValue('Training web')
    await modal.get('form').trigger('submit')
    expect(modal.findAll('[data-testid="container-file-preview"]')).toHaveLength(3)
    await modal.get('[name="compose"]').setValue('services:\n  web:\n    image: nginx:alpine\n    ports: ["8081:80"]\n')
    expect(modal.find('[data-testid="container-continue"]').exists()).toBe(false)
    await modal.get('form').trigger('submit')
    await modal.get('[data-testid="container-continue"]').trigger('click')
    const publisher = wrapper.findComponent({ name: 'PublishTargetsModal' })
    expect(publisher.props('createOnly')).toBe(true)
    expect(publisher.props('componentPath')).toBe('03_container_layer/docker/admin/training_web')
    expect(publisher.props('files')['03_container_layer/docker/admin/training_web/compose.yml']).toContain('8081:80')
    expect(publisher.props('message')).toContain('Compose workload')
    await publisher.vm.$emit('close')
    await flushPromises()
    expect(modal.get('[name="target"]').element.value).toBe('training_web')
  })

})
