import { backendRequest, getBackendScope } from './backendApi'

export interface ScenarioNic { network_id: string; ip?: string }
export interface ScenarioVm {
  node_id: string; vm_id?: number | string; nics: ScenarioNic[]
  [key: string]: unknown
}
export interface AllocationNetwork {
  id: string; vnet: string; subnet: string; gateway?: string; reserved_ips?: string[]
}
export interface AllocationAssignment {
  node_id: string; vm_id: number
  nics: Array<{ index: number; network_id: string; bridge: string; subnet: string; ip: string; prefix: number; gateway?: string }>
}
export interface ScenarioReservation {
  reservation_id: string; project_key: string; host_id: string; node_name: string
  expires_at: string; checked_at: string; assignments: AllocationAssignment[]; limitations: string[]
}
interface Owner { token: string; reservation_id?: string }
const STORAGE = 'range42_scenario_reservation_owners'
const missing = (value: unknown) => value === '' || value === undefined || value === null
const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const route = (host: string) => `/v1/proxmox/hosts/${encodeURIComponent(host)}/reservations`
const ownerKey = (scope: string, project: string, host: string) => JSON.stringify([scope, host, project])

function owners(): Record<string, Owner> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch { return {} }
}
function saveOwner(key: string, owner: Owner) {
  localStorage.setItem(STORAGE, JSON.stringify({ ...owners(), [key]: owner }))
}
function readOwner(key: string): Owner | null {
  const owner = owners()[key]
  return owner && /^[A-Za-z0-9_-]{32,}$/.test(owner.token) ? owner : null
}
function ensureOwner(key: string): Owner {
  const existing = readOwner(key)
  if (existing) return existing
  const owner = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') }
  // Persist before sending, so an uncertain response can be retried with the same owner.
  saveOwner(key, owner)
  return owner
}
function checkResponse(result: ScenarioReservation, project: string, host: string, scope: string) {
  requireValue(scope === getBackendScope(), 'The selected backend changed; retry on the current backend')
  requireValue(result?.project_key === project && result.host_id === host && result.reservation_id
    && Number.isFinite(Date.parse(result.expires_at)) && Array.isArray(result.assignments), 'Reservation identity does not match this project and target')
}

export async function reserveScenarioAllocation(input: {
  projectKey: string; targetHostId: string; vms: ScenarioVm[]; networks: AllocationNetwork[]
  vmidStart: number; vmidEnd: number
}): Promise<ScenarioReservation> {
  const { projectKey, targetHostId, vms, networks, vmidStart, vmidEnd } = input
  requireValue(projectKey && targetHostId, 'Choose a project and target before reserving')
  requireValue(Number.isInteger(vmidStart) && Number.isInteger(vmidEnd) && vmidStart >= 100
    && vmidEnd <= 999999999 && vmidEnd >= vmidStart, 'Choose a valid VM ID range from 100 to 999999999')
  requireValue(vms.length && networks.length, 'Add VMs and declared subnets before reserving')
  for (const vm of vms) requireValue(missing(vm.vm_id) || (Number.isInteger(Number(vm.vm_id))
    && Number(vm.vm_id) >= 100 && Number(vm.vm_id) <= 999999999), `Invalid manual VM ID for ${vm.node_id}`)
  const body = { project_key: projectKey, vmid_start: vmidStart, vmid_end: vmidEnd,
    networks: networks.map(network => ({ network_id: network.id, bridge: network.vnet, subnet: network.subnet,
      ...(network.gateway ? { gateway: network.gateway } : {}), ...(network.reserved_ips?.length ? { reserved_ips: network.reserved_ips } : {}) })),
    vms: vms.map(vm => ({ node_id: vm.node_id, ...(!missing(vm.vm_id) ? { vm_id: Number(vm.vm_id) } : {}),
      nics: vm.nics.map((nic, index) => ({ index, network_id: nic.network_id, ...(!missing(nic.ip) ? { ip: nic.ip } : {}) })) })),
  }
  const scope = getBackendScope()
  const key = ownerKey(scope, projectKey, targetHostId)
  const owner = ensureOwner(key)
  const result = await backendRequest<ScenarioReservation>(route(targetHostId), {
    method: 'POST', headers: { 'X-Range42-Reservation-Token': owner.token }, body: JSON.stringify(body),
  })
  checkResponse(result, projectKey, targetHostId, scope)
  saveOwner(key, { ...owner, reservation_id: result.reservation_id })
  return result
}

export async function restoreScenarioAllocation(project: string, host: string): Promise<ScenarioReservation | null> {
  const scope = getBackendScope()
  const owner = readOwner(ownerKey(scope, project, host))
  if (!owner?.reservation_id) return null
  const result = await backendRequest<ScenarioReservation>(`${route(host)}/${encodeURIComponent(owner.reservation_id)}`, {
    headers: { 'X-Range42-Reservation-Token': owner.token },
  })
  checkResponse(result, project, host, scope)
  return result
}

export async function releaseScenarioAllocation(project: string, host: string, reservationId: string): Promise<void> {
  const scope = getBackendScope()
  const key = ownerKey(scope, project, host)
  const owner = readOwner(key)
  requireValue(owner?.reservation_id === reservationId, 'This browser does not own that reservation')
  try {
    await backendRequest(`${route(host)}/${encodeURIComponent(reservationId)}`, {
      method: 'DELETE', headers: { 'X-Range42-Reservation-Token': owner!.token },
    })
  } catch (cause) {
    if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'ALLOCATION_EXPIRED') throw cause
  }
  saveOwner(key, { token: owner!.token })
}

/** Never replace a manual value or apply a stale response to different NICs. */
export function applyScenarioAllocation(vms: ScenarioVm[], assignments: AllocationAssignment[]): ScenarioVm[] {
  requireValue(Array.isArray(assignments) && assignments.length === vms.length
    && new Set(assignments.map(vm => vm.node_id)).size === vms.length, 'Assignments no longer match the draft VMs')
  requireValue(new Set(assignments.map(vm => vm.vm_id)).size === assignments.length, 'Duplicate VM ID assignment')
  return vms.map(vm => {
    const assigned = assignments.find(item => item.node_id === vm.node_id)
    requireValue(assigned && Number.isInteger(assigned.vm_id) && assigned.vm_id >= 100
      && assigned.nics?.length === vm.nics.length, 'Assignments no longer match the draft')
    requireValue(missing(vm.vm_id) || Number(vm.vm_id) === assigned!.vm_id, `Reservation would change the manual VM ID for ${vm.node_id}`)
    const nics = vm.nics.map((nic, index) => {
      const value = assigned!.nics.find(item => item.index === index)
      requireValue(value && value.network_id === nic.network_id && value.ip, 'NIC assignments no longer match the draft')
      requireValue(missing(nic.ip) || nic.ip === value!.ip, `Reservation would change a manual IP for ${vm.node_id}`)
      return { ...nic, ip: value!.ip }
    })
    return { ...JSON.parse(JSON.stringify(vm)), vm_id: assigned!.vm_id, nics,
      network_id: nics[0]?.network_id, ip: nics[0]?.ip }
  })
}
