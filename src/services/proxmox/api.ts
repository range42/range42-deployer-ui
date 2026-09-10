/**
 * Proxmox API Client
 * 
 * Unified API client for all Proxmox backend interactions.
 * All requests go through the backend-api, which then uses Ansible
 * to communicate with Proxmox.
 */

import { getActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'

import type {
  ApiResponse,
  ApiError,
  ProxmoxNode,
  // VM types
  VmCreateRequest,
  VmListItem,
  VmActionRequest,
  VmCloneRequest,
  VmSnapshotRequest,
  VmActionResult,
  TaskStatus,
  // LXC types
  LxcCreateRequest,
  // Network types
  VmNetworkAddRequest,
  NodeNetworkAddRequest,
  NodeNetwork,
  NetworkInterface,
  // Firewall types
  FirewallRuleAddRequest,
  FirewallRule,
  FirewallAlias,
  // Storage types
  IsoInfo,
  TemplateInfo,
  StorageDownloadIsoRequest,
} from './types'

// =============================================================================
// Configuration
// =============================================================================

let baseUrl = ''

/**
 * Default Ansible params injected into every backend request.
 * The backend requires `hosts` and `inventory` for ansible-runner,
 * but these are server-side concerns the UI shouldn't need to know about.
 */
const ANSIBLE_DEFAULTS = { hosts: 'px-testing', inventory: 'hosts.yml' }

/**
 * Set the backend API base URL
 */
export function setBaseUrl(url: string): void {
  // Remove trailing slash if present
  baseUrl = url.replace(/\/+$/, '')
  // The registered-host lookup is per-backend; a base-URL change may point at a
  // different backend, so the memoized host id must not leak across.
  _hostCache = null
}

/**
 * Get the current base URL
 */
export function getBaseUrl(): string {
  return baseUrl
}

// =============================================================================
// HTTP Client
// =============================================================================

class ProxmoxApiError extends Error implements ApiError {
  status: number
  details?: string

  constructor(status: number, message: string, details?: string) {
    super(message)
    this.name = 'ProxmoxApiError'
    this.status = status
    this.details = details
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!baseUrl) {
    throw new ProxmoxApiError(0, 'API base URL not configured. Call setBaseUrl() first.')
  }

  const url = `${baseUrl}${endpoint}`
  
  const host = getActivePinia()
    ? useBackendApiStore().hosts.find(candidate => candidate.url.replace(/\/+$/, '') === baseUrl)
    : undefined
  const defaultHeaders: HeadersInit = {
    ...(host?.token ? { Authorization: `Bearer ${host.token}` } : {}),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }

  const config: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }

  try {
    const response = await fetch(url, config)
    
    // Try to parse JSON response
    let data: unknown
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      data = await response.json()
    } else {
      // Some endpoints return plain text
      data = await response.text()
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      if (typeof data === 'object' && data !== null && 'detail' in data) {
        const detail = (data as Record<string, unknown>).detail
        if (Array.isArray(detail)) {
          // Pydantic validation errors: [{field, msg, type}]
          errorMessage = detail.map((e: Record<string, unknown>) =>
            `${e.field || e.loc || 'unknown'}: ${e.msg || e.message || 'validation error'}`
          ).join('; ')
        } else {
          errorMessage = String(detail)
        }
      } else if (typeof data === 'object' && data !== null && 'message' in data) {
        errorMessage = String((data as Record<string, unknown>).message)
      }

      throw new ProxmoxApiError(response.status, errorMessage, JSON.stringify(data))
    }

    return data as T
  } catch (error) {
    if (error instanceof ProxmoxApiError) {
      throw error
    }
    
    // Network error or other fetch failure
    throw new ProxmoxApiError(
      0,
      error instanceof Error ? error.message : 'Network request failed',
      String(error)
    )
  }
}

// Helper for POST requests
async function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

// Helper for POST with ansible defaults injected (read operations)
async function query<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  return post<T>(endpoint, { ...ANSIBLE_DEFAULTS, ...params })
}

