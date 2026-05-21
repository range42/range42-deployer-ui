import { describe, it, expect } from 'vitest'
import { normalizeAttachment } from '../composables/useInfraBuilder'

describe('normalizeAttachment — legacy → canonical attachment shape', () => {
  it('maps node_id → target_node and order → order_in_stage, dropping the legacy keys', () => {
    const out = normalizeAttachment({ id: 'a', node_id: 'vm-a', order: 2, stage: 'pre' })
    expect(out.target_node).toBe('vm-a')
    expect(out.order_in_stage).toBe(2)
    expect(out.node_id).toBeUndefined()
    expect(out.order).toBeUndefined()
    expect(out.stage).toBe('pre')
  })

  it('preserves a literal order of 0', () => {
    expect(normalizeAttachment({ id: 'a', node_id: 'x', order: 0 }).order_in_stage).toBe(0)
  })

  it('is idempotent on already-canonical rows', () => {
    const canon = { id: 'a', target_node: 'vm-a', order_in_stage: 1, source: { kind: 'inline_yaml' } }
    expect(normalizeAttachment(canon)).toEqual(canon)
  })

  it('prefers an existing target_node over node_id when both are present', () => {
    const out = normalizeAttachment({ id: 'a', target_node: 'canon', node_id: 'legacy' })
    expect(out.target_node).toBe('canon')
    expect(out.node_id).toBeUndefined()
  })

  it('passes non-object input through unchanged', () => {
    expect(normalizeAttachment(null)).toBeNull()
    expect(normalizeAttachment(undefined)).toBeUndefined()
  })
})
