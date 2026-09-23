# Proxmox Action Tracking — confirmed delete/lifecycle + unified activity terminal

**Date:** 2026-06-08
**Repos:** `range42-deployer-ui` (UI), `range42-backend-api` (v1 delete + task-status endpoints)
**Status:** Approved design, verified against code (3 subagent reviews folded in), pending plan

## Problem

Deleting a node in the deployer UI is canvas-only and lifecycle actions are
fire-and-forget. The **Delete** button (`ConfigPanel.handleDelete`, `ConfigPanel.vue:351`)
only removes the node from the VueFlow canvas (`ProjectEditor.handleDeleteNode`,
`ProjectEditor.vue:707`) — it never touches Proxmox. Start/stop/pause (v1) return
`accepted` (an async task UPID) and the UI optimistically flips the badge to the *assumed*
final status (`ACTION_RESULT_STATUS`, `ConfigPanel.vue:276-323`, the `#80` change) without
confirming the task succeeded. There is no place to see what operations were launched or
whether they worked. Separate bug: the confirm-dialog overlay (`ConfirmDialog.vue`, a
single un-teleported `z-[100]` instance in `App.vue:9`) renders *behind* the ConfigPanel
modal (`ConfigPanel.vue:399`, no explicit z-index, nested in a deep stacking context).

Users want: deleting a node **destroys the VM on Proxmox by default** (canvas-only
opt-out); the node shows a **transitional state** (red dot + "deleting" label) while
Proxmox works, resolving only once the task **actually completes**; and a **read-only
activity terminal** beside Problems that captures every launched action and its outcome,
unified with deployment logs.

## Goals

- Delete a deployed VM/LXC node → destroy on Proxmox (disks included) **and** remove from
  canvas by default; explicit **"Remove from canvas only"** opt-out orphans the VM.
- **Confirmed outcomes, not optimistic.** Every Proxmox action is tracked to task
  completion via its UPID; node status and the terminal reflect the *real* result.
- **Transitional node status** with label while a task is in flight.
- **Unified activity terminal** in the editor bottom dock: Proxmox actions + deployment SSE
  logs in one read-only feed.
- Protected VMIDs (100/101 + per-host overrides) can **never** be destroyed.
- Fix the dialog z-index bug.

## Non-Goals (YAGNI)

- Delete/Backspace key gesture — stays canvas-only silent removal.
- Declarative teardown via topology.json / deploy reconcile.
- Auto-stopping a running VM before delete (delete requires stopped; clear error).
- Persisting the full log across reloads — terminal is a session-only ring buffer; deploy
  history stays on the deployment detail page (SSE replay).
- Bulk multi-node delete.

## Decisions

- **Approach B (v1):** new v1 delete endpoint mirroring the migrated lifecycle surface;
  legacy v0 delete retired from the UI (it also carries a latent `NameError: Any` bug on
  its failure path — `app/routes/vms.py:84`, no `from typing import Any`).
- **Disks deleted:** `purge=1` + `destroy-unreferenced-disks=1`.
- **Wait for real completion:** UI polls a new `tasks/{upid}/status` endpoint until settled.
- **"Remove from canvas only" orphans** the VM (intended).
- **Delete requires a stopped VM**; running → backend 409, UI "Stop the VM first".
- Only **VM** and **LXC** node kinds (`node.type ∈ {'vm','lxc'}`) get the Proxmox-delete
  option; Docker / Network / Router / Firewall / group / undeployed → canvas-only.
- **Build all together:** delete + start/stop/pause/resume all route through one task core;
  the terminal ships with this work.
- **Unified terminal, session-only:** ~500-entry ring buffer fed by the task core and a
  `deploymentStore` event hook (see §4).
- **Extract a shared node-status helper** (new) — VM/LXC/Docker currently each map status
  differently; transitional statuses go in one place, not three.

## Architecture

