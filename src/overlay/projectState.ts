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

export function buildProjectState(canvas: CanvasModel, meta: ProjectMeta): ProjectState {
  const doc = serializeToCatalogEntry(canvas, meta);
  const layout = extractLayout(canvas);
  return {
    overlay: '',
    canvas_layout: JSON.stringify(layout),
    meta: { name: meta.name, bridge_base: meta.bridge_base ?? 140 },
    topology: JSON.stringify(doc, null, 2),
  };
}

export function loadCanvasFromState(state: ProjectState): CanvasModel {
  const doc = (state.topology ? JSON.parse(state.topology) : { nodes: [] }) as CatalogEntry;
  const layout = (state.canvas_layout ? JSON.parse(state.canvas_layout) : { nodes: {}, edges: {}, unsupported: [] }) as CanvasLayout;
  return deserializeToCanvas(doc, layout);
}
