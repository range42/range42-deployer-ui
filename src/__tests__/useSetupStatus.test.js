import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

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

  it('stays incomplete with only a source', () => {
    useInventoryStore().addSource({ id: 's1', type: 'github' })
    const { setupComplete, hasSource } = useSetupStatus()
    expect(hasSource.value).toBe(true)
    expect(setupComplete.value).toBe(false)
  })

  it('completes once a source AND a backend host exist', () => {
    useInventoryStore().addSource({ id: 's1', type: 'github' })
    useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
    const { setupComplete } = useSetupStatus()
    expect(setupComplete.value).toBe(true)
  })

  it('does not depend on having projects', () => {
    // No projectStore interaction at all — proves projects are not required.
    useInventoryStore().addSource({ id: 's1', type: 'github' })
    useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
    expect(useSetupStatus().setupComplete.value).toBe(true)
  })
})
