/**
 * Git Services Index
 * 
 * Exports Git provider types, implementations, and registry.
 */

// Types
export * from './types'

// Providers
export { GitHubProvider, getGitHubProvider } from './github'

// =============================================================================
// Provider Registry
// =============================================================================

import type { GitProvider, GitProviderName } from './types'
import { getGitHubProvider } from './github'

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
