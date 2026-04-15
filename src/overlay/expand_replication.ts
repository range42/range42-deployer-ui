import type { CatalogEntry, Node } from '@/types/range42-schema';
import { NotImplemented } from './errors';

export interface ExpandResult {
  plays_per_team: number;
  handler_namespaces: string[];
  document: CatalogEntry;
}

/**
 * expand_replication — emits one Ansible play per team with handler name
 * rewrites for play-level notify references (spec §3).
 *
 * v1 Plan A skeleton: trivial path only (no per_team groups OR team_count=1
 * with shared-only nodes). Anything else raises NotImplemented.
 */
export function expand_replication(
  document: CatalogEntry,
  team_count: number,
): ExpandResult {
  if (team_count < 1) {
    throw new Error(`invalid team_count: ${team_count}`);
  }

  const hasPerTeam = (document.nodes ?? []).some(containsPerTeamRecursive);
  if (hasPerTeam) {
    throw new NotImplemented('expand_replication', 'per-team-groups', 'Plan B delivery');
  }

  return {
    plays_per_team: team_count,
    handler_namespaces: [],
    document: structuredClone(document),
  };
}

function containsPerTeamRecursive(n: Node): boolean {
  if (n.replication?.scope === 'per_team') return true;
  return (n.children ?? []).some(containsPerTeamRecursive);
}
