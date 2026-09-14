import { randomId } from '@/services/randomId'
import { isGitNotFound, readFileContent } from '@/services/git/fileContent'
import { authoredFilesMetadata, validateAuthoredFilePath, validateAuthoredFiles, restoreBinaryFile, fileContentEquals, fileText, validateFileMap, validateFilePath, type FileContent, type ProjectFiles } from '@/services/projectFiles'
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

const LEASE_MS = 180_000
export class GitEditorConflict extends Error {
  constructor(public code: 'busy' | 'expired' | 'lost' | 'invalid' | 'changed' | 'unavailable', message: string) {
    super(message); this.name = 'GitEditorConflict'
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
  private leaseId: string | null = null
  private blocked = false
  private retired = false
  private reviewedRevision?: string
  private publicationRevision?: string
  private branchReady = false
  private createdBranch = false
  private contextValid: () => boolean
  private target: string
  private operations: Promise<unknown> = Promise.resolve()
  private writtenPaths: string[] = []

  constructor(private opts: AdapterConstructorOpts, private publicationOnly = false) {
    this.provider = opts.provider
    this.contextValid = opts.contextValid || (() => true)
    this.reviewedRevision = opts.expectedRevision
    const firstRepo = opts.source.repos?.[0]
    if (!firstRepo) {
      throw new Error('ProjectRepoAdapter: source.repos is empty')
    }
    this.owner = firstRepo.owner
    this.repo = firstRepo.repo
    this.mainBranch = firstRepo.branch || defaultBranchFor(opts)
    this.branchFrom = opts.branchFrom || this.mainBranch
    this.projectPath = opts.projectPath.replace(/\/+$/, '')
    if (this.projectPath) validateFilePath(this.projectPath)
    this.browserInstanceId = opts.browserInstanceId ?? uuid()
    this.draftBranch = opts.workingBranch || draftBranchFor(this.browserInstanceId)
    const url = opts.source.base_url ? new URL(opts.source.base_url) : null
    if (url && (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol))) throw new Error('Use a public Git base URL without credentials, query or fragment.')
    this.target = JSON.stringify([opts.source.provider === 'generic' ? 'gitea' : opts.source.provider,
      url?.toString().replace(/\/+$/, '') || '', this.owner, this.repo, this.draftBranch, this.projectPath])
    if (this.draftBranch === this.mainBranch && !publicationOnly) throw new Error('Choose a dedicated working branch, separate from the base branch')
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
    this.reviewedRevision = revision
    return {
      revision: { branch, commit_sha: revision },
      overlay: overlay ? fileText(overlay.content) : '', canvas_layout: layout ? fileText(layout.content) : '',
      meta: metadata, topology: topology ? fileText(topology.content) : '', files: Object.fromEntries(authored),
    }
  }