// Helper for write operations — injects ansible defaults AND checks rc for Ansible failures
async function command<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const result = await post<T>(endpoint, { ...ANSIBLE_DEFAULTS, ...body })
  const data = result as unknown as { rc?: number; log_multiline?: string[]; log_plain?: string }
  if (data.rc !== undefined && data.rc !== 0) {
    // Extract meaningful error from Ansible logs
    const logs = data.log_multiline || []
    const fatalLine = logs.find(l => l.includes('fatal:') || l.includes('FAILED'))
    const msgMatch = fatalLine?.match(/"msg":\s*"([^"]+)"/)
    const errorMsg = msgMatch?.[1]
      || fatalLine?.replace(/^.*fatal:\s*\[.*?\]:\s*FAILED!\s*=>\s*/, '').slice(0, 200)
      || `Ansible failed with rc=${data.rc}`
    throw new ProxmoxApiError(data.rc, errorMsg, logs.slice(-8).join('\n'))
  }
  return result
}

// Helper for DELETE requests
async function del<T>(endpoint: string, body?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  })
}

// =============================================================================
// VM API
// =============================================================================

// ---------------------------------------------------------------------------
// v1 Proxmox host resolution + VM management (direct API via registered host)
// ---------------------------------------------------------------------------

interface V1Vm {
  vmid: number
  name?: string
  type: 'qemu' | 'lxc'
  status: string
  node: string
  maxmem?: number
  maxcpu?: number
  uptime?: number
  template?: boolean
  tags?: string
}

let _hostCache: { id: string; node_name: string } | null = null

/** Test seam: clear the memoized registered-host lookup. */
export function _resetHostCacheForTests(): void {
  _hostCache = null
}

/**
 * Resolve the single registered Proxmox host (id + node_name) from the v1 API.
 * Memoized for the session. This is the single source of truth — callers no
 * longer pass a (often stale) node name; v1 uses the registered host's node.
 */
export async function getRegisteredHost(): Promise<{ id: string; node_name: string }> {
  if (_hostCache) return _hostCache
  const raw = await request<{ items?: Array<{ id: string; node_name: string }> }>(
    '/v1/proxmox/hosts',
    { method: 'GET' },
  )
  const host = raw.items?.[0]
  if (!host?.id) {
    throw new ProxmoxApiError(0, 'No Proxmox host registered. Add one in Settings → Proxmox.')
  }
  _hostCache = { id: host.id, node_name: host.node_name }
  return _hostCache
}

function normalizeVmV1(v: V1Vm): VmListItem {
  return {
    vmid: v.vmid,
    name: v.name ?? `vm-${v.vmid}`,
    status: v.status as VmListItem['status'],
    isTemplate: !!v.template,
    tags: v.tags ?? '',
    mem: 0, // current usage is not part of the v1 list payload
    maxmem: v.maxmem ?? 0,
    cpu: 0,
    maxcpu: v.maxcpu ?? 1,
    uptime: v.uptime ?? 0,
    node: v.node as ProxmoxNode,
    type: v.type,
  }
}

async function listHostVms(): Promise<V1Vm[]> {
  const { id } = await getRegisteredHost()
  const raw = await request<{ items?: V1Vm[] }>(
    `/v1/proxmox/hosts/${id}/vms`,
    { method: 'GET' },
  )
  return raw.items ?? []
}

/** Fetch the raw PVE guest config (net0/net1/ipconfig*, ...) through v1. The
 * v1 VM list omits per-NIC detail, so import uses this to rebuild edges (#79). */
async function getHostVmConfig(
  vmId: number | string,
  vmtype: 'qemu' | 'lxc' = 'qemu',
): Promise<Record<string, unknown>> {
  const { id } = await getRegisteredHost()
  const raw = await request<{ config?: Record<string, unknown> }>(
    `/v1/proxmox/hosts/${id}/vms/${vmId}/config?vmtype=${vmtype}`,
    { method: 'GET' },
  )
  return raw.config ?? {}
}

/** POST a Proxmox status action through v1 (host resolved internally). */
async function vmStatusAction(
  vmId: number | string,
  action: string,
  vmtype: 'qemu' | 'lxc' = 'qemu',
): Promise<ApiResponse> {
  const { id } = await getRegisteredHost()
  return request<ApiResponse>(
    `/v1/proxmox/hosts/${id}/vms/${vmId}/status/${action}?vmtype=${vmtype}`,
    { method: 'POST' },
  )
}

