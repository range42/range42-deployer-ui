/**
 * GitLab Provider (v1 interface)
 *
 * Implements GitProviderV1 against GitLab REST API v4.
 * Authentication via PRIVATE-TOKEN header (personal access token).
 *
 * Docs: https://docs.gitlab.com/ee/api/
 */

import type { GitProviderV1, RepoRef } from './types'
import { encodeContentBase64, decodeContentBase64 } from './encoding'

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
      throw new Error(`GitLab ${init?.method ?? 'GET'} ${url} -> ${res.status} ${body}`)
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

  async getFile(opts: {
    owner: string
    repo: string
    path: string
    ref?: string
  }): Promise<{ content: string; sha: string }> {
    const pid = this.projectId(opts.owner, opts.repo)
    const ref = opts.ref ?? 'main'
    const fileUrl = this.url(
      `/projects/${pid}/repository/files/${encodeURIComponent(opts.path)}?ref=${encodeURIComponent(ref)}`,
    )
    const body = await this.json<{ content: string; blob_id: string; encoding: string }>(
      fileUrl,
      { headers: this.headers() },
    )
    const content = body.encoding === 'base64' ? decodeContentBase64(body.content) : body.content
    return { content, sha: body.blob_id }
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
    const pid = this.projectId(opts.owner, opts.repo)
    const fileUrl = this.url(
      `/projects/${pid}/repository/files/${encodeURIComponent(opts.path)}`,
    )
    const branch = opts.branch ?? 'main'
    const payload = {
      branch,
      content: encodeContentBase64(opts.content),
      encoding: 'base64',
      commit_message: opts.message,
      last_commit_id: opts.sha,
    }
    // GitLab uses PUT to update, POST to create. We attempt PUT first; on 400
    // ("file does not exist") fall back to POST. Callers can disambiguate by
    // passing sha (update) vs omitting (create), so we branch on that signal.
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
    const fresh = await this.getFile({
      owner: opts.owner,
      repo: opts.repo,
      path: opts.path,
      ref: branch,
    })
    return { sha: fresh.sha }
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
  }): Promise<{ url: string; number: number }> {
    // GitLab calls pull requests "merge requests".
    const pid = this.projectId(opts.owner, opts.repo)
    const url = this.url(`/projects/${pid}/merge_requests`)
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        source_branch: opts.from,
        target_branch: opts.to,
        title: opts.title,
        description: opts.body,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitLab POST ${url} -> ${res.status} ${body}`)
    }
    const mr = (await res.json()) as { web_url: string; iid: number }
    return { url: mr.web_url, number: mr.iid }
  }

  async listTree(opts: {
    owner: string
    repo: string
    ref?: string
    path?: string
  }): Promise<Array<{ path: string; type: 'blob' | 'tree'; sha: string }>> {
    const pid = this.projectId(opts.owner, opts.repo)
    const params = new URLSearchParams()
    if (opts.ref) params.set('ref', opts.ref)
    if (opts.path) params.set('path', opts.path)
    params.set('recursive', 'true')
    params.set('per_page', '100')
    const url = this.url(`/projects/${pid}/repository/tree?${params.toString()}`)
    const items = await this.json<Array<{ path: string; type: string; id: string }>>(
      url,
      { headers: this.headers() },
    )
    return items.map((it) => ({
      path: it.path,
      type: it.type === 'tree' ? 'tree' : 'blob',
      sha: it.id,
    }))
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
