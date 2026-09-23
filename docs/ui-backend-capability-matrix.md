# UI screens, API actions and dependency boundaries

Assessment date: 14 September 2026. This maps the nine routes in
[`src/router/index.js`](../src/router/index.js) at UI
`7c0aedae0462258d2ec5e87e3be18cc821541553` to API
`553af0a54d9094721a42044248ad4e21b37e3c18`. The installed dependencies are
catalog `7f40f5c`, playbooks `a150867`, controller `99fd63c`; runtime fingerprint
`7cf3605b87d30ac14a7c13af40bbef18414e3c4aa8ee2abc0e153c77d51ca7e2`.
Newer source fixes require their own checkpoint and acceptance; this document
does not silently treat an uninstalled candidate as the current application.

The historical Settings row below is superseded for current source behavior by
[Settings workflows](settings-workflows.md), including its section URLs and
browser/backend persistence boundaries. That source documentation does not
retroactively extend this matrix's dated live evidence.

The scope is UI/backend integration. Hyde owns SDN/playbook/controller changes.
Draft playbooks #169 and controller #146 remain separate, unmerged and inactive.
Their existence is not an installed capability. This documentation review made
no provider, guest, network or shared-installation calls.

## Reading the matrix

**Implemented** means a matching source path exists, not that every action has
current-release live acceptance. **Local** changes browser state/files only.
**Legacy** identifies a separate older API/adapter, not the guarded concrete
deployment contract. **Unsupported** means no implemented workflow for this
scope. **Defect** identifies a concrete source discrepancy listed below.

All `/v1` paths use the selected authenticated backend unless explicitly marked
as a defect. Identifiers below are URL-encoded. Git publishing/reopening uses
browser provider credentials through the GitHub/GitLab/Gitea drivers; it has no
equivalent backend publishing endpoint. Backend Git read credentials are separate.
Evidence labels refer to the dated records at the end, not a fresh nine-screen
acceptance run.

## Nine-route action matrix

