/**
 * Proxmox Status Composable
 * 
 * Provides real-time status updates for VMs and LXC containers from Proxmox.
 * Polls the backend API at configurable intervals and updates status maps.
 * 
 * Phase 3.2: Real-Time Status Updates
 */

import { ref, computed, onUnmounted, type Ref } from 'vue'
import { proxmoxApi } from '@/services/proxmox'
import { useProxmoxSettingsStore } from './useProxmoxSettings'
import type { VmStatus, VmListItem } from '@/services/proxmox/types'

// =============================================================================
// Types
// =============================================================================

export interface ResourceStatus {
  vmid: number
  name: string
  status: VmStatus
  cpu: number        // CPU usage (0-1)
  mem: number        // Memory used (bytes)
  maxmem: number     // Max memory (bytes)
  uptime: number     // Uptime in seconds
  node: string
  lastUpdated: string
}

export interface StatusPollingOptions {
  intervalMs?: number      // Polling interval (default: 5000ms)
  autoStart?: boolean      // Start polling immediately (default: false)
  includeUsage?: boolean   // Include resource usage (default: true)
}

// =============================================================================
// Composable
// =============================================================================

export function useProxmoxStatus(
  projectIdRef?: Ref<string | null | undefined>,
  options: StatusPollingOptions = {}
) {
  const settingsStore = useProxmoxSettingsStore()

  // Configuration
  const intervalMs = options.intervalMs ?? 5000
  const includeUsage = options.includeUsage ?? true

  // State
  const vmStatuses = ref<Map<number, ResourceStatus>>(new Map())
  const lxcStatuses = ref<Map<number, ResourceStatus>>(new Map())
  const isPolling = ref(false)
  const lastPollTime = ref<string | null>(null)
  const pollError = ref<string | null>(null)
  
  // Internal
  let pollingIntervalId: ReturnType<typeof setInterval> | null = null

  // =============================================================================
  // Computed
  // =============================================================================

  const projectSettings = computed(() => {
    const id = projectIdRef?.value
    return id ? settingsStore.getProjectSettings(id) : null
  })

  const proxmoxNode = computed(() => 
    projectSettings.value?.proxmoxNode || projectSettings.value?.defaultNode || ''
  )

  const backendApiUrl = computed(() =>
    projectSettings.value?.backendApiUrl || projectSettings.value?.baseUrl || ''
  )

  const isConfigured = computed(() => 
    Boolean(proxmoxNode.value && backendApiUrl.value)
  )

  /**
   * Get all statuses as an array (for easier iteration)
   */
  const vmStatusList = computed(() => Array.from(vmStatuses.value.values()))
  const lxcStatusList = computed(() => Array.from(lxcStatuses.value.values()))

  /**
   * Get running VMs count
   */
  const runningVmCount = computed(() => 
    vmStatusList.value.filter(vm => vm.status === 'running').length
  )

  /**
   * Get running LXC count
   */
  const runningLxcCount = computed(() =>
    lxcStatusList.value.filter(lxc => lxc.status === 'running').length
  )

  // =============================================================================
  // Status Fetching
  // =============================================================================

  /**
   * Fetch VM statuses from Proxmox
   */
  async function fetchVmStatuses(): Promise<void> {
    if (!isConfigured.value) {
      pollError.value = 'Proxmox settings not configured'
      return
    }

    try {
      // Ensure API is configured
      proxmoxApi.setBaseUrl(backendApiUrl.value)

      // Fetch VM list (with or without usage)
      const vms: VmListItem[] = includeUsage 
        ? await proxmoxApi.vm.listUsage(proxmoxNode.value)
        : await proxmoxApi.vm.list(proxmoxNode.value)

      // Update status map
      const now = new Date().toISOString()
      for (const vm of vms) {
        vmStatuses.value.set(vm.vmid, {
          vmid: vm.vmid,
          name: vm.name,
          status: vm.status,
          cpu: vm.cpu || 0,
          mem: vm.mem || 0,
          maxmem: vm.maxmem || 0,
          uptime: vm.uptime || 0,
          node: vm.node || proxmoxNode.value,
          lastUpdated: now,
        })
      }

      // Remove stale entries (VMs that no longer exist)
      const currentVmIds = new Set(vms.map(vm => vm.vmid))
      const existingVmIds = Array.from(vmStatuses.value.keys())
      for (const vmid of existingVmIds) {
        if (!currentVmIds.has(vmid)) {
          vmStatuses.value.delete(vmid)
        }
      }

      lastPollTime.value = now
      pollError.value = null
    } catch (error) {
      pollError.value = error instanceof Error ? error.message : String(error)
      console.error('[useProxmoxStatus] Failed to fetch VM statuses:', error)
    }
  }

  /**
   * Fetch LXC statuses from Proxmox
   */
  async function fetchLxcStatuses(): Promise<void> {
    if (!isConfigured.value) {
      pollError.value = 'Proxmox settings not configured'
      return
    }

    try {
      proxmoxApi.setBaseUrl(backendApiUrl.value)

      // TODO: Update when backend LXC list-usage endpoint is available
      const containers = await proxmoxApi.lxc.list(proxmoxNode.value) as VmListItem[]

      const now = new Date().toISOString()
      for (const lxc of containers) {
        lxcStatuses.value.set(lxc.vmid, {
          vmid: lxc.vmid,
          name: lxc.name,
          status: lxc.status,
          cpu: lxc.cpu || 0,
          mem: lxc.mem || 0,
          maxmem: lxc.maxmem || 0,
          uptime: lxc.uptime || 0,
          node: lxc.node || proxmoxNode.value,
          lastUpdated: now,
        })
      }

      // Remove stale entries
      const currentIds = new Set(containers.map(c => c.vmid))
      const existingLxcIds = Array.from(lxcStatuses.value.keys())
      for (const vmid of existingLxcIds) {
        if (!currentIds.has(vmid)) {
          lxcStatuses.value.delete(vmid)
        }
      }

      lastPollTime.value = now
      pollError.value = null
    } catch (error) {
      // LXC endpoint might not be implemented yet - don't fail hard
      console.warn('[useProxmoxStatus] Failed to fetch LXC statuses:', error)
    }
  }

  /**
   * Fetch all statuses (VMs and LXC)
   */
  async function fetchAllStatuses(): Promise<void> {
    await Promise.all([
      fetchVmStatuses(),
      fetchLxcStatuses(),
    ])
  }

  // =============================================================================
  // Polling Control
  // =============================================================================

  /**
   * Start polling for status updates
   */
  function startPolling(): void {
    if (isPolling.value) {
      console.warn('[useProxmoxStatus] Polling already started')
      return
    }

    if (!isConfigured.value) {
      console.warn('[useProxmoxStatus] Cannot start polling - settings not configured')
      return
    }

    isPolling.value = true
    
    // Fetch immediately
    fetchAllStatuses()

    // Then poll at interval
    pollingIntervalId = setInterval(() => {
      fetchAllStatuses()
    }, intervalMs)

    console.log(`[useProxmoxStatus] Started polling every ${intervalMs}ms`)
  }

  /**
   * Stop polling
   */
  function stopPolling(): void {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId)
      pollingIntervalId = null
    }
    isPolling.value = false
    console.log('[useProxmoxStatus] Stopped polling')
  }

  /**
   * Refresh status immediately (manual refresh)
   */
  async function refresh(): Promise<void> {
    await fetchAllStatuses()
  }

  // =============================================================================
  // Status Lookup Helpers
  // =============================================================================

  /**
   * Get status for a specific VM by ID
   */
  function getVmStatus(vmid: number): ResourceStatus | undefined {
    return vmStatuses.value.get(vmid)
  }

  /**
   * Get status for a specific LXC by ID
   */
  function getLxcStatus(vmid: number): ResourceStatus | undefined {
    return lxcStatuses.value.get(vmid)
  }

  /**
   * Check if a VM is running
   */
  function isVmRunning(vmid: number): boolean {
    const status = vmStatuses.value.get(vmid)
    return status?.status === 'running'
  }

  /**
   * Get display status color for a resource
   */
  function getStatusColor(status: VmStatus | undefined): string {
    switch (status) {
      case 'running':
        return 'success'  // Green
      case 'stopped':
        return 'neutral'  // Gray
      case 'paused':
        return 'warning'  // Yellow
      default:
        return 'base-300' // Light gray (unknown)
    }
  }

  /**
   * Map Proxmox status to node status for canvas
   */
  function mapToNodeStatus(vmStatus: VmStatus | undefined): 'running' | 'stopped' | 'pending' | 'error' | 'draft' {
    switch (vmStatus) {
      case 'running':
        return 'running'
      case 'stopped':
        return 'stopped'
      case 'paused':
        return 'pending'
      case 'unknown':
        return 'error'
      default:
        return 'draft'
    }
  }

  // =============================================================================
  // Cleanup
  // =============================================================================

  onUnmounted(() => {
    stopPolling()
  })

  // Auto-start if configured
  if (options.autoStart && isConfigured.value) {
    startPolling()
  }

  // =============================================================================
  // Return
  // =============================================================================

  return {
    // State
    vmStatuses,
    lxcStatuses,
    isPolling,
    lastPollTime,
    pollError,

    // Computed
    isConfigured,
    vmStatusList,
    lxcStatusList,
    runningVmCount,
    runningLxcCount,

    // Polling Control
    startPolling,
    stopPolling,
    refresh,

    // Status Lookup
    getVmStatus,
    getLxcStatus,
    isVmRunning,
    getStatusColor,
    mapToNodeStatus,
  }
}

export default useProxmoxStatus
