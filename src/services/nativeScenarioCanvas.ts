import type { CanvasNode, CanvasEdge } from '@/overlay/serialize'
import type { ProjectDraft } from '@/types/project'

export interface NativeTopology {
  vms: Array<{ vm_id: number; vm_name?: string; ip?: string; bridge?: string; role?: string; group?: string }>
  templates: Array<{ vm_id: number; vm_name?: string; bridge?: string; ip?: string }>
  networks: Array<{ vnet: string; subnet?: string; gateway?: string }>
  warnings: string[]
  reservations: { status: 'checked' | 'missing' | 'conflict' | 'invalid'; issues: string[] }
}

/** Declared resources are an inspectable view of the original native workflow. */
export function nativeScenarioCanvas(id: string, name: string, path: string, topology: NativeTopology,
  origin?: Record<string, string | number>) {
  if (!topology || !Array.isArray(topology.vms) || !Array.isArray(topology.networks) || !Array.isArray(topology.templates)
    || topology.vms.length > 1024 || topology.networks.length > 256
    || new Set(topology.vms.map(vm => vm.vm_id)).size !== topology.vms.length
    || topology.vms.some(vm => !Number.isInteger(vm.vm_id) || vm.vm_id <= 0)) throw new Error('Refresh the catalog to load the scenario topology')
  if (!topology.reservations || ['conflict', 'invalid'].includes(topology.reservations.status)) {
    throw new Error(topology.reservations?.issues.join(' ') || 'Scenario reservations could not be checked')
  }
  const nodes: CanvasNode[] = [], edges: CanvasEdge[] = []
  const scenario = { version: 1, path, ...(origin ? { component_id: id } : {}) }
  const group: CanvasNode = { id, type: 'group', position: { x: 0, y: 0 }, data: { label: name, kind: 'topology_group',
    config: { name, platformStack: id, scenario, nativeScenario: true, declaredTopology: topology, ...(origin ? { nativeCatalog: origin } : {}) } } }
  nodes.push(group)
  const networks = new Map(topology.networks.map(network => [network.vnet, network]))
  for (const vm of topology.vms) if (vm.bridge && !networks.has(vm.bridge)) networks.set(vm.bridge, { vnet: vm.bridge })
  let y = 110, width = 760
  const owned = (nodeId: string, type: string, label: string, x: number, y: number, config: Record<string, unknown>): CanvasNode => ({
    id: nodeId, type, parentNode: id, extent: 'parent', position: { x, y }, data: { label, config: { ...config, platformStack: id, nativeScenario: true } },
  })
  for (const [index, bridge] of [...networks.keys(), undefined].entries()) {
    const vms = topology.vms.filter(vm => vm.bridge === bridge)
    if (!bridge && !vms.length) continue
    const network = bridge ? networks.get(bridge)! : undefined
    const columns = Math.min(4, Math.max(1, vms.length))
    const rowWidth = Math.max(760, 80 + columns * 340)
    width = Math.max(width, rowWidth)
    const networkId = `${id}-network-${index + 1}`
    const networkY = y + Math.max(1, Math.ceil(vms.length / 4)) * 210
    if (network) nodes.push(owned(networkId, 'network-segment', network.vnet, (rowWidth - 280) / 2, networkY,
      { name: network.vnet, bridge: network.vnet, vnet: network.vnet, cidr: network.subnet, gateway: network.gateway, segmentType: 'management' }))
    for (const [i, vm] of vms.entries()) {
      const vmId = `${id}-vm-${vm.vm_id}`
      nodes.push(owned(vmId, 'vm', vm.vm_name || `VM ${vm.vm_id}`, 40 + (i % 4) * 340, y + Math.floor(i / 4) * 210,
        { name: vm.vm_name || `VM ${vm.vm_id}`, vmid: vm.vm_id, ipAddress: vm.ip, bridge: vm.bridge,
          description: vm.group || vm.role || 'Declared scenario VM' }))
      if (network) edges.push({ id: `${vmId}-net0`, type: 'network', source: vmId, target: networkId,
        targetHandle: `top-${Math.min(3, i % 4 + 1)}`, data: { useDhcp: false, connection: {
          interfaceName: 'net0', interfaceModel: 'virtio', ipAddress: vm.ip ? vm.ip + (network.subnet ? `/${network.subnet.split('/')[1]}` : '') : '',
        } } })
    }
    y = networkY + 260
  }
  group.style = { width: `${width}px`, height: `${Math.max(300, y)}px` }
  return { nodes, edges }
}

export function checkNativeProjectCollisions(project: ProjectDraft, topology: NativeTopology) {
  const vmids = new Set(project.nodes.filter(node => node.type === 'vm').map(node => Number(node.data?.config?.vmid || node.data?.vmId)))
  for (const vm of (project.scenario?.vms || []) as Array<{ vm_id: number }>) vmids.add(Number(vm.vm_id))
  for (const vm of [...topology.vms, ...topology.templates]) if (vmids.has(vm.vm_id)) throw new Error(`VMID ${vm.vm_id} is already used in this project`)
  const templateIds = new Set(project.nodes.flatMap(node => {
    const topology = node.data?.config?.declaredTopology as NativeTopology | undefined
    return [...(topology?.templates || []).map(vm => vm.vm_id), Number(node.data?.config?.template)]
  }))
  for (const vm of topology.vms) if (templateIds.has(vm.vm_id)) throw new Error(`VMID ${vm.vm_id} is already a template reference in this project`)
  const address = (ip: unknown) => typeof ip === 'string' ? ip.split('/')[0] : ''
  const used = new Set<string>()
  for (const node of project.nodes) {
    const config = node.data?.config || {}
    if (node.type === 'vm' && config.bridge && config.ipAddress) used.add(`${config.bridge}|${address(config.ipAddress)}`)
    if (node.type === 'network-segment') {
      const bridge = config.vnet || config.bridge || config.name
      const incoming = topology.networks.find(network => network.vnet === bridge)
      if (incoming?.subnet && config.cidr && incoming.subnet !== config.cidr) throw new Error(`Network ${bridge} has a different subnet in this project`)
      for (const edge of project.edges.filter(edge => edge.source === node.id || edge.target === node.id)) {
        const ip = address(edge.data?.connection?.ipAddress)
        if (ip) used.add(`${bridge}|${ip}`)
      }
    }
  }
  for (const vm of [...topology.vms, ...topology.templates]) if (vm.bridge && vm.ip && used.has(`${vm.bridge}|${address(vm.ip)}`)) {
    throw new Error(`Address ${vm.ip} on ${vm.bridge} is already used in this project`)
  }
}
