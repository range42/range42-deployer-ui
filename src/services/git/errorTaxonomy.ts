/**
 * Git Error Taxonomy
 *
 * Pure mapper from raw Git error classes (see ./types.ts) to user-facing
 * i18n keys under the `git_errors` namespace plus a recommended UI action.
 *
 * No Vue, no toast wiring, no side effects — this is consumed by higher-level
 * composables (e.g. a future `useGitError`) that bridge into notifications.
 */

import {
  GitAuthError,
  GitNotFoundError,
  GitRateLimitError,
  GitProviderError,
} from './types'

export type GitErrorAction =
  | 'settings'
  | 'fork'
  | 'sso_link'
  | 'sources'
  | 'auto_pr'
  | 'retry'
  | 'silent'
  | null

export interface MappedGitError {
  /** i18n key under the `git_errors` namespace */
  code: string
  action: GitErrorAction
  /** Seconds until retry — populated for `rate_limited` */
  retryAfterSec?: number
}

export function mapGitError(err: unknown): MappedGitError {
  if (err instanceof GitAuthError) {
    return { code: 'credentials_expired', action: 'settings' }
  }
  if (err instanceof GitNotFoundError) {
    return { code: 'repo_not_found', action: 'sources' }
  }
  if (err instanceof GitRateLimitError) {
    // GitRateLimitError stores resetAt as Date (see types.ts);
    // we expose seconds-until-reset for UI countdowns.
    const resetAt = err.resetAt
    const retryAfterSec = resetAt
      ? Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
      : undefined
    return { code: 'rate_limited', action: 'retry', retryAfterSec }
  }
  if (err instanceof GitProviderError) {
    const status = err.status
    const details = err.details ?? ''
    // SSO required (GitHub org SAML) is signaled in the details string
    if (status === 403 && /sso|saml/i.test(details)) {
      return { code: 'sso_required', action: 'sso_link' }
    }
    if (status === 403) {
      return { code: 'insufficient_scope', action: 'fork' }
    }
    if (status === 409) {
      return { code: 'branch_protected', action: 'auto_pr' }
    }
    if (status === 422 && /already.+exist|fork/i.test(details)) {
      return { code: 'silent_fork_exists', action: 'silent' }
    }
  }
  // Network / fetch failures (TypeError thrown by fetch on offline / DNS / CORS)
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return { code: 'network_unreachable', action: 'retry' }
  }
  return { code: 'unknown', action: null }
}
