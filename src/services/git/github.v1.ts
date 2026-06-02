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

import type { GitProviderV1, RepoRef, CommitRef } from './types'
import { encodeContentBase64, decodeContentBase64 } from './encoding'

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
      throw new Error(`GitHub ${init?.method ?? 'GET'} ${url} -> ${res.status} ${body}`)
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

  async getFile(opts: {
    owner: string
    repo: string
    path: string
    ref?: string
  }): Promise<{ content: string; sha: string }> {
    const ref = opts.ref ?? 'main'
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/contents/${opts.path}?ref=${encodeURIComponent(ref)}`,
    )
    const body = await this.json<{ content: string; sha: string; encoding: string }>(
      url,
      { headers: this.headers() },
    )
    const content = body.encoding === 'base64' ? decodeContentBase64(body.content) : body.content
    return { content, sha: body.sha }
  }

  async putFile(opts: {
    owner: string
    repo: string
    path: string
    content: string
    sha?: string
    message: string
    branch?: string
  }): Promise<{ sha: string }> {
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/contents/${opts.path}`,
    )
    const payload: Record<string, unknown> = {
      content: encodeContentBase64(opts.content),
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

  async createBranch(opts: {
    owner: string
    repo: string
    from: string
    name: string
  }): Promise<void> {
    // GitHub has no single create-branch endpoint: resolve the source ref's
    // commit SHA, then create a new ref pointing at it.
    const ref = await this.json<{ object: { sha: string } }>(
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
  }): Promise<{ url: string; number: number }> {
    const res = await this.fetchImpl(
      this.url(
        `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls`,
      ),
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          head: opts.from,
          base: opts.to,
          title: opts.title,
          body: opts.body,
        }),
      },
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub POST pulls -> ${res.status} ${body}`)
    }
    const pr = (await res.json()) as { html_url: string; number: number }
    return { url: pr.html_url, number: pr.number }
  }

  async listTree(opts: {
    owner: string
    repo: string
    ref?: string
    path?: string
  }): Promise<Array<{ path: string; type: 'blob' | 'tree'; sha: string }>> {
    const ref = opts.ref ?? 'main'
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=true`,
    )
    const body = await this.json<{
      tree: Array<{ path: string; type: string; sha: string }>
    }>(url, { headers: this.headers() })
    let items = body.tree
    if (opts.path) {
      const prefix = opts.path.endsWith('/') ? opts.path : `${opts.path}/`
      items = items.filter((it) => it.path === opts.path || it.path.startsWith(prefix))
    }
    return items.map((it) => ({
      path: it.path,
      type: it.type === 'tree' ? 'tree' : 'blob',
      sha: it.sha,
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
