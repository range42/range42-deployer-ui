import { describe, it, expect } from 'vitest'
import { createAttachment } from '../composables/useAttachments'

describe('createAttachment', () => {
  it('builds a canonical attachment with sane defaults', () => {
    const a = createAttachment('inline_yaml', 'vm-a', { id: 'fixed-id' })
    expect(a).toEqual({
      id: 'fixed-id',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml' },
      stage: 'main',
      scope: 'node',
    })
  })

  it('honors an explicit stage and title', () => {
    const a = createAttachment('catalog_role', 'vm-a', { id: 'x', stage: 'preflight', title: 'Wazuh' })
    expect(a.stage).toBe('preflight')
    expect(a.title).toBe('Wazuh')
  })

  it('generates a unique id when none is provided', () => {
    const a = createAttachment('external_git', 'vm-a')
    const b = createAttachment('external_git', 'vm-a')
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(a.id).not.toBe(b.id)
  })

  it('omits title when not provided', () => {
    const a = createAttachment('file_upload', 'vm-a', { id: 'x' })
    expect('title' in a).toBe(false)
  })
})
