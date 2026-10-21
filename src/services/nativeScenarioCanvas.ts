import type { CanvasNode, CanvasEdge } from '@/overlay/serialize'
import type { ProjectDraft } from '@/types/project'
import { fileText, type ProjectFiles } from '@/services/projectFiles'
import { parse } from 'yaml'

export interface NativeTopology {
  vms: Array<{ vm_id: number; vm_name?: string; ip?: string; bridge?: string; role?: string; group?: string;
    nics?: Array<{index: number; bridge: string; ip?: string; prefix?: number}>;
    seat?: number; cores?: number; memory_mib?: number; disk_gib?: number; requires_features?: string[] }>
  templates: Array<{ vm_id: number; vm_name?: string; bridge?: string; ip?: string }>
  networks: Array<{ vnet: string; subnet?: string; gateway?: string }>
  warnings: string[]
  reservations: { status: 'checked' | 'missing' | 'conflict' | 'invalid'; issues: string[] }
}

export interface NativeFeature { id: string; label?: string; description?: string; default: boolean }
export interface NativeWorkshop { version: 1; kind: 'native-installation'; title: string; min_seats: number; max_seats: number }
export interface NativePreparation {version: 1; kind: 'native-workshop-foundation'; title: string}

/** Preview the same pinned local declarations that the native playbook will read. */
export function nativePreviewFromFiles(files: ProjectFiles, path: string): { topology: NativeTopology; features: NativeFeature[]; workshop?: NativeWorkshop; preparation?: NativePreparation } {
  const read = (name: string) => files[`${path}/manifest/${name}`]
  const manifest = JSON.parse(fileText(read('scenario_vms.json')!))
  const networks = read('scenario_networks.json') ? JSON.parse(fileText(read('scenario_networks.json')!)).networks : []
  const flags = read('feature_flags.yml') ? parse(fileText(read('feature_flags.yml')!)) : {}
  const declaredWorkshop = read('workshop.json') !== undefined
  const preparation: NativePreparation | undefined = read('preparation.json') === undefined ? undefined : JSON.parse(fileText(read('preparation.json')!))
  if (read('preparation.json') !== undefined && (!preparation || Object.keys(preparation).some(key => !['version', 'kind', 'title'].includes(key))
    || preparation.version !== 1 || preparation.kind !== 'native-workshop-foundation' || typeof preparation.title !== 'string'
    || !preparation.title.trim() || preparation.title.length > 120 || declaredWorkshop || read('platform.json') !== undefined)) throw new Error('Invalid native foundation descriptor')
  const workshop: NativeWorkshop | undefined = declaredWorkshop ? JSON.parse(fileText(read('workshop.json')!)) : undefined
  if (declaredWorkshop && (!workshop || Object.keys(workshop).some(key => !['version', 'kind', 'title', 'min_seats', 'max_seats'].includes(key)) || workshop.version !== 1 || workshop.kind !== 'native-installation'
    || typeof workshop.title !== 'string' || !workshop.title.trim() || workshop.title.length > 120
    || !Number.isInteger(workshop.min_seats) || !Number.isInteger(workshop.max_seats)
    || workshop.min_seats < 1 || workshop.max_seats > 10 || workshop.min_seats > workshop.max_seats)) throw new Error('Invalid native workshop descriptor')
  const topology: NativeTopology = { vms: manifest.vms, templates: manifest.templates || [], networks: networks || [],
    warnings: ['Declared resources; playbook conditions and the saved deployment parameters determine the effective deployment.'],
    reservations: { status: 'missing', issues: ['Source declarations; live allocation checks run during preflight.'] } }
  nativeScenarioCanvas('validation', 'Native scenario', path, topology)
  return { topology, features: Array.isArray(flags?.features) ? flags.features : [], ...(workshop ? {workshop} : {}), ...(preparation ? {preparation} : {}) }
}

export function selectNativeTopology(topology: NativeTopology, features: Record<string, boolean>, seat = 0): NativeTopology {
  const vms = topology.vms.filter(vm => !vm.requires_features?.some(flag => !features[flag]) && (!seat || vm.seat === seat))
  const bridges = new Set(vms.map(vm => vm.bridge))
  const declaredBridges = new Set(topology.vms.map(vm => vm.bridge))
  return { ...topology, vms, networks: topology.networks.filter(network => !declaredBridges.has(network.vnet) || bridges.has(network.vnet)) }
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
  for (const vm of topology.vms) {
    if (vm.bridge && !networks.has(vm.bridge)) networks.set(vm.bridge, { vnet: vm.bridge })
    if (vm.nics) {
      if (!Array.isArray(vm.nics) || vm.nics.length > 32 || vm.nics.some((nic, index) => nic.index !== index
        || typeof nic.bridge !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,14}$/.test(nic.bridge))) throw new Error('Refresh the native scenario to load valid interface identities')
      for (const nic of vm.nics) if (!networks.has(nic.bridge)) networks.set(nic.bridge, {vnet: nic.bridge})
    }
  }
  const networkIds = new Map<string, string>()
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
    if (network) {
      networkIds.set(network.vnet, networkId)
      nodes.push(owned(networkId, 'network-segment', network.vnet, (rowWidth - 280) / 2, networkY,
        { name: network.vnet, bridge: network.vnet, vnet: network.vnet, cidr: network.subnet, gateway: network.gateway, segmentType: 'management' }))
    }
    for (const [i, vm] of vms.entries()) {
      const vmId = `${id}-vm-${vm.vm_id}`
      nodes.push(owned(vmId, 'vm', vm.vm_name || `VM ${vm.vm_id}`, 40 + (i % 4) * 340, y + Math.floor(i / 4) * 210,
        { name: vm.vm_name || `VM ${vm.vm_id}`, vmid: vm.vm_id, ipAddress: vm.ip, bridge: vm.bridge,
          description: vm.group || vm.role || 'Declared scenario VM', cores: vm.cores, memory_mib: vm.memory_mib,
          disk_gib: vm.disk_gib, ...(vm.nics ? {nics: vm.nics} : {}) }))
    }
    y = networkY + 260
  }
  const connected = new Map<string, number>()
  for (const vm of topology.vms) {
    const nics = vm.nics || (vm.bridge ? [{index: 0, bridge: vm.bridge, ip: vm.ip}] : [])
    for (const nic of nics) {
      const target = networkIds.get(nic.bridge), network = networks.get(nic.bridge)
      if (!target || !network) continue
      const ordinal = connected.get(nic.bridge) || 0
      connected.set(nic.bridge, ordinal + 1)
      const vmId = `${id}-vm-${vm.vm_id}`, prefix = 'prefix' in nic ? nic.prefix : undefined
      const suffix = prefix ? `/${prefix}` : network.subnet ? `/${network.subnet.split('/')[1]}` : ''
      edges.push({id: `${vmId}-net${nic.index}`, type: 'network', source: vmId, target,
        targetHandle: `top-${Math.min(3, ordinal % 4 + 1)}`, data: {useDhcp: false, connection: {
          interfaceName: `net${nic.index}`, interfaceModel: 'virtio', ipAddress: nic.ip ? nic.ip + suffix : '',
        }}})
    }
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
