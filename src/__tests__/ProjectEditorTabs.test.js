import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import ProjectEditor from '@/views/ProjectEditor.vue'
import ConfigPanel from '@/components/ConfigPanel.vue'
import TwoPaneEditor from '@/components/project/TwoPaneEditor.vue'
import FileTree from '@/components/project/FileTree.vue'
import VariablesTab from '@/components/project/VariablesTab.vue'
import HistoryTab from '@/components/project/HistoryTab.vue'
import CommandPalette from '@/components/project/CommandPalette.vue'
import Sidebar from '@/components/Sidebar.vue'
import ProjectRepositoryConnection from '@/components/ProjectRepositoryConnection.vue'
import ProxmoxSettingsModal from '@/components/ProxmoxSettingsModal.vue'
import { useProjectStore } from '@/stores/projectStore'
import * as gitProviders from '@/services/git'
import projectMessages from '@/locales/en/project.json'
import historyTab from '@/locales/en/historyTab.json'
import deployment from '@/locales/en/deployment.json'
const { pushToGit } = vi.hoisted(() => ({ pushToGit: vi.fn() }))
vi.mock('@/composables/useProjectGitSync', async original => ({ ...await original(), useProjectGitSync: () => ({ pushToGit }) }))
vi.mock('@/composables/useDeploymentIndex', async () => {
  const { ref } = await import('vue')
  return { useDeploymentIndex: () => ({ items: ref([]), load: vi.fn() }) }
})
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
let wrapper
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); pushToGit.mockReset().mockResolvedValue({ commit_sha: 'a'.repeat(40), branch: 'work' }) })
afterEach(async () => { wrapper?.unmount(); wrapper = null; await flushPromises(); vi.useRealTimers(); vi.restoreAllMocks() })
const node = (id, name) => ({ id, type: 'vm', position: { x: 0, y: 0 }, data: { config: { name, cores: 4, memory: 2048 } } })
async function editor(query = '', overrides = {}) {
  const saved = { id: 'tabs', name: 'Saved project', nodes: [node('first', 'First guest'), node('second', 'Second guest')], edges: [], files: { 'first.yml': 'saved first', 'second.yml': 'saved second' }, ...overrides }
  localStorage.setItem('range42_projects', JSON.stringify([saved]))
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useProjectStore()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div>Home</div>' } },
    { path: '/catalog', component: { template: '<div>Catalog</div>' } },
    { path: '/project/:id', name: 'project-editor', component: ProjectEditor },
  ] })
  await router.push('/project/tabs' + query); await router.isReady()
  wrapper = shallowMount(AppShell, { attachTo: document.body, global: {
    stubs: { RouterView: false, ProjectEditor: false, ConfigTab: false, KeepAlive: false, teleport: true },
    plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en: { project: projectMessages, historyTab, deployment } } })],
  } })
  await flushPromises()
  if (router.currentRoute.value.query.tab === 'config') {
    await vi.waitFor(() => expect(wrapper.findComponent(TwoPaneEditor).exists()).toBe(true))
  }
  return { store, router }
}

