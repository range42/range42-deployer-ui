import { describe, expect, it } from 'vitest'
import { useAutoLayout } from '@/composables/useAutoLayout'

const node = (id: string, type: string, extra = {}) => ({ id, type, position: { x: 900, y: 700 }, dimensions: { width: 240, height: 150 }, ...extra })

describe('topology layout', () => {
  it('orders WAN, gateways, internal networks and endpoints regardless of drawn edge direction', () => {
    const nodes = [node('vm', 'vm'), node('lan', 'network-segment'), node('gateway', 'router'),
      node('wan', 'network-segment', { data: { config: { segmentType: 'wan' } } })]
    const edges = [{ id: 'a', source: 'vm', target: 'lan' }, { id: 'b', source: 'lan', target: 'gateway' }, { id: 'c', source: 'gateway', target: 'wan' }]
    const positions = useAutoLayout().applyLayout(nodes, edges)
    expect(positions.get('wan')!.y).toBeLessThan(positions.get('gateway')!.y)
    expect(positions.get('gateway')!.y).toBeLessThan(positions.get('lan')!.y)
    expect(positions.get('lan')!.y).toBeLessThan(positions.get('vm')!.y)
  })

  it('fits nested groups around children and keeps positions relative without changing the input', () => {
    const nodes = [node('site', 'group'), node('inner', 'group', { parentNode: 'site' }),
      node('vm', 'vm', { parentNode: 'inner' }), node('net', 'network-segment', { parentNode: 'inner' }),
      node('gateway', 'router', { parentNode: 'site' }), node('outside', 'vm')]
    const before = JSON.stringify(nodes)
    const result = useAutoLayout().applyLayout(nodes, [{ id: 'a', source: 'vm', target: 'net' }, { id: 'b', source: 'gateway', target: 'net' }])
    for (const child of nodes.filter(n => 'parentNode' in n)) {
      const placed = result.get(child.id)!
      const parent = result.get((child as typeof child & { parentNode: string }).parentNode)!
      expect(placed.x).toBeGreaterThanOrEqual(32)
      expect(placed.y).toBeGreaterThanOrEqual(80)
      expect(placed.x + (placed.width || child.dimensions.width)).toBeLessThanOrEqual(parent.width! - 32)
      expect(placed.y + (placed.height || child.dimensions.height)).toBeLessThanOrEqual(parent.height! - 32)
    }
    expect(JSON.stringify(nodes)).toBe(before)
    expect(useAutoLayout().applyLayout([...nodes].reverse(), [])).toEqual(useAutoLayout().applyLayout(nodes, []))
  })

  it('ignores missing endpoints, annotation links and repeated NICs when classifying devices', () => {
    const nodes = [node('vm', 'vm'), node('net', 'network-segment'), node('note', 'note')]
    const edges = [{ id: 'a', source: 'vm', target: 'net' }, { id: 'b', source: 'vm', target: 'net' }]
    expect(useAutoLayout().getLayer(nodes[0], edges, nodes)).toBe(3)
    const expected = useAutoLayout().applyLayout(nodes, edges)
    expect(useAutoLayout().applyLayout(nodes, [...edges,
      { id: 'missing', source: 'vm', target: 'absent' }, { id: 'annotation', source: 'note', target: 'vm' },
    ])).toEqual(expected)
  })
})
