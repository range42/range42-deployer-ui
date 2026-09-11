import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

// Mock the provider factory and adapter factory; let the real (pure, tested)
// buildProjectState run so we verify the canvas actually becomes topology.json.
const { getProvider, createProjectRepoAdapter, fakeAdapter } = vi.hoisted(() => {
  const fakeAdapter = {
    autosave: vi.fn(async () => {}),
    save: vi.fn(async () => ({ commit_sha: 'deadbeef', branch: 'range42-ui/p1' })),
    proposeMerge: vi.fn(async () => ({ pr_url: 'https://git.test/pr/1' })),
  }
  return {
    fakeAdapter,
    getProvider: vi.fn(() => ({ id: 'github' })),
    createProjectRepoAdapter: vi.fn(() => fakeAdapter),
  }
})
vi.mock('@/services/git', () => ({ getProvider }))
vi.mock('@/services/projectRepo', () => ({ createProjectRepoAdapter }))

import { useProjectGitSync, buildPushArgs, buildProjectFiles } from '@/composables/useProjectGitSync'
import { useInventoryStore } from '@/stores/inventoryStore'
import { savedScenario } from './fixtures/savedScenario'

const CANVAS = {
  nodes: [
    { id: 'vm1', type: 'vm', position: { x: 1, y: 2 }, data: { config: { role: 'admin', template: '9001' } } },
  ],
  edges: [],
  attachments: [],
}

const BINDING = {
  source_id: 'src-gh',
  provider: 'github',
  base_url: 'https://github.com',
  repo_owner: 'range42',
  repo_name: 'proj-demo',
  branch_strategy: 'dedicated_repo',
  subdir: '',
}

