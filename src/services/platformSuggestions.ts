import type { ProjectDraft } from '@/types/project'
import { isPlatformStack, type PlatformPlan } from './platformComponents'
export interface StackInventory { vmids: number[]; vnets: string[]; subnets: string[] }
function bounds(cidr: string): [number, number] | null {
  if (cidr.includes(':')) return null
  const [address, mask] = cidr.split('/'), parts = address?.split('.').map(Number) || [], bits = Number(mask)
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255) || !Number.isInteger(bits) || bits < 0 || bits > 32) throw new Error('A network has an invalid subnet. Review it before suggesting addresses.')
  const size = 2 ** (32 - bits), start = Math.floor(parts.reduce((n, p) => n * 256 + p, 0) / size) * size
  return [start, start + size - 1]
}
/** Suggestions only. Backend preflight remains authoritative for live resource ownership. */
export function suggestStackSettings(project: ProjectDraft, inventory: StackInventory, count: number, stackId: string) {
  const plans = project.nodes.filter(isPlatformStack).map(n => n.data?.config?.plan as PlatformPlan).filter(Boolean)
  const scenario = project.scenario as { vms?: { vm_id: number }[]; networks?: { vnet: string; subnet: string }[] } | undefined
  const used = new Set([...inventory.vmids, ...plans.flatMap(p => p.vms.map(v => v.vm_id)),
    ...(scenario?.vms || []).map(v => v.vm_id), ...project.nodes.filter(n => n.type === 'vm').map(n => Number(n.data?.vmId || n.data?.config?.vmid))])
  const vmidStarts: number[] = []
  for (let next = 31000; vmidStarts.length < 3 && next + count < 999999999;) {
    const conflict = Array.from({ length: count }, (_, index) => next + index).find(id => used.has(id))
    if (conflict !== undefined) next = conflict + 1
    else { vmidStarts.push(next); next += count }
  }
  const localNetworks = [...(scenario?.networks || []), ...plans.map(p => ({ vnet: p.bridge, subnet: p.subnet })),
    ...project.nodes.filter(n => n.type === 'network-segment').map(n => ({ vnet: String(n.data?.config?.vnet || ''), subnet: String(n.data?.config?.cidr || '') }))]
  const vn = new Set([...inventory.vnets, ...localNetworks.map(n => n.vnet)])
  const occupied = [...inventory.subnets, ...localNetworks.map(n => n.subnet)].filter(Boolean).map(bounds).filter((v): v is [number, number] => !!v)
  const networks: { subnet: string; gateway: string; bridge: string }[] = []
  const stem = ('r42' + stackId.replace(/[^a-z0-9]/g, '')).slice(0, 8)
  let suffix = 0
  for (let index = 80 * 256; index < 256 * 256 && networks.length < 3; index++) {
    const prefix = `10.${Math.floor(index / 256)}.${index % 256}`, subnet = `${prefix}.0/24`, [start, end] = bounds(subnet)!
    if (occupied.some(([a, b]) => start <= b && a <= end)) continue
    let bridge = stem
    while (vn.has(bridge)) { suffix++; const tail = String(suffix); bridge = stem.slice(0, 8 - tail.length) + tail }
    vn.add(bridge)
    networks.push({ subnet, gateway: `${prefix}.1`, bridge })
  }
  return { vmidStarts, networks }
}
