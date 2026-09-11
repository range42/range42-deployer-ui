import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { CanvasEdge, CanvasNode } from '@/overlay/serialize'

export type ScenarioScope = 'shared' | 'per_team' | 'per_user'
interface Cohort { team_id: string | null; user_id: string | null }
interface Team { id: string; users: Array<{ id: string }> }
interface Identity extends Cohort { instance_key: string; source_node_id: string }
interface SourceNic { key: string; network_id: string; ip: unknown }
interface ExpandedVm extends Record<string, unknown> {
  node_id: string; vm_id: unknown; vm_name: string; nics: SourceNic[]; network_id: string; ip: unknown
}
interface ExpandedNetwork extends Record<string, unknown> {
  id: string; vnet: unknown; subnet: unknown; gateway: unknown; snat: unknown
}
interface Instance extends Identity {
  vm_id: number; hostname: string
  nics: Array<{ index: number; nic_key: string; network_instance_key: string }>
}
export interface ScenarioInstancesManifest {
  version: 1; scenario_id: string
  intent: { teams: Team[]; node_scopes: Record<string, ScenarioScope>; network_scopes: Record<string, ScenarioScope> }
  instances: Instance[]
  networks: Array<Identity & { vnet: unknown; subnet: unknown; gateway: unknown; snat: unknown }>
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function record(value: unknown, label: string): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a named object`)
  return Object.fromEntries(Object.entries(value))
}
function rows(value: unknown, label: string): Record<string, unknown>[] {
  requireValue(Array.isArray(value), `${label} must be a list`)
  return value.map(item => record(item, label))
}
function identifier(value: unknown, label: string): string {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value), `${label} must contain 1–128 ASCII letters, numbers, dots, underscores or hyphens`)
  return value
}
function unique(values: string[], label: string) {
  requireValue(new Set(values).size === values.length, `Duplicate ${label}`)
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Stable IDs are independent of roster order and all display labels. */
export function scenarioInstanceKey(kind: 'vm' | 'net', scenarioId: string, sourceId: string, teamId: string | null = null, userId: string | null = null): string {
  identifier(scenarioId, 'Stable scenario ID')
  identifier(sourceId, 'Source node ID')
  if (teamId !== null) identifier(teamId, 'Team ID')
  if (userId !== null) identifier(userId, 'User ID')
  requireValue(userId === null || teamId !== null, 'A user identity must belong to a team')
  const bytes = new TextEncoder().encode(JSON.stringify([scenarioId, sourceId, teamId, userId]))
  return `${kind}-${bytesToHex(sha256(bytes))}`
}
function scopeMap(value: unknown, ids: string[], label: string): Record<string, ScenarioScope> {
  const data = record(value, label)
  requireValue(JSON.stringify(Object.keys(data).sort()) === JSON.stringify([...ids].sort()), `${label} must explicitly name every source and no unknown sources`)
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => compare(a, b)).map(([id, scope]) => {
    requireValue(scope === 'shared' || scope === 'per_team' || scope === 'per_user', `Unsupported replication scope for ${id}: ${scope}`)
    return [id, scope]
  }))
}
function cohorts(scope: ScenarioScope, teams: Team[]): Cohort[] {
  if (scope === 'shared') return [{ team_id: null, user_id: null }]
  if (scope === 'per_team') return teams.map(team => ({ team_id: team.id, user_id: null }))
  return teams.flatMap(team => team.users.map(user => ({ team_id: team.id, user_id: user.id })))
}
function networkCohort(vm: Cohort, scope: ScenarioScope): Cohort {
  if (scope === 'shared') return { team_id: null, user_id: null }
  requireValue(vm.team_id && (scope !== 'per_user' || vm.user_id), 'A shared VM cannot fan out to scoped networks; a team VM cannot select an arbitrary user network')
  return { team_id: vm.team_id, user_id: scope === 'per_user' ? vm.user_id : null }
}
function sourceNics(vm: Record<string, unknown>, edges: CanvasEdge[]): SourceNic[] {
  const connected = edges.filter(edge => edge.source === vm.node_id || edge.target === vm.node_id)
  const nics = rows(vm.nics ?? [{ network_id: vm.network_id, ip: vm.ip }], `NICs for ${vm.node_id}`)
  requireValue(nics.length > 0 && nics.length <= 32, `Choose 1–32 NICs for ${vm.node_id}`)
  const matched = nics.map(nic => {
    const networkId = identifier(nic.network_id, 'Source network ID')
    const candidates = connected.filter(edge => (edge.source === vm.node_id ? edge.target : edge.source) === networkId
      && (nic.key === undefined || nic.key === edge.id))
    requireValue(candidates.length === 1, `NIC for ${vm.node_id}/${networkId} needs its exact canvas edge key; parallel links must have explicit keys`)
    return { key: identifier(candidates[0].id, 'NIC edge key'), network_id: networkId, ip: nic.ip }
  })
  unique(matched.map(nic => nic.key), 'source NIC key')
  requireValue(matched.length === connected.length, `NICs for ${vm.node_id} must match every canvas connection`)
  const primaryKey = vm.primary_nic_key ?? matched[0].key
  requireValue(matched.some(nic => nic.key === primaryKey), `Primary NIC key is missing for ${vm.node_id}`)
  return matched.sort((a, b) => a.key === primaryKey ? -1 : b.key === primaryKey ? 1 : compare(a.key, b.key))
}

function validateCanvas(nodes: CanvasNode[], edges: CanvasEdge[], nodeScopes: Record<string, ScenarioScope>, networkScopes: Record<string, ScenarioScope>) {
  unique(nodes.map(node => identifier(node.id, 'Canvas node ID')), 'canvas node ID')
  unique(edges.map(edge => identifier(edge.id, 'Canvas edge ID')), 'canvas edge ID')
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const [type, scopes] of [['vm', nodeScopes], ['network-segment', networkScopes]] as const) {
    requireValue(JSON.stringify(nodes.filter(node => node.type === type).map(node => node.id).sort()) === JSON.stringify(Object.keys(scopes).sort()), `Source ${type} configuration must match the canvas exactly`)
  }
  for (const node of nodes) {
    requireValue(['vm', 'network-segment', 'group'].includes(node.type || ''), `Unsupported canvas source kind: ${node.type}`)
    const scope = nodeScopes[node.id] ?? networkScopes[node.id]
    for (const raw of [node.replication, node.data?.replication]) {
      if (raw === undefined) continue
      const declared = record(raw, 'Canvas replication').scope
      requireValue(declared === 'shared' || declared === 'per_team' || declared === 'per_user', `Unsupported canvas replication scope for ${node.id}`)
      if (node.type !== 'group') requireValue(declared === scope, `Canvas replication scope conflicts with explicit source scope for ${node.id}`)
    }
    const visited = new Set<string>()
    let cursor: CanvasNode | undefined = node
    let domains = 0
    while (cursor) {
      requireValue(!visited.has(cursor.id), 'Canvas parent cycle is not supported')
      visited.add(cursor.id)
      if (cursor.type === 'group' && cursor.data?.kind === 'team_scope') domains++
      requireValue(domains <= 1, 'Nested replication domains are not supported; declare one roster and explicit source scopes')
      const parent: string | undefined = cursor.parentNode ?? cursor.parent
      requireValue(!parent || byId.get(parent)?.type === 'group', 'Canvas parent must name an existing group')
      cursor = parent ? byId.get(parent) : undefined
    }
  }
  for (const edge of edges) {
    const vm = Object.hasOwn(nodeScopes, edge.source) ? edge.source : edge.target
    const network = vm === edge.source ? edge.target : edge.source
    requireValue(Object.hasOwn(nodeScopes, vm) && Object.hasOwn(networkScopes, network), 'Every source canvas edge must connect a VM to a declared network')
    const ranks = { shared: 0, per_team: 1, per_user: 2 }
    requireValue(ranks[nodeScopes[vm]] >= ranks[networkScopes[network]], 'A shared VM cannot fan out to scoped networks; a team VM cannot select an arbitrary user network')
  }
}

/** Expand authoring intent into literal deployment rows without mutating the source canvas. */
export function expandScenarioReplication(input: { scenario: unknown; nodes: CanvasNode[]; edges: CanvasEdge[] }) {
  const scenario = record(input.scenario, 'Scenario')
  if (scenario.replication === undefined) return null
  const replication = record(scenario.replication, 'Replication')
  requireValue(replication.version === 1, 'Unsupported replication document version')
  const scenarioId = identifier(replication.scenario_id, 'Stable scenario ID')
  const teams = rows(replication.teams, 'Teams').map(team => ({ id: identifier(team.id, 'Team ID'),
    users: rows(team.users, 'Team users').map(user => ({ id: identifier(user.id, 'User ID') })).sort((a, b) => compare(a.id, b.id)),
  })).sort((a, b) => compare(a.id, b.id))
  requireValue(teams.length <= 64, 'Replication allows at most 64 teams')
  requireValue(teams.reduce((sum, team) => sum + team.users.length, 0) <= 64, 'Replication allows at most 64 total users')
  unique(teams.map(team => team.id), 'team ID')
  for (const team of teams) unique(team.users.map(user => user.id), `user ID in team ${team.id}`)
  const sourceVms = rows(scenario.vms, 'Source VMs').sort((a, b) => compare(String(a.node_id), String(b.node_id)))
  const sourceNetworks = rows(scenario.networks, 'Source networks').sort((a, b) => compare(String(a.id), String(b.id)))
  const nodeScopes = scopeMap(replication.node_scopes, sourceVms.map(vm => identifier(vm.node_id, 'Source VM ID')), 'VM scopes')
  const networkScopes = scopeMap(replication.network_scopes, sourceNetworks.map(network => identifier(network.id, 'Source network ID')), 'Network scopes')
  validateCanvas(input.nodes, input.edges, nodeScopes, networkScopes)
  const scopes = [...Object.values(nodeScopes), ...Object.values(networkScopes)]
  requireValue(!scopes.some(scope => scope !== 'shared') || teams.length > 0, 'Replicated scopes require a nonempty team roster')
  requireValue(!scopes.includes('per_user') || teams.every(team => team.users.length > 0), 'Per-user scopes require listed users in every team')
  const vmCount = Object.values(nodeScopes).reduce((sum, scope) => sum + cohorts(scope, teams).length, 0)
  const networkCount = Object.values(networkScopes).reduce((sum, scope) => sum + cohorts(scope, teams).length, 0)
  requireValue(vmCount > 0 && vmCount <= 64, 'Replication must produce 1–64 VMs')
  requireValue(networkCount > 0 && networkCount <= 32, 'Replication must produce 1–32 networks')
  const sourceNicMap = new Map(sourceVms.map(vm => [String(vm.node_id), sourceNics(vm, input.edges)]))
  const nicCount = sourceVms.reduce((sum, vm) => sum + sourceNicMap.get(String(vm.node_id))!.length * cohorts(nodeScopes[String(vm.node_id)], teams).length, 0)
  requireValue(nicCount <= 256, 'Replication cannot exceed 256 total NICs')
  const sourceContent = rows(scenario.content ?? [], 'Content')
  unique(sourceContent.map(item => identifier(item.id, 'Content ID')), 'source content ID')
  for (const item of sourceContent) requireValue(typeof item.target_node === 'string' && Object.hasOwn(nodeScopes, item.target_node), `Select a VM target for content ${item.id}`)
  const vmAssignments = record(replication.vm_assignments ?? {}, 'VM assignments')
  const networkAssignments = record(replication.network_assignments ?? {}, 'Network assignments')
  const identity = (kind: 'vm' | 'net', sourceId: string, cohort: Cohort): Identity => ({
    instance_key: scenarioInstanceKey(kind, scenarioId, sourceId, cohort.team_id, cohort.user_id), source_node_id: sourceId, ...cohort,
  })
  const manifest: ScenarioInstancesManifest = { version: 1, scenario_id: scenarioId,
    intent: { teams, node_scopes: nodeScopes, network_scopes: networkScopes }, instances: [], networks: [] }
  const networks: ExpandedNetwork[] = sourceNetworks.flatMap(source => {
    const id = identifier(source.id, 'Source network ID')
    return cohorts(networkScopes[id], teams).map(cohort => {
      const item = identity('net', id, cohort)
      const assigned = networkScopes[id] === 'shared' ? source : record(networkAssignments[item.instance_key], `Review subnet/VNet assignment for ${id}/${cohort.team_id}/${cohort.user_id ?? 'team'}`)
      const row = { ...clone(source), id: item.instance_key, vnet: assigned.vnet, subnet: assigned.subnet, gateway: assigned.gateway, snat: assigned.snat }
      if (scenario.network_mode === 'existing_bridge') {
        requireValue(typeof row.vnet === 'string' && /^vmbr[0-9]+$/.test(row.vnet) && row.vnet.length <= 15, 'Existing bridge names must be vmbr plus digits, at most 15 characters')
        requireValue(row.snat === false, 'Existing bridges cannot declare managed SNAT')
      }
      manifest.networks.push({ ...item, vnet: row.vnet, subnet: row.subnet, gateway: row.gateway, snat: row.snat })
      return row
    })
  })
  const expandedEdges: CanvasEdge[] = []
  const vms: ExpandedVm[] = sourceVms.flatMap(source => {
    const id = identifier(source.node_id, 'Source VM ID')
    const nics = sourceNicMap.get(id)!
    return cohorts(nodeScopes[id], teams).map(cohort => {
      const item = identity('vm', id, cohort)
      const assigned = nodeScopes[id] === 'shared' ? source : record(vmAssignments[item.instance_key], `Review VM/IP assignment for ${id}/${cohort.team_id}/${cohort.user_id ?? 'team'}`)
      const assignedNics = nodeScopes[id] === 'shared' ? null : record(assigned.nics, `NIC assignments for ${item.instance_key}`)
      if (assignedNics) requireValue(JSON.stringify(Object.keys(assignedNics).sort()) === JSON.stringify(nics.map(nic => nic.key).sort()), `NIC assignments must match the current source NIC keys for ${id}`)
      const mappedNics = nics.map(nic => {
        const target = networkCohort(cohort, networkScopes[nic.network_id])
        const networkId = scenarioInstanceKey('net', scenarioId, nic.network_id, target.team_id, target.user_id)
        requireValue(networks.some(network => network.id === networkId), `Missing matching network instance for ${id}/${nic.key}`)
        const ip = assignedNics ? record(assignedNics[nic.key], `IP assignment for ${id}/${nic.key}`).ip : nic.ip
        expandedEdges.push({ id: `${item.instance_key}:${nic.key}`, source: item.instance_key, target: networkId })
        return { key: nic.key, network_id: networkId, ip }
      })
      requireValue(typeof source.vm_name === 'string', 'Source VM name is required')
      const prefix = source.vm_name.replace(/[^A-Za-z0-9-]/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 50) || 'vm'
      const hostname = nodeScopes[id] === 'shared' ? source.vm_name : `${prefix}-${item.instance_key.slice(3, 15)}`
      const vm = { ...clone(source), node_id: item.instance_key, vm_id: assigned.vm_id, vm_name: hostname,
        nics: mappedNics, network_id: mappedNics[0].network_id, ip: mappedNics[0].ip }
      manifest.instances.push({ ...item, vm_id: Number(vm.vm_id), hostname,
        nics: mappedNics.map((nic, index) => ({ index, nic_key: nic.key, network_instance_key: nic.network_id })) })
      return vm
    })
  })
  const content = sourceContent.flatMap(source => manifest.instances.filter(vm => vm.source_node_id === source.target_node)
    .map(vm => ({ ...clone(source), id: `${source.id}:${vm.instance_key}`, target_node: vm.instance_key })))
  const expandedNodes: CanvasNode[] = [...vms.map(vm => ({ id: vm.node_id, type: 'vm' })), ...networks.map(network => ({ id: network.id, type: 'network-segment' }))]
  const warnings = manifest.networks.filter(network => manifest.instances.filter(vm => vm.nics.some(nic => nic.network_instance_key === network.instance_key)).length > 1)
    .map(network => `Instances on ${network.vnet} share a subnet and its internet policy (SNAT ${network.snat ? 'enabled' : 'disabled'}). Per-user internet isolation requires per-user networks.`)
  return { scenario: { ...clone(scenario), vms, networks, content }, nodes: expandedNodes, edges: expandedEdges, manifest,
    counts: { vms: vmCount, networks: networkCount, nics: nicCount }, warnings }
}
