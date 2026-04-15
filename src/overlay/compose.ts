import type { CatalogEntry, ProjectOverlay } from '@/types/range42-schema';
import { NotImplemented } from './errors';

/**
 * compose(base, overlay) -> effective catalog document.
 *
 * v1 Plan A skeleton: identity-only. If the overlay carries no structural
 * edits (no nodes_added, nodes_removed, nodes_patched, attachments_added,
 * execution_override, or param_overrides), returns a shallow clone of the
 * base. Anything more raises NotImplemented — real implementation lands in
 * Plan B.
 */
export function compose(base: CatalogEntry, overlay: ProjectOverlay): CatalogEntry {
  const hasStructuralEdits =
    (overlay.nodes_added && overlay.nodes_added.length > 0) ||
    (overlay.nodes_removed && overlay.nodes_removed.length > 0) ||
    (overlay.nodes_patched && overlay.nodes_patched.length > 0) ||
    (overlay.attachments_added && overlay.attachments_added.length > 0) ||
    overlay.execution_override !== undefined ||
    (overlay.param_overrides && Object.keys(overlay.param_overrides).length > 0);

  if (hasStructuralEdits) {
    throw new NotImplemented('compose', 'structural-edits', 'Plan B delivery');
  }

  return structuredClone(base);
}
