/**
 * Proxmox API Client
 * 
 * Unified API client for all Proxmox backend interactions.
 * Requests go through the backend-api. Registered-host v1 operations call
 * Proxmox directly; legacy v0 adapters use the global Ansible inventory.
 */

import { getActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { CONFIG_WRITE_UNAVAILABLE } from './observedConfig'
import { validateConfigChanges, validateConfigReview, validateConfigResult, type VmConfigReview } from './configReview'

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
let contextVersion = 0

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
  const next = url.replace(/\/+$/, '')
  if (baseUrl !== next) contextVersion++
  baseUrl = next
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

export interface ProxmoxTarget {
  node?: ProxmoxNode
  hostId?: string
}

function backendContext() {
  const matching = getActivePinia()
    ? useBackendApiStore().hosts.filter(host => host.url.replace(/\/+$/, '') === baseUrl)
    : []
  if (matching.length > 1) throw new ProxmoxApiError(0, 'Backend configuration is ambiguous.')
  const host = matching[0]
  return { url: baseUrl, version: contextVersion, id: host?.id, token: host?.token, node: host?.nodeName }
}

type BackendContext = ReturnType<typeof backendContext>

function assertBackendContext(expected: BackendContext): void {
  const current = backendContext()
  if (current.url !== expected.url || current.version !== expected.version || current.id !== expected.id
    || current.token !== expected.token || current.node !== expected.node) {
    throw new ProxmoxApiError(0, 'Backend context changed. Refresh before continuing.')
  }
}

/** Capture a context check without exposing credentials to callers. */
export function captureBackendGuard(): () => void {
  const context = backendContext()
  return () => assertBackendContext(context)
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  context: BackendContext = backendContext(),
): Promise<T> {
  assertBackendContext(context)
  if (!context.url) {
    throw new ProxmoxApiError(0, 'API base URL not configured. Call setBaseUrl() first.')
  }

  const url = `${context.url}${endpoint}`
  const defaultHeaders: HeadersInit = {
    ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}),
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
    assertBackendContext(context)
    
    // Try to parse JSON response
    let data: unknown
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      data = await response.json()
    } else {
      // Some endpoints return plain text
      data = await response.text()
    }
    assertBackendContext(context)

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

/** Retained for existing tests; registrations are now read for each operation. */
export function _resetHostCacheForTests(): void {
  contextVersion++
}

interface RegisteredHost { id: string; node_name: string }

/** Refuse partial registries and ambiguous node names, including cross-cluster duplicates. */
async function resolveHost(target: ProxmoxTarget, context: BackendContext): Promise<RegisteredHost> {
  if ((target.node !== undefined && (typeof target.node !== 'string' || !target.node.trim()))
    || (target.hostId !== undefined && (typeof target.hostId !== 'string' || !target.hostId.trim()))) {
    throw new ProxmoxApiError(0, 'A valid selected Proxmox target is required.')
  }
  const hosts: RegisteredHost[] = []
  let offset = 0, total: number | undefined
  do {
    const raw = await request<{ items?: RegisteredHost[]; total?: number; offset?: number }>(
      `/v1/proxmox/hosts${offset ? `?offset=${offset}` : ''}`, { method: 'GET' }, context,
    )
    if (!Array.isArray(raw?.items) || raw.offset !== offset || !Number.isSafeInteger(raw.total)
      || raw.total! < 0 || raw.total! > 10000 || (total !== undefined && raw.total !== total)
      || offset + raw.items.length > raw.total! || (!raw.items.length && offset < raw.total!)
      || raw.items.some(host => !host || typeof host.id !== 'string' || !host.id
        || typeof host.node_name !== 'string' || !host.node_name)) {
      throw new ProxmoxApiError(0, 'Proxmox host registry is incomplete or invalid. Check backend host registrations.')
    }
    total = raw.total!
    hosts.push(...raw.items)
    if (new Set(hosts.map(host => host.id)).size !== hosts.length) {
      throw new ProxmoxApiError(0, 'Proxmox host registry is incomplete or invalid. Reload registrations.')
    }
    offset = hosts.length
  } while (offset < total)
  if (hosts.length === 0) {
    throw new ProxmoxApiError(0, 'No Proxmox host registered. Configure a backend host registration.')
  }
  const node = target.node ?? context.node
  const matches = hosts.filter(host => (!node || host.node_name === node)
    && (!target.hostId || host.id === target.hostId))
  if (matches.length !== 1) {
    throw new ProxmoxApiError(0, 'No unambiguous registered Proxmox host matches the selected target.')
  }
  return { id: matches[0].id, node_name: matches[0].node_name }
}

