/**
 * Gitea Provider (v1 interface)
 *
 * Implements GitProviderV1 against Gitea REST API v1.
 * Authentication via `Authorization: token <pat>` header.
 *
 * Docs: https://docs.gitea.com/api
 * The endpoint shapes mirror GitHub's fairly closely, which keeps the
 * adapter simpler than GitLab's.
 */

import type { GitProviderV1, RepoRef, CommitRef } from './types'
import { encodeContentBase64, decodeContentBase64 } from './encoding'

export interface GiteaProviderOpts {
  baseUrl?: string        // e.g. https://gitea.example.com
  token?: string | null
  fetchImpl?: typeof fetch
}

export class GiteaProvider implements GitProviderV1 {
  readonly id = 'gitea' as const
  private baseUrl: string
  private token: string | null
  private fetchImpl: typeof fetch

  constructor(opts: GiteaProviderOpts = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://gitea.com').replace(/\/+$/, '')
    this.token = opts.token ?? null
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  setToken(token: string | null): void {
    this.token = token
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/v1${path}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      ...extra,
    }
    if (this.token) h['Authorization'] = `token ${this.token}`
    return h
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gitea ${init?.method ?? 'GET'} ${url} -> ${res.status} ${body}`)
    }
    return (await res.json()) as T
  }

  // ---------------------------------------------------------------------------
  // GitProviderV1 surface
  // ---------------------------------------------------------------------------

  async listRepos(opts: { owner?: string }): Promise<RepoRef[]> {
    const url = opts.owner
      ? this.url(`/users/${encodeURIComponent(opts.owner)}/repos?limit=50`)
      : this.url('/repos/search?limit=50')
    const items = opts.owner
      ? await this.json<
          Array<{ owner: { login: string }; name: string; default_branch: string }>
        >(url, { headers: this.headers() })
      : (
          await this.json<{
            data: Array<{
              owner: { login: string }
              name: string
              default_branch: string
            }>
          }>(url, { headers: this.headers() })
        ).data
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
    const method = opts.sha ? 'PUT' : 'POST'
    const res = await this.fetchImpl(url, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gitea ${method} ${url} -> ${res.status} ${body}`)
    }
    const body = (await res.json()) as { content: { sha: string } }
    return { sha: body.content.sha }
  }

  async createBranch(opts: {
    owner: string
    repo: string
    from: string
    name: string
  }): Promise<void> {
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/branches`,
    )
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ new_branch_name: opts.name, old_branch_name: opts.from }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gitea POST ${url} -> ${res.status} ${body}`)
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
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls`,
    )
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        head: opts.from,
        base: opts.to,
        title: opts.title,
        body: opts.body,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gitea POST ${url} -> ${res.status} ${body}`)
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
    // Gitea exposes a git-tree endpoint; we use the recursive mode for parity
    // with GitHub's tree API.
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
    params.set('limit', String(opts.perPage ?? 50))
    const url = this.url(
      `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(
        opts.repo,
      )}/commits?${params.toString()}`,
    )
    const items = await this.json<
      Array<{
        sha: string
        commit: {
          message: string
          author: { name: string; date: string }
        }
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
      // Gitea's repo endpoint mirrors GitHub: a `permissions` object carries
      // `admin`, `push`, and `pull` booleans for the authenticated caller.
      const data = await this.json<{
        permissions?: {
          admin?: boolean
          push?: boolean
        }
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
      const res = await this.fetchImpl(this.url('/version'), { headers: this.headers() })
      return { ok: res.ok, rtt_ms: Date.now() - started }
    } catch {
      return { ok: false, rtt_ms: Date.now() - started }
    }
  }
}

export function getGiteaProvider(opts: GiteaProviderOpts = {}): GiteaProvider {
  return new GiteaProvider(opts)
}
