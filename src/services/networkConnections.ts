import { isReferenceEdge } from '@/services/canvasNotes'

export function connectedNetworkDevices<N extends { id: string; type?: string }>(
  networkId: string,
  nodes: readonly N[],
  edges: readonly { source: string; target: string; data?: Record<string, unknown> }[],
): N[] {
  const connected = new Set(edges
    .filter(edge => !isReferenceEdge(edge) && !edge.data?.synthetic)
    .flatMap(edge => edge.source === networkId ? [edge.target] : edge.target === networkId ? [edge.source] : []))
  return nodes.filter(node => connected.has(node.id) && !['note', 'group', 'network-segment'].includes(node.type || ''))
}
