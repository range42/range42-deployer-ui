# Proxmox Action Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Proxmox node delete + lifecycle actions destroy/track real VMs to task completion (via UPID polling), show transitional node status, and surface every action in a unified read-only activity terminal beside Problems.

**Architecture:** A new v1 backend delete endpoint and a task-status endpoint (both guarded by the protected-VMID check) replace the optimistic v0 path. A UI task core (`useProxmoxTasks`) launches an action, marks the node transitional, polls the UPID to settle, then writes the confirmed status (or reverts + errors). A session-only `activityLogStore` ring buffer is fed by the task core and by a new `deploymentStore.onEvent` bridge, and rendered by an `ActivityTerminal` panel docked beside `ProblemsPanel`. A shared `useNodeStatus` helper centralizes status→color/label/pulse mapping.

**Tech Stack:** Backend: FastAPI, httpx, pytest (`asyncio_mode=auto`), SQLAlchemy async. UI: Vue 3 `<script setup>`, Pinia composition stores, Vitest (jsdom), TypeScript + JS, vue-i18n (en/fr/jp), Tailwind v4 + DaisyUI v5.

---

## Verified facts (re-confirm before editing — code may drift further)

**Backend (`range42-backend-api`)** — v1 surface lives on `feature/gamenet-authoring-v1`; the v1 files also currently exist on the working branch.
- `app/routes/v1/proxmox/vms.py`: `vm_status_action` POST route; inline VMID guard block (`json.loads(row.protected_vmids_override_json)` → `assert_vmid_safe(vmid, host_overrides=...)` → catch `GuardVmidProtected` → raise `VmidProtectedError`) is at ~lines 123–135, gated by `if action in _DESTRUCTIVE_ACTIONS:`. `_unreachable(row, err)` helper at end. Imports include `assert_vmid_safe`, `VmidProtectedError as GuardVmidProtected`, `AuthFailedError`, `Range42Error`, `VmActionResult`, `VmSummary`, `Literal`.
- `app/schemas/v1/proxmox.py`: `VmActionResult(status="accepted", upid: str|None=None)` already exists (~line 47). Uses `from __future__ import annotations`, `BaseModel`. `Literal` is **not** yet imported here.
- `app/core/errors.py`: `VmidProtectedError` (409, `VMID_PROTECTED`), `AuthFailedError` (502, `AUTH_FAILED`), `Range42Error` base.
- `app/core/vmid_guard.py`: `assert_vmid_safe(vmid, *, host_overrides)` raises dataclass `VmidProtectedError(vmid, reason)` with `.details`.
- `app/core/models.py`: `ProxmoxHost.protected_vmids_override_json` is a nullable TEXT column holding a JSON string.
- `app/routes/vms.py` (v0): `_run_proxmox_action` uses `dict[str, Any]` at ~line 84 but the module does **not** import `Any` — latent `NameError`. v0 delete route `proxmox_vms_vm_id_delete` at ~line 291.
- Tests: `tests/routes/test_proxmox_vms.py` uses `_boot(tmp_path, monkeypatch)`, `_FakeResp`, `_FakeProxmox` (class-level `calls` list; `get`/`post`), `_create_host(c)`, `AsyncClient(transport=ASGITransport(app=app), base_url="http://t")`. `pytest.ini`: `asyncio_mode = auto`. `_FakeProxmox.post` returns `_FakeResp(200, "UPID:pve01:0000:start::")`.

