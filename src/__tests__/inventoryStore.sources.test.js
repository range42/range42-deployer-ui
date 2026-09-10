import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInventoryStore } from '../stores/inventoryStore'
import { useBackendApiStore } from '../stores/backendApiStore'

describe('inventoryStore — GitSource model (Plan C §4)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('addSource stores a GitSource and persists under range42_git_sources', () => {
    const store = useInventoryStore()
    const src = store.addSource({
      id: 'src-a',
      provider: 'github',
      base_url: 'https://github.com',
      auth: { kind: 'pat', ref_to_token_id: 'src-a' },
      repos: [{ owner: 'acme', repo: 'lab', branch: 'main' }],
    })

    expect(src.id).toBe('src-a')
    expect(store.sources).toHaveLength(1)

    const persisted = JSON.parse(localStorage.getItem('range42_git_sources') || '[]')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe('src-a')
  })

  it('addSource rejects duplicate ids', () => {
    const store = useInventoryStore()
    store.addSource({
      id: 'src-a',
      provider: 'github',
      base_url: 'https://github.com',
      auth: { kind: 'none' },
      repos: [],
    })
    expect(() =>
      store.addSource({
        id: 'src-a',
        provider: 'github',
        base_url: 'https://github.com',
        auth: { kind: 'none' },
        repos: [],
      }),
    ).toThrow()
  })

  it('removeSource drops the source and its stored token', () => {
    const store = useInventoryStore()
    store.addSource({
      id: 'src-b',
      provider: 'gitlab',
      base_url: 'https://gitlab.example.com',
      auth: { kind: 'pat', ref_to_token_id: 'src-b' },
      repos: [],
    })
    store.setToken('src-b', 'glpat-xxx')
    expect(localStorage.getItem('range42_token_src-b')).toBe('glpat-xxx')

    store.removeSource('src-b')
    expect(store.sources).toHaveLength(0)
    expect(localStorage.getItem('range42_token_src-b')).toBeNull()
  })

  it('setToken / getToken round-trip via localStorage', () => {
    const store = useInventoryStore()
    store.setToken('src-c', 'secret-token')
    expect(store.getToken('src-c')).toBe('secret-token')
    expect(localStorage.getItem('range42_token_src-c')).toBe('secret-token')
  })

  it('keeps legacy browser credentials isolated when backends reuse a source ID', () => {
    const backend = useBackendApiStore()
    const first = backend.addHost({ url: 'https://backend-a.test' })
    const store = useInventoryStore()
    store.setToken('same-id', 'token-for-a')
    const second = backend.addHost({ url: 'https://backend-b.test' })
    backend.setActiveHost(second)
    expect(store.getToken('same-id')).toBeNull()
    store.setToken('same-id', 'token-for-b')
    backend.setActiveHost(first)
    expect(store.getToken('same-id')).toBe('token-for-a')
  })

  it('updateSourceHealth mutates the source health blob', () => {
    const store = useInventoryStore()
    store.addSource({
      id: 'src-d',
      provider: 'gitea',
      base_url: 'https://gitea.local',
      auth: { kind: 'none' },
      repos: [],
    })

    const checkedAt = new Date().toISOString()
    store.updateSourceHealth('src-d', { status: 'ok', rtt_ms: 42, checked_at: checkedAt })

    const s = store.getSource('src-d')
    expect(s).toBeDefined()
    expect(s.health.status).toBe('ok')
    expect(s.health.rtt_ms).toBe(42)
    expect(s.health.checked_at).toBe(checkedAt)
  })

  it('sources reload from localStorage across store instances', () => {
    const store1 = useInventoryStore()
    store1.addSource({
      id: 'src-e',
      provider: 'github',
      base_url: 'https://github.com',
      auth: { kind: 'none' },
      repos: [],
    })

    // New Pinia instance simulates a reload
    setActivePinia(createPinia())
    const store2 = useInventoryStore()
    expect(store2.sources).toHaveLength(1)
    expect(store2.sources[0].id).toBe('src-e')
  })
})