  async autosave(projectId: string, state: ProjectState): Promise<void> {
    validateAuthoredFiles(state.files || {})
    state = JSON.parse(JSON.stringify(state)) as ProjectState
    const files = {
      [overlayPath(this.projectPath)]: state.overlay,
      [layoutPath(this.projectPath)]: state.canvas_layout,
      [metaPath(this.projectPath)]: JSON.stringify({ ...state.meta, ...authoredFilesMetadata(state.files) }, null, 2),
      [topologyPath(this.projectPath)]: state.topology ?? '',
      ...Object.fromEntries(Object.entries(state.files || {}).map(([path, content]) => [this.authoredFilePath(path), content])),
    }
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
        state: JSON.parse(JSON.stringify(state)),
        updatedAt: Date.now(),
      })
    } catch {
      // The editor also persists its local project; this extra recovery cache is best-effort.
    }
    await this.stageFiles(projectId, files, `autosave: ${projectId}`)
  }

  stageFiles(projectId: string, files: ProjectFiles, message: string, options?: { expectedRevision?: string }): Promise<void> {
    validateFileMap(files)
    if (this.projectPath && Object.keys(files).some(path => !path.startsWith(`${this.projectPath}/`))) throw new Error('Project files must stay inside the directory protected by this editor lock')
    if (Object.keys(files).some(path => path === '.lock' || path.endsWith('/.lock'))) throw new Error('Editor lock files cannot be supplied as project content')
    const captured = JSON.parse(JSON.stringify(files)) as ProjectFiles
    return this.serial(async () => {
      this.requireAtomic()
      if (!await this.provider.canWrite(this.owner, this.repo)) throw new Error('Write permission is required for this repository')
      if (!this.leaseId) await this.acquire(projectId)
      await this.writeAtomicSnapshot(this.draftBranch, captured, message || `Save ${projectId}`, projectId, options?.expectedRevision)
      this.writtenPaths = Object.keys(captured)
    })
  }

  save(projectId: string, _message: string): Promise<{ commit_sha: string; branch: string }> {
    return this.serial(async () => {
      await this.owned(projectId)
      if (!this.reviewedRevision) throw new Error('Save a project checkpoint first')
      // Heartbeats advance HEAD; deployment must stay pinned to the actual content commit.
      return { commit_sha: this.reviewedRevision, branch: this.draftBranch }
    })
  }

  proposeMerge(projectId: string, message: string, target?: { owner: string; repo: string }): Promise<{ pr_url: string; pr_number?: number }> {
    return this.serial(async () => {
      const lease = this.parseLock((await this.owned(projectId)).content)
      this.assertWritable(lease)
      const pr = await this.provider.createPullRequest({ owner: target?.owner || this.owner, repo: target?.repo || this.repo,
        ...(target && (target.owner !== this.owner || target.repo !== this.repo) ? { source: { owner: this.owner, repo: this.repo } } : {}),
        assertCurrent: () => this.assertWritable(lease),
        from: this.draftBranch, to: this.mainBranch, title: message || `Save ${projectId}`,
        body: 'Changes prepared in Range42 Deployer UI.' })
      return { pr_url: pr.url, pr_number: pr.number }
    })
  }

  publishDirect(projectId: string, message: string): Promise<{ commit_sha: string; branch: string }> {
    return this.serial(async () => {
      await this.owned(projectId)
      const files = Object.fromEntries(await Promise.all(this.writtenPaths.map(async path => [path,
        (await readFileContent(this.provider, { owner: this.owner, repo: this.repo, path, ref: this.reviewedRevision })).content,
      ])))
      if (!this.publicationRevision) throw new Error('Review the publication destination first')
      const sourceLease = this.parseLock((await this.owned(projectId)).content)
      const publisher = new RepoAdapter({ ...this.opts, workingBranch: this.mainBranch, branchFrom: this.publicationRevision,
        expectedRevision: this.publicationRevision, browserInstanceId: this.browserInstanceId,
        contextValid: () => { this.assertWritable(sourceLease); return true },
      }, true)
      try {
        await publisher.stageFiles(projectId, files, message || `Publish ${projectId}`)
        const saved = await publisher.save(projectId, message)
        this.publicationRevision = saved.commit_sha
        return saved
      } finally { await publisher.releaseLock(projectId).catch(() => {}) }
    })
  }

  private async writeAtomicSnapshot(branch: string, files: ProjectFiles, message: string, projectId: string, expectedRevision?: string): Promise<string> {
    const expectedHead = await this.headCommitSha(branch)
    const baseline = expectedRevision || (branch === this.draftBranch ? this.reviewedRevision : this.publicationRevision)
    if (!baseline) throw new GitEditorConflict('changed', 'Review the remote project before saving changes.')
    const lock = await this.owned(projectId, branch === this.draftBranch ? expectedHead : undefined)
    const changes = []
    for (const [path, content] of Object.entries(files)) {
      const [existing, reviewed] = await Promise.all([this.safeGet(path, expectedHead), this.safeGet(path, baseline)])
      if (fileContentEquals(existing?.content, content)) continue
      if (!fileContentEquals(existing?.content, reviewed?.content)) {
        this.blocked = true
        throw new GitEditorConflict('changed', 'Remote project files changed since review. Your local draft is preserved; reopen the remote project or save a separate working branch.')
      }
      if (!fileContentEquals(existing?.content, content)) changes.push({ path, content, sha: existing?.sha })
    }
    if (!changes.length) {
      this.assertContext()
      if (branch === this.draftBranch) this.reviewedRevision = expectedHead
      return expectedHead
    }
    // GitLab/Gitea use per-file CAS. Updating the owned lease in this SAME
    // transaction fences takeover even when a provider has no global HEAD CAS.
    if (branch === this.draftBranch) changes.push({ path: lockPath(this.projectPath), sha: lock.sha,
      content: JSON.stringify(this.nextLease(projectId)) })
    const freshLease = this.parseLock((await this.owned(projectId)).content)
    this.assertWritable(freshLease)
    try {
      const commit = await this.provider.commitFiles!({ owner: this.owner, repo: this.repo, branch, expectedHead, message, files: changes, assertCurrent: () => this.assertWritable(freshLease) })
      if (!commit.sha) throw new Error('The Git provider did not confirm the saved commit')
      if (branch === this.draftBranch) this.reviewedRevision = commit.sha
      else this.publicationRevision = commit.sha
      return commit.sha
    } catch (error) {
      this.blocked = true
      throw new GitEditorConflict('unavailable', `Git write could not be confirmed. Inspect the remote branch before recovery; the local draft is preserved. ${error instanceof Error ? error.message : ''}`)
    }
  }

  acquireLock(projectId: string, options?: { recoverExpired?: boolean }): Promise<LockInfo> {
    return this.serial(() => this.acquire(projectId, options?.recoverExpired === true))
  }

  private async acquire(projectId: string, recoverExpired = false): Promise<LockInfo> {
    this.requireAtomic(); this.assertContext()
    if (this.blocked && !recoverExpired) throw new GitEditorConflict('lost', 'Editor lock lost. Review recovery before writing this draft.')
    await this.ensureDraftBranch()
    const head = await this.headCommitSha(this.draftBranch)
    const existing = await this.safeGet(lockPath(this.projectPath), head)
    if (existing) {
      const info = this.parseLock(existing.content)
      const copied = this.createdBranch && info.target !== undefined && info.target !== this.target
      if (!copied && info.target !== undefined && info.target !== this.target) throw new GitEditorConflict('invalid', 'The editor lock is bound to a different target.')
      if (!copied && !info.released) {
        const expired = Date.now() >= Date.parse(info.heartbeat_at) + LEASE_MS
        if (!expired && recoverExpired) throw new GitEditorConflict('busy', 'This editor lock has not expired. Wait for expiry or reopen the remote project; do not replay an unconfirmed write.')
        if (expired && !recoverExpired) throw new GitEditorConflict('expired', 'The editor lock expired. Explicitly recover the expired lock, or reopen the remote project.')
        if (!expired && (info.lease_id !== this.leaseId || info.browser_instance_id !== this.browserInstanceId || info.editor_id !== projectId)) {
          throw new GitEditorConflict('busy', 'Another editor owns this working branch. Your local draft is preserved.')
        }
      }
    }
    this.leaseId = uuid()
    const info = this.nextLease(projectId)
    this.assertContext()
    try {
      await this.provider.commitFiles!({ owner: this.owner, repo: this.repo, branch: this.draftBranch, expectedHead: head,
        message: 'Acquire Range42 editor lock', assertCurrent: () => this.assertContext(), files: [{ path: lockPath(this.projectPath), content: JSON.stringify(info), sha: existing?.sha }] })
      this.assertContext()
      this.blocked = false; this.createdBranch = false
      return info
    } catch (error) { this.blocked = true; throw error }
  }

  heartbeat(projectId: string): Promise<void> {
    return this.serial(async () => {
      const lock = await this.owned(projectId)
      const lease = this.parseLock(lock.content)
      this.assertWritable(lease)
      try {
        await this.provider.putFile({ owner: this.owner, repo: this.repo, branch: this.draftBranch,
          path: lockPath(this.projectPath), content: JSON.stringify(this.nextLease(projectId)), sha: lock.sha, message: 'Renew Range42 editor lock', assertCurrent: () => this.assertWritable(lease) })
      } catch (error) { this.blocked = true; this.notifyLost(); throw error }
    })
  }

  releaseLock(projectId: string): Promise<void> {
    this.retired = true; this.blocked = true
    return this.serial(async () => {
      if (!this.leaseId) return
      // A stale owner never deletes or overwrites a successor's lease. Context
      // changes stop writes, including release; the old lease then expires.
      try {
        this.assertContext(true)
        const lock = await this.safeGet(lockPath(this.projectPath))
        if (!lock) return
        const info = this.parseLock(lock.content)
        if (info.target !== this.target || info.lease_id !== this.leaseId || info.editor_id !== projectId || info.browser_instance_id !== this.browserInstanceId) return
        this.assertContext(true)
        await this.provider.putFile({ owner: this.owner, repo: this.repo, branch: this.draftBranch,
          path: lockPath(this.projectPath), content: JSON.stringify({ ...this.nextLease(projectId), released: true }), sha: lock.sha, message: 'Release Range42 editor lock', assertCurrent: () => this.assertContext(true) })
      } finally { this.leaseId = null; this.blocked = true }
    })
  }

  onOrphanedDraft(cb: (draftId: string) => void): void { this.orphanCbs.push(cb) }

  async checkLockOwnership(projectId: string): Promise<'owner' | 'lost' | 'free'> {
    const lock = await this.safeGet(lockPath(this.projectPath))
    if (!lock) return this.leaseId ? 'lost' : 'free'
    const info = this.parseLock(lock.content)
    if (info.released && !this.leaseId) return 'free'
    if (!this.blocked && info.target === this.target && info.lease_id === this.leaseId && info.editor_id === projectId
      && info.browser_instance_id === this.browserInstanceId && !info.released && Date.now() < Date.parse(info.heartbeat_at) + LEASE_MS) return 'owner'
    this.blocked = true; this.notifyLost(); return 'lost'
  }

  private async owned(projectId: string, ref?: string) {
    this.assertContext()
    const lock = await this.safeGet(lockPath(this.projectPath), ref)
    const info = lock && this.parseLock(lock.content)
    if (this.blocked || !info || info.released || info.target !== this.target || !this.leaseId || info.lease_id !== this.leaseId
      || info.editor_id !== projectId || info.browser_instance_id !== this.browserInstanceId || Date.now() >= Date.parse(info.heartbeat_at) + LEASE_MS) {
      this.blocked = true; this.notifyLost()
      throw new GitEditorConflict('lost', 'Editor lock lost or expired. Your local draft is preserved; review recovery before saving.')
    }
    return lock!
  }

  private nextLease(projectId: string): LockInfo {
    return { editor_id: projectId, browser_instance_id: this.browserInstanceId, heartbeat_at: nowIso(),
      target: this.target, lease_id: this.leaseId!, revision: uuid(), released: false }
  }

  private parseLock(content: FileContent): LockInfo {
    let info: LockInfo
    try { info = JSON.parse(fileText(content)) } catch { throw new GitEditorConflict('invalid', 'Malformed editor lock. Inspect it in Git before recovery.') }
    if (!info || typeof info.editor_id !== 'string' || !info.editor_id || typeof info.browser_instance_id !== 'string' || !info.browser_instance_id
      || typeof info.heartbeat_at !== 'string' || !Number.isFinite(Date.parse(info.heartbeat_at)) || Date.parse(info.heartbeat_at) > Date.now() + 30_000
      || (info.target !== undefined && (typeof info.target !== 'string' || typeof info.lease_id !== 'string' || !info.lease_id))
      || (info.released !== undefined && typeof info.released !== 'boolean')) throw new GitEditorConflict('invalid', 'Invalid editor lock. Inspect it in Git before recovery.')
    return info
  }

  private assertWritable(info: LockInfo) {
    this.assertContext()
    if (this.blocked || Date.now() >= Date.parse(info.heartbeat_at) + LEASE_MS) throw new GitEditorConflict('lost', 'Editor lock lost or expired before publication. The local draft is preserved.')
  }

  private assertContext(releasing = false) {
    if (this.retired && !releasing) throw new GitEditorConflict('lost', 'The editor session is closed. Its pending writes were retired.')
    if (!this.contextValid()) { this.blocked = true; throw new GitEditorConflict('lost', 'Git connection changed. Reopen the project before saving; your local draft is preserved.') }
  }
  private requireAtomic() { if (!this.provider.commitFiles) throw new Error('Atomic Git commits are required for safe editor locking') }
  private notifyLost() { for (const cb of this.orphanCbs) { try { cb(this.draftBranch) } catch { /* observers cannot authorize writes */ } } }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.catch(() => {})
    return result
  }

  private authoredFilePath(path: string): string {
    validateAuthoredFilePath(path)
    const prefix = this.projectPath.replace(/\/+$/, '')
    return prefix ? `${prefix}/${path}` : path
  }

  private async ensureDraftBranch(): Promise<void> {
    if (this.branchReady) return
    this.assertContext()
    this.publicationRevision = this.opts.expectedPublicationRevision || await this.headCommitSha(this.mainBranch)
    const seed = await this.headCommitSha(this.branchFrom)
    this.reviewedRevision ||= seed
    if (this.publicationOnly) { this.branchReady = true; return }
    this.assertContext()
    try {
      await this.provider.createBranch({
        owner: this.owner,
        repo: this.repo,
        from: seed,
        name: this.draftBranch,
      })
      this.createdBranch = true
    } catch (err) {
      // Branch already exists — swallow.
      if (!isBranchAlreadyExistsError(err)) throw err
    }
    this.branchReady = true
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

export function createProjectRepoAdapter(opts: AdapterConstructorOpts): ProjectRepoAdapter {
  return new RepoAdapter(opts)
}
