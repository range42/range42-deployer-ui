import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { captureCapacityConnection, listCapacityTargets, readHostCapacity } from '@/services/proxmox/capacity'

export const capacity = {
  host_id: 'pve-1', node_name: 'pve01', observed_at: '2026-09-10T12:00:00Z', status: 'available',
  cpu: { logical_cpus: 8, utilization: 0.25 }, memory: { total_bytes: 16 * 1024 ** 3, used_bytes: 4 * 1024 ** 3, free_bytes: 12 * 1024 ** 3 },
  storage: [{ storage: 'local-lvm', type: 'lvmthin', content: ['images'], enabled: true, active: true, shared: false,
    total_bytes: 100 * 1024 ** 3, used_bytes: 25 * 1024 ** 3, free_bytes: 75 * 1024 ** 3 }],
  issues: [], limitations: ['Measurements are not reservations.'],
}
const target = { id: 'pve-1', name: 'Range', node_name: 'pve01', api_url: 'https://pve.test:8006' }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
let backend: ReturnType<typeof useBackendApiStore>, first: string, second: string
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); backend = useBackendApiStore()
  first = backend.addHost({ url: 'https://first.test', token: 'first-token' })
  second = backend.addHost({ url: 'https://second.test', token: 'second-token' })
})
afterEach(() => vi.unstubAllGlobals())

describe('explicit backend capacity requests', () => {
  it('uses the selected saved connection even when another backend is globally active', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(capacity))
    vi.stubGlobal('fetch', fetchMock)
    const result = await readHostCapacity(captureCapacityConnection(second), target)
    expect(result.cpu.logical_cpus).toBe(8)
    expect(fetchMock.mock.calls[0][0]).toBe('https://second.test/v1/proxmox/hosts/pve-1/capacity')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer second-token')
    expect(backend.activeHost?.id).toBe(first)
  })
  it('rejects an edited connection before a request and a rotated token during a response', async () => {
    const captured = captureCapacityConnection(first)
    backend.updateHost(first, { url: 'https://replacement.test' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(readHostCapacity(captured, target)).rejects.toThrow(/connection changed/i)
    expect(fetchMock).not.toHaveBeenCalled()
    const current = captureCapacityConnection(first)
    fetchMock.mockImplementation(async () => { backend.updateHost(first, { token: 'rotated' }); return response({}, 401) })
    await expect(readHostCapacity(current, target)).rejects.toThrow(/connection changed/i)
    expect(backend.getHost(first)?.health?.status).not.toBe('unauthorized')
  })
  it('paginates targets and rejects repeated identities', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ items: [target], total: 2 }))
      .mockResolvedValueOnce(response({ items: [{ ...target, id: 'pve-2' }], total: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listCapacityTargets(captureCapacityConnection(first))).toHaveLength(2)
    expect(fetchMock.mock.calls[1][0]).toContain('offset=1')
    fetchMock.mockImplementation(async () => response({ items: [target], total: 2 }))
    await expect(listCapacityTargets(captureCapacityConnection(first))).rejects.toThrow(/duplicate|repeated/i)
  })
  it('rejects target listings above the bounded picker size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [target], total: 1001 })))
    await expect(listCapacityTargets(captureCapacityConnection(first))).rejects.toThrow(/1,000/)
  })
  it.each([['host_id', 'other'], ['node_name', 'other']])('rejects a response for another %s', async (key, value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...capacity, [key]: value })))
    await expect(readHostCapacity(captureCapacityConnection(first), target)).rejects.toThrow(/target|node/i)
  })
  it('preserves partial/unknown and actual zero values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...capacity, status: 'partial',
      cpu: { logical_cpus: null, utilization: null }, memory: { total_bytes: null, used_bytes: null, free_bytes: 0 },
      storage: [], issues: [{ code: 'CPU_CAPACITY_UNKNOWN', resource: 'cpu', message: 'CPU unavailable' }] })))
    const result = await readHostCapacity(captureCapacityConnection(first), target)
    expect(result.memory.free_bytes).toBe(0)
    expect(result.cpu.logical_cpus).toBeNull()
    expect(result.status).toBe('partial')
  })
  it.each([true, -1, '8'])('rejects invalid measurements %j rather than displaying invented values', async logical_cpus => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...capacity, cpu: { ...capacity.cpu, logical_cpus } })))
    await expect(readHostCapacity(captureCapacityConnection(first), target)).rejects.toThrow(/invalid capacity/i)
  })
  it('explains missing support and records authentication errors only for the requested backend', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ detail: 'Not Found' }, 404)).mockResolvedValueOnce(response({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readHostCapacity(captureCapacityConnection(second), target)).rejects.toThrow(/update.*backend|does not support/i)
    await expect(readHostCapacity(captureCapacityConnection(second), target)).rejects.toThrow(/token/i)
    expect(backend.getHost(second)?.health?.status).toBe('unauthorized')
    expect(backend.getHost(first)?.health).toBeUndefined()
  })
})
