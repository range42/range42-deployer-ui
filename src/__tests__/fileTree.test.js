import { describe, it, expect } from 'vitest'
import {
  mergeTrees,
  buildForkHeader,
  readForkHeaderSha,
} from '../components/project/fileTree'

describe('mergeTrees', () => {
  it('marks base-only entries as "base"', () => {
    const merged = mergeTrees(
      [{ path: 'a.yaml', type: 'blob', sha: 'sha-a' }],
      [],
    )
    expect(merged).toEqual([
      { path: 'a.yaml', type: 'blob', sha: 'sha-a', marker: 'base', baseSha: 'sha-a' },
    ])
  })

  it('marks overlay-only entries as "overlay"', () => {
    const merged = mergeTrees(
      [],
      [{ path: 'b.yaml', type: 'blob', sha: 'sha-b' }],
    )
    expect(merged[0].marker).toBe('overlay')
    expect(merged[0].overlaySha).toBe('sha-b')
  })

  it('marks entries present in both as "overlay_override" and captures both shas', () => {
    const merged = mergeTrees(
      [{ path: 'x.yaml', type: 'blob', sha: 'sha-base' }],
      [{ path: 'x.yaml', type: 'blob', sha: 'sha-overlay' }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].marker).toBe('overlay_override')
    expect(merged[0].baseSha).toBe('sha-base')
    expect(merged[0].overlaySha).toBe('sha-overlay')
  })

  it('returns entries sorted by path', () => {
    const merged = mergeTrees(
      [
        { path: 'zeta', type: 'blob', sha: 'z' },
        { path: 'alpha', type: 'blob', sha: 'a' },
      ],
      [{ path: 'mid', type: 'blob', sha: 'm' }],
    )
    expect(merged.map((m) => m.path)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('buildForkHeader', () => {
  it('emits a stable header block containing the base sha', () => {
    const header = buildForkHeader('roles/foo.yml', 'sha-base-123', '2026-04-14T00:00:00Z')
    expect(header).toContain('# Range42: forked from base overlay')
    expect(header).toContain('# path: roles/foo.yml')
    expect(header).toContain('# forked_from_sha: sha-base-123')
    expect(header).toContain('# forked_at: 2026-04-14T00:00:00Z')
    expect(header.endsWith('\n')).toBe(true)
  })
})

describe('readForkHeaderSha', () => {
  it('extracts forked_from_sha from the top-of-file header', () => {
    const header = buildForkHeader('roles/foo.yml', 'sha-abc')
    const sha = readForkHeaderSha(header + '\nbody: here')
    expect(sha).toBe('sha-abc')
  })

  it('returns null for files without the marker', () => {
    expect(readForkHeaderSha('plain: yaml\n')).toBeNull()
  })

  it('stops scanning once the header block ends', () => {
    const content = 'body: yes\n# forked_from_sha: sha-late\n'
    expect(readForkHeaderSha(content)).toBeNull()
  })
})
