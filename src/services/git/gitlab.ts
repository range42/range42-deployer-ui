import type { PullRequestRef, PullRequestReview, MergePullRequestOptions, UpdateBranchResult } from './types'
import { assertMergeable, assertReviewHead } from './review'
/**
 * GitLab Provider (v1 interface)
 *
 * Implements GitProviderV1 against GitLab REST API v4.
 * Authentication via PRIVATE-TOKEN header (personal access token).
 *
 * Docs: https://docs.gitlab.com/ee/api/
 */

import type { GitProviderV1, RepoRef, CommitRef, CommitFilesOptions } from './types'
import { decodeGitFileContent, fileBase64, fileText, validateFileMap, type FileContent } from '@/services/projectFiles'
import { ensurePersonalFork, type ForkRepository } from './personalFork'

export interface GitLabProviderOpts {
  baseUrl?: string       // e.g. https://gitlab.com
  token?: string | null
  fetchImpl?: typeof fetch
}

export class GitLabProvider implements GitProviderV1 {
  readonly id = 'gitlab' as const
  private baseUrl: string
  private token: string | null
  private fetchImpl: typeof fetch

  constructor(opts: GitLabProviderOpts = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')
    this.token = opts.token ?? null
    // Capture fetch at construction; allow injection for tests.
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  setToken(token: string | null): void {
    this.token = token
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private projectId(owner: string, repo: string): string {
    // GitLab uses URL-encoded "namespace/project" as project identifier.
    return encodeURIComponent(`${owner}/${repo}`)
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/v4${path}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      ...extra,
    }
    if (this.token) h['PRIVATE-TOKEN'] = this.token
    return h
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw Object.assign(new Error(`GitLab ${init?.method ?? 'GET'} ${url} -> ${res.status} ${body}`), { status: res.status })
    }
    return (await res.json()) as T
  }

  // ---------------------------------------------------------------------------
  // GitProviderV1 surface
  // ---------------------------------------------------------------------------

  async listRepos(opts: { owner?: string }): Promise<RepoRef[]> {
    // If an owner is provided, list projects in that namespace (group or user).
    const url = opts.owner
      ? this.url(`/groups/${encodeURIComponent(opts.owner)}/projects?per_page=100&include_subgroups=true`)
      : this.url('/projects?membership=true&per_page=100')
    const projects = await this.json<
      Array<{ path: string; path_with_namespace: string; default_branch: string | null }>
    >(url, { headers: this.headers() })
    return projects.map((p) => {
      const [owner, ...rest] = p.path_with_namespace.split('/')
      return {
        owner,
        repo: rest.join('/') || p.path,
        default_branch: p.default_branch ?? 'main',
      }
    })
  }

  async getFile(opts: { owner: string; repo: string; path: string; ref?: string }): Promise<{ content: string; sha: string }> {
    const file = await this.getFileContent(opts)
    return { ...file, content: fileText(file.content) }
  }

  async getFileContent(opts: {
    owner: string
    repo: string
    path: string
    ref?: string
  }): Promise<{ content: FileContent; sha: string }> {
    const pid = this.projectId(opts.owner, opts.repo)
    const ref = opts.ref ?? 'main'
    const fileUrl = this.url(
      `/projects/${pid}/repository/files/${encodeURIComponent(opts.path)}?ref=${encodeURIComponent(ref)}`,
    )
    const body = await this.json<{ content: string; blob_id: string; encoding: string }>(
      fileUrl,
      { headers: this.headers() },
    )
    const content = decodeGitFileContent(body)
    return { content, sha: body.blob_id }
  }

