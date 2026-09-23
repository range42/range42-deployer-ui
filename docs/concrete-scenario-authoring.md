# Authoring and running concrete scenarios

The editor writes executable Ansible files under `scenarios/<name>/` in the project's Git repository. SDN is the default network setup. Generation uses Hyde's `proxmox/sdn_network.bootstrap` bundle and the current `proxmox/vm.bootstrap` contract; it does not generate `_universal` topology input.

Native contract update: 22 September 2026, playbooks `6dcf31b` and controller
`617b57c`. The selected backend reports its installed support through
`GET /v1/proxmox/runtime-capabilities`. Native VM bootstrap supports one NIC and
template CPU/memory/disk sizes. Unsupported requested overrides remain in the
draft; choose **Use template CPU, memory and disk size** explicitly to clear them.
An offline preview is labelled unverified and still requires backend preflight.

## From a new project to deployment

1. Select the backend and register a Git Source. Public catalog indexing does not need a browser publishing token.
2. In the editor, open **Repository**, select the source, repository, base branch and optional project subdirectory. Add a browser publishing credential if needed. Connecting records settings; **Save** performs the Git write. Automatic fork fallback can save a read-only upstream project in the connected account's verified personal fork.
3. Draw VM and network-segment nodes and connect every required NIC. Review the primary management NIC, stable source NIC keys and each interface's address; one VM can have up to 32 NICs.
4. Open **Scenario**. Choose a concrete scenario name, SDN zone, VNet names, IPv4 subnets, gateways and outbound NAT choices. Existing `vmbr` bridges are an explicit compatibility option.
5. Assign each VM an unused VMID, an existing template VMID, a unique name, NIC addresses and an SSH user. CPU cores, memory and supported disk-growth overrides are optional. Disk shrinking and template creation are not implemented by this emitter. For team/user replication, review explicit instance identities and network assignments in the [replication panel](concrete-replication.md). The [reservation panel](scenario-allocation.md) can reserve and apply all expanded VM/NIC assignments.
6. Add content in execution order, then choose **Review generated files**. **Use scenario files** stores the reviewed source configuration and literal generated files and saves them when a repository is connected. Review alone does not create guests or network resources.
7. Choose **Deploy**. The editor saves the current snapshot, registers its actual repository binding with the selected backend and opens the deployment form with the saved commit and generated scenario name. Choose the target host and confirm the pins. On the deployment page, run preflight, review its results and explicitly start the deployment.

Registration uses `PUT /v1/projects/{id}` with only the project name, source, repository, branch strategy and subdirectory. The browser retains a mapping per backend and repository binding. If a binding already has deployments, a different repository gets a new project identity rather than changing historical deployments. Private forks need backend Git read credentials as well as the separate browser publishing connection.

## Generated files and order

| File | Purpose |
| --- | --- |
| `main.yml` | Imports network setup, VM bootstrap and guest configuration, with the reviewed firewall stages at their defined boundaries. |
| `00_firewall_pre.yml` | When selected: validates SSH sources, reports native firewall status and optionally prepares shared management accepts. |
| `00_networks.yml` | Imports Hyde's SDN bootstrap bundle with explicit zone/VNet/subnet/gateway/NAT values. Omitted for existing bridges. |
| `01_vm_bootstrap.yml` | Imports the VM bootstrap bundle once per VM, cloning the selected template and configuring cloud-init. |
| `02_firewall_guests.yml` | When selected: checks every VM's deployment ownership and prepares SSH accepts using exact NIC CIDRs. |
| `configure.yml` | Runs only the selected files, scripts, playbooks and bundles on existing guests. |
| `99_firewall_finalize.yml` | When selected: checks ownership again, arms guests only on reviewed opt-in, then reports status. |
| `teardown.yml` | Checks ownership, shuts down and removes this deployment's VMs, and waits for Proxmox task completion. Shared networks remain in place. |
| `hosts.yml` | Declares matching guest names and addresses, a local API host and an SSH hypervisor host. |
| `manifest/scenario_vms.json` | Declares the concrete VMIDs, names, addresses, networks and template references checked by the backend. |
| `manifest/scenario_networks.json` | Declares SDN objects or required existing bridges for network preflight. |
| `manifest/scenario_firewall.json` | Stores reviewed arming, shared management-rule consent and inherited/explicit SSH sources. |
| `manifest/scenario_instances.json` | Maps source/team/user identities to explicit VM/network instances when replication is enabled. |
| `manifest/scenario_roles.json` / `scenario_bundles.json` | Records imported role trees or sealed bundle attachment provenance when present. |

VM inventory aliases and bootstrap variables derive from the same configuration. The emitter checks duplicate VMIDs and addresses, overlapping subnets, gateway conflicts, missing assets and canvas/configuration mismatches. Reopening Scenario includes newly drawn nodes while retaining existing explicit configuration.

Generated control files are regenerated on Save. Edit source content files in the **Config** tab; use the Scenario form for generated control-file changes. Existing unrelated project files are preserved. Generation refuses to replace an independently authored scenario at the same path.

