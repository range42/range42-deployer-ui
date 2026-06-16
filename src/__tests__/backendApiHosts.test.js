import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

const KEY = 'range42_backend_api'

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
})
