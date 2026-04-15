/**
 * expand_replication — emits one Ansible play per team with handler name
 * rewrites for play-level notify references (spec §3).
 *
 * Byte-parity with range42-backend-api/app/overlay/expand_replication.py.
 *
 * For every top-level node with replication.scope == 'per_team' (and each
 * group's children), emit N copies with per-team offsets applied to
 * vmid, ip, bridge, vlan, hostname, flag values.
 *
 * Handler-namespace rewrite: attachment.handler_namespace is suffixed by
 * team id when the attachment is a handler. Attachment-level notify lists
 * are rewritten (`<name>` -> `<name>__team_<id>`). Role-internal handlers
 * are intentionally left untouched — per-team play boundaries isolate
 * them.
 */
import type { CatalogEntry } from '@/types/range42-schema';

type Dict = Record<string, unknown>;

export interface ExpandResult {
  plays_per_team: number;
  handler_namespaces: string[];
  document: CatalogEntry;
}

const TEMPLATE_RE = /\{(\d*)\s*([+\-*])?\s*team_id\s*\}/g;

function renderTemplate(tpl: string, teamId: number): string {
  return tpl.replace(TEMPLATE_RE, (_m, basePart: string, opPart: string | undefined) => {
    const base = basePart ? parseInt(basePart, 10) : 0;
    const op = opPart || '+';
    if (op === '+') return String(base + teamId);
    if (op === '-') return String(base - teamId);
    return String(base * teamId);
  });
}

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

function applyOffsets(
  node: Dict,
  teamId: number,
  idOffset: Dict | null,
  namespaceSink: string[],
): Dict {
  const out = deepClone(node) as Dict;
  out.id = `${String(node.id)}__team_${teamId}`;
  const cfgRaw = out.config;
  const cfg: Dict = (cfgRaw && typeof cfgRaw === 'object' ? cfgRaw : {}) as Dict;
  if (typeof cfg.name_template === 'string') {
    cfg.name = renderTemplate(cfg.name_template as string, teamId);
    delete cfg.name_template;
  }
  if (typeof cfg.bridge_template === 'string') {
    cfg.bridge = renderTemplate(cfg.bridge_template as string, teamId);
    delete cfg.bridge_template;
  }
  if (typeof cfg.vlan_template === 'string') {
    cfg.vlan = parseInt(renderTemplate(cfg.vlan_template as string, teamId), 10);
    delete cfg.vlan_template;
  }
  if (typeof cfg.cidr_template === 'string') {
    cfg.cidr = renderTemplate(cfg.cidr_template as string, teamId);
    delete cfg.cidr_template;
  }
  if (idOffset && typeof idOffset.vmid === 'number' && cfg.vm_id !== undefined) {
    cfg.vm_id = Number(cfg.vm_id) + (idOffset.vmid as number) * teamId;
  }
  out.config = cfg;
  const networks = out.networks;
  if (Array.isArray(networks)) {
    for (const nw of networks as Dict[]) {
      if (typeof nw.ip_template === 'string') {
        nw.ip = renderTemplate(nw.ip_template as string, teamId);
        delete nw.ip_template;
      }
    }
  }
  const atts = out.attachments;
  if (Array.isArray(atts)) {
    for (const att of atts as Dict[]) {
      const notify = att.notify;
      if (Array.isArray(notify)) {
        att.notify = (notify as string[]).map((n) => `${n}__team_${teamId}`);
      } else if (typeof notify === 'string') {
        att.notify = `${notify}__team_${teamId}`;
      }
      if (att.ansible_primitive === 'handler') {
        const baseNs =
          typeof att.handler_namespace === 'string' ? (att.handler_namespace as string) : '';
        const ns = baseNs ? `${baseNs}__team_${teamId}` : `team_${teamId}`;
        att.handler_namespace = ns;
        namespaceSink.push(ns);
      }
    }
  }
  return out;
}

function walkAndExpand(
  nodes: Dict[],
  teamCount: number,
  namespaceSink: string[],
): Dict[] {
  const result: Dict[] = [];
  for (const n of nodes) {
    const rep = (n.replication as Dict | undefined) ?? {};
    const scope = (rep.scope as string | undefined) ?? 'shared';
    if (scope === 'shared') {
      if (n.kind === 'group' && Array.isArray(n.children)) {
        const nn = deepClone(n) as Dict;
        nn.children = walkAndExpand(n.children as Dict[], teamCount, namespaceSink);
        result.push(nn);
      } else {
        result.push(deepClone(n) as Dict);
      }
      continue;
    }
    // per_team
    const idOffset = (rep.id_offset as Dict | undefined) ?? null;
    for (let tid = 1; tid <= teamCount; tid++) {
      if (n.kind === 'group' && Array.isArray(n.children)) {
        const expandedChildren = (n.children as Dict[]).map((c) =>
          applyOffsets(c, tid, idOffset, namespaceSink),
        );
        const grp = deepClone(n) as Dict;
        grp.id = `${String(n.id)}__team_${tid}`;
        grp.children = expandedChildren;
        grp.replication = { scope: 'shared' };
        result.push(grp);
      } else {
        result.push(applyOffsets(n, tid, idOffset, namespaceSink));
      }
    }
  }
  return result;
}

export function expand_replication(
  document: CatalogEntry,
  team_count: number,
): ExpandResult {
  if (team_count < 1) {
    throw new Error(`invalid team_count: ${team_count}`);
  }
  const out = deepClone(document) as unknown as Dict;
  const namespaceSink: string[] = [];
  out.nodes = walkAndExpand(
    ((document.nodes ?? []) as unknown as Dict[]).map((n) => n),
    team_count,
    namespaceSink,
  );
  return {
    plays_per_team: team_count,
    handler_namespaces: namespaceSink,
    document: out as unknown as CatalogEntry,
  };
}
