/**
 * useProxmoxStorage.setConfig — TemplateBrowser destructures it on mount.
 *
 * The composable reads its config from the settings store, so a component
 * holding the host as props has no other way to make itself configured.
 * Before this existed, `setConfig(...)` in TemplateBrowser's onMounted threw
 * "setConfig is not a function" as soon as the component rendered with an
 * apiUrl (range42-deployer-ui#92).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useProxmoxStorage } from '@/composables/useProxmoxStorage'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'

describe('useProxmoxStorage.setConfig', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('is exported', () => {
    expect(typeof useProxmoxStorage().setConfig).toBe('function')
  })

  it('makes the composable configured', () => {
    const s = useProxmoxStorage()
    expect(s.isConfigured.value).toBe(false)
    s.setConfig('http://10.0.0.5:8000', 'pve01')
    expect(s.isConfigured.value).toBe(true)
  })

  it('writes through to the settings store', () => {
    const store = useProxmoxSettingsStore()
    useProxmoxStorage().setConfig('http://10.0.0.5:8000', 'pve01')
    expect(store.baseUrl).toBe('http://10.0.0.5:8000')
    expect(store.defaultNode).toBe('pve01')
  })

  it('ignores empty values rather than clearing existing config', () => {
    const store = useProxmoxSettingsStore()
    const s = useProxmoxStorage()
    s.setConfig('http://10.0.0.5:8000', 'pve01')
    s.setConfig('', '')
    expect(store.baseUrl).toBe('http://10.0.0.5:8000')
    expect(store.defaultNode).toBe('pve01')
  })
})
