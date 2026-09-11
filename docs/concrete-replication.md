# Concrete scenario replication

Replication is authored explicitly in `scenario.replication` version 1. The compiler preserves the original source canvas and configuration, expands it once, and emits the existing literal v3 VM/network files plus `manifest/scenario_instances.json`. It does not use `_universal` or the older overlay preview expander.

The authoring panel supports stable team/user identities, editable display labels, explicit source VM/network scopes, and reviewed per-instance VMIDs, IPs, VNets, subnets, gateways and SNAT. Shared scopes keep the source assignment. Scoped VM names are bounded to 63 characters with deterministic hash suffixes. Suggested SDN VNet names are bounded to eight characters and still require review. Existing bridges require explicit names up to 15 characters and cannot declare managed SNAT.

Executable scope maps are authoritative. They are initialized from canvas hints when replication is enabled; a differing valid original hint produces a preview note, not a hidden canvas mutation. Unknown scope values and nested replication domains remain errors.

## Identity and connectivity

`scenario_id`, source IDs, team IDs, user IDs and source NIC keys use 1–128 ASCII letters, numbers, dots, underscores or hyphens. Roster order and display labels do not determine identity. Instance keys are `vm-` or `net-` followed by the full SHA-256 digest of UTF-8 compact JSON `[scenario_id, source_node_id, team_id, user_id]`; absent cohort IDs are `null`.

VM and network scopes are separate. A VM can attach to its matching user network, its matching team network, or an explicitly shared network. A shared VM cannot silently fan out to scoped networks, and a team VM cannot select an arbitrary user's network. Shared subnet internet policy is shown explicitly. Per-user isolation requires per-user network assignments.

NIC keys are exact source canvas edge IDs. Explicit keys preserve parallel links, primary interface identity and reviewed addresses across ordering changes. Old parallel links without keys require operator mapping rather than guessing. All replicated content targets the expanded literal hosts in source content order; shared file bytes remain one repository file, and sealed bundle resolutions remain unchanged.

Limits are 64 teams, 64 total users, 64 expanded VMs, 32 networks, 32 NICs per VM and 256 total NICs. Oversized plans fail before assignment or publication. Subnet/VNet claims are not created by the preview. Removing a roster entry does not remove a deployed resource or release a remote reservation.

## Code contracts

- `expandScenarioReplication({scenario,nodes,edges})` requires explicit scoped assignments and returns expanded rows, a matching literal canvas, instance manifest, counts and warnings. `emitConcreteScenario` performs the complete address/resource/file validation and returns the original authoring scenario.
- `planScenarioReplication` returns the same identities and counts while allowing unassigned rows. It returns `instances`, `network_instances`, `vms`, `networks`, `counts` and `warnings`, **without an executable manifest**. Planning does not mutate the source and does not call a backend.
- `projectAuthoring.ts` preserves replication configuration, primary NIC identity and source NIC keys in the common save/publication snapshot. Its whitelist removes ownership/credential fields and rejects nested values in scalar assignment fields. Reopening recompiles the original sources to verify generated ownership; it does not expand previously expanded rows again.

## Checkpoint and pending verification — 11 September 2026

The compiler checkpoint passed 1,196 tests, full lint and production build on the updated dependency baseline. The subsequent panel/persistence checkpoint passed 97 focused tests, scoped lint and scoped strict TypeScript checks. It includes a component test that authors two teams with explicit networks/VMIDs/IPs and applies the literal output, plus metadata reopening and byte-identical recompilation tests.

Before merging or deploying the panel checkpoint, complete production browser acceptance (desktop/mobile and ordinary HTTP), the combined full UI suite/build, and actual Git reopening/publication acceptance for replicated forms. Existing replication maps also need an explicit reconciliation action when canvas sources are removed or added after a roster has been configured; strict source matching currently reports the inconsistency.

Automatic allocation of replicated instances is the next integration. The source-only reservation panel is hidden while replication is enabled to avoid reserving a single placeholder VM. The planning helper exposes every literal instance for the upcoming backend `nic_key` extension; connect it only after explicit network assignments are valid. Durable allocation ownership, subnet/VNet reservation, deployment growth/resume and destructive shrink remain separate backend work.
