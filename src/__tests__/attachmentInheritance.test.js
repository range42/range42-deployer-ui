import { describe, it, expect } from 'vitest'
import {
  computeEffectiveAttachments,
  applyBulkAttachmentEdit,
} from '../composables/useInfraBuilder'

/**
 * Plan C §6 — group-level inheritance (computed, never persisted as copies).
 */
describe('computeEffectiveAttachments', () => {
  const nodes = [
    { id: 'g1', type: 'group', data: { kind: 'topology_group' } },
    { id: 'vm-a', type: 'vm', parentNode: 'g1' },
    { id: 'vm-b', type: 'vm', parentNode: 'g1' },
    { id: 'nested', type: 'group', data: { kind: 'topology_group' }, parentNode: 'g1' },
    { id: 'vm-c', type: 'vm', parentNode: 'nested' },
    { id: 'vm-loner', type: 'vm' }, // no parent
  ]

  it('direct node attachments remain on their node, unflagged as inherited', () => {
    const atts = [{ id: 'a1', target_node: 'vm-a', scope: 'node', stage: 'run' }]
    const out = computeEffectiveAttachments(nodes, atts)
    expect(out.get('vm-a')).toHaveLength(1)
    expect(out.get('vm-a')[0].id).toBe('a1')
    expect(out.get('vm-a')[0].inherited).toBe(false)
    expect(out.get('vm-b')).toHaveLength(0)
  })

  it('group_inherited attachments propagate to all descendants (including nested group descendants)', () => {
    const atts = [{ id: 'inh', target_node: 'g1', scope: 'group_inherited', stage: 'preflight' }]
    const out = computeEffectiveAttachments(nodes, atts)
    // Group owns its own copy (non-inherited — it's the source row)
    expect(out.get('g1')).toHaveLength(1)
    expect(out.get('g1')[0].inherited).toBe(false)
    // Direct children get an inherited copy
    for (const id of ['vm-a', 'vm-b', 'nested', 'vm-c']) {
      const list = out.get(id)
      expect(list).toHaveLength(1)
      expect(list[0].inherited).toBe(true)
      expect(list[0].inherited_from).toBe('g1')
      expect(list[0].stage).toBe('preflight')
    }
    // Unrelated node unaffected
    expect(out.get('vm-loner')).toHaveLength(0)
  })

  it('merges direct + inherited attachments on the same node', () => {
    const atts = [
      { id: 'direct', target_node: 'vm-a', scope: 'node', stage: 'post' },
      { id: 'inh', target_node: 'g1', scope: 'group_inherited', stage: 'pre' },
    ]
    const out = computeEffectiveAttachments(nodes, atts)
    const list = out.get('vm-a')
    expect(list).toHaveLength(2)
    const byId = new Map(list.map((a) => [a.id, a]))
    expect(byId.get('direct').inherited).toBe(false)
    expect(byId.get('inh').inherited).toBe(true)
  })

  it('does not mutate the source attachments array', () => {
    const atts = [{ id: 'inh', target_node: 'g1', scope: 'group_inherited' }]
    const snapshot = JSON.stringify(atts)
    computeEffectiveAttachments(nodes, atts)
    expect(JSON.stringify(atts)).toBe(snapshot)
  })
})

describe('applyBulkAttachmentEdit', () => {
  const atts = [
    { id: 'a1', target_node: 'vm-a', stage: 'pre', order_in_stage: 0 },
    { id: 'a2', target_node: 'vm-b', stage: 'pre', order_in_stage: 1 },
    { id: 'a3', target_node: 'g1', scope: 'node' },
  ]

  it('sets stage on selected rows only', () => {
    const out = applyBulkAttachmentEdit(atts, ['a1', 'a3'], { setStage: 'post' })
    expect(out.find((a) => a.id === 'a1').stage).toBe('post')
    expect(out.find((a) => a.id === 'a2').stage).toBe('pre')
    expect(out.find((a) => a.id === 'a3').stage).toBe('post')
  })

  it('merges vars without clobbering existing keys', () => {
    const withVars = atts.map((a) => (a.id === 'a1' ? { ...a, vars: { foo: '1' } } : a))
    const out = applyBulkAttachmentEdit(withVars, ['a1'], { addVars: { bar: '2' } })
    expect(out.find((a) => a.id === 'a1').vars).toEqual({ foo: '1', bar: '2' })
  })

  it('flips scope to group_inherited for selected rows', () => {
    const out = applyBulkAttachmentEdit(atts, ['a3'], { setScope: 'group_inherited' })
    expect(out.find((a) => a.id === 'a3').scope).toBe('group_inherited')
    expect(out.find((a) => a.id === 'a1').scope).toBeUndefined()
  })

  it('deletes selected attachments when { delete: true }', () => {
    const out = applyBulkAttachmentEdit(atts, ['a1', 'a2'], { delete: true })
    expect(out.map((a) => a.id)).toEqual(['a3'])
  })
})
