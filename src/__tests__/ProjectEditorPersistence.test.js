import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProjectEditor from '@/views/ProjectEditor.vue'
import AppShell from '@/components/AppShell.vue'
import CommandPalette from '@/components/project/CommandPalette.vue'
import VariablesTab from '@/components/project/VariablesTab.vue'
import ConfigTab from '@/components/project/ConfigTab.vue'
import FileTree from '@/components/project/FileTree.vue'
import TwoPaneEditor from '@/components/project/TwoPaneEditor.vue'
import DeployForm from '@/components/project/DeployForm.vue'
import Sidebar from '@/components/Sidebar.vue'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'
import ProjectRepositoryConnection from '@/components/ProjectRepositoryConnection.vue'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { scenarioReviewSource } from '@/services/attachmentMigration'
import { useProjectStore } from '@/stores/projectStore'
import projectMessages from '@/locales/en/project.json'
import historyTab from '@/locales/en/historyTab.json'

const { pushToGit, loadDeployments, registerProject } = vi.hoisted(() => ({ pushToGit: vi.fn(), loadDeployments: vi.fn(), registerProject: vi.fn() }))
vi.mock('@/composables/useProjectGitSync', async (original) => ({
  ...await original(), useProjectGitSync: () => ({ pushToGit }),
}))
vi.mock('@/composables/useDeploymentIndex', async () => {
  const { ref } = await import('vue')
  return { useDeploymentIndex: () => ({ items: ref([]), load: loadDeployments }) }
})
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('@/services/backendProjectRegistration', () => ({ ensureBackendProject: registerProject }))

let wrapper
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  pushToGit.mockReset().mockResolvedValue({ commit_sha: 'a'.repeat(40), branch: 'range42-ui/saved' })
  loadDeployments.mockReset().mockResolvedValue(undefined)
  registerProject.mockReset().mockResolvedValue({ id: 'registered-backend-project' })
})
afterEach(() => {
  if (wrapper?.vm) wrapper.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

function project(overrides = {}) {
  return {
    id: 'saved', name: 'Saved project', nodes: [], edges: [],
    git: { source_id: 'source', provider: 'github', base_url: 'https://github.com',
      repo_owner: 'owner', repo_name: 'repo', branch: 'main', branch_strategy: 'dedicated_repo' },
    ...overrides,
  }
}

async function editor(saved, { hydrate = true, shell = false } = {}) {
  localStorage.setItem('range42_projects', JSON.stringify([saved]))
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useProjectStore()
  if (hydrate) store.loadProjects()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div>Home</div>' } },
    { path: '/project/:id', name: 'project-editor', component: ProjectEditor },
  ] })
  await router.push(`/project/${saved.id}`)
  await router.isReady()
  const errors = []
  wrapper = shallowMount(shell ? AppShell : ProjectEditor, { global: { stubs: { teleport: true, KeepAlive: false, ConfigTab: false, ...(shell ? { RouterView: false, ProjectEditor: false } : {}) }, config: { errorHandler: (error) => errors.push(error.message) }, plugins: [pinia, router,
    createI18n({ legacy: false, locale: 'en', messages: { en: { project: projectMessages, historyTab } } }),
  ] } })
  await flushPromises()
  return { store, router, errors }
}

