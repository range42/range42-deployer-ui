/** Measured capacity belongs to one explicitly selected saved backend and target. */
import { useBackendApiStore } from '@/stores/backendApiStore'

export interface CapacityConnection { id: string; url: string; token?: string }
export interface CapacityTarget { id: string; name: string; node_name: string; api_url?: string }
export interface ByteCapacity { total_bytes: number | null; used_bytes: number | null; free_bytes: number | null }
export interface HostCapacity {
  host_id: string
  node_name: string
  observed_at: string
  status: 'available' | 'partial' | 'unavailable'
  cpu: { logical_cpus: number | null; utilization: number | null }
  memory: ByteCapacity
  storage: Array<ByteCapacity & { storage: string; type: string | null; content: string[]; enabled: boolean | null; active: boolean | null; shared: boolean | null }>
  issues: Array<{ code: string; resource: string; message: string }>
  limitations: string[]
}

function currentConnection(connection: CapacityConnection): void {
  const current = useBackendApiStore().getHost(connection.id)
  if (!current || current.url !== connection.url || current.token !== connection.token) {
    throw new Error('The backend connection changed. Load capacity again for the selected connection.')
  }
}

export function captureCapacityConnection(backendId: string): CapacityConnection {
  const host = useBackendApiStore().getHost(backendId)
  if (!host) throw new Error('Choose a saved backend connection before loading capacity.')
  const url = new URL(host.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The saved backend URL must be an HTTP(S) address without credentials, a query or a fragment.')
  }
  return { id: host.id, url: host.url, token: host.token }
}

async function request(connection: CapacityConnection, path: string, signal?: AbortSignal): Promise<unknown> {
  currentConnection(connection)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${connection.url.replace(/\/+$/, '')}${path}`, {
      method: 'GET', credentials: 'same-origin', signal: controller.signal,
      headers: { Accept: 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
    })
    currentConnection(connection)
    const data = await response.json().catch(() => null)
    currentConnection(connection)
    if (!response.ok) {
      if (response.status === 401) {
        useBackendApiStore().recordAuthFailure(connection.id, connection.url, connection.token)
        throw new Error('The backend API token was rejected. Update this connection’s token in Settings, then refresh.')
      }
      if (response.status === 403) throw new Error('Capacity access was denied. Check this backend token’s permissions.')
      if (response.status === 404) {
        if (isRecord(data) && data.code === 'NOT_FOUND') throw new Error('The selected Proxmox target is no longer registered. Reload the target list.')
        throw new Error('This backend does not support capacity reporting. Update the backend before using this panel.')
      }
      throw new Error(`The backend could not report capacity (HTTP ${response.status}). Check its health and refresh.`)
    }
    return data
  } catch (error) {
    currentConnection(connection)
    if (controller.signal.aborted && !signal?.aborted) throw new Error('The capacity request timed out. Check the backend connection and refresh.')
    if (error instanceof TypeError) throw new Error('The backend could not be reached. Check its URL, connectivity and browser access settings.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const bytes = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
const flag = (value: unknown): boolean => value === null || typeof value === 'boolean'
function byteCapacity(value: unknown): boolean {
  return isRecord(value) && bytes(value.total_bytes) && bytes(value.used_bytes) && bytes(value.free_bytes)
    && (value.total_bytes === null || ((value.used_bytes === null || Number(value.used_bytes) <= Number(value.total_bytes))
      && (value.free_bytes === null || Number(value.free_bytes) <= Number(value.total_bytes))))
}

export async function listCapacityTargets(connection: CapacityConnection, signal?: AbortSignal): Promise<CapacityTarget[]> {
  const targets: CapacityTarget[] = []
  while (targets.length < 1000) {
    const page = await request(connection, `/v1/proxmox/hosts?offset=${targets.length}&limit=100`, signal)
    if (!isRecord(page) || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) {
      throw new Error('The backend returned an invalid target list. Check its version and refresh.')
    }
    if (Number(page.total) > 1000 || targets.length + page.items.length > 1000) {
      throw new Error('This backend has more than 1,000 targets. Narrow its host registrations before using this panel.')
    }
    for (const item of page.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.node_name !== 'string' || !item.node_name) {
        throw new Error('The backend returned an invalid Proxmox target. Check its host registration.')
      }
      if (targets.some(target => target.id === item.id)) throw new Error('The backend target list contains duplicate identities. Refresh after checking its host registrations.')
      targets.push({ id: item.id, node_name: item.node_name, name: typeof item.name === 'string' ? item.name : item.id,
        ...(typeof item.api_url === 'string' ? { api_url: item.api_url } : {}) })
    }
    if (targets.length >= Number(page.total)) return targets
    if (!page.items.length) throw new Error('The backend target list ended before all targets were returned. Refresh the list.')
  }
  throw new Error('This backend has more than 1,000 targets. Narrow its host registrations before using this panel.')
}

export async function readHostCapacity(connection: CapacityConnection, target: CapacityTarget, signal?: AbortSignal): Promise<HostCapacity> {
  const value = await request(connection, `/v1/proxmox/hosts/${encodeURIComponent(target.id)}/capacity`, signal)
  if (!isRecord(value) || value.host_id !== target.id || value.node_name !== target.node_name) {
    throw new Error('Capacity was returned for a different target or node. Reload the selected target.')
  }
  const cpu = value.cpu
  if (!['available', 'partial', 'unavailable'].includes(String(value.status)) || typeof value.observed_at !== 'string'
    || !Number.isFinite(Date.parse(value.observed_at)) || !isRecord(cpu)
    || !(cpu.logical_cpus === null || (typeof cpu.logical_cpus === 'number' && Number.isSafeInteger(cpu.logical_cpus) && cpu.logical_cpus > 0))
    || !(cpu.utilization === null || (typeof cpu.utilization === 'number' && Number.isFinite(cpu.utilization) && cpu.utilization >= 0 && cpu.utilization <= 1))
    || !byteCapacity(value.memory) || !Array.isArray(value.storage) || value.storage.some(pool => !isRecord(pool)
      || typeof pool.storage !== 'string' || !pool.storage || !(pool.type === null || typeof pool.type === 'string')
      || !strings(pool.content) || !flag(pool.active) || !flag(pool.enabled) || !flag(pool.shared) || !byteCapacity(pool))
    || new Set(value.storage.map(pool => pool.storage)).size !== value.storage.length
    || !Array.isArray(value.issues) || value.issues.some(issue => !isRecord(issue)
      || typeof issue.code !== 'string' || typeof issue.resource !== 'string' || typeof issue.message !== 'string')
    || !strings(value.limitations)) {
    throw new Error('The backend returned invalid capacity data. Check its version and refresh.')
  }
  return value as unknown as HostCapacity
}