/** DELETE a VM or LXC container through v1. */
async function vmDelete(
  vmId: number | string,
  options: { vmtype?: 'qemu' | 'lxc'; purge?: boolean } = {},
): Promise<VmActionResult> {
  if (typeof vmId === 'object' && vmId !== null) {
    throw new Error('vmDelete: vmId must be a number or string. Pass the numeric vmId directly.')
  }
  const { vmtype = 'qemu', purge = true } = options
  const { id } = await getRegisteredHost()
  return request<VmActionResult>(
    `/v1/proxmox/hosts/${id}/vms/${vmId}?vmtype=${vmtype}&purge=${purge}`,
    { method: 'DELETE' },
  )
}

/** Poll task status for an async Proxmox operation (identified by UPID). */
export async function getTaskStatus(upid: string): Promise<TaskStatus> {
  const { id } = await getRegisteredHost()
  return request<TaskStatus>(
    `/v1/proxmox/hosts/${id}/tasks/${encodeURIComponent(upid)}/status`,
    { method: 'GET' },
  )
}

export const vm = {
  /**
   * List qemu VMs on the registered host (v1, direct API). The `node` arg is
   * retained for signature compatibility but ignored — v1 uses the host's node.
   */
  async list(_node: ProxmoxNode): Promise<VmListItem[]> {
    return (await listHostVms()).filter((v) => v.type === 'qemu').map(normalizeVmV1)
  },

  /**
   * Alias of list() — v1 returns the same payload (no separate usage call).
   */
  async listUsage(node: ProxmoxNode): Promise<VmListItem[]> {
    return this.list(node)
  },

  /**
   * Raw PVE guest config (net0/net1/ipconfig*, ...) for import NIC/edge
   * reconstruction (#79). The v1 VM list omits per-NIC detail.
   */
  async getConfig(
    vmId: number | string,
    vmtype: 'qemu' | 'lxc' = 'qemu',
  ): Promise<Record<string, unknown>> {
    return getHostVmConfig(vmId, vmtype)
  },

  /**
   * Create a new VM
   */
  async create(request: VmCreateRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/create', request as unknown as Record<string, unknown>)
  },

  /**
   * Clone an existing VM
   */
  async clone(request: VmCloneRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/clone', request as unknown as Record<string, unknown>)
  },

  /**
   * Delete a VM (v1).
   */
  async delete(
    vmId: number | string,
    options: { purge?: boolean } = {},
  ): Promise<VmActionResult> {
    return vmDelete(vmId, { vmtype: 'qemu', ...options })
  },

  /**
   * Start a VM (v1).
   */
  async start(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'start', request.vmtype)
  },

  /**
   * Stop a VM gracefully — ACPI shutdown (v1).
   */
  async stop(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'shutdown', request.vmtype)
  },

  /**
   * Force stop a VM — hard power-off (v1).
   */
  async stopForce(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'stop', request.vmtype)
  },

  /**
   * Pause (suspend) a VM (v1).
   */
  async pause(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'suspend', request.vmtype)
  },

  /**
   * Resume a paused VM (v1).
   */
  async resume(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'resume', request.vmtype)
  },

  /**
   * Set VM tags
   */
  async setTags(node: ProxmoxNode, vmId: number, tags: string[]): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/vm_set_tag', {
      proxmox_node: node,
      vm_id: String(vmId),
      vm_tag_name: tags.join(','),
    })
  },

  /**
   * Set VM name
   */
  async setName(node: ProxmoxNode, vmId: number, name: string): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/vm_set_name', {
      proxmox_node: node,
      vm_id: String(vmId),
      vm_name: name,
    })
  },

  /**
   * Set VM description
   */
  async setDescription(node: ProxmoxNode, vmId: number, description: string): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/vm_set_description', {
      proxmox_node: node,
      vm_id: String(vmId),
      vm_description: description,
    })
  },

  /**
   * Set VM CPU cores
   */
  async setCpu(node: ProxmoxNode, vmId: number, cores: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/vm_set_cpu', {
      proxmox_node: node,
      vm_id: String(vmId),
      vm_cores: cores,
    })
  },

  /**
   * Set VM memory (MB)
   */
  async setMemory(node: ProxmoxNode, vmId: number, memory: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/vm_set_memory', {
      proxmox_node: node,
      vm_id: String(vmId),
      vm_memory: memory,
    })
  },
}

