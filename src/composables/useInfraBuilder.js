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
 * Upgrade a persisted attachment row to the canonical schema shape:
 *   node_id → target_node, order → order_in_stage.
 * Pure and idempotent — canonical rows pass through unchanged, and legacy keys
 * are always removed so downstream code only ever sees canonical names.
 */
export function normalizeAttachment(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const a = { ...raw }
  if (a.target_node === undefined && a.node_id !== undefined) {
    a.target_node = a.node_id
  }
  delete a.node_id
  if (a.order_in_stage === undefined && a.order !== undefined) {
    a.order_in_stage = a.order
  }
  delete a.order
  return a
}

/**
 * Compute the effective attachments for each node: direct attachments on the
 * node itself PLUS any attachments with `scope: 'group_inherited'` defined on
 * a group ancestor (team_scope or topology_group). Inherited attachments are
 * flagged with `inherited: true` and `inherited_from: <groupId>` so the UI
 * can distinguish them from the node's own attachments without persisting
 * duplicate records.
 *
 * Pure function — callers pass the full nodes list + a flat attachments list:
 *   attachments: [{ id, target_node, scope?: 'node' | 'group_inherited', ... }]
 *
 * Returns: Map<nodeId, Attachment[]>
 */
export function computeEffectiveAttachments(allNodes, attachments) {
  const byId = new Map((allNodes || []).map((n) => [n.id, n]))
  const byNode = new Map()
  for (const n of allNodes || []) byNode.set(n.id, [])

  // 1) Direct attachments go on their owning node unchanged.
  const groupInherited = []
  for (const a of attachments || []) {
    if (!a?.target_node) continue
    if (a.scope === 'group_inherited') {
      groupInherited.push(a)
      continue
    }
    if (!byNode.has(a.target_node)) byNode.set(a.target_node, [])
    byNode.get(a.target_node).push({ ...a, inherited: false })
  }

  // 2) Inherited attachments: each group_inherited attachment on a group node
  //    propagates to all descendant nodes (leaf + nested groups) as a copy.
  for (const a of groupInherited) {
    const group = byId.get(a.target_node)
    if (!group) continue
    // Also attach to the group itself so Config tab shows it on the group row.
    if (!byNode.has(group.id)) byNode.set(group.id, [])
    byNode.get(group.id).push({ ...a, inherited: false })

    // BFS over descendants
    const queue = []
    for (const n of allNodes || []) {
      if (n.parentNode === group.id || n.parent === group.id) queue.push(n)
    }
    const seen = new Set()
    while (queue.length) {
      const n = queue.shift()
      if (seen.has(n.id)) continue
      seen.add(n.id)
      if (!byNode.has(n.id)) byNode.set(n.id, [])
      byNode.get(n.id).push({ ...a, inherited: true, inherited_from: group.id })
      for (const child of allNodes || []) {
        if (child.parentNode === n.id || child.parent === n.id) queue.push(child)
      }
    }
  }

  return byNode
}

/**
 * Apply a bulk edit to a list of attachments. Supports:
 *   { setStage?: string, setOrder?: number, addVars?: Record<string,string>, setScope?: 'node'|'group_inherited', delete?: true }
 * When `delete: true`, selected attachments are removed entirely.
 * Otherwise, fields are shallow-merged; `addVars` merges into each attachment's `vars` map.
 * Pure — returns a new attachments array.
 */
export function applyBulkAttachmentEdit(attachments, selectedIds, edit) {
  const selected = new Set(selectedIds || [])
  if (edit?.delete) {
    return (attachments || []).filter((a) => !selected.has(a.id))
  }
  return (attachments || []).map((a) => {
    if (!selected.has(a.id)) return a
    const next = { ...a }
    if (edit?.setStage !== undefined) next.stage = edit.setStage
    if (edit?.setOrder !== undefined) next.order_in_stage = Number(edit.setOrder) || 0
    if (edit?.setScope !== undefined) next.scope = edit.setScope
    if (edit?.addVars) {
      next.vars = { ...(a.vars || {}), ...edit.addVars }
    }
    return next
  })
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

/**
 * Find the nearest node in a given cardinal direction from `fromId` using
 * position-based distance (canvas-layout). Pure — safe to unit-test.
 *
 * Plan C §C5.3: arrow keys navigate between nodes; Enter opens the config
 * panel; Tab cycles through handles (handled at the VueFlow layer via
 * tabindex on handles — not in this helper).
 *
 * The "direction filter" uses the dominant axis: a candidate counts as
 * `right` if it is strictly to the right AND its horizontal displacement
 * dominates its vertical displacement. This matches how users perceive
 * arrow navigation on 2D canvases.
 */
export function findNearestNodeInDirection(allNodes, fromId, direction) {
  const list = Array.isArray(allNodes) ? allNodes : []
  const from = list.find((n) => n.id === fromId)
  if (!from || !from.position) return null
  const fx = from.position.x
  const fy = from.position.y

  let best = null
  let bestDist = Infinity

  for (const n of list) {
    if (n.id === fromId || !n.position) continue
    const dx = n.position.x - fx
    const dy = n.position.y - fy

    let inDirection = false
    if (direction === 'right') inDirection = dx > 0 && Math.abs(dx) > Math.abs(dy)
    else if (direction === 'left') inDirection = dx < 0 && Math.abs(dx) > Math.abs(dy)
    else if (direction === 'down') inDirection = dy > 0 && Math.abs(dy) >= Math.abs(dx)
    else if (direction === 'up') inDirection = dy < 0 && Math.abs(dy) >= Math.abs(dx)

    if (!inDirection) continue

    const dist = Math.hypot(dx, dy)
    if (dist < bestDist) {
      bestDist = dist
      best = n
    }
  }
  return best
}

/**
 * Compute the next keyboard selection given current selection id + direction.
 * - With no current selection, returns the first node.
 * - With a current selection but no neighbour in direction, returns the
 *   current selection unchanged (so the UI noops rather than losing focus).
 */
export function nextKeyboardSelection(allNodes, currentId, direction) {
  const list = Array.isArray(allNodes) ? allNodes : []
  if (list.length === 0) return null
  if (!currentId || !list.some((n) => n.id === currentId)) return list[0]
  const found = findNearestNodeInDirection(list, currentId, direction)
  return found || list.find((n) => n.id === currentId) || list[0]
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
    computeEffectiveAttachments,
    applyBulkAttachmentEdit,
    normalizeAttachment,
  }
}