| Screen / route | Visible action groups | Exact API or local/provider contract | Status and evidence |
| --- | --- | --- | --- |
| Home `/` | Create/open/duplicate/delete local projects, import/export, search/view; Open from Git; setup checklist; Quick Deploy | Browser project store and file import; provider ref/tree/file reads for pinned reopening; setup uses the Sources/Settings actions below. Quick Deploy opens the same `DeployForm`, but its preliminary `GET /v1/deployments` is defective (F2). | Local/project and provider paths implemented; H-Git/H-UI cover selected flows. Quick-deploy duplicate hints are not reliable. [Dashboard](../src/views/Dashboard.vue), [reopening](../src/services/gitProjectOpen.ts). |
| Sources `/sources` | List/reload, Add default catalog, add source, refresh/index, rotate/remove credential, remove source | `GET/POST /v1/catalog/sources`; `POST /v1/catalog/sources/default`; `POST /v1/catalog/sources/{source}/refresh`; `PATCH/DELETE /v1/catalog/sources/{source}`. Refresh performs real indexing; source registration alone is not a connectivity check. | Implemented; H-UI covers default onboarding, not every edit/error path. Backend tokens are not browser publishing tokens. [Source adapter](../src/composables/useCatalogSources.ts). |
| Catalog `/catalog` | Search/kind/source filters, reload, details, Use/Customize, New role/publish, Fork | Paginated `GET /v1/catalog/entries` and detail reads; filters run locally over fetched pages. Use/Customize use pinned project handoff and provider file reads. New role validates a local role tree then uses reviewed provider publication. Legacy Fork calls provider `createBranch`/`putFile` (F1). | Pinned handoff/role creation implemented; H-Catalog/H-Git. General bundle/container customization is not implied. Fork can report false success. [List](../src/views/CatalogList.vue), [handoff](../src/components/catalog/CatalogProjectHandoff.vue). |
| Catalog detail `/catalog/:source/:entry` | README/metadata/topology, Use/Customize, Fork, back | `GET /v1/catalog/entries/{source}/{entry-path}`; the same pinned handoff/provider flow. Legacy Fork has the same F1 defect. | Implemented detail/handoff with H-Catalog evidence; Fork is defective. [Detail](../src/views/CatalogEntryDetail.vue). |
| Project Editor `/project/:id` | Canvas, Config/files, variables, attachments, undo/layout, local delete/export | Local project/IndexedDB state and compiler; byte-preserving assets; explicit legacy task/variable migration; target-bound imported role trees. No guest mutation from review/apply-to-draft. | Implemented VM/network authoring, multiple NICs, resources and explicit replication. Unsupported node/attachment forms must fail visibly. H-UI/H-Role; role execution on three shared guests remains unaccepted. [Authoring](concrete-scenario-authoring.md), [replication](concrete-replication.md). |
| Project Editor, continued | Repository connect, Save, Publish to destinations, history/review/merge, Open from Git | Browser Git provider ref/tree/blob/commit/review operations through [`services/git`](../src/services/git); revision-bound reopening and working branches. `PUT /v1/projects/{project}` registers the actual Git binding before deployment. | Implemented with real isolated-provider H-Git evidence. Cross-provider publishing is independent per destination, not one distributed atomic transaction. Shared API GitLab routing is a known connectivity limitation, not proof that provider support is missing. |
| Project Editor, continued | Scenario review, VM-compatible bundle/role attachment, reserve/review/apply/renew/release, Deploy | Bundle discovery/detail plus `POST /v1/catalog/sources/{source}/bundles/resolve`; only verified VM/GROUP-to-VM proofs are accepted. `POST /v1/proxmox/hosts/{host}/reservations`, `GET/DELETE .../reservations/{lease}` with private owner header. `POST /v1/projects/{project}/validate`; `POST /v1/deployments` transfers a matching lease into a durable claim. | Implemented; H-Claims/H-Role. Reservations do not own VNets/subnets or create guests. Deployment creation does not mean full execution succeeded. [DeployForm](../src/components/project/DeployForm.vue), [reservation contract](scenario-allocation.md). |
| Project Editor, continued | Project Proxmox settings/Test, capacity, import current guests, template/ISO browsing/download, live guest power/delete/config Apply | Test: `GET /v1/health/ready`; targets: `GET /v1/proxmox/hosts`; capacity: `GET /v1/proxmox/hosts/{host}/capacity`. Import/config: `GET .../{host}/vms`, `GET .../vms/{vmid}/config?vmtype=qemu\|lxc`. Power: `POST .../vms/{vmid}/status/{start\|stop\|shutdown\|suspend\|resume\|reboot}`; delete: `DELETE .../vms/{vmid}`; completion: `GET .../{host}/tasks/{upid}/status`. Storage: `GET .../{host}/storage`, `GET .../storage/{storage}/content`, `POST .../storage/{storage}/download-url`. Imported-VM Apply uses v0 setters listed below. | Mixed implemented v1 and legacy paths; full current action/type/permission/readback acceptance pending. Host selection F3 and optimistic configuration F4 need correction. Browsing existing templates is not template creation. [Client](../src/services/proxmox/api.ts), [capacity matcher](../src/services/proxmox/capacity.ts). |
| Settings `/settings` | Add/select/edit/remove backend profiles, Test, identity/preferences, GitHub login/inventory repos, retention settings, clear local data | Profiles/identity/preferences are browser state; Test calls authenticated `GET /v1/health/ready`. GitHub user/repository reads use the browser provider. These legacy inventory registrations are distinct from backend Sources. Retention: `PUT /v1/admin/retention`; local clearing does not delete backend resources or release claims. | Implemented with H-UI evidence for selected authentication/settings flows. At API553 readiness's Git status counts registered sources without contacting them (F5). Retention is stored preference only, not an active cleanup worker. [Settings](../src/views/Settings.vue). |
| Deployments `/deployments` | List active/history, local filters, open detail/preflight | Paginated `GET /v1/deployments?offset=...&limit=100`; route navigation. | Implemented; current completeness of refresh/error/reload paths still requires screen acceptance. [Index adapter](../src/composables/useDeploymentIndex.ts). |
| Deployment detail `/deployments/:id` | Status/teams/history/log filters/download, inspect attempts, cancel, preflight/start, configure saved SHA, teardown | `GET /v1/deployments/{id}`, `GET .../attempts`; authenticated `GET .../events?from_cursor=...`, finite `GET .../events/download`; `POST .../cancel`; `POST .../preflight`; `POST .../attempts` with explicit `full`, `configure` or `teardown`. Teardown requires codename confirmation; configure preserves original target manifests/inventory. | Implemented with H-Runtime/H-Claims evidence. Full three-replica provisioning has failed during cloud-init; successful diagnostics/cleanup do not change that result. Retired `_universal` is historical read-only except cancelling an actual existing attempt. |
| Deployment detail, continued | Runtime status and reviewed VM/scenario firewall or outbound NAT; record desired runtime changes in Git; inspect/release allocations | `GET .../{id}/runtime`; `POST .../{id}/operations` permits exactly `vm_firewall`, `scenario_firewall`, `sdn_snat`. Runtime Git records use provider publication, not another PVE mutation. `GET/DELETE .../{id}/allocations`; release requires fresh `404 ALLOCATION_NOT_FOUND` after204. | Runtime controls honor the installed operation list and observed ownership/pending state. No host/DC arming or network-delete operation. Claims release is implemented; H-Claims. Runtime rule/switch readback does not prove forwarding/filtering. [Runtime controls](../src/components/deployment/RuntimeControls.vue), [claim controls](deployment-allocations.md). |
| Deployment detail, continued | Legacy team reset/snapshot/rollback/teardown dialogs | Historical non-pinned, non-retired records alone expose `POST .../{id}/teams/{team}/reset`, `POST .../{id}/snapshot`, `GET .../{id}/snapshots`, `POST .../{id}/rollback`, `DELETE .../{id}`. | Correctly hidden for concrete and `_universal` records. Concrete snapshot/rollback/team reset are unsupported by API553; the presence of old modal files does not change this. [View gating](../src/views/DeploymentDetail.vue). |
| Preflight `/deployments/:id/preflight` | Read report and copy share URL | `GET /v1/deployments/{id}` and `GET .../{id}/preflight`; clipboard operation. Running a new preflight is on Deployment Detail. | Implemented read-only report. A copied URL still requires backend authorization; it is not a public bypass or new execution approval. [Preflight view](../src/views/DeploymentPreflight.vue). |

