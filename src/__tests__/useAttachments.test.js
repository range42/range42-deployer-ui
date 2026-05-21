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

import { validateAttachment, normalizeAttachments } from '../composables/useAttachments'

const codes = (a) => validateAttachment(a).map((p) => p.code)

describe('validateAttachment — per-kind completeness rules', () => {
  it('flags a missing target_node', () => {
    const a = { id: 'x', source: { kind: 'inline_yaml', content_ref: 'attachments/x.yaml' } }
    expect(codes(a)).toContain('attachment.target_node.missing')
  })

  it('flags a missing source kind', () => {
    expect(codes({ id: 'x', target_node: 'vm-a' })).toContain('attachment.source.missing')
  })

  it('catalog kinds require a source.ref', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'catalog_role' } })).toContain(
      'attachment.catalog.ref.missing',
    )
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'catalog_container', ref: 'src:c/x' } }),
    ).toEqual([])
  })

  it('catalog kinds do NOT require a sha (sha is null from the backend today)', () => {
    const a = { id: 'x', target_node: 'vm-a', source: { kind: 'catalog_role', ref: 'src:roles/x' } }
    expect(codes(a)).not.toContain('attachment.git.sha.missing')
    expect(codes(a)).toEqual([])
  })

  it('inline_yaml and file_upload require content_ref', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'inline_yaml' } })).toContain(
      'attachment.content.missing',
    )
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'file_upload' } })).toContain(
      'attachment.content.missing',
    )
  })

  it('external_git requires a url and a pinned sha', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git' } })).toEqual(
      expect.arrayContaining(['attachment.git.url.missing', 'attachment.git.sha.missing']),
    )
  })

  it('external_git rejects a malformed url', () => {
    const a = { id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'not a url', sha: 'abc' } }
    expect(codes(a)).toContain('attachment.git.url.invalid')
  })

  it('external_git accepts https and git@ ssh urls with a sha', () => {
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'https://gh/o/r.git', sha: 'abc' } }),
    ).toEqual([])
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'git@gh:o/r.git', sha: 'abc' } }),
    ).toEqual([])
  })
})

describe('normalizeAttachments', () => {
  it('maps legacy rows to canonical and tolerates empty input', () => {
    const out = normalizeAttachments([{ id: 'a', node_id: 'vm-a', order: 1 }])
    expect(out[0]).toMatchObject({ target_node: 'vm-a', order_in_stage: 1 })
    expect(out[0].node_id).toBeUndefined()
    expect(normalizeAttachments(null)).toEqual([])
  })
})
