import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCatalog, applyClientFilters } from '../composables/useCatalog'

// Minimal IndexedDB mock via fake-indexeddb shim. `idb` resolves its backing
// store from the global `indexedDB`; jsdom does not provide one.
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import canonicalTopology from '../../schema/test-vectors/topology/01-minimal.json'

describe('useCatalog — cross-source catalog composable (Plan C §4)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
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

  it('loads every server page so entries beyond the first 500 remain searchable', async () => {
    const page = (offset, count) => ({ ok: true, json: async () => ({
      items: Array.from({ length: count }, (_, i) => ({ name: `entry-${offset + i}` })),
      total: 503, offset, limit: 500,
    }) })
    globalThis.fetch.mockResolvedValueOnce(page(0, 500)).mockResolvedValueOnce(page(500, 3))
    const catalog = useCatalog()
    const out = await catalog.listEntries({ source_id: 'large', limit: 500 })
    expect(out).toHaveLength(503)
    expect(applyClientFilters(out, { q: 'entry-502' })).toHaveLength(1)
    expect(globalThis.fetch.mock.calls[1][0]).toContain('offset=500')
    expect(globalThis.fetch.mock.calls[1][0]).toContain('source_id=large')
  })

  it('does not cache an incomplete catalog when a later page fails', async () => {
    const catalog = useCatalog()
    await catalog.clearCache()
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      items: [{ name: 'first' }], total: 2, offset: 0, limit: 1,
    }) }).mockRejectedValueOnce(new Error('Second page unavailable'))
    expect(await catalog.listEntries({ limit: 1 })).toEqual([])
    expect(catalog.error.value).toBe('Second page unavailable')
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

  it('reads catalog entries from the selected backend with its gateway token', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://lab.example/api/', token: 'gateway-token' })
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })

    await useCatalog().listEntries()

    expect(globalThis.fetch).toHaveBeenCalledWith('https://lab.example/api/v1/catalog/entries',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gateway-token' }) }))
  })

  it('does not show another backend’s cached catalog when the selected backend is offline', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://first.example' })
    const catalog = useCatalog()
    await catalog.clearCache()
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ items: [{ name: 'First backend catalog' }] }),
    })
    await catalog.listEntries()
    globalThis.fetch.mockRejectedValueOnce(new Error('First backend offline'))
    expect(await catalog.listEntries()).toEqual([{ name: 'First backend catalog' }])
    const second = backend.addHost({ url: 'https://second.example' })
    backend.setActiveHost(second)
    globalThis.fetch.mockRejectedValueOnce(new Error('Backend offline'))

    expect(await catalog.listEntries()).toEqual([])
    expect(catalog.error.value).toBe('Backend offline')
  })

  it('surfaces the backend explanation when an entry cannot be loaded', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({ code: 'SOURCE_EMPTY', message: 'Connect a repository before indexing.' }),
    })
    const catalog = useCatalog()
    expect(await catalog.getEntry('missing-source', 'missing-entry')).toBeNull()
    expect(catalog.error.value).toBe('Connect a repository before indexing.')
  })

  it('presents README and manifest details from the backend detail envelope', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'Demo lab', kind: 'lab', source_id: 's1', path: 'labs/demo',
        readme_md: '# Set up the demo lab',
        document: { name: 'untrusted override', source_id: 'other',
          topology: { nodes: [{ id: 'vm1' }], edges: [] },
          inventory: [{ name: 'Ubuntu' }], metadata: { maintainer: 'Range42' } },
      }),
    })

    const entry = await useCatalog().getEntry('s1', 'labs/demo')
    expect(entry.readme).toBe('# Set up the demo lab')
    expect(entry.topology.nodes).toEqual([{ id: 'vm1' }])
    expect(entry.inventory).toEqual([{ name: 'Ubuntu' }])
    expect(entry.metadata).toEqual({ maintainer: 'Range42' })
    expect(entry.name).toBe('Demo lab')
    expect(entry.source_id).toBe('s1')
  })

  it('converts canonical manifest nodes into a topology preview', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      name: canonicalTopology.name, kind: 'gamenet', source_id: 's1', path: 'minimal',
      document: canonicalTopology,
    }) })
    const entry = await useCatalog().getEntry('s1', 'minimal')
    expect(entry.topology?.nodes).toEqual([expect.objectContaining({
      id: 'host-01', type: 'vm', position: { x: 0, y: 0 },
      data: expect.objectContaining({ config: expect.objectContaining({ template: '9001' }) }),
    })])
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
