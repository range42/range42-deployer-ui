import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { backendRequest, backendBlob } from '@/services/backendApi'

const response = (status, body = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
let backend
let fetchMock
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  backend = useBackendApiStore()
  backend.addHost({ url: 'https://lab.test', nodeName: 'pve01' })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('backend authentication', () => {
  it('downloads protected JSONL as a blob with the selected backend token', async () => {
    backend.setToken('operator-secret')
    fetchMock.mockResolvedValue(new Response('{"event_seq":1}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const blob = await backendBlob('/v1/deployments/dep/events/download')
    const text = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(blob)
    })
    expect(text).toBe('{"event_seq":1}\n')
    expect(fetchMock.mock.calls[0][0]).toBe('https://lab.test/v1/deployments/dep/events/download')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer operator-secret')
  })

  it('identifies a missing token separately from backend readiness', async () => {
    fetchMock.mockResolvedValue(response(401))
    expect((await backend.testConnection()).status).toBe('unauthorized')
    expect(backend.requiresAuthentication).toBe(true)
  })

  it('recognizes forbidden access without reporting readiness degradation', async () => {
    fetchMock.mockResolvedValue(response(403))
    expect((await backend.testConnection()).status).toBe('forbidden')
  })

  it('turns a protected endpoint rejection into an actionable connection state', async () => {
    fetchMock.mockResolvedValue(response(401))
    await expect(backendRequest('/v1/catalog/sources/default', { method: 'POST' })).rejects.toThrow('backend API token')
    expect(backend.requiresAuthentication).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not let an old unauthenticated response invalidate a corrected token', async () => {
    let finish
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const result = backendRequest('/v1/catalog/sources').catch(error => error)
    backend.setToken('corrected')
    finish(response(401))
    await result
    expect(backend.requiresAuthentication).toBe(false)
  })

  it('checks a token before saving it and uses it for subsequent catalog requests', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { ready: true }))
    await backend.connectToken(' operator-secret ')
    expect(backend.token).toBe('operator-secret')
    expect(backend.health.status).toBe('ok')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer operator-secret')
    fetchMock.mockResolvedValueOnce(response(200, { items: [] }))
    await backendRequest('/v1/catalog/sources')
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer operator-secret')
  })

  it('keeps a rejected token out of persistent browser storage', async () => {
    fetchMock.mockResolvedValue(response(401))
    await expect(backend.connectToken('invalid-secret')).rejects.toThrow('token')
    expect(backend.token).toBeUndefined()
    expect(localStorage.getItem('range42_backend_api')).not.toContain('invalid-secret')
  })

  it('does not save a candidate token after switching backends during verification', async () => {
    let finish
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const result = backend.connectToken('candidate-secret').catch(error => error)
    backend.setActiveHost(backend.addHost({ url: 'https://other.test' }))
    finish(response(200, { ready: true }))
    expect((await result).message).toMatch(/changed/)
    expect(backend.token).toBeUndefined()
    expect(localStorage.getItem('range42_backend_api')).not.toContain('candidate-secret')
  })
})