describe('Actual ProjectEditor tab and selection navigation', () => {
  it('hydrates the URL-selected Config file without visiting Home or clicking a file', async () => {
    await editor('?tab=config&file=second.yml')
    expect(wrapper.get('[data-testid="project-tab-config"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.findComponent(TwoPaneEditor).props()).toMatchObject({ path: 'second.yml', overlayContent: 'saved second' })
  })

  it('retains tab and file navigation through Back/Forward without losing an unsaved buffer', async () => {
    const { router } = await editor('?tab=config&file=second.yml&action=deploy')
    wrapper.findComponent(TwoPaneEditor).vm.$emit('update:overlay-content', 'unsaved draft')
    await wrapper.get('[data-testid="project-tab-variables"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.action).toBe('deploy')
    router.back(); await flushPromises()
    expect(wrapper.get('[data-testid="project-tab-config"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('unsaved draft')
    router.forward(); await flushPromises()
    expect(wrapper.get('[data-testid="project-tab-variables"]').attributes('aria-selected')).toBe('true')
  })

  it('supports arrow and Home/End keyboard navigation between tabs', async () => {
    const { router } = await editor('?tab=config')
    await wrapper.get('[data-testid="project-tab-config"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('variables')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="project-tab-variables"]').element)
    await wrapper.get('[data-testid="project-tab-variables"]').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('settings')
    await wrapper.get('[data-testid="project-tab-settings"]').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('canvas')
  })

  it('updates the URL when selecting a file and restores it after the editor reloads', async () => {
    const { router } = await editor('?tab=config')
    wrapper.findComponent(FileTree).vm.$emit('select', { path: 'second.yml', fsKind: 'overlay' }); await flushPromises()
    expect(router.currentRoute.value.query.file).toBe('second.yml')
    const restoredQuery = router.currentRoute.value.fullPath.split('/project/tabs')[1]
    wrapper.unmount(); wrapper = null
    await editor(restoredQuery)
    await vi.waitFor(() => expect(wrapper.findComponent(TwoPaneEditor).exists()).toBe(true))
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('saved second')
  })

  it('prefills selected-node settings from the node query and clears a missing selection', async () => {
    const { router } = await editor('?tab=canvas&node=second')
    expect(wrapper.findComponent(ConfigPanel).props('node').data.config).toMatchObject({ name: 'Second guest', cores: 4, memory: 2048 })
    await router.push('/project/tabs?tab=canvas&node=missing'); await flushPromises()
    expect(wrapper.findComponent(ConfigPanel).exists()).toBe(false)
  })

  it('opens node/file palette results in their actual tab instead of leaving hidden selections', async () => {
    const { router } = await editor('?tab=variables')
    wrapper.findComponent(CommandPalette).vm.$emit('jumpTo', { kind: 'node', id: 'second' }); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'canvas', node: 'second' })
    wrapper.findComponent(CommandPalette).vm.$emit('jumpTo', { kind: 'file', id: 'first.yml' }); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'config', file: 'first.yml' })
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('saved first')
  })

  it('passes persisted variable declarations and overrides to the real tab', async () => {
    await editor('?tab=variables', { baseDoc: { env: [{ name: 'GREETING', default: 'hello' }] }, overlay: { param_overrides: { env: { GREETING: 'saved override' } } } })
    expect(wrapper.findComponent(VariablesTab).props()).toMatchObject({ base: { env: [{ name: 'GREETING', default: 'hello' }] }, overlay: { param_overrides: { env: { GREETING: 'saved override' } } } })
  })

  it('uses current repository bindings, working branch and project subdirectory in History', async () => {
    await editor('?tab=history', { git: { source_id: 'source', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner', repo_name: 'repo', branch: 'main', working_branch: 'work', branch_strategy: 'shared_repo_subdir', subdir: 'projects/tabs' } })
    expect(wrapper.findComponent(HistoryTab).props('locator')).toEqual({ owner: 'owner', repo: 'repo', path: 'projects/tabs/topology.json', ref: 'work' })
    expect(typeof wrapper.findComponent(HistoryTab).props('provider').listCommits).toBe('function')
    expect(wrapper.get('[data-testid="project-history-path"]').text()).toContain('projects/tabs/topology.json')
  })

  it('reports unavailable legacy history capability before exposing a broken provider', async () => {
    vi.spyOn(gitProviders, 'getGitProvider').mockReturnValue({ getFile: vi.fn() })
    await editor('?tab=history', { gitSource: { provider: 'github', owner: 'owner', repo: 'legacy' } })
    expect(wrapper.text()).toContain('This legacy Git provider cannot list history')
    expect(wrapper.findComponent(HistoryTab).exists()).toBe(false)
  })

  it('prefills editable project Settings and reuses existing repository/target configuration', async () => {
    const { store } = await editor('?tab=settings')
    expect(wrapper.get('[data-testid="project-settings-name"]').element.value).toBe('Saved project')
    await wrapper.get('[data-testid="project-settings-name"]').setValue('Renamed project')
    await wrapper.get('[data-testid="project-settings-form"]').trigger('submit')
    expect(store.getProject('tabs').name).toBe('Renamed project')
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].id).toBe('tabs')
    await wrapper.get('[data-testid="project-settings-repository"]').trigger('click')
    expect(wrapper.findComponent(ProjectRepositoryConnection).exists()).toBe(true)
    await wrapper.get('[data-testid="project-settings-target"]').trigger('click')
    expect(wrapper.findComponent(ProxmoxSettingsModal).props('projectId')).toBe('tabs')
  })

  it('shows each persisted catalog origin and its added item counts in Settings', async () => {
    const catalogImports = [
      { version: 1, id: 'append1', origin: { kind: 'lab', path: 'labs/base', sha: 'a'.repeat(40) }, node_ids: ['first', 'second'], content_ids: [], attachment_ids: [] },
      { version: 1, id: 'append2', origin: { kind: 'ansible_role', path: 'roles/service.reload.ntp', sha: 'b'.repeat(40) }, node_ids: [], content_ids: ['role1'], attachment_ids: [] },
    ]
    const { store } = await editor('?tab=settings', { catalogImports })
    const rows = wrapper.findAll('[data-testid="project-catalog-import"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('labs/base')
    expect(rows[0].text()).toContain('2 nodes')
    expect(rows[1].text()).toContain('ansible_role')
    expect(rows[1].text()).toContain('b'.repeat(40))
    expect(rows[1].text()).toContain('1 content items')
    expect(store.getProject('tabs').catalogImports).toEqual(catalogImports)
    expect(pushToGit).not.toHaveBeenCalled()
  })

  it.each(['header', 'sidebar', 'mobile drawer'])('saves the current graph locally before Add from catalog via %s, without a pending Git write', async source => {
    const { store, router } = await editor('?tab=canvas&node=second', { git: { source_id: 'source', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner', repo_name: 'repo', branch: 'main', branch_strategy: 'dedicated_repo' } })
    if (source === 'header') await wrapper.get('[data-testid="project-add-catalog"]').trigger('click')
    else if (source === 'sidebar') wrapper.findComponent(Sidebar).vm.$emit('openInventory')
    else {
      await wrapper.get('[data-testid="mobile-drawer-toggle"]').trigger('click')
      wrapper.findAllComponents(Sidebar).at(-1).vm.$emit('openInventory')
    }
    await flushPromises(); await vi.advanceTimersByTimeAsync(1600)
    expect(router.currentRoute.value.path).toBe('/catalog')
    expect(router.currentRoute.value.query).toEqual({ project: 'tabs', node: 'second' })
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].nodes).toEqual(store.getProject('tabs').nodes)
    expect(pushToGit).not.toHaveBeenCalled()
  })
})
