# Attachments authoring surface — design

**Date:** 2026-05-20
**Issues:** range42-deployer-ui #67 (attachment-creation UI), #62 (per-node attachment editor)
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Catalog content and custom config cannot currently be attached to a node from
the UI:

- `AttachmentManager.vue` only **edits** existing attachment rows (stage, order,
  vars, scope, delete). There is no creation surface for any of the five
  attachment kinds.
- The five `AttachmentSource` kinds (`catalog_role`, `catalog_container`,
  `inline_yaml`, `file_upload`, `external_git`) exist in the schema/types and in
  `overlay/compose.ts`, but no component ever produces a `source`.
- **Latent shape drift:** the runtime/UI attachment shape (`node_id`, `order`,
  no `source`) has drifted from the canonical schema and from `compose.ts`,
  which keys on `target_node` and **drops** any attachment lacking it.

This makes the just-shipped catalog API fix (#66) only half-useful — entries can
be browsed but not attached.

## Goals

1. Create attachments of all five kinds, node-contextually.
2. Edit/delete/reorder/scope a node's attachments.
3. Reconcile the attachment data model onto the canonical schema shape so the UI
   stops producing rows that `compose.ts` would silently drop, and lock the shape
   with a `compose.ts` guard test.

> **Important scope correction (from architecture review).** Goal 3 makes the
> shape *correct*; it does **not** by itself make attachments reach a live
> deploy. There is currently **no canvas→overlay serializer**: the project store
> holds a canvas model (`nodes`/`edges`/`attachments`), the adapter persists an
> `overlay.json`, but nothing builds `ProjectOverlay.attachments_added` /
> `nodes_added` from the canvas model. `compose.ts` consumes `attachments_added`
> that nothing produces. That serializer is a **cross-cutting dependency**
> (it gates whether *nodes* reach a deploy too), is out of scope for this
> attachments cycle, and is tracked separately — see Dependencies & known gaps.

## Non-goals (this cycle)

- Drag-to-reorder (number input only).
- Advanced `ansible_primitive` / `handler_namespace` fields (kept optional,
  hidden in the v1 UI).
- Backend enforcement of `external_git` fetch/exec safety (the UI only records a
  pinned reference; enforcement is backend).
- The save → PR → deploy commit gate (issue #63, separate cycle).
- A GitHub-v1 content-write path (reuses the existing `ProjectRepoAdapter` /
  provider).

## Dependencies & known gaps (verified against the codebase)

- **No canvas→overlay serializer (blocker for end-to-end deploy, out of scope).**
  Nothing in the frontend builds `ProjectOverlay.attachments_added` /
  `nodes_added` from `currentProject` (`nodes`/`edges`/`attachments`). Until that
  layer exists, neither attachments nor drawn nodes flow to a deploy. File a
  separate issue; this cycle delivers the authoring UI + correct shape only.
- **`catalog` entry `sha` is always `null`.** `range42-backend-api`
  `app/routes/v1/catalog/entries.py` sets `sha=None` on every summary/detail
  (lines 176, 224). So pinning a `catalog_role`/`catalog_container` by `sha` is a
  **no-op today** — store `entry.sha` when present, but `external_git` is the only
  kind where the UI can *enforce* a pin. Surface this as a non-blocking warning,
  not a hard error, for catalog kinds.
- **`/v1/catalog/entries` is mounted** (`app/routes/v1/__init__.py` →
  `catalog_router` → `entries_router`); the `CatalogPickerForm` has a real
  endpoint to call. (Confirmed — corrects an earlier review false-positive.)
- **No buffered local staging layer for git-backed projects.** The
  `ProjectRepoAdapter.autosave()` calls `provider.putFile(...)` immediately
  (writes to the draft branch); only `MemoryFs` is purely local. So content files
  for `inline_yaml`/`file_upload` persist exactly like `overlay.json` does —
  immediately via the same autosave path — not via a separate "stage now, commit
  later" mechanism. The spec language is corrected accordingly below.

## Decisions (from brainstorming)

- **Entry point:** node-contextual primary (ConfigPanel "Attachments" section)
  **plus** the existing global table as a cross-node overview / bulk-edit.
- **Kinds:** all five. `external_git` requires a pinned `sha` + URL validation
  and shows a security note.
- **Architecture:** shared editor core + per-kind source sub-forms + a
  `useAttachments` composable that owns all data ops.

## Data model

Unify the runtime shape on the canonical schema names (already expected by
`compose.ts` and the backend `compose.py`):

```ts
interface Attachment {
  id: string                 // stable uuid
  target_node: string        // was `node_id`
  source: AttachmentSource   // { kind, ref?, sha?, url?, content_ref? }
  title?: string
  stage: string              // defaults to first execution stage, else 'main'
  order_in_stage?: number    // was `order`
  scope?: 'node' | 'group_inherited'
  vars?: Record<string, unknown>
}
```

- **`normalizeAttachment(raw)`** — pure mapper upgrading legacy persisted rows
  (`node_id` → `target_node`, `order` → `order_in_stage`) on load. Existing
  projects keep working.
- **Complete field-rename inventory** (every `node_id`/`order` reader must move
  to canonical names, or inheritance/bulk-edit break silently):
  - `useInfraBuilder.js` — `computeEffectiveAttachments` (reads `a.node_id`) and
    `applyBulkAttachmentEdit` (writes `next.order` → must write
    `next.order_in_stage`).
  - `AttachmentManager.vue` — `selectionIntersectsGroup` (reads `a.node_id`),
    plus the table columns rendering `a.node_id` / `a.order`.
  - Tests: `attachmentInheritance.test.js` and `replicationIntent.test.js`
    fixtures use `node_id` / `order` literals and must be migrated. (`resolve_secrets.spec.ts` and `range42-schema.test.ts` already use canonical
    names — no change.)

### Content storage (honors the schema's `content_ref`; keeps the overlay lean)

| Kind | Persisted as |
|------|--------------|
| `catalog_role` / `catalog_container` | `source.ref = "<source_id>:<path>"`, `source.sha = entry.sha` **when present** (currently always `null` — see Dependencies; non-blocking). No local content. |
| `inline_yaml` | Authored in CodeMirror → written to `attachments/<id>.yaml` via the adapter; `source.content_ref` = that path. Persists via the **same autosave path as `overlay.json`** (immediately to the draft branch for git-backed projects; in-memory for `MemoryFs`). No separate staging layer. |
| `file_upload` | File (≤ 1 MB) → `attachments/<id>.<ext>`; `source.content_ref` = path. Same persistence path as above. Never inlined into the overlay blob. |
| `external_git` | Validated `source.url` (https or `git@` ssh) + **required** pinned `source.sha` + optional subpath in `source.ref`. UI records only; no fetch/exec. |

## Component architecture

```
composables/useAttachments.ts        ← all data ops; no DOM; unit-tested
  create(kind, targetNode) update(id, patch) remove(id) reorder() setScope()
  normalizeAttachment() / normalizeAll()
  writeInlineContent(id, text) / writeUploadedFile(id, file) → content_ref (via adapter)
  validateAttachment() → feeds useProblems

components/project/attachments/
  AttachmentEditor.vue               ← common fields + <component :is> dispatch by kind
  sources/CatalogPickerForm.vue      ← catalog_role + catalog_container (useCatalog)
  sources/InlineYamlForm.vue
  sources/FileUploadForm.vue
  sources/ExternalGitForm.vue

Hosts (thin):
  ConfigPanel.vue        → "Attachments" section for the selected node (primary)
  AttachmentManager.vue  → keep table + bulk; row "edit" + global "+ Add" open AttachmentEditor
```

**ConfigPanel wiring (new — was a gap).** `ConfigPanel.vue` today receives only
`:node` and has no access to the project attachments. To host a per-node
Attachments section it gains an `:attachments` prop (the full array; it filters
to `target_node === node.id` internally) and an `update:attachments` emit.
`ProjectEditor.vue` must pass `:attachments="attachmentsRef"` to its ConfigPanel
mount and wire `@update:attachments="handleAttachmentsUpdate"` (the same handler
ConfigTab already uses).

**Data flow (single write path preserved):** both hosts → `useAttachments` ops →
`emit('update:attachments', next)` → `ProjectEditor.handleAttachmentsUpdate` →
`projectStore`. The store remains the source of truth; the composable is pure
over the passed-in array plus the adapter for content files.

## Per-kind source forms

- **CatalogPickerForm** (`catalog_role` + `catalog_container`): browses via the
  fixed `useCatalog`, filtered to `ansible_role` → `catalog_role` and
  `container` → `catalog_container` (scenario kinds excluded). On pick:
  `source.ref = "<source_id>:<path>"`, `source.sha = entry.sha` if present
  (today always `null` — store it opportunistically; no hard error), title
  defaults to the entry name.
- **InlineYamlForm**: CodeMirror YAML editor; validates the document parses
  (`yaml` lib) before save; writes content → `content_ref`.
- **FileUploadForm**: file input, ≤ 1 MB cap, shows name/size, rejects over cap;
  writes → `content_ref`.
- **ExternalGitForm**: URL validation, required pinned `sha`, optional subpath;
  persistent security note; blocks save if `sha` is missing.
- **Common fields** (AttachmentEditor): title, stage (select from
  `execution.stages`, else free text), `order_in_stage`, scope
  (`group_inherited` offered only when target is a group node), key/value `vars`.

## UX flows

- **Create:** select node → ConfigPanel "Attachments" → "+ Add" → kind picker
  (5) → editor → save → appears in the node's list and the global table.
- **Edit / Delete:** click a row (node list or global table) → editor; delete
  per-row + existing bulk delete.
- **Inheritance:** `group_inherited` only on group nodes; descendants show
  inherited rows **read-only** with an "inherited from `<group>`" badge (existing
  `computeEffectiveAttachments`).
- **Global table** gains `Kind` + `Source` columns (today it shows neither),
  reflecting `source.kind`. Bulk ops unchanged.
- **Validation** surfaces in the ProblemsPanel via `useProblems` (missing `sha`,
  unparseable YAML, missing target node, over-cap file).

## Testing strategy (TDD)

- **Unit:** `useAttachments` ops; `normalizeAttachment` (legacy → canonical);
  `validateAttachment` per kind; content-write helpers (mock adapter).
- **Component:** `AttachmentEditor` kind-dispatch; `CatalogPickerForm` pick →
  emits canonical `source`; `ExternalGitForm` rejects unpinned; `FileUploadForm`
  cap.
- **Drift-guard integration test:** a UI-created (canonical) attachment composes
  onto the correct node through `compose.ts`.
- Update existing `attachmentInheritance.test.js` / `replicationIntent.test.js`
  for the renamed fields.

## i18n

New keys under the `project` namespace in **en / fr / jp** (editor labels, kind
names, security note, validation messages) — all three locales per the repo
convention.

## Phasing

Split into two phases so the data-model repair ships and is verified
independently of the new authoring UI (per architecture review):

- **Phase 0 — data-model migration (no new UI).** Introduce the canonical shape
  + `normalizeAttachment`; migrate the full field-rename inventory above; add the
  `compose.ts` shape-guard test; update the inheritance/replication tests. Ship
  and verify in isolation — zero behavior change for users, removes the latent
  drop-on-compose shape bug.
- **Phase 1 — authoring surface.** `useAttachments`, `AttachmentEditor`, the four
  source sub-forms, ConfigPanel section + wiring, AttachmentManager Kind/Source
  columns + row-edit + global add, i18n.

## Affected files

- New: `src/composables/useAttachments.ts`,
  `src/components/project/attachments/AttachmentEditor.vue`,
  `src/components/project/attachments/sources/{CatalogPickerForm,InlineYamlForm,FileUploadForm,ExternalGitForm}.vue`.
- Modified: `src/components/project/AttachmentManager.vue` (Kind/Source columns,
  row edit, global add, `selectionIntersectsGroup` → `target_node`),
  `src/components/ConfigPanel.vue` (Attachments section + `attachments` prop +
  `update:attachments` emit), `src/composables/useInfraBuilder.js` (canonical
  field names in `computeEffectiveAttachments` + `applyBulkAttachmentEdit`),
  `src/views/ProjectEditor.vue` (normalize on load; pass `attachments` to
  ConfigPanel + wire its `update:attachments`), `src/locales/{en,fr,jp}/project.json`.
- Tests: new unit/component specs; `compose.ts` shape-guard integration test;
  update `attachmentInheritance.test.js`, `replicationIntent.test.js`.
- Out of this cycle (file separately): canvas→overlay serializer that builds
  `ProjectOverlay.attachments_added` / `nodes_added` from the project model.
