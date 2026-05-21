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
