import type { CanvasNode, CanvasEdge } from '@/overlay/serialize'
import type { ProjectDraft } from '@/types/project'
import { validateAuthoredFiles, type ProjectFiles } from '@/services/projectFiles'
import { nativeScenario, type NativeScenario } from '@/services/nativeScenario'

export interface PlatformPlan {
  id: string; domain: string; profile: string; bridge: string; subnet: string
  vms: { service: string; vm_id: number; vm_name: string; ip?: string; template_vmid?: number }[]
  [key: string]: unknown
}
export interface PlatformComponent { version: 1; plan: PlatformPlan; scenario: NativeScenario; files: ProjectFiles }

type PlatformNode = Pick<CanvasNode, 'type' | 'data'>
export function isPlatformStack(node: PlatformNode): boolean {
  return node.type === 'range42-stack' || (node.type === 'group' && typeof node.data?.config?.platformStack === 'string' && !!node.data.config.scenario)
}
export function isPlatformResource(node: PlatformNode): boolean {
  return isPlatformStack(node) || node.type === 'platform-vm' || node.type === 'platform-network' || typeof node.data?.config?.platformStack === 'string'
}

export function platformSelection(node: Pick<CanvasNode, 'type' | 'data'>): NativeScenario | undefined {
  if (!isPlatformStack(node)) return undefined
  const selection = nativeScenario(node.data?.config?.scenario)
  if (!/^platforms\/[a-z][a-z0-9-]{0,23}$/.test(selection.path)) throw new Error('Invalid stack scenario path')
  return selection
}
function range(cidr: string): [number, number] {
  const [ip, bits] = cidr.split('/')
  const parts = ip?.split('.').map(Number) || []
  const prefix = Number(bits)
  if (parts.length !== 4 || parts.some(v => !Number.isInteger(v) || v < 0 || v > 255) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error('Review the existing network subnet before adding a stack')
  const start = parts.reduce((result, part) => result * 256 + part, 0), size = 2 ** (32 - prefix)
  return [Math.floor(start / size) * size, Math.floor(start / size) * size + size - 1]
}

/** Return one complete candidate; the caller persists it only after review. */
export function appendPlatformComponent(original: ProjectDraft, component: PlatformComponent): ProjectDraft {
  if (original.native_scenario) throw new Error('Add the stack to a canvas project')
  if (component.version !== 1 || !/^[a-z][a-z0-9-]{0,23}$/.test(component.plan.id)
    || component.scenario.path !== `platforms/${component.plan.id}` || !component.plan.vms.length) throw new Error('Invalid platform component')
  const project = JSON.parse(JSON.stringify(original)) as ProjectDraft
  const id = `platform-${component.plan.id}`
  if (project.nodes.some(node => node.id === id || platformSelection(node)?.path === component.scenario.path)) throw new Error('A stack with this name already exists in the project')
  const peers = project.nodes.filter(isPlatformStack).map(node => node.data?.config?.plan as PlatformPlan)
  const vmids = new Set([
    ...((project.scenario?.vms || []) as { vm_id: number }[]).map(vm => Number(vm.vm_id)),
    ...project.nodes.filter(node => node.type === 'vm').map(node => Number(node.data?.vmId || node.data?.config?.vmid)),
    ...peers.flatMap(peer => peer.vms.map(vm => vm.vm_id)),
  ])
  if (component.plan.vms.some(vm => vmids.has(vm.vm_id))) throw new Error('A stack VMID is already used in this project')
  const networks = [
    ...((project.scenario?.networks || []) as { subnet: string; vnet: string }[]),
    ...project.nodes.filter(node => node.type === 'network-segment').map(node => ({ subnet: String(node.data?.config?.cidr || ''), vnet: node.data?.config?.vnet })),
    ...peers.map(peer => ({ subnet: peer.subnet, vnet: peer.bridge })),
  ]
  const [start, end] = range(component.plan.subnet)
  for (const network of networks) {
    if (network.vnet === component.plan.bridge) throw new Error('The stack network name already exists in this project')
    if (!network.subnet) continue
    const [otherStart, otherEnd] = range(network.subnet)
    if (start <= otherEnd && otherStart <= end) throw new Error('The stack subnet overlaps an existing project network')
  }
  if (peers.some(peer => peer.domain === component.plan.domain || peer.domain.endsWith('.' + component.plan.domain) || component.plan.domain.endsWith('.' + peer.domain))) throw new Error('The stack domain overlaps another stack in this project')
  const files = { ...project.files }
  for (const [path, content] of Object.entries(component.files)) {
    if (!path.startsWith(component.scenario.path + '/') && !path.startsWith('platform_runtime/')) throw new Error('Stack files must stay inside their component directories')
    if (Object.hasOwn(files, path) && files[path] !== content) throw new Error(`Stack file already exists with different content: ${path}`)
    files[path] = content
  }
  validateAuthoredFiles(files)
  const x = Math.max(0, ...project.nodes.filter(node => !node.parentNode && !node.parent).map(node => {
    const width = typeof node.style === 'object' && node.style ? Number.parseFloat(String((node.style as Record<string, unknown>).width)) : 0
    return (node.position?.x || 0) + (width || 280) + 80
  }))
  project.nodes.push({ id, type: 'group', position: { x, y: 80 },
    data: { label: `Range42 ${component.plan.id}`, config: { name: `Range42 ${component.plan.id}`, platformStack: id, scenario: component.scenario, plan: component.plan } } })
  project.files = files
  Object.assign(project, expandPlatformCanvas(project.nodes, project.edges))
  return project
}

/** Migrate saved stack cards to the same nodes and edges used by manual authoring. */
export function expandPlatformCanvas(sourceNodes: CanvasNode[], sourceEdges: CanvasEdge[]) {
  const nodes = sourceNodes.map(node => ({ ...node })), edges = [...sourceEdges]
  for (const group of nodes.filter(isPlatformStack)) {
    const plan = group.data?.config?.plan as PlatformPlan | undefined
    if (!plan?.vms?.length) continue
    group.type = 'group'
    group.data = { ...group.data, type: 'group', kind: 'topology_group', hasChildren: true,
      config: { ...group.data?.config, platformStack: group.id, description: plan.domain } }
    const networkId = `${group.id}-network`
    const oldNetwork = nodes.find(node => node.id === networkId)
    const unchangedLegacyGrid = oldNetwork?.type === 'platform-network' && oldNetwork.position?.x === 345 && oldNetwork.position?.y === 140
      && plan.vms.every((vm, index) => {
        const node = nodes.find(node => node.id === `${group.id}-${vm.service}`)
        return node?.type === 'platform-vm' && node.position?.x === 30 + (index % 3) * 310 && node.position?.y === 285 + Math.floor(index / 3) * 160
      })
    const existingChildren = !unchangedLegacyGrid && nodes.some(node => (node.parentNode || node.parent) === group.id)
    const resource = (id: string, type: string, label: string, config: Record<string, unknown>) => {
      let node = nodes.find(node => node.id === id)
      if (!node) {
        node = { id, parentNode: group.id, extent: 'parent', position: { x: 0, y: 0 } }
        nodes.push(node)
      }
      node.type = type
      node.data = { ...node.data, type, label,
        config: { ...node.data?.config, ...config, platformStack: group.id } }
      return node
    }
    const network = resource(networkId, 'network-segment', plan.bridge, {
      name: plan.bridge, segmentType: 'management', bridge: plan.bridge, vnet: plan.bridge, cidr: plan.subnet, gateway: plan.gateway,
    })
    // Two rows leave a clear band for each set of interface labels.
    const columns = Math.ceil(plan.vms.length / 2)
    const width = Math.max(760, 80 + columns * 280 + (columns - 1) * 60)
    if (!existingChildren) network.position = { x: (width - 280) / 2, y: 340 }
    plan.vms.forEach((vm, index) => {
      const id = `${group.id}-${vm.service}`
      const node = resource(id, 'vm', vm.vm_name, { name: vm.vm_name, vmid: vm.vm_id, template: vm.template_vmid, ipAddress: vm.ip,
        description: vm.service, ssh_user: plan.ssh_user, dns_servers: plan.dns })
      if (!existingChildren) {
        const row = index < columns ? 0 : 1
        const count = row ? plan.vms.length - columns : columns
        node.position = { x: (width - (count * 280 + (count - 1) * 60)) / 2 + (index % columns) * 340, y: row ? 740 : 120 }
      }
      const edgeId = `${networkId}-${id}`
      const oldIndex = edges.findIndex(edge => edge.id === edgeId)
      // Existing standard edges retain their ports, labels and authored data.
      if (oldIndex >= 0 && edges[oldIndex].type === 'network') return
      const networkAbove = (network.position?.y || 0) < (node.position?.y || 0)
      const edge: CanvasEdge = { id: edgeId, type: 'network',
        ...(networkAbove ? { source: networkId, target: id, sourceHandle: 'out-bottom' }
          : { source: id, target: networkId, targetHandle: `top-${Math.min(3, Math.floor(index * 3 / columns) + 1)}` }),
        data: { useDhcp: false, connection: { interfaceName: 'net0', interfaceModel: 'virtio',
          ipAddress: vm.ip ? `${vm.ip}/${plan.subnet.split('/')[1]}` : '', firewall: true, vlanTag: null } } }
      if (oldIndex >= 0) edges[oldIndex] = edge
      else edges.push(edge)
    })
    if (!existingChildren) group.style = { width: `${width}px`, height: '900px' }
    else group.style ||= { width: '960px', height: `${290 + Math.ceil(plan.vms.length / 3) * 160}px` }
  }
  return { nodes, edges }
}