export async function getRegisteredHost(target: ProxmoxTarget = {}): Promise<RegisteredHost> {
  return resolveHost(target, backendContext())
}

async function hostRequest<T>(target: ProxmoxTarget, path: string, options: RequestInit): Promise<T> {
  const context = backendContext()
  const host = await resolveHost(target, context)
  return request<T>(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}${path}`, options, context)
}

function actionTarget(input: { proxmox_node?: ProxmoxNode; proxmox_host_id?: string }): ProxmoxTarget {
  return { node: input.proxmox_node, hostId: input.proxmox_host_id }
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

async function listHostVms(target: ProxmoxTarget): Promise<V1Vm[]> {
  const raw = await hostRequest<{ items?: V1Vm[] }>(target,
    '/vms',
    { method: 'GET' },
  )
  return raw.items ?? []
}

/** Fresh observed inventory bound to one complete registered host; never uses the UI cache. */
export async function listRegisteredGuests(target: ProxmoxTarget): Promise<{ host: RegisteredHost; guests: VmListItem[] }> {
  const context = backendContext()
  const host = await resolveHost(target, context)
  const raw = await request<{ items?: V1Vm[]; total?: number; offset?: number }>(
    `/v1/proxmox/hosts/${encodeURIComponent(host.id)}/vms`, { method: 'GET' }, context,
  )
  if (!Array.isArray(raw?.items) || raw.offset !== 0 || raw.total !== raw.items.length
    || raw.items.some(guest => !guest || !Number.isSafeInteger(guest.vmid) || guest.vmid < 1
      || guest.node !== host.node_name || !['qemu', 'lxc'].includes(guest.type)
      || !['running', 'stopped', 'paused', 'unknown'].includes(guest.status))
    || new Set(raw.items.map(guest => `${guest.type}:${guest.vmid}`)).size !== raw.items.length) {
    throw new ProxmoxApiError(0, 'Guest inventory is incomplete or invalid. Refresh before continuing.')
  }
  return { host, guests: raw.items.map(normalizeVmV1) }
}

export interface GuestObservedStatus {
  vmid: number
  node: string
  type: 'qemu' | 'lxc'
  status: 'running' | 'stopped' | 'paused' | 'unknown'
}

/** The guest's run state, including QEMU pause, rather than process-list status. */
export async function getGuestStatus(vmid: number, vmtype: 'qemu' | 'lxc', target: ProxmoxTarget): Promise<GuestObservedStatus> {
  if (!Number.isSafeInteger(vmid) || vmid < 1) throw new ProxmoxApiError(0, 'A valid guest VMID is required.')
  const context = backendContext(), host = await resolveHost(target, context)
  const value = await request<GuestObservedStatus>(
    `/v1/proxmox/hosts/${encodeURIComponent(host.id)}/vms/${vmid}/status?vmtype=${vmtype}`, { method: 'GET' }, context,
  )
  if (!value || value.vmid !== vmid || value.node !== host.node_name || value.type !== vmtype
    || !['running', 'stopped', 'paused', 'unknown'].includes(value.status)) {
    throw new ProxmoxApiError(0, 'Guest status response does not match the selected target.')
  }
  return value
}

/** Fetch the raw PVE guest config (net0/net1/ipconfig*, ...) through v1. The
 * v1 VM list omits per-NIC detail, so import uses this to rebuild edges (#79). */
async function getHostVmConfig(
  vmId: number | string,
  vmtype: 'qemu' | 'lxc' = 'qemu',
  target: ProxmoxTarget = {},
): Promise<Record<string, unknown>> {
  const raw = await hostRequest<{ config?: Record<string, unknown> }>(target,
    `/vms/${vmId}/config?vmtype=${vmtype}`,
    { method: 'GET' },
  )
  return raw.config ?? {}
}

/** POST a Proxmox status action through v1 (host resolved internally). */
async function vmStatusAction(
  vmId: number | string,
  action: string,
  vmtype: 'qemu' | 'lxc' = 'qemu',
  target: ProxmoxTarget = {},
): Promise<ApiResponse> {
  return hostRequest<ApiResponse>(target,
    `/vms/${vmId}/status/${action}?vmtype=${vmtype}`,
    { method: 'POST' },
  )
}

/** DELETE a VM or LXC container through v1. */
async function vmDelete(
  vmId: number | string,
  options: ProxmoxTarget & { vmtype?: 'qemu' | 'lxc'; purge?: boolean } = {},
): Promise<VmActionResult> {
  if (typeof vmId === 'object' && vmId !== null) {
    throw new Error('vmDelete: vmId must be a number or string. Pass the numeric vmId directly.')
  }
  const { vmtype = 'qemu', purge = true } = options
  return hostRequest<VmActionResult>(options,
    `/vms/${vmId}?vmtype=${vmtype}&purge=${purge}`,
    { method: 'DELETE' },
  )
}

/** Poll task status for an async Proxmox operation (identified by UPID). */
export async function getTaskStatus(upid: string, target: ProxmoxTarget = {}, expectedTargetDigest?: string): Promise<TaskStatus> {
  const node = /^UPID:([A-Za-z0-9][A-Za-z0-9.-]*):.+/.exec(upid)?.[1]
  if (!node || (target.node && target.node !== node)) {
    throw new ProxmoxApiError(0, 'Invalid task UPID or mismatched selected node.')
  }
  if (expectedTargetDigest !== undefined && !/^[a-f0-9]{64}$/.test(expectedTargetDigest)) throw new ProxmoxApiError(0, 'Invalid task target fingerprint.')
  return hostRequest<TaskStatus>({ ...target, node },
    `/tasks/${encodeURIComponent(upid)}/status${expectedTargetDigest ? `?expected_target_digest=${expectedTargetDigest}` : ''}`,
    { method: 'GET' },
  )
}

export const vm = {
  /**
   * List qemu VMs on the unambiguously selected registered node.
   */
  async list(node: ProxmoxNode): Promise<VmListItem[]> {
    return (await listHostVms({ node })).filter((v) => v.type === 'qemu').map(normalizeVmV1)
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
    target: ProxmoxTarget = {},
  ): Promise<Record<string, unknown>> {
    return getHostVmConfig(vmId, vmtype, target)
  },

  /** Review only the editable fields, with current and pending values kept separate. */
  async getConfigReview(vmId: number, vmtype: 'qemu' | 'lxc', target: ProxmoxTarget) {
    if (!Number.isSafeInteger(vmId) || vmId < 1 || !['qemu', 'lxc'].includes(vmtype)) throw new Error('Invalid configuration target.')
    const context = backendContext()
    const host = await resolveHost(target, context)
    const raw = await request<unknown>(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}/vms/${vmId}/config/review?vmtype=${vmtype}`, { method: 'GET' }, context)
    return validateConfigReview(raw, { host_id: host.id, node: host.node_name, vmid: vmId, vmtype })
  },

  /** One conditional write to the reviewed guest; no legacy inventory fallback. */
  async updateConfig(review: VmConfigReview, changes: unknown, assertReviewCurrent: () => void = () => {}) {
    const expected = validateConfigReview(review, review)
    const patch = validateConfigChanges(changes)
    assertReviewCurrent()
    const context = backendContext()
    const host = await resolveHost({ hostId: expected.host_id, node: expected.node }, context)
    assertReviewCurrent()
    const raw = await request<unknown>(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}/vms/${expected.vmid}/config?vmtype=${expected.vmtype}`,
      { method: 'PUT', body: JSON.stringify({ digest: expected.digest, changes: patch }) }, context)
    return validateConfigResult(raw, expected)
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
    options: ProxmoxTarget & { purge?: boolean } = {},
  ): Promise<VmActionResult> {
    return vmDelete(vmId, { vmtype: 'qemu', ...options })
  },

  /**
   * Start a VM (v1).
   */
  async start(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'start', request.vmtype, actionTarget(request))
  },

  /**
   * Stop a VM gracefully — ACPI shutdown (v1).
   */
  async stop(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'shutdown', request.vmtype, actionTarget(request))
  },

  /**
   * Force stop a VM — hard power-off (v1).
   */
  async stopForce(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'stop', request.vmtype, actionTarget(request))
  },

  /**
   * Pause (suspend) a VM (v1).
   */
  async pause(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'suspend', request.vmtype, actionTarget(request))
  },

  /**
   * Resume a paused VM (v1).
   */
  async resume(request: VmActionRequest): Promise<ApiResponse> {
    return vmStatusAction(request.vm_id, 'resume', request.vmtype, actionTarget(request))
  },

  /** Legacy setters cannot bind writes to the selected registered host. */
  async setTags(_node: ProxmoxNode, _vmId: number, _tags: string[]): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, CONFIG_WRITE_UNAVAILABLE)
  },
  async setName(_node: ProxmoxNode, _vmId: number, _name: string): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, CONFIG_WRITE_UNAVAILABLE)
  },
  async setDescription(_node: ProxmoxNode, _vmId: number, _description: string): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, CONFIG_WRITE_UNAVAILABLE)
  },
  async setCpu(_node: ProxmoxNode, _vmId: number, _cores: number): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, CONFIG_WRITE_UNAVAILABLE)
  },
  async setMemory(_node: ProxmoxNode, _vmId: number, _memory: number): Promise<ApiResponse> {
    throw new ProxmoxApiError(501, CONFIG_WRITE_UNAVAILABLE)
  },
}

// =============================================================================
// Snapshot API
// =============================================================================

function snapshotPath(vmId: number | string, vmtype: 'qemu' | 'lxc', suffix = ''): string {
  return `/vms/${vmId}/snapshots${suffix}?vmtype=${vmtype}`
}

export const snapshot = {
  async create(input: VmSnapshotRequest): Promise<VmActionResult> {
    return hostRequest(actionTarget(input), snapshotPath(input.vm_id, input.vmtype ?? 'qemu'), {
      method: 'POST',
      body: JSON.stringify({ snapname: input.vm_snapshot_name, description: input.vm_snapshot_description, vmstate: input.vmstate }),
    })
  },
  async list(node: ProxmoxNode, vmId: number, vmtype: 'qemu' | 'lxc' = 'qemu'): Promise<unknown[]> {
    const data = await hostRequest<{ items: unknown[] }>({ node }, snapshotPath(vmId, vmtype), { method: 'GET' })
    return data.items ?? []
  },
  async revert(input: VmSnapshotRequest): Promise<VmActionResult> {
    const suffix = `/${encodeURIComponent(input.vm_snapshot_name)}/rollback`
    return hostRequest(actionTarget(input), snapshotPath(input.vm_id, input.vmtype ?? 'qemu', suffix), { method: 'POST' })
  },
  async delete(input: VmSnapshotRequest): Promise<VmActionResult> {
    const suffix = `/${encodeURIComponent(input.vm_snapshot_name)}`
    return hostRequest(actionTarget(input), snapshotPath(input.vm_id, input.vmtype ?? 'qemu', suffix), { method: 'DELETE' })
  },
}

// =============================================================================
// LXC API (TODO: Backend routes need to be added)
// =============================================================================

export const lxc = {
  /**
   * List LXC containers on the selected registered node (v1).
   */
  async list(node: ProxmoxNode): Promise<unknown[]> {
    return (await listHostVms({ node })).filter((v) => v.type === 'lxc').map(normalizeVmV1)
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
  async start(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return vmStatusAction(vmId, 'start', 'lxc', { node })
  },

  /**
   * Stop an LXC container — graceful shutdown (v1).
   */
  async stop(node: ProxmoxNode, vmId: number): Promise<ApiResponse> {
    return vmStatusAction(vmId, 'shutdown', 'lxc', { node })
  },

  /**
   * Delete an LXC container (v1).
   */
  async delete(
    vmId: number | string,
    options: ProxmoxTarget & { purge?: boolean } = {},
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

function storagePath(storageName?: string): string {
  return `/storage${storageName ? `/${encodeURIComponent(storageName)}` : ''}`
}

async function storageContent<T>(node: ProxmoxNode, storageName: string, content: 'iso' | 'vztmpl'): Promise<T[]> {
  const data = await hostRequest<{ items: T[] }>({ node },
    `${storagePath(storageName)}/content?content=${content}`, { method: 'GET' },
  )
  return data.items ?? []
}

export const storage = {
  async list(node: ProxmoxNode): Promise<unknown[]> {
    const data = await hostRequest<{ items: unknown[] }>({ node }, storagePath(), { method: 'GET' })
    return data.items ?? []
  },
  async listIsos(node: ProxmoxNode, storageName: string): Promise<IsoInfo[]> {
    return storageContent<IsoInfo>(node, storageName, 'iso')
  },
  async listTemplates(node: ProxmoxNode, storageName: string): Promise<TemplateInfo[]> {
    return storageContent<TemplateInfo>(node, storageName, 'vztmpl')
  },
  async downloadIso(input: StorageDownloadIsoRequest): Promise<VmActionResult> {
    return hostRequest(actionTarget(input), `${storagePath(input.storage)}/download-url`, {
      method: 'POST',
      body: JSON.stringify({ content: 'iso', filename: input.filename, url: input.url,
        checksum: input.checksum, checksum_algorithm: input.checksum_algorithm }),
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
