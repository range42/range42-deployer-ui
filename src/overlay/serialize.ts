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
import type { Dimensions, XYPosition } from '@vue-flow/core';

export interface CanvasNodeData {
  type?: string;
  kind?: string;
  label?: string;
  status?: string;
  config?: Record<string, unknown>;
  host_ref?: unknown;
  [key: string]: unknown;
}

/** Persisted canvas fields; additional visual metadata stays outside topology. */
export interface CanvasNode {
  id: string;
  type?: string;
  parentNode?: string;
  parent?: string;
  position?: XYPosition;
  dimensions?: Dimensions;
  style?: unknown;
  data?: CanvasNodeData;
  [key: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: {
    connection?: Record<string, unknown>;
    useDhcp?: boolean;
    synthetic?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Both legacy aliases and runtime inheritance markers are normalized on save. */
export interface CanvasAttachment extends Attachment {
  node_id?: string;
  order?: number;
  inherited?: boolean;
  inherited_from?: string;
}

export interface CanvasModel {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  attachments: CanvasAttachment[];
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

export function mapKind(vueFlowType: string | undefined): NodeKind | null {
  return vueFlowType ? TYPE_TO_KIND[vueFlowType] ?? null : null;
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

function parentOf(node: CanvasNode): string | null {
  return node.parentNode ?? node.parent ?? null;
}

function attachmentsByNode(attachments: CanvasAttachment[]): Map<string, Attachment[]> {
  const byNode = new Map<string, Attachment[]>();
  for (const raw of attachments || []) {
    const a: CanvasAttachment = normalizeAttachment(raw);
    if (!a?.target_node) continue;
    // Strip serialization-layer keys before embedding under the node:
    // `target_node` becomes implicit (the node it nests under); `inherited` /
    // `inherited_from` are runtime-only markers added by
    // computeEffectiveAttachments and never part of the persisted schema.
    const { target_node: _t, inherited: _i, inherited_from: _if, ...rest } = a;
    if (!byNode.has(_t)) byNode.set(_t, []);
    byNode.get(_t)!.push(rest);
  }
  return byNode;
}

function buildNodeTree(canvas: CanvasModel): Node[] {
  const supported = (canvas.nodes || []).filter((n) => mapKind(n.type) !== null);
  const supportedIds = new Set(supported.map((n) => n.id));
  const attMap = attachmentsByNode(canvas.attachments);
  const childrenByParent = new Map<string, CanvasNode[]>();
  const roots: CanvasNode[] = [];
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
  const build = (raw: CanvasNode): Node => {
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

export function inferRole(node: CanvasNode, allNodes: CanvasNode[]): NodeRole {
  return getTeamScopeAncestorId(node, allNodes) ? 'team' : 'admin';
}

function isNetwork(nodeId: string, allNodes: CanvasNode[]): boolean {
  const n = allNodes.find((x) => x.id === nodeId);
  return n?.type === 'network-segment';
}

export function buildNetworks(
  nodeId: string, edges: CanvasEdge[], allNodes: CanvasNode[],
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

export interface CanvasLayout {
  nodes: Record<string, {
    position?: { x: number; y: number };
    dimensions?: Dimensions;
    style?: unknown;
    label?: string;
  }>;
  edges: Record<string, {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    connection?: Record<string, unknown>;
  }>;
  unsupported: CanvasNode[];
}

export function edgeKey(source: string, target: string): string {
  return `${source}|${target}`;
}

export function extractLayout(canvas: CanvasModel): CanvasLayout {
  const layout: CanvasLayout = { nodes: {}, edges: {}, unsupported: [] };
  for (const n of canvas.nodes || []) {
    if (mapKind(n.type) === null) {
      layout.unsupported.push(JSON.parse(JSON.stringify(n)));
      continue;
    }
    layout.nodes[n.id] = {
      position: n.position,
      dimensions: n.dimensions,
      style: n.style,
      label: n.data?.label,
    };
  }
  for (const e of canvas.edges || []) {
    if (e.data?.synthetic) continue; // docker tethers are re-derived
    // Canonicalize compute<->network edges to edgeKey(computeEnd, networkEnd)
    // so the deserialize lookup (keyed compute|network) hits regardless of the
    // direction the user drew the edge. buildNetworks dedupes by network, so a
    // single layout entry per (compute, network) pair is the intended grain.
    let from = e.source;
    let to = e.target;
    if (isNetwork(e.source, canvas.nodes) && !isNetwork(e.target, canvas.nodes)) {
      from = e.target;
      to = e.source;
    }
    layout.edges[edgeKey(from, to)] = {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      connection: e.data?.connection,
    };
  }
  return layout;
}

const KIND_TO_TYPE: Record<NodeKind, string> = {
  vm: 'vm', lxc: 'lxc', docker: 'docker',
  network: 'network-segment', router: 'router',
  firewall: 'edge-firewall', group: 'group', skin: 'skin',
};

export function deserializeToCanvas(
  doc: CatalogEntry, layout: CanvasLayout,
): CanvasModel {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const attachments: CanvasAttachment[] = [];

  const walk = (n: Node, parentId: string | null) => {
    const type = KIND_TO_TYPE[n.kind];
    const lay = layout.nodes?.[n.id] ?? {};
    // Rebuild the canvas config from the doc. role/template_vmid/vlan_tag live
    // as node-level schema fields (never inside doc config — buildNode strips
    // them), so re-injecting them here is a stable round-trip fixpoint.
    const config: Record<string, unknown> = { ...(n.config ?? {}) };
    if (n.role) config.role = n.role;
    if (n.template_vmid != null) config.template = String(n.template_vmid);
    if (n.kind === 'network' && n.vlan_tag != null) config.vlan = n.vlan_tag;

    const data: CanvasNodeData = { type, config, status: 'gray' };
    if (lay.label) data.label = lay.label;
    if (n.kind === 'group') data.kind = n.replication?.scope === 'per_team' ? 'team_scope' : 'topology_group';
    if (n.kind === 'docker' && n.host_ref) data.host_ref = n.host_ref;

    // Position is visual-only (lives in canvas_layout, not the canonical doc).
    // A missing layout entry defaults to origin — so the layout round-trip is
    // "≈" not "==" for nodes that never had a position. Real VueFlow nodes
    // always carry one.
    const node: CanvasNode = { id: n.id, type, position: lay.position ?? { x: 0, y: 0 }, data };
    if (parentId) { node.parentNode = parentId; node.extent = 'parent'; }
    if (lay.dimensions) node.dimensions = lay.dimensions;
    if (lay.style) node.style = lay.style;
    nodes.push(node);

    for (const na of n.networks ?? []) {
      const key = edgeKey(n.id, na.node_ref);
      const le = layout.edges?.[key];
      const connection: Record<string, unknown> = { ...(le?.connection ?? {}) };
      if (na.ip) connection.ipAddress = na.ip;
      edges.push({
        id: le?.id ?? `e-${n.id}-${na.node_ref}`,
        source: le?.source ?? n.id,
        target: le?.target ?? na.node_ref,
        type: 'network',
        sourceHandle: le?.sourceHandle, targetHandle: le?.targetHandle,
        data: { connection, useDhcp: !!na.dhcp },
      });
    }
    for (const att of n.attachments ?? []) {
      attachments.push({ ...att, target_node: n.id });
    }
    for (const child of n.children ?? []) walk(child, n.id);
  };

  for (const n of doc.nodes ?? []) walk(n, null);
  for (const u of layout.unsupported ?? []) nodes.push(JSON.parse(JSON.stringify(u)));

  return { nodes, edges, attachments };
}

function isNodeRole(value: unknown): value is NodeRole {
  return value === 'admin' || value === 'team' || value === 'trainee' || value === 'shared';
}

export function buildNode(node: CanvasNode, allNodes: CanvasNode[], edges: CanvasEdge[]): Node {
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
    const role = rawConfig.role;
    if (role != null && !isNodeRole(role)) throw new Error(`buildNode: invalid role for node '${node.id}'`);
    out.role = role ?? inferRole(node, allNodes);
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
