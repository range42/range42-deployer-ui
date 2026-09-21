import { describe, expect, it, vi } from 'vitest'
import { deserializeToCanvas, extractLayout, serializeToCatalogEntry, type CanvasModel, type CanvasNode } from '@/overlay/serialize'
import { useInfraBuilder } from '@/composables/useInfraBuilder'

const flow = vi.hoisted(() => ({ nodes: [] as CanvasNode[] }))
vi.mock('@vue-flow/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vue-flow/core')>(),
  useVueFlow: () => ({ getNodes: { value: flow.nodes }, updateNodeData: vi.fn() }),
}))

describe('canvas notes', () => {
  it('preserves reference lines between resources without adding network interfaces', () => {
    const canvas: CanvasModel = { nodes: [
      { id: 'first', type: 'vm', data: { config: { name: 'First' } } },
      { id: 'second', type: 'vm', data: { config: { name: 'Second' } } },
      { id: 'net', type: 'network-segment', data: { config: { bridge: 'vmbr10' } } },
    ], edges: [
      { id: 'logical', type: 'smoothstep', source: 'first', target: 'second', label: 'Service link' },
      { id: 'reference', type: 'smoothstep', source: 'first', target: 'net', label: 'Reference', data: { reference_only: true } },
    ], attachments: [] }
    const doc = serializeToCatalogEntry(canvas, { name: 'Example' })
    expect(doc.nodes?.[0].networks).toBeUndefined()
    expect(deserializeToCanvas(doc, extractLayout(canvas)).edges).toEqual(canvas.edges)
  })

  it('updates and clears line text without adding network data to an annotation', () => {
    const builder = useInfraBuilder()
    builder.edges.value = [{ id: 'link', source: 'note', target: 'net' }]
    builder.updateEdgeData('link', { label: 'Review' })
    expect(builder.edges.value[0]).toEqual({ id: 'link', source: 'note', target: 'net', label: 'Review' })
    builder.updateEdgeData('link', { label: '' })
    expect(builder.edges.value[0].label).toBe('')
  })

  it('preserves network line text in the canvas without changing infrastructure exports', () => {
    const canvas: CanvasModel = { nodes: [
      { id: 'vm', type: 'vm', data: { config: { name: 'Example' } } },
      { id: 'net', type: 'network-segment', data: { config: { bridge: 'vmbr10' } } },
    ], edges: [{ id: 'link', type: 'network', source: 'vm', target: 'net', label: 'Service traffic',
      data: { connection: { interfaceName: 'net0', ipAddress: '10.10.0.10/24' } } }], attachments: [] }
    const doc = serializeToCatalogEntry(canvas, { name: 'Example' })
    expect(deserializeToCanvas(doc, extractLayout(canvas)).edges[0].label).toBe('Service traffic')
    expect(serializeToCatalogEntry({ ...canvas, edges: [{ ...canvas.edges[0], label: 'Different text' }] }, { name: 'Example' })).toEqual(doc)
  })

  it.each([['note', 'vm'], ['vm', 'note']])('keeps %s to %s annotations out of network interface numbering', (source, target) => {
    flow.nodes = [{ id: 'note', type: 'note' }, { id: 'vm', type: 'vm' }, { id: 'net', type: 'network-segment' }]
    const builder = useInfraBuilder()
    builder.onConnect({ source, target })
    expect(builder.edges.value[0].type).toBe('smoothstep')
    expect(builder.edges.value[0].data?.connection).toBeUndefined()
    builder.onConnect({ source: 'vm', target: 'net' })
    expect(builder.edges.value[1].data.connection.interfaceName).toBe('net0')
  })

  it('retains notes and their links through an export/import without adding infrastructure', () => {
    const canvas: CanvasModel = {
      nodes: [
        { id: 'net', type: 'network-segment', data: { config: { bridge: 'vmbr10' } } },
        { id: 'note', type: 'note', position: { x: 50, y: 70 }, style: { width: '320px', height: '180px' },
          data: { config: { name: 'Review', text: 'First line\nSecond line', color: 'blue' } } },
      ],
      edges: [{ id: 'annotation', type: 'smoothstep', source: 'note', target: 'net', label: 'Review link',
        sourceHandle: 'bottom', targetHandle: 'top-2', style: { strokeDasharray: '5 5' } }],
      attachments: [],
    }
    const doc = serializeToCatalogEntry(canvas, { name: 'Example' })
    expect(doc.nodes?.map(node => node.id)).toEqual(['net'])
    expect(doc.nodes?.[0].networks).toBeUndefined()
    const restored = deserializeToCanvas(doc, extractLayout(canvas))
    expect(restored.nodes.find(node => node.id === 'note')).toEqual(canvas.nodes[1])
    expect(restored.edges).toEqual(canvas.edges)
  })
})
