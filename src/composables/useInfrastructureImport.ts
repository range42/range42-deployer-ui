/**
 * Infrastructure Import Composable
 * 
 * Imports existing Proxmox infrastructure (VMs, LXCs, networks) into canvas nodes.
 * Allows reverse-engineering deployed infrastructure back to design.
 */

import { ref, computed, watch, getCurrentScope, onScopeDispose } from 'vue'
import { proxmoxApi } from '@/services/proxmox'
import { captureBackendGuard, listRegisteredGuests } from '@/services/proxmox/api'
import { useBackendApiStore } from '@/stores/backendApiStore'
import type { CanvasEdge } from '@/overlay/serialize'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'
import type { ProxmoxNode } from '@/services/proxmox'

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
  hostId?: string
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
  const names = Object.keys(config).filter(key => /^net(?:0|[1-9][0-9]*)$/.test(key))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
  if (names.length > 32) throw new Error('This import supports at most 32 NICs per guest.')
  for (const name of names) {
    const i = Number(name.slice(3)), netValue = config[name]
    if (typeof netValue !== 'string' || !netValue) throw new Error(`Invalid NIC configuration: ${name}`)
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
  edges: CanvasEdge[]
  errors: string[]
}

// =============================================================================
// Composable
// =============================================================================

export function useInfrastructureImport() {
  const settingsStore = useProxmoxSettingsStore()
  const backendStore = useBackendApiStore()
  let generation = 0, disposed = false

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

  watch(() => [proxmoxNode.value, backendStore.url, backendStore.token, backendStore.activeHost?.id], () => {
    generation += 1
    vms.value = []; lxcs.value = []; bridges.value.clear()
    isLoading.value = false; error.value = null
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; generation += 1 })

  function context() {
    const version = generation, node = proxmoxNode.value, backend = captureBackendGuard()
    return { node, assertCurrent() {
      backend()
      if (disposed || version !== generation || node !== proxmoxNode.value) throw new Error('Import target changed. Reload before importing.')
    } }
  }

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
    if (!isConfigured.value) { error.value = 'Proxmox not configured'; return }
    generation += 1
    const scope = context()
    isLoading.value = true; error.value = null
    vms.value = []; lxcs.value = []; bridges.value.clear()
    try {
      const { host, guests } = await listRegisteredGuests({ node: scope.node })
      scope.assertCurrent()
      const resources = guests.filter(guest => !guest.isTemplate).map(guest => ({
        id: `${guest.type === 'lxc' ? 'lxc' : 'vm'}-${guest.vmid}`,
        type: guest.type === 'lxc' ? 'lxc' as const : 'vm' as const,
        name: guest.name, vmid: guest.vmid, status: guest.status, node: host.node_name, hostId: host.id,
        config: { cores: guest.maxcpu, memory: Math.floor(guest.maxmem / 1024 / 1024), tags: guest.tags, uptime: guest.uptime }, selected: false,
      }))
      vms.value = resources.filter(resource => resource.type === 'vm')
      lxcs.value = resources.filter(resource => resource.type === 'lxc')
    } catch (cause) {
      try { scope.assertCurrent(); error.value = cause instanceof Error ? cause.message : String(cause) } catch { /* Old contexts cannot overwrite the new list. */ }
    } finally {
      try { scope.assertCurrent(); isLoading.value = false } catch { /* New fetch owns loading. */ }
    }
  }

  async function fetchConfig(resource: ImportableResource, scope: ReturnType<typeof context>): Promise<Record<string, unknown>> {
    scope.assertCurrent()
    if (resource.node !== scope.node || !resource.hostId) throw new Error('Reload the selected guest before importing.')
    const config = await proxmoxApi.vm.getConfig(resource.vmid!, resource.type === 'lxc' ? 'lxc' : 'qemu', { node: scope.node, hostId: resource.hostId })
    scope.assertCurrent()
    return { ...resource.config, ...config, node: scope.node }
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

    const scope = context()
    const selected = selectedResources.value.map(resource => ({ ...resource }))
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
        const config = await fetchConfig(resource, scope)
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

    try { scope.assertCurrent() } catch (cause) { result.errors.push(cause instanceof Error ? cause.message : String(cause)) }
    if (result.errors.length) return result

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
      const vmTags = typeof config.tags === 'string' ? config.tags.split(';').filter(Boolean) : []

      const initialConfig = {
        name: resource.name,
        cores: config.cores || 1,
        memory: typeof config.memory === 'string' ? parseInt(config.memory) : (config.memory || 0),
        tags: vmTags,
        description: typeof config.description === 'string' ? config.description : '',
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
          status: resource.status || 'unknown',
          config: {
            name: resource.name,
            vmid: resource.vmid,
            cores: config.cores || 1,
            memory: String(config.memory || 0),
            memUsed: config.memUsed || 0,
            diskMax: config.diskMax || 0,
            cpuUsage: config.cpuUsage || 0,
            uptime: config.uptime || 0,
            proxmoxNode: resource.node,
            proxmoxHostId: resource.hostId,
          },
          desiredConfig: { ...initialConfig },
          actualConfig: { ...initialConfig },
        },
      })

      for (const iface of interfaces) {
        const networkNodeId = bridgeNodes.get(iface.bridge)
        if (!networkNodeId) continue
        result.edges.push({
          id: `edge-${nodeId}-${iface.name}-${networkNodeId}`,
          source: nodeId,
          target: networkNodeId,
          data: { connection: { interfaceName: iface.name, ...(iface.ip ? { ipAddress: iface.ip } : {}) }, useDhcp: !iface.ip },
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