describe('ProjectEditor saved project integration', () => {
  it('lists authored file-map paths in the command palette without a render error', async () => {
    const { errors } = await editor(project({ files: {
      'scenarios/demo/main.yml': '- hosts: localhost\n',
      'scenarios/demo/files/message.txt': 'hello\n',
    } }))
    expect(errors).toEqual([])
    expect(wrapper.findComponent(CommandPalette).props('items')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', id: 'file:scenarios/demo/main.yml', label: 'main.yml' }),
      expect.objectContaining({ kind: 'file', id: 'file:scenarios/demo/files/message.txt', label: 'message.txt' }),
    ]))
  })

  it('opens a persisted project directly before Home has hydrated the store', async () => {
    const { store, router } = await editor(project(), { hydrate: false })
    expect(router.currentRoute.value.path).toBe('/project/saved')
    expect(store.getProject('saved')?.name).toBe('Saved project')
    expect(wrapper.text()).toContain('Saved project')
  })

  it('checkpoints a variable edit after the debounce without a canvas edit', async () => {
    const { store } = await editor(project())
    // Finish the initial canvas-load save so the following write must come
    // from VariablesTab's event, not a pending node watcher.
    await vi.advanceTimersByTimeAsync(1500)
    pushToGit.mockClear()
    const overlay = { param_overrides: { env: [{ name: 'GREETING', value: 'hello' }] } }
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', overlay)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1499)
    expect(pushToGit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pushToGit).toHaveBeenCalledOnce()
    expect(store.getProject('saved').overlay).toEqual(overlay)
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].head_sha).toBe('a'.repeat(40))
  })

  it('checkpoints pending variable edits when leaving the editor before the debounce', async () => {
    const { store } = await editor(project())
    await vi.advanceTimersByTimeAsync(1500)
    pushToGit.mockClear()
    const overlay = { param_overrides: { env: [{ name: 'GREETING', value: 'saved on exit' }] } }
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', overlay)
    await flushPromises()
    expect(pushToGit).not.toHaveBeenCalled()

    wrapper.unmount()
    wrapper = undefined
    await flushPromises()
    expect(store.getProject('saved').overlay).toEqual(overlay)
    expect(pushToGit).toHaveBeenCalledOnce()
    expect(pushToGit.mock.calls[0][0].overlay).toEqual(overlay)
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].head_sha).toBe('a'.repeat(40))
  })

  it('keeps the launcher closed if files change while the deployment list loads after saving', async () => {
    await editor(project({ files: { 'scenarios/demo/main.yml': 'before' } }))
    await wrapper.get('[data-testid="project-tab-config"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    let finishLoad
    loadDeployments.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve }))
    wrapper.findComponent(Sidebar).vm.$emit('openDeploy')
    await flushPromises()
    expect(loadDeployments).toHaveBeenCalledOnce()
    await wrapper.findComponent(ConfigTab).props('overlayFs').putFile({
      path: 'scenarios/demo/main.yml', content: 'changed after checkpoint',
    })
    finishLoad()
    await flushPromises()
    expect(wrapper.findComponent(DeployForm).exists()).toBe(false)
  })

  it('loads a separate Config tab file system when navigating to another project', async () => {
    const { store, router } = await editor(project({ files: { 'first.yml': 'first project' } }), { shell: true })
    store.projects.push(project({ id: 'second', name: 'Second project', files: { 'second.yml': 'second project' } }))
    await wrapper.get('[data-testid="project-tab-config"]').trigger('click')
    await flushPromises()
    const firstTab = wrapper.findComponent(ConfigTab)
    const firstFs = firstTab.props('overlayFs')
    expect((await firstFs.getFile('first.yml')).content).toBe('first project')
    firstTab.findComponent(FileTree).vm.$emit('select', { path: 'first.yml', fsKind: 'overlay' })
    await flushPromises()
    firstTab.findComponent(TwoPaneEditor).vm.$emit('update:overlay-content', 'unsaved first draft')
    await flushPromises()
    expect(firstTab.findComponent(TwoPaneEditor).props('overlayContent')).toBe('unsaved first draft')

    await wrapper.get('[data-testid="project-tab-canvas"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="project-tab-config"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('unsaved first draft')

    await router.push('/project/second?tab=config')
    await flushPromises()
    const secondTab = wrapper.findComponent(ConfigTab)
    expect(secondTab.findComponent(TwoPaneEditor).props('path')).toBe('')
    expect(secondTab.findComponent(TwoPaneEditor).props('overlayContent')).toBe('')
    expect((await secondTab.props('overlayFs').getFile('second.yml')).content).toBe('second project')
    await secondTab.props('overlayFs').putFile({ path: 'second.yml', content: 'edited second project' })
    expect(store.getProject('saved').files).toEqual({ 'first.yml': 'first project' })
    expect(store.getProject('second').files).toEqual({ 'second.yml': 'edited second project' })
  })

  it('registers the actual saved fork binding before opening the deployment launcher', async () => {
    const savedProject = project()
    await editor(savedProject)
    pushToGit.mockResolvedValue({ commit_sha: 'b'.repeat(40), branch: 'range42-ui/saved',
      binding: { ...savedProject.git, repo_owner: 'personal-fork' } })
    wrapper.findComponent(Sidebar).vm.$emit('openDeploy')
    await flushPromises()
    expect(registerProject).toHaveBeenCalledOnce()
    expect(registerProject.mock.calls[0][0].git.repo_owner).toBe('personal-fork')
    expect(wrapper.findComponent(DeployForm).props('projectId')).toBe('registered-backend-project')
    expect(wrapper.findComponent(DeployForm).props('localProjectId')).toBe(savedProject.id)
    expect(wrapper.findComponent(DeployForm).props('projectSha')).toBe('b'.repeat(40))
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].git.repo_owner).toBe('personal-fork')
  })

  it('keeps deployment closed when the saved repository cannot be registered on the backend', async () => {
    await editor(project())
    registerProject.mockRejectedValueOnce(new Error('Source is not registered on this backend'))
    wrapper.findComponent(Sidebar).vm.$emit('openDeploy')
    await flushPromises()
    expect(registerProject).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(DeployForm).exists()).toBe(false)
  })

  it('persists publication reviews for permission-aware merge after reopening', async () => {
    const { store } = await editor(project())
    await wrapper.vm.openPublishTargets()
    await flushPromises()
    const results = [{ target_id: 'public', status: 'published', pr_number: 7, commit_sha: 'a'.repeat(40) }]
    wrapper.findComponent(PublishTargetsModal).vm.$emit('published', { commit_sha: 'a'.repeat(40), branch: 'range42-ui/saved', targets: results })
    await flushPromises()
    expect(store.getProject('saved').git.publish_results).toEqual(results)
  })

  it('saves reviewed scenario files from authoring and preselects their concrete scenario label', async () => {
    const nodes = [{ id: 'vm', type: 'vm', position: { x: 0, y: 0 }, data: { config: { name: 'guest' } } },
      { id: 'net', type: 'network-segment', position: { x: 0, y: 100 }, data: { config: {} } }]
    const edges = [{ id: 'edge', source: 'vm', target: 'net' }]
    const scenario = { label: 'generated_demo', network_mode: 'sdn', zone: 'r42lab',
      networks: [{ id: 'net', vnet: 'r42net1', subnet: '10.42.1.0/24', gateway: '10.42.1.1', snat: true }],
      vms: [{ node_id: 'vm', vm_id: 3101, vm_name: 'guest', template_vm_id: 9232, network_id: 'net', ip: '10.42.1.10', ssh_user: 'alice' }], content: [] }
    const { store } = await editor(project({ nodes, edges }))
    await wrapper.get('[data-testid="project-scenario"]').trigger('click')
    const generated = emitConcreteScenario({ scenario, nodes, edges })
    const authoring = wrapper.findComponent(ScenarioAuthoringModal)
    generated.reviewSource = scenarioReviewSource(store.getProject('saved'), authoring.props('nodes'), authoring.props('edges'))
    wrapper.findComponent(ScenarioAuthoringModal).vm.$emit('generated', generated)
    await flushPromises()
    expect(store.getProject('saved').scenario.label).toBe('generated_demo')
    expect(pushToGit.mock.calls.at(-1)[0].files['scenarios/generated_demo/main.yml']).toContain('00_networks.yml')
    wrapper.findComponent(Sidebar).vm.$emit('openDeploy')
    await flushPromises()
    expect(wrapper.findComponent(DeployForm).props('initialScenarioLabel')).toBe('generated_demo')
  })

  it('opens the concrete content editor from the Config tab and preserves its target VM', async () => {
    await editor(project())
    await wrapper.get('[data-testid="project-tab-config"]').trigger('click')
    await flushPromises()
    wrapper.findComponent(ConfigTab).vm.$emit('open-content', 'vm-two')
    await flushPromises()
    expect(wrapper.findComponent(ScenarioAuthoringModal).props('initialTarget')).toBe('vm-two')
  })

  it('connects a repository without pushing and clears pins belonging to the previous repository', async () => {
    const saved = project({ head_sha: 'c'.repeat(40), project_sha: 'c'.repeat(40) })
    const { store } = await editor(saved)
    await wrapper.get('[data-testid="project-repository"]').trigger('click')
    const binding = { ...saved.git, repo_name: 'new-repository' }
    wrapper.findComponent(ProjectRepositoryConnection).vm.$emit('connected', binding)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    expect(pushToGit).not.toHaveBeenCalled()
    expect(store.getProject('saved').git.repo_name).toBe('new-repository')
    expect(store.getProject('saved').head_sha).toBe('')
    expect(store.getProject('saved').project_sha).toBe('')
  })
})
