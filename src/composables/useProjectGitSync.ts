import { isGitNotFound, readFileContent } from '@/services/git/fileContent'
import { publicationBranch as publicationBranchFor } from '@/services/git/publicationBranch'
import { captureProjectAuthoring, publicProjectOverlay, type AuthoringInput } from '@/services/projectAuthoring'
import { authoredFilesMetadata, validateAuthoredFiles, cloneFiles, fileContentEquals, validateFileMap, validateFilePath, type ProjectFiles } from '@/services/projectFiles'
/**
 * useProjectGitSync — on-demand "serialize canvas → push to git → pin SHA".
 *
 * Unlike useProjectRepo (which binds an editor session to a repo at mount with
 * lock heartbeats), this is a lifecycle-free action invoked when the operator
 * explicitly saves/deploys. It serializes the live canvas into the canonical
 * topology.json (via the tested overlay serializer), autosaves it to the
 * project's dedicated working branch and returns its commit SHA for deployment.
 * Publication to base branches is a separate explicit operation.
 */

import { getProvider } from '@/services/git'
import { createProjectRepoAdapter } from '@/services/projectRepo'
import { buildProjectState } from '@/overlay/projectState'
import { useInventoryStore } from '@/stores/inventoryStore'
import type { CanvasModel, ProjectMeta } from '@/overlay/serialize'
import type { BranchStrategy } from '@/services/projectRepo'
import type { GitProviderV1 } from '@/services/git/types'

export type ForkPolicy = 'auto' | 'fork' | 'upstream'

export interface ProjectGitBinding {
  /** Matches both the UI inventoryStore source id (for the PAT) and the
   *  backend Source row id, so UI push and backend clone agree. */
  source_id: string
  provider: 'github' | 'gitlab' | 'gitea' | 'generic'
  base_url: string
  repo_owner: string
  repo_name: string
  branch?: string
  working_branch?: string
  /** Immutable seed for a newly opened project's dedicated working branch. */
  branch_from?: string
  fork_policy?: ForkPolicy
  fork_owner?: string
  publish_targets?: ProjectPublishTarget[]
  publish_results?: ProjectPublishResult[]
  branch_strategy: BranchStrategy
  /** Subdirectory for shared_repo_subdir; '' (root) for dedicated_repo. */
  subdir?: string
}

export interface PushToGitArgs {
  projectId: string
  binding: ProjectGitBinding
  canvas: CanvasModel
  meta: ProjectMeta
  message?: string
  files?: ProjectFiles
  overlay?: Record<string, unknown>
  authoring?: AuthoringInput
}

/**
 * Map a stored project + the live canvas graph into PushToGitArgs. Returns null
 * when the project has no git binding (so callers skip the git push and fall
 * back to local-only persistence). Pure — no IO — so it stays unit-testable
 * outside the editor component.
 */
export function buildPushArgs(
  project: {
    id: string
    name: string
    git?: ProjectGitBinding
    gamenet?: boolean
    bridge_base?: number
    attachments?: unknown[]
    files?: ProjectFiles
    overlay?: Record<string, unknown>
    scenario?: unknown
    scenario_generated_paths?: unknown
    baseDoc?: { env?: unknown }
  },
  nodes: unknown[],
  edges: unknown[],
  message?: string,
): PushToGitArgs | null {
  if (!project?.git) return null
  return {
    projectId: project.id,
    binding: project.git,
    canvas: {
      nodes: (nodes ?? []) as CanvasModel['nodes'],
      edges: (edges ?? []) as CanvasModel['edges'],
      attachments: (project.attachments ?? []) as CanvasModel['attachments'],
    },
    meta: {
      name: project.name,
      kind: project.gamenet ? 'gamenet' : 'lab',
      bridge_base: project.bridge_base,
    },
    message: message ?? `Save ${project.name}`,
    files: project.files,
    overlay: project.overlay,
    authoring: { scenario: project.scenario, generated_paths: project.scenario_generated_paths, variables: project.baseDoc?.env },
  }
}

