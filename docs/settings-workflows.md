# Settings workflows

Settings separates browser preferences from the active backend's state. This
document describes the source implementation; deployment and acceptance results
are recorded separately.

| Section | URL | What it changes or reads |
| --- | --- | --- |
| Connections | `/settings?tab=connections` | Saves/selects browser connection profiles; reads backend readiness, identity, audit and registered targets. |
| Preferences | `/settings?tab=preferences` | Immediately applies browser theme and editor preferences. |
| Identity | `/settings?tab=identity` | Saves the browser's collaborator display name and colour. |
| Snapshots | `/settings?tab=snapshots` | Reads the active backend's retention policy; an administrator can save review preferences. |
| Local data | `/settings?tab=data` | Clears this browser's project list after confirmation. |

`/settings` defaults to Connections. The legacy `#user-identity` and
`#snapshot-retention` links still open their sections when no recognized `tab`
is supplied. A recognized section query takes precedence. Navigation away from
unsaved connection, identity or retention edits prompts for confirmation; Cancel
keeps the edits. Browser reload/close also receives the native unsaved-edit guard.

## Connections and registered targets

Add a connection with its name, HTTP(S) base URL and backend API token, then
choose the active backend. URL credentials, query strings and fragments are
rejected. Add/Edit/Remove changes browser profiles; these controls do not
register Proxmox hosts or change server credentials. The backend token is stored
in this browser's profile, not a server credential vault. Storage failures show
session-only status and a retry control.

The active profile is used by Catalog, Sources, Deployments and installation
settings. Existing projects retain their own saved connection and target.
Removing a profile does not stop deployments or delete backend records.

**Test** reads `GET /v1/health/ready` on that saved profile and shows readiness
details, timing, authentication/access denial or reachability failure. Saving a
profile alone does not test it. Readiness is only green for `ready: true`; it
does not prove a guest deployment succeeded. A result from an old URL/token
cannot replace the edited profile's health.

**Load targets / Refresh targets** reads the active backend's paginated
`GET /v1/proxmox/hosts` registry. **Test target** reads
`GET /v1/proxmox/hosts/{id}/health`, including the available SDN API signal.
Target tests also refresh the backend's recorded health; they do not prove
guest connectivity or SDN traffic. **Use node as profile default** saves that
registered node name in the local profile;
it does not retarget existing projects or write to Proxmox. Ambiguous duplicate
node names cannot be selected. Incomplete/changed registry pages fail visibly,
and changing backend credentials invalidates pending target reads.

**Check backend access** reads `GET /v1/auth/me`. Administrators can also read
the paginated `GET /v1/admin/audit` journal. These controls do not create users,
issue tokens or grant roles. Backend roles apply across the installation;
the collaborator name in Identity grants no permission. Audit records describe
request outcomes, not proof of successful guest execution.

GitHub, GitLab and Gitea repository/source credentials are managed in **Sources**
(`/sources`). Settings links to that workflow instead of keeping a separate
GitHub-only authentication or inventory registration form.

## Appearance, editor and identity

Theme supports System, Light and Dark and applies immediately. Editor
preferences also apply immediately and restore on reopening the app:

- **Automatically save the Git working branch** defaults to enabled. It controls
  the existing debounced Git checkpoints for Git-connected projects. Turning it
  off suppresses pending automatic saves and the automatic exit save; an already
  dispatched request may finish. Local drafts continue to persist. Explicit
  Save and Save-and-Deploy still work, and re-enabling schedules the current
  draft through the normal Git lock and compare-and-swap checks. Publication
  and merging remain separate actions.
- **Snap nodes to grid** defaults to enabled. Grid spacing defaults to 20 px
  and accepts whole values from 10 to 50 px. Both options reach the mounted
  VueFlow editor; spacing also controls its visible grid. Changing the setting
  does not move existing nodes. Project tab/file/node deep links are preserved.

Invalid saved editor values restore safe defaults. Failed persistence leaves
preferences usable for the session and displays an error. See
[Editor preferences](editor-preferences.md) and [Git editor locking](git-editor-locking.md).

Identity requires a nonblank display name of at most 64 trimmed characters and
a valid hex colour. **Save identity** validates before reporting browser
persistence; failed storage offers **Retry saving identity**. The name/colour
identify collaborative project edits and lock metadata. Git provider access
and backend roles remain independent.

## Snapshot retention

Opening Snapshots reads `GET /v1/admin/retention` and `GET /v1/auth/me` for the
active backend. Operators and administrators can read a supported policy;
only administrators can send `PUT /v1/admin/retention` from this screen.
The editable fields are whole-number `keep_count` (0–10,000) and `keep_days`
(0–36,500). Successful saves require a valid backend response; denied or failed
saves retain the edits and show an error. An uncertain timed-out save asks the
operator to reload the backend policy before retrying. Reloading over unsaved
edits requires confirmation.

The policy must explicitly report `automatic_enforcement: false` and
`execution: reviewed_snapshot_sets_only`. Unsupported responses are refused.
The **Not enforced** label is intentional: there is no automatic expiry worker.
Saving these preferences neither creates nor deletes snapshots. Use the
deployment's [Snapshot sets](snapshot-sets.md) panel to review and confirm each
eligible deletion. Backend/profile/token changes discard stale policy responses
and reload the newly selected backend's policy.

## Local data and verification scope

**Clear local project list** confirms the affected list, then writes the empty
browser project list before changing the displayed state. A storage failure
leaves the existing list intact. Export unsaved work first. Git repositories,
separately cached drafts, connection profiles and running deployments are kept;
this is not an erase-all-browser-data control. Reopening a saved project from
Git adds it back to the list.

Focused component/store tests cover these persistence, validation, stale-response
and navigation boundaries. `e2e/settings-workflow.spec.ts` exercises desktop and
mobile workflows against controlled API fixtures, including retention success
and denial. Such fixture tests are separate from shared-host acceptance and do
not demonstrate real Proxmox mutations, Git writes or automatic retention.