**UI (`range42-deployer-ui`)** — branch `dev`.
- `src/services/proxmox/api.ts`: `request<T>(endpoint, opts)` (prefixes `baseUrl`), `getRegisteredHost()` returns `{id,node_name}` and throws `ProxmoxApiError(0, 'No Proxmox host registered…')` when none, `_resetHostCacheForTests()`, `vmStatusAction(vmId, action, vmtype='qemu')` (~266–276) POSTs to `/v1/proxmox/hosts/${id}/vms/${vmId}/status/${action}?vmtype=${vmtype}`, `del<T>(endpoint, body?)` helper, `vm.delete(request)` (v0, ~318) and `lxc.delete(node, vmId)` (v0, ~483). `ProxmoxApiError(status, message, details?)`.
- `src/services/proxmox/types.ts`: `ApiResponse<T>` has `{success, data?, error?, details?}` — **no** `upid`/`exitstatus`.
- `lxc.delete` has **zero** call sites. `vm.delete` is called only from `ConfigPanel.vue` (`handleVmAction('delete')`).
- `src/components/ConfigPanel.vue` (NOT under `project/`): `ACTION_RESULT_STATUS` map (276–283), `handleVmAction` (285–331) with dead `case 'delete'` (305–316) using `confirm()` + `proxmoxApi.vm.delete(request)`, optimistic `node.data.status` write (~322), `proxmoxCache` invalidate (~325); `handleDelete` (351–362) opens `confirm()` then `emit('delete', node.id)`; status-color block (570–582); modal root `<div class="modal modal-open">` (399, no z-index). `defineEmits(['close','update','delete','update:attachments'])`. Uses `useToast().showToast`, `useConfirmDialog().confirm`.
- `src/views/ProjectEditor.vue`: `handleDeleteNode(nodeId)` (707–713) filters nodes/edges + `closeConfigPanel()`. `ProblemsPanel` imported (line 29) and rendered at 1287–1294 with `v-if="showProblemsPanel" v-show="tab === 'canvas'"`. `showProblemsPanel = ref(true)` (~137). `tab` is a computed from route query (870–874). Editor main column is `flex-1 flex flex-col min-w-0` (~1068).
- `src/components/nodes/InfraNodeVm.vue`: `statusColor` computed (16–36) maps semantic+alias→`green/gray/orange/red/blue`; template dot classes with `animate-pulse` for orange/blue (~99,101).
- `src/components/nodes/DockerNode.vue`: dup `statusColor` (37–51).
- `src/components/nodes/InfraNodeLxc.vue`: `statusClass` computed (9–12) → `status-${status}`; dot `<div :class="status-dot ${data?.status||'gray'}">` (43), dot-only (no label).
- `src/App.vue`: `<ConfirmDialog />` (line 9). `src/components/ui/ConfirmDialog.vue`: root `<FocusTrap><div class="modal modal-open z-[100]" role="alertdialog" …>`; `a11y` test exists.
- `src/components/project/ProblemsPanel.vue`: root `<section class="problems-panel bg-base-100 border-t border-base-300" role="region">` with a `<header>` + close button emitting `@close`.
- `src/main.css`: `.status-dot` base (363–368), `.status-dot.{gray,orange,green,red,blue}` (370–374), `.status-dot.pulse` (376–383). `.infra-node.status-*` (253–271).
- `src/stores/deploymentStore.ts`: exported pure `pushRing(buffer, line, cap=LOG_RING_CAPACITY)` (131–135); exported pure `applySseEvent(record, event)` (153–269); composition `defineStore('deployment', () => {...})`, NO persistence; `SubscribeOptions` has `setTimeoutFn`/`eventSourceCtor` seams; `subscribe()` creates an `EventSource` and calls `applySseEvent` in its `onmessage`.
- `src/composables/useProxmoxStatus.ts`: `setInterval`+`onUnmounted` polling idiom.
- Tests live in `src/__tests__/`. `proxmox-api-v1.test.js` pattern: `install(handler)` swaps `globalThis.fetch` (records `[method,url]`), `beforeEach` calls `setBaseUrl('http://api')` + `_resetHostCacheForTests()`. `deploymentStore.sse.test.js`: MockEventSource + synchronous `setTimeoutFn`. `configPanelVmAction.test.js` (TO REWRITE): asserts synchronous optimistic `node.data.status` flips (#80).
- i18n: `src/locales/{en,fr,jp}/project.json` exist; `ensureNamespaces(['project'])` lazy-loads in `onMounted`. `useToast().showToast(message, type='info', duration=4000)`.

---

## File structure

**Backend (PR into `feature/gamenet-authoring-v1`)**
- Modify: `app/routes/v1/proxmox/vms.py` — extract `_assert_vmid_safe(row, vmid, action)`, add `vm_delete` DELETE route, add `task_status` GET route.
- Modify: `app/schemas/v1/proxmox.py` — add `TaskStatus`.
- Modify: `app/routes/vms.py` — add `from typing import Any` (fix latent NameError on the v0 path we are retiring from the UI).
- Modify: `tests/routes/test_proxmox_vms.py` — extend `_FakeProxmox` (DELETE + tasks-status GET), add delete + task-status tests.

**UI (commit to `dev`)**
- Modify: `src/services/proxmox/types.ts` — add `VmActionResult`, `TaskStatus`.
- Modify: `src/services/proxmox/api.ts` — add `vmDelete`, `getTaskStatus`; repoint `vm.delete`/`lxc.delete` to v1.
- Create: `src/composables/useNodeStatus.ts` — shared status→{dotColor,label,pulse} map.
- Modify: `src/main.css` — transitional status classes.
- Modify: `src/components/nodes/InfraNodeVm.vue`, `DockerNode.vue`, `InfraNodeLxc.vue`; `src/components/ConfigPanel.vue` status block — use `useNodeStatus`.
- Create: `src/stores/activityLogStore.ts` — session-only ring buffer.
- Modify: `src/stores/deploymentStore.ts` — add `onEvent(cb)` observer + fire at `applySseEvent` call site.
- Create: `src/composables/useDeploymentActivityBridge.ts` — registers deploy→activityLog forwarding.
- Create: `src/composables/useProxmoxTasks.ts` — `launch(action, {...})` + poll loop.
- Create: `src/components/DeleteNodeModal.vue` — delete confirm (Proxmox vs canvas-only).
- Modify: `src/components/ui/ConfirmDialog.vue` — teleport to body + `z-[200]`.
- Modify: `src/components/ConfigPanel.vue` — wire DeleteNodeModal + reroute lifecycle through task core; remove dead delete branch.
- Create: `src/components/project/ActivityTerminal.vue` — unified read-only feed.
- Modify: `src/views/ProjectEditor.vue` — render `ActivityTerminal` as sibling of `ProblemsPanel`; mount the deploy bridge.
- Modify: `src/locales/{en,fr,jp}/project.json` — `deleteNode.*` + `activityTerminal.*` keys.
- Rewrite: `src/__tests__/configPanelVmAction.test.js`.
- Create tests: `proxmox-api-delete-task.test.js`, `useNodeStatus.test.js`, `activityLogStore.test.js`, `useProxmoxTasks.test.js`, `DeleteNodeModal.test.js`.

---

## Task 1: Backend — `_assert_vmid_safe` refactor + `vm_delete` + `task_status` + `TaskStatus` schema

**Branch setup (do once, before any edits):**

```bash
cd /home/ppa/projects/range42-base/range42-backend-api
git switch feature/gamenet-authoring-v1
git pull --ff-only
git switch -c feature/proxmox-action-tracking
```

**Files:**
- Modify: `app/schemas/v1/proxmox.py`
- Modify: `app/routes/v1/proxmox/vms.py`
- Modify: `app/routes/vms.py`
- Test: `tests/routes/test_proxmox_vms.py`

- [ ] **Step 1: Add the `TaskStatus` schema**

In `app/schemas/v1/proxmox.py`, add `Literal` to the typing imports and append the schema after `VmActionResult`:

```python
from typing import Literal
```

```python
class TaskStatus(BaseModel):
    upid: str
    status: Literal["running", "stopped"]
    exitstatus: str | None = None
    node: str
```

- [ ] **Step 2: Write the failing test for `_assert_vmid_safe` extraction (behavior preserved)**

The existing `test_vm_action_guards_protected_vmids_on_destructive` already covers the lifecycle guard and must keep passing after extraction. Run it now to confirm the green baseline:

Run: `cd /home/ppa/projects/range42-base/range42-backend-api && source _virtenv.enable.sh 2>/dev/null; python -m pytest tests/routes/test_proxmox_vms.py -q`
Expected: PASS (baseline before refactor).

- [ ] **Step 3: Extract `_assert_vmid_safe(row, vmid, action)` and rewire `vm_status_action`**

In `app/routes/v1/proxmox/vms.py`, add a module-level helper (place it after `_auth_headers`):

```python
def _assert_vmid_safe(row: ProxmoxHost, vmid: int, action: str) -> None:
    """Refuse destructive actions on protected VMIDs (canonical ranges + per-host
    overrides). `action` only feeds the error message."""
    overrides = (
        json.loads(row.protected_vmids_override_json)
        if row.protected_vmids_override_json
        else None
    )
    try:
        assert_vmid_safe(vmid, host_overrides=overrides)
    except GuardVmidProtected as e:
        raise VmidProtectedError(
            message=f"VMID {vmid} is protected; '{action}' is refused",
            details=e.details,
        ) from e
```

Replace the inline guard block inside `vm_status_action` (the `if action in _DESTRUCTIVE_ACTIONS:` body that did `json.loads(...)` + `assert_vmid_safe` + try/except) with:

```python
    if action in _DESTRUCTIVE_ACTIONS:
        _assert_vmid_safe(row, vmid, action)
```

- [ ] **Step 4: Run the guard test to confirm behavior is preserved**

Run: `python -m pytest tests/routes/test_proxmox_vms.py::test_vm_action_guards_protected_vmids_on_destructive -q`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `vm_delete` and `task_status`**

First extend `_FakeProxmox` in `tests/routes/test_proxmox_vms.py` so it answers DELETE and the tasks-status GET. Add a `delete` method and extend `get`:

```python
    async def delete(self, url, headers=None, params=None):
        _FakeProxmox.calls.append(("DELETE", url, params))
        return _FakeResp(200, "UPID:pve01:0001:delete::")
```

Extend the existing `get` so a tasks-status URL returns a settled OK task (add this branch **before** the final `return _FakeResp(404, [])`):

```python
        if "/tasks/" in url and url.endswith("/status"):
            return _FakeResp(200, {
                "upid": "UPID:pve01:0001:delete::",
                "status": "stopped",
                "exitstatus": "OK",
                "pid": 1,
            })
```

Then add the tests:

```python
@pytest.mark.asyncio
async def test_vm_delete_happy_path(tmp_path, monkeypatch):
    app, dbmod = await _boot(tmp_path, monkeypatch)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeProxmox)
    _FakeProxmox.calls = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            hid = await _create_host(c)
            r = await c.delete(
                f"/v1/proxmox/hosts/{hid}/vms/4001?vmtype=qemu&purge=true"
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "accepted"
            assert r.json()["upid"].startswith("UPID")
            deletes = [(u, p) for (m, u, p) in _FakeProxmox.calls if m == "DELETE"]
            assert deletes, "expected a DELETE to Proxmox"
            url, params = deletes[0]
            assert url == "https://pve01:8006/api2/json/nodes/pve01/qemu/4001"
            assert params.get("purge") == 1
            assert params.get("destroy-unreferenced-disks") == 1
    finally:
        await dbmod.dispose_engine()


@pytest.mark.asyncio
async def test_vm_delete_refuses_protected_vmid(tmp_path, monkeypatch):
    app, dbmod = await _boot(tmp_path, monkeypatch)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeProxmox)
    _FakeProxmox.calls = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            hid = await _create_host(c)
            r = await c.delete(f"/v1/proxmox/hosts/{hid}/vms/100?vmtype=qemu")
            assert r.status_code == 409
            assert r.json()["code"] == "VMID_PROTECTED"
            assert [m for (m, *_) in _FakeProxmox.calls if m == "DELETE"] == []
    finally:
        await dbmod.dispose_engine()


@pytest.mark.asyncio
async def test_vm_delete_running_guest_conflict(tmp_path, monkeypatch):
    app, dbmod = await _boot(tmp_path, monkeypatch)

    class _RunningProxmox(_FakeProxmox):
        async def delete(self, url, headers=None, params=None):
            _FakeProxmox.calls.append(("DELETE", url, params))
            return _FakeResp(500, "can't remove VM 4001 - running, stop it first")

    monkeypatch.setattr(httpx, "AsyncClient", _RunningProxmox)
    _FakeProxmox.calls = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            hid = await _create_host(c)
            r = await c.delete(f"/v1/proxmox/hosts/{hid}/vms/4001?vmtype=qemu")
            assert r.status_code == 409, r.text
    finally:
        await dbmod.dispose_engine()


@pytest.mark.asyncio
async def test_task_status_stopped_ok(tmp_path, monkeypatch):
    app, dbmod = await _boot(tmp_path, monkeypatch)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeProxmox)
    _FakeProxmox.calls = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            hid = await _create_host(c)
            upid = "UPID:pve01:0001:delete::"
            r = await c.get(
                f"/v1/proxmox/hosts/{hid}/tasks/{upid}/status"
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "stopped"
            assert body["exitstatus"] == "OK"
            assert body["node"] == "pve01"
            # UPID must be percent-encoded into the outbound Proxmox URL
            gets = [u for (m, u, *_) in _FakeProxmox.calls if m == "GET"]
            assert any("/tasks/UPID%3Apve01%3A0001%3Adelete%3A%3A/status" in u for u in gets)
    finally:
        await dbmod.dispose_engine()


@pytest.mark.asyncio
async def test_task_status_stopped_error(tmp_path, monkeypatch):
    app, dbmod = await _boot(tmp_path, monkeypatch)

    class _FailedTaskProxmox(_FakeProxmox):
        async def get(self, url, headers=None):
            _FakeProxmox.calls.append(("GET", url, None))
            if "/tasks/" in url and url.endswith("/status"):
                return _FakeResp(200, {
                    "upid": "UPID:pve01:0001:delete::",
                    "status": "stopped",
                    "exitstatus": "command failed",
                    "pid": 1,
                })
            return _FakeResp(404, [])

    monkeypatch.setattr(httpx, "AsyncClient", _FailedTaskProxmox)
    _FakeProxmox.calls = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            hid = await _create_host(c)
            r = await c.get(
                f"/v1/proxmox/hosts/{hid}/tasks/UPID:pve01:0001:delete::/status"
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "stopped"
            assert r.json()["exitstatus"] == "command failed"
    finally:
        await dbmod.dispose_engine()
```

Note on `_FakeProxmox.get` signature: the existing `get(self, url, headers=None)` now also receives tasks-status URLs (the route calls `cli.get(url, headers=...)`). The `calls` tuples for GET in the base fake are `("GET", url)` (2-tuple) while DELETE pushes a 3-tuple; tests unpack with `(m, u, *_)` / `(m, *_)` to tolerate both. Update the base fake's `get` to append a 3-tuple `("GET", url, None)` for consistency, and adjust the existing list-test assertion (`any(u == ... for (_, u) in calls)`) to `for (_, u, *_) in calls`.

- [ ] **Step 6: Run the new tests to verify they fail**

Run: `python -m pytest tests/routes/test_proxmox_vms.py -q -k "delete or task_status"`
Expected: FAIL (routes `vm_delete` / `task_status` not defined → 404/405).

- [ ] **Step 7: Implement `vm_delete` and `task_status` routes**

In `app/routes/v1/proxmox/vms.py`, update imports:

```python
from urllib.parse import quote
```
```python
from app.schemas.v1.proxmox import TaskStatus, VmActionResult, VmSummary
```

Add the delete route (place after `vm_status_action`):

```python
@router.delete(
    "/hosts/{host_id}/vms/{vmid}", response_model=VmActionResult
)
async def vm_delete(
    host_id: str,
    vmid: int,
    vmtype: Literal["qemu", "lxc"] = "qemu",
    purge: bool = True,
    session: AsyncSession = Depends(_session),
):
    row = await _get_host(host_id, session)
    _assert_vmid_safe(row, vmid, "delete")
    base = row.api_url.rstrip("/")
    url = f"{base}/api2/json/nodes/{row.node_name}/{vmtype}/{vmid}"
    params: dict[str, int] = {}
    if purge:
        params["purge"] = 1
        params["destroy-unreferenced-disks"] = 1
    try:
        async with httpx.AsyncClient(verify=False, timeout=15) as cli:
            r = await cli.delete(url, headers=_auth_headers(row), params=params)
    except httpx.RequestError as e:
        raise _unreachable(row, e) from e
    if r.status_code in (401, 403):
        raise AuthFailedError(
            details=[{
                "field": "token_ref",
                "reason": f"Proxmox API rejected credentials ({r.status_code})",
            }]
        )
    if r.status_code != 200:
        text = r.text or ""
        if "running" in text.lower() or "stop it first" in text.lower():
            raise Range42Error(
                error="conflict",
                code="VM_RUNNING",
                status=409,
                message="Stop the VM before deleting",
                details=[{"field": "vmid", "reason": text[:300]}],
            )
        raise Range42Error(
            error="upstream_error",
            code="PROXMOX_ERROR",
            status=502,
            message=f"Proxmox returned {r.status_code} for delete",
            details=[{"field": "vmid", "reason": text[:300]}],
        )
    return VmActionResult(status="accepted", upid=r.json().get("data"))
```

Add the task-status route (note `{upid:path}` so colons aren't split, and `quote(..., safe='')` on the outbound URL):

```python
@router.get(
    "/hosts/{host_id}/tasks/{upid:path}/status", response_model=TaskStatus
)
async def task_status(
    host_id: str,
    upid: str,
    session: AsyncSession = Depends(_session),
):
    row = await _get_host(host_id, session)
    base = row.api_url.rstrip("/")
    enc = quote(upid, safe="")
    url = f"{base}/api2/json/nodes/{row.node_name}/tasks/{enc}/status"
    try:
        async with httpx.AsyncClient(verify=False, timeout=15) as cli:
            r = await cli.get(url, headers=_auth_headers(row))
    except httpx.RequestError as e:
        raise _unreachable(row, e) from e
    if r.status_code in (401, 403):
        raise AuthFailedError(
            details=[{
                "field": "token_ref",
                "reason": f"Proxmox API rejected credentials ({r.status_code})",
            }]
        )
    if r.status_code != 200:
        raise Range42Error(
            error="upstream_error",
            code="PROXMOX_ERROR",
            status=502,
            message=f"Proxmox returned {r.status_code} for task status",
            details=[{"field": "upid", "reason": (r.text or "")[:300]}],
        )
    data = r.json().get("data", {}) or {}
    return TaskStatus(
        upid=upid,
        status=data.get("status", "running"),
        exitstatus=data.get("exitstatus"),
        node=row.node_name,
    )
```

- [ ] **Step 8: Run all proxmox-vms tests to verify pass**

Run: `python -m pytest tests/routes/test_proxmox_vms.py -q`
Expected: PASS (all, including the preserved guard + list + action tests).

- [ ] **Step 9: Fix the latent v0 `Any` NameError (drive-by on retired path)**

In `app/routes/vms.py`, add to the typing imports at the top of the module:

```python
from typing import Any
```

(There is no `import typing`/`from typing import …` line carrying `Any` today; add it near the other stdlib imports.)

- [ ] **Step 10: Run the full backend suite**

Run: `python -m pytest -q`
Expected: PASS (no regressions). If unrelated pre-existing failures appear, confirm they exist on `feature/gamenet-authoring-v1` before this branch and note them — do not fix out of scope.

- [ ] **Step 11: Commit**

```bash
git add app/schemas/v1/proxmox.py app/routes/v1/proxmox/vms.py app/routes/vms.py tests/routes/test_proxmox_vms.py
git commit -m "feat(proxmox): add v1 VM delete + task-status endpoints with protected-VMID guard"
```

---

## Task 2: UI service layer — `types.ts` + `vmDelete` / `getTaskStatus` + repoint v0 deletes

**Files:**
- Modify: `src/services/proxmox/types.ts`
- Modify: `src/services/proxmox/api.ts`
- Test: `src/__tests__/proxmox-api-delete-task.test.js` (new)

- [ ] **Step 1: Add TS types**

In `src/services/proxmox/types.ts`, add:

```typescript
export interface VmActionResult {
  status: string
  upid?: string
}

export interface TaskStatus {
  upid: string
  status: 'running' | 'stopped'
  exitstatus?: string
  node: string
}
```

- [ ] **Step 2: Write failing service tests**

Create `src/__tests__/proxmox-api-delete-task.test.js` mirroring `proxmox-api-v1.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { vm, lxc, getTaskStatus, setBaseUrl, _resetHostCacheForTests } from '@/services/proxmox/api'

const HOSTS = [{ id: 'H1', name: 'pve01-range42', node_name: 'pve01' }]

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function install(handler) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push([opts?.method || 'GET', url])
    return handler(url, opts)
  })
  return calls
}

function defaultHandler(url) {
  if (url.endsWith('/v1/proxmox/hosts')) return jsonResp({ items: HOSTS })
  if (url.includes('/tasks/')) {
    return jsonResp({ upid: 'UPID:x', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
  }
  return jsonResp({ status: 'accepted', upid: 'UPID:x' })
}

describe('proxmox v1 delete + task status', () => {
  beforeEach(() => {
    setBaseUrl('http://api')
    _resetHostCacheForTests()
  })

  it('vm.delete issues a v1 DELETE with vmtype + purge query', async () => {
    const calls = install(defaultHandler)
    const res = await vm.delete(4001, { vmtype: 'qemu', purge: true })
    expect(res.upid).toBe('UPID:x')
    expect(calls.some(([m, u]) =>
      m === 'DELETE' && u.endsWith('/v1/proxmox/hosts/H1/vms/4001?vmtype=qemu&purge=true'),
    )).toBe(true)
  })

  it('lxc.delete issues a v1 DELETE with vmtype=lxc', async () => {
    const calls = install(defaultHandler)
    await lxc.delete(200, { vmtype: 'lxc' })
    expect(calls.some(([m, u]) =>
      m === 'DELETE' && u.endsWith('/v1/proxmox/hosts/H1/vms/200?vmtype=lxc&purge=true'),
    )).toBe(true)
  })

  it('getTaskStatus GETs the encoded UPID task-status endpoint', async () => {
    const calls = install(defaultHandler)
    const res = await getTaskStatus('UPID:pve01:0001:delete::')
    expect(res.status).toBe('stopped')
    expect(res.exitstatus).toBe('OK')
    expect(calls.some(([m, u]) =>
      m === 'GET' &&
      u.endsWith('/v1/proxmox/hosts/H1/tasks/UPID%3Apve01%3A0001%3Adelete%3A%3A/status'),
    )).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/ppa/projects/range42-base/range42-deployer-ui && npx vitest run src/__tests__/proxmox-api-delete-task.test.js`
Expected: FAIL (`getTaskStatus` not exported; `vm.delete`/`lxc.delete` still hit v0).

- [ ] **Step 4: Implement `vmDelete`, `getTaskStatus`, and repoint deletes**

In `src/services/proxmox/api.ts`:

Import the new types where `ApiResponse` etc. are imported:

```typescript
import type { ApiResponse, TaskStatus, VmActionResult } from './types'
```
(merge into the existing type import rather than duplicating).

Add the two functions near `vmStatusAction`:

```typescript
async function vmDelete(
  vmId: number | string,
  options: { vmtype?: 'qemu' | 'lxc'; purge?: boolean } = {},
): Promise<VmActionResult> {
  const { vmtype = 'qemu', purge = true } = options
  const { id } = await getRegisteredHost()
  return request<VmActionResult>(
    `/v1/proxmox/hosts/${id}/vms/${vmId}?vmtype=${vmtype}&purge=${purge}`,
    { method: 'DELETE' },
  )
}

export async function getTaskStatus(upid: string): Promise<TaskStatus> {
  const { id } = await getRegisteredHost()
  return request<TaskStatus>(
    `/v1/proxmox/hosts/${id}/tasks/${encodeURIComponent(upid)}/status`,
    { method: 'GET' },
  )
}
```

Repoint `vm.delete` (currently `delete(request) → del('/v0/...')`):

```typescript
  async delete(
    vmId: number | string,
    options: { vmtype?: 'qemu' | 'lxc'; purge?: boolean } = {},
  ): Promise<VmActionResult> {
    return vmDelete(vmId, { vmtype: 'qemu', ...options })
  },
```

Repoint `lxc.delete` (was `(node, vmId)`):

```typescript
  async delete(
    vmId: number | string,
    options: { purge?: boolean } = {},
  ): Promise<VmActionResult> {
    return vmDelete(vmId, { vmtype: 'lxc', ...options })
  },
```

Ensure `getTaskStatus` is exported from the module's public surface the same way other functions are (it is `export`ed above; if the file uses a barrel `index.ts` re-export, add it there too — check `src/services/proxmox/index.ts`).

- [ ] **Step 5: Run service tests to verify pass**

Run: `npx vitest run src/__tests__/proxmox-api-delete-task.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/proxmox/types.ts src/services/proxmox/api.ts src/__tests__/proxmox-api-delete-task.test.js
git commit -m "feat(proxmox): v1 vmDelete + getTaskStatus service calls, repoint vm/lxc delete"
```

---

## Task 3: Shared `useNodeStatus` helper + transitional CSS + migrate VM/LXC/Docker/ConfigPanel

**Files:**
- Create: `src/composables/useNodeStatus.ts`
- Modify: `src/main.css`
- Modify: `src/components/nodes/InfraNodeVm.vue`, `DockerNode.vue`, `InfraNodeLxc.vue`, `src/components/ConfigPanel.vue`
- Test: `src/__tests__/useNodeStatus.test.js` (new)

- [ ] **Step 1: Write failing test for `useNodeStatus`**

Create `src/__tests__/useNodeStatus.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

describe('resolveNodeStatus', () => {
  it('maps semantic statuses', () => {
    expect(resolveNodeStatus('running').dotColor).toBe('green')
    expect(resolveNodeStatus('stopped').dotColor).toBe('gray')
    expect(resolveNodeStatus('paused').dotColor).toBe('orange')
    expect(resolveNodeStatus('error').dotColor).toBe('red')
    expect(resolveNodeStatus('deploying').dotColor).toBe('blue')
  })

  it('maps color aliases', () => {
    expect(resolveNodeStatus('green').dotColor).toBe('green')
    expect(resolveNodeStatus('red').dotColor).toBe('red')
    expect(resolveNodeStatus(undefined).dotColor).toBe('gray')
  })

  it('pendingAction overrides with transitional color + label + pulse', () => {
    const del = resolveNodeStatus('stopped', 'delete')
    expect(del.dotColor).toBe('red')
    expect(del.label).toBe('deleting')
    expect(del.pulse).toBe(true)

    expect(resolveNodeStatus('running', 'stop').dotColor).toBe('orange')
    expect(resolveNodeStatus('running', 'stop').pulse).toBe(true)
    expect(resolveNodeStatus('stopped', 'start').dotColor).toBe('blue')
    expect(resolveNodeStatus('paused', 'resume').dotColor).toBe('blue')
  })

  it('error is steady (no pulse), deleting pulses to disambiguate from error', () => {
    expect(resolveNodeStatus('error').pulse).toBe(false)
    expect(resolveNodeStatus('stopped', 'delete').pulse).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/useNodeStatus.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `useNodeStatus.ts`**

Create `src/composables/useNodeStatus.ts`:

```typescript
import { computed, type Ref, unref } from 'vue'

export type DotColor = 'green' | 'gray' | 'orange' | 'red' | 'blue'

export interface NodeStatusView {
  dotColor: DotColor
  label: string
  pulse: boolean
}

const STATUS_TO_COLOR: Record<string, DotColor> = {
  running: 'green', green: 'green',
  stopped: 'gray', gray: 'gray',
  paused: 'orange', orange: 'orange',
  error: 'red', red: 'red',
  deploying: 'blue', blue: 'blue',
}

// pendingAction → transitional view. `red`/deleting pulses so it is distinct
// from the steady `error` red.
const PENDING: Record<string, { dotColor: DotColor; label: string }> = {
  delete: { dotColor: 'red', label: 'deleting' },
  stop: { dotColor: 'orange', label: 'stopping' },
  'force-stop': { dotColor: 'orange', label: 'stopping' },
  pause: { dotColor: 'orange', label: 'pausing' },
  start: { dotColor: 'blue', label: 'starting' },
  resume: { dotColor: 'blue', label: 'resuming' },
  restart: { dotColor: 'blue', label: 'restarting' },
}

export function resolveNodeStatus(
  status: string | undefined | null,
  pendingAction?: string | null,
): NodeStatusView {
  if (pendingAction && PENDING[pendingAction]) {
    const p = PENDING[pendingAction]
    return { dotColor: p.dotColor, label: p.label, pulse: true }
  }
  const dotColor = STATUS_TO_COLOR[status ?? ''] ?? 'gray'
  return { dotColor, label: status ?? 'unknown', pulse: false }
}

/** Reactive wrapper for use inside `<script setup>`. */
export function useNodeStatus(
  status: Ref<string | undefined> | (() => string | undefined),
  pendingAction?: Ref<string | undefined> | (() => string | undefined),
) {
  return computed(() =>
    resolveNodeStatus(
      typeof status === 'function' ? status() : unref(status),
      pendingAction
        ? typeof pendingAction === 'function'
          ? pendingAction()
          : unref(pendingAction)
        : undefined,
    ),
  )
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/useNodeStatus.test.js`
Expected: PASS.

- [ ] **Step 5: Add transitional CSS**

In `src/main.css`, after the `.status-dot.blue` line (~374), add color classes for the transitional/amber-blue dots reused by the dot rendering. The existing `.status-dot.pulse` already handles the pulse animation — keep it. Add a deleting-red alias and ensure amber/blue exist as dot colors:

```css
/* transitional action dots (pendingAction) */
.status-dot.amber { background: #f59e0b; }
.status-dot.deleting { background: #ef4444; }
```

(The mapping returns `orange`/`blue`/`red`/`green`/`gray` which already have classes; `amber`/`deleting` are only needed if a component renders the literal label as a class. Components below render by `dotColor` which is one of the existing five, so this block is defensive — include it so future label-based styling has a hook.)

- [ ] **Step 6: Migrate `InfraNodeVm.vue` to the helper**

Replace the local `statusColor` computed (16–36) with:

```javascript
import { computed } from 'vue'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

const statusView = computed(() =>
  resolveNodeStatus(props.data?.status, props.data?.pendingAction),
)
const statusColor = computed(() => statusView.value.dotColor)
```

In the template, keep the existing dot class bindings keyed on `statusColor` (green/gray/orange/red/blue), but drive the pulse from `statusView.value.pulse` so transitional states pulse. Where the template currently hard-codes `animate-pulse` only for orange/blue, change to:

```html
:class="{
  'bg-success shadow-[0_0_6px_theme(colors.success)]': statusColor === 'green',
  'bg-base-content/30': statusColor === 'gray',
  'bg-warning shadow-[0_0_6px_theme(colors.warning)]': statusColor === 'orange',
  'bg-error shadow-[0_0_6px_theme(colors.error)]': statusColor === 'red',
  'bg-info shadow-[0_0_6px_theme(colors.info)]': statusColor === 'blue',
  'animate-pulse': statusView.pulse,
}"
```

Add a small transitional label next to the node when `props.data?.pendingAction` is set:

```html
<span v-if="data?.pendingAction" class="text-[10px] opacity-70 capitalize">{{ statusView.label }}</span>
```

- [ ] **Step 7: Migrate `DockerNode.vue`**

Replace the dup `statusColor` (37–51) with the same `resolveNodeStatus` import + `statusView`/`statusColor` computeds from Step 6, and apply the same `animate-pulse: statusView.pulse` template change.

- [ ] **Step 8: Migrate `InfraNodeLxc.vue` (add a label)**

Replace `statusClass` (9–12) with:

```javascript
import { computed } from 'vue'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

const statusView = computed(() =>
  resolveNodeStatus(props.data?.status, props.data?.pendingAction),
)
```

Change the dot (line 43) to drive off `statusView.dotColor` and pulse, and add the label:

```html
<div :class="['status-dot', statusView.dotColor, { pulse: statusView.pulse }]"></div>
<span v-if="data?.pendingAction" class="text-[10px] opacity-70 capitalize">{{ statusView.label }}</span>
```

- [ ] **Step 9: Migrate the ConfigPanel status block**

In `src/components/ConfigPanel.vue`, replace the status-color block (570–582) with helper-driven rendering. Add to `<script setup>`:

```javascript
import { resolveNodeStatus } from '@/composables/useNodeStatus'
const statusView = computed(() =>
  resolveNodeStatus(props.node.data?.status, props.node.data?.pendingAction),
)
```

Template:

```html
<div class="flex items-center gap-2 mb-2">
  <div
    class="w-2.5 h-2.5 rounded-full"
    :class="{
      'bg-success': statusView.dotColor === 'green',
      'bg-error': statusView.dotColor === 'red',
      'bg-warning': statusView.dotColor === 'orange',
      'bg-info': statusView.dotColor === 'blue',
      'bg-base-content/30': statusView.dotColor === 'gray',
      'animate-pulse': statusView.pulse,
    }"
  ></div>
  <span class="text-sm font-medium capitalize">{{ statusView.label }}</span>
  <span v-if="node.data.vmId" class="text-xs text-base-content/50 ml-auto">VMID {{ node.data.vmId }}</span>
</div>
```

- [ ] **Step 10: Run the node/config tests + lint**

Run: `npx vitest run src/__tests__/useNodeStatus.test.js && npm run lint`
Expected: PASS / no lint errors on touched files.

- [ ] **Step 11: Commit**

```bash
git add src/composables/useNodeStatus.ts src/main.css src/components/nodes/InfraNodeVm.vue src/components/nodes/DockerNode.vue src/components/nodes/InfraNodeLxc.vue src/components/ConfigPanel.vue src/__tests__/useNodeStatus.test.js
git commit -m "feat(canvas): shared useNodeStatus helper with transitional states; migrate VM/LXC/Docker/ConfigPanel"
```

---

## Task 4: `activityLogStore` + `deploymentStore.onEvent` hook + deploy bridge

**Files:**
- Create: `src/stores/activityLogStore.ts`
- Modify: `src/stores/deploymentStore.ts`
- Create: `src/composables/useDeploymentActivityBridge.ts`
- Test: `src/__tests__/activityLogStore.test.js` (new)

- [ ] **Step 1: Write failing test for the store**

Create `src/__tests__/activityLogStore.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useActivityLogStore } from '@/stores/activityLogStore'

describe('activityLogStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('push adds an entry and returns its id', () => {
    const s = useActivityLogStore()
    const id = s.push({ source: 'proxmox', level: 'pending', target: 'vm-1', message: 'deleting' })
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0].id).toBe(id)
    expect(s.entries[0].ts).toBeTypeOf('number')
  })

  it('update patches an existing entry by id', () => {
    const s = useActivityLogStore()
    const id = s.push({ source: 'proxmox', level: 'pending', target: 'vm-1', message: 'deleting' })
    s.update(id, { level: 'success', message: 'deleted' })
    expect(s.entries[0].level).toBe('success')
    expect(s.entries[0].message).toBe('deleted')
  })

  it('ring buffer caps at 500', () => {
    const s = useActivityLogStore()
    for (let i = 0; i < 520; i++) {
      s.push({ source: 'proxmox', level: 'info', target: `t${i}`, message: `m${i}` })
    }
    expect(s.entries.length).toBe(500)
    expect(s.entries[s.entries.length - 1].message).toBe('m519')
  })

  it('clear empties the buffer', () => {
    const s = useActivityLogStore()
    s.push({ source: 'deploy', level: 'info', target: 'x', message: 'y' })
    s.clear()
    expect(s.entries).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/activityLogStore.test.js`
Expected: FAIL (store not found).

- [ ] **Step 3: Implement `activityLogStore.ts`**

Create `src/stores/activityLogStore.ts`:

```typescript
import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ActivitySource = 'proxmox' | 'deploy'
export type ActivityLevel = 'pending' | 'success' | 'error' | 'info'

export interface ActivityEntry {
  id: string
  ts: number
  source: ActivitySource
  level: ActivityLevel
  target: string
  message: string
  upid?: string
}

const RING_CAP = 500
let _seq = 0

export const useActivityLogStore = defineStore('activityLog', () => {
  const entries = ref<ActivityEntry[]>([])

  function push(entry: Omit<ActivityEntry, 'id' | 'ts'>): string {
    const id = `a${++_seq}`
    entries.value.push({ ...entry, id, ts: Date.now() })
    if (entries.value.length > RING_CAP) {
      entries.value.splice(0, entries.value.length - RING_CAP)
    }
    return id
  }

  function update(id: string, patch: Partial<Omit<ActivityEntry, 'id'>>): void {
    const e = entries.value.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }

  function clear(): void {
    entries.value = []
  }

  return { entries, push, update, clear }
})
```

- [ ] **Step 4: Run store test to verify pass**

Run: `npx vitest run src/__tests__/activityLogStore.test.js`
Expected: PASS.

- [ ] **Step 5: Add `onEvent(cb)` to `deploymentStore` and fire it at the `applySseEvent` call site**

In `src/stores/deploymentStore.ts`, inside `defineStore('deployment', () => {...})`, add an observer registry near the other state:

```typescript
  const _eventObservers = new Set<(deploymentId: string, event: unknown) => void>()

  function onEvent(cb: (deploymentId: string, event: unknown) => void): () => void {
    _eventObservers.add(cb)
    return () => _eventObservers.delete(cb)
  }
```

Locate where `applySseEvent(record, event)` is invoked inside `subscribe()` (the `EventSource` `onmessage` handler). Immediately after the `applySseEvent(...)` call, notify observers with the deployment id and the parsed event:

```typescript
      applySseEvent(record, event)
      _eventObservers.forEach((cb) => cb(deploymentId, event))
```

Add `onEvent` to the store's `return { ... }`. (Rationale: `applySseEvent` is a pure, separately-unit-tested function; firing observers at its call site keeps that purity and its existing tests untouched.)

- [ ] **Step 6: Implement the deploy bridge**

Create `src/composables/useDeploymentActivityBridge.ts`:

```typescript
import { onUnmounted } from 'vue'
import { useDeploymentStore } from '@/stores/deploymentStore'
import { useActivityLogStore } from '@/stores/activityLogStore'

type SseEventLike = { type?: string; payload?: Record<string, unknown> } | undefined

function levelFor(type: string | undefined): 'error' | 'success' | 'info' {
  if (type === 'error' || type === 'failed') return 'error'
  if (type === 'completed' || type === 'succeeded') return 'success'
  return 'info'
}

function messageFor(event: SseEventLike): string {
  if (!event) return ''
  const p = event.payload || {}
  return (p.message as string) || (p.line as string) || (event.type ?? 'event')
}

/** Forwards deploymentStore SSE events into the unified activity log. */
export function useDeploymentActivityBridge() {
  const deployment = useDeploymentStore()
  const log = useActivityLogStore()

  const off = deployment.onEvent((deploymentId, raw) => {
    const event = raw as SseEventLike
    log.push({
      source: 'deploy',
      level: levelFor(event?.type),
      target: deploymentId,
      message: messageFor(event),
    })
  })

  onUnmounted(off)
  return { off }
}
```

(Adapt `levelFor`/`messageFor` field names if the SSE event shape in `applySseEvent` differs — check the `SseEvent` type the store dispatches. Keep it total: never throw on an unexpected shape.)

- [ ] **Step 7: Add a bridge-forwarding test**

Append to `src/__tests__/activityLogStore.test.js` (or a new `deploymentActivityBridge.test.js`) — verify `onEvent` forwards. Since `onEvent` lives on the store, test the bridge by registering then invoking the store's observers via a real emitted event is integration-heavy; instead unit-test the bridge mapping by mocking `deploymentStore.onEvent`:

```javascript
import { vi } from 'vitest'

it('bridge forwards deploy events into the activity log', async () => {
  setActivePinia(createPinia())
  const { useDeploymentActivityBridge } = await import('@/composables/useDeploymentActivityBridge')
  const { useActivityLogStore } = await import('@/stores/activityLogStore')
  const { useDeploymentStore } = await import('@/stores/deploymentStore')

  const store = useDeploymentStore()
  let captured = null
  vi.spyOn(store, 'onEvent').mockImplementation((cb) => { captured = cb; return () => {} })

  useDeploymentActivityBridge()
  captured('dep-1', { type: 'log', payload: { line: 'hello' } })

  const log = useActivityLogStore()
  expect(log.entries.at(-1)).toMatchObject({ source: 'deploy', message: 'hello', target: 'dep-1' })
})
```

(Calling a composable that uses `onUnmounted` outside a component triggers a Vue warning but works; if it errors, wrap with `@vue/test-utils` `withSetup` or mount a trivial component. Prefer the simplest form that passes.)

- [ ] **Step 8: Run tests + lint**

Run: `npx vitest run src/__tests__/activityLogStore.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/stores/activityLogStore.ts src/stores/deploymentStore.ts src/composables/useDeploymentActivityBridge.ts src/__tests__/activityLogStore.test.js
git commit -m "feat(activity): session-only activityLogStore + deploymentStore.onEvent bridge"
```

---

## Task 5: `useProxmoxTasks` core (launch + poll loop)

**Files:**
- Create: `src/composables/useProxmoxTasks.ts`
- Test: `src/__tests__/useProxmoxTasks.test.js` (new)

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/useProxmoxTasks.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { getTaskStatus } = vi.hoisted(() => ({ getTaskStatus: vi.fn() }))
vi.mock('@/services/proxmox/api', () => ({ getTaskStatus }))
vi.mock('@/services/proxmox/cache', () => ({ proxmoxCache: { invalidate: vi.fn() } }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { useProxmoxTasks } from '@/composables/useProxmoxTasks'
import { useActivityLogStore } from '@/stores/activityLogStore'

function makeNode(status = 'stopped') {
  return { id: 'n1', type: 'vm', data: { status, vmId: 4001, deployed: true } }
}

// Synchronous fake timer: fires the callback immediately.
const immediateTimeout = (cb) => { cb(); return 0 }

describe('useProxmoxTasks.launch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getTaskStatus.mockReset()
  })

  it('pending → transitional status → poll OK → confirmed status', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })

    let confirmed = null
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: () => { confirmed = 'stopped'; node.data.status = 'stopped' },
    })

    expect(confirmed).toBe('stopped')
    expect(node.data.pendingAction).toBeFalsy()
    expect(node.data.status).toBe('stopped')
    expect(log.entries.some((e) => e.level === 'success')).toBe(true)
  })

  it('delete OK calls onSuccess (node removal) and logs success', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
    const node = makeNode('stopped')
    const removed = vi.fn()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('delete', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: removed,
    })
    expect(removed).toHaveBeenCalledOnce()
  })

  it('poll error reverts node + logs error', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'command failed', node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: vi.fn(),
    })
    expect(node.data.status).toBe('running') // reverted
    expect(node.data.pendingAction).toBeFalsy()
    expect(log.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('apiCall throwing (e.g. no host) logs error, no poll', async () => {
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => { throw new Error('No Proxmox host registered.') },
      onSuccess: vi.fn(),
    })
    expect(getTaskStatus).not.toHaveBeenCalled()
    expect(node.data.pendingAction).toBeFalsy()
    expect(log.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('timeout (always running) reverts + logs error', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'running', exitstatus: null, node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout, maxPolls: 3 })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: vi.fn(),
    })
    expect(node.data.status).toBe('running')
    expect(log.entries.some((e) => e.level === 'error' && /tim/i.test(e.message))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/useProxmoxTasks.test.js`
Expected: FAIL (composable not found).

- [ ] **Step 3: Implement `useProxmoxTasks.ts`**

Create `src/composables/useProxmoxTasks.ts`:

```typescript
import { getTaskStatus } from '@/services/proxmox/api'
import { proxmoxCache } from '@/services/proxmox/cache'
import { useActivityLogStore } from '@/stores/activityLogStore'
import { useToast } from '@/composables/useToast'

type TimeoutFn = (handler: () => void, ms: number) => unknown

export interface LaunchOptions {
  node: { id: string; type?: string; data: Record<string, unknown> }
  vmId: number | string
  vmtype: 'qemu' | 'lxc'
  apiCall: () => Promise<{ upid?: string }>
  onSuccess: () => void
}

export interface ProxmoxTasksOptions {
  setTimeoutFn?: TimeoutFn
  pollIntervalMs?: number
  maxPolls?: number
}

// confirmed status to write on success for non-delete actions
const CONFIRMED_STATUS: Record<string, string> = {
  start: 'running',
  resume: 'running',
  restart: 'running',
  stop: 'stopped',
  'force-stop': 'stopped',
  pause: 'paused',
}

export function useProxmoxTasks(opts: ProxmoxTasksOptions = {}) {
  const log = useActivityLogStore()
  const { showToast } = useToast()
  const setTimeoutFn: TimeoutFn = opts.setTimeoutFn ?? ((h, ms) => setTimeout(h, ms))
  const pollIntervalMs = opts.pollIntervalMs ?? 1500
  const maxPolls = opts.maxPolls ?? 80 // ~120s at 1.5s

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeoutFn(() => resolve(), ms))
  }

  async function launch(action: string, o: LaunchOptions): Promise<void> {
    const prevStatus = o.node.data.status as string | undefined
    const entryId = log.push({
      source: 'proxmox',
      level: 'pending',
      target: (o.node.data.name as string) || String(o.vmId),
      message: `${action} requested`,
    })
    o.node.data.pendingAction = action

    let upid: string | undefined
    try {
      const res = await o.apiCall()
      upid = res?.upid
    } catch (err) {
      o.node.data.pendingAction = undefined
      const msg = err instanceof Error ? err.message : String(err)
      log.update(entryId, { level: 'error', message: msg })
      showToast(msg, 'error')
      return
    }

    if (!upid) {
      // No task to track (shouldn't happen for these actions) — treat as done.
      finishSuccess(action, o, entryId)
      return
    }
    log.update(entryId, { upid })

    let settled = false
    for (let i = 0; i < maxPolls; i++) {
      await delay(pollIntervalMs)
      let ts
      try {
        ts = await getTaskStatus(upid)
      } catch (err) {
        continue // transient; keep polling until maxPolls
      }
      if (ts.status === 'stopped') {
        settled = true
        if (ts.exitstatus === 'OK') {
          finishSuccess(action, o, entryId)
        } else {
          revert(o, prevStatus)
          const msg = ts.exitstatus || 'task failed'
          log.update(entryId, { level: 'error', message: msg })
          showToast(`${action} failed: ${msg}`, 'error')
        }
        break
      }
    }

    if (!settled) {
      revert(o, prevStatus)
      log.update(entryId, { level: 'error', message: `${action} timed out` })
      showToast(`${action} timed out`, 'error')
    }
  }

  function finishSuccess(action: string, o: LaunchOptions, entryId: string): void {
    o.node.data.pendingAction = undefined
    if (action === 'delete') {
      log.update(entryId, { level: 'success', message: 'deleted from Proxmox' })
      o.onSuccess()
    } else {
      const confirmed = CONFIRMED_STATUS[action]
      if (confirmed) o.node.data.status = confirmed
      log.update(entryId, { level: 'success', message: `${action} confirmed` })
      o.onSuccess()
    }
    proxmoxCache.invalidate()
  }

  function revert(o: LaunchOptions, prevStatus: string | undefined): void {
    o.node.data.pendingAction = undefined
    o.node.data.status = prevStatus
  }

  return { launch }
}
```

Note: confirm `src/services/proxmox/cache.ts` exports `proxmoxCache` with `invalidate()` (the existing ConfigPanel test mocks `@/services/proxmox/cache`). Adjust the import path/shape to match the real module if different.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/__tests__/useProxmoxTasks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useProxmoxTasks.ts src/__tests__/useProxmoxTasks.test.js
git commit -m "feat(proxmox): useProxmoxTasks core — launch + UPID poll-to-completion with transitional status"
```

---

## Task 6: `DeleteNodeModal` + ConfirmDialog teleport/z-index fix + ConfigPanel wiring

**Files:**
- Create: `src/components/DeleteNodeModal.vue`
- Modify: `src/components/ui/ConfirmDialog.vue`
- Modify: `src/components/ConfigPanel.vue`
- Modify: `src/locales/{en,fr,jp}/project.json`
- Test: `src/__tests__/DeleteNodeModal.test.js` (new); rewrite `src/__tests__/configPanelVmAction.test.js`

- [ ] **Step 1: Add i18n keys (en/fr/jp) for `deleteNode`**

In `src/locales/en/project.json` add a `deleteNode` object (place alongside existing top-level keys):

```json
"deleteNode": {
  "title": "Delete node",
  "promptProxmox": "Delete \"{name}\" — what should happen on Proxmox?",
  "promptCanvas": "Remove \"{name}\" from the canvas?",
  "deleteFromProxmox": "Delete from Proxmox",
  "removeCanvasOnly": "Remove from canvas only",
  "cancel": "Cancel",
  "remove": "Remove",
  "mustStopFirst": "This VM is running — stop it before deleting from Proxmox.",
  "destroyWarning": "This permanently destroys the VM and its disks."
}
```

`src/locales/fr/project.json`:

```json
"deleteNode": {
  "title": "Supprimer le nœud",
  "promptProxmox": "Supprimer « {name} » — que faire sur Proxmox ?",
  "promptCanvas": "Retirer « {name} » du canevas ?",
  "deleteFromProxmox": "Supprimer de Proxmox",
  "removeCanvasOnly": "Retirer du canevas uniquement",
  "cancel": "Annuler",
  "remove": "Retirer",
  "mustStopFirst": "Cette VM est en cours d'exécution — arrêtez-la avant de la supprimer de Proxmox.",
  "destroyWarning": "Ceci détruit définitivement la VM et ses disques."
}
```

`src/locales/jp/project.json`:

```json
"deleteNode": {
  "title": "ノードを削除",
  "promptProxmox": "「{name}」を削除します — Proxmox 上でどうしますか？",
  "promptCanvas": "「{name}」をキャンバスから削除しますか？",
  "deleteFromProxmox": "Proxmox から削除",
  "removeCanvasOnly": "キャンバスからのみ削除",
  "cancel": "キャンセル",
  "remove": "削除",
  "mustStopFirst": "この VM は実行中です。Proxmox から削除する前に停止してください。",
  "destroyWarning": "VM とそのディスクを完全に破棄します。"
}
```

- [ ] **Step 2: Write failing test for `DeleteNodeModal`**

Create `src/__tests__/DeleteNodeModal.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DeleteNodeModal from '@/components/DeleteNodeModal.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: { en: { project: {
      deleteNode: {
        title: 'Delete node', promptProxmox: 'Delete "{name}"?', promptCanvas: 'Remove "{name}"?',
        deleteFromProxmox: 'Delete from Proxmox', removeCanvasOnly: 'Remove from canvas only',
        cancel: 'Cancel', remove: 'Remove', mustStopFirst: 'Stop it first', destroyWarning: 'destroys disks',
      },
    } } },
  })
}

