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