  async putFile(opts: {
    owner: string
    repo: string
    path: string
    content: FileContent
    sha?: string
    message: string
    branch?: string
  }): Promise<{ sha: string }> {
    const pid = this.projectId(opts.owner, opts.repo)
    const fileUrl = this.url(
      `/projects/${pid}/repository/files/${encodeURIComponent(opts.path)}`,
    )
    const branch = opts.branch ?? 'main'
    let lastCommitId: string | undefined
    if (opts.sha) {
      // The shared provider contract uses blob SHAs, while GitLab's update
      // guard requires the last commit that modified this file. Fetch both
      // together so this remains correct across separate provider instances.
      const current = await this.json<{ blob_id: string; last_commit_id?: string }>(
        `${fileUrl}?ref=${encodeURIComponent(branch)}`,
        { headers: this.headers() },
      )
      if (current.blob_id !== opts.sha) {
        throw new Error(`GitLab file changed before update: ${opts.path}. Refresh before retrying.`)
      }
      if (typeof current.last_commit_id !== 'string' || !current.last_commit_id) {
        throw new Error(`GitLab file metadata is missing last_commit_id: ${opts.path}. Cannot safely update this file.`)
      }
      lastCommitId = current.last_commit_id
    }
    const payload = {
      branch,
      content: fileBase64(opts.content),
      encoding: 'base64',
      commit_message: opts.message,
      last_commit_id: lastCommitId,
    }
    // GitLab uses PUT to update and POST to create. Never retry an update as
    // creation: a failed concurrency or permission check must stay visible.
    const method = opts.sha ? 'PUT' : 'POST'
    const res = await this.fetchImpl(fileUrl, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitLab ${method} ${fileUrl} -> ${res.status} ${body}`)
    }
    // GitLab returns { file_path, branch }; no blob SHA in the response. We
    // perform a follow-up GET to retrieve the new blob_id for caller tracking.
    const fresh = await this.getFileContent({
      owner: opts.owner,
      repo: opts.repo,
      path: opts.path,
      ref: branch,
    })
    return { sha: fresh.sha }
  }

  async commitFiles(opts: CommitFilesOptions): Promise<{ sha: string }> {
    if (!opts.files.length) return { sha: opts.expectedHead }
    validateFileMap(Object.fromEntries(opts.files.map(file => [file.path, file.content])))
    const pid = this.projectId(opts.owner, opts.repo)
    const actions = []
    for (const file of opts.files) {
      let lastCommitId: string | undefined
      if (file.sha) {
        const current = await this.json<{ blob_id: string; last_commit_id?: string }>(this.url(
          `/projects/${pid}/repository/files/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(opts.expectedHead)}`,
        ), { headers: this.headers() })
        if (current.blob_id !== file.sha || !current.last_commit_id) throw new Error(`GitLab file changed or lacks commit metadata: ${file.path}`)
        lastCommitId = current.last_commit_id
      }
      actions.push({ action: file.sha ? 'update' : 'create', file_path: file.path,
        content: fileBase64(file.content), encoding: 'base64', last_commit_id: lastCommitId })
    }
    const commit = await this.json<{ id: string }>(this.url(`/projects/${pid}/repository/commits`), {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ branch: opts.branch, commit_message: opts.message, actions }),
    })
    return { sha: commit.id }
  }

  async createBranch(opts: {
    owner: string
    repo: string
    from: string
    name: string
  }): Promise<void> {
    const pid = this.projectId(opts.owner, opts.repo)
    const url = this.url(`/projects/${pid}/repository/branches`)
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ branch: opts.name, ref: opts.from }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitLab POST ${url} -> ${res.status} ${body}`)
    }
  }

  async createPullRequest(opts: {
    owner: string
    repo: string
    from: string
    to: string
    title: string
    body?: string
    source?: { owner: string; repo: string }
  }): Promise<{ url: string; number: number }> {
    // GitLab calls pull requests "merge requests".
    const targetId = opts.source ? (await this.json<{ id: number }>(
      this.url(`/projects/${this.projectId(opts.owner, opts.repo)}`), { headers: this.headers() },
    )).id : undefined
    const pid = this.projectId(opts.source?.owner ?? opts.owner, opts.source?.repo ?? opts.repo)
    const url = this.url(`/projects/${pid}/merge_requests`)
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        source_branch: opts.from,
        target_project_id: targetId,
        target_branch: opts.to,
        title: opts.title,
        description: opts.body,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 409 || res.status === 422) {
        const source = await this.json<{ id: number }>(this.url(`/projects/${pid}`), { headers: this.headers() })
        for (let page = 1; ; page++) {
          const query = new URLSearchParams({ state: 'opened', source_branch: opts.from,
            target_branch: opts.to, per_page: '50', page: String(page) })
          const reviews = await this.json<Array<{
            iid: number; web_url: string; state: string; source_project_id: number;
            source_branch: string; target_branch: string;
          }>>(this.url(`/projects/${this.projectId(opts.owner, opts.repo)}/merge_requests?${query}`), { headers: this.headers() })
          const existing = reviews.find(review => review.state === 'opened'
            && review.source_project_id === source.id && review.source_branch === opts.from && review.target_branch === opts.to)
          if (existing) return { url: existing.web_url, number: existing.iid }
          if (reviews.length < 50) break
        }
      }
      throw new Error(`GitLab POST ${url} -> ${res.status} ${body}`)
    }
    const mr = (await res.json()) as { web_url: string; iid: number }
    return { url: mr.web_url, number: mr.iid }
  }

  async getPullRequest(opts: PullRequestRef): Promise<PullRequestReview> {
    const mr = await this.json<{
      iid: number; web_url: string; state: string; sha: string; draft?: boolean;
      source_project_id?: number; source_branch?: string; target_branch?: string;
      user?: { can_merge?: boolean }; detailed_merge_status?: string; merge_status?: string;
    }>(this.url(`/projects/${this.projectId(opts.owner, opts.repo)}/merge_requests/${opts.number}`), { headers: this.headers() })
    const source = mr.source_project_id ? await this.json<{ path: string; namespace: { full_path: string } }>(
      this.url(`/projects/${mr.source_project_id}`), { headers: this.headers() },
    ) : undefined
    return {
      ...(source && mr.source_branch ? { source: { owner: source.namespace.full_path, repo: source.path, branch: mr.source_branch } } : {}),
      target_branch: mr.target_branch,
      number: mr.iid, url: mr.web_url, head_sha: mr.sha,
      state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
      can_merge: mr.user?.can_merge === true,
      mergeable: !mr.draft && (mr.detailed_merge_status === 'mergeable'
        || (!mr.detailed_merge_status && mr.merge_status === 'can_be_merged')),
    }
  }

  async updatePullRequestBranch(opts: PullRequestRef & { expectedHead: string }): Promise<UpdateBranchResult> {
    const review = await this.getPullRequest(opts)
    assertReviewHead(review, opts.expectedHead)
    const source = review.source
    if (!source || !review.target_branch) throw new Error('GitLab did not return the contribution branch identity.')
    if (!await this.canWrite(source.owner, source.repo)) throw new Error('Write permission is required for the contribution repository.')
    // A new upstream commit may not exist in the fork's object database yet.
    // Let GitLab review the upstream branch directly into the writable fork;
    // no imported refs, empty commits, resets or upstream branches are needed.
    const proposal = await this.createPullRequest({ owner: source.owner, repo: source.repo,
      from: review.target_branch, to: source.branch, source: { owner: opts.owner, repo: opts.repo },
      title: `Update contribution from ${opts.owner}/${opts.repo}:${review.target_branch}`,
      body: 'Review upstream changes and resolve any conflicts before merging this synchronization request.',
    })
    return { status: 'review_required', review_url: proposal.url }
  }

  async mergePullRequest(opts: MergePullRequestOptions): Promise<{ merged: boolean; sha?: string }> {
    assertMergeable(await this.getPullRequest(opts), opts.expectedHead)
    const result = await this.json<{ state: string; merge_commit_sha?: string; squash_commit_sha?: string }>(
      this.url(`/projects/${this.projectId(opts.owner, opts.repo)}/merge_requests/${opts.number}/merge`), {
        method: 'PUT', headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sha: opts.expectedHead, squash: opts.method === 'squash', should_remove_source_branch: false }),
      },
    )
    if (result.state !== 'merged') throw new Error('GitLab did not confirm that the merge request was merged.')
    return { merged: true, sha: result.merge_commit_sha || result.squash_commit_sha }
  }

  async listTree(opts: {
    owner: string
    repo: string
    ref?: string
    path?: string
  }): Promise<Array<{ path: string; type: 'blob' | 'tree'; sha: string; mode?: string }>> {
    const pid = this.projectId(opts.owner, opts.repo)
    const params = new URLSearchParams()
    if (opts.ref) params.set('ref', opts.ref)
    if (opts.path) params.set('path', opts.path)
    params.set('recursive', 'true')
    params.set('per_page', '100')
    const items: Array<{ path: string; type: string; id: string; mode?: string }> = []
    const seen = new Set<string>()
    for (let page = 1; ; page += 1) {
      if (page > 100) throw new Error('Repository tree exceeds the 10,000-entry import limit')
      params.set('page', String(page))
      const rows = await this.json<typeof items>(this.url(`/projects/${pid}/repository/tree?${params.toString()}`), { headers: this.headers() })
      for (const row of rows) {
        if (seen.has(row.path)) throw new Error('Repository tree pagination repeated a path; retry the pinned revision')
        seen.add(row.path)
        items.push(row)
      }
      if (rows.length < 100) break
    }
    return items.map((it) => ({
      path: it.path,
      type: it.type === 'tree' ? 'tree' : 'blob',
      sha: it.id,
      ...(it.mode ? { mode: it.mode } : {}),
    }))
  }

  async listCommits(opts: {
    owner: string
    repo: string
    path?: string
    ref?: string
    perPage?: number
  }): Promise<CommitRef[]> {
    const pid = this.projectId(opts.owner, opts.repo)
    const params = new URLSearchParams()
    if (opts.ref) params.set('ref_name', opts.ref)
    if (opts.path) params.set('path', opts.path)
    params.set('per_page', String(opts.perPage ?? 50))
    const url = this.url(`/projects/${pid}/repository/commits?${params.toString()}`)
    const items = await this.json<
      Array<{
        id: string
        message: string
        author_name: string
        authored_date: string
      }>
    >(url, { headers: this.headers() })
    return items.map((c) => ({
      sha: c.id,
      message: c.message,
      author: c.author_name,
      date: c.authored_date,
    }))
  }

  async ensureFork(opts: { owner: string; repo: string; destination?: string }): Promise<RepoRef> {
    if (!this.token) throw new Error('Authentication is required to create a personal fork')
    const map = (data: { id: number; path: string; namespace: { full_path: string }; default_branch?: string;
      forked_from_project?: { id: number }; import_status?: string;
      permissions?: { project_access?: { access_level: number }; group_access?: { access_level: number } } }): ForkRepository => ({
      id: data.id, owner: data.namespace.full_path, repo: data.path, default_branch: data.default_branch || 'main',
      parentId: data.forked_from_project?.id, importStatus: data.import_status,
      writable: Math.max(data.permissions?.project_access?.access_level || 0, data.permissions?.group_access?.access_level || 0) >= 30,
    })
    return ensurePersonalFork({ upstream: opts, destination: opts.destination,
      currentUser: async () => (await this.json<{ username: string }>(this.url('/user'), { headers: this.headers() })).username,
      getRepository: async (owner, repo) => map(await this.json(this.url(`/projects/${this.projectId(owner, repo)}`), { headers: this.headers() })),
      create: async () => map(await this.json(this.url(`/projects/${this.projectId(opts.owner, opts.repo)}/fork`), {
        method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(opts.destination ? { namespace_path: opts.destination } : {}),
      })),
    })
  }

  async canWrite(owner: string, repo: string): Promise<boolean> {
    if (!this.token) {
      return false
    }
    try {
      const pid = this.projectId(owner, repo)
      // GitLab returns the caller's effective access via `permissions`, with
      // `project_access` and/or `group_access` each carrying an `access_level`.
      // Developer (30) is the minimum level that can push to a repository.
      const data = await this.json<{
        permissions?: {
          project_access?: { access_level?: number } | null
          group_access?: { access_level?: number } | null
        }
      }>(this.url(`/projects/${pid}`), { headers: this.headers() })
      const projectLevel = data.permissions?.project_access?.access_level ?? 0
      const groupLevel = data.permissions?.group_access?.access_level ?? 0
      return Math.max(projectLevel, groupLevel) >= 30
    } catch {
      return false
    }
  }

  async health(): Promise<{ ok: boolean; rtt_ms: number }> {
    const started = Date.now()
    try {
      const res = await this.fetchImpl(this.url('/version'), { headers: this.headers() })
      return { ok: res.ok, rtt_ms: Date.now() - started }
    } catch {
      return { ok: false, rtt_ms: Date.now() - started }
    }
  }
}

export function getGitLabProvider(opts: GitLabProviderOpts = {}): GitLabProvider {
  return new GitLabProvider(opts)
}
