import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCatalog, applyClientFilters } from '../composables/useCatalog'

// Minimal IndexedDB mock via fake-indexeddb shim. `idb` resolves its backing
// store from the global `indexedDB`; jsdom does not provide one.
import 'fake-indexeddb/auto'

describe('useCatalog — cross-source catalog composable (Plan C §4)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('listEntries reads the backend Page{items} shape and only sends server-honored params', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        // Backend returns a Page object, not { entries }.
        items: [
          {
            kind: 'lab',
            name: 'demo-lab',
            source_id: 'src-a',
            path: 'labs/demo',
          },
        ],
        total: 1,
        offset: 0,
        limit: 100,
      }),
    })

    const { entries, listEntries } = useCatalog()
    const out = await listEntries({ kind: 'lab', source_id: 'src-a', tag: 'web' })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const url = globalThis.fetch.mock.calls[0][0]
    expect(url).toMatch(/^\/v1\/catalog\/entries\?/)
    // Aligned param names that the backend actually honors.
    expect(url).toContain('kind=lab')
    expect(url).toContain('source_id=src-a')
    expect(url).toContain('tag=web')
    // Legacy / unsupported param names must NOT be sent.
    expect(url).not.toContain('source=src-a')
    expect(url).not.toMatch(/[?&]tags=/)
    expect(url).not.toMatch(/[?&](os|difficulty|q)=/)

    expect(out).toHaveLength(1)
    expect(entries.value).toHaveLength(1)
    expect(entries.value[0].name).toBe('demo-lab')
  })

  it('listEntries records an error and resets entries on network failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const { entries, error, listEntries } = useCatalog()
    const out = await listEntries()

    expect(out).toEqual([])
    expect(entries.value).toEqual([])
    expect(error.value).toBeTruthy()
  })

  it('getEntry fetches a single entry by encoded source + path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        kind: 'gamenet',
        name: 'ctf-net',
        source_id: 'gitlab:acme/catalog',
        path: 'gamenets/ctf/range42.yaml',
      }),
    })

    const { getEntry } = useCatalog()
    const entry = await getEntry('gitlab:acme/catalog', 'gamenets/ctf/range42.yaml')

    expect(entry).not.toBeNull()
    expect(entry.name).toBe('ctf-net')
    const url = globalThis.fetch.mock.calls[0][0]
    // source is encoded as a single component; path segments are individually encoded.
    expect(url).toContain('/v1/catalog/entries/')
    expect(url).toContain(encodeURIComponent('gitlab:acme/catalog'))
    expect(url).toContain('gamenets/ctf/range42.yaml')
  })
})

describe('applyClientFilters — presentation-side refinement', () => {
  const entries = [
    { kind: 'lab', name: 'Web Recon', source_id: 'src-a', path: 'labs/web', os: 'ubuntu', difficulty: 'easy', tags: ['web', 'recon'] },
    { kind: 'container', name: 'SQLi Box', source_id: 'src-b', path: 'cve/web/sqli', os: 'debian', difficulty: 'hard', tags: ['web', 'sqli'] },
    { kind: 'ansible_role', name: 'Install Wazuh', source_id: 'src-a', path: 'roles/wazuh', os: '', difficulty: '', tags: ['monitoring'] },
  ]

  it('returns all entries when no filters are given', () => {
    expect(applyClientFilters(entries)).toHaveLength(3)
    expect(applyClientFilters(entries, {})).toHaveLength(3)
  })

  it('filters by multiple kinds (OR within kinds)', () => {
    const out = applyClientFilters(entries, { kinds: ['lab', 'ansible_role'] })
    expect(out.map((e) => e.name)).toEqual(['Web Recon', 'Install Wazuh'])
  })

  it('filters by multiple sources (OR within sources)', () => {
    const out = applyClientFilters(entries, { sources: ['src-b'] })
    expect(out.map((e) => e.name)).toEqual(['SQLi Box'])
  })

  it('requires ALL tags to match (AND across tags)', () => {
    expect(applyClientFilters(entries, { tags: ['web'] }).map((e) => e.name)).toEqual([
      'Web Recon',
      'SQLi Box',
    ])
    expect(applyClientFilters(entries, { tags: ['web', 'sqli'] }).map((e) => e.name)).toEqual([
      'SQLi Box',
    ])
  })

  it('filters by os and difficulty case-insensitively', () => {
    expect(applyClientFilters(entries, { os: 'UBUNTU' }).map((e) => e.name)).toEqual(['Web Recon'])
    expect(applyClientFilters(entries, { difficulty: 'Hard' }).map((e) => e.name)).toEqual([
      'SQLi Box',
    ])
  })

  it('free-text q matches name, description, and path', () => {
    expect(applyClientFilters(entries, { q: 'sqli' }).map((e) => e.name)).toEqual(['SQLi Box'])
    expect(applyClientFilters(entries, { q: 'roles/' }).map((e) => e.name)).toEqual([
      'Install Wazuh',
    ])
  })

  it('combines client filters (AND across dimensions)', () => {
    const out = applyClientFilters(entries, { kinds: ['lab', 'container'], tags: ['web'], os: 'debian' })
    expect(out.map((e) => e.name)).toEqual(['SQLi Box'])
  })
})
