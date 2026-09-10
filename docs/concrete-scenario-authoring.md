# Authoring and running concrete scenarios

The editor writes executable Ansible files under `scenarios/<name>/` in the project's Git repository. SDN is the default network setup. Generation uses Hyde's `proxmox/sdn_network.bootstrap` bundle and the current `proxmox/vm.bootstrap` contract; it does not generate `_universal` topology input.

## From a new project to deployment

1. Select the backend and register a Git Source. Public catalog indexing does not need a browser publishing token.
2. In the editor, open **Repository**, select the source, repository, base branch and optional project subdirectory. Add a browser publishing credential if needed. Connecting records settings; **Save** performs the Git write. Automatic fork fallback can save a read-only upstream project in the connected account's verified personal fork.
3. Draw VM and network-segment nodes and connect each VM to one network.
4. Open **Scenario**. Choose a concrete scenario name, SDN zone, VNet names, IPv4 subnets, gateways and outbound NAT choices. Existing `vmbr` bridges are an explicit compatibility option.
5. Assign each VM an unused VMID, an existing template VMID, a unique name and guest address, its connected network, and an SSH user. Templates provide CPU, memory and disk sizes; this emitter does not build templates or resize clones.
6. Add content in execution order, then choose **Review generated files**. **Use scenario files** stores the reviewed configuration and files and saves them when a repository is connected.
7. Choose **Deploy**. The editor saves the current snapshot, registers its actual repository binding with the selected backend and opens the deployment form with the saved commit and generated scenario name. Choose the target host and confirm the pins. On the deployment page, run preflight, review its results and explicitly start the deployment.

Registration uses `PUT /v1/projects/{id}` with only the project name, source, repository, branch strategy and subdirectory. The browser retains a mapping per backend and repository binding. If a binding already has deployments, a different repository gets a new project identity rather than changing historical deployments. Private forks need backend Git read credentials as well as the separate browser publishing connection.

## Generated files and order

| File | Purpose |
| --- | --- |
| `main.yml` | Imports network setup, VM bootstrap and guest configuration in that order. |
| `00_networks.yml` | Imports Hyde's SDN bootstrap bundle with explicit zone/VNet/subnet/gateway/NAT values. Omitted for existing bridges. |
| `01_vm_bootstrap.yml` | Imports the VM bootstrap bundle once per VM, cloning the selected template and configuring cloud-init. |
| `configure.yml` | Runs only the selected files, scripts, playbooks and bundles on existing guests. |
| `teardown.yml` | Checks ownership, shuts down and removes this deployment's VMs, and waits for Proxmox task completion. Shared networks remain in place. |
| `hosts.yml` | Declares matching guest names and addresses, a local API host and an SSH hypervisor host. |
| `manifest/scenario_vms.json` | Declares the concrete VMIDs, names, addresses, networks and template references checked by the backend. |
| `manifest/scenario_networks.json` | Declares SDN objects or required existing bridges for network preflight. |

VM inventory aliases and bootstrap variables derive from the same configuration. The emitter checks duplicate VMIDs and addresses, overlapping subnets, gateway conflicts, missing assets and canvas/configuration mismatches. Reopening Scenario includes newly drawn nodes while retaining existing explicit configuration.

Generated control files are regenerated on Save. Edit source content files in the **Config** tab; use the Scenario form for generated control-file changes. Existing unrelated project files are preserved. Generation refuses to replace an independently authored scenario at the same path.

## Files, scripts, playbooks and bundles

- **File:** author text at a scenario-relative path and choose an absolute guest destination and file mode. The generated task uses `ansible.builtin.copy` with the file as its source; file contents are not processed as a Jinja template.
- **Script:** author a script with its interpreter line. `ansible.builtin.script` transfers and runs it on the selected guest.
- **Playbook:** author a complete playbook whose plays use `hosts: "{{ global_vm_ssh_name }}"`, or the exact selected guest name. The scenario imports it and supplies the selected guest name/address.
- **Bundle:** choose a path relative to `RANGE42_BUNDLE_DIR`, ending in `/main.yml`, and provide the bundle's documented non-secret variables. The scenario imports that bundle after all VMs finish bootstrap.

File and script tasks use privilege escalation. Bundle and imported-playbook behavior follows their own definitions. All content is executable project code and is shown before it is saved.

Declared public variables from `baseDoc.env` and overrides from the Variables tab become configure-play variables. Precedence is: declared default, project override, then explicit per-item variable. Connection, Proxmox, target-host and deployment-ownership names are reserved. Secret declarations may refer to workspace-provided values, but literal secret defaults, project overrides and per-item assignments are rejected before generation. Keep secrets in the backend workspace vault.

## Updating content and removing VMs

The deployment page offers **Apply saved content and configuration** for concrete deployments. Save the edited project first, then choose its full commit SHA. The field defaults to the latest saved commit of the matching project in this browser when that backend/repository registration is known. Run the scoped preflight and start the checked action. Editing the revision invalidates the previous check.

Configure runs the candidate commit's `configure.yml`. The backend requires its VM manifest, network manifest and inventory to match the original deployment, rejecting changes to declared targets. Imported Ansible code still runs with the configured runner permissions. The deployment retains its original pin, and each attempt records the revision it executed.

**Remove deployment VMs** runs the original scenario's teardown entrypoint after scoped preflight and codename confirmation. The generated clone description contains the exact `range42-deployment:<deployment-id>` ownership marker. Teardown verifies the marker, name, resource type and target node again immediately before mutation. Missing VMs are skipped, templates are never deleted, and failed shutdown or deletion stops the attempt. It does not delete the deployment record or its history.

## Backend prerequisites and current bounds

The backend needs `RANGE42_BUNDLE_DIR` pointed at the playbooks SDN branch's `bundles/` and the matching controller and catalog roles available through Ansible's role path. The validated SDN branch is `feat-sdn-implementation` in both playbooks and proxmox-controller; SDN does not require waiting for a merge into `dev`.

The backend supplies selected-host API credentials and runtime SSH addresses. Existing bundles read `<workspace>/secrets/default_vault.yml`; the workspace also needs suitable guest cloud-init keys and SSH access to the hypervisor. Generated inventory uses an explicitly configured jump SSH command, accepting new host keys into the workspace's known-hosts file and continuing to reject changed keys. No API credentials or private keys are generated into Git.

This emitter supports explicit VM instances with one network interface each. Automatic team replication, LXC/Docker/router/firewall nodes, template creation and resource resizing are not implemented. Legacy AttachmentManager rows must be converted to the scenario Content list before generation. Unsupported input blocks generation rather than being omitted. Reset, rollback and snapshot actions are not implemented for concrete scenarios, even when similarly named files exist. The generated workflow provides full deployment, configure and VM teardown.
