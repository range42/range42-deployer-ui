import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useNetworkZones, type NetworkZoneNode } from '../composables/useNetworkZones';

const PADDING = 40;

function makeNode(over: NetworkZoneNode): NetworkZoneNode {
  return {
    dimensions: { width: 200, height: 80 },
    ...over,
  };
}

describe('useNetworkZones — Issue #68 network-zone overlay geometry', () => {
  it('uses absolute computedPosition (not parent-relative position) for grouped nodes', () => {
    // A network segment and a VM both live inside a topology_group whose
    // top-left is at (1000, 500). VueFlow stores `position` as parent-RELATIVE
    // but `computedPosition` as absolute canvas coords.
    const nodes = ref([
      makeNode({
        id: 'net1',
        type: 'network-segment',
        parentNode: 'grp1',
        position: { x: 50, y: 50 },
        computedPosition: { x: 1050, y: 550 },
        data: { config: { segmentType: 'lan', cidr: '10.0.0.0/24' } },
      }),
      makeNode({
        id: 'vm1',
        type: 'vm',
        parentNode: 'grp1',
        position: { x: 50, y: 200 },
        computedPosition: { x: 1050, y: 700 },
      }),
    ]);
    const edges = ref([{ source: 'net1', target: 'vm1' }]);

    const { zones } = useNetworkZones(nodes, edges);
    expect(zones.value).toHaveLength(1);
    const z = zones.value[0];

    // Geometry must be derived from absolute coords, NOT relative position.
    // minX = 1050, minY = 550, maxX = 1050+200, maxY = 700+80.
    expect(z.x).toBe(1050 - PADDING);
    expect(z.y).toBe(550 - PADDING);
    expect(z.width).toBe(200 + PADDING * 2);
    expect(z.height).toBe((700 + 80) - 550 + PADDING * 2);

    // Sanity: had it used relative `position` (minX=50, minY=50) the box would
    // sit at the canvas origin, far from the group.
    expect(z.x).not.toBe(50 - PADDING);
    expect(z.y).not.toBe(50 - PADDING);
  });

  it('falls back to position when computedPosition is absent (ungrouped nodes)', () => {
    const nodes = ref([
      makeNode({
        id: 'net1',
        type: 'network-segment',
        position: { x: 0, y: 0 },
        data: { config: { segmentType: 'dmz' } },
      }),
      makeNode({ id: 'vm1', type: 'vm', position: { x: 300, y: 0 } }),
    ]);
    const edges = ref([{ source: 'net1', target: 'vm1' }]);

    const { zones } = useNetworkZones(nodes, edges);
    expect(zones.value).toHaveLength(1);
    expect(zones.value[0].x).toBe(0 - PADDING);
  });

  it('skips unmeasured nodes rather than clipping with a hardcoded fallback size', () => {
    const nodes = ref([
      // Measured network node.
      makeNode({
        id: 'net1',
        type: 'network-segment',
        computedPosition: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        data: { config: { segmentType: 'lan' } },
      }),
      // Connected VM with no dimensions yet — must not contribute geometry.
      {
        id: 'vm1',
        type: 'vm',
        computedPosition: { x: 5000, y: 5000 },
        position: { x: 5000, y: 5000 },
        dimensions: undefined,
      },
    ]);
    const edges = ref([{ source: 'net1', target: 'vm1' }]);

    const { zones } = useNetworkZones(nodes, edges);
    expect(zones.value).toHaveLength(1);
    // Box bounded only by the measured network node (200x80), NOT stretched to
    // the unmeasured VM at (5000, 5000).
    expect(zones.value[0].width).toBe(200 + PADDING * 2);
    expect(zones.value[0].height).toBe(80 + PADDING * 2);
  });

  it('emits no zone when no connected node has been measured yet', () => {
    const nodes = ref([
      { id: 'net1', type: 'network-segment', computedPosition: { x: 0, y: 0 }, position: { x: 0, y: 0 }, dimensions: undefined, data: { config: { segmentType: 'lan' } } },
      { id: 'vm1', type: 'vm', computedPosition: { x: 100, y: 0 }, position: { x: 100, y: 0 }, dimensions: undefined },
    ]);
    const edges = ref([{ source: 'net1', target: 'vm1' }]);

    const { zones } = useNetworkZones(nodes, edges);
    expect(zones.value).toHaveLength(0);
  });

  it('recomputes when the measureTick trigger is bumped', () => {
    const tick = ref(0);
    const vm: NetworkZoneNode = { id: 'vm1', type: 'vm', computedPosition: { x: 300, y: 0 }, position: { x: 300, y: 0 }, dimensions: undefined };
    const nodes = ref([
      makeNode({ id: 'net1', type: 'network-segment', computedPosition: { x: 0, y: 0 }, position: { x: 0, y: 0 }, data: { config: { segmentType: 'lan' } } }),
      vm,
    ]);
    const edges = ref([{ source: 'net1', target: 'vm1' }]);

    const { zones } = useNetworkZones(nodes, edges, tick);
    // Before measurement: only the network node contributes.
    expect(zones.value[0].width).toBe(200 + PADDING * 2);

    // Simulate VueFlow measuring the VM, then firing nodes-initialized.
    vm.dimensions = { width: 200, height: 80 };
    tick.value++;
    // Now the VM at x=300 widens the box: maxX = 300+200 = 500, minX = 0.
    expect(zones.value[0].width).toBe(500 + PADDING * 2);
  });

  it('sorts zones largest-first for paint order', () => {
    const nodes = ref([
      // Big zone: net + a far VM.
      makeNode({ id: 'big', type: 'network-segment', computedPosition: { x: 0, y: 0 }, position: { x: 0, y: 0 }, data: { config: { segmentType: 'lan' } } }),
      makeNode({ id: 'bigvm', type: 'vm', computedPosition: { x: 2000, y: 2000 }, position: { x: 2000, y: 2000 } }),
      // Small zone: net + a near VM.
      makeNode({ id: 'small', type: 'network-segment', computedPosition: { x: 10, y: 10 }, position: { x: 10, y: 10 }, data: { config: { segmentType: 'dmz' } } }),
      makeNode({ id: 'smallvm', type: 'vm', computedPosition: { x: 60, y: 10 }, position: { x: 60, y: 10 } }),
    ]);
    const edges = ref([
      { source: 'big', target: 'bigvm' },
      { source: 'small', target: 'smallvm' },
    ]);

    const { zones } = useNetworkZones(nodes, edges);
    expect(zones.value).toHaveLength(2);
    const a0 = zones.value[0].width * zones.value[0].height;
    const a1 = zones.value[1].width * zones.value[1].height;
    expect(a0).toBeGreaterThanOrEqual(a1);
    expect(zones.value[0].id).toBe('big');
  });
});
