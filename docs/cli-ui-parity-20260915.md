# CLI, TUI and browser coverage — 15 September 2026

**The UI does not yet cover everything available from the CLI.** It implements
the main project authoring and deployment workflows, with additional reviewed
browser workflows for Git, snapshots and guest configuration. Several operator
and infrastructure functions still need UI/API integration.

This comparison uses the **selected `pve01 dev_deployer_ui_lab` range42-context**,
not an arbitrary checkout or the screenshots from another SDN branch. The
selected wrapper/TUI does **not** contain `networks-*` or firewall menu commands.
Its environment does expose firewall and alias devkit primitives. Neither fact
means those capabilities are absent from Hyde's other branches. No Hyde code
was changed or rerun for this audit.

## Source and context evidence

The release session selected this context and reloaded its SSH keys before the
application deployment. Its selection log confirms the sourced workspace and
scenario; the workspace environment binds repositories under `/home/ppa/range42`.
The installed `/home/ppa/range42-context.sh` was compared byte-for-byte with the
selected core source and matches. The audit reused that active context without
switching it during deployment.

| Reviewed source | Revision |
| --- | --- |
| Context core / wrapper / TUI | `c15d0079cc43f56f9bccc335ae7c79d3ccf0c825` |
| Context playbooks, including application installer | `d7f6e3f44bb9ebdb9e33d97fc15d85d1e807a513` |
| Context controller | `4fab980758db2aac28f9c9e1a220bdc3c8462c40` |
| Context devkit | `ce77237201b43b6d5b14d1f76e1a91aba70dc0e3` |
| Context catalog | `773dcb8581097e14a2ddd073a70c0b8af868394a` |
| UI application source | `ccc0cd9e5c1ac66ea0948739c83eaa52ce3ac50b` |
| API application source | `33e5114c016e2041c917e0d4b2d835c677f3d17f` |

Cross-repository CI pairs the `feat/settings-catalog-refresh-20260915` branches;
the API branch points to the reviewed API revision above. The backend `dev`
fallback does not yet contain this release’s concrete scenario contract.

The [actual TUI command catalog][tui] and [wrapper dispatch][wrapper] establish
which commands are exposed. The [native migration report][migration] records
successful deployment through this context and preservation of the backend's
separately installed automation runtime. **Installer checkout and API execution
runtime are different bindings:** selecting the former does not upgrade the
latter. The preserved runtime is described by the earlier
[capability matrix](ui-backend-capability-matrix.md); its historical missing-feature
rows must be checked against current application source, as below.

## Current coverage

“Implemented” means a current UI path and its API/provider contract exist. It
does not mean every target, permission, storage type or guest workflow has fresh
live acceptance. “Integration gap” assigns work to the UI/API, not a presumed
defect in Hyde's implementation.

