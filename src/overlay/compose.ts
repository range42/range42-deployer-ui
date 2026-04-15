/**
 * compose(base, overlay) -> effective catalog document.
 *
 * Mirrors range42-backend-api/app/overlay/compose.py. Pure function; no
 * IO. Byte-identical JSON output on shared test vectors.
 *
 * Rules (spec §3):
 *   - param_overrides: dotted-path mutation of base['defaults'] and nested
 *     addressing of nodes[].children[].config fields.
 *   - nodes_added: append to base['nodes'] (overlay wins for structural
 *     edits).
 *   - nodes_removed: drop by id at top level and within group.children.
 *   - nodes_patched: shallow merge patch into the matching node object.
 *   - attachments_added: append to each target_node's attachments list,
 *     dropping the `target_node` key.
 *   - execution_override: replace base['execution'] if set.
 */
import type { CatalogEntry, ProjectOverlay } from '@/types/range42-schema';

type Dict = Record<string, unknown>;

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function applyParamOverride(root: Dict, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (isDict(cur)) {
      if (cur[p] === undefined) cur[p] = {};
      cur = cur[p];
    } else if (Array.isArray(cur)) {
      if (/^\d+$/.test(p)) {
        cur = cur[parseInt(p, 10)];
      } else {
        let match = cur.find(
          (x) => isDict(x) && (x as Dict).id === p,
        ) as Dict | undefined;
        if (match === undefined) {
          match = { id: p };
          cur.push(match);
        }
        cur = match;
      }
    } else {
      return;
    }
  }
  if (isDict(cur)) {
    cur[parts[parts.length - 1]] = value;
  }
}

function removeById(nodes: Dict[], nodeId: string): Dict[] {
  const out: Dict[] = [];
  for (const n of nodes) {
    if ((n as Dict).id === nodeId) continue;
    let next: Dict = n;
    if (Array.isArray((n as Dict).children)) {
      next = { ...n, children: removeById((n as Dict).children as Dict[], nodeId) };
    }
    out.push(next);
  }
  return out;
}

function patchById(nodes: Dict[], nodeId: string, patch: Dict): void {
  for (const n of nodes) {
    if ((n as Dict).id === nodeId) {
      Object.assign(n as Dict, patch);
    }
    const children = (n as Dict).children;
    if (Array.isArray(children)) {
      patchById(children as Dict[], nodeId, patch);
    }
  }
}

function findNodeAndAddAttachment(
  nodes: Dict[],
  targetId: string,
  attachment: Dict,
): boolean {
  for (const n of nodes) {
    if ((n as Dict).id === targetId) {
      const attsRaw = (n as Dict).attachments;
      const atts = Array.isArray(attsRaw) ? (attsRaw as Dict[]) : [];
      const cleaned: Dict = {};
      for (const [k, v] of Object.entries(attachment)) {
        if (k !== 'target_node') cleaned[k] = v;
      }
      atts.push(cleaned);
      (n as Dict).attachments = atts;
      return true;
    }
    const children = (n as Dict).children;
    if (Array.isArray(children)) {
      if (findNodeAndAddAttachment(children as Dict[], targetId, attachment)) {
        return true;
      }
    }
  }
  return false;
}

export function compose(
  base: CatalogEntry,
  overlay: ProjectOverlay | null | undefined,
): CatalogEntry {
  const eff = deepClone(base) as unknown as Dict;
  if (!overlay) return eff as unknown as CatalogEntry;

  const paramOverrides = overlay.param_overrides ?? {};
  for (const dotted of Object.keys(paramOverrides)) {
    applyParamOverride(eff, dotted, (paramOverrides as Dict)[dotted]);
  }

  const nodesAdded = overlay.nodes_added ?? [];
  if (nodesAdded.length > 0) {
    if (!Array.isArray(eff.nodes)) eff.nodes = [];
    for (const node of nodesAdded) {
      (eff.nodes as Dict[]).push(deepClone(node as unknown as Dict));
    }
  }

  const nodesRemoved = overlay.nodes_removed ?? [];
  for (const nodeId of nodesRemoved) {
    eff.nodes = removeById((eff.nodes as Dict[]) ?? [], nodeId);
  }

  const nodesPatched = overlay.nodes_patched ?? [];
  for (const entry of nodesPatched) {
    patchById(
      (eff.nodes as Dict[]) ?? [],
      entry.id,
      deepClone(entry.patch as Dict),
    );
  }

  const attsAdded = overlay.attachments_added ?? [];
  for (const att of attsAdded) {
    const tgt = (att as unknown as Dict).target_node as string | undefined;
    if (tgt) {
      findNodeAndAddAttachment(
        (eff.nodes as Dict[]) ?? [],
        tgt,
        deepClone(att as unknown as Dict),
      );
    }
  }

  if (overlay.execution_override !== undefined && overlay.execution_override !== null) {
    eff.execution = deepClone(overlay.execution_override as unknown as Dict);
  }

  return eff as unknown as CatalogEntry;
}
