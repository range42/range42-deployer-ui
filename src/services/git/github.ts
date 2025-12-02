/**
 * GitHub Provider
 * 
 * Implementation of GitProvider interface for GitHub API.
 * Handles authentication, file operations, and repository management.
 */

import type {
  GitProvider,
  GitUser,
  GitFile,
  GitRepo,
  GitBranch,
  GitPullRequest,
} from './types'
import {
  GitProviderError,
  GitAuthError,
  GitNotFoundError,
  GitRateLimitError,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const GITHUB_API_BASE = 'https://api.github.com'
const STORAGE_KEY = 'range42_github_token'

// =============================================================================
// GitHub Provider Implementation
// =============================================================================

export class GitHubProvider implements GitProvider {
  readonly name = 'github' as const
  readonly baseUrl = GITHUB_API_BASE
  
  private token: string | null = null
  private cachedUser: GitUser | null = null
  
  constructor() {
    // Try to load token from localStorage
    this.token = this.loadToken()
  }
  
  // ===========================================================================
  // Token Management
  // ===========================================================================
  
  private loadToken(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }
  
  private saveToken(token: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, token)
    } catch (e) {
      console.warn('[GitHubProvider] Failed to save token:', e)
    }
  }
  
  private clearToken(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.warn('[GitHubProvider] Failed to clear token:', e)
    }
  }
  
  setToken(token: string): void {
    this.token = token
    this.cachedUser = null
    this.saveToken(token)
  }
  
  getToken(): string | null {
    return this.token
  }
  
  isAuthenticated(): boolean {
    return !!this.token
  }
  
  // ===========================================================================
  // HTTP Helpers
  // ===========================================================================
  
  private get headers(): HeadersInit {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    return headers
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    })
    
    // Handle errors
    if (!response.ok) {
      await this.handleError(response)
    }
    
    // Handle empty responses
    if (response.status === 204) {
      return {} as T
    }
    
    return response.json()
  }
  
  private async handleError(response: Response): Promise<never> {
    const status = response.status
    let message = response.statusText
    let details: string | undefined
    
    try {
      const data = await response.json()
      message = data.message || message
      details = data.documentation_url
    } catch {
      // Response body not JSON
    }
    
    // Check for rate limit
    if (status === 403 && message.toLowerCase().includes('rate limit')) {
      const resetHeader = response.headers.get('X-RateLimit-Reset')
      const resetAt = resetHeader ? new Date(parseInt(resetHeader) * 1000) : undefined
      throw new GitRateLimitError('github', resetAt)
    }
    
    // Authentication errors
    if (status === 401) {
      throw new GitAuthError('github', message)
    }
    
    // Not found
    if (status === 404) {
      throw new GitNotFoundError('github', message)
    }
    
    throw new GitProviderError(message, 'github', status, details)
  }
  
  // ===========================================================================
  // Authentication
  // ===========================================================================
  
  async authenticate(): Promise<GitUser> {
    if (!this.token) {
      throw new GitAuthError('github')
    }
    return this.getUser()
  }
  
  async getUser(): Promise<GitUser> {
    if (this.cachedUser) {
      return this.cachedUser
    }
    
    const data = await this.request<{
      id: number
      login: string
      name: string | null
      avatar_url: string
      email: string | null
    }>('/user')
    
    this.cachedUser = {
      id: data.id,
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      email: data.email,
    }
    
    return this.cachedUser
  }
  
  // ===========================================================================
  // Repository
  // ===========================================================================
  
  async getRepoInfo(owner: string, repo: string): Promise<GitRepo> {
    const data = await this.request<{
      id: number
      name: string
      full_name: string
      owner: { login: string }
      description: string | null
      private: boolean
      default_branch: string
      html_url: string
      clone_url: string
      created_at: string
      updated_at: string
      stargazers_count: number
      forks_count: number
    }>(`/repos/${owner}/${repo}`)
    
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner.login,
      description: data.description,
      private: data.private,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      stargazersCount: data.stargazers_count,
      forksCount: data.forks_count,
    }
  }
  
  async listBranches(owner: string, repo: string): Promise<GitBranch[]> {
    const data = await this.request<Array<{
      name: string
      commit: { sha: string }
      protected: boolean
    }>>(`/repos/${owner}/${repo}/branches`)
    
    return data.map(b => ({
      name: b.name,
      sha: b.commit.sha,
      protected: b.protected,
    }))
  }
  
  // ===========================================================================
  // File Operations
  // ===========================================================================
  
  async getFile(owner: string, repo: string, path: string, ref = 'main'): Promise<string> {
    const data = await this.request<{
      content: string
      encoding: string
    }>(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`)
    
    // GitHub returns base64 encoded content
    if (data.encoding === 'base64') {
      return atob(data.content.replace(/\n/g, ''))
    }
    
    return data.content
  }
  
  async getFileInfo(owner: string, repo: string, path: string, ref = 'main'): Promise<GitFile> {
    const data = await this.request<{
      name: string
      path: string
      sha: string
      size: number
      type: 'file' | 'dir'
      download_url: string | null
    }>(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`)
    
    return {
      name: data.name,
      path: data.path,
      sha: data.sha,
      size: data.size,
      type: data.type,
      downloadUrl: data.download_url || undefined,
    }
  }
  
  async listFiles(owner: string, repo: string, path: string, ref = 'main'): Promise<GitFile[]> {
    const data = await this.request<Array<{
      name: string
      path: string
      sha: string
      size: number
      type: 'file' | 'dir'
      download_url: string | null
    }>>(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`)
    
    return data.map(f => ({
      name: f.name,
      path: f.path,
      sha: f.sha,
      size: f.size,
      type: f.type,
      downloadUrl: f.download_url || undefined,
    }))
  }
  
  // ===========================================================================
  // Write Operations
  // ===========================================================================
  
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch = 'main'
  ): Promise<void> {
    // Get current file SHA if exists (required for update)
    let sha: string | undefined
    try {
      const existing = await this.getFileInfo(owner, repo, path, branch)
      sha = existing.sha
    } catch (e) {
      if (!(e instanceof GitNotFoundError)) {
        throw e
      }
      // File doesn't exist, will create new
    }
    
    await this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: btoa(content),  // Base64 encode
        branch,
        sha,
      }),
    })
  }
  
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    branch = 'main'
  ): Promise<void> {
    const fileInfo = await this.getFileInfo(owner, repo, path, branch)
    
    await this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message,
        sha: fileInfo.sha,
        branch,
      }),
    })
  }
  
  // ===========================================================================
  // Branch Operations
  // ===========================================================================
  
  async createBranch(owner: string, repo: string, branch: string, fromRef: string): Promise<GitBranch> {
    // Get SHA of the source ref
    const sourceRef = await this.request<{
      object: { sha: string }
    }>(`/repos/${owner}/${repo}/git/ref/heads/${fromRef}`)
    
    // Create new branch
    const data = await this.request<{
      ref: string
      object: { sha: string }
    }>(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: sourceRef.object.sha,
      }),
    })
    
    return {
      name: branch,
      sha: data.object.sha,
      protected: false,
    }
  }
  
  // ===========================================================================
  // Pull Request
  // ===========================================================================
  
  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string
  ): Promise<GitPullRequest> {
    const data = await this.request<{
      id: number
      number: number
      title: string
      body: string | null
      state: 'open' | 'closed'
      html_url: string
      head: { ref: string; sha: string }
      base: { ref: string; sha: string }
      created_at: string
      updated_at: string
    }>(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        head,
        base,
        body,
      }),
    })
    
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      htmlUrl: data.html_url,
      head: data.head,
      base: data.base,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  }
  
  // ===========================================================================
  // Fork
  // ===========================================================================
  
  async forkRepo(owner: string, repo: string): Promise<GitRepo> {
    const data = await this.request<{
      id: number
      name: string
      full_name: string
      owner: { login: string }
      description: string | null
      private: boolean
      default_branch: string
      html_url: string
      clone_url: string
      created_at: string
      updated_at: string
    }>(`/repos/${owner}/${repo}/forks`, {
      method: 'POST',
    })
    
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner.login,
      description: data.description,
      private: data.private,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  }
  
  // ===========================================================================
  // Permissions
  // ===========================================================================
  
  async canWrite(owner: string, repo: string): Promise<boolean> {
    if (!this.token) {
      return false
    }
    
    try {
      const data = await this.request<{
        permissions?: {
          push?: boolean
          admin?: boolean
        }
      }>(`/repos/${owner}/${repo}`)
      
      return !!(data.permissions?.push || data.permissions?.admin)
    } catch {
      return false
    }
  }
  
  // ===========================================================================
  // Logout
  // ===========================================================================
  
  logout(): void {
    this.token = null
    this.cachedUser = null
    this.clearToken()
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: GitHubProvider | null = null

export function getGitHubProvider(): GitHubProvider {
  if (!instance) {
    instance = new GitHubProvider()
  }
  return instance
}

export default GitHubProvider
