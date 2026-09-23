/**
 * Range42 scenario schema — hand-written TypeScript types mirroring
 * schema/range42.schema.json. TS codegen is deferred per spec §13 cut
 * list; these types are cross-validated against the Python side via the
 * shared JSON test vectors under schema/test-vectors/.
 *
 * Field names are authoritative from spec §3, §18, §21.
 */

export type SchemaVersion = `${number}.${number}`;

// ---------- Attachment + shared ----------

export type AttachmentSourceKind =
  | 'catalog_role'
  | 'catalog_container'
  | 'inline_yaml'
  | 'file_upload'
  | 'external_git';

export interface AttachmentSource {
  kind: AttachmentSourceKind;
  ref?: string;
  sha?: string;
  url?: string;
  content_ref?: string;
  /** Inline content for inline_yaml (YAML text) and file_upload (base64). */
  content_inline?: string;
}

export type AnsiblePrimitive = 'task' | 'handler' | 'block';
export type AttachmentScope = 'node' | 'group_inherited';

export interface Attachment {
  id?: string;
  source: AttachmentSource;
  title?: string;
  stage: string;
  order_in_stage?: number;
  scope?: AttachmentScope;
  vars?: Record<string, unknown>;
  ansible_primitive?: AnsiblePrimitive;
  handler_namespace?: string;
  target_node?: string;
}

export type ReplicationScope = 'shared' | 'per_team';

export interface Replication {
  scope: ReplicationScope;
  id_offset?: { vmid?: number; ip?: number };
}

export interface NetworkAttachment {
  node_ref: string;
  ip?: string;
  ip_template?: string;
  dhcp?: boolean;
}

export type NodeKind =
  | 'vm' | 'lxc' | 'docker' | 'network' | 'router' | 'firewall' | 'skin' | 'group';

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
  gateway_template?: string;
  cidr?: string;
  bridge?: string;
  gateway?: string;
  vlan_tag?: number | null;
  template_vmid?: number;
}

export interface Execution {
  stages?: string[];
}

// ---------- Env + flags ----------

export interface EnvVar {
  name: string;
  scope?: ReplicationScope;
  secret?: boolean;
  required?: boolean;
  default?: unknown;
}

export interface Flag {
  id: string;
  scope: ReplicationScope;
  value_template?: string;
  points?: number;
}

// ---------- Top-level documents ----------

export type CatalogKind = 'lab' | 'gamenet' | 'component';

export interface CatalogEntry {
  schema_version: SchemaVersion;
  kind: CatalogKind;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  nodes?: Node[];
  env?: EnvVar[];
  flags?: Flag[];
  defaults?: Record<string, unknown>;
  execution?: Execution;
  naming_prefix?: string;
  bridge_base?: number;
  preflight_checks?: string[];
}

export interface NodePatch {
  id: string;
  patch: Record<string, unknown>;
}

export interface ProjectOverlay {
  schema_version: SchemaVersion;
  source_url: string;
  source_sha: string;
  source_entry?: string;
  param_overrides?: Record<string, unknown>;
  nodes_added?: Node[];
  nodes_removed?: string[];
  nodes_patched?: NodePatch[];
  attachments_added?: Attachment[];
  execution_override?: Execution;
}

export type AttemptState =
  | 'pending' | 'deploying' | 'succeeded' | 'partial'
  | 'failed' | 'cancelled' | 'unknown';

export type AttemptSubReason =
  | 'host_unreachable' | 'task_timeout' | 'preflight_block'
  | 'vault_rekey_blocked' | 'auth_failed' | 'resource_overcommit'
  | 'image_pull_failed' | 'protected_vmid_collision';

export interface Attempt {
  id: string;
  scope: string;
  team_id?: number;
  state: AttemptState;
  sub_reason?: AttemptSubReason;
  started_at?: string;
  ended_at?: string;
  rc?: number;
  event_cursor_tip?: number;
}

export type DeploymentState =
  | 'pending' | 'preflight_running' | 'preflight_review'
  | 'deploying' | 'succeeded' | 'partial' | 'failed'
  | 'cancelled' | 'unknown';

export interface DeploymentRecord {
  id: string;
  codename: string;
  scenario_label?: string;
  project_id: string;
  target_host_id: string;
  catalog_sha?: string;
  project_sha?: string;
  effective_doc_hash?: string;
  team_count: number;
  state: DeploymentState;
  current_attempt_id?: string;
  workspace_path: string;
  created_at?: string;
  attempts?: Attempt[];
}

// ---------- Events + preflight ----------

export type EventType =
  | 'state_transition' | 'phase_transition'
  | 'task_start' | 'task_end' | 'host_unreachable'
  | 'log_line' | 'redaction' | 'heartbeat'
  | 'attempt_start' | 'attempt_end' | 'proxmox_task' | 'preflight_check';

export interface EventLogEntry {
  event_seq: number;
  attempt_id: string;
  deployment_id?: string;
  ts: string;
  deployer_ts?: string;
  proxmox_ts?: string;
  stage?: string;
  substate?: string;
  team_id?: number;
  node_id?: string;
  event_type: EventType;
  payload?: Record<string, unknown>;
}

export type PreflightResult = 'pass' | 'warn' | 'block';

export interface PreflightCheck {
  check: string;
  result: PreflightResult;
  detail?: string;
  field_path?: string;
}

export interface PreflightRecord {
  deployment_id: string;
  attempt_id: string;
  ts: string;
  checks: PreflightCheck[];
  result: PreflightResult;
}

// ---------- Proxmox host ----------

export interface ProxmoxHostHealth {
  status: 'ok' | 'degraded' | 'unreachable';
  rtt_ms?: number;
  sdn_available?: boolean;
  at: string;
}

export interface ProxmoxHostAuth {
  kind: 'api_token';
  token_id_ref: string;
}

export interface ProxmoxHost {
  id: string;
  name: string;
  api_url: string;
  node_name: string;
  auth: ProxmoxHostAuth;
  token_scope?: string;
  default_bridge?: string;
  protected_vmids_override?: [number, number][];
  added_at?: string;
  last_health_check?: ProxmoxHostHealth;
}

// ---------- Helper types ----------

export type Range42Document =
  | CatalogEntry
  | ProjectOverlay
  | DeploymentRecord
  | EventLogEntry
  | PreflightRecord
  | ProxmoxHost;
