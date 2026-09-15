/** Read-only, credential-filtered SDN planning inventory. */
import { backendRequest } from './backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface State { state: string | null; has_pending: boolean }
export interface SdnZone extends State { zone: string; type: string; nodes: string[] }
export interface SdnVnet extends State { vnet: string; zone: string }
export interface SdnSubnet extends State { subnet: string; vnet: string; cidr: string; gateway: string | null; snat: boolean }
export interface SdnHost { id: string; name: string; node_name: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const state = (value: Record<string, unknown>) => typeof value.has_pending === 'boolean' && (value.state === null || typeof value.state === 'string')
const zone = (value: unknown): value is SdnZone => record(value) && id(value.zone) && typeof value.type === 'string' && value.type.length > 0 && Array.isArray(value.nodes) && value.nodes.every(id) && state(value)
const vnet = (value: unknown): value is SdnVnet => record(value) && id(value.vnet) && id(value.zone) && state(value)
const subnet = (value: unknown): value is SdnSubnet => record(value) && typeof value.subnet === 'string' && value.subnet.length > 0 && id(value.vnet) && typeof value.cidr === 'string' && (value.gateway === null || typeof value.gateway === 'string') && typeof value.snat === 'boolean' && state(value)
const host = (value: unknown): value is SdnHost => record(value) && id(value.id) && typeof value.name === 'string' && typeof value.node_name === 'string'
function invalid(): never { throw new Error('SDN inventory is invalid or incomplete. Refresh before choosing network settings.') }

export function createSdnInventoryClient() {
  const backend = useBackendApiStore(), url = backend.url, token = backend.token, backendId = backend.activeHost?.id
  function guard() {
    if (!url || backend.url !== url || backend.token !== token || backend.activeHost?.id !== backendId) throw new Error('Backend connection changed. Refresh the SDN inventory.')
  }
  async function list<T>(path: string, valid: (value: unknown) => value is T, key: (value: T) => string, sdn = true): Promise<T[]> {
    const result: T[] = [], seen = new Set<string>()
    let expectedTotal: number | null = null
    while (true) {
      guard()
      const body = await backendRequest<unknown>(`${path}?${sdn ? 'view=pending&' : ''}offset=${result.length}&limit=100`)
      guard()
      if (!record(body) || !Array.isArray(body.items) || body.items.length > 100 || !Number.isSafeInteger(body.total) || Number(body.total) < 0 || Number(body.total) > 4096
        || body.offset !== result.length || body.limit !== 100 || (sdn && (body.view !== 'pending' || body.visibility !== 'credential_filtered'))
        || (expectedTotal !== null && body.total !== expectedTotal)) invalid()
      expectedTotal = Number(body.total)
      for (const value of body.items) {
        if (!valid(value) || seen.has(key(value))) invalid()
        seen.add(key(value)); result.push(value)
      }
      if (result.length === expectedTotal) return result
      if (!body.items.length || result.length > expectedTotal) invalid()
    }
  }
  const base = (hostId: string) => { if (!id(hostId)) invalid(); return `/v1/proxmox/hosts/${encodeURIComponent(hostId)}/sdn` }
  return { guard,
    hosts: () => list('/v1/proxmox/hosts', host, row => row.id, false),
    zones: (hostId: string) => list(`${base(hostId)}/zones`, zone, row => row.zone),
    vnets: (hostId: string) => list(`${base(hostId)}/vnets`, vnet, row => row.vnet),
    async subnets(hostId: string, vnetId: string) {
      if (!id(vnetId)) invalid()
      const rows = await list(`${base(hostId)}/vnets/${encodeURIComponent(vnetId)}/subnets`, subnet, row => row.subnet)
      if (rows.some(row => row.vnet !== vnetId)) invalid()
      return rows
    },
  }
}