function mountModal(node) {
  return mount(DeleteNodeModal, {
    props: { open: true, node },
    global: { plugins: [makeI18n()], stubs: { Teleport: true } },
  })
}

const deployedVm = { id: 'n1', type: 'vm', data: { deployed: true, vmId: 4001, status: 'stopped', name: 'box' } }
const undeployed = { id: 'n2', type: 'vm', data: { deployed: false, name: 'draft' } }
const network = { id: 'n3', type: 'network', data: { name: 'lan' } }

describe('DeleteNodeModal', () => {
  it('deployed VM shows both Proxmox + canvas-only options', () => {
    const w = mountModal(deployedVm)
    expect(w.text()).toContain('Delete from Proxmox')
    expect(w.text()).toContain('Remove from canvas only')
  })

  it('emits deleteProxmox when Proxmox option chosen', async () => {
    const w = mountModal(deployedVm)
    await w.find('[data-testid="delete-proxmox"]').trigger('click')
    expect(w.emitted('deleteProxmox')).toBeTruthy()
  })

  it('canvas-only emits removeCanvas with no proxmox emit', async () => {
    const w = mountModal(deployedVm)
    await w.find('[data-testid="remove-canvas"]').trigger('click')
    expect(w.emitted('removeCanvas')).toBeTruthy()
    expect(w.emitted('deleteProxmox')).toBeFalsy()
  })

  it('undeployed / non-VM shows only canvas-only Remove', () => {
    expect(mountModal(undeployed).find('[data-testid="delete-proxmox"]').exists()).toBe(false)
    expect(mountModal(network).find('[data-testid="delete-proxmox"]').exists()).toBe(false)
    expect(mountModal(undeployed).find('[data-testid="remove-canvas"]').exists()).toBe(true)
  })

  it('running deployed VM shows stop-first note', () => {
    const running = { id: 'n4', type: 'vm', data: { deployed: true, vmId: 5, status: 'running', name: 'r' } }
    expect(mountModal(running).text()).toContain('Stop it first')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/__tests__/DeleteNodeModal.test.js`
Expected: FAIL (component not found).

- [ ] **Step 4: Implement `DeleteNodeModal.vue`**

Create `src/components/DeleteNodeModal.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  open: { type: Boolean, default: false },
  node: { type: Object, required: true },
})
const emit = defineEmits(['deleteProxmox', 'removeCanvas', 'cancel'])
const { t } = useI18n()

const name = computed(() => props.node?.data?.name || props.node?.type || 'node')
const canProxmoxDelete = computed(() => {
  const n = props.node
  return ['vm', 'lxc'].includes(n?.type) && n?.data?.deployed === true && n?.data?.vmId != null
})
const isRunning = computed(() => props.node?.data?.status === 'running')
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal modal-open z-[200]" role="dialog" aria-modal="true">
      <div class="modal-box">
        <h3 class="font-semibold text-lg">{{ t('project.deleteNode.title') }}</h3>
        <p class="py-2 text-sm">
          {{ canProxmoxDelete ? t('project.deleteNode.promptProxmox', { name }) : t('project.deleteNode.promptCanvas', { name }) }}
        </p>
        <p v-if="canProxmoxDelete" class="text-xs opacity-70">{{ t('project.deleteNode.destroyWarning') }}</p>
        <p v-if="canProxmoxDelete && isRunning" class="text-xs text-warning mt-1">
          {{ t('project.deleteNode.mustStopFirst') }}
        </p>
        <div class="modal-action flex-wrap gap-2">
          <button
            v-if="canProxmoxDelete"
            class="btn btn-error"
            data-testid="delete-proxmox"
            :disabled="isRunning"
            @click="emit('deleteProxmox')"
          >{{ t('project.deleteNode.deleteFromProxmox') }}</button>
          <button
            class="btn btn-outline"
            data-testid="remove-canvas"
            @click="emit('removeCanvas')"
          >{{ canProxmoxDelete ? t('project.deleteNode.removeCanvasOnly') : t('project.deleteNode.remove') }}</button>
          <button class="btn btn-ghost" data-testid="cancel" @click="emit('cancel')">
            {{ t('project.deleteNode.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

(The test stubs `Teleport`, so its slot content renders inline for assertions.)

- [ ] **Step 5: Run DeleteNodeModal test to verify pass**

Run: `npx vitest run src/__tests__/DeleteNodeModal.test.js`
Expected: PASS.

- [ ] **Step 6: Fix ConfirmDialog z-index + teleport (load-bearing dialog bug)**

In `src/components/ui/ConfirmDialog.vue`, wrap the existing `<FocusTrap>…</FocusTrap>` root in `<Teleport to="body">` and bump `z-[100]` → `z-[200]`:

```vue
<template>
  <Teleport to="body">
    <FocusTrap v-if="visible" :active="visible" :initial-focus="() => confirmBtn">
      <div
        class="modal modal-open z-[200]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        @keydown="onKeydown"
      >
        <!-- existing modal-box content unchanged -->
      </div>
    </FocusTrap>
  </Teleport>
</template>
```

Preserve all existing script (FocusTrap import, `confirmBtn`, `visible`, focus restore watcher). Run the a11y test to confirm no regression:

Run: `npx vitest run src/__tests__/ConfirmDialog.a11y.test.js`
Expected: PASS. (If the a11y test queries the DOM and Teleport-to-body breaks the query, stub `Teleport` in that test's mount or assert against `document.body` — adjust the test minimally, keeping its FocusTrap assertions.)

- [ ] **Step 7: Rewrite `configPanelVmAction.test.js` for transitional→confirmed behavior**

Replace the file contents. The new suite asserts that `handleVmAction` routes through `useProxmoxTasks.launch` (no synchronous optimistic flip). Mock `useProxmoxTasks` so `launch` is observable, and `getTaskStatus`/cache as needed:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

const { launch } = vi.hoisted(() => ({ launch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/composables/useProxmoxTasks', () => ({ useProxmoxTasks: () => ({ launch }) }))
vi.mock('@/services/proxmox', () => ({
  proxmoxApi: { vm: { delete: vi.fn() }, lxc: { delete: vi.fn() }, storage: { list: vi.fn().mockResolvedValue([]) } },
  proxmoxCache: { invalidate: vi.fn() },
}))
vi.mock('@/services/proxmox/cache', () => ({ proxmoxCache: { invalidate: vi.fn() } }))
vi.mock('@/services/proxmox/api', () => ({ getBaseUrl: () => 'http://127.0.0.1:8000', getTaskStatus: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
vi.mock('@/composables/useTagSync', () => ({ useTagSync: () => ({ syncTags: vi.fn() }) }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))

import ConfigPanel from '@/components/ConfigPanel.vue'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
}
function makeDeployedVmNode(status) {
  return { id: 'n1', type: 'vm', data: { deployed: true, vmId: 4001, status, name: 'box' } }
}
function mountPanel(node) {
  return mount(ConfigPanel, {
    props: { node },
    global: {
      plugins: [makeI18n()],
      stubs: {
        NodeAttachmentsSection: true, ApplyChangesDialog: true, AppIcon: true,
        FormField: true, FormSection: true, FormDivider: true, FormList: true,
        DeleteNodeModal: true, Teleport: true,
      },
    },
  })
}

describe('ConfigPanel — lifecycle actions route through task core (no optimistic flip)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('stop → calls launch("stop", …) and does NOT synchronously set status', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('stop')
    await flushPromises()
    expect(launch).toHaveBeenCalledOnce()
    expect(launch.mock.calls[0][0]).toBe('stop')
    // status is NOT flipped optimistically; the task core owns it
    expect(node.data.status).toBe('running')
  })

  it('start → calls launch("start", …)', async () => {
    const node = makeDeployedVmNode('stopped')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('start')
    await flushPromises()
    expect(launch).toHaveBeenCalledWith('start', expect.objectContaining({ vmId: 4001 }))
  })

  it('pause and resume route through launch', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('pause')
    await wrapper.vm.handleVmAction('resume')
    expect(launch.mock.calls.map((c) => c[0])).toEqual(['pause', 'resume'])
  })
})
```

- [ ] **Step 8: Run the rewritten test to verify it fails**

Run: `npx vitest run src/__tests__/configPanelVmAction.test.js`
Expected: FAIL (ConfigPanel still does optimistic flip / doesn't call `launch`).

- [ ] **Step 9: Wire ConfigPanel — reroute lifecycle + open DeleteNodeModal**

In `src/components/ConfigPanel.vue` `<script setup>`:

Add imports/state:

```javascript
import { ref } from 'vue'
import DeleteNodeModal from '@/components/DeleteNodeModal.vue'
import { useProxmoxTasks } from '@/composables/useProxmoxTasks'
import { proxmoxApi } from '@/services/proxmox'

const tasks = useProxmoxTasks()
const showDeleteModal = ref(false)
```

Rewrite `handleVmAction` (start/stop/pause/resume/restart/force-stop) to route through the task core, removing the dead `case 'delete'` branch and the optimistic `ACTION_RESULT_STATUS` write:

```javascript
const handleVmAction = async (action) => {
  const vmId = props.node.data?.vmId
  if (!vmId) return
  const vmtype = props.node.type === 'lxc' ? 'lxc' : 'qemu'
  await tasks.launch(action, {
    node: props.node,
    vmId,
    vmtype,
    apiCall: () => proxmoxApi.vm[actionToApi(action)](vmId, vmtype),
    onSuccess: () => {},
  })
}
```

Where `actionToApi` maps action→existing api method names (`start`,`stop`,`pause`,`resume`,`stopForce`,`restart`). If the existing `proxmoxApi.vm` methods take `(vmId, vmtype)` already (per `vmStatusAction`), call them directly; otherwise keep using the method that wraps `vmStatusAction`. Verify the exact method names on `proxmoxApi.vm` and adapt — the goal is: launch's `apiCall` returns `{ upid }` from the v1 status action. You can simplify by calling a single helper if one exists. Remove `ACTION_RESULT_STATUS` if no longer referenced.

Replace `handleDelete` to open the modal instead of the inline confirm:

```javascript
const handleDelete = () => { showDeleteModal.value = true }

const onDeleteProxmox = async () => {
  showDeleteModal.value = false
  const vmId = props.node.data?.vmId
  const vmtype = props.node.type === 'lxc' ? 'lxc' : 'qemu'
  await tasks.launch('delete', {
    node: props.node,
    vmId,
    vmtype,
    apiCall: () =>
      props.node.type === 'lxc'
        ? proxmoxApi.lxc.delete(vmId, { vmtype: 'lxc' })
        : proxmoxApi.vm.delete(vmId, { vmtype: 'qemu' }),
    onSuccess: () => { emit('delete', props.node.id); emit('close') },
  })
}

const onRemoveCanvas = () => {
  showDeleteModal.value = false
  emit('delete', props.node.id)
  emit('close')
}

const onDeleteCancel = () => { showDeleteModal.value = false }
```

In the ConfigPanel template, render the modal (e.g. just before the closing root element):

```html
<DeleteNodeModal
  :open="showDeleteModal"
  :node="node"
  @deleteProxmox="onDeleteProxmox"
  @removeCanvas="onRemoveCanvas"
  @cancel="onDeleteCancel"
/>
```

- [ ] **Step 10: Run the rewritten ConfigPanel test + DeleteNodeModal test**

Run: `npx vitest run src/__tests__/configPanelVmAction.test.js src/__tests__/DeleteNodeModal.test.js`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/components/DeleteNodeModal.vue src/components/ui/ConfirmDialog.vue src/components/ConfigPanel.vue src/locales/en/project.json src/locales/fr/project.json src/locales/jp/project.json src/__tests__/DeleteNodeModal.test.js src/__tests__/configPanelVmAction.test.js
git commit -m "feat(canvas): DeleteNodeModal + confirmed delete/lifecycle wiring; fix ConfirmDialog z-index/teleport"
```

---

## Task 7: `ActivityTerminal` panel + ProjectEditor dock + bridge mount

**Files:**
- Create: `src/components/project/ActivityTerminal.vue`
- Modify: `src/views/ProjectEditor.vue`
- Modify: `src/locales/{en,fr,jp}/project.json`
- Test: `src/__tests__/ActivityTerminal.test.js` (new)

- [ ] **Step 1: Add i18n keys (en/fr/jp) for `activityTerminal`**

`src/locales/en/project.json`, add:

```json
"activityTerminal": {
  "title": "Activity",
  "empty": "No activity yet.",
  "filterAll": "All",
  "filterProxmox": "Proxmox",
  "filterDeploy": "Deploy",
  "clear": "Clear",
  "close": "Close activity terminal"
}
```

`fr`:

```json
"activityTerminal": {
  "title": "Activité",
  "empty": "Aucune activité pour le moment.",
  "filterAll": "Tout",
  "filterProxmox": "Proxmox",
  "filterDeploy": "Déploiement",
  "clear": "Effacer",
  "close": "Fermer le terminal d'activité"
}
```

`jp`:

```json
"activityTerminal": {
  "title": "アクティビティ",
  "empty": "まだアクティビティはありません。",
  "filterAll": "すべて",
  "filterProxmox": "Proxmox",
  "filterDeploy": "デプロイ",
  "clear": "クリア",
  "close": "アクティビティ端末を閉じる"
}
```

- [ ] **Step 2: Write failing test for `ActivityTerminal`**

Create `src/__tests__/ActivityTerminal.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ActivityTerminal from '@/components/project/ActivityTerminal.vue'
import { useActivityLogStore } from '@/stores/activityLogStore'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en: { project: {
    activityTerminal: {
      title: 'Activity', empty: 'No activity yet.', filterAll: 'All',
      filterProxmox: 'Proxmox', filterDeploy: 'Deploy', clear: 'Clear', close: 'Close',
    },
  } } } })
}

describe('ActivityTerminal', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders entries from the store', () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'success', target: 'vm-1', message: 'deleted' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    expect(w.text()).toContain('deleted')
  })

  it('shows empty state when no entries', () => {
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    expect(w.text()).toContain('No activity yet.')
  })

  it('filters by source', async () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'info', target: 'vm-1', message: 'px-line' })
    s.push({ source: 'deploy', level: 'info', target: 'dep-1', message: 'deploy-line' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    await w.find('[data-testid="filter-deploy"]').trigger('click')
    expect(w.text()).toContain('deploy-line')
    expect(w.text()).not.toContain('px-line')
  })

  it('clear empties the log', async () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'info', target: 'x', message: 'gone-soon' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    await w.find('[data-testid="activity-clear"]').trigger('click')
    expect(s.entries).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/__tests__/ActivityTerminal.test.js`
Expected: FAIL (component not found).

- [ ] **Step 4: Implement `ActivityTerminal.vue`**

Create `src/components/project/ActivityTerminal.vue` (mirrors `ProblemsPanel.vue`'s `<section>` shell):

```vue
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useActivityLogStore } from '@/stores/activityLogStore'

defineEmits(['close'])
const { t } = useI18n()
const store = useActivityLogStore()

const filter = ref('all') // 'all' | 'proxmox' | 'deploy'
const visible = computed(() =>
  filter.value === 'all'
    ? store.entries
    : store.entries.filter((e) => e.source === filter.value),
)

const levelClass = (level) => ({
  pending: 'text-info',
  success: 'text-success',
  error: 'text-error',
  info: 'text-base-content/70',
})[level] || 'text-base-content/70'
</script>

<template>
  <section
    class="activity-terminal bg-base-100 border-t border-base-300"
    role="region"
    aria-label="Activity"
    data-testid="activity-terminal"
  >
    <header class="flex items-center justify-between px-4 py-2 border-b border-base-300">
      <div class="flex items-center gap-3">
        <h2 class="font-semibold text-sm">{{ t('project.activityTerminal.title') }}</h2>
        <div class="join">
          <button class="btn btn-xs join-item" :class="{ 'btn-active': filter === 'all' }"
            data-testid="filter-all" @click="filter = 'all'">{{ t('project.activityTerminal.filterAll') }}</button>
          <button class="btn btn-xs join-item" :class="{ 'btn-active': filter === 'proxmox' }"
            data-testid="filter-proxmox" @click="filter = 'proxmox'">{{ t('project.activityTerminal.filterProxmox') }}</button>
          <button class="btn btn-xs join-item" :class="{ 'btn-active': filter === 'deploy' }"
            data-testid="filter-deploy" @click="filter = 'deploy'">{{ t('project.activityTerminal.filterDeploy') }}</button>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button class="btn btn-xs btn-ghost" data-testid="activity-clear" @click="store.clear()">
          {{ t('project.activityTerminal.clear') }}
        </button>
        <button class="btn btn-xs btn-ghost" :aria-label="t('project.activityTerminal.close')" @click="$emit('close')">✕</button>
      </div>
    </header>

    <div v-if="visible.length" class="max-h-56 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
      <div v-for="e in visible" :key="e.id" :class="levelClass(e.level)">
        <span class="opacity-50">[{{ e.source }}]</span>
        <span class="font-semibold"> {{ e.target }}</span>
        <span> — {{ e.message }}</span>
      </div>
    </div>
    <p v-else class="px-4 py-3 text-xs opacity-60">{{ t('project.activityTerminal.empty') }}</p>
  </section>
</template>
```

- [ ] **Step 5: Run ActivityTerminal test to verify pass**

Run: `npx vitest run src/__tests__/ActivityTerminal.test.js`
Expected: PASS.

- [ ] **Step 6: Dock ActivityTerminal in ProjectEditor + mount the bridge**

In `src/views/ProjectEditor.vue`:

Add imports (near the `ProblemsPanel` import at line 29):

```javascript
import ActivityTerminal from '../components/project/ActivityTerminal.vue'
import { useDeploymentActivityBridge } from '@/composables/useDeploymentActivityBridge'
```

Add the visibility ref (near `showProblemsPanel`, ~137):

```javascript
const showActivityTerminal = ref(true)
```

Mount the bridge in `<script setup>` top-level (it registers + cleans up via `onUnmounted`):

```javascript
useDeploymentActivityBridge()
```

Render `ActivityTerminal` as a sibling immediately after the `<ProblemsPanel … />` block (1287–1294):

```html
<ActivityTerminal
  v-if="showActivityTerminal"
  v-show="tab === 'canvas'"
  class="shrink-0"
  @close="showActivityTerminal = false"
/>
```

- [ ] **Step 7: Run unit tests, lint, and build**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all PASS / build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/project/ActivityTerminal.vue src/views/ProjectEditor.vue src/locales/en/project.json src/locales/fr/project.json src/locales/jp/project.json src/__tests__/ActivityTerminal.test.js
git commit -m "feat(activity): unified ActivityTerminal docked beside Problems; wire deploy bridge"
```

---

## Final verification (before claiming done)

- [ ] **UI:** `cd range42-deployer-ui && npm run test:unit && npm run lint && npm run build` — all green.
- [ ] **Backend:** `cd range42-backend-api && python -m pytest -q` — all green.
- [ ] **Protected-VMID safety:** confirm `_assert_vmid_safe` is on the `vm_delete` path unconditionally and the `test_vm_delete_refuses_protected_vmid` test passes (VMID 100/101 can never be destroyed).
- [ ] **No AI attribution** in any commit/code/doc; spec + this plan remain untracked under `docs/superpowers/`.

## Deployment (only when asked / after review)

- **UI:** push `dev`; on VM `r42.admin-web-deployer-ui` run `git pull` (Vite hot-reloads).
- **API:** open PR `feature/proxmox-action-tracking` → `feature/gamenet-authoring-v1`; after merge, `git pull` on VM `r42.admin-web-builder-api`.
- Re-create SSH tunnel if needed:
  `ssh -f -N -L 127.0.0.1:8000:192.168.142.121:8000 -L 127.0.0.1:3002:192.168.142.123:3002 root@100.64.0.14`

## Self-review notes (spec coverage)

- Backend v1 delete (purge + destroy-unreferenced-disks) + running→409 + protected→409 → Task 1. ✅
- Task-status endpoint with `{upid:path}` + percent-encode + `TaskStatus` schema → Task 1. ✅
- `_assert_vmid_safe` refactor, behavior preserved (gated for lifecycle, unconditional for delete) → Task 1. ✅
- v0 `Any` NameError fix → Task 1 Step 9. ✅
- Service `vmDelete`/`getTaskStatus`, repoint `vm.delete`/`lxc.delete` (zero call sites for lxc) → Task 2. ✅
- `useNodeStatus` + transitional CSS + migrate VM/LXC/Docker/ConfigPanel → Task 3. ✅
- `activityLogStore` ring buffer + `deploymentStore.onEvent` + bridge → Task 4. ✅
- `useProxmoxTasks` launch + poll-to-completion + revert/timeout/no-host → Task 5. ✅
- `DeleteNodeModal` + ConfirmDialog teleport/z-[200] fix + ConfigPanel wiring + rewrite `configPanelVmAction.test.js` → Task 6. ✅
- `ActivityTerminal` docked beside Problems + i18n en/fr/jp + bridge mount → Task 7. ✅
