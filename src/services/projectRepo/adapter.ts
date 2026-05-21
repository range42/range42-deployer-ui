/**
 * ProjectRepoAdapter implementation (C1.10).
 *
 * Core responsibilities:
 *  - load: fetch project state (overlay + canvas_layout + meta) from git.
 *  - autosave: write the current state to a per-browser `draft-<uuid>` branch
 *    and mirror the write to IndexedDB `pending_commits` (for recovery on
 *    connectivity loss).
 *  - save: fast-forward merge onto `main`; if the push can't fast-forward,
 *    open a PR from the draft branch to `main` and surface the URL.
 *  - acquireLock / heartbeat / checkLockOwnership: .lock file coordination
 *    against `main` so concurrent browser sessions can detect collisions.
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
  // crypto.randomUUID is available in all target browsers and in Node 19+.
  return crypto.randomUUID()
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
  return `${projectPath.replace(/\/+$/, '')}/overlay.json`
}

function layoutPath(projectPath: string): string {
  return `${projectPath.replace(/\/+$/, '')}/canvas_layout.json`
}

function metaPath(projectPath: string): string {
  return `${projectPath.replace(/\/+$/, '')}/meta.json`
}

function lockPath(projectPath: string): string {
  return `${projectPath.replace(/\/+$/, '')}/.lock`
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
  private projectPath: string
  private browserInstanceId: string
  private orphanCbs: Array<(draftId: string) => void> = []
  private shaCache = new Map<string, string>()
  private heartbeatStarted = false

  constructor(opts: AdapterConstructorOpts) {
    this.provider = opts.provider
    const firstRepo = opts.source.repos?.[0]
    if (!firstRepo) {
      throw new Error('ProjectRepoAdapter: source.repos is empty')
    }
    this.owner = firstRepo.owner
    this.repo = firstRepo.repo
    this.mainBranch = firstRepo.branch || defaultBranchFor(opts)
    this.projectPath = opts.projectPath
    this.browserInstanceId = opts.browserInstanceId ?? uuid()
    this.draftBranch = draftBranchFor(this.browserInstanceId)
  }

  // ---------------------------------------------------------------------------
  // load / autosave / save
  // ---------------------------------------------------------------------------

  async load(_projectId: string): Promise<ProjectState> {
    const [overlay, layout, meta, topology] = await Promise.all([
      this.safeGet(overlayPath(this.projectPath)),
      this.safeGet(layoutPath(this.projectPath)),
      this.safeGet(metaPath(this.projectPath)),
      this.safeGet(topologyPath(this.projectPath)),
    ])
    return {
      overlay: overlay?.content ?? '',
      canvas_layout: layout?.content ?? '',
      meta: meta ? safeParseJson(meta.content) : {},
      topology: topology?.content ?? '',
    }
  }

  async autosave(projectId: string, state: ProjectState): Promise<void> {
    // Ensure the draft branch exists before first write. Errors on "already
    // exists" (422/400 shapes vary by provider) are tolerated — we only care
    // that the branch is present.
    await this.ensureDraftBranch()

    const writes: Array<{ path: string; content: string }> = [
      { path: overlayPath(this.projectPath), content: state.overlay },
      { path: layoutPath(this.projectPath), content: state.canvas_layout },
      { path: metaPath(this.projectPath), content: JSON.stringify(state.meta, null, 2) },
      { path: topologyPath(this.projectPath), content: state.topology ?? '' },
    ]
    for (const w of writes) {
      const sha = this.shaCache.get(`${this.draftBranch}:${w.path}`)
      const res = await this.provider.putFile({
        owner: this.owner,
        repo: this.repo,
        path: w.path,
        content: w.content,
        sha,
        message: `autosave: ${projectId}`,
        branch: this.draftBranch,
      })
      this.shaCache.set(`${this.draftBranch}:${w.path}`, res.sha)
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
        state,
        updatedAt: Date.now(),
      })
    } catch {
      // IDB is best-effort; network path is authoritative.
    }
  }

  async save(projectId: string, message: string): Promise<{ pr_url?: string }> {
    // Try fast-forward: rewrite the main-branch files from the latest draft
    // files. We resolve each file by GETting the draft and PUTting onto main.
    try {
      await this.copyDraftIntoMain(projectId, message)
      return {}
    } catch (err) {
      // If the fast-forward PUT fails, fall back to opening a PR.
      if (isConflictError(err)) {
        const pr = await this.provider.createPullRequest({
          owner: this.owner,
          repo: this.repo,
          from: this.draftBranch,
          to: this.mainBranch,
          title: message || `Save ${projectId}`,
          body: 'Autogenerated by Range42 Deployer UI.',
        })
        return { pr_url: pr.url }
      }
      throw err
    }
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
    const info = safeParseJson<LockInfo>(existing.content)
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

  private async ensureDraftBranch(): Promise<void> {
    try {
      await this.provider.createBranch({
        owner: this.owner,
        repo: this.repo,
        from: this.mainBranch,
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
  ): Promise<{ content: string; sha: string } | null> {
    try {
      return await this.provider.getFile({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: ref ?? this.mainBranch,
      })
    } catch {
      return null
    }
  }

  private async writeLock(info: LockInfo): Promise<void> {
    const path = lockPath(this.projectPath)
    const existing = await this.safeGet(path)
    await this.provider.putFile({
      owner: this.owner,
      repo: this.repo,
      path,
      content: JSON.stringify(info, null, 2),
      sha: existing?.sha,
      message: `lock heartbeat: ${info.editor_id}`,
      branch: this.mainBranch,
    })
  }

  private async copyDraftIntoMain(projectId: string, message: string): Promise<void> {
    const paths = [
      overlayPath(this.projectPath),
      layoutPath(this.projectPath),
      metaPath(this.projectPath),
      topologyPath(this.projectPath),
    ]
    for (const p of paths) {
      const draftFile = await this.provider.getFile({
        owner: this.owner,
        repo: this.repo,
        path: p,
        ref: this.draftBranch,
      })
      const mainFile = await this.safeGet(p)
      await this.provider.putFile({
        owner: this.owner,
        repo: this.repo,
        path: p,
        content: draftFile.content,
        sha: mainFile?.sha,
        message: `${message} (${projectId})`,
        branch: this.mainBranch,
      })
    }
  }
}

function isConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /409|conflict|fast-forward|sha.*mismatch/i.test(msg)
}

function isBranchAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /already exists|422|branch.*exists/i.test(msg)
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
