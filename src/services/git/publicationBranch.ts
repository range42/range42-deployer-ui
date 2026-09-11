import { sha256 } from '@noble/hashes/sha2.js'

/** Gitea's branch APIs accept at most 100 characters, including path separators. */
export function publicationBranch(projectId: string, target: { id: string; base_branch: string; subdir?: string; provider: string }): string {
  const legacy = `range42-publish/${encodeURIComponent(projectId)}/${encodeURIComponent(target.id)}/${encodeURIComponent(target.base_branch)}/${encodeURIComponent(JSON.stringify(target.subdir || ''))}`
  if (!['gitea', 'generic'].includes(target.provider) || legacy.length <= 100) return legacy
  // Synchronous SHA256 also works on shared HTTP origins without SubtleCrypto.
  // Keep all identity fields in the digest so retries reuse the same branch.
  const digest = sha256(new TextEncoder().encode(legacy))
  return `range42-publish/${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
