import type { XYPosition } from '@vue-flow/core'

interface DeletionNode {
  id: string
  type?: string
  parentNode?: string
  parent?: string
  position?: XYPosition
  extent?: unknown
  expandParent?: boolean
  data?: Record<string, unknown>
}

const parentId = (node: DeletionNode) => node.parentNode || node.parent

/** Collect all descendants once, including nested groups and legacy parent links. */
export function canvasDescendants(nodes: readonly DeletionNode[], nodeId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    const parent = parentId(node)
    if (parent) children.set(parent, [...(children.get(parent) || []), node.id])
  }
  const seen = new Set([nodeId])
  const queue = [nodeId]
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) || []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }
  seen.delete(nodeId)
  return seen
}

/** Keep children by default, translating their positions into the surviving parent. */
export function removeCanvasNode<N extends DeletionNode, E extends { source: string; target: string }>(
  nodes: readonly N[], edges: readonly E[], nodeId: string, recursive = false,
): { nodes: N[]; edges: E[] } {
  const removed = nodes.find(node => node.id === nodeId)
  if (!removed) return { nodes: [...nodes], edges: [...edges] }
  const removedIds = new Set([nodeId])
  if (removed.type === 'group' && recursive) {
    for (const id of canvasDescendants(nodes, nodeId)) removedIds.add(id)
  }
  const parent = parentId(removed)
  const nextNodes = nodes.filter(node => !removedIds.has(node.id)).map(node => {
    if (parentId(node) !== nodeId) return node
    return {
      ...node,
      parentNode: parent,
      parent: undefined,
      position: {
        x: (node.position?.x || 0) + (removed.position?.x || 0),
        y: (node.position?.y || 0) + (removed.position?.y || 0),
      },
      // Explicit undefined clears VueFlow's existing runtime object too.
      extent: parent ? node.extent : undefined,
      expandParent: parent ? node.expandParent : undefined,
    }
  })
  const parents = new Set(nextNodes.map(parentId).filter(Boolean))
  return {
    nodes: nextNodes.map(node => node.type === 'group'
      ? { ...node, data: { ...node.data, hasChildren: parents.has(node.id) } } : node),
    edges: edges.filter(edge => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
  }
}
