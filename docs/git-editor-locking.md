# Git editor ownership and recovery

This source change coordinates editors through the existing project `.lock` file
on the exact repository, working branch and project subdirectory. Git preview
and Open from Git remain read-only. The first save acquires ownership; subsequent
saves and publication from that editor reuse it. Independently opened projects
use separate working branches and can be edited independently.

The lock contains public target identity, project/browser identifiers, a random
lease identifier, a changing revision and a heartbeat timestamp. Credentials are
never serialized. A saved browser identifier alone cannot regain ownership.
The editor renews the Git lease every 60 seconds and checks it immediately when
the tab becomes visible. The previous SharedWorker only called the backend's
read-only project-liveness endpoint; it has been removed. No new API lock service
or changes to provisioning locks are involved.

## Safe writes

- Acquisition uses the existing file SHA. A live competing owner is refused.
  Expiry is 180 seconds and requires an explicit **Recover expired lock** action.
  Malformed, future-dated or differently bound lock records require inspection;
  they are never silently considered free.
- Each project write includes its owned lock in the **same atomic commit** as
  changed files. GitHub retains non-force ref updates; GitLab and Gitea retain
  file-level compare-and-swap checks. Providers without atomic batch writes are
  refused before branch creation rather than falling back to partial writes.
- Changed files must still match their last reviewed revision. Identical files
  need no write. Heartbeat commits do not replace the saved content revision.
  A publication preview retains its reviewed primary revision; it cannot roll
  back a newer editor checkpoint. Existing destination branches use the prior
  publication revision for that exact destination when available.
- Direct publication acquires a separate destination lease. Temporary
  publication leases are released after the operation, including failure paths.
  Release only writes a tombstone for the exact owned lease; an old editor cannot
  remove a successor's lock.
- Closing/changing the editor retires it permanently. Pending file reads cannot
  proceed to writes, and a late acquisition cannot reactivate the session.
  Final provider mutation requests also check retirement and expiry, including
  GitHub's ref update and GitLab's metadata-to-commit interval. Source credential
  changes stop subsequent provider requests using the captured connection.

Requests already sent cannot be recalled. A failed response therefore does not
prove that Git rejected the write. Such failures block automatic retries and
retain the local draft for inspection.

## Recovery choices

The editor persists its local project before Git IO, and the adapter stores a
complete state/file snapshot, including binary assets, in the existing IndexedDB
draft cache before attempting a remote save. Failed ownership never flushes an
orphaned draft into another editor's branch.

| Situation | Available recovery |
| --- | --- |
| Another editor is active | Keep local edits; reopen a remote copy from Home to compare, or save this draft on a separate working branch. |
| Lease expired or browser was suspended | Explicitly recover the expired lease. Saving still compares files against the old reviewed revision; recovery does not merge or accept newer remote files. |
| Remote files changed or a write response was lost | Inspect/reopen the pinned remote content. An unexpired recovery action cannot replay the uncertain write. |
| Local draft must be retained separately | **Save local draft on new branch** seeds a unique branch from the last reviewed immutable SHA and preserves local files/settings. It never resets the original branch or steals its copied lock. Without a reviewed SHA, reopen from Git first. |
| Credentials changed or tab closed before release | Stop writes. Best-effort release may be unavailable; the old lease expires and a later editor must explicitly recover it. |

This coordinates participating Range42 editors, not arbitrary manual Git clients
that ignore `.lock`. Provider CAS still protects overlapping concurrent writes.
Expiry uses browser clocks; materially invalid future timestamps fail closed.
There is no automatic merge, force-push, branch deletion or automatic recovery
of unknown historical partial publications. Browser quota/unavailability remains
a local persistence error, not evidence that a draft was safely cached.

## Source validation

Focused tests use atomic per-file CAS repositories and the actual GitHub,
GitLab and Gitea provider implementations with controlled HTTP responses. They
cover competing acquisition, expiry/takeover, writes paused across takeover or
navigation, stale publication, final provider guards, exact-owner release,
copied-lock recovery, binary drafts, credential changes and actual editor
recovery controls. They do not claim a new live multi-browser provider rollout.

The paired editor also uses authenticated grouped observed-status refresh.
Status/readback changes do not trigger Git autosave or overwrite desired
configuration; desired configuration changes remain local authoring changes.

The source checkpoint passed 214 tests across 16 affected files, scoped ESLint,
strict TypeScript checking for the changed service graph, and a Node 24.21.0
production build. That scoped TypeScript check does not cover every Vue component
or establish a full-project typecheck. This protocol has not been activated on
the shared installation or exercised against live providers in multiple browsers.
