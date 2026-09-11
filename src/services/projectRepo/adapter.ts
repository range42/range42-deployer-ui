import { randomId } from '@/services/randomId'
import { isGitNotFound, readFileContent } from '@/services/git/fileContent'
import { authoredFilesMetadata, validateAuthoredFilePath, validateAuthoredFiles, restoreBinaryFile, fileContentEquals, fileText, validateFileMap, type FileContent, type ProjectFiles } from '@/services/projectFiles'
/**
 * ProjectRepoAdapter implementation (C1.10).
 *
 * Core responsibilities:
 *  - load: fetch project state (overlay + canvas_layout + meta) from git.
 *  - autosave: write the current state to a per-browser `draft-<uuid>` branch
 *    and mirror the write to IndexedDB `pending_commits` (for recovery on
 *    connectivity loss).
 *  - save: pin the saved working branch HEAD. Publication is a separate action
 *    that either proposes a merge or explicitly copies the snapshot to a target branch.
 *  - acquireLock / heartbeat / checkLockOwnership: .lock file coordination
 *    against the working branch so concurrent browser sessions can detect collisions.
 */

import type { GitProviderV1 } from '@/services/git/types'
import type {
  AdapterConstructorOpts,
  LockInfo,
  ProjectRepoAdapter,
  ProjectState,
} from './index'
import { openProjectDb } from './indexeddb'

function uuid(): string {
  // Use getRandomValues for shared HTTP origins as well as HTTPS.
  return randomId()
}

function nowIso(): string {
  return new Date().toISOString()
}

function draftBranchFor(browserInstanceId: string): string {
  return `draft-${browserInstanceId}`
}

function defaultBranchFor(_opts: AdapterConstructorOpts): string {
  return 'main'
}

function overlayPath(projectPath: string): string {
  return `${projectPath ? projectPath.replace(/\/+$/, '') + '/' : ''}overlay.json`
}

function layoutPath(projectPath: string): string {
  return `${projectPath ? projectPath.replace(/\/+$/, '') + '/' : ''}canvas_layout.json`
}

function metaPath(projectPath: string): string {
  return `${projectPath ? projectPath.replace(/\/+$/, '') + '/' : ''}meta.json`
}

function lockPath(projectPath: string): string {
  return `${projectPath ? projectPath.replace(/\/+$/, '') + '/' : ''}.lock`
}

// Unlike the sibling *Path helpers, this intentionally omits the leading slash
// for an empty projectPath: build-from-scratch deploys read topology.json at the
// project repo ROOT (see backend checkout_project), so it must resolve to
// `topology.json`, never `/topology.json`.
function topologyPath(projectPath: string): string {
  const base = projectPath.replace(/\/+$/, '')
  return base ? `${base}/topology.json` : 'topology.json'
}

interface SharedWorkerLike {
  port: { postMessage(data: unknown): void }
}

let _worker: SharedWorkerLike | null = null
function heartbeatWorker(): SharedWorkerLike | null {
  if (_worker) return _worker
  if (typeof SharedWorker === 'undefined') return null
  try {
    // Vite will resolve the `*.worker.ts` path with `{ worker: { format: 'es' } }`.
    const w = new SharedWorker(
      new URL('./heartbeat.worker.ts', import.meta.url),
      { type: 'module', name: 'range42-heartbeat' },
    )
    w.port.start()
    _worker = { port: w.port }
    return _worker
  } catch {
    return null
  }
}

class RepoAdapter implements ProjectRepoAdapter {
  private provider: GitProviderV1
  private owner: string
  private repo: string
  private mainBranch: string
  private draftBranch: string
  private branchFrom: string
  private projectPath: string
  private browserInstanceId: string
  private orphanCbs: Array<(draftId: string) => void> = []
  private shaCache = new Map<string, string>()
  private heartbeatStarted = false
  private writtenPaths: string[] = []