export function useProjectGitSync() {

  function pushToGit(
    args: PushToGitArgs,
  ): Promise<{ commit_sha: string; branch: string; binding?: ProjectGitBinding }> {
    validateFileMap(buildProjectFiles(args))
    const { projectId, meta, message } = args
    const binding = { ...args.binding }
    const provider = providerForBinding(binding)
    const branch = binding.working_branch ?? workingBranchForProject(projectId)
    const state = captureProjectState(args)
    return withWritableCheckpoint(binding, branch, provider, async (actual, adapter) => {
      await adapter.autosave(projectId, state)
      const saved = await adapter.save(projectId, message ?? `Update ${meta.name}`)
      return { ...saved, ...(actual !== binding ? { binding: actual } : {}) }
    })
  }

  async function proposeMerge(args: PushToGitArgs) {
    const provider = providerForBinding(args.binding)
    const adapter = createProjectRepoAdapter({
      provider,
      source: { id: args.binding.source_id, provider: args.binding.provider,
        repos: [{ owner: args.binding.repo_owner, repo: args.binding.repo_name, branch: args.binding.branch || 'main' }] },
      branchStrategy: args.binding.branch_strategy, projectPath: args.binding.subdir || '', workingBranch: args.binding.working_branch ?? workingBranchForProject(args.projectId),
    })
    const saved = await pushToGit(args)
    if (saved.binding) {
      const pr = await provider.createPullRequest({ owner: args.binding.repo_owner, repo: args.binding.repo_name,
        source: { owner: saved.binding.repo_owner, repo: saved.binding.repo_name }, from: saved.branch,
        to: args.binding.branch || 'main', title: args.message || `Publish ${args.meta.name}`,
      })
      return { ...saved, pr_url: pr.url }
    }
    return { ...saved, ...await adapter.proposeMerge(args.projectId, args.message || `Publish ${args.meta.name}`) }
  }

  return { pushToGit, proposeMerge, publishFilesToTargets }

}


export interface ProjectPublishTarget {
  id: string
  source_id: string
  provider: ProjectGitBinding['provider']
  base_url: string
  repo_owner: string
  repo_name: string
  base_branch: string
  mode: 'pull_request' | 'direct'
  fork_policy?: ForkPolicy
  fork_owner?: string
  subdir?: string
}

export interface ProjectPublishResult {
  target_id: string
  status: 'published' | 'failed'
  mode: ProjectPublishTarget['mode']
  commit_sha?: string
  branch?: string
  pr_url?: string
  pr_number?: number
  merged?: boolean
  destination?: ProjectPublishTarget
  error?: string
  partial?: boolean
  fork?: { owner: string; repo: string }
}

export function workingBranchForProject(projectId: string): string {
  if (!projectId) throw new Error('A project identifier is required')
  return `range42-ui/${encodeURIComponent(projectId).replace(/\./g, '%2E')}`
}

export async function publishFilesToTargets(args: {
  projectId: string
  binding: ProjectGitBinding
  files: ProjectFiles
  message: string
  createOnly?: boolean
  componentPath?: string
}, targets: ProjectPublishTarget[]): Promise<{commit_sha:string;branch:string;binding?:ProjectGitBinding;targets:ProjectPublishResult[]}> {
  args = { ...args, binding: { ...args.binding }, files: cloneFiles(args.files) }
  const files = args.files
  validateFiles(files)
  if (!targets.length) throw new Error('Choose at least one publication destination')
  const binding = { ...args.binding }
  const branch = binding.working_branch ?? workingBranchForProject(args.projectId)
  const primaryProvider = providerForBinding(binding)
  // Capture every provider and credential before the first await. Switching
  // backend while a request is in flight must never select another source PAT.
  const prepared = targets.map(input => {
    const target = { ...input }
    const destination: ProjectGitBinding = {
      source_id: target.source_id, provider: target.provider, base_url: target.base_url,
      repo_owner: target.repo_owner, repo_name: target.repo_name, branch: target.base_branch,
      branch_strategy: 'dedicated_repo', subdir: target.subdir, fork_owner: target.fork_owner,
    }
    const publicationBranch = publicationBranchFor(args.projectId, target)
    try {
      return { target, destination, publicationBranch, connection: adapterForBinding(destination, publicationBranch) }
    } catch (error) {
      return { target, destination, publicationBranch, error }
    }
  })
  const primaryFiles = prefixFiles(files, binding.subdir)
  const saved = await withWritableCheckpoint(binding, branch, primaryProvider, async (actual, adapter) => {
    if (args.createOnly) {
      const ownCheckpoint = await matchesCheckpoint(primaryProvider, actual, branch, primaryFiles)
      await assertComponentAbsent(primaryProvider, binding, primaryFiles, args.componentPath, ownCheckpoint)
    }
    await adapter.stageFiles(args.projectId, primaryFiles, args.message)
    return { ...await adapter.save(args.projectId, args.message), ...(actual !== binding ? { binding: actual } : {}) }
  })
  const results: ProjectPublishResult[] = []
  for (const { target, destination, connection, publicationBranch, error: setupError } of prepared) {
    try {
      if (setupError) throw setupError
      if (!connection) throw new Error('Publication connection is unavailable')
      if (!['pull_request', 'direct'].includes(target.mode)) throw new Error('Choose a publication mode')
      const provider = connection.provider
      const resolved = target.mode === 'pull_request'
        ? await resolveWritableBinding(destination, provider, target.fork_policy || 'auto')
        : { binding: destination }
      const actual = resolved.binding
      const fork = actual !== destination ? { owner: actual.repo_owner, repo: actual.repo_name } : undefined
      const published = await runOnBranch(actual, publicationBranch, async () => {
        const { adapter } = adapterForBinding(actual, publicationBranch, provider, resolved.branchFrom)
        const targetFiles = prefixFiles(files, target.subdir)
        if (args.createOnly) {
          const ownCheckpoint = await matchesCheckpoint(provider, actual, publicationBranch, targetFiles)
          await assertComponentAbsent(provider, destination, targetFiles, args.componentPath, ownCheckpoint)
        }
        await adapter.stageFiles(args.projectId, targetFiles, args.message)
        const checkpoint = await adapter.save(args.projectId, args.message)
        if (target.mode === 'direct') return runOnBranch(destination, target.base_branch, () => adapter.publishDirect(args.projectId, args.message))
        const pr = await provider.createPullRequest({
          owner: destination.repo_owner, repo: destination.repo_name, from: publicationBranch,
          to: target.base_branch, title: args.message, body: 'Changes prepared in Range42 Deployer UI.',
          ...(fork ? { source: fork } : {}),
        })
        return { ...checkpoint, pr_url: pr.url, pr_number: pr.number, ...(fork ? { fork } : {}) }
      })
      results.push({ target_id: target.id, status: 'published', mode: target.mode, destination: target, ...published })
    } catch (error) {
      results.push({ target_id: target.id, status: 'failed', mode: target.mode,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && 'partial' in error ? { partial: Boolean(error.partial) } : {}) })
    }
  }
  return { ...saved, targets: results }
}


