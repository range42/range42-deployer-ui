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
