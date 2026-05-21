/**
 * serialize(canvas) -> CatalogEntry. Inverse of compose.ts.
 *
 * Pure, no IO. Maps the VueFlow canvas model to the canonical schema
 * document the deploy pipeline reads as topology.json. Non-canonical UI
 * data (positions, edge handles/extras, unsupported nodes) is handled by
 * extractLayout (a later task), NOT this function.
 */
import type {
  CatalogEntry, CatalogKind, Node, NodeKind, NodeRole,
} from '@/types/range42-schema';
import { getTeamScopeAncestorId } from '@/composables/useInfraBuilder';

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
    nodes: [],
  };
}

const HOST_KINDS = new Set<NodeKind>(['vm', 'lxc', 'docker']);
const DROP_CONFIG_KEYS = new Set(['template', 'ipAddress', 'vmId', 'role', 'host_ref']);

export function inferRole(node: any, allNodes: any[]): NodeRole {
  return getTeamScopeAncestorId(node, allNodes) ? 'team' : 'admin';
}

export function buildNode(node: any, allNodes: any[], _edges: any[]): Node {
  const kind = mapKind(node.type) as NodeKind;
  const rawConfig = node.data?.config ?? {};
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawConfig)) {
    if (!DROP_CONFIG_KEYS.has(k)) config[k] = v;
  }

  const out: Node = { id: node.id, kind };
  if (Object.keys(config).length > 0) out.config = config;

  if (HOST_KINDS.has(kind)) {
    out.role = (rawConfig.role as NodeRole) ?? inferRole(node, allNodes);
    const tpl = parseInt(String(rawConfig.template ?? ''), 10);
    if (Number.isFinite(tpl) && tpl >= 100) out.template_vmid = tpl;
  }
  if (kind === 'docker') {
    const ref = node.data?.host_ref ?? rawConfig.host_ref;
    if (ref) out.host_ref = String(ref);
  }
  return out;
}