### Data flow
```
ConfigPanel action (delete / start / stop / pause / resume)
  → DeleteNodeModal (delete only; adapts to node kind + deploy state)
  → useProxmoxTasks.launch(action, {node, vmId, vmtype, apiCall, onSuccess})
       1. activityLog.push({pending}) + node.data.pendingAction=action (→ transitional badge)
       2. await apiCall() → { upid }      (getRegisteredHost may throw "No host" → error entry)
       3. poll getTaskStatus(upid) every ~1.5s until status==='stopped' (bounded ~120s)
       4a. exitstatus 'OK' → onSuccess (delete: emit('delete'); others: confirmed status)
           activityLog.update({success}); clear pendingAction; proxmoxCache.invalidate()
       4b. non-OK / timeout → revert node.data.status; activityLog.update({error}); toast

deploymentStore.onEvent(cb) hook ──► activityLog.push({source:'deploy'})
                                            │
ActivityTerminal (editor dock, sibling to ProblemsPanel) ◄─┘  unified feed
```

### 1. Backend — `range42-backend-api`

Branch off **`feature/gamenet-authoring-v1`** (the deployed v1 branch — `git switch` to it
first; the working tree is currently on `fix/catalog-walker-detail-and-alembic`). PR back
into `feature/gamenet-authoring-v1`; redeploy `r42.admin-web-builder-api`.

Two routes added to `app/routes/v1/proxmox/vms.py`:

**a) Delete**
```
DELETE /v1/proxmox/hosts/{host_id}/vms/{vmid}?vmtype=qemu&purge=true
```
- `_get_host` → **always** `_assert_vmid_safe(row, vmid, "delete")` → Proxmox
  `DELETE .../nodes/{node}/{vmtype}/{vmid}` with `purge=1` + `destroy-unreferenced-disks=1`
  when `purge`.
- Error envelope reused (401/403 → `AuthFailedError`(502), `RequestError` → `_unreachable`,
  other non-2xx → `PROXMOX_ERROR` 502). **Running guest → 409 CONFLICT** "Stop the VM
  before deleting" (detect via Proxmox response text/status).
- Returns `VmActionResult(status="accepted", upid=...)` (schema exists,
  `app/schemas/v1/proxmox.py:47`).

**b) Task status**
```
GET /v1/proxmox/hosts/{host_id}/tasks/{upid:path}/status
```
- **UPIDs contain colons** → declare the path param as `{upid:path}` so it isn't split;
  **percent-encode** the UPID (`urllib.parse.quote(upid, safe='')`) when building the
  outbound Proxmox URL `GET .../nodes/{node}/tasks/{upid}/status`.
- New `TaskStatus` schema in `app/schemas/v1/proxmox.py` (alongside `VmSummary`/
  `VmActionResult`): `{ upid: str, status: Literal["running","stopped"],
  exitstatus: str | None = None, node: str }`. `exitstatus == "OK"` ⇒ success; any other
  value when `stopped` ⇒ failure (message = exitstatus). Same error envelope.

**Refactor:** extract the inline guard block (`vms.py:123-135`) into
`_assert_vmid_safe(row, vmid, action)` (takes `row` — it reads
`row.protected_vmids_override_json`; `action` only feeds the error message). **Behavior
preserved:** `vm_status_action` keeps its `if action in _DESTRUCTIVE_ACTIONS:` gate around
the call; `vm_delete` calls it unconditionally. (`VmidProtectedError` is status 409 /
`VMID_PROTECTED`, `app/core/errors.py:43`.)

### 2. UI service layer — `src/services/proxmox/api.ts` + `types.ts`
- New TS types in `types.ts` (current `ApiResponse` has **no** `upid`/`exitstatus`):
  `VmActionResult { status: string; upid?: string }`,
  `TaskStatus { upid: string; status: 'running'|'stopped'; exitstatus?: string; node: string }`.
- `vmDelete(vmId, { vmtype='qemu', purge=true })` → `request<VmActionResult>(...)` with a
  **query string** (not a body), via `getRegisteredHost()` — mirrors `vmStatusAction`
  (`api.ts:266-276`).
- `getTaskStatus(upid)` → `request<TaskStatus>('/v1/proxmox/hosts/${id}/tasks/${encodeURIComponent(upid)}/status')`.
- Repoint `vm.delete` (v0, `api.ts:318`) **and** `lxc.delete` (v0, **different signature**
  `(node, vmId)` → `/v0/admin/proxmox/lxc/delete`, `api.ts:483`) to the v1 `vmDelete`;
  **update `lxc.delete`'s call sites** to the new `(vmId, {vmtype:'lxc'})` shape.
