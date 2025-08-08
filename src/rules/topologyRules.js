// Rule-based topology generation for Range42
// This module builds a JSON topology from VueFlow nodes/edges
// and applies networking rules (e.g., DHCP vs Static IP assignment)

// Public API
// - generateTopologyExport(nodes, edges): returns enriched topology JSON

// --- Utilities ---
function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + (parseInt(oct, 10) || 0), 0) >>> 0
}

function intToIp(int) {
  return [24, 16, 8, 0].map(shift => ((int >>> shift) & 255)).join('.')
}

function parseCIDR(cidr) {
  if (!cidr || typeof cidr !== 'string' || !cidr.includes('/')) return null
  const [base, maskStr] = cidr.split('/')
  const maskBits = parseInt(maskStr, 10)
  if (Number.isNaN(maskBits) || maskBits < 0 || maskBits > 32) return null
  const baseInt = ipToInt(base)
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0
  const network = baseInt & mask
  const broadcast = network | (~mask >>> 0)
  const firstUsable = maskBits >= 31 ? network : network + 1
  const lastUsable = maskBits >= 31 ? network : broadcast - 1
  return { base, maskBits, network, broadcast, firstUsable, lastUsable }
}

function* hostIterator(cidrInfo, options = {}) {
  const { skip = new Set(), startFrom } = options
  if (!cidrInfo) return
  let current = typeof startFrom === 'number' ? Math.max(startFrom, cidrInfo.firstUsable) : cidrInfo.firstUsable
  while (current <= cidrInfo.lastUsable) {
    if (!skip.has(current)) {
      yield current
    }
    current++
  }
}

// Build adjacency from edges
function buildAdjacency(edges = []) {
  const bySource = new Map()
  const byTarget = new Map()
  edges.forEach(e => {
    if (!bySource.has(e.source)) bySource.set(e.source, new Set())
    if (!byTarget.has(e.target)) byTarget.set(e.target, new Set())
    bySource.get(e.source).add(e.target)
    byTarget.get(e.target).add(e.source)
  })
  return { bySource, byTarget }
}

// Determine if a DHCP service is available for a given network
function hasDhcpForNetwork(network, nodesById, adj) {
  // Consider either:
  // - network.data.config.dhcp === true
  // - a 'dhcp' node is a child of the network (parentNode)
  // - a 'dhcp' node is connected to the network via edge (either direction)
  const cfg = network?.data?.config || {}
  if (cfg.dhcp === true) return true

  // Child search
  const dhcpChild = Object.values(nodesById).some(n => n.type === 'dhcp' && n.parentNode === network.id)
  if (dhcpChild) return true

  // Edge-based search
  const neighbors = new Set([...(adj.bySource.get(network.id) || []), ...(adj.byTarget.get(network.id) || [])])
  for (const neighborId of neighbors) {
    const n = nodesById[neighborId]
    if (n && n.type === 'dhcp') return true
  }

  return false
}

// Plan IP assignments for VMs within a network
function planNetworkIPs(network, members, nodesById) {
  const cfg = network?.data?.config || {}
  const cidrInfo = parseCIDR(cfg.cidr)
  if (!cidrInfo) {
    return {
      method: 'unknown',
      reason: 'invalid_cidr',
      allocations: {}
    }
  }

  const skip = new Set()
  // Reserve gateway if within range
  if (cfg.gateway) {
    const gwInt = ipToInt(cfg.gateway)
    if (gwInt >= cidrInfo.firstUsable && gwInt <= cidrInfo.lastUsable) skip.add(gwInt)
  }

  // Also reserve the first few (.1-.9) for infra by convention, start at .10
  const startFrom = Math.max(cidrInfo.firstUsable, ipToInt(intToIp((cidrInfo.network >>> 0) + 10)))

  const allocations = {}

  const iter = hostIterator(cidrInfo, { skip, startFrom })

  members.forEach(nodeId => {
    const node = nodesById[nodeId]
    if (!node) return
    if (node.type !== 'vm') return

    const next = iter.next()
    if (!next.done) {
      allocations[nodeId] = intToIp(next.value)
    }
  })

  return {
    method: 'static',
    reason: 'no_dhcp_detected',
    allocations
  }
}

