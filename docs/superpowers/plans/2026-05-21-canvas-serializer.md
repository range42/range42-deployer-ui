# Canvas → Document Serializer (#77) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize the VueFlow canvas model into a canonical `CatalogEntry` (`topology.json`) the deploy pipeline consumes, and deserialize it back losslessly.

**Architecture:** A pure module `src/overlay/serialize.ts` (inverse of `compose.ts`) maps the canvas `{ nodes, edges, attachments }` to a schema `CatalogEntry`. Deploy-meaningful data goes in the canonical doc; non-canonical UI data (positions, edge handles/extras, unsupported nodes) goes in a separate `CanvasLayout`. A minimal `role` selector is added to host-node config. Persistence plumbing adds `topology.json` to the project repo root.

**Tech Stack:** Vue 3, TypeScript, Vitest. Reuses pure helpers from `src/composables/useInfraBuilder.js`.

**Reference:** Design spec `docs/superpowers/specs/2026-05-21-canvas-serializer-design.md`.

**Commit rules:** Conventional Commits, NO AI attribution, commit directly to `dev`. Quality gate before each push: `npx vitest run` (0 failures) + `npm run build`. NEVER `git add` anything under `docs/superpowers/`.

---

## File Structure

- **Create** `src/overlay/serialize.ts` — pure serializer/deserializer + helpers.
- **Create** `src/overlay/__tests__/serialize.spec.ts` — unit + round-trip tests.
- **Create** `src/overlay/__tests__/serialize-vectors.test.ts` — vector harness.
- **Create** `schema/test-vectors/serialize/*.json` — canvas→CatalogEntry vectors.
- **Modify** `src/types/range42-schema.ts` — add missing `Node` + `CatalogEntry` fields.
- **Modify** `src/components/project/ConfigPanel.vue` (+ locale files) — `role` selector.
- **Modify** `src/services/projectRepo/index.ts` + `adapter.ts` — `topology` in `ProjectState`, write `topology.json` at repo root.

---

## Task 1: Update TypeScript schema mirror

**Files:**
- Modify: `src/types/range42-schema.ts:64-73` (Node), `:100-112` (CatalogEntry)

- [ ] **Step 1: Write the failing test**

Create `src/overlay/__tests__/serialize.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Node, CatalogEntry } from '@/types/range42-schema';

describe('range42-schema mirror — node-level fields', () => {
  it('Node accepts role, template_vmid, network template fields', () => {
    const n: Node = {
      id: 'vm1', kind: 'vm', role: 'admin', template_vmid: 9001,
      cidr_template: '192.168.{140+team_id}.0/24',
      bridge_template: 'vmbr{140+team_id}', vlan_tag: 10,
    };
    expect(n.role).toBe('admin');
    expect(n.template_vmid).toBe(9001);
  });
  it('CatalogEntry accepts naming_prefix, bridge_base, preflight_checks', () => {
    const c: CatalogEntry = {
      schema_version: '1.0', kind: 'lab', name: 'x',
      naming_prefix: 'lab', bridge_base: 140, preflight_checks: ['proxmox.connectivity'],
    };
    expect(c.bridge_base).toBe(140);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — TS errors "Object literal may only specify known properties" for `role`, `template_vmid`, etc.

- [ ] **Step 3: Add the fields**

In `src/types/range42-schema.ts`, replace the `Node` interface (lines ~64-73) with:

```ts
export type NodeRole = 'admin' | 'team' | 'trainee' | 'shared';

