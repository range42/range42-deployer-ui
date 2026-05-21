import { describe, it, expect } from 'vitest'
import { compose } from '@/overlay/compose'

function baseDoc() {
  return {
    schema_version: '1.0',
    kind: 'lab',
    name: 'base',
    nodes: [{ id: 'vm-a', kind: 'vm' }],
  }
}

describe('compose — UI attachment shape reaches the right node', () => {
  it('appends a canonical attachment (target_node + source) onto its node, dropping target_node', () => {
    const overlay = {
      schema_version: '1.0',
      source_url: 'x',
      source_sha: 'y',
      attachments_added: [
        {
          id: 'att1',
          target_node: 'vm-a',
          stage: 'main',
          order_in_stage: 0,
          source: { kind: 'catalog_role', ref: 'src-a:roles/wazuh' },
        },
      ],
    }
    const eff = compose(baseDoc(), overlay)
    const node = eff.nodes.find((n) => n.id === 'vm-a')
    expect(node.attachments).toHaveLength(1)
    const att = node.attachments[0]
    expect(att.source.kind).toBe('catalog_role')
    expect(att.stage).toBe('main')
    expect(att.order_in_stage).toBe(0)
    expect(att.target_node).toBeUndefined() // compose strips the routing key
  })

  it('drops a legacy attachment that uses node_id instead of target_node (guards the drift)', () => {
    const overlay = {
      schema_version: '1.0',
      source_url: 'x',
      source_sha: 'y',
      attachments_added: [{ id: 'legacy', node_id: 'vm-a', stage: 'main' }],
    }
    const eff = compose(baseDoc(), overlay)
    expect(eff.nodes.find((n) => n.id === 'vm-a').attachments).toBeUndefined()
  })
})
