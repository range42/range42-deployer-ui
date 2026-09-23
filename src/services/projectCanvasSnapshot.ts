import type { CanvasModel, CanvasNode, CanvasEdge } from '@/overlay/serialize'
import { objectValue } from '@/services/projectAuthoring'

const NODE_FIELDS = ['id', 'type', 'parentNode', 'parent', 'position', 'dimensions', 'style', 'extent']
const DATA_FIELDS = ['type', 'kind', 'label', 'config', 'host_ref', 'vmId', 'replication']
const EDGE_FIELDS = ['id', 'type', 'source', 'target', 'sourceHandle', 'targetHandle', 'label']
const CONNECTION_FIELDS = ['connection', 'useDhcp']
function publicFields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Canvas snapshot contains unsupported public fields')
}
function publicValues(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('Canvas configuration is too deeply nested')
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid canvas configuration key')
    if (/(?:^|_)(?:password|passwd|token|secret|credentials?|private_key|ssh_key)(?:$|_)/i.test(key)
      && nested !== undefined && nested !== null && nested !== '' && nested !== false) {
      throw new Error('Canvas credentials must come from the backend vault; remove their values before saving or opening')
    }
    publicValues(nested, depth + 1)
  }
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
}

/** Preserve parallel edges and editable fields while excluding VueFlow runtime state. */
export function captureCanvasSnapshot(canvas: CanvasModel) {
  const snapshot = JSON.parse(JSON.stringify({ version: 1,
    nodes: canvas.nodes.map(node => ({
      ...pick(node, NODE_FIELDS),
      data: pick(node.data || {}, DATA_FIELDS),
    })),
    edges: canvas.edges.filter(edge => !edge.data?.synthetic).map(edge => ({
      ...pick(edge, EDGE_FIELDS),
      data: pick(edge.data || {}, CONNECTION_FIELDS),
    })),
  }))
  readCanvasSnapshot(snapshot, canvas.attachments)
  return snapshot
}

function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(value) }
export function readCanvasSnapshot(raw: unknown, attachments: CanvasModel['attachments']): CanvasModel {
  const snapshot = objectValue(raw, 'Canvas snapshot')
  if (snapshot.version !== 1 || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) throw new Error('Invalid canvas snapshot version or graph')
  if (snapshot.nodes.length > 1024 || snapshot.edges.length > 4096) throw new Error('Canvas snapshot exceeds 1,024 nodes or 4,096 edges')
  const nodeIds = new Set<string>()
  const nodes: CanvasNode[] = snapshot.nodes.map(rawNode => {
    const node = objectValue(rawNode, 'Canvas node')
    publicFields(node, [...NODE_FIELDS, 'data'])
    if (!id(node.id) || nodeIds.has(node.id) || typeof node.type !== 'string') throw new Error('Canvas nodes require unique identifiers and types')
    nodeIds.add(node.id)
    if (node.position !== undefined) {
      const point = objectValue(node.position, 'Node position')
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid canvas node position')
    }
    if (node.data !== undefined) {
      const data = objectValue(node.data, 'Node data')
      publicFields(data, DATA_FIELDS)
      publicValues(data)
      if (data.config !== undefined) objectValue(data.config, 'Node configuration')
    }
    if (node.parentNode !== undefined && !id(node.parentNode)) throw new Error('Invalid parent node')
    if (node.parent !== undefined && !id(node.parent)) throw new Error('Invalid parent node')
    return { ...node, id: node.id, type: node.type }
  })
  for (const node of nodes) {
    const parent = node.parentNode || node.parent
    if (parent && !nodeIds.has(parent)) throw new Error(`Parent node is missing: ${parent}`)
  }
  const edgeIds = new Set<string>()
  const edges: CanvasEdge[] = snapshot.edges.map(rawEdge => {
    const edge = objectValue(rawEdge, 'Canvas edge')
    publicFields(edge, [...EDGE_FIELDS, 'data'])
    if (!id(edge.id) || edgeIds.has(edge.id) || !id(edge.source) || !id(edge.target)
      || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new Error('Canvas edges require unique identifiers and existing endpoints')
    edgeIds.add(edge.id)
    if (edge.data !== undefined) {
      const data = objectValue(edge.data, 'Edge data')
      publicFields(data, CONNECTION_FIELDS)
      publicValues(data)
      if (data.connection !== undefined) objectValue(data.connection, 'Edge connection')
    }
    return { ...edge, id: edge.id, source: edge.source, target: edge.target }
  })
  return { nodes, edges, attachments }
}