The legacy imported-VM Apply setters are `POST
/v0/admin/proxmox/vms/vm_id/config/{vm_set_tag|vm_set_name|vm_set_description|vm_set_cpu|vm_set_memory}`.
They are distinct from pinned deployment `configure`, including their targeting,
ownership and task-result behavior. The shared client also contains v0 NIC,
alias, firewall and VM-create/clone wrappers, and v1 per-VM snapshot wrappers;
an exported wrapper is not evidence that a current screen safely exposes it.
LXC `create()` explicitly returns a client-side501, and the concrete emitter
rejects LXC execution. Do not substitute that primitive for a working workflow.

## Confirmed findings in the assessed source

These are source findings, not newly reproduced live failures. UI/backend owners
received F1–F4 during this review; the September14 baseline already records F5.

| ID | Confirmed behavior | Required UI/backend correction |
| --- | --- | --- |
| F1 | Both Catalog Fork handlers catch provider creation/write failures, warn only in the console, then close/navigate to an unregistered synthetic source. They write a reference stub rather than a complete pinned entry. | Fail visibly and retain review state; use the supported pinned handoff/publication contract. This is not a Hyde/controller dependency. |
| F2 | Dashboard Quick Deploy uses a bare unauthenticated same-origin `GET /v1/deployments`, then reads `body.deployments` instead of `Page.items`; errors silently clear duplicate-codename hints. | Use the active authenticated backend, correct pagination/shape and visible failure state. The actual DeployForm submission already uses the normal client. |
| F3 | `getRegisteredHost()` in the legacy Proxmox client selects `items[0]`, while project/capacity selection can name a different registered target. | Bind live import/config/power/storage actions to the explicitly selected host identity; reject missing/ambiguous matches instead of choosing the first entry. |
| F4 | Imported-VM Apply calls v0 setters backed by the server's global inventory rather than an exact registered target, then copies desired values into `actualConfig` without fresh readback. API553 has no equivalent safe v1 configuration-write endpoint. | Block unsupported writes while preserving desired/pending edits and allow exact-target readback. A later write flow needs a target-bound backend endpoint and verified completion; refreshing alone cannot make the old write safe. |
| F5 | API553 readiness's Git `ok` derives from source registration count, not a repository connection. | Label registration separately from connectivity; failed provider/network access must remain distinct from missing implementation. |

