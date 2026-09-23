import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'
import { loadRuntimeConfig } from '@/services/runtimeConfig.ts'

const KEY = 'range42_backend_api'

describe('loadRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed config when /config.json is served', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          defaultBackendUrl: 'http://192.168.142.191:8000',
          defaultNodeName: 'pve',
        }),
      }),
    )

    const cfg = await loadRuntimeConfig()

    expect(cfg).toEqual({
      defaultBackendUrl: 'http://192.168.142.191:8000',
      defaultNodeName: 'pve',
    })
  })

  it('returns null when /config.json is absent (npm run dev, no bundle)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    expect(await loadRuntimeConfig()).toBeNull()
  })

  it('returns null when /config.json is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }),
    )

    expect(await loadRuntimeConfig()).toBeNull()
  })

  it('returns null when the network call itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await loadRuntimeConfig()).toBeNull()
  })
})

describe('backendApiStore — seedDefaultHost', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('registers the bundle-provided backend on a fresh install and activates it', () => {
    const s = useBackendApiStore()

    s.seedDefaultHost({
      defaultBackendUrl: 'http://192.168.142.191:8000',
      defaultNodeName: 'pve',
    })

    expect(s.hosts).toHaveLength(1)
    expect(s.hosts[0].url).toBe('http://192.168.142.191:8000')
    expect(s.hosts[0].nodeName).toBe('pve')
    expect(s.activeHost?.url).toBe('http://192.168.142.191:8000')
  })

  it('leaves an operator-configured host untouched', () => {
    const s = useBackendApiStore()
    s.addHost({ url: 'http://my-own-backend:8000', nodeName: 'pve02' })

    s.seedDefaultHost({ defaultBackendUrl: 'http://192.168.142.191:8000' })

    expect(s.hosts).toHaveLength(1)
    expect(s.hosts[0].url).toBe('http://my-own-backend:8000')
  })

  it('does not re-add the default after the operator deleted every host', () => {
    localStorage.setItem(KEY, JSON.stringify({ hosts: [], activeHostId: null, seeded: true }))
    const s = useBackendApiStore()

    s.seedDefaultHost({ defaultBackendUrl: 'http://192.168.142.191:8000' })

    expect(s.hosts).toEqual([])
  })

  it('ignores a config with no usable backend url', () => {
    const s = useBackendApiStore()

    s.seedDefaultHost(null)
    s.seedDefaultHost({})
    s.seedDefaultHost({ defaultBackendUrl: '   ' })

    expect(s.hosts).toEqual([])
  })

  it('falls back to the default node name when the config omits it', () => {
    const s = useBackendApiStore()

    s.seedDefaultHost({ defaultBackendUrl: 'http://192.168.142.191:8000' })

    expect(s.hosts[0].nodeName).toBe('pve')
  })
})
