import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProxmoxSettingsStore as useGlobalProxmoxSettingsStore } from '../stores/proxmoxSettingsStore.ts'
import { useProxmoxSettingsStore as useProjectProxmoxSettingsStore } from '../composables/useProxmoxSettings.js'

// Regression test for GitHub issue #45: the global (localStorage) Proxmox
// settings store and the per-project (cookie) settings store both used the
// Pinia id 'proxmoxSettings', which made them clobber the same state slot.
beforeEach(() => {
  localStorage.clear()
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.replace(/=.*/, '=;path=/;max-age=0')
  })
  setActivePinia(createPinia())
})

describe('Proxmox settings stores have distinct Pinia ids', () => {
  it('uses different store ids for the global and per-project stores', () => {
    const globalStore = useGlobalProxmoxSettingsStore()
    const projectStore = useProjectProxmoxSettingsStore()

    expect(globalStore.$id).toBe('proxmoxSettings')
    expect(projectStore.$id).toBe('proxmoxProjectSettings')
    expect(globalStore.$id).not.toBe(projectStore.$id)
  })

  it('keeps state independent between the two stores', () => {
    const globalStore = useGlobalProxmoxSettingsStore()
    const projectStore = useProjectProxmoxSettingsStore()

    // Global store: single-set connection settings.
    globalStore.setBaseUrl('https://pve.example:8006')
    expect(globalStore.baseUrl).toBe('https://pve.example:8006')

    // Per-project store: keyed-by-project map. The shapes are unrelated;
    // mutating one must not affect the other.
    projectStore.saveProjectSettings('proj-1', {
      backendApiUrl: 'http://127.0.0.1:8000',
      proxmoxNode: 'pve',
    })

    expect(projectStore.getProjectSettings('proj-1')?.proxmoxNode).toBe('pve')
    // Global store remains untouched by the per-project write.
    expect(globalStore.baseUrl).toBe('https://pve.example:8006')
  })
})