## UI/backend follow-up on 14 September

The findings above retain their assessed source pins. The follow-up implements
these corrections. The [production browser report](acceptance/2026-09-14-interface-routes.md)
describes controlled-service coverage; shared installation is separate evidence.

- **F1:** both Fork & publish buttons now open the existing reviewed catalog
  handoff in Customize mode. Supported pinned files and provenance are imported
  into a real local project. The review explains the subsequent Save/Publish
  step; provider refusal and cancellation preserve the original project/source.
- **F2:** Home Deploy opens Project Editor with a review prompt. Deployment uses
  the editor's normal saved-revision, backend registration and allocation checks.
  The former shortcut also supplied a local project ID where the backend ID was
  required, so replacing just its unauthenticated codename lookup was insufficient.
- **F3:** live Proxmox operations resolve the intended node or explicit host from
  a fresh, complete registry. Missing, ambiguous or incomplete matches are
  refused. The backend/credential context remains fixed through lookup, action
  and task polling; the returned UPID selects the task's node. Missing task IDs
  remain unconfirmed instead of reporting success.
- **F4:** legacy setters and automatic tag writes stay blocked. The new reviewed
  v1 flow can apply five fields to an explicitly registered, unmanaged guest.
  It checks fresh configuration and target digests, verifies task completion and
  readback, and separates pending configuration from current observations.
  See [configuration behavior and limits](proxmox-config-status.md). Shared
  write acceptance is separate from controlled-service validation.
- **F5:** readiness now reports Git connectivity as `not_checked`, with a separate
  registered-source count. It does not load source credentials or contact Git.
  Required database/workspace/Proxmox failures still prevent backend readiness.
  Settings and project configuration show dependency results and actionable
  failure text; old registration-only Git responses also display as unchecked.
- **F6:** project settings now discard a connection result if the URL, node,
  credential, project or dialog context changes during verification. Only a
  literal Boolean `ready: true` permits saving; verified settings persist when
  reopening the project.
- Deployment lists show loading explicitly, classify partial/unknown results as
  terminal history, and use keyboard-accessible links without nested controls.
  Catalog authentication failures hide cached entries and retain visible retry;
  offline fallback is limited to the unchanged backend/credential and five minutes.
  Home's create dialog has labelled fields, keyboard cancellation and restored
  focus, and the reviewed routes fit desktop and mobile widths.

## Upstream dependencies and UI boundaries

