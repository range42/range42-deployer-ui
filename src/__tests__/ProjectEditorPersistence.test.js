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
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { useEditorPreferencesStore } from '@/stores/editorPreferencesStore'
import projectMessages from '@/locales/en/project.json'
import historyTab from '@/locales/en/historyTab.json'

const { pushToGit, loadDeployments, registerProject, lockSession } = vi.hoisted(() => ({ pushToGit: vi.fn(), loadDeployments: vi.fn(), registerProject: vi.fn(), lockSession: { releaseEditor: vi.fn(async () => {}), recoverExpired: vi.fn(async () => {}) } }))
vi.mock('@/composables/useProjectGitSync', async (original) => {
  const { ref } = await import('vue')
  lockSession.lockStatus = ref('idle'); lockSession.lockError = ref('')
  return { ...await original(), useProjectGitSync: () => ({ pushToGit, ...lockSession }) }
})
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
  lockSession.lockStatus.value = 'idle'; lockSession.lockError.value = ''; lockSession.releaseEditor.mockClear()
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

async function editor(saved, { hydrate = true, shell = false, renderSlots = false, realControls = false } = {}) {
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
  wrapper = shallowMount(shell ? AppShell : ProjectEditor, { global: { renderStubDefaultSlot: renderSlots, stubs: { teleport: true, KeepAlive: false, ConfigTab: false, ...(realControls ? { Controls: false, ControlButton: false, Panel: false } : {}), ...(shell ? { RouterView: false, ProjectEditor: false } : {}) }, config: { errorHandler: (error) => errors.push(error.message) }, plugins: [pinia, router,
    createI18n({ legacy: false, locale: 'en', messages: { en: { project: projectMessages, historyTab } } }),
  ] } })
  await flushPromises()
  return { store, router, errors }
}

