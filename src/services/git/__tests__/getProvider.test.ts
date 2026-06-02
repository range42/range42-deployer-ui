import { describe, it, expect } from 'vitest'
import { getProvider } from '../index'

describe('getProvider (v1 factory)', () => {
  it('returns a GitHub v1 provider for kind "github"', () => {
    const p = getProvider('github', { baseUrl: 'https://github.com', token: 't' })
    expect(p.id).toBe('github')
  })

  it('still returns gitea and gitlab providers', () => {
    expect(getProvider('gitea').id).toBe('gitea')
    expect(getProvider('gitlab').id).toBe('gitlab')
  })

  it('throws for the unported "generic" kind', () => {
    expect(() => getProvider('generic')).toThrow()
  })
})