  constructor(opts: AdapterConstructorOpts) {
    this.provider = opts.provider
    const firstRepo = opts.source.repos?.[0]
    if (!firstRepo) {
      throw new Error('ProjectRepoAdapter: source.repos is empty')
    }
    this.owner = firstRepo.owner
    this.repo = firstRepo.repo
    this.mainBranch = firstRepo.branch || defaultBranchFor(opts)
    this.branchFrom = opts.branchFrom || this.mainBranch
    this.projectPath = opts.projectPath
    this.browserInstanceId = opts.browserInstanceId ?? uuid()
    this.draftBranch = opts.workingBranch || draftBranchFor(this.browserInstanceId)
    if (this.draftBranch === this.mainBranch) throw new Error('Choose a dedicated working branch, separate from the base branch')
  }

  // ---------------------------------------------------------------------------
  // load / autosave / save
  // ---------------------------------------------------------------------------

  async load(_projectId: string, options?: { branch: string }): Promise<ProjectState> {
    let branch = options?.branch || this.draftBranch
    let revision: string
    try { revision = await this.headCommitSha(branch) }
    catch (error) {
      if (options || !isGitNotFound(error)) throw error
      branch = this.mainBranch
      revision = await this.headCommitSha(branch)
    }
    const [overlay, layout, meta, topology] = await Promise.all([
      this.safeGet(overlayPath(this.projectPath), revision),
      this.safeGet(layoutPath(this.projectPath), revision),
      this.safeGet(metaPath(this.projectPath), revision),
      this.safeGet(topologyPath(this.projectPath), revision),
    ])
    let metadata: Record<string, unknown> = {}
    try {
      metadata = meta ? JSON.parse(fileText(meta.content)) : {}
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || (metadata.ui_files !== undefined && (!Array.isArray(metadata.ui_files) || metadata.ui_files.some(path => typeof path !== 'string')))
        || (metadata.ui_binary_files !== undefined && (!metadata.ui_binary_files || typeof metadata.ui_binary_files !== 'object' || Array.isArray(metadata.ui_binary_files)))) throw new Error('Invalid manifest shape')
    } catch { throw new Error('Saved project metadata is invalid. Repair meta.json before loading authored files.') }
    const authoredPaths = Array.isArray(metadata.ui_files) ? metadata.ui_files : []
    const binaryMetadata = metadata.ui_binary_files && typeof metadata.ui_binary_files === 'object' ? metadata.ui_binary_files : {}
    if (Object.keys(binaryMetadata).some(path => !authoredPaths.includes(path))) throw new Error('Binary file metadata refers to a file missing from the authored manifest')
    const authored = await Promise.all(authoredPaths.map(async (path: string) => {
      const file = await this.safeGet(this.authoredFilePath(path), revision)
      if (!file) throw new Error(`Saved authored file is missing: ${path}`)
      return [path, Object.hasOwn(binaryMetadata, path) ? restoreBinaryFile(file.content, Reflect.get(binaryMetadata, path)) : file.content]
    }))
    delete metadata.ui_files
    delete metadata.ui_binary_files
    validateFileMap(Object.fromEntries(authored))
    return {
      revision: { branch, commit_sha: revision },
      overlay: overlay ? fileText(overlay.content) : '', canvas_layout: layout ? fileText(layout.content) : '',
      meta: metadata, topology: topology ? fileText(topology.content) : '', files: Object.fromEntries(authored),
    }
  }

  async autosave(projectId: string, state: ProjectState): Promise<void> {
    validateAuthoredFiles(state.files || {})
    const files = {
      [overlayPath(this.projectPath)]: state.overlay,
      [layoutPath(this.projectPath)]: state.canvas_layout,
      [metaPath(this.projectPath)]: JSON.stringify({ ...state.meta, ...authoredFilesMetadata(state.files) }, null, 2),
      [topologyPath(this.projectPath)]: state.topology ?? '',
      ...Object.fromEntries(Object.entries(state.files || {}).map(([path, content]) => [this.authoredFilePath(path), content])),
    }
    await this.stageFiles(projectId, files, `autosave: ${projectId}`)

    // Mirror to IndexedDB `pending_commits` for crash recovery.
    try {
      const db = await openProjectDb()
      await db.put('pending_commits', {
        id: `${projectId}:${Date.now()}`,
        projectId,
        branch: this.draftBranch,
        path: overlayPath(this.projectPath),
        content: state.overlay,
        message: 'autosave',
        queuedAt: Date.now(),
      })
      await db.put('drafts', {
        projectId,
        state,
        updatedAt: Date.now(),
      })
    } catch {
      // IDB is best-effort; network path is authoritative.
    }
  }

  async stageFiles(projectId: string, files: ProjectFiles, message: string): Promise<void> {
    validateFileMap(files)
    if (!await this.provider.canWrite(this.owner, this.repo)) {
      throw new Error('Write permission is required for this repository')
    }
    await this.ensureDraftBranch()
    this.writtenPaths = Object.keys(files)
    if (this.provider.commitFiles) {
      await this.writeAtomicSnapshot(this.draftBranch, files, message || `Save ${projectId}`)
      return
    }
    for (const [path, content] of Object.entries(files)) {
      const key = `${this.draftBranch}:${path}`
      const existing = await this.safeGet(path, this.draftBranch)
      if (fileContentEquals(existing?.content, content)) continue
      const sha = this.shaCache.get(key) ?? existing?.sha
      const result = await this.provider.putFile({
        owner: this.owner, repo: this.repo, path, content, sha,
        message: message || `Save ${projectId}`, branch: this.draftBranch,
      })
      this.shaCache.set(key, result.sha)
    }
  }

  async save(_projectId: string, _message: string): Promise<{ commit_sha: string; branch: string }> {
    return { commit_sha: await this.headCommitSha(this.draftBranch), branch: this.draftBranch }
  }

  async proposeMerge(projectId: string, message: string): Promise<{ pr_url: string }> {
    const pr = await this.provider.createPullRequest({
      owner: this.owner, repo: this.repo, from: this.draftBranch, to: this.mainBranch,
      title: message || `Save ${projectId}`, body: 'Changes prepared in Range42 Deployer UI.',
    })
    return { pr_url: pr.url }
  }

  async publishDirect(projectId: string, message: string): Promise<{ commit_sha: string; branch: string }> {
    let written = 0
    try {
      if (this.provider.commitFiles) {
        const files = Object.fromEntries(await Promise.all(this.writtenPaths.map(async path => [path,
          (await readFileContent(this.provider, { owner: this.owner, repo: this.repo, path, ref: this.draftBranch })).content,
        ])))
        return { commit_sha: await this.writeAtomicSnapshot(this.mainBranch, files, message || `Publish ${projectId}`), branch: this.mainBranch }
      }
      for (const path of this.writtenPaths) {
        const file = await readFileContent(this.provider, { owner: this.owner, repo: this.repo, path, ref: this.draftBranch })
        const existing = await this.safeGet(path, this.mainBranch)
        if (fileContentEquals(existing?.content, file.content)) continue
        await this.provider.putFile({
          owner: this.owner, repo: this.repo, path, content: file.content, sha: existing?.sha,
          message: message || `Publish ${projectId}`, branch: this.mainBranch,
        })
        written += 1
      }
      return { commit_sha: await this.headCommitSha(this.mainBranch), branch: this.mainBranch }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.provider.commitFiles) {
        throw Object.assign(new Error(`Atomic publication could not be confirmed for ${this.mainBranch}. ${reason}`), { partial: false })
      }
      throw Object.assign(new Error(`${written} file(s) already written to ${this.mainBranch}. ${reason}`), { partial: written > 0 })
    }
  }

  private async writeAtomicSnapshot(branch: string, files: ProjectFiles, message: string): Promise<string> {
    const expectedHead = await this.headCommitSha(branch)
    const changes = []
    for (const [path, content] of Object.entries(files)) {
      const existing = await this.safeGet(path, expectedHead)
      if (!fileContentEquals(existing?.content, content)) changes.push({ path, content, sha: existing?.sha })
    }
    if (!changes.length) return expectedHead
    const commit = await this.provider.commitFiles!({ owner: this.owner, repo: this.repo, branch, expectedHead, message, files: changes })
    if (!commit.sha) throw new Error('The Git provider did not confirm the saved commit')
    return commit.sha
  }

  // ---------------------------------------------------------------------------
  // lock / heartbeat
  // ---------------------------------------------------------------------------

  async acquireLock(projectId: string): Promise<LockInfo> {
    const info: LockInfo = {
      editor_id: projectId,
      browser_instance_id: this.browserInstanceId,
      heartbeat_at: nowIso(),
    }
    await this.writeLock(info)
    this.startHeartbeatWorker(projectId)
    return info
  }

  private startHeartbeatWorker(projectId: string): void {
    if (this.heartbeatStarted) return
    const w = heartbeatWorker()
    if (!w) return
    // Endpoint: front-end calls the provider's putFile; the SharedWorker
    // talks to the backend `/v1/projects/:id/heartbeat` shim (spec §4).
    w.port.postMessage({
      cmd: 'start',
      projectId,
      endpoint: `/v1/projects/${encodeURIComponent(projectId)}/heartbeat`,
    })
    this.heartbeatStarted = true
  }

  async heartbeat(projectId: string): Promise<void> {
    const info: LockInfo = {
      editor_id: projectId,
      browser_instance_id: this.browserInstanceId,
      heartbeat_at: nowIso(),
    }
    await this.writeLock(info)
  }

  onOrphanedDraft(cb: (draftId: string) => void): void {
    this.orphanCbs.push(cb)
  }

  async checkLockOwnership(_projectId: string): Promise<'owner' | 'lost' | 'free'> {
    const existing = await this.safeGet(lockPath(this.projectPath))
    if (!existing) return 'free'
    const info = safeParseJson<LockInfo>(fileText(existing.content))
    if (!info || !info.browser_instance_id) return 'free'
    if (info.browser_instance_id === this.browserInstanceId) return 'owner'
    // Fire orphaned-draft callbacks so callers can prompt the user.
    for (const cb of this.orphanCbs) {
      try {
        cb(this.draftBranch)
      } catch {
        /* listener errors are not fatal */
      }
    }
    return 'lost'
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private authoredFilePath(path: string): string {
    validateAuthoredFilePath(path)
    const prefix = this.projectPath.replace(/\/+$/, '')
    return prefix ? `${prefix}/${path}` : path
  }

  private async ensureDraftBranch(): Promise<void> {
    try {
      await this.provider.createBranch({
        owner: this.owner,
        repo: this.repo,
        from: this.branchFrom,
        name: this.draftBranch,
      })
    } catch (err) {
      // Branch already exists — swallow.
      if (!isBranchAlreadyExistsError(err)) throw err
    }
  }

  private async safeGet(
    path: string,
    ref?: string,
  ): Promise<{ content: FileContent; sha: string } | null> {
    try {
      return await readFileContent(this.provider, {
        owner: this.owner,
        repo: this.repo,
        path,
        ref: ref ?? this.draftBranch,
      })
    } catch (error) {
      if (isGitNotFound(error)) return null
      throw error
    }
  }

  private async writeLock(info: LockInfo): Promise<void> {
    await this.ensureDraftBranch()
    const path = lockPath(this.projectPath)
    const existing = await this.safeGet(path)
    await this.provider.putFile({
      owner: this.owner,
      repo: this.repo,
      path,
      content: JSON.stringify(info, null, 2),
      sha: existing?.sha,
      message: `lock heartbeat: ${info.editor_id}`,
      branch: this.draftBranch,
    })
  }

  private async headCommitSha(ref: string): Promise<string> {
    const commits = await this.provider.listCommits({ owner: this.owner, repo: this.repo, ref, perPage: 1 })
    if (!commits[0]?.sha) throw new Error('Cannot pin the saved branch HEAD revision')
    return commits[0].sha
  }
}

function isBranchAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /already exists|branch.*exists/i.test(msg)
}

function safeParseJson<T = Record<string, unknown>>(s: string): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return {} as T
  }
}

export function createProjectRepoAdapter(opts: AdapterConstructorOpts): ProjectRepoAdapter {
  return new RepoAdapter(opts)
}
