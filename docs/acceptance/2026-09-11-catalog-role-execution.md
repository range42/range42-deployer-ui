# Imported catalog role execution: local source acceptance

This UI slice, based on `602c9264027ededae3ad29f207d4bc4a7148925e`, attaches
an imported local catalog role to an existing scenario VM. No provider write,
shared deployment, guest operation or backend source change was performed.

Validated with Node 24.21.0:

- **195 focused unit tests / 10 files pass**, covering staged copy/cancel/stale
  review, collisions, managed-target checks, ordered generation, literal replica
  targets, source-vs-authored hashes, ordinary save, immutable public/private
  publication snapshots and pinned structured Git reopening/file drift.
- **Two production HTTP browser tests pass**, at 1440 and 390 pixels. The actual
  picker and nested focus trap stage the seven-file default NTP role, set vars,
  move its order, save three concrete replica targets and reopen the scenario.
  No outgoing mutations, page errors, WCAG2A/AA axe violations or picker overflow.
- Scoped ESLint, strict service TypeScript and production build pass. The build
  retains the existing advisory about chunks larger than 500 kB.
- [Local Ansible consumer](../../tools/verify-catalog-role-execution.mjs) passes
  against the clean paired API `f068f2fbac4875d7f3e649608fda9000e40a5041`.
  The unmodified default catalog `service.reload.ntp` tree at
  `0b170a768b9603cf8f5b080e4eac780cbad07c75` preserves all seven files and passes
  actual Ansible syntax validation. Its package/service tasks are not executed.
  A separate safe authored replacement executes only on an explicitly local
  selected inventory alias, in two ordered phases. It proves the absolute
  project role wins over a failing installed-name decoy and attachment vars
  override conflicting role vars. Temporary files are removed afterward.

The backend consumer accepts the pinned project and rejects invalid VMIDs.
`scenario_roles.json` is deliberately descriptive, not backend-sealed: the
current API ignores altered role metadata. An independent negative probe also
found that the non-replicated resolver accepts a changed VM name without matching
it against inventory; this is a separately reported backend correctness bug,
not a claim of complete target enforcement. The UI compiler/reopening checks
role files against reviewed hashes and generated ownership. Trusted Ansible
code is not sandboxed, and generic external dependency materialization remains
unfinished. See [the execution contract](../catalog-onboarding.md#execute-an-imported-role-on-a-scenario-vm).

The reusable browser fixture is
[`e2e/catalog-role-execution.spec.ts`](../../e2e/catalog-role-execution.spec.ts).
Existing browser limits remain 512 role files, 1 MiB/file and 2 MiB/project;
there is one authored version per role path. Original upstream provenance is
retained separately from hashes of edited authored bytes.


Follow-up paired verification against clean API candidate
`d933613cef0f6d426e2054bbb796c5e63147b718`: the same consumer passes once with
all original benign Ansible proofs retained. It now rejects invalid VMIDs,
changed manifest VM names, and changed management IPs for each of `full`,
`configure`, `teardown` and `runtime` (12 negative resolutions). The IP mutation
changes both top-level and management-NIC addresses so the VM manifest remains
internally consistent; rejection must come from the inventory binding. Each
case restores the original manifest and confirms valid resolution again.
Optional role metadata remains descriptive. This closes the concrete name/IP
bug in the paired source candidate, without claiming rollout or backend sealing.
Scoped consumer ESLint and diff checks pass; no product behavior changed in
this follow-up, and no provider or live guest operations were performed.
