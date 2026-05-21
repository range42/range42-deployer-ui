/**
 * Wiring helpers between the pure overlay serializer and the ProjectState
 * persistence layer. Thin glue: build a ProjectState from a canvas, and load
 * a canvas back from a ProjectState. No IO.
 */
import type { ProjectState } from '@/services/projectRepo';
import {
  serializeToCatalogEntry, deserializeToCanvas, extractLayout,
  type CanvasModel, type ProjectMeta, type CanvasLayout,
} from '@/overlay/serialize';
import type { CatalogEntry } from '@/types/range42-schema';

export function buildProjectState(
  canvas: CanvasModel,
  meta: ProjectMeta,
  existingMeta: Record<string, unknown> = {},
): ProjectState {
  const doc = serializeToCatalogEntry(canvas, meta);
  const layout = extractLayout(canvas);
  return {
    // The env-overlay layer (overlay.json) is a separate concern, untouched here.
    overlay: '',
    canvas_layout: JSON.stringify(layout),
    meta: { ...existingMeta, name: meta.name, bridge_base: meta.bridge_base ?? 140 },
    topology: JSON.stringify(doc, null, 2),
  };
}

function safeParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[projectState] failed to parse stored state; using fallback', e);
    return fallback;
  }
}

export function loadCanvasFromState(state: ProjectState): CanvasModel {
  const doc = safeParse<CatalogEntry>(state.topology, { nodes: [] } as CatalogEntry);
  const layout = safeParse<CanvasLayout>(state.canvas_layout, { nodes: {}, edges: {}, unsupported: [] });
  return deserializeToCanvas(doc, layout);
}