| Capability | Existing primitive / missing contract | Owner and UI status |
| --- | --- | --- |
| Selected network removal | Installed whole-zone deletion is not equivalent to removing one deployment VNet. Draft selected deletion has a legacy `net*` consumer, not generated `r42*` teardown or automatic journal recovery. | Record the required exact selected identity, shared-zone preservation, guest-attachment refusal and durable completion contract for Hyde; keep generic UI network deletion unsupported. |
| Alias/custom policy objects | DC/VM alias and rule primitives already exist. Ownership namespaces, references, ordering and rename/delete behavior are not a complete deployment contract. | UI/API integration needs an agreed contract with Hyde; do not claim primitive support is absent. |
| Host/DC firewall arming | Controller/composite primitives exist; installed deployment operation schema rejects them. | Separate explicit host-operator workflow and acceptance required. VM toggles must not arm host/DC firewalls. |
| Guest firewall versus Proxmox filtering | Verified guest firewall attachments exist; VM, NIC, DC/node and guest OS states are different. | Label each layer and baseline effects. Do not infer reachability from switches or rule counts. |
| Isolated template creation | Historical family builder exists. The new isolated source has tests, but no installed UI/backend consumer or accepted reusable template result. | Record prerequisites/ownership/completion proof for Hyde; template browsing does not imply build support. |
| Scenario/team snapshot, rollback, reset | Per-VM PVE snapshot primitives/API exist; concrete scenario execution and ownership/recovery semantics do not. | Keep concrete actions unsupported. A per-VM accepted UPID is not completed scenario recovery. |
| Wider SDN preservation | Current runtime does not establish complete multi-node preservation. Draft snapshot/restore refuses nft and does not implement automatic partial-operation recovery; external writers need coordination. | Record required guarantees with Hyde. Neither a draft capability nor historical single-host evidence authorizes broader UI actions. |
| Allocation growth/placement | Reviewed keyed leases and durable claims exist; subnet/VNet ownership, topology growth/shrink and multi-node placement are separate. | UI/API can improve existing controls now; dependent new behavior needs explicit contracts, not guessed ownership or silent remapping. |

The authoritative current runtime contract is the paired API's
[runtime-controls.md](https://github.com/range42/range42-backend-api/blob/553af0a54d9094721a42044248ad4e21b37e3c18/docs/runtime-controls.md)
and [operation schema](https://github.com/range42/range42-backend-api/blob/553af0a54d9094721a42044248ad4e21b37e3c18/app/schemas/v1/runtime.py).
Its older `sdn-cli-ui-parity.md` is a historical audit and predates implemented
runtime controls. No upstream implementation change is proposed by this matrix.

## Evidence and remaining acceptance

- **S (source):** the linked views/adapters at the exact assessed UI/API pins.
  Existing unit tests describe covered behavior; this docs-only review ran no
  new product tests, provider calls or live operations.
- **H-Git:** [provider acceptance](provider-acceptance-20260910.md),
  [replication GitHub](acceptance/replication-github-20260911.json) and
  [GitLab](acceptance/replication-gitlab-20260911.json). These retain their exact
  earlier UI pins; Gitea used a disposable instance. Workstation GitLab success
  does not prove the shared API has a permitted route.
- **H-UI / H-Catalog:** [shared catalog handoff](acceptance/2026-09-11-shared-catalog-handoff.md),
  [attachment browser](acceptance/attachment-shared-browser-20260911.json) and
  [replication browser](acceptance/replication-shared-browser-20260911.json).
  Each report covers its listed actions and release only.
- **H-Role:** [catalog role local acceptance](acceptance/2026-09-11-catalog-role-execution.md)
  proves compiler/browser and bounded local Ansible consumption. Actual imported
  NTP role execution across three shared guests remains unaccepted.
- **H-Claims / H-Runtime:** [shared claim-panel acceptance](acceptance/2026-09-11-shared-claim-panel.md)
  records real lease/claim transfer, busy/refusal, owned teardown and explicit
  release. The full attempt failed during the second guest's cloud-init wait.
  Earlier single-guest runtime acceptance is separately retained in deployment
  repository `docs/08-shared-runtime-results.md`; it is not a new nine-screen run.
- **Installed baseline:** workspace `_local-specs/2026-09-14-ui-backend-baseline.md`
  and deployment `docs/16-shared-role-native-results.md` record current pins and
  preserved installation state. File/profile verification is not complete action
  acceptance.

For each implemented action group, the remaining acceptance pass must cover
success,401/403, unavailable dependency, validation, pending/partial/failed task,
reload persistence and selected-backend changes at desktop/mobile sizes.
Local edits, saved Git revisions, accepted API jobs, observed PVE state and
successful guest execution are separate outcomes. The UI/backend follow-up
addresses the findings without changing Hyde's code. Unsupported boundaries
remain explicit; a fresh supported end-to-end guest run still needs an approved
usable template.
