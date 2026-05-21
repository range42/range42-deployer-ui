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
  it('explicit meta.kind overrides the team_scope heuristic', () => {
    const doc = serializeToCatalogEntry({
      nodes: [{ id: 'g', type: 'group', data: { kind: 'team_scope' } }],
      edges: [], attachments: [],
    }, { name: 'r', kind: 'component' });
    expect(doc.kind).toBe('component');
  });
  it('bridge_base defaults to 140 when omitted', () => {
    const doc = serializeToCatalogEntry({ nodes: [], edges: [], attachments: [] }, { name: 'r' });
    expect(doc.bridge_base).toBe(140);
  });
});

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
    expect(node.config).not.toHaveProperty('template');
    expect(node.config).not.toHaveProperty('ipAddress');
    expect(node.config).not.toHaveProperty('vmId');
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
  it('omits template_vmid when below the Proxmox minimum (100)', () => {
    const vm = { id: 'v', type: 'vm', data: { config: { template: '50' } } };
    expect(buildNode(vm, [vm], [])).not.toHaveProperty('template_vmid');
  });
  it('omits template_vmid for a non-numeric template', () => {
    const vm = { id: 'v', type: 'vm', data: { config: { template: '9001-beta' } } };
    expect(buildNode(vm, [vm], [])).not.toHaveProperty('template_vmid');
  });
  it('throws on an unsupported node type', () => {
    expect(() => buildNode({ id: 's', type: 'switch', data: {} }, [], [])).toThrow(/unsupported node type/);
  });
});

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
  it('buildNetworks: returns [] when the node itself is a network (no network→network)', () => {
    const a = { id: 'na', type: 'network-segment', data: {} };
    const b = { id: 'nb', type: 'network-segment', data: {} };
    const e = { id: 'e', source: 'na', target: 'nb', data: {} };
    expect(buildNetworks('na', [e], [a, b])).toEqual([]);
  });
  it('buildNetworks: dedups multiple edges to the same network (keeps last)', () => {
    const vm = { id: 'vm1', type: 'vm', data: {} };
    const net = { id: 'net1', type: 'network-segment', data: {} };
    const e1 = { id: 'e1', source: 'vm1', target: 'net1', data: { connection: { ipAddress: '10.0.0.5' } } };
    const e2 = { id: 'e2', source: 'vm1', target: 'net1', data: { useDhcp: true, connection: { ipAddress: '' } } };
    expect(buildNetworks('vm1', [e1, e2], [vm, net])).toEqual([{ node_ref: 'net1', dhcp: true }]);
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
  it('buildNode: omits vlan_tag for a non-numeric vlan', () => {
    const net = { id: 'n', type: 'network-segment', data: { config: { vlan: 'trunk' } } };
    expect(buildNode(net, [net], [])).not.toHaveProperty('vlan_tag');
  });
});

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
  it('silently drops attachments targeting a non-existent node', () => {
    const canvas = {
      nodes: [{ id: 'vm1', type: 'vm', data: { config: { role: 'admin' } } }],
      edges: [],
      attachments: [
        { id: 'ghost', target_node: 'does-not-exist', stage: 'configure',
          source: { kind: 'catalog_role', ref: 'x' } },
      ],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    const vm = doc.nodes!.find((n) => n.id === 'vm1')!;
    expect(vm.attachments).toBeUndefined();
    // The orphaned attachment appears on no node in the doc.
    expect(doc.nodes!.every((n) => !n.attachments)).toBe(true);
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

describe('serializeToCatalogEntry — grouping & replication', () => {
  it('recurses through nested groups (team_scope > topology_group > vm)', () => {
    const canvas = {
      nodes: [
        { id: 'team', type: 'group', data: { kind: 'team_scope' } },
        { id: 'inner', type: 'group', parentNode: 'team', data: { kind: 'topology_group' } },
        { id: 'vm', type: 'vm', parentNode: 'inner', data: { config: { role: 'team' } } },
      ],
      edges: [], attachments: [],
    };
    const doc = serializeToCatalogEntry(canvas, { name: 'r' });
    const team = doc.nodes!.find((n) => n.id === 'team')!;
    expect(team.children!.map((c) => c.id)).toEqual(['inner']);
    const inner = team.children!.find((c) => c.id === 'inner')!;
    expect(inner.replication).toEqual({ scope: 'shared' });
    expect(inner.children!.map((c) => c.id)).toEqual(['vm']);
  });
  it('throws on a cyclic parentNode reference', () => {
    const canvas = {
      nodes: [
        { id: 'a', type: 'group', parentNode: 'b', data: { kind: 'topology_group' } },
        { id: 'b', type: 'group', parentNode: 'a', data: { kind: 'topology_group' } },
      ],
      edges: [], attachments: [],
    };
    expect(() => serializeToCatalogEntry(canvas, { name: 'r' })).toThrow(/cycle detected/);
  });
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
    expect(doc.nodes!.find((n) => n.id === 'vmB')).toBeTruthy();
    expect(doc.nodes!.find((n) => n.id === 'vmA')).toBeUndefined();
  });
});

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
    expect(vm1.data.config.template).toBe('9001');
    const e = canvas.edges.find((x) => x.source === 'vm1' && x.target === 'net1')!;
    expect(e.type).toBe('network');
    expect(e.data.connection.ipAddress).toBe('10.0.0.5');
    expect(e.data.connection.interfaceModel).toBe('e1000');
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
    const rtVm = canvas1.nodes.find((n) => n.id === 'vm1')!;
    expect(rtVm.data.config).toMatchObject({ role: 'team', name: 'web', cores: 2 });
    const rtEdge = canvas1.edges.find((e) => e.source === 'vm1' && e.target === 'net1')!;
    expect(rtEdge).toBeTruthy();
    expect(rtEdge.data.connection.ipAddress).toBe('10.0.0.9');
  });
});

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
  it('keys compute↔network edges as compute|network regardless of draw direction', () => {
    const canvas = {
      nodes: [
        { id: 'vm1', type: 'vm', position: { x: 0, y: 0 }, data: {} },
        { id: 'net1', type: 'network-segment', position: { x: 0, y: 0 }, data: {} },
      ],
      // drawn network -> compute (source is the network)
      edges: [{ id: 'e9', source: 'net1', target: 'vm1', sourceHandle: 'h', data: { connection: { interfaceModel: 'virtio' } } }],
      attachments: [],
    };
    const layout = extractLayout(canvas);
    expect(layout.edges['vm1|net1']).toBeTruthy();
    expect(layout.edges['vm1|net1'].connection.interfaceModel).toBe('virtio');
    expect(layout.edges['net1|vm1']).toBeUndefined();
  });
});
