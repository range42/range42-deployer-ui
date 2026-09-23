# Canvas → Document Serializer (#77) — Design

**Status:** approved (2026-05-21)
**Issue:** range42-deployer-ui#77 — *build the canvas→overlay serializer (drawn nodes + attachments don't reach deploy)*
**Repo:** range42-deployer-ui (Vue 3 / Pinia / VueFlow), commit-direct to `dev`.

---

## 1. Problem

Nothing in the deployer-ui turns the canvas model into the document the deploy
pipeline consumes. `projectStore` holds `{ nodes, edges, attachments }` and the
`ProjectRepoAdapter` persists files, but no code builds a canonical document
from the canvas. Consequence: neither drawn nodes nor node attachments reach a
live deploy. This gates attachments authoring and the archetype palette (#61).

## 2. Verified deploy contract (ground truth)

Confirmed by reading the backend deploy path (not the compose endpoint):

- `range42-backend-api/app/core/deploy_trigger.py:125-184` — for the
  `_universal` scenario, the backend clones the **project repo** at
  `dep.project_sha` and reads its topology directly. **`compose` is never
  called in the deploy path** (it is a separate validation/preview endpoint).
- `range42-backend-api/app/core/project.py:72,95` — `checkout_project` reads
  **`topology.json` at the project repo root**, parsed as **JSON**. Missing
  file → `ProjectCheckoutError`.
- `range42-backend-api/app/core/inventory_writer.py:97-188` — consumes the
  topology document directly:
  - `naming_prefix` (default `codename.lower()`), `bridge_base` (default 140).
  - `nodes[]`; only `kind ∈ {vm, lxc, docker}` become Ansible hosts.
  - **`role` is REQUIRED** on every host node — `ValueError` if missing
    (line 151-155). `role ∈ {admin, team, trainee, shared}`.
  - `replication.scope` (shared/per_team) drives per-team expansion.
  - `template_vmid` → `r42_template_vmid` hostvar.
  - `attachments[].source.ref` → wazuh-agent group membership.
  - Host IP is **derived** (`192.168.{bridge_base+team_id}.{200+seq}`), bridge
    derived (`vmbr{bridge_base+team_id}`). Network nodes are **not** hosts;
    `networks[]` and static `ip`/`bridge`/`cidr` are **not consumed** today.

**Implication:** the serializer's job is to produce a canonical `CatalogEntry`
document and persist it as `topology.json` at the project repo root. The deploy
reads it as-is. No `range42.yaml`, no `overlay.yaml`, no YAML conversion, and
**no backend change for the deploy path**.

## 3. Scope decisions (approved)

1. **Full-snapshot, not overlay-diff.** Implement canvas↔`CatalogEntry`
   serialize/deserialize (the inverse of `compose.ts`). No canvas→`ProjectOverlay`
   diff engine — the catalog has zero canonical entries to fork from yet, so the
   diff path cannot be validated end-to-end. `compose.ts` is not removed — it
   remains the consumer and is exercised by the round-trip identity test
   (`compose(doc, {}) == doc`); load itself is `deserializeToCanvas`, not compose.
2. **#69 network fields: emit faithfully now, honor later.** The serializer
   carries network addressing into the doc — static `bridge`/`cidr`/`gateway`
   for `shared` scope; node-level `bridge_template`/`cidr_template`/`vlan_tag`
   for `per_team` — and round-trips them. No silent drop. End-to-end honoring is
   a coordinated follow-up (§9).
3. **`role`: explicit field + smart default.** Add a minimal role selector
   (admin/team/trainee/shared) to host-node config; default by inference
   (inside a `team_scope` group → `team`, else `admin`). Serializer emits
   `node.role = config.role ?? infer(node)` for every vm/lxc/docker node.

## 4. Module layout (`src/overlay/`)

- **`serialize.ts`** (new), pure, no IO, mirrors `compose.ts` conventions:
  - `serializeToCatalogEntry(canvas: CanvasModel, meta: ProjectMeta): CatalogEntry`
  - `deserializeToCanvas(doc: CatalogEntry, layout: CanvasLayout): CanvasModel`
  - `extractLayout(canvas: CanvasModel): CanvasLayout` (visual/non-canonical data)
- Co-located unit tests + round-trip tests.
- `CanvasModel = { nodes: VueFlowNode[], edges: VueFlowEdge[], attachments: Attachment[] }`.

## 5. Canvas → CatalogEntry mapping

### 5.1 Node kind

| VueFlow `type` (+`data`) | Schema `kind` | Notes |
|---|---|---|
| `vm` / `lxc` | `vm` / `lxc` | `config.template` → node-level `template_vmid` |
| `docker` | `docker` | `data.host_ref` → `host_ref` |
| `network-segment` | `network` | bridge/cidr/gateway per §5.4 |
| `router` / `edge-firewall` | `router` / `firewall` | serialized faithfully; Problems warns "not realized by v1 universal playbook" |
| `group` + `data.kind=topology_group` | `group`, `replication.scope=shared` | |
| `group` + `data.kind=team_scope` | `group`, `replication.scope=per_team` | `data.team_count` → deploy-time param (meta), **not** the doc |
| `skin` | `skin` | cosmetic |
| `switch` | — (unsupported) | preserved in `canvas_layout.json` + Problems warning; not in doc |

### 5.2 Node-level field placement (schema `additionalProperties: false`)

Allowed Node keys: `id, kind, role, replication, host_ref, config, networks,
attachments, children, cidr_template, bridge_template, vlan_tag, template_vmid`.

- `template_vmid`, `cidr_template`, `bridge_template`, `vlan_tag`, `role` are
  **node-level** (NOT inside `config`).
- `config` is free-form (`additionalProperties: true`): cores, memory,
  diskSize, cloudinit_user/password, name, description, appliance fields, etc.
- **Do NOT emit** static VM `ipAddress`/`vmId` (backend-derived).

### 5.3 `role` (required for vm/lxc/docker)

`node.role = config.role ?? infer(node)`, where `infer` = `team` if the node is
inside a `team_scope` group ancestry, else `admin`. Always present for host
kinds. A minimal role `<select>` is added to ConfigPanel for host nodes.

### 5.4 Edges → `networks[]`; network addressing

- A compute→network edge becomes a `NetworkAttachment` on the compute node:
  `{ node_ref: <network id>, dhcp, ip }`. Schema `NetworkAttachment` keys are
  `{node_ref, ip, ip_template, dhcp}`.
- Network node addressing: the serializer **preserves whatever the canvas holds**
  — static `config.bridge`/`config.cidr`/`config.gateway` and `vlan_tag` (lifted
  from `config.vlan`). These are **preserved in the doc** but **not yet honored
  by deploy** (IPs/bridges are backend-derived). Honoring is the §9 follow-up.
- **Per-team template fields deferred (decided during implementation):** the
  template variants (`ip_template` on `NetworkAttachment`, `bridge_template`/
  `cidr_template` at node level) describe the *eventual* per-team addressing
  shape, but #77 does **not** synthesize them. Reasons: (a) the canvas has no
  template-authoring UI yet — there is nothing to read them from; (b) auto-
  generating the backend's own default (`vmbr{bridge_base+team_id}`, etc.) just
  duplicates what `expand_replication`/`inventory_writer` already derive and
  would emit fields the deploy ignores; (c) the `expand_replication` node-vs-
  config drift (§9) means node-level templates would currently no-op. Template
  authoring + emission lands with the archetype palette (#61), paired with the
  §9 backend honoring. The schema types and `deserializeToCanvas` already
  round-trip these fields, so no migration is needed when #61 starts emitting
  them. See §11.

### 5.5 Grouping → `children[]` + replication

- VueFlow `parentNode` nesting folds into `Node.children[]`.
- `team_scope` group → `replication.scope=per_team`; `topology_group` →
  `replication.scope=shared` (default).
- `id_offset` is omitted (backend derives vmid/ip).
- `team_count` is a **deploy-time parameter** (project meta / DeployForm),
  not a document field.

### 5.6 Attachments flat → nested

- `currentProject.attachments` (flat, keyed by `target_node`, canonical shape)
  group under each node's `attachments[]`, dropping `target_node`.
- `scope: group_inherited` nests on the group node; `node` on the specific node.
- Inverse on load: flatten nested `attachments[]` back to the flat array,
  re-deriving `target_node`. Effective/inherited sets are recomputed at runtime
  via the existing `computeEffectiveAttachments`.

### 5.7 Top-level CatalogEntry fields

- `schema_version: "1.0"` (pattern `^[0-9]+\.[0-9]+$`).
- `kind`: `gamenet` if any `team_scope` present, else `lab` (functionally
  ignored by deploy; both validate).
- `name`: project name.
- `naming_prefix`: sanitized from project name to `^[a-z0-9][a-z0-9-]{0,31}$`.
- `bridge_base`: project setting, default 140.
- `env` / `flags` / `execution`: carried from existing project state
  (VariablesTab already manages env).

## 6. Round-trip & non-canonical data (`canvas_layout.json`)

The canonical `topology.json` holds **only** deploy-meaningful, schema-defined
data. Everything else lives in `canvas_layout.json`, keyed by node/edge id, and
is merged on load. This gives lossless round-trip without bloating the doc.

`canvas_layout.json` holds:
- Node `position {x,y}`, dimensions, `data.label` overrides.
- Edge identity: `sourceHandle`/`targetHandle`, and edge `data.connection`
  extras with no canonical home: `interfaceModel`, `macAddress`, `firewall`,
  `vlanTag` (per-NIC), `mtu`, `rate`, `isGateway`.
- `switch` nodes (unsupported in schema) preserved verbatim so user work is not
  lost; a Problems warning notes they will not deploy.

Re-derived on load (NOT persisted):
- Docker tether edges (from `host_ref` via `computeDockerTetherEdges`).
- Edge `data.replication_intent` (deterministically re-inferred from group
  ancestry via the existing `inferReplicationIntent`).
- Node `status` (from deployment state), `label` (from `config.name`/`id`).

**Round-trip invariants (tested):**
- `deserializeToCanvas(serializeToCatalogEntry(c), extractLayout(c)) ≈ c`
  (semantic + visual equality, modulo re-derived fields).
- `serializeToCatalogEntry(deserializeToCanvas(doc, layout)) == doc`
  (idempotent on a doc-originated canvas).
- `compose(serializeToCatalogEntry(c), {}) === serializeToCatalogEntry(c)`
  (full-snapshot identity through the existing consumer).

## 7. Where it runs

- **Save / autosave:** `serializeToCatalogEntry(canvas)` → `topology.json`
  (JSON) at the project repo **root**; `extractLayout(canvas)` →
  `canvas_layout.json`. The `ProjectRepoAdapter` persists both. (`overlay.json`
  /`meta.json` paths unchanged for now; the env-overlay path is untouched.)
- **Load:** read `topology.json` → `deserializeToCanvas` merged with
  `canvas_layout.json`.
- **Deploy:** unchanged — `DeployForm` already posts `project_sha`
  (the saved commit SHA); the backend reads `topology.json` at that SHA.
- **Adapter note:** for `_universal` deploys the repo root must hold
  `topology.json`. Build-from-scratch projects use a dedicated-repo layout
  (root = topology.json). The shared-repo-subdir layout is out of scope here.

## 8. Types & schema

- Update the hand-written mirror `src/types/range42-schema.ts`:
  - `Node`: add `role`, `template_vmid`, `cidr_template`, `bridge_template`,
    `vlan_tag`.
  - `CatalogEntry`: add `naming_prefix`, `bridge_base`, `preflight_checks`.
- Canonical `schema/range42.schema.json` is unchanged (already has these). The
  pre-commit hook regenerates `bundled.json` + backend pydantic when
  `src/types/range42-schema.ts` is staged; backend pydantic is already current.

## 9. Cross-repo coordination (follow-ups, NOT in #77)

Tracked separately; #77 does not depend on them for canvas-authored host nodes
to deploy (role + structure are honored today):

- **backend-api #73** — `inventory_writer` derives `ansible_host` from topology
  (honor node `cidr`/`ip`) instead of the hardcoded `192.168.x` scheme.
- **backend-api #82** — `_universal` creates bridges from topology instead of
  asserting they pre-exist.
- **playbooks** — `r42_topology.py` filters read node-level `bridge`/`cidr`/`ip`
  rather than recomputing from `bridge_base`.
- **NEW bug to file** — `expand_replication` (both `app/overlay/
  expand_replication.py` and `src/overlay/expand_replication.ts`) reads
  templates from `node.config` (`config.bridge_template`, `config.cidr_template`,
  `config.vlan_template`) while the canonical schema defines them **node-level**
  (`bridge_template`, `cidr_template`, `vlan_tag` — note `vlan_tag` vs
  `vlan_template`). Per-team template rendering silently no-ops until aligned.
  Affects only the compose/validate **preview** endpoint, not the deploy path.

## 10. Testing

- Unit: per-kind node mapping, edge→networks, grouping→children/replication,
  attachments flat↔nested, role inference, naming_prefix sanitization,
  field-placement (node-level vs config), unsupported-kind handling.
- Round-trip: §6 invariants over a fixture canvas covering all node kinds,
  multi-network edges, nested groups, per-team scope, attachments.
- New TS-only vector dir `schema/test-vectors/serialize/` (canvas input →
  expected CatalogEntry). Existing `compose`/`expand` vectors stay shared
  TS↔Python.
- Quality gate: `npx vitest run` (0 failures) + `npm run build`.

## 11. Out of scope

Overlay-diff engine; catalog-fork projects; switch/router/firewall deploy
realization; per-team count authoring UI and full archetype palette (#61);
**per-team network/IP template authoring + emission** (`ip_template`/
`bridge_template`/`cidr_template`) — deferred to #61 with the §9 backend work,
see §5.4; backend honoring of drawn network addressing (§9); fixing the
`expand_replication` template drift (§9, separate coordinated change).
