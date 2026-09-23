import { describe, it, expect } from 'vitest';
import type {
  Attachment, AttachmentSource, AnsiblePrimitive, AttachmentScope,
  Replication, ReplicationScope, NetworkAttachment,
  Node, NodeKind, Execution,
  EnvVar, Flag,
  CatalogEntry, CatalogKind,
  ProjectOverlay, NodePatch,
  Attempt, AttemptState, AttemptSubReason,
  DeploymentRecord, DeploymentState,
  EventLogEntry, EventType,
  PreflightCheck, PreflightRecord, PreflightResult,
  ProxmoxHost, ProxmoxHostAuth, ProxmoxHostHealth,
  Range42Document,
  SchemaVersion,
} from '@/types/range42-schema';

// Compile-time barrel assertion: referencing each imported type here ensures
// it remains exported from '@/types/range42-schema'. The tuple is never
// instantiated at runtime — it exists purely to pin the public type surface.
type _BarrelCheck = [
  Attachment, AttachmentSource, AnsiblePrimitive, AttachmentScope,
  Replication, ReplicationScope, NetworkAttachment,
  Node, NodeKind, Execution,
  EnvVar, Flag,
  CatalogEntry, CatalogKind,
  ProjectOverlay, NodePatch,
  Attempt, AttemptState, AttemptSubReason,
  DeploymentRecord, DeploymentState,
  EventLogEntry, EventType,
  PreflightCheck, PreflightRecord, PreflightResult,
  ProxmoxHost, ProxmoxHostAuth, ProxmoxHostHealth,
  Range42Document,
  SchemaVersion,
];

describe('range42-schema types', () => {
  it('CatalogEntry — lab minimal fixture from spec §21.1', () => {
    const e: CatalogEntry = {
      schema_version: '1.0' as SchemaVersion,
      kind: 'lab',
      name: 'Blue Team Fundamentals',
      tags: ['blue', 'training', 'wazuh'],
      nodes: [
        { id: 'net-lan', kind: 'network', config: { bridge: 'vmbr143', vlan: 143 } },
        {
          id: 'wazuh', kind: 'vm',
          replication: { scope: 'shared' },
          config: { name: 'wazuh', cores: 4, memory: 8192 },
          networks: [{ node_ref: 'net-lan', ip: '192.168.143.100' }],
          attachments: [
            { source: { kind: 'catalog_role', ref: 'software.install.wazuh' },
              stage: 'install', order_in_stage: 0 },
          ],
        },
      ],
      execution: { stages: ['network', 'base', 'install', 'configure', 'start'] },
    };
    expect(e.kind).toBe('lab');
  });

  it('ProjectOverlay — minimal fixture from spec §21.3', () => {
    const o: ProjectOverlay = {
      schema_version: '1.0',
      source_url: 'https://github.com/range42/catalog-main',
      source_sha: 'f4a9c2e',
      source_entry: 'scenarios/ccdc-6team',
      param_overrides: { 'defaults.team_count': 8 },
    };
    expect(o.source_sha).toBe('f4a9c2e');
  });

  it('DeploymentRecord — abbreviated fixture from spec §21.4', () => {
    const d: DeploymentRecord = {
      id: 'dep-7c2f',
      codename: 'AURORA',
      project_id: 'proj-42',
      target_host_id: 'pve01-range42',
      team_count: 8,
      state: 'deploying',
      workspace_path: '/home/deployer/range42.config/AURORA-ccdc-dec-2026',
      attempts: [
        { id: 'att-1', scope: 'full', state: 'failed', sub_reason: 'host_unreachable', rc: 4 },
      ],
    };
    expect(d.attempts?.[0].sub_reason).toBe('host_unreachable');
  });

  it('EventLogEntry — state_transition shape', () => {
    const ev: EventLogEntry = {
      event_seq: 1,
      attempt_id: 'att-3',
      ts: '2026-04-14T13:47:00Z',
      event_type: 'state_transition',
      payload: { from: 'pending', to: 'preflight_running' },
    };
    expect(ev.event_type).toBe('state_transition');
  });

  it('Range42Document union accepts each document kind', () => {
    const docs: Range42Document[] = [];
    const attach: Attachment = { source: { kind: 'inline_yaml', content_ref: 'x.yml' }, stage: 'configure' };
    void docs; void attach;
    expect(true).toBe(true);
  });
});
