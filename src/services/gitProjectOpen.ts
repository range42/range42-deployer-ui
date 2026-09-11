import { randomId } from '@/services/randomId'
import { createProjectRepoAdapter, type ProjectState } from '@/services/projectRepo'
import { providerForBinding, type ProjectGitBinding } from '@/composables/useProjectGitSync'
import { loadCanvasFromState } from '@/overlay/projectState'
import { serializeToCatalogEntry, type CanvasModel } from '@/overlay/serialize'
import { inspectProjectAuthoring, objectValue, publicProjectOverlay, type AuthoringInspection } from '@/services/projectAuthoring'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import { cloneFiles, validateAuthoredFiles, validateFilePath, type ProjectFiles } from '@/services/projectFiles'

export interface GitProjectPreview {
  name: string
  local_id: string
  identity_reused: boolean
  revision: { branch: string; commit_sha: string }
  binding: ProjectGitBinding
  canvas: CanvasModel
  files: ProjectFiles
  overlay: Record<string, unknown>
  authoring: AuthoringInspection
  gamenet: boolean
  bridge_base: number
}

export function validateProjectBinding(binding: ProjectGitBinding): void {
  const owner = binding.repo_owner
  if (!owner || !owner.split('/').every(part => /^[\w][\w.-]*$/.test(part))
    || (binding.provider !== 'gitlab' && owner.includes('/')) || !/^[\w][\w.-]*$/.test(binding.repo_name) || binding.repo_name.endsWith('.git')) throw new Error('Choose a valid repository owner and name')
  const branch = binding.branch || 'main'
  if (branch.startsWith('-') || branch === '@' || branch.includes('..') || branch.includes('@{')
    || Array.from(branch).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character))
    || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) throw new Error('Choose a valid Git branch')
  if (binding.subdir) validateFilePath(binding.subdir)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function restoreCanvas(state: ProjectState) {
  let topology: Record<string, unknown>
  let layout: Record<string, unknown>
  try {
    topology = objectValue(JSON.parse(state.topology || ''), 'Saved topology')
    layout = objectValue(JSON.parse(state.canvas_layout || '{}'), 'Saved canvas layout')
    if (topology.schema_version !== '1.0' || !['lab', 'gamenet', 'component'].includes(String(topology.kind))
      || typeof topology.name !== 'string' || !topology.name || !Array.isArray(topology.nodes)) throw new Error('Invalid topology')
    // The existing deserializer handles canonical nodes; reserialization also
    // rejects cyclic, duplicated or malformed node graphs.
    const legacy = loadCanvasFromState(state)
    const canvas = readCanvasSnapshot(layout.ui_canvas ?? captureCanvasSnapshot(legacy), legacy.attachments)
    {
      const reconstructed = serializeToCatalogEntry(canvas, { name: topology.name,
        kind: topology.kind === 'gamenet' ? 'gamenet' : topology.kind === 'component' ? 'component' : 'lab',
        bridge_base: typeof topology.bridge_base === 'number' ? topology.bridge_base : 140 })
      if (layout.ui_canvas !== undefined && stable(reconstructed.nodes) !== stable(topology.nodes)) throw new Error('Saved canvas no longer matches topology.json; reconcile these files before opening')
    }
    return { canvas, topology }
  } catch (cause) { throw new Error(`Cannot restore this project's canvas: ${cause instanceof Error ? cause.message : String(cause)}`) }
}

/** Read-only preview: every document and asset comes from the selected branch's one HEAD. */
export async function loadGitProject(input: ProjectGitBinding, existingIds: string[]): Promise<GitProjectPreview> {
  const binding = { ...input }
  validateProjectBinding(binding)
  const nonce = randomId().replace(/-/g, '')
  const workingBranch = `range42-ui/open-${nonce}`
  const adapter = createProjectRepoAdapter({ provider: providerForBinding(binding),
    source: { id: binding.source_id, provider: binding.provider, repos: [{ owner: binding.repo_owner,
      repo: binding.repo_name, branch: binding.branch || 'main' }] },
    branchStrategy: binding.branch_strategy, projectPath: binding.subdir || '', workingBranch })
  const state = await adapter.load(`open-${nonce}`, { branch: binding.branch || 'main' })
  if (!state.revision || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(state.revision.commit_sha)) throw new Error('Git did not return an exact project commit SHA')
  validateAuthoredFiles(state.files || {})
  const { canvas, topology } = restoreCanvas(state)
  const authoring = inspectProjectAuthoring(state, canvas)
  const identity_reused = Boolean(authoring.project_id && !existingIds.includes(authoring.project_id))
  const local_id = identity_reused ? authoring.project_id! : `project_${nonce}`
  const overlay = publicProjectOverlay(JSON.parse(state.overlay || '{}'), authoring.variables)
  return { name: String(state.meta.name || topology.name), local_id, identity_reused,
    revision: state.revision, binding: { source_id: binding.source_id, provider: binding.provider, base_url: binding.base_url,
      repo_owner: binding.repo_owner, repo_name: binding.repo_name, branch: binding.branch || 'main',
      branch_strategy: binding.branch_strategy, subdir: binding.subdir || '', fork_policy: binding.fork_policy || 'auto',
      ...(binding.fork_owner ? { fork_owner: binding.fork_owner } : {}), working_branch: workingBranch, branch_from: state.revision.commit_sha },
    canvas, files: cloneFiles(state.files || {}), overlay, authoring, gamenet: topology.kind === 'gamenet',
    bridge_base: typeof topology.bridge_base === 'number' ? topology.bridge_base : 140 }
}

/** Local import is a separate, explicit step. It never writes a Git branch. */
export function prepareGitProjectImport(preview: GitProjectPreview, mode: 'structured' | 'files' = 'structured') {
  if (preview.authoring.status === 'conflict' && mode !== 'files') throw new Error('Choose files-only import to preserve manual changes without generated ownership')
  const useScenario = mode === 'structured' && preview.authoring.status === 'structured'
  // Clone the reviewed snapshot so edits in the imported project cannot mutate
  // an open preview or another local project.
  return JSON.parse(JSON.stringify({ id: preview.local_id, name: preview.name, ...preview.canvas,
    files: preview.files, overlay: preview.overlay, baseDoc: { env: preview.authoring.variables },
    gamenet: preview.gamenet, bridge_base: preview.bridge_base, git: preview.binding, head_sha: preview.revision.commit_sha,
    git_opened: { ...preview.revision, mode: useScenario ? 'structured' : 'files', authoring_status: preview.authoring.status },
    ...(useScenario ? { scenario: preview.authoring.scenario } : {}),
    scenario_generated_paths: useScenario ? preview.authoring.generated_paths : [],
  }))
}