describe('ProjectEditor saved project integration', () => {
  it('names the real canvas controls and retains their interaction and zoom actions', async () => {
    const { errors } = await editor(project({ git: undefined }), { renderSlots: true, realControls: true })
    const controls = wrapper.getComponent(Controls)
    expect(controls.findAll('button').map(button => button.text())).toEqual([
      'Zoom in', 'Zoom out', 'Fit view', 'Lock node interaction',
    ])
    await controls.get('.vue-flow__controls-zoomin').trigger('click')
    await controls.get('.vue-flow__controls-zoomout').trigger('click')
    await controls.get('.vue-flow__controls-fitview').trigger('click')
    expect(controls.emitted('zoomIn')).toHaveLength(1)
    expect(controls.emitted('zoomOut')).toHaveLength(1)
    expect(controls.emitted('fitView')).toHaveLength(1)
    await controls.get('.vue-flow__controls-interactive').trigger('click')
    expect(controls.get('.vue-flow__controls-interactive').text()).toBe('Unlock node interaction')
    await controls.get('.vue-flow__controls-interactive').trigger('click')
    expect(controls.get('.vue-flow__controls-interactive').text()).toBe('Lock node interaction')
    expect(controls.emitted('interactionChange')).toHaveLength(2)
    expect(controls.findAll('svg').every(icon => icon.attributes('aria-hidden') === 'true')).toBe(true)
    expect(errors).toEqual([])
  })

  it('keeps local drafts while disabling automatic Git checkpoints', async () => {
    localStorage.setItem('range42_editor_preferences', JSON.stringify({ autoSaveToGit: false, snapToGrid: true, gridSize: 30 }))
    const { store } = await editor(project())
    await vi.advanceTimersByTimeAsync(1500)
    pushToGit.mockClear()
    const overlay = { param_overrides: { env: { GREETING: 'local draft' } } }
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', overlay)
    await flushPromises(); await vi.advanceTimersByTimeAsync(1500)
    expect(store.getProject('saved').overlay).toEqual(overlay)
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].overlay).toEqual(overlay)
    expect(pushToGit).not.toHaveBeenCalled()
  })

  it('flushes pending local graph edits on exit without Git when automatic Git saving is off', async () => {
    const nodes = [{ id: 'vm', type: 'vm', position: { x: 0, y: 0 }, computedPosition: { x: 0, y: 0, z: 0 }, data: { config: { name: 'guest' } } }]
    await editor(project({ nodes }))
    await vi.advanceTimersByTimeAsync(1500); pushToGit.mockClear()
    wrapper.findComponent(VueFlow).vm.$emit('nodesChange', [{ id: 'vm', type: 'position', position: { x: 80, y: 60 } }])
    await flushPromises()
    useEditorPreferencesStore().autoSaveToGit = false
    wrapper.unmount(); wrapper = undefined; await flushPromises()
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].nodes[0].position).toEqual({ x: 80, y: 60 })
    expect(pushToGit).not.toHaveBeenCalled()
    expect(lockSession.releaseEditor).toHaveBeenCalledOnce()
  })

  it('keeps explicit Save and Save-and-Deploy available with automatic Git saving off', async () => {
    localStorage.setItem('range42_editor_preferences', JSON.stringify({ autoSaveToGit: false }))
    await editor(project())
    await vi.advanceTimersByTimeAsync(1500); pushToGit.mockClear()
    await wrapper.get('[aria-label="Save project"]').trigger('click'); await flushPromises()
    expect(pushToGit).toHaveBeenCalledOnce()
    pushToGit.mockClear()
    wrapper.findComponent(Sidebar).vm.$emit('openDeploy'); await flushPromises()
    expect(pushToGit).toHaveBeenCalledOnce()
    expect(registerProject).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(DeployForm).exists()).toBe(true)
  })

  it('uses persisted snap spacing in the actual editor VueFlow binding', async () => {
    localStorage.setItem('range42_editor_preferences', JSON.stringify({ snapToGrid: true, gridSize: 35 }))
    await editor(project({ git: undefined }), { renderSlots: true })
    expect(wrapper.findComponent(VueFlow).props('snapToGrid')).toBe(true)
    expect(wrapper.findComponent(VueFlow).props('snapGrid')).toEqual([35, 35])
    expect(wrapper.findComponent(Background).props('gap')).toBe(35)
    const preferences = useEditorPreferencesStore()
    preferences.gridSize = 45; preferences.snapToGrid = false
    await flushPromises()
    expect(wrapper.findComponent(VueFlow).props('snapGrid')).toEqual([45, 45])
    expect(wrapper.findComponent(VueFlow).props('snapToGrid')).toBe(false)
    expect(wrapper.findComponent(Background).props('gap')).toBe(45)
  })

  it('suppresses a queued Git checkpoint when disabled and saves retained edits after re-enabling', async () => {
    const { store } = await editor(project())
    await vi.advanceTimersByTimeAsync(1500); pushToGit.mockClear()
    const overlay = { param_overrides: { env: { MESSAGE: 'keep this edit' } } }
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', overlay)
    await flushPromises()
    const preferences = useEditorPreferencesStore()
    preferences.autoSaveToGit = false
    await flushPromises(); await vi.advanceTimersByTimeAsync(1500)
    expect(pushToGit).not.toHaveBeenCalled()
    expect(store.getProject('saved').overlay).toEqual(overlay)
    preferences.autoSaveToGit = true
    await flushPromises(); await vi.advanceTimersByTimeAsync(1499)
    expect(pushToGit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pushToGit).toHaveBeenCalledOnce()
    expect(pushToGit.mock.calls[0][0].overlay).toEqual(overlay)
  })

  it('keeps lock-loss refusal in force when automatic Git saving is re-enabled', async () => {
    localStorage.setItem('range42_editor_preferences', JSON.stringify({ autoSaveToGit: false }))
    const { store } = await editor(project())
    await vi.advanceTimersByTimeAsync(1500); pushToGit.mockClear()
    lockSession.lockStatus.value = 'blocked'
    const overlay = { param_overrides: { message: 'retained behind lock' } }
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', overlay)
    useEditorPreferencesStore().autoSaveToGit = true
    await flushPromises(); await vi.advanceTimersByTimeAsync(1500)
    expect(pushToGit).not.toHaveBeenCalled()
    expect(store.getProject('saved').overlay).toEqual(overlay)
  })

  it('shows heartbeat lock loss with explicit recovery while retaining local files', async () => {
    const { store } = await editor(project({ files: { 'draft.yml': 'local only' }, head_sha: 'b'.repeat(40) }))
    lockSession.lockStatus.value = 'blocked'; lockSession.lockError.value = 'Another editor owns this branch'
    await flushPromises()
    expect(wrapper.get('[data-testid="git-lock-recovery"]').text()).toContain('Another editor')
    expect(wrapper.get('[data-testid="git-recover-expired"]').text()).toContain('expired')
    await wrapper.get('[data-testid="git-recover-branch"]').trigger('click'); await flushPromises()
    expect(store.getProject('saved').files).toEqual({ 'draft.yml': 'local only' })
    expect(store.getProject('saved').git.branch_from).toBe('b'.repeat(40))
    expect(pushToGit.mock.calls.at(-1)[0].binding.working_branch).toMatch(/^range42-ui\/recovery-/)
  })

  it('releases the exact editor session after its final pending checkpoint on unmount', async () => {
    await editor(project())
    wrapper.unmount(); wrapper = undefined; await flushPromises()
    expect(lockSession.releaseEditor).toHaveBeenCalledOnce()
  })

  it('does not record an old in-flight Git result into a newly connected repository', async () => {
    const { store } = await editor(project())
    await vi.advanceTimersByTimeAsync(1500)
    let finish
    pushToGit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    wrapper.findComponent(VariablesTab).vm.$emit('update:overlay', { param_overrides: { label: 'edit' } })
    await flushPromises(); await vi.advanceTimersByTimeAsync(1500)
    const replacement = { ...store.getProject('saved').git, repo_name: 'different', working_branch: 'different-work' }
    store.updateProject('saved', { git: replacement, head_sha: '' })
    finish({ commit_sha: 'c'.repeat(40), branch: 'old-branch' }); await flushPromises()
    expect(store.getProject('saved').git).toEqual(replacement)
    expect(store.getProject('saved').head_sha).toBe('')
  })

  it('preserves desired configuration and existing observations across plain graph persistence', async () => {
    const nodes = [{ id: 'vm', type: 'vm', position: { x: 4, y: 8 }, data: {
      config: { name: 'owned', template: '9901' }, desiredConfig: { cores: 6 },
      actualConfig: { cores: 2 }, status: 'stopped', pendingAction: 'review',
    } }]
    const files = { 'binary.bin': { encoding: 'base64', content: 'AP+A', size: 3 } }
    const { store } = await editor(project({ git: undefined, nodes, files }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.getProject('saved').nodes[0].data).toEqual(nodes[0].data)
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].nodes[0].data).toEqual(nodes[0].data)
    expect(store.getProject('saved').files).toEqual(files)
    expect(pushToGit).not.toHaveBeenCalled()
  })

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
    expect(secondTab.findComponent(TwoPaneEditor).props('path')).toBe('second.yml')
    expect(secondTab.findComponent(TwoPaneEditor).props('overlayContent')).toBe('second project')
    expect((await secondTab.props('overlayFs').getFile('second.yml')).content).toBe('second project')
    await expect(firstFs.putFile({ path: 'first.yml', content: 'late write from old editor' })).rejects.toThrow(/project.*closed|project.*changed/i)
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
