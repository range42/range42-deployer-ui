import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import {
  collectProblems,
  useProblems,
  fuzzyScore,
  fuzzyFilter,
  type Problem,
  type PaletteItem,
} from '../composables/useProblems';

describe('collectProblems — Plan C §6/§7 cross-node validation', () => {
  it('flags Docker nodes with missing host_ref as errors', () => {
    const nodes = [
      { id: 'd1', type: 'docker', data: {} },
      { id: 'd2', type: 'docker', data: { host_ref: 'vm-ok' } },
      { id: 'vm-ok', type: 'vm' },
    ];
    const out = collectProblems(nodes, []);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('docker.host_ref.missing');
    expect(out[0].severity).toBe('error');
    expect(out[0].jumpTo).toEqual({ kind: 'node', id: 'd1' });
  });

  it('warns about team_scope groups with no team_count', () => {
    const nodes = [
      { id: 'scope-1', type: 'group', data: { kind: 'team_scope' } },
      { id: 'scope-2', type: 'group', data: { kind: 'team_scope', team_count: 3 } },
      { id: 'plain', type: 'group', data: { kind: 'topology_group' } },
    ];
    const out = collectProblems(nodes, []);
    expect(out.map((p) => p.code)).toContain('team_scope.team_count.missing');
    const only = out.filter((p) => p.code === 'team_scope.team_count.missing');
    expect(only).toHaveLength(1);
    expect(only[0].node_id).toBe('scope-1');
    expect(only[0].severity).toBe('warning');
  });

  it("flags edges tagged 'mesh' whose endpoints are not in the same team_scope", () => {
    const nodes = [
      { id: 'sa', type: 'group', data: { kind: 'team_scope', team_count: 2 } },
      { id: 'sb', type: 'group', data: { kind: 'team_scope', team_count: 2 } },
      { id: 'a1', type: 'vm', parentNode: 'sa' },
      { id: 'b1', type: 'vm', parentNode: 'sb' },
    ];
    const edges = [{ id: 'e-cross', source: 'a1', target: 'b1', data: { replication_intent: 'mesh' } }];
    const out = collectProblems(nodes, edges);
    expect(out.map((p) => p.code)).toContain('edge.replication_intent.mesh_across_scopes');
  });

  it("warns when a pair_scoped edge has a team_scope endpoint (likely meant fan_out)", () => {
    const nodes = [
      { id: 'sa', type: 'group', data: { kind: 'team_scope', team_count: 2 } },
      { id: 'a1', type: 'vm', parentNode: 'sa' },
      { id: 'shared', type: 'vm' },
    ];
    const edges = [{ id: 'e1', source: 'a1', target: 'shared', data: { replication_intent: 'pair_scoped' } }];
    const out = collectProblems(nodes, edges);
    const entry = out.find((p) => p.code === 'edge.replication_intent.pair_in_scope');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('warning');
  });

  it('skips synthetic (derived) edges like docker tethers', () => {
    const nodes = [
      { id: 'sa', type: 'group', data: { kind: 'team_scope', team_count: 2 } },
      { id: 'a1', type: 'vm', parentNode: 'sa' },
      { id: 'docker-1', type: 'docker', data: { host_ref: 'a1' } },
    ];
    const edges = [
      { id: 'docker-tether-docker-1-a1', source: 'docker-1', target: 'a1', type: 'docker-tether', data: { synthetic: true, replication_intent: 'mesh' } },
    ];
    const out = collectProblems(nodes, edges);
    // No mesh_across_scopes problem from the synthetic tether
    expect(out.find((p) => p.code === 'edge.replication_intent.mesh_across_scopes')).toBeUndefined();
  });

  it('surfaces attachment drift as warnings with file_path / line context', () => {
    const attachments = [
      { id: 'a1', drifted: true, file_path: 'roles/web/tasks/main.yml', line: 42 },
      { id: 'a2', drifted: false },
    ];
    const out = collectProblems([], [], attachments);
    const entry = out.find((p) => p.code === 'attachment.drift');
    expect(entry).toBeDefined();
    expect(entry?.file_path).toBe('roles/web/tasks/main.yml');
    expect(entry?.line).toBe(42);
    expect(entry?.severity).toBe('warning');
  });
});

describe('useProblems — reactive wrapper', () => {
  it('updates problems computed when the underlying nodes ref changes', () => {
    const nodes = ref<Array<Record<string, unknown>>>([
      { id: 'd1', type: 'docker', data: {} },
    ]);
    const edges = ref<Array<Record<string, unknown>>>([]);
    const { problems, errorCount } = useProblems(nodes, edges);
    expect(problems.value).toHaveLength(1);
    expect(errorCount.value).toBe(1);

    nodes.value = [{ id: 'd1', type: 'docker', data: { host_ref: 'vm-1' } }, { id: 'vm-1', type: 'vm' }];
    expect(problems.value).toHaveLength(0);
    expect(errorCount.value).toBe(0);
  });

  it('addProblem / clearExtra merges extra entries into problems', () => {
    const nodes = ref<Array<Record<string, unknown>>>([]);
    const edges = ref<Array<Record<string, unknown>>>([]);
    const { problems, addProblem, clearExtra } = useProblems(nodes, edges);
    expect(problems.value).toHaveLength(0);
    const extra: Problem = { id: 'x1', severity: 'info', code: 'manual', message: 'hello' };
    addProblem(extra);
    expect(problems.value).toHaveLength(1);
    expect(problems.value[0].id).toBe('x1');
    clearExtra();
    expect(problems.value).toHaveLength(0);
  });
});

describe('fuzzyScore / fuzzyFilter — command palette matcher', () => {
  it('prefers substring matches at the start of a token over mid-token matches', () => {
    const a = fuzzyScore('vm', 'vm-frontend');
    const b = fuzzyScore('vm', 'shared-vm-helper');
    expect(a).toBeGreaterThan(b);
    expect(a).toBeGreaterThan(0);
  });

  it('returns a non-zero score for scattered-in-order characters', () => {
    const s = fuzzyScore('vmf', 'my-vm-frontend');
    expect(s).toBeGreaterThan(0);
  });

  it('returns 0 when characters are out of order', () => {
    expect(fuzzyScore('xyz', 'abcdef')).toBe(0);
  });

  it('empty query matches everything (score > 0)', () => {
    expect(fuzzyScore('', 'anything')).toBeGreaterThan(0);
  });

  it('fuzzyFilter ranks results by score and respects the limit', () => {
    const items: PaletteItem[] = [
      { id: 'a', kind: 'node', label: 'hidden-service' },
      { id: 'b', kind: 'node', label: 'vm-frontend' },
      { id: 'c', kind: 'node', label: 'shared-vm-helper' },
      { id: 'd', kind: 'node', label: 'unrelated' },
    ];
    const out = fuzzyFilter(items, 'vm', 3);
    expect(out.length).toBeLessThanOrEqual(3);
    // 'vm-frontend' must rank first
    expect(out[0].id).toBe('b');
    // 'unrelated' must not appear
    expect(out.find((i) => i.id === 'd')).toBeUndefined();
  });
});
