import type { CanvasNode } from '@/overlay/serialize'

/** Upgrade older text annotations without changing resource nodes or input data. */
export function normalizeCanvasNotes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map(node => {
    if (node.type !== 'default' || node.data?.reference_only !== true) return node
    const config = node.data.config || {}
    return {
      ...node,
      type: 'note',
      style: { width: '320px', height: '200px', ...(typeof node.style === 'object' ? node.style : {}) },
      data: {
        ...node.data,
        type: 'note',
        config: { ...config, name: config.name || 'Note', text: config.text ?? config.description ?? node.data.label ?? '', color: config.color || 'yellow' },
      },
    }
  })
}

/** Notes and their connectors describe the canvas; they are never resources. */
export function withoutCanvasNotes<N extends { id: string; type?: string }, E extends { source: string; target: string }>(nodes: N[], edges: E[]) {
  const notes = new Set(nodes.filter(node => node.type === 'note').map(node => node.id))
  return {
    nodes: nodes.filter(node => !notes.has(node.id)),
    edges: edges.filter(edge => !notes.has(edge.source) && !notes.has(edge.target)),
  }
}
