import type { CanvasNode } from '@/overlay/serialize'
import type { ProjectDraft } from '@/types/project'
import { validateAuthoredFiles, type ProjectFiles } from '@/services/projectFiles'
import { nativeScenario, type NativeScenario } from '@/services/nativeScenario'

export interface PlatformPlan {
  id: string; domain: string; profile: string; bridge: string; subnet: string
  vms: { service: string; vm_id: number; vm_name: string }[]
  [key: string]: unknown
}
export interface PlatformComponent { version: 1; plan: PlatformPlan; scenario: NativeScenario; files: ProjectFiles }

export function platformSelection(node: Pick<CanvasNode, 'type' | 'data'>): NativeScenario | undefined {
  if (node.type !== 'range42-stack') return undefined
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
  const peers = project.nodes.filter(node => node.type === 'range42-stack').map(node => node.data?.config?.plan as PlatformPlan)
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
  const x = Math.max(0, ...project.nodes.map(node => (node.position?.x || 0) + 340))
  project.nodes.push({ id, type: 'range42-stack', position: { x, y: 80 },
    data: { label: `Range42 ${component.plan.id}`, config: { name: `Range42 ${component.plan.id}`, scenario: component.scenario, plan: component.plan } } })
  project.files = files
  return project
}