New drafts select native firewall preparation with guest arming off. Existing
saved scenarios opt into the extra stages explicitly. Inherited SSH sources come
from the existing backend workspace vault; reviewed restrictions accept IPv4 /32
sources and add the exact networks of all manifest NICs. The adapter calls native
per-VM declaration primitives, avoiding the native manifest sweep's /24/template-IP
assumptions. Existing broader accepts remain; preparation does not tighten them.
The backend pins `FIREWALL_ARM_VMS=NO` unless the saved policy explicitly selects
arming, even when the workspace vault says YES.

Preparing shared datacenter/node management accepts requires the scenario choice
and backend administrator setting `RANGE42_SCENARIO_MANAGEMENT_ACCESS=1`. This is
disabled by default and does not enable the datacenter/node firewall switches.
Guest arming remains a separate choice after service configuration. Source
restrictions and firewall preferences cannot be overridden through public content
variables. Configure-only attempts do not rerun the firewall preparation stages.

## Files, scripts, playbooks and bundles

- **File:** author or import a file at a scenario-relative path and choose an absolute guest destination and file mode. Text and supported binary assets retain their bytes. The generated task uses `ansible.builtin.copy`; file contents are not processed as a Jinja template.
- **Script:** author a script with its interpreter line. `ansible.builtin.script` transfers and runs it on the selected guest.
- **Playbook:** author a complete playbook whose plays use `hosts: "{{ global_vm_ssh_name }}"`, or the exact selected guest name. The scenario imports it and supplies the selected guest name/address.
- **Role:** import a pinned supported catalog role, review its dependencies and variables, and attach it to an explicit VM in execution order. Its validated role files are copied into the scenario; unresolved external dependencies are refused.
- **Bundle:** select a VM-compatible bundle from the library and resolve it against the installed runtime. The backend verifies source/content/dependency provenance; a same-named path from another revision is not executable proof. Provide documented non-secret variables. The scenario imports the verified bundle after all VMs finish bootstrap.

File and script tasks use privilege escalation. Bundle and imported-playbook behavior follows their own definitions. All content is executable project code and is shown before it is saved.

Declared public variables from `baseDoc.env` and overrides from the Variables tab become configure-play variables. Precedence is: declared default, project override, then explicit per-item variable. Connection, Proxmox, target-host and deployment-ownership names are reserved. Secret declarations may refer to workspace-provided values, but literal secret defaults, project overrides and per-item assignments are rejected before generation. Keep secrets in the backend workspace vault.

## Updating content and removing VMs

The deployment page offers **Apply saved content and configuration** for concrete deployments. Save the edited project first, then choose its full commit SHA. The field defaults to the latest saved commit of the matching project in this browser when that backend/repository registration is known. Run the scoped preflight and start the checked action. Editing the revision invalidates the previous check.

Configure runs the candidate commit's `configure.yml`. The backend requires its VM manifest, network manifest and inventory to match the original deployment, rejecting changes to declared targets. Imported Ansible code still runs with the configured runner permissions. The deployment retains its original pin, and each attempt records the revision it executed.

**Remove deployment VMs** runs the original scenario's teardown entrypoint after scoped preflight and codename confirmation. The generated clone description contains the exact `range42-deployment:<deployment-id>` ownership marker. Teardown verifies the marker, name, resource type and target node again immediately before mutation. Missing VMs are skipped, templates are never deleted, and failed shutdown or deletion stops the attempt. It does not delete the deployment record or its history.

## Backend prerequisites and current bounds

The backend needs an exact installed playbooks/controller/catalog dependency profile, with `RANGE42_BUNDLE_DIR` and Ansible role paths bound to that profile. The native application adapter recognizes unchanged playbooks `6dcf31b` and controller `617b57c` by source digests. A branch name does not authorize execution or substitute for the installed runtime fingerprint. Source changes require another reviewed adapter contract. No private marker files need to be added to Hyde's native repositories.

The backend supplies selected-host API credentials and runtime SSH addresses. Existing bundles read `<workspace>/secrets/default_vault.yml`; the workspace also needs suitable guest cloud-init keys and SSH access to the hypervisor. Generated inventory uses an explicitly configured jump SSH command, accepting new host keys into the workspace's known-hosts file and continuing to reject changed keys. No API credentials or private keys are generated into Git.

The source model preserves explicit VM instances, multiple NICs, CPU/memory/disk-growth choices and reviewed team/user replication. Execution is limited to the selected runtime’s advertised support; the reviewed native bootstrap currently requires one NIC and template resource sizes. LXC/Docker/router/firewall-node execution and template creation remain unsupported. Supported legacy task/variable attachments have an explicit review-and-apply migration that preserves original assets; unsupported forms still block generation rather than being omitted. The generated scenario does not expose native reset/rollback/snapshot playbook actions, even when similarly named files exist. Reviewed QEMU snapshot sets, including rollback and retention review, are available through the separate [Snapshot sets](snapshot-sets.md) workflow. The generated workflow provides full deployment, configure and VM teardown. Teardown preserves shared networks and does not release [durable deployment allocations](deployment-allocations.md) automatically.
