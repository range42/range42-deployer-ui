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
  cidr?: string
  gateway?: string
  mac?: string
  firewall?: boolean
}

/** Network address for ip/prefix, e.g. 192.168.142.123 + /24 -> 192.168.142.0/24. */
function cidrNetwork(ip: string, prefix: number): string | undefined {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return undefined
  if (prefix < 0 || prefix > 32) return undefined
  const ipInt = ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const net = (ipInt & mask) >>> 0
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`
}

/**
 * Parse a Proxmox guest config into network interfaces, deriving each NIC's
 * subnet/gateway from the matching ipconfigN. Pure (no side effects) so the
 * import flow can reconstruct network nodes + edges (#79).
 */
export function parseNetworkInterfaces(config: Record<string, unknown>): NetworkInterface[] {
  const interfaces: NetworkInterface[] = []
  for (let i = 0; i < 10; i++) {
    const netValue = config[`net${i}`] as string | undefined
    if (!netValue) continue
    const iface: NetworkInterface = { name: `net${i}`, bridge: '' }
    // LXC NICs carry ip/gw inline in netN; QEMU NICs carry them in ipconfigN.
    for (const part of netValue.split(',')) {
      const [key, value] = part.split('=')
      if (key === 'bridge') iface.bridge = value
      else if (key === 'firewall') iface.firewall = value === '1'
      else if (key === 'hwaddr') iface.mac = value
      else if (key === 'ip' && value && value !== 'dhcp') {
        const [addr, prefix] = value.split('/')
        iface.ip = addr
        if (prefix) iface.cidr = cidrNetwork(addr, parseInt(prefix, 10))
      } else if (key === 'gw') {
        iface.gateway = value
      }
    }
    if (!iface.bridge) continue
    // QEMU: fill address/gateway from ipconfigN if not already set inline.
    const ipcfg = config[`ipconfig${i}`] as string | undefined
    if (ipcfg) {
      for (const part of ipcfg.split(',')) {
        const [key, value] = part.split('=')
        if (key === 'ip' && value && value !== 'dhcp' && !iface.ip) {
          const [addr, prefix] = value.split('/')
          iface.ip = addr
          if (prefix) iface.cidr = cidrNetwork(addr, parseInt(prefix, 10))
        } else if (key === 'gw' && !iface.gateway) {
          iface.gateway = value
        }
      }
    }
    interfaces.push(iface)
  }
  return interfaces
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
      if (!vm) return null
      const summary: Record<string, unknown> = {
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
      // #79: the v1 VM list has no per-NIC detail. Pull the real guest config
      // so extractNetworkInterfaces() can rebuild bridge/network edges.
      try {
        const vmtype = vm.type === 'lxc' ? 'lxc' : 'qemu'
        const cfg = await proxmoxApi.vm.getConfig(vmid, vmtype)
        return { ...summary, ...cfg }
      } catch (cfgErr) {
        console.warn(`[useInfrastructureImport] no per-NIC config for VM ${vmid}:`, cfgErr)
        return summary
      }
    } catch (err) {
      console.error(`[useInfrastructureImport] Failed to fetch VM ${vmid} config:`, err)
      return null
    }
  }

  /**
   * Fetch detailed config for an LXC (no-op if LXC endpoint unavailable)
   */
  async function fetchLxcConfig(vmid: number): Promise<Record<string, unknown> | null> {
    try {
      const lxc = lxcs.value.find(l => l.vmid === vmid)
      const summary: Record<string, unknown> = lxc
        ? { vmid, name: lxc.name, status: lxc.status, node: proxmoxNode.value }
        : { vmid }
      // LXC config carries cores/memory + net0 with inline ip/gw/bridge.
      const cfg = await proxmoxApi.vm.getConfig(vmid, 'lxc')
      return { ...summary, ...cfg }
    } catch (err) {
      console.warn(`[useInfrastructureImport] no config for LXC ${vmid}:`, err)
      return null
    }
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

    const spacing = 200

    // Pass 1: fetch each guest's config and parse its NICs, so we know every
    // bridge AND its subnet/gateway BEFORE building network nodes (#79).
    interface Prepared {
      resource: (typeof selected)[number]
      config: Record<string, unknown>
      interfaces: NetworkInterface[]
    }
    const prepared: Prepared[] = []
    const bridgeMeta = new Map<string, { cidr: string; gateway: string }>()
    for (const resource of selected) {
      try {
        const config = resource.type === 'vm'
          ? await fetchVmConfig(resource.vmid!)
          : await fetchLxcConfig(resource.vmid!)
        if (!config) {
          result.errors.push(`Failed to fetch config for ${resource.name}`)
          continue
        }
        const interfaces = parseNetworkInterfaces(config)
        for (const iface of interfaces) {
          bridges.value.add(iface.bridge)
          const meta = bridgeMeta.get(iface.bridge) ?? { cidr: '', gateway: '' }
          if (!meta.cidr && iface.cidr) meta.cidr = iface.cidr
          if (!meta.gateway && iface.gateway) meta.gateway = iface.gateway
          bridgeMeta.set(iface.bridge, meta)
        }
        prepared.push({ resource, config, interfaces })
      } catch (err) {
        result.errors.push(`Error reading ${resource.name}: ${err}`)
      }
    }

    // Pass 2: one network-segment node per discovered bridge, with the subnet
    // and gateway derived from the imported VMs' ipconfig.
    const bridgeNodes = new Map<string, string>()
    let nodeX = 100
    let nodeY = 100
    for (const [bridge, meta] of bridgeMeta) {
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
          config: { name: bridge, bridge, cidr: meta.cidr, gateway: meta.gateway },
        },
      })
      nodeX += spacing
    }

    // Pass 3: VM/LXC nodes + edges to their bridges (carrying the NIC ip so the
    // serializer records networks[].node_ref + ip).
    nodeX = 100
    nodeY = 300
    for (const { resource, config, interfaces } of prepared) {
      const nodeId = `imported-${resource.type}-${resource.vmid}`
      const cachedVm = proxmoxCache.vmCache.value.find(v => v.vmid === resource.vmid)
      const vmTags = cachedVm?.tags ? cachedVm.tags.split(';').filter(Boolean) : []

      const initialConfig = {
        name: resource.name,
        cores: config.cores || 1,
        memory: typeof config.memory === 'string' ? parseInt(config.memory) : (config.memory || 0),
        tags: vmTags,
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
        },
      })

      for (const iface of interfaces) {
        const networkNodeId = bridgeNodes.get(iface.bridge)
        if (!networkNodeId) continue
        result.edges.push({
          id: `edge-${nodeId}-${networkNodeId}`,
          source: nodeId,
          target: networkNodeId,
          data: iface.ip ? { connection: { ipAddress: iface.ip } } : { useDhcp: true },
        })
      }

      nodeX += spacing
      if (nodeX > 700) {
        nodeX = 100
        nodeY += spacing
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
