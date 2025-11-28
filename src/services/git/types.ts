/**
 * Git Provider Types
 * 
 * Type definitions for Git provider abstraction layer.
 * Supports GitHub, with future extensibility for GitLab/Gitea.
 */

// =============================================================================
// Git Provider Types
// =============================================================================

export type GitProviderName = 'github' | 'gitlab' | 'gitea'

export interface GitUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
  email: string | null
}

export interface GitFile {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir'
  downloadUrl?: string
}

export interface GitRepo {
  id: number
  name: string
  fullName: string
  owner: string
  description: string | null
  private: boolean
  defaultBranch: string
  htmlUrl: string
  cloneUrl: string
  createdAt: string
  updatedAt: string
  stargazersCount?: number
  forksCount?: number
}

export interface GitPullRequest {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed' | 'merged'
  htmlUrl: string
  head: { ref: string; sha: string }
  base: { ref: string; sha: string }
  createdAt: string
  updatedAt: string
}

export interface GitBranch {
  name: string
  sha: string
  protected: boolean
}

// =============================================================================
// Inventory Types
// =============================================================================

export interface InventoryManifest {
  name: string
  version: string
  description: string
  author: string
  license: string
  repository: string
  categories: string[]
  components: {
    vms: number
    networks: number
    scenarios: number
    services?: number
  }
  proxmox_requirements?: {
    min_version?: string
    features?: string[]
  }
}

export interface InventoryComponent {
  id: string
  type: 'vm' | 'lxc' | 'network' | 'service' | 'scenario'
  name: string
  description: string
  version: string
  tags: string[]
  icon?: string
  config: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface InventoryVmComponent extends InventoryComponent {
  type: 'vm'
  config: {
    cpu?: string
    cores: number
    sockets?: number
    memory: number
    disk?: number
    os?: string
    template?: string
    iso?: string
    networks?: Array<{
      model?: string
      bridge?: string
      tag?: number
      firewall?: boolean
    }>
  }
  metadata?: {
    default_credentials?: string
    services?: string[]
    cves?: string[]
    documentation_url?: string
  }
}

export interface InventoryLxcComponent extends InventoryComponent {
  type: 'lxc'
  config: {
    cores: number
    memory: number
    swap?: number
    rootfs_size?: string
    ostemplate: string
    unprivileged?: boolean
    networks?: Array<{
      name: string
      bridge?: string
      ip?: string
      gw?: string
      tag?: number
    }>
  }
}

export interface InventoryNetworkComponent extends InventoryComponent {
  type: 'network'
  config: {
    bridge: string
    cidr: string
    gateway?: string
    vlan?: number
    dhcp?: boolean
  }
}

export interface InventoryScenarioNode {
  id: string
  component: string  // Reference to component ID
  position: { x: number; y: number }
  overrides?: Record<string, unknown>  // Override component config
}

export interface InventoryScenarioEdge {
  source: string
  target: string
  data?: Record<string, unknown>
}

export interface InventoryScenario extends InventoryComponent {
  type: 'scenario'
  nodes: InventoryScenarioNode[]
  edges: InventoryScenarioEdge[]
}

// =============================================================================
// Repository Registration
// =============================================================================

export interface RegisteredInventory {
  id: string  // owner/repo
  owner: string
  repo: string
  branch: string
  manifest: InventoryManifest
  addedAt: string
  lastSyncAt?: string
  provider: GitProviderName
  isWritable: boolean  // User has write access
}

// =============================================================================
// Git Provider Interface
// =============================================================================

export interface GitProvider {
  readonly name: GitProviderName
  readonly baseUrl: string
  
  // Authentication
  setToken(token: string): void
  getToken(): string | null
  authenticate(): Promise<GitUser>
  isAuthenticated(): boolean
  
  // User
  getUser(): Promise<GitUser>
  
  // Repository
  getRepoInfo(owner: string, repo: string): Promise<GitRepo>
  listBranches(owner: string, repo: string): Promise<GitBranch[]>
  
  // Read operations
  getFile(owner: string, repo: string, path: string, ref?: string): Promise<string>
  getFileInfo(owner: string, repo: string, path: string, ref?: string): Promise<GitFile>
  listFiles(owner: string, repo: string, path: string, ref?: string): Promise<GitFile[]>
  
  // Write operations
  createOrUpdateFile(
    owner: string, 
    repo: string, 
    path: string, 
    content: string, 
    message: string,
    branch?: string
  ): Promise<void>
  deleteFile(
    owner: string, 
    repo: string, 
    path: string, 
    message: string,
    branch?: string
  ): Promise<void>
  
  // Branch operations
  createBranch(owner: string, repo: string, branch: string, fromRef: string): Promise<GitBranch>
  
  // Pull request
  createPullRequest(
    owner: string, 
    repo: string, 
    title: string, 
    head: string, 
    base: string,
    body?: string
  ): Promise<GitPullRequest>
  
  // Fork
  forkRepo(owner: string, repo: string): Promise<GitRepo>
  
  // Check permissions
  canWrite(owner: string, repo: string): Promise<boolean>
}

// =============================================================================
// Errors
// =============================================================================

export class GitProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: GitProviderName,
    public readonly status?: number,
    public readonly details?: string
  ) {
    super(message)
    this.name = 'GitProviderError'
  }
}

export class GitAuthError extends GitProviderError {
  constructor(provider: GitProviderName, message = 'Authentication required') {
    super(message, provider, 401)
    this.name = 'GitAuthError'
  }
}

export class GitNotFoundError extends GitProviderError {
  constructor(provider: GitProviderName, resource: string) {
    super(`${resource} not found`, provider, 404)
    this.name = 'GitNotFoundError'
  }
}

export class GitRateLimitError extends GitProviderError {
  constructor(provider: GitProviderName, resetAt?: Date) {
    super(`Rate limit exceeded${resetAt ? `, resets at ${resetAt.toISOString()}` : ''}`, provider, 429)
    this.name = 'GitRateLimitError'
  }
}
