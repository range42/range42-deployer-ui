import { Graph, layout } from '@dagrejs/dagre'
import type { GraphLabel, NodeLabel } from '@dagrejs/dagre'

interface CanvasNode {
  id: string
  type?: string
  position: { x: number; y: number }
  dimensions?: { width: number; height: number }
  data?: {
    config?: {
      segmentType?: string
    }
  }
}

interface CanvasEdge {
  id: string
  source: string
  target: string
}

/**
 * Determines the dagre rank (layer) for a node based on its type
 * and connectivity so the layout follows a logical network topology order:
 *   0 = WAN segments
 *   1 = multi-homed devices, firewalls, routers
 *   2 = internal network segments
 *   3 = endpoints (VMs, LXC, etc.)
 *   4 = management segments
 */
function getLayer(
  node: CanvasNode,
  edges: CanvasEdge[],
  nodes: CanvasNode[],
): number {
  if (node.type === 'network-segment') {
    const segType = node.data?.config?.segmentType
    if (segType === 'wan') return 0
    if (segType === 'management') return 4
    return 2
  }

  // Multi-homed detection: connected to 2+ network segments
  const connectedNetworks = edges
    .filter(e => e.source === node.id || e.target === node.id)
    .map(e => {
      const otherId = e.source === node.id ? e.target : e.source
      return nodes.find(n => n.id === otherId)
    })
    .filter(n => n?.type === 'network-segment')

  if (connectedNetworks.length >= 2) return 1
  if (node.type === 'edge-firewall' || node.type === 'router') return 1

  return 3
}

export function useAutoLayout() {
  function applyLayout(
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    direction: GraphLabel['rankdir'] = 'TB',
  ): Map<string, { x: number; y: number }> {
    const g = new Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 } as GraphLabel)

    for (const node of nodes) {
      const w = node.dimensions?.width || 200
      const h = node.dimensions?.height || 80
      g.setNode(node.id, { width: w, height: h } as NodeLabel)
    }

    for (const edge of edges) {
      g.setEdge(edge.source, edge.target)
    }

    layout(g)

    const positions = new Map<string, { x: number; y: number }>()
    for (const node of nodes) {
      const pos = g.node(node.id) as NodeLabel | undefined
      if (pos && pos.x !== undefined && pos.y !== undefined) {
        positions.set(node.id, {
          x: pos.x - ((pos.width || 0) / 2),
          y: pos.y - ((pos.height || 0) / 2),
        })
      }
    }

    return positions
  }

  return { applyLayout, getLayer }
}