// Build base topology
function buildBaseTopology(nodes = [], edges = []) {
  const nodesById = {}
  nodes.forEach(n => { nodesById[n.id] = n })

  const networks = []
  const hosts = []
  const services = []
  const others = []

  nodes.forEach(n => {
    switch (n.type) {
      case 'network-segment':
        networks.push(n)
        break
      case 'vm':
        hosts.push(n)
        break
      case 'docker':
      case 'dns':
      case 'dhcp':
      case 'loadbalancer':
        services.push(n)
        break
      default:
        others.push(n)
    }
  })

  const adj = buildAdjacency(edges)

  // Build per-node connection lists
  const nodeConnections = {}
  nodes.forEach(n => {
    nodeConnections[n.id] = {
      incoming: Array.from(adj.byTarget.get(n.id) || []),
      outgoing: Array.from(adj.bySource.get(n.id) || [])
    }
  })

  // Group nodes by parent network
  const networkMembers = new Map()
  networks.forEach(net => networkMembers.set(net.id, []))
  nodes.forEach(n => {
    if (n.parentNode && networkMembers.has(n.parentNode)) {
      networkMembers.get(n.parentNode).push(n.id)
    }
  })

  return { nodesById, networks, hosts, services, others, edges, adj, nodeConnections, networkMembers }
}

// Apply rules and construct export JSON
export function generateTopologyExport(nodes = [], edges = []) {
  const base = buildBaseTopology(nodes, edges)
  const { nodesById, networks, hosts, services, adj, nodeConnections, networkMembers } = base

  const topology = {
    version: 1,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      networks: networks.length,
      hosts: hosts.length,
      services: services.length
    },
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      label: n.data?.label,
      status: n.data?.status,
      parent: n.parentNode || null,
      position: n.position || null,
      config: n.data?.config || {}
    })),
    edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label || null })),
    networks: [],
    hosts: [],
    services: [],
    rules: []
  }

  // Populate base lists
  topology.hosts = hosts.map(h => ({
    id: h.id,
    name: h.data?.config?.name || h.id,
    os: h.data?.config?.os || 'Ubuntu 22.04',
    cpu: h.data?.config?.cpu || 2,
    memory: h.data?.config?.memory || '2GB',
    parentNetworkId: h.parentNode || null,
    connections: nodeConnections[h.id],
    networkInterfaces: [] // to be filled by rules
  }))

  topology.services = services.map(s => ({
    id: s.id,
    type: s.type,
    name: s.data?.config?.name || s.id,
    parentNetworkId: s.parentNode || null,
    connections: nodeConnections[s.id],
    config: s.data?.config || {}
  }))

  // For each network, decide IP assignment strategy and allocate as needed
  networks.forEach(net => {
    const cfg = net.data?.config || {}
    const members = networkMembers.get(net.id) || []
    const dhcpPresent = hasDhcpForNetwork(net, nodesById, adj)

    let ipPlan
    if (dhcpPresent) {
      ipPlan = { method: 'dhcp', reason: 'dhcp_detected', allocations: {} }
    } else {
      ipPlan = planNetworkIPs(net, members, nodesById)
    }

    // Apply IPs to host interfaces
    members.forEach(nodeId => {
      const host = topology.hosts.find(h => h.id === nodeId)
      if (!host) return
      const iface = { networkId: net.id, method: ipPlan.method, address: null }
      if (ipPlan.method === 'static' && ipPlan.allocations[nodeId]) {
        iface.address = ipPlan.allocations[nodeId]
      }
      host.networkInterfaces.push(iface)
    })

    topology.networks.push({
      id: net.id,
      name: cfg.name || net.id,
      cidr: cfg.cidr || null,
      gateway: cfg.gateway || null,
      vlan: cfg.vlan || null,
      dhcpFlag: cfg.dhcp === true,
      members,
      ipPlan
    })
  })

  // Document rules that were applied
  topology.rules.push({
    id: 'net-001',
    description: 'If a VM is inside a network segment and DHCP is present, set interface method to dhcp; else assign static IP from CIDR.',
    scope: 'network-segment',
    version: 1
  })

  return topology
}
