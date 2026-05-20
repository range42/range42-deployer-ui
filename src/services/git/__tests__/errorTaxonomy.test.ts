import { describe, expect, it } from 'vitest'
import { mapGitError } from '../errorTaxonomy'
import {
  GitAuthError,
  GitNotFoundError,
  GitRateLimitError,
  GitProviderError,
} from '../types'

describe('mapGitError', () => {
  it('maps GitAuthError → credentials_expired/settings', () => {
    const out = mapGitError(new GitAuthError('github'))
    expect(out.code).toBe('credentials_expired')
    expect(out.action).toBe('settings')
  })

  it('maps GitNotFoundError → repo_not_found/sources', () => {
    const out = mapGitError(new GitNotFoundError('github', 'org/repo'))
    expect(out.code).toBe('repo_not_found')
    expect(out.action).toBe('sources')
  })

  it('maps GitProviderError 403 with SSO details → sso_required', () => {
    const e = new GitProviderError('forbidden', 'github', 403, 'SAML SSO required')
    expect(mapGitError(e).code).toBe('sso_required')
  })

  it('maps GitProviderError 403 generic → insufficient_scope/fork', () => {
    const e = new GitProviderError('forbidden', 'github', 403, '')
    const out = mapGitError(e)
    expect(out.code).toBe('insufficient_scope')
    expect(out.action).toBe('fork')
  })

  it('maps GitProviderError 409 → branch_protected/auto_pr', () => {
    const e = new GitProviderError('protected', 'github', 409)
    expect(mapGitError(e).code).toBe('branch_protected')
  })

  it('maps GitProviderError 422 fork-exists → silent_fork_exists', () => {
    const e = new GitProviderError('fork already exists', 'github', 422, 'fork already exists')
    expect(mapGitError(e).code).toBe('silent_fork_exists')
  })

  it('maps GitRateLimitError → rate_limited with retryAfterSec', () => {
    const future = new Date(Date.now() + 60_000)
    const out = mapGitError(new GitRateLimitError('github', future))
    expect(out.code).toBe('rate_limited')
    expect(out.retryAfterSec).toBeGreaterThanOrEqual(59)
    expect(out.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('maps TypeError fetch failure → network_unreachable', () => {
    expect(mapGitError(new TypeError('Failed to fetch')).code).toBe('network_unreachable')
  })

  it('maps unknown error → unknown', () => {
    expect(mapGitError(new Error('weird'))).toMatchObject({ code: 'unknown', action: null })
  })
})
