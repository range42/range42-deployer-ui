import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useCatalogSources } from '@/composables/useCatalogSources'

const cache = vi.hoisted(() => ({ clear: vi.fn() }))
vi.mock('@/composables/useCatalog', () => ({ clearCatalogCache: cache.clear }))
const scope = 'https://backend.example'
const source = { id: 'source', provider: 'github', base_url: 'https://github.com', auth_kind: 'none', has_token: false, repos: [{ owner: 'old', repo: 'catalog', branch: 'main' }] }
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const outcome = promise => promise.then(() => ({ success: true }), error => ({ error: error.message }))
let backend, inventory, api, host
function replaceContext(kind = 'token') {
  if (kind === 'host') {
    const other = backend.addHost({ url: scope, token: 'first-token' })
    backend.setActiveHost(other)
  } else backend.updateHost(host, { token: 'replacement-token' })
  inventory.syncSources([{ ...source, name: 'Replacement source', backend_url: scope, auth: { kind: 'none' },
    repos: [{ owner: 'replacement', repo: 'catalog', branch: 'main' }], health: { status: 'ok', checked_at: 'replacement' } }], scope)
  return JSON.stringify(inventory.sources)
}
function start(action) {
  if (action === 'createSource') return api.createSource({ provider: 'github', base_url: source.base_url, auth_kind: 'none', repos: source.repos })
  if (action === 'connectDefault') return api.connectDefault()
  if (action === 'rotateToken') return api.rotateToken('source', 'provider-token')
  return api[action]('source')
}
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia())
  backend = useBackendApiStore(); host = backend.addHost({ url: scope, token: 'first-token' })
  inventory = useInventoryStore(); api = useCatalogSources()
  inventory.syncSources([{ ...source, name: 'Original', backend_url: scope, auth: { kind: 'none' } }], scope)
  cache.clear.mockReset(); cache.clear.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('source operations retain their backend and credential context', () => {
  it.each(['createSource', 'connectDefault', 'rotateToken', 'deleteSource', 'refreshSource'])('rejects %s completion after credentials change during the response', async action => {
    const pending = deferred(); fetch.mockReturnValueOnce(pending.promise)
    const result = outcome(start(action))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const replacement = replaceContext()
    pending.resolve(response({ ...source, source_id: 'source', repos_seen: 1, entries_indexed: 3, finished_at: 'old-response' }, action === 'deleteSource' ? 204 : 200))
    expect(await result).toEqual({ error: expect.stringMatching(/backend or credential changed/i) })
    expect(JSON.stringify(inventory.sources)).toBe(replacement)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer first-token')
    expect(cache.clear).toHaveBeenCalledTimes(2)
  })

  it.each(['createSource', 'deleteSource', 'refreshSource'])('rejects %s completion after credentials change during final cache cleanup', async action => {
    const cleanup = deferred()
    cache.clear.mockResolvedValueOnce(undefined).mockReturnValueOnce(cleanup.promise)
    fetch.mockResolvedValue(response({ ...source, source_id: 'source', repos_seen: 1, entries_indexed: 3, finished_at: 'old-response' }, action === 'deleteSource' ? 204 : 200))
    const result = outcome(start(action))
    await vi.waitFor(() => expect(cache.clear).toHaveBeenCalledTimes(2))
    const replacement = replaceContext()
    cleanup.resolve()
    expect(await result).toEqual({ error: expect.stringMatching(/backend or credential changed/i) })
    expect(JSON.stringify(inventory.sources)).toBe(replacement)
  })

  it('does not dispatch when the active host changes during initial cache cleanup even with the same URL and token', async () => {
    const cleanup = deferred(); cache.clear.mockReturnValueOnce(cleanup.promise)
    fetch.mockResolvedValue(response({}, 204))
    const result = outcome(api.deleteSource('source'))
    const replacement = replaceContext('host'); cleanup.resolve()
    expect(await result).toEqual({ error: expect.stringMatching(/backend or credential changed/i) })
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(inventory.sources)).toBe(replacement)
  })

  it('does not mark the replacement source down when an old refresh fails', async () => {
    const pending = deferred(); fetch.mockReturnValueOnce(pending.promise)
    const result = outcome(api.refreshSource('source'))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const replacement = replaceContext()
    pending.resolve(response({ message: 'Old source failure' }, 500))
    expect(await result).toEqual({ error: expect.stringMatching(/backend or credential changed/i) })
    expect(JSON.stringify(inventory.sources)).toBe(replacement)
  })

  it.each(['token', 'host'])('rejects a source page after %s changes without dispatching another page', async kind => {
    const body = deferred()
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise })
      .mockResolvedValueOnce(response({ items: [{ ...source, id: 'second' }], total: 2 }))
    const result = outcome(api.loadSources())
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const replacement = replaceContext(kind)
    body.resolve({ items: [source], total: 2 })
    expect(await result).toEqual({ error: expect.stringMatching(/backend or credential changed/i) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(inventory.sources)).toBe(replacement)
    expect(api.loading.value).toBe(false)
  })

  it('still loads all pages atomically for an unchanged context', async () => {
    fetch.mockResolvedValueOnce(response({ items: [source], total: 2 }))
      .mockResolvedValueOnce(response({ items: [{ ...source, id: 'second' }], total: 2 }))
    await api.loadSources()
    expect(inventory.sources.map(row => row.id)).toEqual(['source', 'second'])
    expect(fetch.mock.calls[1][0]).toBe(scope + '/v1/catalog/sources?offset=1')
    expect(fetch.mock.calls.every(([, init]) => init.headers.Authorization === 'Bearer first-token')).toBe(true)
    expect(api.loading.value).toBe(false)
  })
})
