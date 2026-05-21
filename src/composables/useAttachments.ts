/**
 * useAttachments — pure data operations over the canonical Attachment shape.
 *
 * No DOM, no reactivity, no network: every function takes plain data and
 * returns plain data, so the attachment editor and host components can compose
 * them while staying fully unit-testable. Content-file storage for
 * inline_yaml/file_upload is intentionally NOT handled here (Phase 1b).
 */
import type {
  Attachment,
  AttachmentScope,
  AttachmentSource,
  AttachmentSourceKind,
} from '@/types/range42-schema'
import { normalizeAttachment } from '@/composables/useInfraBuilder'

const DEFAULT_STAGE = 'main'

export interface CreateAttachmentOptions {
  id?: string
  stage?: string
  title?: string
}

/** Build a new canonical attachment for `targetNode` with sane defaults. */
export function createAttachment(
  kind: AttachmentSourceKind,
  targetNode: string,
  opts: CreateAttachmentOptions = {},
): Attachment {
  const att: Attachment = {
    id: opts.id ?? crypto.randomUUID(),
    target_node: targetNode,
    source: { kind },
    stage: opts.stage ?? DEFAULT_STAGE,
    scope: 'node',
  }
  if (opts.title) att.title = opts.title
  return att
}

/** Shallow-merge `patch` onto the attachment with `id`. Returns a new array. */
export function updateAttachment(
  attachments: Attachment[] | null | undefined,
  id: string,
  patch: Partial<Attachment>,
): Attachment[] {
  return (attachments ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a))
}

/** Remove the attachment with `id`. Returns a new array. */
export function removeAttachment(
  attachments: Attachment[] | null | undefined,
  id: string,
): Attachment[] {
  return (attachments ?? []).filter((a) => a.id !== id)
}

/** Set `scope` on the attachment with `id`. */
export function setAttachmentScope(
  attachments: Attachment[] | null | undefined,
  id: string,
  scope: AttachmentScope,
): Attachment[] {
  return updateAttachment(attachments, id, { scope })
}

/** Set the canonical `order_in_stage` on the attachment with `id`. */
export function setAttachmentOrder(
  attachments: Attachment[] | null | undefined,
  id: string,
  order: number,
): Attachment[] {
  return updateAttachment(attachments, id, { order_in_stage: order })
}

/** Merge `sourcePatch` into the attachment's `source` (preserves other source fields). */
export function setAttachmentSource(
  attachments: Attachment[] | null | undefined,
  id: string,
  sourcePatch: Partial<AttachmentSource>,
): Attachment[] {
  return (attachments ?? []).map((a) =>
    a.id === id ? { ...a, source: { ...a.source, ...sourcePatch } } : a,
  )
}

export interface AttachmentProblem {
  field: string
  code: string
  message: string
}

function isValidGitUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url) || /^git@[^:\s]+:\S+$/.test(url) || /^ssh:\/\/\S+$/.test(url)
}

/**
 * Return the completeness problems for an attachment (empty = valid/deployable).
 * Per-kind rules; catalog `sha` is intentionally NOT required (the backend
 * emits null shas today — see the attachments spec).
 */
export function validateAttachment(a: Attachment | null | undefined): AttachmentProblem[] {
  const problems: AttachmentProblem[] = []
  if (!a || typeof a !== 'object') return problems
  if (!a.target_node) {
    problems.push({
      field: 'target_node',
      code: 'attachment.target_node.missing',
      message: 'Attachment has no target node',
    })
  }
  const src = a.source
  if (!src || !src.kind) {
    problems.push({
      field: 'source.kind',
      code: 'attachment.source.missing',
      message: 'Attachment has no source kind',
    })
    return problems
  }
  switch (src.kind) {
    case 'catalog_role':
    case 'catalog_container':
      if (!src.ref) {
        problems.push({
          field: 'source.ref',
          code: 'attachment.catalog.ref.missing',
          message: 'Catalog attachment has no source reference',
        })
      }
      break
    case 'inline_yaml':
    case 'file_upload':
      if (!src.content_inline) {
        problems.push({
          field: 'source.content_inline',
          code: 'attachment.content.missing',
          message: 'Attachment has no content',
        })
      }
      break
    case 'external_git':
      if (!src.url) {
        problems.push({
          field: 'source.url',
          code: 'attachment.git.url.missing',
          message: 'External git attachment has no URL',
        })
      } else if (!isValidGitUrl(src.url)) {
        problems.push({
          field: 'source.url',
          code: 'attachment.git.url.invalid',
          message: 'External git URL must be https:// or git@host:path',
        })
      }
      if (!src.sha) {
        problems.push({
          field: 'source.sha',
          code: 'attachment.git.sha.missing',
          message: 'External git attachment must be pinned to a commit sha',
        })
      }
      break
  }
  return problems
}

/** Upgrade a list of (possibly legacy) attachment rows to canonical shape. */
export function normalizeAttachments(
  attachments: Attachment[] | null | undefined,
): Attachment[] {
  return (attachments ?? []).map(normalizeAttachment)
}
