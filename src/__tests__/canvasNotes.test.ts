import { describe, expect, it, vi } from 'vitest'
import { deserializeToCanvas, extractLayout, serializeToCatalogEntry, type CanvasModel, type CanvasNode } from '@/overlay/serialize'
import { useInfraBuilder } from '@/composables/useInfraBuilder'

const flow = vi.hoisted(() => ({ nodes: [] as CanvasNode[] }))
vi.mock('@vue-flow/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vue-flow/core')>(),
  useVueFlow: () => ({ getNodes: { value: flow.nodes }, updateNodeData: vi.fn() }),
}))

describe('canvas notes', () => {
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
