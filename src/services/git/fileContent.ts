import type { GitProviderV1 } from './types'
import type { FileContent } from '@/services/projectFiles'

/** Prefer lossless reads, with compatibility for providers that only expose text. */
export function readFileContent(
  provider: Pick<GitProviderV1, 'getFile' | 'getFileContent'>,
  options: { owner: string; repo: string; path: string; ref?: string },
): Promise<{ content: FileContent; sha: string }> {
  return provider.getFileContent ? provider.getFileContent(options) : provider.getFile(options)
}

export function isGitNotFound(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return error.status === 404
  const message = error instanceof Error ? error.message : String(error)
  return /^(?:404\b|not found(?::|$)|(?:GitHub|GitLab|Gitea) GET\b.* -> 404\b)/i.test(message)
}
