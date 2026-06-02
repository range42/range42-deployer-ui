/**
 * Git Services Index
 * 
 * Exports Git provider types, implementations, and registry.
 */

// Types
export * from './types'

// Providers
export { GitHubProvider, getGitHubProvider } from './github'
export { GitLabProvider, getGitLabProvider } from './gitlab'
export { GiteaProvider, getGiteaProvider } from './gitea'

// =============================================================================
// Provider Registry
// =============================================================================

import type { GitProvider, GitProviderName, GitProviderV1, GitProviderV1Kind } from './types'
import { getGitHubProvider } from './github'
import { GitHubV1Provider } from './github.v1'
import { GitLabProvider } from './gitlab'
import { GiteaProvider } from './gitea'

const providers = new Map<GitProviderName, () => GitProvider>()

// Register default providers
providers.set('github', getGitHubProvider)

/**
 * Register a new Git provider
 */
export function registerGitProvider(name: GitProviderName, factory: () => GitProvider): void {
  providers.set(name, factory)
}

/**
 * Get a Git provider by name
 */
export function getGitProvider(name: GitProviderName = 'github'): GitProvider {
  const factory = providers.get(name)
  if (!factory) {
    throw new Error(`Git provider '${name}' not registered`)
  }
  return factory()
}

/**
 * Get all registered provider names
 */
export function getRegisteredProviders(): GitProviderName[] {
  return Array.from(providers.keys())
}

// =============================================================================
// V1 Provider Factory (GitProviderV1)
// =============================================================================
//
// Returns an instance of the simpler v1 interface (used by
// ProjectRepoAdapter and new catalog/source flows). GitHub, GitLab, and Gitea
// are supported; the legacy `getGitProvider('github')` remains for the older
// GitProvider interface consumed by inventoryStore.

export interface GetProviderOpts {
  baseUrl?: string
  token?: string | null
  fetchImpl?: typeof fetch
}

export function getProvider(kind: GitProviderV1Kind, opts: GetProviderOpts = {}): GitProviderV1 {
  switch (kind) {
    case 'gitlab':
      return new GitLabProvider(opts)
    case 'gitea':
      return new GiteaProvider(opts)
    case 'github':
      return new GitHubV1Provider(opts)
    case 'generic':
      throw new Error(
        `getProvider('${kind}'): v1 adapter not yet implemented for 'generic'`,
      )
    default: {
      const _exhaustive: never = kind
      throw new Error(`unknown provider kind: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Detect provider from repository URL
 */
export function detectProviderFromUrl(url: string): GitProviderName | null {
  if (url.includes('github.com')) return 'github'
  if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab'
  if (url.includes('gitea')) return 'gitea'
  return null
}

/**
 * Parse repository URL into owner/repo
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  // Handle various formats:
  // - https://github.com/owner/repo
  // - github.com/owner/repo
  // - owner/repo
  // - https://github.com/owner/repo.git
  
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/\s.]+)/,
    /(?:https?:\/\/)?(?:www\.)?gitlab\.com\/([^/]+)\/([^/\s.]+)/,
    /^([^/\s]+)\/([^/\s]+)$/,
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      }
    }
  }
  
  return null
}
