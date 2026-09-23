import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

function indexedSource() {
  const inv = useInventoryStore()
  inv.sourcesBackendScope = 'http://h1:8000'
  inv.addSource({ id: 's1', provider: 'github', repos: [
    { owner: 'range42', repo: 'range42-catalog', branch: 'main', last_refreshed_at: '2026-09-10T09:00:00Z' },
  ] })
}

describe('useSetupStatus', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('is incomplete on a fresh install', () => {
    const { hasSource, hasBackendHost, setupComplete } = useSetupStatus()
    expect(hasSource.value).toBe(false)
    expect(hasBackendHost.value).toBe(false)
    expect(setupComplete.value).toBe(false)
  })

  it('stays incomplete with only a backend host', () => {
    useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
    const { setupComplete, hasBackendHost } = useSetupStatus()
    expect(hasBackendHost.value).toBe(true)
    expect(setupComplete.value).toBe(false)
  })

  it('does not count a browser-only source as an indexed catalog', () => {
    useInventoryStore().addSource({ id: 's1', type: 'github' })
    const { setupComplete, hasSource } = useSetupStatus()
    expect(hasSource.value).toBe(false)
    expect(setupComplete.value).toBe(false)
  })

  it('completes once a repository is indexed on the selected backend', () => {
    useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
    indexedSource()
    const { setupComplete } = useSetupStatus()
    expect(setupComplete.value).toBe(true)
  })

  it('does not depend on having projects', () => {
    // No projectStore interaction at all — proves projects are not required.
    useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
    indexedSource()
    expect(useSetupStatus().setupComplete.value).toBe(true)
  })

  it('stays incomplete when a repository has not been indexed', () => {
    useBackendApiStore().addHost({ url: 'http://h1:8000' })
    const inv = useInventoryStore()
    inv.sourcesBackendScope = 'http://h1:8000'
    inv.addSource({ id: 's1', repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] })
    expect(useSetupStatus().setupComplete.value).toBe(false)
  })

  it('does not reuse another backend’s indexed source to complete setup', () => {
    indexedSource()
    useBackendApiStore().addHost({ url: 'http://different:8000' })
    expect(useSetupStatus().setupComplete.value).toBe(false)
  })
})