function adapterForBinding(binding: ProjectGitBinding, workingBranch: string, provider = providerForBinding(binding), branchFrom?: string) {
  const adapter = createProjectRepoAdapter({
    provider, source: { id: binding.source_id, provider: binding.provider, repos: [{
      owner: binding.repo_owner, repo: binding.repo_name, branch: binding.branch || 'main',
    }] }, branchStrategy: binding.branch_strategy, projectPath: binding.subdir || '', workingBranch, branchFrom: branchFrom || binding.branch_from,
  })
  return { adapter, provider }
}

async function resolveWritableBinding(binding: ProjectGitBinding, provider: GitProviderV1, policy: ForkPolicy): Promise<{ binding: ProjectGitBinding; branchFrom?: string }> {
  if (binding.branch_from && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(binding.branch_from)) throw new Error('The saved branch seed must be an exact commit SHA')
  if (policy === 'upstream' || !provider.ensureFork) return { binding }
  if (policy !== 'fork' && await provider.canWrite(binding.repo_owner, binding.repo_name)) return { binding }
  const fork = await provider.ensureFork({ owner: binding.repo_owner, repo: binding.repo_name, ...(binding.fork_owner ? { destination: binding.fork_owner } : {}) })
  if (binding.branch_from) return { binding: { ...binding, repo_owner: fork.owner, repo_name: fork.repo, fork_policy: 'upstream' }, branchFrom: binding.branch_from }
  const commits = await provider.listCommits({ owner: binding.repo_owner, repo: binding.repo_name, ref: binding.branch || 'main', perPage: 1 })
  if (!commits[0]?.sha) throw new Error('The upstream branch has no commit to start a contribution')
  return { binding: { ...binding, repo_owner: fork.owner, repo_name: fork.repo, fork_policy: 'upstream' }, branchFrom: commits[0].sha }
}

function withWritableCheckpoint<T>(binding: ProjectGitBinding, branch: string, provider: GitProviderV1,
  operation: (actual: ProjectGitBinding, adapter: ReturnType<typeof createProjectRepoAdapter>) => Promise<T>): Promise<T> {
  return runOnBranch(binding, branch, async () => {
    const resolved = await resolveWritableBinding(binding, provider, binding.fork_policy || 'auto')
    const run = () => operation(resolved.binding, adapterForBinding(resolved.binding, branch, provider, resolved.branchFrom).adapter)
    return resolved.binding === binding ? run() : runOnBranch(resolved.binding, branch, run)
  })
}

function isMissingFile(error: unknown) {
  return isGitNotFound(error)
}

const validatePath = validateFilePath

function validateFiles(files: ProjectFiles) {
  if (!Object.keys(files).length) throw new Error('There are no files to publish')
  validateFileMap(files)
}

