import type { PullRequestRef, PullRequestReview, MergePullRequestOptions, UpdateBranchResult } from './types'
import { assertMergeable, assertReviewHead } from './review'
/**
 * GitHub Provider (v1 interface)
 *
 * Implements GitProviderV1 against the GitHub REST API. GitHub's REST surface
 * mirrors Gitea's closely, so this adapter parallels `gitea.ts`; the GitHub
 * specifics it accounts for are:
 *   - base URL: github.com → https://api.github.com; GitHub Enterprise Server
 *     → `<base>/api/v3`.
 *   - auth: `Authorization: Bearer <pat>` with `Accept: application/vnd.github+json`.
 *   - branch creation has no single endpoint: resolve the source ref's commit
 *     SHA, then POST a new `refs/heads/<name>` ref pointing at it.
 *
 * This is the v1 counterpart to the legacy `GitHubProvider` in `github.ts`
 * (which implements the older `GitProvider` interface used by inventoryStore).
 *
 * Docs: https://docs.github.com/en/rest
 */

import type { GitProviderV1, RepoRef, CommitRef, CommitFilesOptions } from './types'
import { decodeGitFileContent, fileBase64, fileText, validateFileMap, type FileContent } from '@/services/projectFiles'
import { ensurePersonalFork, type ForkRepository } from './personalFork'

export interface GitHubV1ProviderOpts {
  baseUrl?: string        // e.g. https://github.com or https://ghe.corp.example
  token?: string | null
  fetchImpl?: typeof fetch
}

/**
 * Resolve the REST API base for a configured source `base_url`.
 * - empty / github.com / api.github.com → https://api.github.com
 * - anything else (GitHub Enterprise Server) → `<host>/api/v3`
 */
function resolveApiBase(baseUrl?: string): string {
  if (!baseUrl) return 'https://api.github.com'
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/^https?:\/\/(www\.)?github\.com$/i.test(trimmed)) return 'https://api.github.com'
  if (/api\.github\.com$/i.test(trimmed)) return trimmed
  return `${trimmed}/api/v3`
}

export class GitHubV1Provider implements GitProviderV1 {
  readonly id = 'github' as const
  private apiBase: string
  private token: string | null
  private fetchImpl: typeof fetch

