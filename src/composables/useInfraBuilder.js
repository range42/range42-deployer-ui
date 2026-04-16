import { ref } from 'vue'
import { useVueFlow, applyNodeChanges, applyEdgeChanges, addEdge } from '@vue-flow/core'

// Node types that represent compute resources
const COMPUTE_TYPES = ['vm', 'lxc', 'edge-firewall', 'router']
// Node types that represent networks
const NETWORK_TYPES = ['network-segment']
// Docker must tether to one of these host types (spec §7 — container layer)
const DOCKER_HOST_TYPES = ['vm', 'lxc']

/**
 * Return the team_scope group id (if any) that contains the given node.
 * Nodes may declare parentage via VueFlow's `parentNode` (preferred) or
 * `parent` (legacy). Walks up through plain `topology_group` ancestors but
 * stops at the nearest `team_scope`.
 * Pure — `allNodes` is a flat array; O(depth).
 */
export function getTeamScopeAncestorId(node, allNodes) {
  if (!node || !allNodes?.length) return null
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  let curId = node.parentNode || node.parent || null
  const seen = new Set()
  while (curId && !seen.has(curId)) {
    seen.add(curId)
    const parent = byId.get(curId)
    if (!parent) return null
    if (parent.type === 'group' && parent.data?.kind === 'team_scope') {
      return parent.id
    }
    curId = parent.parentNode || parent.parent || null
  }
  return null
}

/**
 * Infer a default edge replication_intent from its endpoints.
 * - both ends live in the same team_scope  → 'mesh'
 * - exactly one end is inside a team_scope → 'fan_out'
 * - neither end is in a team_scope         → 'pair_scoped'
 * Pure — callers supply full node list for ancestry lookup.
 */
export function inferReplicationIntent(sourceNode, targetNode, allNodes) {
  const srcScope = getTeamScopeAncestorId(sourceNode, allNodes)
  const tgtScope = getTeamScopeAncestorId(targetNode, allNodes)
  if (srcScope && tgtScope && srcScope === tgtScope) return 'mesh'
  if (srcScope || tgtScope) return 'fan_out'
  return 'pair_scoped'
}

/**
 * Validate that a Docker node has a reachable vm|lxc host_ref.
 * Returns an object { ok, code, message } (code is stable, message is human).
 * Pure — nodes may be passed directly (array of VueFlow nodes).
 */
export function validateDockerNode(dockerNode, allNodes) {
  const ref = dockerNode?.data?.host_ref || dockerNode?.data?.config?.host_ref
  if (!ref) {
    return { ok: false, code: 'docker.host_ref.missing', message: 'Docker container has no host_ref' }
  }
  const host = (allNodes || []).find((n) => n.id === ref)
  if (!host) {
    return { ok: false, code: 'docker.host_ref.unresolved', message: `host_ref '${ref}' does not exist` }
  }
  if (!DOCKER_HOST_TYPES.includes(host.type)) {
    return {
      ok: false,
      code: 'docker.host_ref.invalid_type',
      message: `host_ref '${ref}' is a ${host.type}; must be vm or lxc`,
    }
  }
  return { ok: true, code: null, message: null }
}

/**
 * Given a set of nodes, compute derived dashed containment edges from every
 * Docker node to its host (when valid). The edge id is deterministic so
 * consumers can merge with their own edges without duplicates.
 */
export function computeDockerTetherEdges(allNodes) {
  const edges = []
  for (const n of allNodes || []) {
    if (n.type !== 'docker') continue
    const ref = n.data?.host_ref || n.data?.config?.host_ref
    if (!ref) continue
    const host = (allNodes || []).find((h) => h.id === ref)
    if (!host || !DOCKER_HOST_TYPES.includes(host.type)) continue
    edges.push({
      id: `docker-tether-${n.id}-${host.id}`,
      source: n.id,
      target: host.id,
      type: 'docker-tether',
      selectable: false,
      data: { synthetic: true, kind: 'docker_tether' },
    })
  }
  return edges
}

/**
 * Pick the nearest VM/LXC to a given position (Euclidean).
 * Used when a Docker node is dropped without an explicit host_ref.
 * Returns a host node or null.
 */
export function findNearestDockerHost(allNodes, position) {
  if (!position) return null
  let best = null
  let bestDist = Infinity
  for (const n of allNodes || []) {
    if (!DOCKER_HOST_TYPES.includes(n.type)) continue
    const nx = n.position?.x ?? 0
    const ny = n.position?.y ?? 0
    const dx = nx - position.x
    const dy = ny - position.y
    const d2 = dx * dx + dy * dy
    if (d2 < bestDist) {
      bestDist = d2
      best = n
    }
  }
  return best
}

