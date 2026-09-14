import { describe, expect, it } from 'vitest'
import type { Node } from '@vue-flow/core'
import { useTopologyResolver } from '@/composables/useTopologyResolver'

describe('VueFlow topology validation boundary', () => {
  it.each([undefined, null, 'invalid', []])('refuses missing or non-object node data without treating the graph as valid', data => {
    const resolver = useTopologyResolver()
    const graph: Node[] = [{ id: 'missing-config', position: { x: 0, y: 0 }, data }]
    expect(resolver.validateTopology(graph, [])).toMatchObject({ valid: false,
      errors: [{ nodeId: 'missing-config', field: 'data', message: 'Node configuration is missing or invalid' }] })
    expect(resolver.errors.value).toHaveLength(1)
    expect(graph[0].data).toBe(data)
  })

  it('preserves ordinary VM validation and its disconnected-network warning', () => {
    const resolver = useTopologyResolver()
    const graph: Node[] = [{ id: 'vm', position: { x: 0, y: 0 }, data: { type: 'vm', label: 'Existing VM', status: 'draft' } }]
    expect(resolver.validateTopology(graph, [])).toMatchObject({ valid: true, errors: [],
      warnings: [{ nodeId: 'vm', field: 'connection' }] })
  })
})
