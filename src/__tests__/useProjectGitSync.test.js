import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock the provider factory and adapter factory; let the real (pure, tested)
// buildProjectState run so we verify the canvas actually becomes topology.json.
const { getProvider, createProjectRepoAdapter, fakeAdapter } = vi.hoisted(() => {
  const fakeAdapter = {
    autosave: vi.fn(async () => {}),
    save: vi.fn(async () => ({ commit_sha: 'deadbeef' })),
  }
  return {
    fakeAdapter,
    getProvider: vi.fn(() => ({ id: 'github' })),
    createProjectRepoAdapter: vi.fn(() => fakeAdapter),
  }
})
vi.mock('@/services/git', () => ({ getProvider }))
vi.mock('@/services/projectRepo', () => ({ createProjectRepoAdapter }))

import { useProjectGitSync, buildPushArgs } from '@/composables/useProjectGitSync'
import { useInventoryStore } from '@/stores/inventoryStore'

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
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
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
    expect(adapterOpts.source.repos[0]).toMatchObject({ owner: 'range42', repo: 'proj-demo' })

    // the canvas was serialized into topology.json before autosave
    const stateArg = fakeAdapter.autosave.mock.calls[0][1]
    expect(JSON.parse(stateArg.topology).schema_version).toBe('1.0')
    expect(JSON.parse(stateArg.topology).nodes.find((n) => n.id === 'vm1').role).toBe('admin')

    // save() result (the deployable SHA) flows back to the caller
    expect(res.commit_sha).toBe('deadbeef')
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
