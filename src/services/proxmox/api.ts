/**
 * Proxmox API Client
 * 
 * Unified API client for all Proxmox backend interactions.
 * All requests go through the backend-api, which then uses Ansible
 * to communicate with Proxmox.
 */

import type {
  ApiResponse,
  ApiError,
  ProxmoxNode,
  // VM types
  VmCreateRequest,
  VmConfig,
  VmListItem,
  VmActionRequest,
  VmCloneRequest,
  VmSnapshotRequest,
  // LXC types
  LxcCreateRequest,
  LxcConfig,
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
  baseUrl = url.replace(/\/$/, '')
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
  
  const defaultHeaders: HeadersInit = {
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

/**
 * Unwrap backend response: { rc, result: [[...items...]] } → items[]
 * The backend wraps Ansible results in a nested array.
 */
function unwrapResult<T>(raw: unknown): T[] {
  const data = raw as { rc?: number; result?: unknown[] }
  if (!data?.result || !Array.isArray(data.result)) return []
  // result is [[...items...]] — unwrap one level
  const inner = data.result[0]
  return Array.isArray(inner) ? inner as T[] : data.result as T[]
}

interface BackendVm {
  vm_id: number
  vm_name: string
  vm_status: string
  vm_uptime: number
  vm_template?: number
  vm_tags?: string
  proxmox_node: string
  vm_meta: {
    cpu_current_usage: number
    cpu_allocated: number
    ram_current_usage: number
    ram_max: number
    disk_max: number
  }
}

function normalizeVm(vm: BackendVm): VmListItem {
  // Use vm_template flag from backend (added in proxmox_controller 2625df3)
  // Fall back to name heuristic for older backends
  const isTemplate = vm.vm_template === 1
    || (vm.vm_name?.startsWith('template-') && vm.vm_status === 'stopped' && vm.vm_uptime === 0)
  return {
    vmid: vm.vm_id,
    name: vm.vm_name,
    status: vm.vm_status as VmListItem['status'],
    isTemplate,
    tags: vm.vm_tags || (isTemplate ? 'template' : ''),
    mem: vm.vm_meta?.ram_current_usage || 0,
    maxmem: vm.vm_meta?.ram_max || 0,
    cpu: vm.vm_meta?.cpu_current_usage || 0,
    maxcpu: vm.vm_meta?.cpu_allocated || 1,
    uptime: vm.vm_uptime || 0,
    node: vm.proxmox_node as ProxmoxNode,
  }
}

export const vm = {
  /**
   * List all VMs on a node
   */
  async list(node: ProxmoxNode): Promise<VmListItem[]> {
    const raw = await query('/v0/admin/proxmox/vms/list', { proxmox_node: node })
    return unwrapResult<BackendVm>(raw).map(normalizeVm)
  },

  /**
   * List VMs with resource usage
   */
  async listUsage(node: ProxmoxNode): Promise<VmListItem[]> {
    const raw = await query('/v0/admin/proxmox/vms/list_usage', { proxmox_node: node })
    return unwrapResult<BackendVm>(raw).map(normalizeVm)
  },

  /**
   * Get VM configuration
   */
  async getConfig(node: ProxmoxNode, vmId: number): Promise<VmConfig> {
    return query('/v0/admin/proxmox/vms/vm_id/config/vm_get_config', { proxmox_node: node, vm_id: String(vmId) })
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
   * Delete a VM
   */
  async delete(request: VmActionRequest): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/vms/vm_id/delete', { ...ANSIBLE_DEFAULTS, ...request })
  },

  /**
   * Start a VM
   */
  async start(request: VmActionRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/start', request as unknown as Record<string, unknown>)
  },

  /**
   * Stop a VM (graceful)
   */
  async stop(request: VmActionRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/stop', request as unknown as Record<string, unknown>)
  },

  /**
   * Force stop a VM
   */
  async stopForce(request: VmActionRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/stop-force', request as unknown as Record<string, unknown>)
  },

  /**
   * Pause a VM
   */
  async pause(request: VmActionRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/pause', request as unknown as Record<string, unknown>)
  },

  /**
   * Resume a paused VM
   */
  async resume(request: VmActionRequest): Promise<ApiResponse> {
    return command('/v0/admin/proxmox/vms/vm_id/resume', request as unknown as Record<string, unknown>)
  },

  /**
   * Set VM tags
   */
  async setTags(node: ProxmoxNode, vmId: number, tags: string[]): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/config/set-tags', {
      proxmox_node: node,
      vm_id: vmId,
      tags: tags.join(','),
    })
  },
}

// =============================================================================
// Snapshot API
// =============================================================================

export const snapshot = {
  /**
   * Create a VM snapshot
   */
  async create(request: VmSnapshotRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/snapshot/create', request)
  },

  /**
   * List VM snapshots
   */
  async list(node: ProxmoxNode, vmId: number): Promise<unknown[]> {
    return query('/v0/admin/proxmox/vms/vm_id/snapshot/list', { proxmox_node: node, vm_id: String(vmId) })
  },

  /**
   * Revert to a snapshot
   */
  async revert(request: VmSnapshotRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/snapshot/revert', request)
  },

  /**
   * Delete a snapshot
   */
  async delete(request: VmSnapshotRequest): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/vms/vm_id/snapshot/delete', request)
  },
}

// =============================================================================
// LXC API (TODO: Backend routes need to be added)
// =============================================================================

export const lxc = {
  /**
   * List all LXC containers on a node
   */
  async list(node: ProxmoxNode): Promise<unknown[]> {
    return query('/v0/admin/proxmox/lxc/list', { proxmox_node: node })
  },

  /**
   * Create a new LXC container
   */
  async create(request: LxcCreateRequest): Promise<ApiResponse> {
    // TODO: Implement when backend route is added
    return post('/v0/admin/proxmox/lxc/create', request)
  },

  /**
   * Start an LXC container
   */
  async start(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/lxc/start', { proxmox_node: node, vm_id: vmId })
  },

  /**
   * Stop an LXC container
   */
  async stop(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/lxc/stop', { proxmox_node: node, vm_id: vmId })
  },

  /**
   * Delete an LXC container
   */
  async delete(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/lxc/delete', { proxmox_node: node, vm_id: vmId })
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
    return query('/v0/admin/proxmox/network//node/list', { proxmox_node: node })
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

export const storage = {
  /**
   * List storage pools
   */
  async list(node: ProxmoxNode, storageName = 'local-zfs'): Promise<unknown[]> {
    return query('/v0/admin/proxmox/storage/list', { proxmox_node: node, storage_name: storageName })
  },

  /**
   * List ISOs in a storage
   */
  async listIsos(node: ProxmoxNode, storageName: string): Promise<IsoInfo[]> {
    return query('/v0/admin/proxmox/storage/storage_name/list_iso', { proxmox_node: node, storage_name: storageName })
  },

  /**
   * List templates in a storage
   */
  async listTemplates(node: ProxmoxNode, storageName: string): Promise<TemplateInfo[]> {
    return query('/v0/admin/proxmox/storage/storage_name/list_template', { proxmox_node: node, storage_name: storageName })
  },

  /**
   * Download an ISO from URL
   */
  async downloadIso(request: StorageDownloadIsoRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/storage/download_iso', request)
  },
}

// =============================================================================
// Export default API object
// =============================================================================

export const proxmoxApi = {
  setBaseUrl,
  getBaseUrl,
  vm,
  snapshot,
  lxc,
  network,
  firewall,
  storage,
}

export default proxmoxApi
