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
