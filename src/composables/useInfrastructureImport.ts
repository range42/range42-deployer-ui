/**
 * Infrastructure Import Composable
 * 
 * Imports existing Proxmox infrastructure (VMs, LXCs, networks) into canvas nodes.
 * Allows reverse-engineering deployed infrastructure back to design.
 */

import { ref, computed } from 'vue'
import { proxmoxApi } from '@/services/proxmox'
import { proxmoxCache } from '@/services/proxmox/cache'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'
import type { VmListItem, ProxmoxNode } from '@/services/proxmox'

// =============================================================================
// Types
// =============================================================================

export interface ImportableResource {
  id: string
  type: 'vm' | 'lxc' | 'network'
  name: string
  vmid?: number
  status?: string
  node?: string
  config?: Record<string, unknown>
  selected: boolean
}

export interface NetworkInterface {
  name: string
  bridge: string
  ip?: string
  mac?: string
  firewall?: boolean
}

export interface ImportResult {
  success: boolean
  nodes: Array<{
    id: string
    type: string
    label: string
    position: { x: number; y: number }
    data: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    source: string
    target: string
  }>
  errors: string[]
}

// =============================================================================
// Composable
// =============================================================================

export function useInfrastructureImport() {
  const settingsStore = useProxmoxSettingsStore()

  // State
  const vms = ref<ImportableResource[]>([])
  const lxcs = ref<ImportableResource[]>([])
  const bridges = ref<Set<string>>(new Set())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Override node ref — can be set externally via setNode()
  const nodeOverride = ref<string | null>(null)

  // Computed — try store first, fall back to override
  const isConfigured = computed(() => {
    if (nodeOverride.value) return true
    try { return !!settingsStore.isConfigured } catch { return false }
  })
  const proxmoxNode = computed(() => {
    if (nodeOverride.value) return nodeOverride.value as ProxmoxNode
    try { return (settingsStore.defaultNode || '') as ProxmoxNode } catch { return '' as ProxmoxNode }
  })

  const selectedResources = computed(() => {
    return [...vms.value, ...lxcs.value].filter(r => r.selected)
  })

  const allResources = computed(() => [...vms.value, ...lxcs.value])

  // =============================================================================
  // Actions
  // =============================================================================

  /**
   * Fetch all VMs and LXCs from Proxmox
   */
  async function fetchResources(): Promise<void> {
    if (!isConfigured.value) {
      error.value = 'Proxmox not configured'
      return
    }

    try {
      isLoading.value = true
      error.value = null
      bridges.value.clear()

      // Fetch VMs via cache — filter out templates
      const vmList = await proxmoxCache.fetchVms(proxmoxNode.value) as VmListItem[]
      vms.value = vmList
        .filter((vm) => !vm.isTemplate && vm.status !== 'stopped')
        .map((vm) => ({
          id: `vm-${vm.vmid}`,
          type: 'vm' as const,
          name: vm.name || `VM ${vm.vmid}`,
          vmid: vm.vmid,
          status: vm.status,
          node: proxmoxNode.value,
          selected: false,
        }))

      // Fetch LXCs — skip if backend doesn't support it yet
      try {
        const lxcList = await proxmoxApi.lxc.list(proxmoxNode.value) as Array<{ vmid: number; name?: string; hostname?: string; status: string }>
        lxcs.value = lxcList.map((lxc) => ({
          id: `lxc-${lxc.vmid}`,
          type: 'lxc' as const,
          name: lxc.name || lxc.hostname || `LXC ${lxc.vmid}`,
          vmid: lxc.vmid,
          status: lxc.status,
          node: proxmoxNode.value,
          selected: false,
        }))
      } catch {
        // LXC endpoint not available — leave empty
        lxcs.value = []
      }

    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useInfrastructureImport] Failed to fetch resources:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Fetch detailed config for a VM using shared cache
   */
  async function fetchVmConfig(vmid: number): Promise<Record<string, unknown> | null> {
    try {
      const allVms = proxmoxCache.vmCache.value.length > 0
        ? proxmoxCache.vmCache.value
        : await proxmoxCache.fetchVms(proxmoxNode.value)
      const vm = allVms.find(v => v.vmid === vmid)
      if (vm) {
        return {
          vmid: vm.vmid,
          name: vm.name,
          cores: vm.maxcpu || 1,
          memory: vm.maxmem ? Math.floor(vm.maxmem / 1024 / 1024) : 0,
          memUsed: vm.mem ? Math.floor(vm.mem / 1024 / 1024) : 0,
          diskMax: (vm as unknown as Record<string, unknown>).maxdisk || 0,
          cpuUsage: vm.cpu || 0,
          uptime: vm.uptime || 0,
          status: vm.status,
          node: vm.node || '',
        }
      }
      return null
    } catch (err) {
      console.error(`[useInfrastructureImport] Failed to fetch VM ${vmid} config:`, err)
      return null
    }
  }

  /**
   * Fetch detailed config for an LXC (no-op if LXC endpoint unavailable)
   */
  async function fetchLxcConfig(_vmid: number): Promise<Record<string, unknown> | null> {
    return null
  }

  /**
   * Extract network interfaces from VM/LXC config
   */
  function extractNetworkInterfaces(config: Record<string, unknown>): NetworkInterface[] {
    const interfaces: NetworkInterface[] = []
    
    // VM network format: net0, net1, etc.
    // Format: "virtio=XX:XX:XX:XX:XX:XX,bridge=vmbr0,firewall=1"
    for (let i = 0; i < 10; i++) {
      const netKey = `net${i}`
      const netValue = config[netKey] as string | undefined
      
      if (netValue) {
        const iface: NetworkInterface = { name: netKey, bridge: '' }
        
        const parts = netValue.split(',')
        for (const part of parts) {
          const [key, value] = part.split('=')
          if (key === 'bridge') iface.bridge = value
          if (key === 'ip') iface.ip = value
          if (key === 'firewall') iface.firewall = value === '1'
          if (key.includes(':')) iface.mac = key // MAC address
        }
        
        if (iface.bridge) {
          bridges.value.add(iface.bridge)
          interfaces.push(iface)
        }
      }
    }

    return interfaces
  }

  /**
   * Toggle selection of a resource
   */
  function toggleSelection(resourceId: string): void {
    const vm = vms.value.find(v => v.id === resourceId)
    if (vm) {
      vm.selected = !vm.selected
      return
    }
    
    const lxc = lxcs.value.find(l => l.id === resourceId)
    if (lxc) {
      lxc.selected = !lxc.selected
    }
  }

  /**
   * Select all resources
   */
  function selectAll(): void {
    vms.value.forEach(v => v.selected = true)
    lxcs.value.forEach(l => l.selected = true)
  }

  /**
   * Deselect all resources
   */
  function deselectAll(): void {
    vms.value.forEach(v => v.selected = false)
    lxcs.value.forEach(l => l.selected = false)
  }

  /**
   * Import selected resources as canvas nodes
   */
  async function importSelected(): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      nodes: [],
      edges: [],
      errors: [],
    }

    const selected = selectedResources.value
    if (selected.length === 0) {
      result.errors.push('No resources selected')
      return result
    }

    // Track bridges for network segment creation
    const bridgeNodes = new Map<string, string>()
    let nodeX = 100
    let nodeY = 100
    const spacing = 200

    // Create network segment nodes for each bridge
    const bridgeArray = Array.from(bridges.value)
    for (const bridge of bridgeArray) {
      const nodeId = `imported-network-${bridge}`
      bridgeNodes.set(bridge, nodeId)
      
      result.nodes.push({
        id: nodeId,
        type: 'network-segment',
        label: bridge,
        position: { x: nodeX, y: nodeY },
        data: {
          type: 'network-segment',
          label: bridge,
          config: {
            name: bridge,
            bridge: bridge,
            cidr: '',
            gateway: '',
          }
        }
      })
      nodeX += spacing
    }

    // Reset position for VMs/LXCs
    nodeX = 100
    nodeY = 300

    // Process selected VMs/LXCs
    for (const resource of selected) {
      try {
        // Fetch detailed config
        const config = resource.type === 'vm' 
          ? await fetchVmConfig(resource.vmid!)
          : await fetchLxcConfig(resource.vmid!)

        if (!config) {
          result.errors.push(`Failed to fetch config for ${resource.name}`)
          continue
        }

        // Extract network interfaces
        const interfaces = extractNetworkInterfaces(config)

        // Create node
        const nodeId = `imported-${resource.type}-${resource.vmid}`
        const initialConfig = {
          name: resource.name,
          cores: config.cores || 1,
          memory: typeof config.memory === 'string' ? parseInt(config.memory) : (config.memory || 0),
          tags: [],
          description: '',
        }
        result.nodes.push({
          id: nodeId,
          type: resource.type,
          label: resource.name,
          position: { x: nodeX, y: nodeY },
          data: {
            type: resource.type,
            label: resource.name,
            vmId: resource.vmid,
            deployed: true,
            status: resource.status === 'running' ? 'running' : 'stopped',
            config: {
              name: resource.name,
              vmid: resource.vmid,
              cores: config.cores || 1,
              memory: String(config.memory || 0),
              memUsed: config.memUsed || 0,
              diskMax: config.diskMax || 0,
              cpuUsage: config.cpuUsage || 0,
              uptime: config.uptime || 0,
              proxmoxNode: config.node || '',
            },
            desiredConfig: { ...initialConfig },
            actualConfig: { ...initialConfig },
          }
        })

        // Create edges for each network interface
        for (const iface of interfaces) {
          const networkNodeId = bridgeNodes.get(iface.bridge)
          if (networkNodeId) {
            result.edges.push({
              id: `edge-${nodeId}-${networkNodeId}`,
              source: nodeId,
              target: networkNodeId,
            })
          }
        }

        nodeX += spacing
        if (nodeX > 700) {
          nodeX = 100
          nodeY += spacing
        }

      } catch (err) {
        result.errors.push(`Error importing ${resource.name}: ${err}`)
      }
    }

    result.success = result.errors.length === 0
    return result
  }

  /**
   * Refresh resources from Proxmox
   */
  async function refresh(): Promise<void> {
    proxmoxCache.invalidate()
    await fetchResources()
  }

  function setNode(node: string): void {
    nodeOverride.value = node
  }

  return {
    // State
    vms,
    lxcs,
    bridges,
    isLoading,
    error,

    // Computed
    isConfigured,
    selectedResources,
    allResources,

    // Actions
    fetchResources,
    toggleSelection,
    selectAll,
    deselectAll,
    importSelected,
    refresh,
    setNode,
  }
}

export default useInfrastructureImport
