import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCatalog } from '../composables/useCatalog'

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

  it('listEntries builds a filter query string and populates entries', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [
          {
            kind: 'lab',
            name: 'demo-lab',
            source_id: 'src-a',
            path: 'labs/demo',
          },
        ],
        source_sha: 'abc123',
      }),
    })

    const { entries, listEntries } = useCatalog()
    const out = await listEntries({ kind: ['lab'], source: 'src-a', q: 'demo' })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const url = globalThis.fetch.mock.calls[0][0]
    expect(url).toMatch(/^\/v1\/catalog\/entries\?/)
    expect(url).toContain('kind=lab')
    expect(url).toContain('source=src-a')
    expect(url).toContain('q=demo')

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