function prefixFiles(files: ProjectFiles, subdir?: string) {
  const prefix = subdir?.replace(/\/+$/, '') || ''
  if (prefix) validatePath(prefix)
  return Object.fromEntries(Object.entries(files).map(([path, content]) => [prefix ? `${prefix}/${path}` : path, content]))
}


async function assertComponentAbsent(
  provider: ReturnType<typeof getProvider>, binding: ProjectGitBinding,
  files: ProjectFiles, componentPath?: string, allowMatching = false,
) {
  const ref = binding.branch || 'main'
  if (componentPath) {
    validatePath(componentPath)
    const path = binding.subdir ? `${binding.subdir.replace(/\/+$/, '')}/${componentPath}` : componentPath
    try {
      const existing = await provider.listTree({ owner: binding.repo_owner, repo: binding.repo_name, ref, path })
      if (existing.length && (!allowMatching || existing.some(entry => {
        const entryPath = entry.path.startsWith(`${path}/`) ? entry.path : `${path}/${entry.path}`
        return !Object.keys(files).some(file => file === entryPath || file.startsWith(`${entryPath}/`))
      }))) throw new Error(`Component already exists: ${path}`)
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
  }
  for (const path of Object.keys(files)) {
    try {
      const existing = await readFileContent(provider, { owner: binding.repo_owner, repo: binding.repo_name, ref, path })
      if (!allowMatching || !fileContentEquals(existing.content, files[path])) throw new Error(`Component file already exists: ${path}`)
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
  }
}


async function matchesCheckpoint(
  provider: ReturnType<typeof getProvider>, binding: ProjectGitBinding,
  branch: string, files: ProjectFiles,
): Promise<boolean> {
  let matches = true
  for (const [path, content] of Object.entries(files)) {
    try {
      const existing = await readFileContent(provider, { owner: binding.repo_owner, repo: binding.repo_name, path, ref: branch })
      if (!fileContentEquals(existing.content, content)) throw new Error(`Another draft already exists at ${branch}:${path}`)
    } catch (error) {
      if (!isMissingFile(error)) throw error
      matches = false
    }
  }
  return matches
}


/** Project-relative files shown in the publication preview. */
export function buildProjectFiles(args: PushToGitArgs): ProjectFiles {
  const state = captureProjectState(args)
  return {
    'overlay.json': state.overlay,
    'canvas_layout.json': state.canvas_layout,
    'meta.json': JSON.stringify({ ...state.meta, ...authoredFilesMetadata(args.files) }, null, 2),
    'topology.json': state.topology || '',
    ...state.files,
  }
}

function captureProjectState(args: PushToGitArgs) {
  validateAuthoredFiles(args.files || {})
  const authoring = captureProjectAuthoring(args.projectId, args.authoring)
  const state = buildProjectState(args.canvas, args.meta, { ui_project: authoring })
  if (args.overlay !== undefined) state.overlay = JSON.stringify(publicProjectOverlay(args.overlay, authoring.variables), null, 2)
  if (args.files) state.files = cloneFiles(args.files)
  return state
}


export function providerForBinding(binding: Pick<ProjectGitBinding, 'source_id' | 'provider' | 'base_url'>) {
  const inventory = useInventoryStore()
  const token = inventory.getToken(binding.source_id)
  const providerKind = binding.provider === 'generic' ? 'gitea' : binding.provider
  if (token) {
    const source = inventory.getSource(binding.source_id)
    const sourceKind = source?.provider === 'generic' ? 'gitea' : source?.provider
    const normalize = (url: string) => new URL(url).toString().replace(/\/+$/, '')
    if (!source || sourceKind !== providerKind || normalize(source.base_url) !== normalize(binding.base_url)) {
      throw new Error('The project connection does not match the configured Git source. Reconnect the source before saving.')
    }
  }
  return getProvider(providerKind, { baseUrl: binding.base_url, token })
}


const branchOperations = new Map<string, Promise<void>>()

/** All callers share repository/branch queues, including editor autosave and publication. */
export function runOnBranch<T>(binding: ProjectGitBinding, branch: string, operation: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([
    binding.provider === 'generic' ? 'gitea' : binding.provider,
    binding.base_url.replace(/\/+$/, ''), binding.repo_owner, binding.repo_name, branch,
  ])
  const previous = branchOperations.get(key) || Promise.resolve()
  const result = previous.then(operation)
  const settled = result.then(() => {}, () => {})
  branchOperations.set(key, settled)
  void settled.then(() => {
    if (branchOperations.get(key) === settled) branchOperations.delete(key)
  })
  return result
}
