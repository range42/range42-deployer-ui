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
      const errorMessage = typeof data === 'object' && data !== null && 'detail' in data
        ? String((data as Record<string, unknown>).detail)
        : `HTTP ${response.status}: ${response.statusText}`
      
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

// Helper for GET requests
async function get<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: 'GET' })
}

// Helper for POST requests
async function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
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

export const vm = {
  /**
   * List all VMs on a node
   */
  async list(node: ProxmoxNode): Promise<VmListItem[]> {
    return get(`/v0/admin/proxmox/vms/list?proxmox_node=${node}`)
  },

  /**
   * List VMs with resource usage
   */
  async listUsage(node: ProxmoxNode): Promise<VmListItem[]> {
    return get(`/v0/admin/proxmox/vms/list-usage?proxmox_node=${node}`)
  },

  /**
   * Get VM configuration
   */
  async getConfig(node: ProxmoxNode, vmId: number): Promise<VmConfig> {
    return get(`/v0/admin/proxmox/vms/vm_id/config/get?proxmox_node=${node}&vm_id=${vmId}`)
  },

  /**
   * Create a new VM
   */
  async create(request: VmCreateRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/create', request)
  },

  /**
   * Clone an existing VM
   */
  async clone(request: VmCloneRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/clone', request)
  },

  /**
   * Delete a VM
   */
  async delete(request: VmActionRequest): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/vms/vm_id/delete', request)
  },

  /**
   * Start a VM
   */
  async start(request: VmActionRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/start', request)
  },

  /**
   * Stop a VM (graceful)
   */
  async stop(request: VmActionRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/stop', request)
  },

  /**
   * Force stop a VM
   */
  async stopForce(request: VmActionRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/stop-force', request)
  },

  /**
   * Pause a VM
   */
  async pause(request: VmActionRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/pause', request)
  },

  /**
   * Resume a paused VM
   */
  async resume(request: VmActionRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/vms/vm_id/resume', request)
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
    return get(`/v0/admin/proxmox/vms/vm_id/snapshot/list?proxmox_node=${node}&vm_id=${vmId}`)
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
    // TODO: Implement when backend route is added
    return get(`/v0/admin/proxmox/lxc/list?proxmox_node=${node}`)
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
    return post('/v0/admin/proxmox/network/vm/add', request)
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
    return get(`/v0/admin/proxmox/network/vm/list?proxmox_node=${node}&vm_id=${vmId}`)
  },

  /**
   * Add a network to a Proxmox node (bridge, bond, etc.)
   */
  async addToNode(request: NodeNetworkAddRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/network/node/add', request)
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
    return get(`/v0/admin/proxmox/network/node/list?proxmox_node=${node}`)
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
    return post('/v0/admin/proxmox/firewall/rules/apply', request)
  },

  /**
   * Delete a firewall rule
   */
  async deleteRule(node: ProxmoxNode, vmId: number, pos: number): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/firewall/rules/delete', {
      proxmox_node: node,
      vm_id: vmId,
      pos,
    })
  },

  /**
   * List firewall rules for a VM
   */
  async listRules(node: ProxmoxNode, vmId: number): Promise<FirewallRule[]> {
    return get(`/v0/admin/proxmox/firewall/rules/list?proxmox_node=${node}&vm_id=${vmId}`)
  },

  /**
   * Add a firewall alias
   */
  async addAlias(node: ProxmoxNode, vmId: number, alias: FirewallAlias): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/firewall/alias/add', {
      proxmox_node: node,
      vm_id: vmId,
      ...alias,
    })
  },

  /**
   * Delete a firewall alias
   */
  async deleteAlias(node: ProxmoxNode, vmId: number, name: string): Promise<ApiResponse> {
    return del('/v0/admin/proxmox/firewall/alias/delete', {
      proxmox_node: node,
      vm_id: vmId,
      name,
    })
  },

  /**
   * List firewall aliases
   */
  async listAliases(node: ProxmoxNode, vmId: number): Promise<FirewallAlias[]> {
    return get(`/v0/admin/proxmox/firewall/alias/list?proxmox_node=${node}&vm_id=${vmId}`)
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
  async list(node: ProxmoxNode): Promise<unknown[]> {
    return get(`/v0/admin/proxmox/storage/list?proxmox_node=${node}`)
  },

  /**
   * List ISOs in a storage
   */
  async listIsos(node: ProxmoxNode, storageName: string): Promise<IsoInfo[]> {
    return get(`/v0/admin/proxmox/storage/${storageName}/list-iso?proxmox_node=${node}`)
  },

  /**
   * List templates in a storage
   */
  async listTemplates(node: ProxmoxNode, storageName: string): Promise<TemplateInfo[]> {
    return get(`/v0/admin/proxmox/storage/${storageName}/list-template?proxmox_node=${node}`)
  },

  /**
   * Download an ISO from URL
   */
  async downloadIso(request: StorageDownloadIsoRequest): Promise<ApiResponse> {
    return post('/v0/admin/proxmox/storage/download-iso', request)
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
