import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

const KEY = 'range42_backend_api'
afterEach(() => vi.restoreAllMocks())

describe('backendApiStore — host list', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts with an empty host list on a fresh install', () => {
    const s = useBackendApiStore()
    expect(s.hosts).toEqual([])
    expect(s.activeHost).toBeNull()
    // back-compat getters degrade gracefully
    expect(s.url).toBe('')
  })

  it('migrates a legacy single-config { url, token } into one host', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ url: 'http://10.0.0.5:8000', token: 'abc' }),
    )
    const s = useBackendApiStore()
    expect(s.hosts).toHaveLength(1)
    expect(s.hosts[0].url).toBe('http://10.0.0.5:8000')
    expect(s.hosts[0].token).toBe('abc')
    expect(s.hosts[0].nodeName).toBe('pve')
    // the migrated host becomes active, so back-compat getters resolve to it
    expect(s.activeHost?.url).toBe('http://10.0.0.5:8000')
    expect(s.url).toBe('http://10.0.0.5:8000')
    expect(s.token).toBe('abc')
  })

  it('adds a host, returns its id, and activates the first one', () => {
    const s = useBackendApiStore()
    const id = s.addHost({ label: 'lab', url: 'http://h1:8000/', nodeName: 'pve' })
    expect(typeof id).toBe('string')
    expect(s.hosts).toHaveLength(1)
    // url is normalised (trailing slash stripped)
    expect(s.hosts[0].url).toBe('http://h1:8000')
    expect(s.activeHost?.id).toBe(id)
  })

  it('updates and removes hosts, re-pointing the active host when removed', () => {
    const s = useBackendApiStore()
    const a = s.addHost({ label: 'a', url: 'http://a:8000', nodeName: 'pve' })
    const b = s.addHost({ label: 'b', url: 'http://b:8000', nodeName: 'node2' })
    s.setActiveHost(b)
    s.updateHost(a, { nodeName: 'pve-1' })
    expect(s.getHost(a)?.nodeName).toBe('pve-1')

    s.removeHost(b)
    expect(s.hosts).toHaveLength(1)
    // active fell back to the remaining host
    expect(s.activeHost?.id).toBe(a)

    s.removeHost(a)
    expect(s.hosts).toEqual([])
    expect(s.activeHost).toBeNull()
  })

  it('persists the host list across store instances', () => {
    const s1 = useBackendApiStore()
    s1.addHost({ label: 'lab', url: 'http://h1:8000', nodeName: 'pve' })
    // new pinia, same localStorage
    setActivePinia(createPinia())
    const s2 = useBackendApiStore()
    expect(s2.hosts).toHaveLength(1)
    expect(s2.hosts[0].url).toBe('http://h1:8000')
  })

  it('reports session-only connection changes synchronously and recovers after a successful write', () => {
    const store = useBackendApiStore()
    const id = store.addHost({ label: 'Saved', url: 'https://backend.test', token: 'original-token' })
    const persisted = localStorage.getItem(KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-storage-diagnostic') })

    store.updateHost(id, { label: 'Session change', token: 'replacement-token' })
    expect(write).toHaveBeenCalled()
    expect(store.getHost(id).token).toBe('replacement-token')
    expect(store.storageError).toMatch(/this session/i)
    expect(store.storageError).not.toContain('private-storage-diagnostic')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-storage-diagnostic')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('replacement-token')
    expect(localStorage.getItem(KEY)).toBe(persisted)
    setActivePinia(createPinia())
    expect(useBackendApiStore().getHost(id).token).toBe('original-token')

    write.mockRestore()
    store.updateHost(id, { label: 'Saved after recovery' })
    expect(store.storageError).toBe('')
    setActivePinia(createPinia())
    const restored = useBackendApiStore().getHost(id)
    expect(restored.label).toBe('Saved after recovery')
    expect(restored.token).toBe('replacement-token')
  })

  it('retries persisting the exact unchanged session connections only when requested', () => {
    const store = useBackendApiStore()
    const id = store.addHost({ label: 'Saved', url: 'https://backend.test' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    store.updateHost(id, { label: 'Session change', token: 'retry-token' })
    const snapshot = JSON.stringify(store.hosts)
    expect(store.retryPersistence()).toBe(false)
    write.mockRestore()
    expect(store.retryPersistence()).toBe(true)
    expect(store.storageError).toBe('')
    expect(JSON.stringify(store.hosts)).toBe(snapshot)
    setActivePinia(createPinia())
    expect(JSON.stringify(useBackendApiStore().hosts)).toBe(snapshot)
    expect(useBackendApiStore().activeHost.id).toBe(id)
  })

  it('never persists a partial URL/token pair when the completed connection exceeds storage limits', () => {
    const store = useBackendApiStore()
    const id = store.addHost({ url: 'https://original.test', token: 'original-token' })
    const persisted = localStorage.getItem(KEY)
    const write = Storage.prototype.setItem
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (value.includes('replacement-token')) throw new Error('quota exceeded')
      return write.call(this, key, value)
    })

    store.updateHost(id, { url: 'https://replacement.test', token: 'replacement-token' })

    expect(store.getHost(id)).toMatchObject({ url: 'https://replacement.test', token: 'replacement-token' })
    expect(store.storageError).toMatch(/this session/)
    expect(localStorage.getItem(KEY)).toBe(persisted)
    setActivePinia(createPinia())
    expect(useBackendApiStore().getHost(id)).toMatchObject({ url: 'https://original.test', token: 'original-token' })
  })
})
