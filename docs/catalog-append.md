# Append catalog items to an existing project

The Catalog **Add to project** action prepares a local preview before applying one addition. It preserves the project's identity, repository binding, backend target, existing files and allocation ownership. Previewing and applying do not create a Git branch or deploy anything. Each accepted addition records its source repository, exact commit SHA and added graph/content IDs in public `meta.json.ui_catalog_imports`; provider credentials and allocation tokens are excluded.

## Supported source forms

- Canonical `range42.yaml` lab, gamenet and component entries append their complete validated node graph. Nodes retain their actual types, template references, resource configuration, networking and inline attachments. Every node ID, parent, network edge, attachment target and container host reference is remapped within that addition. Repeated imports receive distinct graph IDs and bounded VM names. Variables with conflicting definitions or effective overrides are refused.
- Ansible roles copy their complete validated pinned tree and append a role content item to an explicitly selected existing VM. Existing different file bytes at the same path are refused. Identical role files can be reused by separate content items without overwriting anything.
- Supported Compose workloads use the separately validated workload adapter and an explicit existing VM. They become copied files plus a playbook content item, not invented VM/template nodes. The preview exposes the workload's prerequisites, ports, identity and limitations. An optional ordered host-port override lets multiple instances use different guest ports; the adapter preserves the original payload and checks conflicts within the project. Unsupported Compose features and PoC metadata without a complete Compose workload are refused.

The default catalog currently has role/container/gamification metadata, but no canonical VM topology or VM-template identifiers. Canonical topology append therefore serves custom sources; a catalog `container` kind alone never implies a deployable VM. Canvas types unsupported by the concrete compiler remain explicitly authoring-only.

## Scenario review and Git saving

An addition cannot inherit a source deployment, reservation or live VM identity. Existing project allocation ownership stays intact so it can be reviewed or released; it does not authorize the newly changed graph. Network addresses and SDN names are preserved as authored and require a fresh allocation review. Appending a network does not create, reconcile or delete any live network.

For role/workload content, when the prior structured scenario's generated files exactly match the current compiler, the service regenerates only those already owned paths. It preserves other files and restores the complete scenario and public addition provenance after Git reopening.

A topology change, an unfinished scenario, or manually edited generated files require **Scenario → Review → Generate files** before Git saving. The save guard derives this from the current graph, scenario and file bytes; there is no hidden flag to reset. The local draft remains available, and no provider write occurs while the guard refuses. This avoids saving settings that would reopen only as files. A canonical project without a scenario can still be saved and reopened as a canvas draft.

## Source validation

`catalogProjectAppend.test.js` exercises immutable/repeated graph append, NIC/parent/attachment/host remapping, templates/resources, variable and file conflicts, execution-identity refusal, role target selection, public provenance through the actual Git serializer/reopener, safe generated-file ownership, and refusal before provider lookup for a pending Scenario review. This is source validation with local provider fixtures; it is not shared-host or guest deployment acceptance.
