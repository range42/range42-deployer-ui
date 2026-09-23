import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { createSdnInventoryClient } from '@/services/sdnInventory'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/backendApi', () => ({ backendRequest: request }))
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); useBackendApiStore().addHost({ url: 'https://backend.test', token: 'fixture' }); request.mockReset() })
const zone = (name: string) => ({ zone: name, type: 'simple', nodes: [], has_pending: false, state: null })
const page = (items: unknown[], total = items.length, offset = 0) => ({ items, total, offset, limit: 100, view: 'pending', visibility: 'credential_filtered' })
describe('SDN inventory client', () => {
  it('follows every page with captured backend credentials and preserves pending state', async () => {
    request.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => zone(`zone${i}`)), 101))
      .mockResolvedValueOnce(page([{ ...zone('last'), has_pending: true, state: 'changed' }], 101, 100))
    const result = await createSdnInventoryClient().zones('host')
    expect(result).toHaveLength(101)
    expect(result[100].has_pending).toBe(true)
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/proxmox/hosts/host/sdn/zones?view=pending&offset=0&limit=100', '/v1/proxmox/hosts/host/sdn/zones?view=pending&offset=100&limit=100'])
  })
  it('refuses duplicate pages, malformed membership and mismatched data views', async () => {
    for (const value of [page([zone('x'), zone('x')]), page([{ ...zone('x'), nodes: ['../bad'] }]), { ...page([zone('x')]), view: 'running' }]) {
      request.mockResolvedValueOnce(value)
      await expect(createSdnInventoryClient().zones('host')).rejects.toThrow(/invalid|incomplete/i)
    }
  })
  it('rejects a late response and makes no second page request after backend credentials change', async () => {
    let finish!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const result = createSdnInventoryClient().zones('host')
    const backend = useBackendApiStore(); backend.updateHost(backend.activeHost!.id, { token: 'changed' })
    finish(page(Array.from({ length: 100 }, (_, i) => zone(`zone${i}`)), 101))
    await expect(result).rejects.toThrow(/changed/i)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('normalizes requests only from safe selected host and VNet identifiers', async () => {
    const client = createSdnInventoryClient()
    await expect(client.subnets('host', '../bad')).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(page([{ subnet: 'z-10.0.0.0-24', vnet: 'lab', cidr: '10.0.0.0/24', gateway: '10.0.0.1', snat: false, state: null, has_pending: false }]))
    expect((await client.subnets('host', 'lab'))[0].snat).toBe(false)
  })
})