describe('useProjectGitSync', () => {
  it('captures catalog provenance for ordinary and publication snapshots before asynchronous saving', async () => {
    const project = savedScenario()
    project.git = BINDING
    project.catalogRef = { version: 1, mode: 'customize', source_id: 'original', path: 'labs/example', sha: 'a'.repeat(40),
      repo_owner: 'range42', repo_name: 'catalog', token: 'never-persist' }
    const args = buildPushArgs(project, project.nodes, project.edges)
    const publication = buildProjectFiles(args)
    const pending = useProjectGitSync().pushToGit(args)
    project.catalogRef.repo_owner = 'later-edit'
    await pending
    const state = fakeAdapter.autosave.mock.calls[0][1]
    expect(state.meta.ui_catalog).toMatchObject({ repo_owner: 'range42', source_id: 'original', sha: 'a'.repeat(40) })
    expect(state.meta.ui_catalog).toEqual(JSON.parse(publication['meta.json']).ui_catalog)
    expect(JSON.stringify(state)).not.toContain('never-persist')
  })

  it('captures structured authoring before queued async saves and publishes the same metadata', async () => {
    const project = savedScenario()
    project.git = BINDING
    const args = buildPushArgs(project, project.nodes, project.edges)
    const publication = buildProjectFiles(args)
    const promise = useProjectGitSync().pushToGit(args)
    project.scenario.vms[0].vm_name = 'later-edit'
    project.scenario_generated_paths.length = 0
    project.baseDoc.env[0].default = 9999
    await promise
    const state = fakeAdapter.autosave.mock.calls[0][1]
    expect(state.meta.ui_project).toEqual(JSON.parse(publication['meta.json']).ui_project)
    expect(state.meta.ui_project.scenario.vms[0].vm_name).toBe('saved-vm')
    expect(state.meta.ui_project.generated_paths.length).toBeGreaterThan(0)
  })

  it('seeds reopened working branches from their loaded SHA without changing older bindings', async () => {
    const branchFrom = 'a'.repeat(40)
    await useProjectGitSync().pushToGit({ projectId: 'new', binding: { ...BINDING, branch_from: branchFrom }, canvas: CANVAS, meta: { name: 'Opened' } })
    expect(createProjectRepoAdapter.mock.calls[0][0].branchFrom).toBe(branchFrom)
  })
  it('keeps the loaded SHA when a reopened read-only project needs a fork', async () => {
    const provider = { canWrite: vi.fn(async () => false),
      ensureFork: vi.fn(async () => ({ owner: 'personal', repo: 'fork', default_branch: 'main' })), listCommits: vi.fn() }
    getProvider.mockReturnValueOnce(provider)
    const branchFrom = 'b'.repeat(40)
    await useProjectGitSync().pushToGit({ projectId: 'copy', binding: { ...BINDING, branch_from: branchFrom }, canvas: CANVAS, meta: { name: 'Opened' } })
    expect(createProjectRepoAdapter.mock.calls[0][0]).toMatchObject({ branchFrom,
      source: { repos: [{ owner: 'personal', repo: 'fork' }] } })
    expect(provider.listCommits).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useInventoryStore().addSource({ id: BINDING.source_id, provider: BINDING.provider, base_url: BINDING.base_url, auth: { kind: 'none' }, repos: [] })
    getProvider.mockClear()
    createProjectRepoAdapter.mockClear()
    fakeAdapter.autosave.mockClear()
    fakeAdapter.save.mockClear()
  })

  it('serializes the canvas, autosaves topology, and returns the deploy commit_sha', async () => {
    useInventoryStore().setToken('src-gh', 'pat-xyz')
    const { pushToGit } = useProjectGitSync()

    const res = await pushToGit({
      projectId: 'p1',
      binding: BINDING,
      canvas: CANVAS,
      meta: { name: 'proj-demo', kind: 'lab', bridge_base: 140 },
      message: 'pin deploy',
    })

    // provider authed with the source's stored PAT
    const [kind, providerOpts] = getProvider.mock.calls[0]
    expect(kind).toBe('github')
    expect(providerOpts.token).toBe('pat-xyz')
    expect(providerOpts.baseUrl).toBe('https://github.com')

    // adapter built with repo owner/name + branch strategy from the binding
    const adapterOpts = createProjectRepoAdapter.mock.calls[0][0]
    expect(adapterOpts.branchStrategy).toBe('dedicated_repo')
    expect(adapterOpts.projectPath).toBe('')
    expect(adapterOpts.workingBranch).toBe('range42-ui/p1')
    expect(adapterOpts.source.repos[0]).toMatchObject({ owner: 'range42', repo: 'proj-demo' })

    // the canvas was serialized into topology.json before autosave
    const stateArg = fakeAdapter.autosave.mock.calls[0][1]
    expect(JSON.parse(stateArg.topology).schema_version).toBe('1.0')
    expect(JSON.parse(stateArg.topology).nodes.find((n) => n.id === 'vm1').role).toBe('admin')

    // save() result (the deployable SHA) flows back to the caller
    expect(res.commit_sha).toBe('deadbeef')
  })

  it('serializes overlapping saves and captures each canvas before asynchronous writes', async () => {
    let finish
    fakeAdapter.autosave.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { pushToGit } = useProjectGitSync()
    const args = { projectId: 'p1', binding: BINDING, canvas: CANVAS, meta: { name: 'First' } }
    const first = pushToGit(args)
    const second = pushToGit({ ...args, meta: { name: 'Second' } })
    await flushPromises()
    expect(fakeAdapter.autosave).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])
    expect(fakeAdapter.autosave.mock.calls.map(([, state]) => state.meta.name)).toEqual(['First', 'Second'])
  })

  it('does not send a stored source token to an imported project connection with a different URL', async () => {
    useInventoryStore().setToken('src-gh', 'private-token')
    const { pushToGit } = useProjectGitSync()
    await expect(async () => pushToGit({
      projectId: 'p1', binding: { ...BINDING, base_url: 'https://other.test' }, canvas: CANVAS, meta: { name: 'Demo' },
    })).rejects.toThrow(/source|connection/i)
    expect(getProvider).not.toHaveBeenCalled()
  })

  it('preserves variable overrides in both saved and published overlay documents', async () => {
    const overlay = { param_overrides: { env: { SERVICE_PORT: '8080' } } }
    const args = buildPushArgs({ id: 'p1', name: 'Demo', git: BINDING, overlay }, CANVAS.nodes, [])
    await useProjectGitSync().pushToGit(args)
    const state = fakeAdapter.autosave.mock.calls[0][1]
    expect(JSON.parse(state.overlay)).toEqual(overlay)
    expect(JSON.parse(buildProjectFiles(args)['overlay.json'])).toEqual(overlay)
    expect(JSON.parse(state.topology).nodes[0].id).toBe('vm1')
  })

  it('returns the working branch revision alongside a separate merge proposal', async () => {
    const { proposeMerge } = useProjectGitSync()
    const result = await proposeMerge({ projectId: 'p1', binding: BINDING, canvas: CANVAS, meta: { name: 'Demo' } })
    expect(result).toEqual({ branch: 'range42-ui/p1', commit_sha: 'deadbeef', pr_url: 'https://git.test/pr/1' })
  })

  it('uses collision-safe stable branches for distinct project identifiers', async () => {
    const { pushToGit } = useProjectGitSync()
    for (const projectId of ['a/b', 'a-b']) {
      await pushToGit({ projectId, binding: BINDING, canvas: CANVAS, meta: { name: 'Demo' } })
    }
    const branches = createProjectRepoAdapter.mock.calls.map(([opts]) => opts.workingBranch)
    expect(branches).toEqual(['range42-ui/a%2Fb', 'range42-ui/a-b'])
  })

  it('buildPushArgs: returns null when the project has no git binding', () => {
    expect(buildPushArgs({ id: 'p', name: 'x', nodes: [], edges: [] }, [], [])).toBeNull()
  })

  it('buildPushArgs: maps a bound project + live canvas into PushToGitArgs', () => {
    const project = {
      id: 'p1',
      name: 'demo',
      gamenet: true,
      bridge_base: 142,
      attachments: [{ id: 'a1', target_node: 'vm1' }],
      git: BINDING,
    }
    const args = buildPushArgs(project, CANVAS.nodes, CANVAS.edges, 'msg')
    expect(args.projectId).toBe('p1')
    expect(args.binding).toBe(BINDING)
    expect(args.canvas.nodes).toBe(CANVAS.nodes)
    expect(args.canvas.attachments).toEqual([{ id: 'a1', target_node: 'vm1' }])
    expect(args.meta).toEqual({ name: 'demo', kind: 'gamenet', bridge_base: 142 })
    expect(args.message).toBe('msg')
  })

  it('buildPushArgs: infers kind "lab" when not a gamenet', () => {
    const args = buildPushArgs({ id: 'p', name: 'l', git: BINDING }, [], [])
    expect(args.meta.kind).toBe('lab')
  })

  it("maps a 'generic' source to the gitea provider kind", async () => {
    const { pushToGit } = useProjectGitSync()
    await pushToGit({
      projectId: 'p2',
      binding: { ...BINDING, provider: 'generic', base_url: 'https://git.example' },
      canvas: CANVAS,
      meta: { name: 'x' },
    })
    expect(getProvider.mock.calls[0][0]).toBe('gitea')
  })
})
