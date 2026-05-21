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

import {
  updateAttachment,
  removeAttachment,
  setAttachmentScope,
  setAttachmentOrder,
  setAttachmentSource,
} from '../composables/useAttachments'

describe('attachment mutators (pure, immutable)', () => {
  const list = () => [
    { id: 'a1', target_node: 'vm-a', source: { kind: 'inline_yaml' }, stage: 'main', scope: 'node' },
    { id: 'a2', target_node: 'vm-b', source: { kind: 'catalog_role', ref: 'src:roles/x' }, stage: 'main', scope: 'node' },
  ]

  it('updateAttachment shallow-merges a patch onto the matching row only', () => {
    const out = updateAttachment(list(), 'a1', { stage: 'post', title: 'T' })
    expect(out.find((a) => a.id === 'a1')).toMatchObject({ stage: 'post', title: 'T' })
    expect(out.find((a) => a.id === 'a2').stage).toBe('main')
  })

  it('updateAttachment does not mutate the input array or rows', () => {
    const input = list()
    const snapshot = JSON.stringify(input)
    updateAttachment(input, 'a1', { stage: 'post' })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('removeAttachment drops the matching row', () => {
    expect(removeAttachment(list(), 'a1').map((a) => a.id)).toEqual(['a2'])
  })

  it('setAttachmentScope sets scope on the matching row', () => {
    expect(setAttachmentScope(list(), 'a1', 'group_inherited').find((a) => a.id === 'a1').scope).toBe(
      'group_inherited',
    )
  })

  it('setAttachmentOrder writes order_in_stage (canonical field)', () => {
    expect(setAttachmentOrder(list(), 'a2', 3).find((a) => a.id === 'a2').order_in_stage).toBe(3)
  })

  it('setAttachmentSource merges into source without dropping existing source fields', () => {
    const out = setAttachmentSource(list(), 'a2', { sha: 'abc123' })
    expect(out.find((a) => a.id === 'a2').source).toEqual({
      kind: 'catalog_role',
      ref: 'src:roles/x',
      sha: 'abc123',
    })
  })

  it('mutators tolerate null/undefined input', () => {
    expect(updateAttachment(null, 'a1', { stage: 'x' })).toEqual([])
    expect(removeAttachment(undefined, 'a1')).toEqual([])
  })
})