// =============================================================================
// Snapshot API
// =============================================================================

async function snapshotPath(vmId: number | string, suffix = ''): Promise<string> {
  const { id } = await getRegisteredHost()
  return `/v1/proxmox/hosts/${id}/vms/${vmId}/snapshots${suffix}`
}

export const snapshot = {
  async create(input: VmSnapshotRequest): Promise<VmActionResult> {
    return post(`${await snapshotPath(input.vm_id)}?vmtype=${input.vmtype ?? 'qemu'}`, {
      snapname: input.vm_snapshot_name,
      description: input.vm_snapshot_description,
      vmstate: input.vmstate,
    })
  },

  async list(_node: ProxmoxNode, vmId: number, vmtype: 'qemu' | 'lxc' = 'qemu'): Promise<unknown[]> {
    const data = await request<{ items: unknown[] }>(
      `${await snapshotPath(vmId)}?vmtype=${vmtype}`, { method: 'GET' },
    )
    return data.items ?? []
  },

  async revert(input: VmSnapshotRequest): Promise<VmActionResult> {
    const suffix = `/${encodeURIComponent(input.vm_snapshot_name)}/rollback`
    return post(`${await snapshotPath(input.vm_id, suffix)}?vmtype=${input.vmtype ?? 'qemu'}`)
  },

  async delete(input: VmSnapshotRequest): Promise<VmActionResult> {
    const suffix = `/${encodeURIComponent(input.vm_snapshot_name)}`
    return del(`${await snapshotPath(input.vm_id, suffix)}?vmtype=${input.vmtype ?? 'qemu'}`)
  },
}

// =============================================================================
// LXC API (TODO: Backend routes need to be added)
// =============================================================================

export const lxc = {
  /**
   * List LXC containers on the registered host (v1). `node` ignored.
   */
  async list(_node: ProxmoxNode): Promise<unknown[]> {
    return (await listHostVms()).filter((v) => v.type === 'lxc').map(normalizeVmV1)
  },

  /**
   * Create a new LXC container
   */
  async create(_request: LxcCreateRequest): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, 'LXC container creation is not yet supported by the backend API. This feature requires the /v0/admin/proxmox/lxc/create endpoint to be implemented.')
  },

  /**
   * Start an LXC container (v1).
   */
  async start(_node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return vmStatusAction(vmId, 'start', 'lxc')
  },

  /**
   * Stop an LXC container — graceful shutdown (v1).
   */
  async stop(_node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return vmStatusAction(vmId, 'shutdown', 'lxc')
  },

  /**
   * Delete an LXC container (v1).
   */
  async delete(
    vmId: number | string,
    options: { purge?: boolean } = {},
  ): Promise<VmActionResult> {
    return vmDelete(vmId, { vmtype: 'lxc', ...options })
  },
}

// =============================================================================
// Network API
// =============================================================================

export const network = {
  /**
   * Add a network interface to a VM
   */
  async addToVm(request: VmNetworkAddRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/network/vm/add', request as unknown as Record<string, unknown>)
  },

  /**
   * Remove a network interface from a VM
   */
  async removeFromVm(node: ProxmoxNode, vmId: number, ifaceId: number): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/network/vm/delete', {
      proxmox_node: node,
      vm_id: vmId,
      iface_id: ifaceId,
    })
  },

  /**
   * List VM network interfaces
   */
  async listVmInterfaces(node: ProxmoxNode, vmId: number): Promise<NetworkInterface[]> {
    return query('/v0/admin/proxmox/network/vm/list', { proxmox_node: node, vm_id: String(vmId) })
  },

  /**
   * Add a network to a Proxmox node (bridge, bond, etc.)
   */
  async addToNode(request: NodeNetworkAddRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/network/node/add', request as unknown as Record<string, unknown>)
  },

  /**
   * Remove a network from a Proxmox node
   */
  async removeFromNode(node: ProxmoxNode, ifaceName: string): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/network/node/delete', {
      proxmox_node: node,
      iface_name: ifaceName,
    })
  },

  /**
   * List node network interfaces
   */
  async listNodeInterfaces(node: ProxmoxNode): Promise<NodeNetwork[]> {
    return query('/v0/admin/proxmox/network/node/list', { proxmox_node: node })
  },
}

