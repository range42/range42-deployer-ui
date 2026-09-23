import { Graph, layout } from '@dagrejs/dagre'
import type { GraphLabel } from '@dagrejs/dagre'
import { withoutCanvasNotes } from '@/services/canvasNotes'

interface CanvasNode {
  id: string
  type?: string
  parentNode?: string
  parent?: string
  position: { x: number; y: number }
  dimensions?: { width: number; height: number }
  style?: unknown
  data?: { config?: { segmentType?: string } }
}
interface CanvasEdge { id?: string; source: string; target: string; data?: Record<string, unknown> }
export interface LayoutPosition { x: number; y: number; width?: number; height?: number }

function getLayer(node: CanvasNode, edges: CanvasEdge[], nodes: CanvasNode[]): number {
  if (node.type === 'note') return 5
  if (node.type === 'network-segment') {
    if (node.data?.config?.segmentType === 'wan') return 0
    if (node.data?.config?.segmentType === 'management') return 4
    return 2
  }
  const networks = new Set(withoutCanvasNotes(nodes, edges).edges
    .filter(edge => !edge.data?.synthetic && (edge.source === node.id || edge.target === node.id))
    .map(edge => edge.source === node.id ? edge.target : edge.source)
    .filter(id => nodes.find(candidate => candidate.id === id)?.type === 'network-segment'))
  return networks.size > 1 || ['router', 'edge-firewall'].includes(node.type || '') ? 1 : 3
}

function nodeSize(node: CanvasNode) {
  const style = node.style && typeof node.style === 'object' ? node.style as Record<string, unknown> : {}
  const positive = (value: unknown, fallback: number) => {
    const number = typeof value === 'number' ? value : Number.parseFloat(String(value || ''))
    return Number.isFinite(number) && number > 0 ? number : fallback
  }
  return {
    width: positive(node.dimensions?.width, positive(style.width, node.type === 'note' ? 320 : 280)),
    height: positive(node.dimensions?.height, positive(style.height, node.type === 'note' ? 200 : 160)),
  }
}

export function useAutoLayout() {
  function applyLayout(nodes: CanvasNode[], edges: CanvasEdge[], direction: GraphLabel['rankdir'] = 'TB') {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const parents = new Map(nodes.map(node => {
      const parent = node.parentNode || node.parent
      return [node.id, parent && byId.has(parent) ? parent : undefined]
    }))
    for (const node of nodes) {
      const visited = new Set<string>()
      let id: string | undefined = node.id
      while (id) {
        if (visited.has(id)) throw new Error('A group cannot contain itself. Check the group nesting before organizing.')
        visited.add(id)
        id = parents.get(id)
      }
    }
    const children = new Map<string | undefined, CanvasNode[]>()
    for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      const parent = parents.get(node.id)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent)!.push(node)
    }
    const physicalEdges = withoutCanvasNotes(nodes, edges).edges
      .filter(edge => !edge.data?.synthetic && byId.has(edge.source) && byId.has(edge.target))
    const sizes = new Map<string, { width: number; height: number }>()
    const layers = new Map<string, number>()
    const positions = new Map<string, LayoutPosition>()

    function representative(id: string, parent: string | undefined): string | undefined {
      while (parents.get(id) !== parent) {
        const next = parents.get(id)
        if (!next) return undefined
        id = next
      }
      return id
    }

    function arrange(parent?: string) {
      const siblings = children.get(parent) || []
      for (const node of siblings) {
        if (children.has(node.id)) {
          const bounds = arrange(node.id)
          sizes.set(node.id, { width: Math.max(350, bounds.width + 96), height: Math.max(250, bounds.height + 144) })
          layers.set(node.id, Math.min(...children.get(node.id)!.map(child => layers.get(child.id)!)))
        } else {
          sizes.set(node.id, node.type === 'group' ? { width: 350, height: 250 } : nodeSize(node))
          layers.set(node.id, getLayer(node, physicalEdges, nodes))
        }
      }
      if (!siblings.length) return { width: 0, height: 0 }
      const graph = new Graph().setDefaultEdgeLabel(() => ({}))
      graph.setGraph({ rankdir: direction, ranksep: 50, nodesep: 64 })
      for (const node of siblings) graph.setNode(node.id, { ...sizes.get(node.id)! })

      // Invisible separators keep topology layers ordered even when a link was
      // drawn backwards, or a device has no connections yet.
      const ranks = [...new Set(siblings.map(node => layers.get(node.id)!))].sort((a, b) => a - b)
      const anchors = Array.from({ length: ranks.length + 1 }, (_, index) => {
        let id = `__layout_boundary_${index}`
        while (byId.has(id)) id += '_'
        graph.setNode(id, { width: 0, height: 0 })
        return id
      })
      ranks.forEach((rank, index) => {
        for (const node of siblings.filter(node => layers.get(node.id) === rank)) {
          graph.setEdge(anchors[index], node.id)
          graph.setEdge(node.id, anchors[index + 1])
        }
      })
      for (const edge of physicalEdges) {
        let from = representative(edge.source, parent)
        let to = representative(edge.target, parent)
        if (!from || !to || from === to || !graph.hasNode(from) || !graph.hasNode(to)) continue
        if (layers.get(from)! > layers.get(to)!
          || (layers.get(from) === layers.get(to) && from.localeCompare(to) > 0)) [from, to] = [to, from]
        graph.setEdge(from, to)
      }
      layout(graph)
      const minX = Math.min(...siblings.map(node => graph.node(node.id).x - sizes.get(node.id)!.width / 2))
      const minY = Math.min(...siblings.map(node => graph.node(node.id).y - sizes.get(node.id)!.height / 2))
      let width = 0, height = 0
      for (const node of siblings) {
        const placed = graph.node(node.id)
        const size = sizes.get(node.id)!
        const x = placed.x - size.width / 2 - minX
        const y = placed.y - size.height / 2 - minY
        width = Math.max(width, x + size.width)
        height = Math.max(height, y + size.height)
        positions.set(node.id, {
          x: x + (parent ? 48 : 60), y: y + (parent ? 96 : 60),
          ...(node.type === 'group' || children.has(node.id) ? size : {}),
        })
      }
      return { width, height }
    }
    arrange()
    return positions
  }
  return { applyLayout, getLayer }
}
