# Append catalog items to an existing project

The Catalog **Add to project** action prepares a local preview before applying one addition. It preserves the project's identity, repository binding, backend target, existing files and allocation ownership. Previewing and applying do not create a Git branch or deploy anything. Each accepted addition records its source repository, exact commit SHA and added graph/content IDs in public `meta.json.ui_catalog_imports`; provider credentials and allocation tokens are excluded.

## Supported source forms

- Canonical `range42.yaml` lab, gamenet and component entries append their complete validated node graph. Nodes retain their actual types, template references, resource configuration, networking and inline attachments. Every node ID, parent, network edge, attachment target and container host reference is remapped within that addition. Repeated imports receive distinct graph IDs and bounded VM names. Variables with conflicting definitions or effective overrides are refused.
- Ansible roles copy their complete validated pinned tree and append a role content item to an explicitly selected existing VM. Existing different file bytes at the same path are refused. Identical role files can be reused by separate content items without overwriting anything.
- Supported Compose workloads use the separately validated workload adapter and an explicit existing VM. They become copied files plus a playbook content item, not invented VM/template nodes. The preview exposes the workload's prerequisites, ports, identity and limitations. An optional ordered host-port override lets multiple instances use different guest ports; the adapter preserves the original payload and checks conflicts within the project. Unsupported Compose features and PoC metadata without a complete Compose workload are refused.

The default catalog's new portable Linux blueprint uses the versioned `05_topology_layer/box_templates/systems.clone.linux_cloudinit/v1.0.0/range42.yaml` layout. It requires local template selection and network configuration. Catalog sources must point to a revision containing that descriptor before it appears. A catalog `container` kind runs inside a selected VM. Blueprint storage preferences prefill the Scenario clone destination. Review this field before generating: a selected pool receives new full clones; blank inherits template storage. Backend preflight checks pool availability, VM-image support, free space and allocation permission. Existing guest disks are not moved.

## Scenario review and Git saving

An addition cannot inherit a source deployment, reservation or live VM identity. Existing project allocation ownership stays intact so it can be reviewed or released; it does not authorize the newly changed graph. Network addresses and SDN names are preserved as authored and require a fresh allocation review. Appending a network does not create, reconcile or delete any live network.

For role/workload content, when the prior structured scenario's generated files exactly match the current compiler, the service regenerates only those already owned paths. It preserves other files and restores the complete scenario and public addition provenance after Git reopening.

A topology change, an unfinished scenario, or manually edited generated files require **Scenario → Review → Generate files** before Git saving. The save guard derives this from the current graph, scenario and file bytes; there is no hidden flag to reset. The local draft remains available, and no provider write occurs while the guard refuses. This avoids saving settings that would reopen only as files. A canonical project without a scenario can still be saved and reopened as a canvas draft.

## Source validation

`catalogProjectAppend.test.js` exercises immutable/repeated graph append, NIC/parent/attachment/host remapping, templates/resources, variable and file conflicts, execution-identity refusal, role target selection, public provenance through the actual Git serializer/reopener, safe generated-file ownership, and refusal before provider lookup for a pending Scenario review. This is source validation with local provider fixtures; it is not shared-host or guest deployment acceptance.

## Editor and catalog workflow

Use **Add from catalog** in a project to keep its context while browsing, or choose **Add to project** on a catalog card or detail page. Select the destination project and, for a role or Compose workload, its existing VM. Review the populated settings, then choose **Add and keep browsing** to compose several items or **Add and open project** to inspect the result. **Create project**, repository saving and publication remain separate actions.

Canonical graph additions open their first node's settings with `?tab=canvas&node=<id>`. Role and workload additions open their actual authored file with `?tab=config&file=<path>`. Config handles file changes, loading errors, unsaved-content conflicts and project navigation without applying stale content. Tabs support direct links, browser navigation and keyboard selection. Settings shows project/repository/backend controls and a list of added catalog origins. History currently shows the saved topology file's history, with that scope labelled.

Canonical `memory_mb`/`disk_gb` values and existing UI `memory`/`diskSize` values prefill VM and Scenario settings. Editing preserves one consistent field representation. Hydrating a VM does not overwrite its saved resources with cached template defaults; defaults apply only after an explicit template selection.

## Compose support

The adapter supports up to 32 services with literal images or supported local Dockerfile builds. It validates service dependencies, literal non-secret environment mappings, private named volumes, pinned read-only relative bind mounts and explicit healthchecks. External volumes, arbitrary host paths, undeclared dependencies and cycles are refused. The complete pinned regular-file tree is retained, while `runtime.compose.yml` carries reviewed host-port and workload-identity settings. Ports can be overridden in source service/mapping order; overlapping ports within a stack or among known workloads on the same VM are refused, including workloads whose cleanup has only been staged.

Ansible checks the local guest Docker daemon, Compose availability and owned destination/container/network/volume identities. Startup uses `compose up --wait --wait-timeout 120`; declared healthchecks must pass, and services without healthchecks are checked for running state only. Docker Compose v2 or later with these options is required. [Docker documents the readiness flags](https://docs.docker.com/reference/cli/docker/compose/up/).

Each import also generates `cleanup.yml`. In Scenario, **Use cleanup playbook** stages that action without running it; review files, save and explicitly run Configure against the existing deployment. Cleanup checks resource labels and the exact installed Compose checksum before `compose down`, then confirms the named containers are absent. It preserves named volumes, images and copied files. Remove the content item after successful cleanup; deleting an editor row alone does not execute remote cleanup. [Docker documents the resources removed by down](https://docs.docker.com/reference/cli/docker/compose/down/).

The adapter does not install Docker or build a Proxmox template. Unresolved build inputs and binary source files require further support. Mutable image tags and external package availability remain external dependencies. Existing workload files edited after import need a fresh review before another append can rely on their port record. Local tests use the real backend validator, local Ansible with a disposable fake Docker command, and Compose configuration without a daemon; no live guest execution is implied.

## Runtime secret bindings

For Compose environment entries such as `POSTGRES_PASSWORD: "${DB_PASSWORD}"`, the append dialog accepts a JSON mapping from the placeholder name to a backend vault variable, for example `{"DB_PASSWORD":"workload_password"}`. Only names and placeholders are copied to Git. Review adds missing `secret: true` variable declarations and refuses conflicts with non-secret variables or saved defaults. Existing declarations appear in Variables with a vault-managed hint; the UI does not accept secret-value overrides for Git storage.

The operator must provide each value in the deployment workspace's `secrets/default_vault.yml`. The generated playbook loads that vault, checks required values, and supplies them only to the Compose command environment with `no_log: true`. Missing values stop execution before Docker mutation. The Compose source and runtime YAML keep placeholders; neither receives resolved secret values. Reserved process-control environment names and undeclared/unused bindings are rejected. Vault rotation takes effect when the reviewed Configure operation runs again; running containers are not changed automatically.

## Author a Compose catalog item

Use **New Compose workload** in Catalog. Enter its name, description, Compose YAML and any complete local dependencies as a JSON object of relative file paths to text contents. Preview uses the same supported Compose contract as Add to project. Files are created under `03_container_layer/docker/admin/<name>` with native metadata, README and Compose source.

Secret placeholders can be declared by name; values are never entered here. When adding the item to a project, bind its placeholders to backend vault variables. The file preview is invalidated on every edit. Publication uses the existing create-only review, branch, PR/MR and multi-destination flow.