- `getRegisteredHost()` throws `ProxmoxApiError(0, 'No Proxmox host registered…')` when none
  exists — the task core catches this and emits an error entry.

### 3. UI task-tracking core — `src/composables/useProxmoxTasks.ts` (new)
- `launch(action, { node, vmId, vmtype, apiCall, onSuccess })` per the data flow above.
  Poll loop uses a `setTimeout` seam (inject for tests, like
  `deploymentStore` `setTimeoutFn`).
- **Transitional status via the shared helper (below).** Sets `node.data.pendingAction`;
  on settle clears it and either removes the node (delete) or sets the confirmed status
  (`running`/`stopped`/`paused`). Replaces the `#80` optimistic-final write at
  `ConfigPanel.vue:320-323`.
- Sits **beside** existing `useProxmoxStatus`/`useWebSocketStatus`/`useCanvasLiveStatus`
  (none do task polling); reuses only their `setInterval`+`onUnmounted` idiom.

### 3b. UI shared status helper — `src/composables/useNodeStatus.ts` (new)
Single source mapping a status (+ optional `pendingAction`) → `{ dotColor, label, pulse }`.
Consumed by `InfraNodeVm.vue` (replaces local `statusColor` `:16-36`), `DockerNode.vue`
(replaces dup `:37`), `InfraNodeLxc.vue` (currently **dot-only** `:43` + CSS
`status-${status}` — add a label), and `ConfigPanel.vue:570-582`.
- Handles both vocabularies already in use: semantic (`running/stopped/paused/error/
  deploying`) and color aliases (`green/gray/orange/red/blue`).
- Transitional: `deleting`→red, `stopping`/`pausing`→amber(orange), `starting`/`resuming`→
  blue. **`red` already = `error`** → disambiguate `deleting` with the **label text** and a
  **pulse** (`animate-pulse`, already used for orange/blue at `InfraNodeVm.vue:99,101`);
  `error` stays steady. New transitional CSS classes added to `src/main.css:363-374`.

### 4. UI unified activity log — `src/stores/activityLogStore.ts` (new, `.ts`)
- Composition Pinia store (`defineStore('activityLog', () => {...})`), **session-only**
  (no persistence watch — matches `deploymentStore`). Ring buffer (~500) using the
  `pushRing` idiom (`deploymentStore.ts:131-135`). Entry:
  `{ id, ts, source:'proxmox'|'deploy', level:'pending'|'success'|'error'|'info', target, message, upid? }`.
  `push()`, `update(id, patch)`, `clear()`.
- **Deploy bridge:** `deploymentStore` exposes **no event API** — add a small optional
  `onEvent(cb)` observer hook fired inside `applySseEvent` (`deploymentStore.ts:153`) and
  register it from the bridge. (Watching `record.logs`/`last_event_seq` instead would drop
  events on ring overflow — the hook is the clean path.) This is the one intentional
  `deploymentStore` change.

### 5. UI activity terminal — `src/components/project/ActivityTerminal.vue` (new)
- A **second stacked collapsible `<section>`** in the editor column (flex-child of
  `ProjectEditor.vue:1068`, immediately after `<ProblemsPanel>` ~`:1294`), with its own
  `showActivityTerminal` ref + `v-show="tab==='canvas'"` — **not** a tab (there is no
  tabbed dock). Read-only, monospace, auto-scroll, per-level coloring, source filter
  (All/Proxmox/Deploy), clear button.
- i18n: namespace **`project`** (e.g. `project.activityTerminal.*`); en/fr/jp all required.

### 6. UI — `DeleteNodeModal.vue` (new) + `ConfigPanel.vue` wiring
- Discriminators (all real on `node`): `node.type` (`'vm'`/`'lxc'`/…), `node.data.deployed`
  (bool), `node.data.vmId`, `node.data.status`, `node.id`.
- Modal branches:
  - Deployed VM/LXC (`type ∈ {'vm','lxc'} && data.deployed && data.vmId`): **Delete from
    Proxmox** (`btn-error`, default) / **Remove from canvas only** (`btn-outline`) / Cancel;
    if `data.status==='running'`, note it must be stopped first.
  - Else: single **Remove** (canvas-only).
  - **Teleports to `<body>`** above the panel; also raise `ConfirmDialog` to `z-[200]` and
    wrap its root in `<Teleport to="body">` (load-bearing fix; preserve its `FocusTrap` /
    `ConfirmDialog.a11y.test.js`). i18n the currently-hardcoded confirm strings
    (`ConfigPanel.vue:307-310,352-357`).
