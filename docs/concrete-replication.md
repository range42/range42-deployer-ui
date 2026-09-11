# Concrete scenario replication

Replication is authored explicitly in `scenario.replication` version 1. The compiler preserves the original source canvas and configuration, expands it once, and emits the existing literal v3 VM/network files plus `manifest/scenario_instances.json`. It does not use `_universal` or the older overlay preview expander.

The authoring panel supports stable team/user identities, editable display labels, explicit source VM/network scopes, and reviewed per-instance VMIDs, IPs, VNets, subnets, gateways and SNAT. Shared scopes keep the source assignment. Scoped VM names are bounded to 63 characters with deterministic hash suffixes. Suggested SDN VNet names are bounded to eight characters and still require review. Existing bridges require explicit names up to 15 characters and cannot declare managed SNAT.

Executable scope maps are authoritative. They are initialized from canvas hints when replication is enabled; a differing valid original hint produces a preview note, not a hidden canvas mutation. Unknown scope values and nested replication domains remain errors.

When canvas sources change, the panel lists added and removed VMs and networks. Applying this review updates source membership, preserves surviving scopes and all saved instance assignments, and scaffolds blank assignments for new instances. Removed-source assignments remain saved; the action does not delete deployed resources or release reservations.

## Identity and connectivity

`scenario_id`, source IDs, team IDs, user IDs and source NIC keys use 1–128 ASCII letters, numbers, dots, underscores or hyphens. Roster order and display labels do not determine identity. Instance keys are `vm-` or `net-` followed by the full SHA-256 digest of UTF-8 compact JSON `[scenario_id, source_node_id, team_id, user_id]`; absent cohort IDs are `null`.

VM and network scopes are separate. A VM can attach to its matching user network, its matching team network, or an explicitly shared network. A shared VM cannot silently fan out to scoped networks, and a team VM cannot select an arbitrary user's network. Shared subnet internet policy is shown explicitly. Per-user isolation requires per-user network assignments.

NIC keys are exact source canvas edge IDs. Explicit keys preserve parallel links, primary interface identity and reviewed addresses across ordering changes. Old parallel links without keys require operator mapping rather than guessing. All replicated content targets the expanded literal hosts in source content order; shared file bytes remain one repository file, and sealed bundle resolutions remain unchanged.

Limits are 64 teams, 64 total users, 64 expanded VMs, 32 networks, 32 NICs per VM and 256 total NICs. Oversized plans fail before assignment or publication. Subnet/VNet claims are not created by the preview. Removing a roster entry does not remove a deployed resource or release a remote reservation.

Each scoped network can exclude up to 256 explicit usable IPv4 addresses from allocation. These `reserved_ips` belong to that instance's subnet and persist with its assignments; shared networks retain their source exclusions. The compiler and allocator never translate source exclusions into a different subnet. A VM cannot use an excluded address.

## Code contracts

- `expandScenarioReplication({scenario,nodes,edges})` requires explicit scoped assignments and returns expanded rows, a matching literal canvas, instance manifest, counts and warnings. `emitConcreteScenario` performs the complete address/resource/file validation and returns the original authoring scenario.
- `planScenarioReplication` returns the same identities and counts while allowing unassigned rows. It returns `instances`, `network_instances`, `vms`, `networks`, `counts` and `warnings`, **without an executable manifest**. Planning does not mutate the source and does not call a backend.
- `projectAuthoring.ts` preserves replication configuration, primary NIC identity and source NIC keys in the common save/publication snapshot. Its whitelist removes ownership/credential fields and rejects nested values in scalar assignment fields. Reopening recompiles the original sources to verify generated ownership; it does not expand previously expanded rows again.
- `prepareReplicatedAllocation` exposes every literal VM and NIC only after instance networks have explicit subnets and gateways. The dialog passes these rows to the normal reservation panel. `applyReplicatedAllocation` revalidates current source identities and network constraints, then maps reviewed VM IDs and IPs into scoped assignments and shared source rows. Roster, canvas and network assignments remain intact.
- Stable source NIC keys are sent as `nic_key`; a response must match both current index and key. Draft changes invalidate review. Reservations cover VM IDs and NIC addresses; they do not create durable deployment ownership or subnet/VNet claims.

## Verification — 11 September 2026

The combined compiler, panel, persistence, source reconciliation and allocation integration passes **1,233 tests across 138 files**, full ESLint, scoped strict TypeScript and the production build on Node24.21/Vitest4.1.11. Fresh UI output for both SDN and existing bridges is accepted by the paired backend; altered cross-team NIC mappings are rejected.

`e2e/scenario-replication.spec.ts` passes against the production build at 1440px and 390px over ordinary HTTP (`window.isSecureContext === false`). It exercises explicit per-instance exclusions, a three-VM/two-network keyed reservation, rejection after a draft change, reviewed Apply, original source preservation, generated manifests and local reload. Both runs report no page errors, scoped WCAG A/AA violations or horizontal overflow. The backend reservation responses are controlled fixtures; these checks do not provision guests or prove real provider publication.

Logs: `/tmp/r42-replication-ui-{full,lint,build,contract}.log`, `/tmp/r42-replication-integrated-tsc.log`, `/tmp/r42-replication-browser-http.log`. Screenshots: `/tmp/r42-replication-{1440,390}.png`.

Actual Git reopening/publication acceptance for replicated forms remains before live activation. Existing byte-identical metadata round-trip tests pass; no new replica guests were deployed for this UI integration.

Automatic allocation requires the backend `nic_key` extension in PR138. Incomplete network declarations show a preparation error before the reservation panel is offered. Durable allocation ownership, subnet/VNet reservation, deployment growth/resume and destructive shrink remain separate backend work.