export function useInfraBuilder() {
  const { updateNodeData, getNodes } = useVueFlow()

  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)
  const selectedEdge = ref(null)

  /**
   * Handle new connection between nodes
   * Adds default connection data for VM-to-Network connections
   */
  const handleConnect = (connection) => {
    const allNodes = getNodes.value || nodes.value
    const sourceNode = allNodes.find(n => n.id === connection.source)
    const targetNode = allNodes.find(n => n.id === connection.target)

    // Determine if this is a compute-to-network connection
    const isComputeToNetwork = (
      (COMPUTE_TYPES.includes(sourceNode?.type) && NETWORK_TYPES.includes(targetNode?.type)) ||
      (NETWORK_TYPES.includes(sourceNode?.type) && COMPUTE_TYPES.includes(targetNode?.type))
    )

    // Count existing connections to determine interface index
    const existingConnections = edges.value.filter(e =>
      e.source === connection.source || e.target === connection.source
    ).length

    // Infer default replication intent from the team_scope ancestry of endpoints (Plan C §6).
    const replicationIntent = inferReplicationIntent(sourceNode, targetNode, allNodes)

    // Create edge with connection data
    const edgeWithData = {
      ...connection,
      id: connection.id || `e-${connection.source}-${connection.target}`,
      type: isComputeToNetwork ? 'network' : 'default',  // Use custom network edge
      animated: false,
      data: isComputeToNetwork ? {
        // Nested connection object matching NetworkConnectionData
        connection: {
          interfaceName: `net${existingConnections}`,  // Auto-generate interface name
          interfaceModel: 'virtio',
          ipAddress: '',           // Static IP (CIDR notation) or empty for DHCP
          macAddress: '',          // Auto-generated if empty
          firewall: true,          // Enable Proxmox firewall on interface
          vlanTag: null,
          mtu: null,
          rate: null,
          isGateway: false,
        },
        replication_intent: replicationIntent,
        // UI helper
        useDhcp: true,
      } : {
        replication_intent: replicationIntent,
      }
    }

    edges.value = addEdge(edgeWithData, edges.value)
  }

  /**
   * Handle edge click to configure connection
   */
  const handleEdgeClick = (event) => {
    selectedEdge.value = event.edge
    selectedNode.value = null // Deselect node when edge is selected
  }

  /**
   * Update edge data
   * Updates are expected in format: { connection: NetworkConnectionData, ... }
   */
  const updateEdgeData = (edgeId, updates) => {
    edges.value = edges.value.map(edge => {
      if (edge.id === edgeId) {
        // Merge connection data properly; replication_intent lives at data root
        const newData = {
          ...edge.data,
          ...updates,
          connection: {
            ...(edge.data?.connection || {}),
            ...(updates.connection || {})
          }
        }
        if (updates.replication_intent) {
          newData.replication_intent = updates.replication_intent
        }
        return { ...edge, data: newData }
      }
      return edge
    })

    // Update selected edge if it's the one being modified
    if (selectedEdge.value?.id === edgeId) {
      selectedEdge.value = edges.value.find(e => e.id === edgeId)
    }
  }

  /**
   * Close edge configuration
   */
  const closeEdgeConfig = () => {
    selectedEdge.value = null
  }

  const handleNodeClick = (event) => {
    selectedNode.value = event.node
  }

  const updateNodeStatus = (nodeId, updates) => {
    updateNodeData(nodeId, updates)

    if (selectedNode.value && selectedNode.value.id === nodeId) {
      selectedNode.value = {
        ...selectedNode.value,
        data: {
          ...selectedNode.value.data,
          ...updates
        }
      }
    }
  }

  const loadProjectData = (project) => {
    if (project && project.nodes) {
      nodes.value = project.nodes
    } else {
      nodes.value = []
    }

    if (project && project.edges) {
      edges.value = project.edges
    } else {
      edges.value = []
    }

    selectedNode.value = null
  }

  const handleNodesChange = (changes) => {
    // Apply changes to local controlled nodes state
    nodes.value = applyNodeChanges(changes, nodes.value)
  }

  const handleEdgesChange = (changes) => {
    // Apply changes to local controlled edges state
    edges.value = applyEdgeChanges(changes, edges.value)
  }

  // We handle @connect from the component template via handleConnect

  return {
    nodes,
    edges,
    selectedNode,
    selectedEdge,
    onConnect: handleConnect,
    onNodeClick: handleNodeClick,
    onEdgeClick: handleEdgeClick,
    updateNodeStatus,
    updateEdgeData,
    closeEdgeConfig,
    loadProjectData,
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange,
    // validators + derived data (exported for Problems panel / tests)
    validateDockerNode,
    computeDockerTetherEdges,
    findNearestDockerHost,
    inferReplicationIntent,
    getTeamScopeAncestorId,
  }
}