- `handleDelete` → opens `DeleteNodeModal`.
  - "Delete from Proxmox" → `useProxmoxTasks.launch('delete', { apiCall: () => proxmoxApi.vm.delete/lxc.delete })`.
  - "Remove from canvas only" → `emit('delete', nodeId)` (no API).
- `handleVmAction` (start/stop/pause/resume) → route through `useProxmoxTasks.launch(...)`.
  **Remove the dead `handleVmAction('delete')` branch** (`ConfigPanel.vue:305-316`,
  unreachable — no button renders it).

## Error handling

| Case | Backend | UI |
|------|---------|-----|
| Protected VMID | `VmidProtectedError` 409 | terminal `error` + toast "VMID X is protected"; node reverts |
| VM running (delete) | 409 CONFLICT | terminal `error` + toast "Stop the VM first"; node reverts |
| Task ends non-OK | poll exitstatus | terminal `error` + toast; node reverts |
| Poll timeout | — | terminal `error` "timed out"; node reverts; toast |
| No host registered | — | `ProxmoxApiError(0)` → terminal `error` + toast |
| Proxmox unreachable / auth | `PROXMOX_UNREACHABLE` / `AuthFailedError` | terminal `error` + toast |
| Canvas-only removal | (no call) | node removed; VM untouched |

## Build sequence

1. Backend: `_assert_vmid_safe` refactor + `vm_delete` + `tasks/{upid:path}/status` +
   `TaskStatus` schema + tests; deploy API.
2. UI service: `types.ts` (`VmActionResult`, `TaskStatus`), `vmDelete`, `getTaskStatus`,
   repoint `vm.delete`/`lxc.delete` (+ lxc call sites).
3. `useNodeStatus` shared helper + transitional CSS; migrate VM/LXC/Docker/ConfigPanel.
4. `activityLogStore` + `deploymentStore.onEvent` hook + bridge.
5. `useProxmoxTasks` core (launch + poll loop) wired to store + node status.
6. `DeleteNodeModal` + ConfirmDialog teleport/z-index fix; `ConfigPanel` wiring (delete +
   reroute lifecycle).
7. `ActivityTerminal` panel + i18n (en/fr/jp).

## Testing (TDD)

- **Backend** (`tests/routes/test_proxmox_vms.py` pattern — async `AsyncClient` +
  `_FakeProxmox` monkeypatch; the repo **has** pytest despite the stale CLAUDE.md note):
  `vm_delete` (happy / protected → refused, mirror `test_vm_action_guards_protected_vmids_on_destructive` / running → 409);
  `tasks/{upid}/status` (running / stopped OK / stopped error). Extend `_FakeProxmox` with a
  `tasks/{upid}/status` GET branch.
- **UI:**
  - `useProxmoxTasks`: launch → pending entry + transitional status → poll OK → success
    (delete emits removal; others confirmed status); poll error/timeout → revert + error
    (fake `getTaskStatus` + injected timer, `deploymentStore.sse.test.js` seam style).
  - `activityLogStore`: ring cap, push/update/clear, `onEvent` deploy forwarding.
  - `useNodeStatus`: status/alias/`pendingAction` → color+label+pulse mapping.
  - `DeleteNodeModal`: deployed VM shows both options; canvas-only emits delete with no API;
    undeployed/non-VM shows only canvas-only.
  - **Rewrite `configPanelVmAction.test.js`** — its `#80` assertions (status flips
    synchronously) are intentionally replaced by transitional→confirmed-on-poll; this is a
    rewrite, not just new tests.
  - `vmDelete`/`getTaskStatus` service tests (`proxmox-api-v1.test.js` style: stub fetch,
    assert v1 URL + `_resetHostCacheForTests()`).

## Deployment

- UI: commit to `dev`, redeploy `r42.admin-web-deployer-ui` (git pull on the VM).
- API: PR into `feature/gamenet-authoring-v1`, redeploy `r42.admin-web-builder-api`.
