import { ref, computed, type Ref } from 'vue';
import {
  validateDockerNode,
  getTeamScopeAncestorId,
} from './useInfraBuilder';
import { validateAttachment } from './useAttachments';

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface Problem {
  id: string;
  severity: ProblemSeverity;
  code: string;
  message: string;
  node_id?: string;
  edge_id?: string;
  attachment_id?: string;
  file_path?: string;
  line?: number;
  /** Stable descriptor for the Problems panel's jumpTo emit */
  jumpTo?: { kind: 'node' | 'edge' | 'attachment' | 'file'; id: string };
}

/**
 * Collect validation problems from the current topology + attachments.
 * Pure — callers pass in the live nodes/edges/attachments lists; this keeps
 * the composable testable without mocking VueFlow or a Pinia store.
 */
export function collectProblems(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  attachments: Array<Record<string, unknown>> = [],
): Problem[] {
  const out: Problem[] = [];

  // --- Docker node validation (host_ref required + must be vm|lxc) ---
  for (const n of nodes || []) {
    if ((n as { type?: string }).type !== 'docker') continue;
    // validateDockerNode returns { ok, code, message }
    // Our nodes array shape matches the validator's expectations.
    const res = validateDockerNode(n as never, nodes as never);
    if (!res.ok) {
      const nid = (n as { id: string }).id;
      out.push({
        id: `docker-${nid}-${res.code}`,
        severity: 'error',
        code: res.code!,
        message: res.message!,
        node_id: nid,
        jumpTo: { kind: 'node', id: nid },
      });
    }
  }

  // --- Team_scope without team_count warning ---
  for (const n of nodes || []) {
    const node = n as { id: string; type?: string; data?: Record<string, unknown> };
    if (node.type !== 'group') continue;
    if (node.data?.kind !== 'team_scope') continue;
    const tc = Number(
      (node.data as { team_count?: unknown; defaults?: { team_count?: unknown } }).team_count ??
        (node.data as { defaults?: { team_count?: unknown } }).defaults?.team_count,
    );
    if (!Number.isFinite(tc) || tc < 1) {
      out.push({
        id: `team_scope-${node.id}-missing-count`,
        severity: 'warning',
        code: 'team_scope.team_count.missing',
        message: `Team scope '${node.id}' has no team_count — defaulting to 1 at deploy`,
        node_id: node.id,
        jumpTo: { kind: 'node', id: node.id },
      });
    }
  }

  // --- Edge replication_intent sanity: mesh requires both ends in same team_scope ---
  const byId = new Map((nodes || []).map((n) => [(n as { id: string }).id, n]));
  for (const e of edges || []) {
    const edge = e as {
      id: string;
      source: string;
      target: string;
      data?: { replication_intent?: string; synthetic?: boolean };
    };
    const intent = edge.data?.replication_intent;
    if (!intent || edge.data?.synthetic) continue;
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);
    const sScope = src ? getTeamScopeAncestorId(src as never, nodes as never) : null;
    const tScope = tgt ? getTeamScopeAncestorId(tgt as never, nodes as never) : null;
    if (intent === 'mesh' && (!sScope || sScope !== tScope)) {
      out.push({
        id: `edge-${edge.id}-mesh-invalid`,
        severity: 'error',
        code: 'edge.replication_intent.mesh_across_scopes',
        message: `Edge '${edge.id}' is tagged mesh but its endpoints are not in the same team_scope`,
        edge_id: edge.id,
        jumpTo: { kind: 'edge', id: edge.id },
      });
    }
    if (intent === 'pair_scoped' && (sScope || tScope)) {
      out.push({
        id: `edge-${edge.id}-pair-in-scope`,
        severity: 'warning',
        code: 'edge.replication_intent.pair_in_scope',
        message: `Edge '${edge.id}' is tagged pair_scoped but one endpoint lives in a team_scope (did you mean fan_out?)`,
        edge_id: edge.id,
        jumpTo: { kind: 'edge', id: edge.id },
      });
    }
  }

  // --- Attachment drift (sha mismatch vs source) ---
  for (const a of attachments || []) {
    const att = a as { id: string; drifted?: boolean; file_path?: string; line?: number };
    if (att.drifted) {
      out.push({
        id: `attachment-${att.id}-drift`,
        severity: 'warning',
        code: 'attachment.drift',
        message: `Attachment '${att.id}' has drifted from its source (sha mismatch)`,
        attachment_id: att.id,
        file_path: att.file_path,
        line: att.line,
        jumpTo: { kind: 'attachment', id: att.id },
      });
    }
  }

  // --- Attachment completeness (per-kind required fields) ---
  for (const a of attachments || []) {
    const id = (a as { id?: string }).id;
    for (const p of validateAttachment(a as never)) {
      out.push({
        id: `attachment-${id}-${p.code}`,
        severity: 'error',
        code: p.code,
        message: p.message,
        attachment_id: id,
        jumpTo: { kind: 'attachment', id: id as string },
      });
    }
  }

  return out;
}

/**
 * Reactive Problems store — wrap `collectProblems` over reactive refs so the
 * Problems panel updates whenever nodes/edges/attachments change.
 */
export function useProblems(
  nodes: Ref<Array<Record<string, unknown>>>,
  edges: Ref<Array<Record<string, unknown>>>,
  attachments?: Ref<Array<Record<string, unknown>>>,
) {
  const extraProblems = ref<Problem[]>([]);

  const problems = computed(() =>
    [...collectProblems(nodes.value || [], edges.value || [], attachments?.value || []), ...extraProblems.value],
  );

  const errorCount = computed(() => problems.value.filter((p) => p.severity === 'error').length);
  const warningCount = computed(() => problems.value.filter((p) => p.severity === 'warning').length);

  function addProblem(p: Problem) {
    extraProblems.value.push(p);
  }
  function clearExtra() {
    extraProblems.value = [];
  }

  return {
    problems,
    errorCount,
    warningCount,
    addProblem,
    clearExtra,
  };
}

// ---------------------------------------------------------------------------
// Command palette — fuzzy matcher
// ---------------------------------------------------------------------------

export interface PaletteItem {
  id: string;
  label: string;
  subtitle?: string;
  kind: 'node' | 'attachment' | 'file' | 'command';
  jumpTo?: { kind: 'node' | 'edge' | 'attachment' | 'file'; id: string };
}

/**
 * Substring-first + scattered-characters fuzzy match. Returns a numeric score
 * (higher = better); 0 = no match.
 * - Exact substring hit → highest boost
 * - Every char of query appears in order → graduated score
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1; // empty query matches everything
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  if (!t) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // bonus for matches at the start of a token/word
    const startBonus = idx === 0 || /[\s/.\-_]/.test(t[idx - 1]) ? 100 : 50;
    return 1000 + startBonus - idx;
  }
  // scattered characters in order
  let ti = 0;
  let matched = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    matched += 1;
    ti = found + 1;
  }
  return matched; // 1..q.length
}

export function fuzzyFilter(items: PaletteItem[], query: string, limit = 20): PaletteItem[] {
  if (!items?.length) return [];
  const scored = items
    .map((item) => {
      const s1 = fuzzyScore(query, item.label);
      const s2 = item.subtitle ? fuzzyScore(query, item.subtitle) : 0;
      return { item, score: Math.max(s1, s2 / 2) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}