  constructor(opts: GitHubV1ProviderOpts = {}) {
    this.apiBase = resolveApiBase(opts.baseUrl)
    this.token = opts.token ?? null
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  setToken(token: string | null): void {
    this.token = token
  }

  private url(path: string): string {
    return `${this.apiBase}${path}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      ...extra,
    }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw Object.assign(new Error(`GitHub ${init?.method ?? 'GET'} ${url} -> ${res.status} ${body}`), { status: res.status })
    }
    return (await res.json()) as T
  }

  // ---------------------------------------------------------------------------
  // GitProviderV1 surface
  // ---------------------------------------------------------------------------

  async listRepos(opts: { owner?: string }): Promise<RepoRef[]> {
    const url = opts.owner
      ? this.url(`/users/${encodeURIComponent(opts.owner)}/repos?per_page=50`)
      : this.url('/user/repos?per_page=50')
    const items = await this.json<
      Array<{ owner: { login: string }; name: string; default_branch: string }>
    >(url, { headers: this.headers() })
    return items.map((r) => ({
      owner: r.owner.login,
      repo: r.name,
      default_branch: r.default_branch ?? 'main',
    }))
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
    const ref = opts.ref ?? 'main'
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/contents/${opts.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    )
    let body = await this.json<{ content: string; sha: string; encoding: string; size?: number }>(
      url,
      { headers: this.headers() },
    )
    if (body.encoding === 'none' && body.sha) {
      body = await this.json<{ content: string; sha: string; encoding: string; size?: number }>(this.url(
        `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git/blobs/${encodeURIComponent(body.sha)}`,
      ), { headers: this.headers() })
    }
    const content = decodeGitFileContent(body)
    return { content, sha: body.sha }
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
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/contents/${opts.path.split('/').map(encodeURIComponent).join('/')}`,
    )
    const payload: Record<string, unknown> = {
      content: fileBase64(opts.content),
      message: opts.message,
    }
    if (opts.branch) payload.branch = opts.branch
    if (opts.sha) payload.sha = opts.sha
    // GitHub uses PUT for both create and update on the contents API.
    const body = await this.json<{ content: { sha: string }; commit?: { sha: string } }>(url, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    return { sha: body.content.sha }
  }

  async commitFiles(opts: CommitFilesOptions): Promise<{ sha: string }> {
    if (!opts.files.length) return { sha: opts.expectedHead }
    validateFileMap(Object.fromEntries(opts.files.map(file => [file.path, file.content])))
    const root = `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git`
    const base = await this.json<{ tree: { sha: string } }>(this.url(`${root}/commits/${opts.expectedHead}`), { headers: this.headers() })
    const existing = await this.json<{ tree: Array<{ path: string; mode: string }>; truncated?: boolean }>(
      this.url(`${root}/trees/${base.tree.sha}?recursive=true`), { headers: this.headers() },
    )
    if (existing.truncated) throw new Error('Repository tree is too large to preserve file modes safely')
    const modes = new Map(existing.tree.map(file => [file.path, file.mode]))
    const entries = []
    for (const file of opts.files) {
      const entry = { path: file.path, mode: modes.get(file.path) || '100644', type: 'blob' }
      if (typeof file.content === 'string') entries.push({ ...entry, content: file.content })
      else {
        const blob = await this.json<{ sha: string }>(this.url(`${root}/blobs`), {
          method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content: fileBase64(file.content), encoding: 'base64' }),
        })
        entries.push({ ...entry, sha: blob.sha })
      }
    }
    const tree = await this.json<{ sha: string }>(this.url(`${root}/trees`), {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ base_tree: base.tree.sha, tree: entries }),
    })
    const commit = await this.json<{ sha: string }>(this.url(`${root}/commits`), {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: opts.message, tree: tree.sha, parents: [opts.expectedHead] }),
    })
    await this.json(this.url(`${root}/refs/heads/${encodeURIComponent(opts.branch)}`), {
      method: 'PATCH', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    return { sha: commit.sha }
  }

  async createBranch(opts: {
    owner: string
    repo: string
    from: string
    name: string
  }): Promise<void> {
    // GitHub has no single create-branch endpoint: resolve the source ref's
    // commit SHA, then create a new ref pointing at it.
    const ref = /^[a-f0-9]{40,64}$/i.test(opts.from) ? { object: { sha: opts.from } } : await this.json<{ object: { sha: string } }>(
      this.url(
        `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git/ref/heads/${encodeURIComponent(opts.from)}`,
      ),
      { headers: this.headers() },
    )
    const res = await this.fetchImpl(
      this.url(
        `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git/refs`,
      ),
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ref: `refs/heads/${opts.name}`, sha: ref.object.sha }),
      },
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub POST git/refs -> ${res.status} ${body}`)
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
    const res = await this.fetchImpl(
      this.url(
        `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls`,
      ),
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          head: opts.source ? `${opts.source.owner}:${opts.from}` : opts.from,
          base: opts.to,
          title: opts.title,
          body: opts.body,
        }),
      },
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 409 || res.status === 422) {
        const source = opts.source ?? opts
        for (let page = 1; ; page++) {
          const query = new URLSearchParams({ state: 'open', per_page: '50', limit: '50', page: String(page),
            head: `${source.owner}:${opts.from}`, base: opts.to })
          const reviews = await this.json<Array<{
            number: number; html_url: string; state: string;
            head: { ref: string; repo?: { name: string; owner?: { login: string } } };
            base: { ref: string };
          }>>(this.url(`/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls?${query}`), { headers: this.headers() })
          const existing = reviews.find(review => review.state === 'open'
            && review.head?.ref === opts.from && review.base?.ref === opts.to
            && review.head.repo?.name === source.repo && review.head.repo.owner?.login === source.owner)
          if (existing) return { url: existing.html_url, number: existing.number }
          if (reviews.length < 50) break
        }
      }
      throw new Error(`GitHub POST pulls -> ${res.status} ${body}`)
    }
    const pr = (await res.json()) as { html_url: string; number: number }
    return { url: pr.html_url, number: pr.number }
  }

  async getPullRequest(opts: PullRequestRef): Promise<PullRequestReview> {
    const pr = await this.json<{
      number: number; html_url: string; state: string; head: { sha: string };
      merged?: boolean; draft?: boolean; mergeable?: boolean; mergeable_state?: string;
    }>(this.url(`/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls/${opts.number}`), { headers: this.headers() })
    return {
      number: pr.number, url: pr.html_url, head_sha: pr.head?.sha,
      state: pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
      can_merge: await this.canWrite(opts.owner, opts.repo),
      mergeable: !pr.draft && pr.mergeable === true && pr.mergeable_state === 'clean',
    }
  }

  async updatePullRequestBranch(opts: PullRequestRef & { expectedHead: string }): Promise<UpdateBranchResult> {
    assertReviewHead(await this.getPullRequest(opts), opts.expectedHead)
    const response = await this.fetchImpl(this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls/${opts.number}/update-branch`,
    ), {
      method: 'PUT', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expected_head_sha: opts.expectedHead }),
    })
    if (!response.ok) throw new Error(`GitHub contribution update -> ${response.status} ${await response.text()}`)
    return { status: 'queued' }
  }

  async mergePullRequest(opts: MergePullRequestOptions): Promise<{ merged: boolean; sha?: string }> {
    assertMergeable(await this.getPullRequest(opts), opts.expectedHead)
    const url = this.url(`/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls/${opts.number}/merge`)
    const result = await this.json<{ merged: boolean; sha?: string; message?: string }>(url, {
      method: 'PUT', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha: opts.expectedHead, merge_method: opts.method || 'merge' }),
    })
    if (!result.merged) throw new Error(result.message || 'GitHub did not confirm that the pull request was merged.')
    return { merged: true, sha: result.sha }
  }

  async listTree(opts: {
    owner: string
    repo: string
    ref?: string
    path?: string
  }): Promise<Array<{ path: string; type: 'blob' | 'tree'; sha: string; mode?: string }>> {
    const ref = opts.ref ?? 'main'
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=true`,
    )
    const body = await this.json<{
      tree: Array<{ path: string; type: string; sha: string; mode?: string }>; truncated?: boolean
    }>(url, { headers: this.headers() })
    if (body.truncated) throw new Error('Repository tree is truncated; narrow the repository before importing its files')
    let items = body.tree
    if (opts.path) {
      const prefix = opts.path.endsWith('/') ? opts.path : `${opts.path}/`
      items = items.filter((it) => it.path === opts.path || it.path.startsWith(prefix))
    }
    return items.map((it) => ({
      path: it.path,
      type: it.type === 'tree' ? 'tree' : 'blob',
      sha: it.sha,
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
    const params = new URLSearchParams()
    if (opts.ref) params.set('sha', opts.ref)
    if (opts.path) params.set('path', opts.path)
    params.set('per_page', String(opts.perPage ?? 50))
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(
        opts.repo,
      )}/commits?${params.toString()}`,
    )
    const items = await this.json<
      Array<{
        sha: string
        commit: { message: string; author: { name: string; date: string } }
      }>
    >(url, { headers: this.headers() })
    return items.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
    }))
  }

  async ensureFork(opts: { owner: string; repo: string; destination?: string }): Promise<RepoRef> {
    if (!this.token) throw new Error('Authentication is required to create a personal fork')
    const map = (data: { id: number; name: string; owner: { login: string }; default_branch?: string;
      parent?: { id: number }; permissions?: { push?: boolean; admin?: boolean } }): ForkRepository => ({
      id: data.id, owner: data.owner.login, repo: data.name, default_branch: data.default_branch || 'main',
      parentId: data.parent?.id, writable: Boolean(data.permissions?.push || data.permissions?.admin),
    })
    return ensurePersonalFork({ upstream: opts, destination: opts.destination,
      currentUser: async () => (await this.json<{ login: string }>(this.url('/user'), { headers: this.headers() })).login,
      getRepository: async (owner, repo) => map(await this.json(this.url(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`), { headers: this.headers() })),
      create: async () => map(await this.json(this.url(`/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/forks`), {
        method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ default_branch_only: false, ...(opts.destination ? { organization: opts.destination } : {}) }),
      })),
    })
  }

  async canWrite(owner: string, repo: string): Promise<boolean> {
    if (!this.token) {
      return false
    }
    try {
      const data = await this.json<{
        permissions?: { admin?: boolean; push?: boolean }
      }>(
        this.url(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
        { headers: this.headers() },
      )
      return !!(data.permissions?.push || data.permissions?.admin)
    } catch {
      return false
    }
  }

  async health(): Promise<{ ok: boolean; rtt_ms: number }> {
    const started = Date.now()
    try {
      const res = await this.fetchImpl(this.url('/rate_limit'), { headers: this.headers() })
      return { ok: res.ok, rtt_ms: Date.now() - started }
    } catch {
      return { ok: false, rtt_ms: Date.now() - started }
    }
  }
}

export function getGitHubV1Provider(opts: GitHubV1ProviderOpts = {}): GitHubV1Provider {
  return new GitHubV1Provider(opts)
}
