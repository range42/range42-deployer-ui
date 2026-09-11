# Reopen a saved project from Git

Choose **Open from Git** on the dashboard. Select a configured Git source, repository, branch and optional project directory, then preview. An optional browser Git token is stored with that source; it is never included in the imported project or Git metadata. Private backend cloning still uses the separate repository connection credential setting.

The preview shows the exact branch/commit, proposed local identity, new working branch, graph size, authoring status and file list. Import does not write a remote branch. Existing local projects remain intact. A valid unused saved project identity is retained so an explicit matching backend repository registration can reconnect deployment history; an identity collision creates a new local copy. Names alone never associate repositories or deployments.

The first Save creates a unique `range42-ui/open-…` branch from the reviewed commit SHA, even if the selected branch has advanced. Files outside the UI manifest remain in that Git tree. Reconnecting the same repository retains this seed. Forks use the same pinned seed; an unavailable commit fails rather than falling back to another branch. Base-branch publication remains a separate explicit action.

## Saved documents

- `topology.json` remains the canonical executable canvas document.
- `canvas_layout.json` retains the existing layout fields and adds `ui_canvas: {version: 1, nodes, edges}`. This preserves editable canvas data and parallel NIC connections without persisting VueFlow runtime state.
- `meta.json` adds `ui_project: {version: 1, project_id, scenario?, generated_paths, variables}`. Ordinary saves and publication previews build this metadata from the same captured snapshot. `scenario` contains explicit VM, network, content and bundle parameters/provenance. Variable definitions retain vault-backed secret declarations without their values.
- `overlay.json`, declared text files and binary assets use the existing lossless file contract. Binary metadata contains size/type only; payloads are not duplicated in `meta.json`.

The load-only `ProjectState.revision` and local `git_opened` notice identify the original read. Neither Git credentials nor allocator lease ownership are serialized into `ui_project`. Allocation leases must be renewed in the current browser before deployment. Backend credentials still come from the operator workspace.

## Imported ownership and validation

All project documents and declared files load from one resolved branch HEAD. A missing selected branch fails; missing files are not recovered from `main`.

Both save and import validate the public canvas field set, unique node/edge identities, existing endpoints and parents, configuration depth and credential exclusion. The restored canvas must agree with canonical topology. Limits are 1,024 nodes, 4,096 edges and 32 nested configuration levels. Existing browser limits remain 1 MiB per file and 2 MiB per snapshot; browser quota failure preserves previous projects. Larger assets remain a limitation requiring separate storage work.

Before restoring structured forms, the current scenario emitter recompiles the snapshot and verifies the exact set and content of generated files. Missing, edited, extra-owned or incompatible generated paths produce a conflict preview. **Files-only import** explicitly drops scenario/generated-path ownership and retains the reviewed file bytes. Save then preserves manually maintained files until the user explicitly configures or reconciles a scenario. Malformed variable declarations block import so secret classifications cannot be silently lost. Legacy projects without structured metadata can restore their canvas/files, but forms cannot be reliably inferred from playbooks.

This comparison detects divergence; it is not an Ansible sandbox or an authorization proof. Backend preflight still checks bundle provenance and runtime constraints.

## Provider and HTTP compatibility

Branch creation from a commit is supported by the existing [GitHub Git references API](https://docs.github.com/en/rest/git/refs) and [GitLab branches API](https://docs.gitlab.com/api/branches/). Live tests also cover Gitea. Gitea's [branch API has a 100-character limit](https://github.com/go-gitea/gitea/blob/v1.24.7/modules/structs/repo.go); oversized generated publication names use a stable SHA256 identifier. Existing short names remain unchanged. The synchronous `@noble/hashes` implementation avoids dependence on HTTPS-only `SubtleCrypto`.

All browser project/content/publication ID callers use a common UUID v4 helper backed by `crypto.getRandomValues`, which [works on HTTP origins](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues). This also supports the shared range42 HTTP UI, where `crypto.randomUUID` is unavailable.

## Acceptance, 11 September 2026

Sanitized live results are in `docs/acceptance/reopen-{github,gitlab,gitea}-20260911.json`. Each provider passed:

1. Save an isolated structured scenario with a binary asset.
2. Preview one pinned revision, then advance its selected branch independently.
3. Reopen and Save on a new branch whose parent is the reviewed SHA; retain a file outside the authored manifest.
4. Publish identical authoring metadata and binary bytes to a public review and a private branch, then reopen both as structured projects.
5. Verify both repository `main` branches remain unchanged.

GitHub/GitLab tests use retained `range42-acceptance-20260910-*` repositories on fresh branches, with review destinations also on fresh branches. Their PR/MR and branch identifiers are recorded for cleanup. The disposable Gitea container is removed with its volumes after acceptance; its report remains as evidence. No source catalog or PVE resources are modified.

Production browser checks cover preview-before-import, desktop/mobile layout and modal accessibility, identity collision without local draft loss, structured forms, binary download after reload, and files-only Save without overwrite. The same flow is exercised on a real non-secure HTTP origin with `crypto.randomUUID` absent.
