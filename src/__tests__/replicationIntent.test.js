import { describe, it, expect } from 'vitest'
import {
  inferReplicationIntent,
  getTeamScopeAncestorId,
} from '../composables/useInfraBuilder'

/**
 * Plan C §6 — replication_intent inference
 * - both endpoints in the same team_scope  → 'mesh'
 * - one endpoint inside a team_scope       → 'fan_out'
 * - neither endpoint in a team_scope       → 'pair_scoped'
 */

const scenario = () => {
  // Two team_scope groups + a plain (topology) group + some nodes.
  const teamA = { id: 'scope-a', type: 'group', data: { kind: 'team_scope', team_count: 3 } }
  const teamB = { id: 'scope-b', type: 'group', data: { kind: 'team_scope', team_count: 4 } }
  const plainGroup = { id: 'g-plain', type: 'group', data: { kind: 'topology_group' } }

  // Nodes inside team scopes
  const vmA1 = { id: 'vm-a1', type: 'vm', parentNode: 'scope-a' }
  const vmA2 = { id: 'vm-a2', type: 'vm', parentNode: 'scope-a' }
  const vmB1 = { id: 'vm-b1', type: 'vm', parentNode: 'scope-b' }

  // Shared nodes (no team_scope ancestor)
  const sharedDns = { id: 'shared-dns', type: 'vm' }
  const sharedNet = { id: 'shared-net', type: 'network-segment' }

  // Node inside a plain topology group (NOT a team_scope) — should still be treated as shared
  const nestedInPlain = { id: 'vm-in-plain', type: 'vm', parentNode: 'g-plain' }

  const allNodes = [teamA, teamB, plainGroup, vmA1, vmA2, vmB1, sharedDns, sharedNet, nestedInPlain]
  return { teamA, teamB, plainGroup, vmA1, vmA2, vmB1, sharedDns, sharedNet, nestedInPlain, allNodes }
}

describe('getTeamScopeAncestorId (helper)', () => {
  const s = scenario()

  it('returns null for a node with no parent', () => {
    expect(getTeamScopeAncestorId(s.sharedDns, s.allNodes)).toBeNull()
  })

  it('returns the team_scope id for a node whose direct parent is team_scope', () => {
    expect(getTeamScopeAncestorId(s.vmA1, s.allNodes)).toBe('scope-a')
    expect(getTeamScopeAncestorId(s.vmB1, s.allNodes)).toBe('scope-b')
  })

  it('returns null when the only ancestor is a plain topology_group (not team_scope)', () => {
    expect(getTeamScopeAncestorId(s.nestedInPlain, s.allNodes)).toBeNull()
  })
})

describe('inferReplicationIntent — three-case coverage (Plan C §6)', () => {
  const s = scenario()

  it("both endpoints in the same team_scope → 'mesh'", () => {
    expect(inferReplicationIntent(s.vmA1, s.vmA2, s.allNodes)).toBe('mesh')
  })

  it("one endpoint in a team_scope, the other shared → 'fan_out' (source-side)", () => {
    expect(inferReplicationIntent(s.vmA1, s.sharedDns, s.allNodes)).toBe('fan_out')
  })

  it("one endpoint in a team_scope, the other shared → 'fan_out' (target-side)", () => {
    expect(inferReplicationIntent(s.sharedNet, s.vmA1, s.allNodes)).toBe('fan_out')
  })

  it("endpoints in DIFFERENT team_scopes still fan_out (they can't mesh across scopes)", () => {
    expect(inferReplicationIntent(s.vmA1, s.vmB1, s.allNodes)).toBe('fan_out')
  })

  it("neither endpoint in a team_scope → 'pair_scoped'", () => {
    expect(inferReplicationIntent(s.sharedDns, s.sharedNet, s.allNodes)).toBe('pair_scoped')
    // A plain topology_group ancestor doesn't count as a scope.
    expect(inferReplicationIntent(s.nestedInPlain, s.sharedNet, s.allNodes)).toBe('pair_scoped')
  })
})