| Actual CLI/TUI or selected devkit feature | Current UI/API coverage | Remaining work / owner |
| --- | --- | --- |
| `use`, `current`, `status`, `init`, workspace inventory | **Partial equivalent.** Settings selects browser backend profiles, tests readiness and registered targets; projects retain their target. Sources registers public/private catalogs. This is not the bootstrap wizard or server-side Proxmox registration. [Settings](settings-workflows.md) | UI/API: complete safe administrator host registration/edit/removal before exposing it; existing host API primitives are present. Bootstrap/context administration remains an operator workflow. |
| `deploy`, `deploy-vms`; scenario Ansible configuration | **Implemented within the concrete VM contract.** Catalog handoff/append, VM/network authoring, SDN default, pinned Git Save, preflight and full/configure attempts exist. Files, scripts, playbooks, roles and verified bundles can be attached in execution order. [Authoring](concrete-scenario-authoring.md), [composition](catalog-append.md) | UI/API: acceptance of the complete supported guest workflow. A template must already exist; the emitter does not reproduce every native scenario's template/bootstrap stages. |
| Scenario files and catalog content maintained in Git | **Implemented browser workflow.** GitHub/GitLab/Gitea, working branches, reviewed publication to multiple destinations and permission-dependent review/merge are exposed. [Provider evidence](provider-acceptance-20260910.md) | UI/API: preserve provider-specific refusals and separate outcomes per destination. Historical provider tests are not fresh connectivity proof for the selected installation. |
| `catalog-try`, `catalog-try-list`, `catalog-try-list-admin` | **Partial.** Catalog browse/create/customize/append and pinned role/bundle attachment exist. There is no equivalent button that runs the native one-usage-VM `catalog-try` smoke-test harness. Container metadata/authoring is not executable Docker/LXC scenario parity. [CLI catalog-try][catalogtry], [catalog onboarding](catalog-onboarding.md) | UI/API integration gap: expose the established testing workflow with its actual result contract. Do not equate publication or validation with successful execution. |
| `start`, `stop`, `stop-acpi`, `pause`, `resume` over scenario members | **Per-guest operations implemented.** Exact registered-host VM/LXC power operations and task-status checks exist. This is not the same reviewed all-scenario bulk action as the CLI's manifest sweep. [CLI lifecycle][lifecycle], [UI client](../src/services/proxmox/api.ts) | UI/API integration gap for scenario-wide lifecycle controls and aggregate results; underlying power primitives exist. |
| `snapshot`, `snapshot-list`, `revert` | **Reviewed concrete QEMU snapshot sets are implemented**, including create/list, rollback/delete plans, per-member outcomes, reconciliation and retention review. Current coverage supersedes the old matrix/emitter document's blanket “concrete snapshot unsupported” wording. [UI](snapshot-sets.md), [API][snapshots] | UI/API: storage-specific live acceptance and remaining documented recovery limits. Restricted to 1–64 owned QEMU guests, disk-only, non-atomic; rollback leaves guests stopped. LXC/memory snapshots and arbitrary native snapshot adoption are outside this workflow. |
| `delete-vms`, `delete`, `reset`, `delete-everything` | **Partial.** Owned concrete VM teardown and explicit allocation release exist. Native delete including templates, destructive cross-scenario deletion and delete/recreate reset are not equivalent UI workflows. [CLI dispatch][wrapper], [teardown](concrete-scenario-authoring.md#updating-content-and-removing-vms) | UI/API integration gap. Preserve exact ownership and explicit scope; teardown currently keeps shared networks/templates. No implied requirement to add a cross-scenario destructive shortcut. |
| Devkit VM firewall enable/disable and rule helpers | **Bounded runtime controls implemented:** VM firewall, scenario VM firewall sweep and declared SDN outbound NAT; observed DC/node/NIC state is shown separately. Guest OS firewall is available through verified Ansible content. [Devkit VM control][vmfw], [runtime API][runtime] | UI/API: fresh layer-specific acceptance where needed. These controls do not constitute arbitrary rule editing, custom management-port anti-lockout policy or a forwarding test. |
| Devkit node/DC firewall enable and VM alias add/list/delete | **Primitives exist; UI integration is missing.** Runtime operations explicitly permit only `vm_firewall`, `scenario_firewall`, `sdn_snat`. Node/DC arming and alias/policy-object authoring are not exposed by that API. [DC helper][dcfw], [alias helper][alias], [operation schema][operations] | UI/API owns exposure and target/permission/review integration. Confirm policy-object references, ordering and rename/delete behavior with Hyde when integrating; do not modify or describe existing primitives as missing. |
| SDN controls described in colleague's separate branch | **Selected-context menu parity not assessed for that branch.** Current application supports SDN planning/inventory, concrete bootstrap and bounded runtime SNAT. Broader selected-network deletion, arbitrary SDN types and multi-node lifecycle are not integrated. [Inventory API][sdn], [runtime API][runtime] | UI/API integration review against Hyde's specifically selected SDN branch is needed before claiming exact parity. The current context lacks those menu entries; this is not evidence against the separate implementation. |
| Template bootstrap during `deploy`; devkit guest/network/storage primitives | **Partial.** Template/ISO browsing, imported guest inspection, five-field configuration review and QEMU NIC edits/disk growth are implemented. NIC bridge/VLAN/firewall/link changes and grow-only existing data disks have reviewed v1 APIs. Template creation and general LXC/Docker provisioning remain absent. [Template stage][templates], [hardware API][hardware], [UI hardware dialog](../src/components/VmHardwareDialog.vue) | UI/API integration gaps for template creation and unsupported guest/device operations. Existing hardware support must not be reported as wholly missing; guest filesystem growth, device add/delete and existing-guest cloud-init editing remain outside it. |
| `debug`, `show-config`, `show-inventory`, `show-vault`, `ssh-reload` | **Adapted diagnostics, partial operator parity.** Deployment attempts, filtered Ansible events/log download, preflight and configuration/readback are exposed. The browser has no shell workspace/key-agent manager or raw decrypted-vault viewer. [Deployment view](../src/views/DeploymentDetail.vue), [CLI commands][tui] | UI/API: assess specific diagnostic omissions when encountered. Keep raw credential display and workstation administration distinct from deployment visibility. |

The immediate parity work is therefore application integration: alias/policy
objects and explicit host/DC controls, scenario-wide lifecycle/reset, native
catalog testing, and the remaining template/guest workflows. Existing snapshot,
NIC and disk controls need their documented acceptance rather than duplicate
implementation. The table records scope; it does not authorize changes to
Hyde's wrapper, SDN, controller or other upstream code.

This audit inspected source and existing context/deployment evidence. It ran no
CLI mutation, PVE mutation or fresh guest acceptance. Current application unit
and production-browser gates use controlled services; successful native app
deployment, readiness and preservation checks do not prove a newly authored
scenario booted, guest content executed, traffic filtered or a snapshot restored
application data. The [historical evidence section](ui-backend-capability-matrix.md#evidence-and-remaining-acceptance)
retains earlier results and their exact limits.

[tui]: https://github.com/range42/range42/blob/c15d0079cc43f56f9bccc335ae7c79d3ccf0c825/range42-context-tui.py#L235
[wrapper]: https://github.com/range42/range42/blob/c15d0079cc43f56f9bccc335ae7c79d3ccf0c825/roles/deployer.bootstrap/files/range42-context.sh#L1897
[catalogtry]: https://github.com/range42/range42/blob/c15d0079cc43f56f9bccc335ae7c79d3ccf0c825/roles/deployer.bootstrap/files/range42-context.sh#L1432
[lifecycle]: https://github.com/range42/range42/blob/c15d0079cc43f56f9bccc335ae7c79d3ccf0c825/roles/deployer.bootstrap/files/range42-context.sh#L973
[vmfw]: https://github.com/range42/range42-ansible_roles-debug-devkit/blob/ce77237201b43b6d5b14d1f76e1a91aba70dc0e3/proxmox_firewall.vm_id.enable_firewall.to.jsons.sh
[dcfw]: https://github.com/range42/range42-ansible_roles-debug-devkit/blob/ce77237201b43b6d5b14d1f76e1a91aba70dc0e3/proxmox_firewall.datacenter.enable_firewall.to.jsons.sh
[alias]: https://github.com/range42/range42-ansible_roles-debug-devkit/blob/ce77237201b43b6d5b14d1f76e1a91aba70dc0e3/proxmox_firewall.vm_id.add_iptables_alias.to.jsons.sh
[templates]: https://github.com/range42/range42-playbooks/blob/d7f6e3f44bb9ebdb9e33d97fc15d85d1e807a513/scenarios/dev_deployer_ui_lab/01_templates-bootstrap/_main.yml
[operations]: https://github.com/range42/range42-backend-api/blob/33e5114c016e2041c917e0d4b2d835c677f3d17f/app/schemas/v1/runtime.py
[runtime]: https://github.com/range42/range42-backend-api/blob/33e5114c016e2041c917e0d4b2d835c677f3d17f/docs/runtime-controls.md
[sdn]: https://github.com/range42/range42-backend-api/blob/33e5114c016e2041c917e0d4b2d835c677f3d17f/docs/sdn-inventory.md
[snapshots]: https://github.com/range42/range42-backend-api/blob/33e5114c016e2041c917e0d4b2d835c677f3d17f/docs/snapshot-sets.md
[hardware]: https://github.com/range42/range42-backend-api/blob/33e5114c016e2041c917e0d4b2d835c677f3d17f/docs/imported-qemu-hardware.md
[migration]: https://github.com/range42/range42-deployment/blob/6421562fb1701a379b3eb4bbbb268e5a4ea5f31c/docs/24-native-backend-migration.md
