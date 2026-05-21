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
});
