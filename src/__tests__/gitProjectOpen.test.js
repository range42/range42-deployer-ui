import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildPushArgs, buildProjectFiles } from '@/composables/useProjectGitSync'
import { loadGitProject, prepareGitProjectImport } from '@/services/gitProjectOpen'
import { useProjectStore } from '@/stores/projectStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { savedScenario } from './fixtures/savedScenario'

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
const revision = 'c'.repeat(40)
function repository(project) {
  const files = buildProjectFiles(buildPushArgs(project, project.nodes, project.edges))
  const provider = {
    listCommits: vi.fn(async () => [{ sha: revision }]),
    getFileContent: vi.fn(async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('Missing file'), { status: 404 })
      return { content: files[path], sha: 'blob' }
    }),
    createBranch: vi.fn(), putFile: vi.fn(),
  }
  getProvider.mockReturnValue(provider)
  return { files, provider }
}
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); getProvider.mockClear() })

describe('open project from Git', () => {
  it('restores catalog origin independently of the working repository from the same pinned snapshot', async () => {
    const project = savedScenario()
    project.catalogRef = { version: 1, mode: 'use', source_id: 'original', path: 'labs/example', sha: 'a'.repeat(40), repo_owner: 'range42', repo_name: 'catalog' }
    useInventoryStore().addSource({ id: 'source', provider: project.git.provider, base_url: project.git.base_url, repos: [], auth: { kind: 'none' } })
    const { provider } = repository(project)
    const preview = await loadGitProject(project.git, [])
    const restored = prepareGitProjectImport(preview)
    expect(restored.catalogRef).toEqual(project.catalogRef)
    expect(restored.git.repo_owner).toBe(project.git.repo_owner)
    expect(provider.getFileContent.mock.calls.every(([options]) => options.ref === revision)).toBe(true)
  })

  it.each(['github', 'gitlab', 'gitea'])('previews %s at one pinned revision and restores complete authoring without writes', async kind => {
    const project = savedScenario()
    project.git = { ...project.git, provider: kind, branch: 'review' }
    useInventoryStore().addSource({ id: 'source', provider: kind, base_url: project.git.base_url, repos: [], auth: { kind: 'none' } })
    const { provider } = repository(project)
    const preview = await loadGitProject(project.git, [])
    expect(preview.revision).toEqual({ branch: 'review', commit_sha: revision })
    expect(preview.authoring.status).toBe('structured')
    expect(provider.listCommits.mock.calls).toHaveLength(1)
    expect(provider.getFileContent.mock.calls.every(([options]) => options.ref === revision)).toBe(true)
    expect(provider.createBranch).not.toHaveBeenCalled()
    const restored = prepareGitProjectImport(preview)
    expect(restored.id).toBe(project.id)
    expect(restored.scenario).toEqual(project.scenario)
    expect(restored.baseDoc.env).toEqual(project.baseDoc.env)
    expect(restored.overlay).toEqual(project.overlay)
    expect(restored.files).toEqual(project.files)
    expect(restored.nodes[0].position).toEqual({ x: 120, y: 90 })
    expect(restored.git.branch_from).toBe(revision)
    expect(restored.git.working_branch).toMatch(/^range42-ui\/open-/)
    expect(restored.git.working_branch).not.toBe(project.git.working_branch)
    expect(restored.head_sha).toBe(revision)
  })

  it('preserves parallel NIC edges and editable VM configuration', async () => {
    const project = savedScenario()
    project.edges.push({ ...project.edges[0], id: 'nic2', sourceHandle: 'eth1' })
    project.scenario.vms[0].nics.push({ network_id: 'net1', ip: '10.42.7.11' })
    const result = emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths })
    project.files = result.files
    const { provider } = repository(project)
    const preview = await loadGitProject(project.git, [])
    expect(preview.authoring.status).toBe('structured')
    const restored = prepareGitProjectImport(preview)
    expect(restored.edges.map(edge => edge.id)).toEqual(['nic1', 'nic2'])
    expect(restored.edges[1].sourceHandle).toBe('eth1')
    expect(provider.putFile).not.toHaveBeenCalled()
  })

  it('imports a collision as a new local copy and preserves existing projects', async () => {
    const project = savedScenario()
    repository(project)
    const store = useProjectStore()
    store.importProject(project, { generateNewId: false })
    const preview = await loadGitProject(project.git, store.projects.map(item => item.id))
    expect(preview.local_id).not.toBe(project.id)
    expect(preview.identity_reused).toBe(false)
    store.importProject(prepareGitProjectImport(preview), { generateNewId: false })
    expect(store.projects).toHaveLength(2)
    expect(store.getProject(project.id).scenario).toEqual(project.scenario)
  })

  it('requires explicit files-only import for edited generated files and preserves their bytes on Save', async () => {
    const project = savedScenario()
    const { files } = repository(project)
    const path = project.scenario_generated_paths[0]
    files[path] = 'manually maintained\n'
    const preview = await loadGitProject(project.git, [])
    expect(preview.authoring.status).toBe('conflict')
    expect(() => prepareGitProjectImport(preview)).toThrow(/files-only/i)
    const restored = prepareGitProjectImport(preview, 'files')
    expect(restored.scenario).toBeUndefined()
    expect(restored.scenario_generated_paths).toEqual([])
    expect(buildProjectFiles(buildPushArgs(restored, restored.nodes, restored.edges))[path]).toBe('manually maintained\n')
  })

  it.each(['invalid topology', 'invalid layout', 'canvas mismatch', 'invalid branch', 'invalid directory'])('rejects %s before importing', async reason => {
    const project = savedScenario()
    const { files } = repository(project)
    if (reason === 'invalid topology') files['topology.json'] = '{"nodes":"bad"}'
    if (reason === 'invalid layout') files['canvas_layout.json'] = '{bad'
    if (reason === 'canvas mismatch') { const topology = JSON.parse(files['topology.json']); topology.nodes[0].template_vmid = 9999; files['topology.json'] = JSON.stringify(topology) }
    if (reason === 'invalid branch') project.git.branch = 'invalid..branch'
    if (reason === 'invalid directory') project.git.subdir = '../secret'
    await expect(loadGitProject(project.git, [])).rejects.toThrow()
    expect(useProjectStore().projects).toHaveLength(0)
  })

  it('does not retain any project when local storage fails', async () => {
    const project = savedScenario()
    repository(project)
    const preview = await loadGitProject(project.git, [])
    vi.stubGlobal('localStorage', {
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError') },
    })
    try {
      expect(() => useProjectStore().importProject(prepareGitProjectImport(preview), { generateNewId: false })).toThrow(/storage/i)
      expect(useProjectStore().projects).toHaveLength(0)
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['credential', 'unknown field', 'missing endpoint', 'duplicate id', 'too many nodes'])('rejects imported canvas %s', reason => {
    const project = savedScenario()
    const { files } = repository(project)
    const layout = JSON.parse(files['canvas_layout.json'])
    if (reason === 'credential') layout.ui_canvas.nodes[0].data.config.vault_password = 'must-not-import'
    if (reason === 'unknown field') layout.ui_canvas.nodes[0].data.allocation = { ownership_token: 'must-not-import' }
    if (reason === 'missing endpoint') layout.ui_canvas.edges[0].target = 'absent'
    if (reason === 'duplicate id') layout.ui_canvas.nodes.push(layout.ui_canvas.nodes[0])
    if (reason === 'too many nodes') layout.ui_canvas.nodes = Array.from({ length: 1025 }, (_, index) => ({ id: `n${index}`, type: 'vm' }))
    files['canvas_layout.json'] = JSON.stringify(layout)
    return expect(loadGitProject(project.git, [])).rejects.toThrow(/canvas|credential|public|node|edge/i)
  })

  it('rejects secret canvas values before saving any Git document', () => {
    const project = savedScenario()
    project.nodes[0].data.config.cloud_init = { password: 'must-not-save' }
    expect(() => buildProjectFiles(buildPushArgs(project, project.nodes, project.edges))).toThrow(/credential|vault/i)
  })

  it('retains secret declarations without values even when malformed scenario metadata requires files-only import', async () => {
    const project = savedScenario()
    const { files } = repository(project)
    const metadata = JSON.parse(files['meta.json'])
    metadata.ui_project.scenario.networks = null
    metadata.ui_project.variables[1].default = 'must-not-restore'
    files['meta.json'] = JSON.stringify(metadata)
    files['overlay.json'] = JSON.stringify({ param_overrides: { env: { VAULT_VALUE: 'must-not-restore' } } })
    const preview = await loadGitProject(project.git, [])
    expect(preview.authoring.status).toBe('conflict')
    const restored = prepareGitProjectImport(preview, 'files')
    expect(restored.baseDoc.env[1]).toEqual({ name: 'VAULT_VALUE', secret: true, required: true })
    expect(JSON.stringify(restored.overlay)).not.toContain('must-not-restore')
  })
})