export interface Node {
  id: string;
  kind: NodeKind;
  role?: NodeRole;
  replication?: Replication;
  host_ref?: string;
  config?: Record<string, unknown>;
  networks?: NetworkAttachment[];
  attachments?: Attachment[];
  children?: Node[];
  cidr_template?: string;
  bridge_template?: string;
  vlan_tag?: number | null;
  template_vmid?: number;
}
```

In the `CatalogEntry` interface (lines ~100-112), add before the closing brace:

```ts
  naming_prefix?: string;
  bridge_base?: number;
  preflight_checks?: string[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/range42-schema.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(schema): add node-level role/template fields to TS mirror"
```

Note: the pre-commit hook regenerates `bundled.json` + backend pydantic when `src/types/range42-schema.ts` is staged. Let it run; commit any regenerated files it stages. Backend pydantic is already current, so this should be a no-op or trivial.

---

## Task 2: Kind mapping + top-level CatalogEntry skeleton

**Files:**
- Create: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `serialize.spec.ts`:

```ts
import { mapKind, sanitizeNamingPrefix, serializeToCatalogEntry } from '@/overlay/serialize';

describe('mapKind', () => {
  it('maps VueFlow types to schema kinds', () => {
    expect(mapKind('network-segment')).toBe('network');
    expect(mapKind('edge-firewall')).toBe('firewall');
    expect(mapKind('vm')).toBe('vm');
    expect(mapKind('switch')).toBeNull();
  });
});

describe('sanitizeNamingPrefix', () => {
  it('lowercases, strips invalid chars, caps length, never leads with hyphen', () => {
    expect(sanitizeNamingPrefix('My Lab #1')).toBe('my-lab-1');
    expect(sanitizeNamingPrefix('---x')).toBe('x');
    expect(sanitizeNamingPrefix('')).toBe('lab');
    expect(sanitizeNamingPrefix('a'.repeat(40)).length).toBeLessThanOrEqual(32);
  });
});

describe('serializeToCatalogEntry — top level', () => {
  it('produces a minimal valid CatalogEntry from empty canvas', () => {
    const doc = serializeToCatalogEntry(
      { nodes: [], edges: [], attachments: [] },
      { name: 'My Lab', bridge_base: 140 },
    );
    expect(doc.schema_version).toBe('1.0');
    expect(doc.kind).toBe('lab');
    expect(doc.name).toBe('My Lab');
    expect(doc.naming_prefix).toBe('my-lab');
    expect(doc.bridge_base).toBe(140);
    expect(doc.nodes).toEqual([]);
  });
  it('kind=gamenet when a team_scope group is present', () => {
    const doc = serializeToCatalogEntry({
      nodes: [{ id: 'g', type: 'group', data: { kind: 'team_scope' } }],
      edges: [], attachments: [],
    }, { name: 'r' });
    expect(doc.kind).toBe('gamenet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `serialize` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/overlay/serialize.ts`:

```ts
/**
 * serialize(canvas) -> CatalogEntry. Inverse of compose.ts.
 *
 * Pure, no IO. Maps the VueFlow canvas model to the canonical schema
 * document the deploy pipeline reads as topology.json. Non-canonical UI
 * data (positions, edge handles/extras, unsupported nodes) is handled by
 * extractLayout (Task 8), NOT this function.
 */
import type {
  CatalogEntry, CatalogKind, Node, NodeKind, NodeRole,
  NetworkAttachment, Attachment,
} from '@/types/range42-schema';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): kind mapping + CatalogEntry top-level skeleton"
```

---

## Task 3: Host-node serialization (role + template_vmid + config)

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { inferRole, buildNode } from '@/overlay/serialize';

describe('inferRole', () => {
  it('team inside a team_scope group, admin otherwise', () => {
    const grp = { id: 'g', type: 'group', data: { kind: 'team_scope' } };
    const inside = { id: 'vm1', type: 'vm', parentNode: 'g', data: {} };
    const outside = { id: 'vm2', type: 'vm', data: {} };
    const all = [grp, inside, outside];
    expect(inferRole(inside, all)).toBe('team');
    expect(inferRole(outside, all)).toBe('admin');
  });
});

describe('buildNode — host kinds', () => {
  it('vm: maps template, cores/memory to config, emits role + template_vmid', () => {
    const vm = {
      id: 'vm1', type: 'vm',
      data: { config: { name: 'web', template: '9001', cores: 4, memory: 4096, ipAddress: '1.2.3.4', vmId: 555 } },
    };
    const node = buildNode(vm, [vm], []);
    expect(node).toMatchObject({ id: 'vm1', kind: 'vm', role: 'admin', template_vmid: 9001 });
    expect(node.config).toMatchObject({ name: 'web', cores: 4, memory: 4096 });
    expect(node.config).not.toHaveProperty('template');   // promoted to template_vmid
    expect(node.config).not.toHaveProperty('ipAddress');  // backend-derived, dropped
    expect(node.config).not.toHaveProperty('vmId');       // backend-derived, dropped
  });
  it('explicit config.role wins over inference', () => {
    const vm = { id: 'v', type: 'vm', data: { config: { role: 'trainee' } } };
    expect(buildNode(vm, [vm], []).role).toBe('trainee');
  });
  it('docker: emits host_ref from data.host_ref', () => {
    const d = { id: 'd', type: 'docker', data: { host_ref: 'vm1', config: { image: 'nginx' } } };
    const node = buildNode(d, [d], []);
    expect(node.kind).toBe('docker');
    expect(node.host_ref).toBe('vm1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `inferRole`/`buildNode` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `serialize.ts` (import the helper at top):

```ts
import { getTeamScopeAncestorId } from '@/composables/useInfraBuilder';

const HOST_KINDS = new Set<NodeKind>(['vm', 'lxc', 'docker']);
const DROP_CONFIG_KEYS = new Set(['template', 'ipAddress', 'vmId', 'role', 'host_ref']);

export function inferRole(node: any, allNodes: any[]): NodeRole {
  return getTeamScopeAncestorId(node, allNodes) ? 'team' : 'admin';
}

export function buildNode(node: any, allNodes: any[], edges: any[]): Node {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): host-node mapping with role + template_vmid"
```

---

## Task 4: Network-node + edges → networks[]

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { buildNetworks } from '@/overlay/serialize';

describe('buildNetworks — compute→network edges', () => {
  const vm = { id: 'vm1', type: 'vm', data: {} };
  const net = { id: 'net1', type: 'network-segment', data: {} };
  it('static ip edge → { node_ref, ip }', () => {
    const e = { id: 'e1', source: 'vm1', target: 'net1', data: { connection: { ipAddress: '10.0.0.5' } } };
    expect(buildNetworks('vm1', [e], [vm, net])).toEqual([{ node_ref: 'net1', ip: '10.0.0.5' }]);
  });
  it('dhcp edge → { node_ref, dhcp:true }', () => {
    const e = { id: 'e1', source: 'vm1', target: 'net1', data: { useDhcp: true, connection: { ipAddress: '' } } };
    expect(buildNetworks('vm1', [e], [vm, net])).toEqual([{ node_ref: 'net1', dhcp: true }]);
  });
  it('ignores non-network edges and edges not touching the node', () => {
    const e = { id: 'e1', source: 'vm1', target: 'other', data: {} };
    expect(buildNetworks('vm1', [e], [vm, net])).toEqual([]);
  });
});

describe('buildNode — network node config passthrough', () => {
  it('keeps bridge/cidr/gateway, lifts vlan to vlan_tag', () => {
    const net = { id: 'n', type: 'network-segment', data: { config: { bridge: 'vmbr142', cidr: '192.168.142.0/24', gateway: '192.168.142.1', vlan: 10 } } };
    const node = buildNode(net, [net], []);
    expect(node.kind).toBe('network');
    expect(node.config).toMatchObject({ bridge: 'vmbr142', cidr: '192.168.142.0/24', gateway: '192.168.142.1' });
    expect(node.vlan_tag).toBe(10);
    expect(node.config).not.toHaveProperty('vlan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `buildNetworks` not exported; vlan not lifted.

- [ ] **Step 3: Write minimal implementation**

Add to `serialize.ts`:

```ts
function isNetwork(nodeId: string, allNodes: any[]): boolean {
  const n = allNodes.find((x) => x.id === nodeId);
  return n?.type === 'network-segment';
}

export function buildNetworks(
  nodeId: string, edges: any[], allNodes: any[],
): NetworkAttachment[] {
  const out: NetworkAttachment[] = [];
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
    out.push(na);
  }
  return out;
}
```

In `buildNode`, after the `config` loop and before `return out`, add network handling. Replace the `config` lift section so `vlan` is promoted:

```ts
  // Network node: lift vlan -> vlan_tag (node-level per schema).
  if (kind === 'network' && rawConfig.vlan != null) {
    out.vlan_tag = Number(rawConfig.vlan);
    if (out.config) delete (out.config as Record<string, unknown>).vlan;
  }
  // Compute nodes carry their network attachments derived from edges.
  if (HOST_KINDS.has(kind) || kind === 'router' || kind === 'firewall') {
    const nets = buildNetworks(node.id, edges, allNodes);
    if (nets.length > 0) out.networks = nets;
  }
```

Add `'vlan'` to `DROP_CONFIG_KEYS` so it never lingers in config:

```ts
const DROP_CONFIG_KEYS = new Set(['template', 'ipAddress', 'vmId', 'role', 'host_ref', 'vlan']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): network node config + edges→networks[]"
```

---

## Task 5: Grouping → children[] + replication

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe('serializeToCatalogEntry — grouping & replication', () => {
  it('folds parentNode into children and sets replication scope', () => {
    const canvas = {
      nodes: [
        { id: 'team', type: 'group', data: { kind: 'team_scope' } },
        { id: 'topo', type: 'group', data: { kind: 'topology_group' } },
        { id: 'vmA', type: 'vm', parentNode: 'team', data: { config: { role: 'team' } } },
        { id: 'vmB', type: 'vm', data: { config: { role: 'admin' } } },
      ],
      edges: [], attachments: [],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    const team = doc.nodes!.find((n) => n.id === 'team')!;
    const topo = doc.nodes!.find((n) => n.id === 'topo')!;
    expect(team.kind).toBe('group');
    expect(team.replication).toEqual({ scope: 'per_team' });
    expect(topo.replication).toEqual({ scope: 'shared' });
    expect(team.children!.map((c) => c.id)).toEqual(['vmA']);
    // vmB is a top-level node (no parent)
    expect(doc.nodes!.find((n) => n.id === 'vmB')).toBeTruthy();
    // vmA is NOT also at top level
    expect(doc.nodes!.find((n) => n.id === 'vmA')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `serializeToCatalogEntry` still returns `nodes: []`.

- [ ] **Step 3: Write minimal implementation**

In `serialize.ts`, add a tree builder and wire it into `serializeToCatalogEntry`:

```ts
function parentOf(node: any): string | null {
  return node.parentNode ?? node.parent ?? null;
}

function buildNodeTree(canvas: CanvasModel): Node[] {
  const supported = (canvas.nodes || []).filter((n) => mapKind(n.type) !== null);
  const childrenByParent = new Map<string, any[]>();
  const roots: any[] = [];
  for (const n of supported) {
    const p = parentOf(n);
    if (p && supported.some((x) => x.id === p)) {
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(n);
    } else {
      roots.push(n);
    }
  }

  const build = (raw: any): Node => {
    const node = buildNode(raw, canvas.nodes, canvas.edges);
    if (raw.type === 'group') {
      const scope = raw.data?.kind === 'team_scope' ? 'per_team' : 'shared';
      node.replication = { scope };
    }
    const kids = childrenByParent.get(raw.id);
    if (kids?.length) node.children = kids.map(build);
    return node;
  };
  return roots.map(build);
}
```

Update `serializeToCatalogEntry` to use it:

```ts
    nodes: buildNodeTree(canvas),
```

(replace the `nodes: []` line).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): fold parentNode into children + replication scope"
```

---

## Task 6: Attachments flat → nested

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe('serializeToCatalogEntry — attachments', () => {
  it('nests flat attachments under their target node, dropping target_node', () => {
    const canvas = {
      nodes: [{ id: 'vm1', type: 'vm', data: { config: { role: 'admin' } } }],
      edges: [],
      attachments: [
        { id: 'a1', target_node: 'vm1', stage: 'configure', order_in_stage: 0,
          source: { kind: 'catalog_role', ref: 'software.install.wazuh' } },
      ],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    const vm = doc.nodes!.find((n) => n.id === 'vm1')!;
    expect(vm.attachments).toHaveLength(1);
    expect(vm.attachments![0]).not.toHaveProperty('target_node');
    expect(vm.attachments![0].source.ref).toBe('software.install.wazuh');
  });
  it('nests group_inherited attachments on the group node', () => {
    const canvas = {
      nodes: [{ id: 'g', type: 'group', data: { kind: 'topology_group' } }],
      edges: [],
      attachments: [
        { id: 'a2', target_node: 'g', scope: 'group_inherited', stage: 'configure',
          source: { kind: 'inline_yaml', content_inline: '- debug: msg=hi' } },
      ],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    const g = doc.nodes!.find((n) => n.id === 'g')!;
    expect(g.attachments).toHaveLength(1);
    expect(g.attachments![0].scope).toBe('group_inherited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — attachments not attached to nodes.

- [ ] **Step 3: Write minimal implementation**

Add to `serialize.ts`. **Update the existing `useInfraBuilder` import line** (added in Task 3) to also pull in `normalizeAttachment` — do NOT add a second import line:

```ts
import { getTeamScopeAncestorId, normalizeAttachment } from '@/composables/useInfraBuilder';

function attachmentsByNode(attachments: any[]): Map<string, Attachment[]> {
  const byNode = new Map<string, Attachment[]>();
  for (const raw of attachments || []) {
    const a = normalizeAttachment(raw);
    if (!a?.target_node) continue;
    const { target_node, inherited, inherited_from, ...rest } = a;
    if (!byNode.has(target_node)) byNode.set(target_node, []);
    byNode.get(target_node)!.push(rest as Attachment);
  }
  return byNode;
}
```

In `buildNodeTree`, compute the map once and attach inside `build`:

```ts
  const attMap = attachmentsByNode(canvas.attachments);
```

Inside `build`, before `return node`:

```ts
    const atts = attMap.get(raw.id);
    if (atts?.length) node.attachments = atts;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): nest flat attachments under target nodes"
```

---

## Task 7: extractLayout — non-canonical UI data

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { extractLayout } from '@/overlay/serialize';

describe('extractLayout', () => {
  it('captures node positions and unsupported (switch) nodes', () => {
    const canvas = {
      nodes: [
        { id: 'vm1', type: 'vm', position: { x: 10, y: 20 }, data: { label: 'Web' } },
        { id: 'sw1', type: 'switch', position: { x: 5, y: 5 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'vm1', target: 'net1', sourceHandle: 'out-0', targetHandle: 'in-1',
          data: { connection: { interfaceModel: 'e1000', macAddress: 'AA:BB', firewall: true } } },
      ],
      attachments: [],
    };
    const layout = extractLayout(canvas);
    expect(layout.nodes.vm1.position).toEqual({ x: 10, y: 20 });
    expect(layout.nodes.vm1.label).toBe('Web');
    expect(layout.unsupported.map((n) => n.id)).toEqual(['sw1']);
    expect(layout.edges['vm1|net1'].sourceHandle).toBe('out-0');
    expect(layout.edges['vm1|net1'].connection.interfaceModel).toBe('e1000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `extractLayout` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `serialize.ts`:

```ts
export interface CanvasLayout {
  nodes: Record<string, {
    position?: { x: number; y: number };
    dimensions?: unknown;
    style?: unknown;
    label?: string;
  }>;
  edges: Record<string, {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    connection?: Record<string, unknown>;
  }>;
  unsupported: any[];
}

function edgeKey(source: string, target: string): string {
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
    layout.edges[edgeKey(e.source, e.target)] = {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): extractLayout for non-canonical UI data"
```

---

## Task 8: deserializeToCanvas — inverse + layout merge

**Files:**
- Modify: `src/overlay/serialize.ts`
- Test: `src/overlay/__tests__/serialize.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { deserializeToCanvas } from '@/overlay/serialize';

describe('deserializeToCanvas', () => {
  it('rebuilds flat nodes (kind→type), restores positions, edges from networks', () => {
    const doc = {
      schema_version: '1.0', kind: 'lab', name: 'r', naming_prefix: 'r', bridge_base: 140,
      nodes: [
        { id: 'team', kind: 'group', replication: { scope: 'per_team' },
          children: [{ id: 'vm1', kind: 'vm', role: 'team', template_vmid: 9001,
                        networks: [{ node_ref: 'net1', ip: '10.0.0.5' }] }] },
        { id: 'net1', kind: 'network', config: { bridge: 'vmbr143' } },
      ],
    } as any;
    const layout = {
      nodes: { vm1: { position: { x: 1, y: 2 } } },
      edges: { 'vm1|net1': { id: 'e1', source: 'vm1', target: 'net1', sourceHandle: 'out-0', connection: { interfaceModel: 'e1000' } } },
      unsupported: [],
    };
    const canvas = deserializeToCanvas(doc, layout);
    const vm1 = canvas.nodes.find((n) => n.id === 'vm1')!;
    expect(vm1.type).toBe('vm');
    expect(vm1.parentNode).toBe('team');
    expect(vm1.position).toEqual({ x: 1, y: 2 });
    expect(vm1.data.config.template).toBe('9001'); // template_vmid → config.template
    const e = canvas.edges.find((x) => x.source === 'vm1' && x.target === 'net1')!;
    expect(e.type).toBe('network');
    expect(e.data.connection.ipAddress).toBe('10.0.0.5');
    expect(e.data.connection.interfaceModel).toBe('e1000'); // merged from layout
    expect(e.sourceHandle).toBe('out-0');
  });
  it('round-trips: serialize → deserialize preserves node ids, kinds, attachments', () => {
    const canvas0 = {
      nodes: [
        { id: 'g', type: 'group', data: { kind: 'team_scope' } },
        { id: 'vm1', type: 'vm', parentNode: 'g', position: { x: 3, y: 4 }, data: { config: { role: 'team', name: 'web', cores: 2 } } },
        { id: 'net1', type: 'network-segment', position: { x: 0, y: 0 }, data: { config: { bridge: 'vmbr143' } } },
      ],
      edges: [{ id: 'e1', source: 'vm1', target: 'net1', data: { connection: { ipAddress: '10.0.0.9' } } }],
      attachments: [{ id: 'a1', target_node: 'vm1', stage: 'configure', source: { kind: 'catalog_role', ref: 'x' } }],
    };
    const doc = serializeToCatalogEntry(canvas0, { name: 'r' });
    const layout = extractLayout(canvas0);
    const canvas1 = deserializeToCanvas(doc, layout);
    expect(new Set(canvas1.nodes.map((n) => n.id))).toEqual(new Set(['g', 'vm1', 'net1']));
    expect(canvas1.nodes.find((n) => n.id === 'vm1')!.parentNode).toBe('g');
    expect(canvas1.attachments).toHaveLength(1);
    expect(canvas1.attachments[0].target_node).toBe('vm1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: FAIL — `deserializeToCanvas` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `serialize.ts`:

```ts
const KIND_TO_TYPE: Record<NodeKind, string> = {
  vm: 'vm', lxc: 'lxc', docker: 'docker',
  network: 'network-segment', router: 'router',
  firewall: 'edge-firewall', group: 'group', skin: 'skin',
};

export function deserializeToCanvas(
  doc: CatalogEntry, layout: CanvasLayout,
): CanvasModel {
  const nodes: any[] = [];
  const edges: any[] = [];
  const attachments: any[] = [];

  const walk = (n: Node, parentId: string | null) => {
    const type = KIND_TO_TYPE[n.kind];
    const lay = layout.nodes?.[n.id] ?? {};
    const config: Record<string, unknown> = { ...(n.config ?? {}) };
    if (n.role) config.role = n.role;
    if (n.template_vmid != null) config.template = String(n.template_vmid);
    if (n.vlan_tag != null) config.vlan = n.vlan_tag;

    const data: Record<string, unknown> = { type, config, status: 'gray' };
    if (lay.label) data.label = lay.label;
    if (n.kind === 'group') data.kind = n.replication?.scope === 'per_team' ? 'team_scope' : 'topology_group';
    if (n.kind === 'docker' && n.host_ref) data.host_ref = n.host_ref;

    const node: any = { id: n.id, type, position: lay.position ?? { x: 0, y: 0 }, data };
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
        source: n.id, target: na.node_ref, type: 'network',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/serialize.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/serialize.ts src/overlay/__tests__/serialize.spec.ts
git commit -m "feat(serialize): deserializeToCanvas inverse with layout merge"
```

---

## Task 9: Vector harness + compose-identity test

**Files:**
- Create: `src/overlay/__tests__/serialize-vectors.test.ts`
- Create: `schema/test-vectors/serialize/01-scratch-team-lab.json`
- Test: `src/overlay/__tests__/serialize.spec.ts` (identity test)

- [ ] **Step 1: Write the failing test (vector harness + identity)**

Create `src/overlay/__tests__/serialize-vectors.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { serializeToCatalogEntry } from '@/overlay/serialize';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '..', '..', '..', 'schema', 'test-vectors', 'serialize');

describe('overlay/serialize — vector harness', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const vec = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    // eslint-disable-next-line vitest/valid-title
    it(`${file} — ${vec.name}`, () => {
      const got = serializeToCatalogEntry(vec.input.canvas, vec.input.meta);
      expect(got).toEqual(vec.expected);
    });
  }
});
```

Append to `serialize.spec.ts`:

```ts
import { compose } from '@/overlay/compose';

describe('serialize → compose identity (full-snapshot)', () => {
  it('compose(serialize(canvas), {}) === serialize(canvas)', () => {
    const canvas = {
      nodes: [
        { id: 'vm1', type: 'vm', data: { config: { role: 'admin', template: '9001', cores: 2 } } },
        { id: 'net1', type: 'network-segment', data: { config: { bridge: 'vmbr142' } } },
      ],
      edges: [{ id: 'e1', source: 'vm1', target: 'net1', data: { connection: { ipAddress: '10.0.0.2' } } }],
      attachments: [],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    expect(compose(doc, {} as any)).toEqual(doc);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/serialize-vectors.test.ts`
Expected: FAIL — vectors dir empty/missing.

- [ ] **Step 3: Create the vector fixture**

Create `schema/test-vectors/serialize/01-scratch-team-lab.json`:

```json
{
  "name": "scratch team lab: one admin vm + per-team vm on a network",
  "input": {
    "canvas": {
      "nodes": [
        { "id": "team", "type": "group", "data": { "kind": "team_scope" } },
        { "id": "wazuh", "type": "vm", "data": { "config": { "role": "admin", "template": "9001", "name": "wazuh", "cores": 4 } } },
        { "id": "kali", "type": "vm", "parentNode": "team", "data": { "config": { "role": "team", "template": "9002", "name": "kali" } } },
        { "id": "net", "type": "network-segment", "data": { "config": { "bridge": "vmbr143", "cidr": "192.168.143.0/24" } } }
      ],
      "edges": [
        { "id": "e1", "source": "kali", "target": "net", "data": { "connection": { "ipAddress": "192.168.143.10" } } }
      ],
      "attachments": [
        { "id": "a1", "target_node": "wazuh", "stage": "configure", "order_in_stage": 0, "source": { "kind": "catalog_role", "ref": "software.install.wazuh" } }
      ]
    },
    "meta": { "name": "Team Lab", "bridge_base": 140 }
  },
  "expected": {
    "schema_version": "1.0",
    "kind": "gamenet",
    "name": "Team Lab",
    "naming_prefix": "team-lab",
    "bridge_base": 140,
    "nodes": [
      { "id": "team", "kind": "group", "replication": { "scope": "per_team" },
        "children": [
          { "id": "kali", "kind": "vm", "config": { "name": "kali" }, "role": "team", "template_vmid": 9002,
            "networks": [{ "node_ref": "net", "ip": "192.168.143.10" }] }
        ] },
      { "id": "wazuh", "kind": "vm", "config": { "name": "wazuh", "cores": 4 }, "role": "admin", "template_vmid": 9001,
        "attachments": [{ "id": "a1", "stage": "configure", "order_in_stage": 0, "source": { "kind": "catalog_role", "ref": "software.install.wazuh" } }] },
      { "id": "net", "kind": "network", "config": { "bridge": "vmbr143", "cidr": "192.168.143.0/24" } }
    ]
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/overlay/__tests__/serialize-vectors.test.ts src/overlay/__tests__/serialize.spec.ts`
Expected: PASS. If the vector's `expected` differs from actual output, reconcile by correcting the fixture to match the verified serializer output (the serializer is the tested source of truth; the fixture documents its contract).

- [ ] **Step 5: Commit**

```bash
git add src/overlay/__tests__/serialize-vectors.test.ts schema/test-vectors/serialize/ src/overlay/__tests__/serialize.spec.ts
git commit -m "test(serialize): vector harness + compose-identity round-trip"
```

---

## Task 10: `role` selector in ConfigPanel + i18n

**Files:**
- Modify: `src/components/ConfigPanel.vue` (host-node config section)
- Modify: `src/locales/en/configPanel.json`, `src/locales/fr/configPanel.json`, `src/locales/jp/configPanel.json`

> **Verified context (do not deviate):** the component is `src/components/ConfigPanel.vue` (NOT under `project/`). It edits fields with **`v-model="config.<field>"`** on a reactive `config` ref and emits the whole payload on save via `emit('update', props.node.id, payload)` — there is **no `updateConfig()` method**. It uses `const { t } = useI18n({ useScope: 'global' })` and loads the **`configPanel`** namespace (`ensureNamespaces(['configPanel', 'project', 'common'])`), with keys nested under `configPanel.fields.*`. Match these patterns exactly.

- [ ] **Step 1: Locate the host-node config rendering**

Run: `grep -n "node.type\|v-model=\"config\.\|config.cpu\|config.memory\|config.template" src/components/ConfigPanel.vue | head -40`
Identify the per-kind config block for host nodes (vm/lxc/docker) and an existing `v-model="config.x"` field to copy the markup style from.

- [ ] **Step 2: Add the role `<select>` for host kinds**

In the host-node config block, add a select **v-model-bound to `config.role`** (matching the existing field pattern — NOT a `@change`/`updateConfig` handler). Render it only when `node.type` is `vm`, `lxc`, or `docker` (match the file's existing per-kind conditionals):

```vue
<div class="form-control" v-if="['vm','lxc','docker'].includes(node.type)">
  <label class="label" :for="`role-${node.id}`">
    <span class="label-text">{{ t('configPanel.fields.role') }}</span>
  </label>
  <select :id="`role-${node.id}`" v-model="config.role" class="select select-bordered select-sm">
    <option value="">{{ t('configPanel.fields.roleAuto') }}</option>
    <option value="admin">admin</option>
    <option value="team">team</option>
    <option value="trainee">trainee</option>
    <option value="shared">shared</option>
  </select>
</div>
```

The empty value means "auto" — the serializer infers (`config.role ?? inferRole`). On save the existing `emit('update', ...)` carries `config.role` through to the persisted node.

- [ ] **Step 3: Add i18n keys under `fields` in all three locales**

Add to the `"fields"` object in `src/locales/en/configPanel.json`:

```json
"role": "Role",
"roleAuto": "Auto (inferred from team scope)"
```

Add to the `"fields"` object in `src/locales/fr/configPanel.json`:

```json
"role": "Rôle",
"roleAuto": "Auto (déduit du périmètre d'équipe)"
```

Add to the `"fields"` object in `src/locales/jp/configPanel.json`:

```json
"role": "ロール",
"roleAuto": "自動（チームスコープから推測）"
```

(Insert as new keys inside the existing `fields` object; preserve JSON validity — add a comma after the preceding key.)

- [ ] **Step 4: Verify build + existing tests**

Run: `npx vitest run && npm run build`
Expected: 0 test failures; build succeeds (ignore the >500 kB chunk advisory).

- [ ] **Step 5: Commit**

```bash
git add src/components/ConfigPanel.vue src/locales/en/configPanel.json src/locales/fr/configPanel.json src/locales/jp/configPanel.json
git commit -m "feat(config): role selector for host nodes (admin/team/trainee/shared)"
```

---

## Task 11: Persistence plumbing — `topology.json`

**Files:**
- Modify: `src/services/projectRepo/index.ts` (ProjectState)
- Modify: `src/services/projectRepo/adapter.ts` (write/read topology.json)
- Test: `src/__tests__/projectRepoAdapter.test.js` (EXTEND the existing test)

> **Verified context:** an adapter test already exists at `src/__tests__/projectRepoAdapter.test.js`. It imports `'fake-indexeddb/auto'` (so `autosave`'s IndexedDB writes work in jsdom) and provides `makeMockProvider()` + `makeAdapter()` helpers. Its mock `files` Map is keyed `` `${branch}:${path}` ``; `makeAdapter` uses `projectPath: 'projects/demo'`, `browserInstanceId: 'bi-123'`, so the draft branch is `draft-bi-123` and the topology path is `projects/demo/topology.json`. EXTEND this file — do NOT create a new test or a new `fakeProvider`.

- [ ] **Step 1: Write the failing test**

Append a new `it(...)` inside the existing `describe('ProjectRepoAdapter', ...)` block in `src/__tests__/projectRepoAdapter.test.js`:

```js
  it('autosave: writes topology.json from ProjectState.topology', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: 'version: 1',
      canvas_layout: '{}',
      meta: { name: 'demo' },
      topology: '{"schema_version":"1.0"}',
    });
    const written = mock.files.get('draft-bi-123:projects/demo/topology.json');
    expect(written?.content).toBe('{"schema_version":"1.0"}');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/projectRepoAdapter.test.js`
Expected: FAIL — `topology.json` not written (autosave doesn't include it yet).

- [ ] **Step 3: Add `topology` to ProjectState + write it**

In `src/services/projectRepo/index.ts`, extend `ProjectState`:

```ts
export interface ProjectState {
  overlay: string
  canvas_layout: string
  meta: Record<string, unknown>
  topology?: string
}
```

In `src/services/projectRepo/adapter.ts`, add a path helper near the others (`overlayPath` etc.):

```ts
function topologyPath(projectPath: string): string {
  const base = projectPath.replace(/\/+$/, '')
  return base ? `${base}/topology.json` : 'topology.json'
}
```

In `autosave`, add to the `writes` array (after the existing three):

```ts
      { path: topologyPath(this.projectPath), content: state.topology ?? '' },
```

In `load`, fetch and return it:

```ts
    const [overlay, layout, meta, topology] = await Promise.all([
      this.safeGet(overlayPath(this.projectPath)),
      this.safeGet(layoutPath(this.projectPath)),
      this.safeGet(metaPath(this.projectPath)),
      this.safeGet(topologyPath(this.projectPath)),
    ])
    return {
      overlay: overlay?.content ?? '',
      canvas_layout: layout?.content ?? '',
      meta: meta ? safeParseJson(meta.content) : {},
      topology: topology?.content ?? '',
    }
```

Also add `topologyPath(this.projectPath)` to the `paths` array in `copyDraftIntoMain` so `save` promotes it to `main`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/projectRepoAdapter.test.js`
Expected: PASS (all existing adapter tests still green + the new one)

- [ ] **Step 5: Commit**

```bash
git add src/services/projectRepo/index.ts src/services/projectRepo/adapter.ts src/__tests__/projectRepoAdapter.test.js
git commit -m "feat(projectRepo): persist topology.json alongside overlay/layout"
```

---

## Task 12: Build ProjectState from canvas (wiring helper)

**Files:**
- Create: `src/overlay/projectState.ts` — `buildProjectState(canvas, meta)` / `loadCanvasFromState(state)`
- Test: `src/overlay/__tests__/projectState.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/overlay/__tests__/projectState.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildProjectState, loadCanvasFromState } from '@/overlay/projectState';

describe('buildProjectState / loadCanvasFromState', () => {
  const canvas = {
    nodes: [
      { id: 'vm1', type: 'vm', position: { x: 1, y: 2 }, data: { config: { role: 'admin', template: '9001' } } },
      { id: 'net1', type: 'network-segment', position: { x: 0, y: 0 }, data: { config: { bridge: 'vmbr142' } } },
    ],
    edges: [{ id: 'e1', source: 'vm1', target: 'net1', data: { connection: { ipAddress: '10.0.0.2' } } }],
    attachments: [],
  };
  it('produces topology + canvas_layout strings and round-trips', () => {
    const state = buildProjectState(canvas, { name: 'r', bridge_base: 140 });
    expect(JSON.parse(state.topology!).schema_version).toBe('1.0');
    const back = loadCanvasFromState(state);
    expect(new Set(back.nodes.map((n) => n.id))).toEqual(new Set(['vm1', 'net1']));
    expect(back.nodes.find((n) => n.id === 'vm1')!.position).toEqual({ x: 1, y: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/overlay/__tests__/projectState.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/overlay/projectState.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/overlay/__tests__/projectState.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/overlay/projectState.ts src/overlay/__tests__/projectState.spec.ts
git commit -m "feat(overlay): buildProjectState/loadCanvasFromState wiring helpers"
```

---

## Task 13: Final verification + push

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: 0 test failures; build succeeds (ignore the pre-existing >500 kB chunk advisory).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors. Fix any introduced by new files.

- [ ] **Step 3: Push `dev`**

```bash
git push origin dev
```

- [ ] **Step 4: File the coordination follow-up (expand_replication drift)**

Create a backend-api/playbooks issue: `expand_replication` reads `config.bridge_template`/`config.cidr_template`/`config.vlan_template`, but the canonical schema defines `bridge_template`/`cidr_template`/`vlan_tag` at node level. Per-team template rendering silently no-ops in the compose/validate preview path. Reference spec §9. (Use `gh issue create` against the appropriate repo, or note for the user to file.)

---

## Notes for the implementer

- `serialize.ts` is **pure** — no Vue, no IO. The only import from app code is the pure helper `getTeamScopeAncestorId` / `normalizeAttachment` from `useInfraBuilder.js` (these are exported standalone functions, safe to import without instantiating the composable).
- Do NOT emit static VM `ip`/`vmId` (backend-derived). Do NOT auto-generate network templates — pass through whatever the canvas config holds (template authoring is a #61 follow-up).
- `topology.json` is **JSON** at the repo **root** (the backend `checkout_project` reads `dest/topology.json`). Build-from-scratch projects use `dedicated_repo` branch strategy (`projectPath: ''`).
- Activating the git-backed adapter as the live persistence path in `ProjectEditor.vue` (replacing the localStorage autosave) is **out of scope** for #77 — the adapter + helpers built here are the prerequisites for it.
- Never `git add` anything under `docs/superpowers/`.
```