// =============================================================================
// Firewall API
// =============================================================================

export const firewall = {
  /**
   * Apply an iptables rule to a VM
   */
  async addRule(request: FirewallRuleAddRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/vm/rules/apply', request)
  },

  /**
   * Delete a firewall rule
   */
  async deleteRule(node: ProxmoxNode, vmId: number, pos: number): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/firewall/vm/rules/delete', {
      proxmox_node: node,
      vm_id: vmId,
      pos,
    })
  },

  /**
   * List firewall rules for a VM
   */
  async listRules(node: ProxmoxNode, vmId: number): Promise<FirewallRule[]> {
    return query('/v0/admin/proxmox/firewall/vm/rules/list', { proxmox_node: node, vm_id: String(vmId) })
  },

  /**
   * Add a firewall alias
   */
  async addAlias(node: ProxmoxNode, vmId: number, alias: FirewallAlias): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/vm/alias/add', {
      proxmox_node: node,
      vm_id: vmId,
      ...alias,
    })
  },

  /**
   * Delete a firewall alias
   */
  async deleteAlias(node: ProxmoxNode, vmId: number, name: string): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/firewall/vm/alias/delete', {
      proxmox_node: node,
      vm_id: vmId,
      name,
    })
  },

  /**
   * List firewall aliases
   */
  async listAliases(node: ProxmoxNode, vmId: number): Promise<FirewallAlias[]> {
    return query('/v0/admin/proxmox/firewall/vm/alias/list', { proxmox_node: node, vm_id: String(vmId) })
  },

  /**
   * Enable firewall for a VM
   */
  async enableVm(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/vm/enable', { proxmox_node: node, vm_id: vmId })
  },

  /**
   * Disable firewall for a VM
   */
  async disableVm(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/vm/disable', { proxmox_node: node, vm_id: vmId })
  },

  /**
   * Enable firewall for a node
   */
  async enableNode(node: ProxmoxNode): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/node/enable', { proxmox_node: node })
  },

  /**
   * Disable firewall for a node
   */
  async disableNode(node: ProxmoxNode): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/node/disable', { proxmox_node: node })
  },

  /**
   * Enable firewall for datacenter
   */
  async enableDatacenter(): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/datacenter/enable', {})
  },

  /**
   * Disable firewall for datacenter
   */
  async disableDatacenter(): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/datacenter/disable', {})
  },
}

// =============================================================================
// Storage API
// =============================================================================

async function storagePath(storageName?: string): Promise<string> {
  const { id } = await getRegisteredHost()
  return `/v1/proxmox/hosts/${id}/storage${storageName ? `/${encodeURIComponent(storageName)}` : ''}`
}

async function storageContent<T>(storageName: string, content: 'iso' | 'vztmpl'): Promise<T[]> {
  const data = await request<{ items: T[] }>(
    `${await storagePath(storageName)}/content?content=${content}`, { method: 'GET' },
  )
  return data.items ?? []
}

export const storage = {
  async list(_node: ProxmoxNode): Promise<unknown[]> {
    const data = await request<{ items: unknown[] }>(await storagePath(), { method: 'GET' })
    return data.items ?? []
  },

  async listIsos(_node: ProxmoxNode, storageName: string): Promise<IsoInfo[]> {
    return storageContent<IsoInfo>(storageName, 'iso')
  },

  async listTemplates(_node: ProxmoxNode, storageName: string): Promise<TemplateInfo[]> {
    return storageContent<TemplateInfo>(storageName, 'vztmpl')
  },

  async downloadIso(input: StorageDownloadIsoRequest): Promise<VmActionResult> {
    return post(`${await storagePath(input.storage)}/download-url`, {
      content: 'iso', filename: input.filename, url: input.url,
      checksum: input.checksum, checksum_algorithm: input.checksum_algorithm,
    })
  },
}

// =============================================================================
// Export default API object
// =============================================================================

export const proxmoxApi = {
  setBaseUrl,
  getBaseUrl,
  getTaskStatus,
  vm,
  snapshot,
  lxc,
  network,
  firewall,
  storage,
}

export default proxmoxApi
