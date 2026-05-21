/**
 * serialize(canvas) -> CatalogEntry. Inverse of compose.ts.
 *
 * Pure, no IO. Maps the VueFlow canvas model to the canonical schema
 * document the deploy pipeline reads as topology.json. Non-canonical UI
 * data (positions, edge handles/extras, unsupported nodes) is handled by
 * extractLayout (a later task), NOT this function.
 */
import type {
  Attachment, CatalogEntry, CatalogKind, NetworkAttachment, Node, NodeKind, NodeRole, ReplicationScope,
} from '@/types/range42-schema';
import { getTeamScopeAncestorId, normalizeAttachment } from '@/composables/useInfraBuilder';

export interface CanvasModel {
  nodes: any[];
  edges: any[];
  attachments: any[];
}

export interface ProjectMeta {
  name: string;
  kind?: CatalogKind;
  bridge_base?: number;
}

const TYPE_TO_KIND: Record<string, NodeKind> = {
  vm: 'vm', lxc: 'lxc', docker: 'docker',
  'network-segment': 'network', router: 'router',
  'edge-firewall': 'firewall', group: 'group', skin: 'skin',
};

export function mapKind(vueFlowType: string): NodeKind | null {
  return TYPE_TO_KIND[vueFlowType] ?? null;
}

export function sanitizeNamingPrefix(name: string): string {
  const s = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return s || 'lab';
}

function parentOf(node: any): string | null {
  return node.parentNode ?? node.parent ?? null;
}

function attachmentsByNode(attachments: any[]): Map<string, Attachment[]> {
  const byNode = new Map<string, Attachment[]>();
  for (const raw of attachments || []) {
    const a = normalizeAttachment(raw);
    if (!a?.target_node) continue;
    const { target_node: _t, inherited: _i, inherited_from: _if, ...rest } = a;
    if (!byNode.has(_t)) byNode.set(_t, []);
    byNode.get(_t)!.push(rest as Attachment);
  }
  return byNode;
}

function buildNodeTree(canvas: CanvasModel): Node[] {
  const supported = (canvas.nodes || []).filter((n) => mapKind(n.type) !== null);
  const supportedIds = new Set(supported.map((n) => n.id));
  const attMap = attachmentsByNode(canvas.attachments);
  const childrenByParent = new Map<string, any[]>();
  const roots: any[] = [];
  for (const n of supported) {
    const p = parentOf(n);
    if (p && supportedIds.has(p)) {
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(n);
    } else {
      roots.push(n);
    }
  }

  // The canonical doc is a strict tree (each node has exactly one parent), so
  // each node is built once. A repeated id means a cyclic parentNode reference
  // in a corrupted canvas — fail loudly instead of recursing forever.
  // Nodes that form a pure cycle (no root ancestor) never appear in roots and
  // would be silently dropped; detect them explicitly before recursing.
  const visited = new Set<string>();
  const build = (raw: any): Node => {
    if (visited.has(raw.id)) {
      throw new Error(`buildNodeTree: cycle detected at node '${raw.id}'`);
    }
    visited.add(raw.id);
    const node = buildNode(raw, canvas.nodes, canvas.edges);
    if (raw.type === 'group') {
      const scope: ReplicationScope = raw.data?.kind === 'team_scope' ? 'per_team' : 'shared';
      node.replication = { scope };
    }
    const atts = attMap.get(raw.id);
    if (atts?.length) node.attachments = atts;
    const kids = childrenByParent.get(raw.id);
    if (kids?.length) node.children = kids.map(build);
    return node;
  };
  const result = roots.map(build);
  // Any supported node not visited after a full traversal is part of a cycle
  // (it has a parent in supportedIds but is never reachable from a root).
  for (const n of supported) {
    if (!visited.has(n.id)) {
      throw new Error(`buildNodeTree: cycle detected at node '${n.id}'`);
    }
  }
  return result;
}

export function serializeToCatalogEntry(
  canvas: CanvasModel,
  meta: ProjectMeta,
): CatalogEntry {
  const hasTeamScope = (canvas.nodes || []).some(
    (n) => n.type === 'group' && n.data?.kind === 'team_scope',
  );
  const kind: CatalogKind = meta.kind ?? (hasTeamScope ? 'gamenet' : 'lab');
  return {
    schema_version: '1.0',
    kind,
    name: meta.name,
    naming_prefix: sanitizeNamingPrefix(meta.name),
    bridge_base: meta.bridge_base ?? 140,
    nodes: buildNodeTree(canvas),
  };
}

const HOST_KINDS = new Set<NodeKind>(['vm', 'lxc', 'docker']);
const DROP_CONFIG_KEYS = new Set(['template', 'ipAddress', 'vmId', 'role', 'host_ref', 'vlan']);

export function inferRole(node: any, allNodes: any[]): NodeRole {
  return getTeamScopeAncestorId(node, allNodes) ? 'team' : 'admin';
}

function isNetwork(nodeId: string, allNodes: any[]): boolean {
  const n = allNodes.find((x) => x.id === nodeId);
  return n?.type === 'network-segment';
}

export function buildNetworks(
  nodeId: string, edges: any[], allNodes: any[],
): NetworkAttachment[] {
  if (isNetwork(nodeId, allNodes)) return [];
  const byRef = new Map<string, NetworkAttachment>();
  for (const e of edges || []) {
    let netId: string | null = null;
    if (e.source === nodeId && isNetwork(e.target, allNodes)) netId = e.target;
    else if (e.target === nodeId && isNetwork(e.source, allNodes)) netId = e.source;
    if (!netId) continue;
    const conn = e.data?.connection ?? {};
    const ip = conn.ipAddress ? String(conn.ipAddress) : '';
    const dhcp = !!e.data?.useDhcp || !ip;
    const na: NetworkAttachment = { node_ref: netId };
    if (dhcp) na.dhcp = true;
    else na.ip = ip;
    byRef.set(netId, na);
  }
  return [...byRef.values()];
}

export function buildNode(node: any, allNodes: any[], edges: any[]): Node {
  const kind = mapKind(node.type);
  if (kind === null) {
    throw new Error(`buildNode: unsupported node type '${node.type}' (id=${node.id})`);
  }
  const rawConfig = node.data?.config ?? {};
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawConfig)) {
    if (!DROP_CONFIG_KEYS.has(k)) config[k] = v;
  }

  const out: Node = { id: node.id, kind };
  if (Object.keys(config).length > 0) out.config = config;

  if (HOST_KINDS.has(kind)) {
    out.role = (rawConfig.role as NodeRole) ?? inferRole(node, allNodes);
    const tpl = Number(rawConfig.template);
    // Proxmox reserves VMIDs below 100; only accept real user template IDs.
    if (Number.isFinite(tpl) && tpl >= 100) out.template_vmid = tpl;
  }
  if (kind === 'docker') {
    const ref = node.data?.host_ref ?? rawConfig.host_ref;
    if (ref) out.host_ref = String(ref);
  }
  // Network node: lift vlan -> vlan_tag (node-level per schema). `vlan` is in
  // DROP_CONFIG_KEYS so it never reaches out.config.
  if (kind === 'network' && rawConfig.vlan != null) {
    const v = Number(rawConfig.vlan);
    if (Number.isFinite(v)) out.vlan_tag = v;
  }
  // Compute/appliance nodes carry their network attachments derived from edges.
  if (HOST_KINDS.has(kind) || kind === 'router' || kind === 'firewall') {
    const nets = buildNetworks(node.id, edges, allNodes);
    if (nets.length > 0) out.networks = nets;
  }
  return out;
}
