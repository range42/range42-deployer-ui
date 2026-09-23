# Attachments Phase 0 — Data-Model Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the runtime attachment shape on the canonical schema field names (`target_node`, `order_in_stage`) so the UI stops producing rows that `overlay/compose.ts` silently drops, with zero user-facing behavior change.

**Architecture:** Add a pure, idempotent `normalizeAttachment` mapper (legacy `node_id`→`target_node`, `order`→`order_in_stage`); migrate the two attachment-record readers (`useInfraBuilder.js`, `AttachmentManager.vue`) to canonical names; normalize legacy data at the single read boundary in `ProjectEditor.vue`; lock the shape with a `compose.ts` guard test. No new UI, no new components — this is Phase 0 of the attachments spec (`docs/superpowers/specs/2026-05-20-attachments-authoring-design.md`).

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, Vitest + @vue/test-utils, mixed JS/TS (no tsc; ESLint only).

---

## Scope notes

- This plan is **Phase 0 only**. Phase 1 (the `useAttachments` composable, `AttachmentEditor`, the four source sub-forms, ConfigPanel section, AttachmentManager Kind/Source columns) is a separate plan that depends on this one landing first.
- **Out of scope / do not touch:** the `node_id` references in `useProblems.ts`, `ProblemsPanel.vue`, and `ProjectEditor.vue:235` — those are Problem descriptors / node identity, **not** attachment records.
- `replicationIntent.test.js` is edge-only and needs **no** changes (the spec over-listed it).
- The canvas→overlay serializer that would feed `ProjectOverlay.attachments_added` does not exist and is **not** built here; the compose guard test exercises `compose.ts` directly with canonical input.

## File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/composables/useInfraBuilder.js` | Modify | Add exported `normalizeAttachment`; migrate `computeEffectiveAttachments` + `applyBulkAttachmentEdit` to canonical names; export `normalizeAttachment` from `useInfraBuilder()` |
| `src/components/project/AttachmentManager.vue` | Modify | `selectionIntersectsGroup` + table cells read `target_node`/`order_in_stage` |
| `src/views/ProjectEditor.vue` | Modify | Normalize attachments at the `attachmentsRef` read boundary |
| `src/__tests__/normalizeAttachment.test.js` | Create | Unit tests for the mapper |
| `src/__tests__/composeAttachments.test.js` | Create | Guard: canonical attachment composes; legacy `node_id` is dropped |
| `src/__tests__/attachmentInheritance.test.js` | Modify | Migrate fixtures to canonical names |

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch off `dev`**

```bash
cd /home/ppa/projects/range42-base/range42-deployer-ui
git checkout dev
git pull --ff-only
git checkout -b feature/attachments-phase0-datamodel
```

Expected: `Switched to a new branch 'feature/attachments-phase0-datamodel'`.

---

### Task 1: `normalizeAttachment` pure mapper

**Files:**
- Test: `src/__tests__/normalizeAttachment.test.js` (create)
- Modify: `src/composables/useInfraBuilder.js` (add exported function + add to `useInfraBuilder()` return)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/normalizeAttachment.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normalizeAttachment } from '../composables/useInfraBuilder'

describe('normalizeAttachment — legacy → canonical attachment shape', () => {
  it('maps node_id → target_node and order → order_in_stage, dropping the legacy keys', () => {
    const out = normalizeAttachment({ id: 'a', node_id: 'vm-a', order: 2, stage: 'pre' })
    expect(out.target_node).toBe('vm-a')
    expect(out.order_in_stage).toBe(2)
    expect(out.node_id).toBeUndefined()
    expect(out.order).toBeUndefined()
    expect(out.stage).toBe('pre')
  })

  it('preserves a literal order of 0', () => {
    expect(normalizeAttachment({ id: 'a', node_id: 'x', order: 0 }).order_in_stage).toBe(0)
  })

  it('is idempotent on already-canonical rows', () => {
    const canon = { id: 'a', target_node: 'vm-a', order_in_stage: 1, source: { kind: 'inline_yaml' } }
    expect(normalizeAttachment(canon)).toEqual(canon)
  })

  it('prefers an existing target_node over node_id when both are present', () => {
    const out = normalizeAttachment({ id: 'a', target_node: 'canon', node_id: 'legacy' })
    expect(out.target_node).toBe('canon')
    expect(out.node_id).toBeUndefined()
  })

  it('passes non-object input through unchanged', () => {
    expect(normalizeAttachment(null)).toBeNull()
    expect(normalizeAttachment(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/normalizeAttachment.test.js`
Expected: FAIL — `normalizeAttachment is not a function`.

- [ ] **Step 3: Implement `normalizeAttachment`**

In `src/composables/useInfraBuilder.js`, add this exported function immediately above `export function computeEffectiveAttachments` (before line 48):

```js
/**
 * Upgrade a persisted attachment row to the canonical schema shape:
 *   node_id → target_node, order → order_in_stage.
 * Pure and idempotent — canonical rows pass through unchanged, and legacy keys
 * are always removed so downstream code only ever sees canonical names.
 */
export function normalizeAttachment(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const a = { ...raw }
  if (a.target_node === undefined && a.node_id !== undefined) {
    a.target_node = a.node_id
  }
  delete a.node_id
  if (a.order_in_stage === undefined && a.order !== undefined) {
    a.order_in_stage = a.order
  }
  delete a.order
  return a
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/normalizeAttachment.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from the composable**

In `src/composables/useInfraBuilder.js`, in the `return { ... }` object of `useInfraBuilder()` (currently ends with `applyBulkAttachmentEdit,` near line 440), add `normalizeAttachment,` to the exported list:

```js
    computeEffectiveAttachments,
    applyBulkAttachmentEdit,
    normalizeAttachment,
  }
}
```

- [ ] **Step 6: Lint + commit**

```bash
npx eslint src/composables/useInfraBuilder.js src/__tests__/normalizeAttachment.test.js
git add src/composables/useInfraBuilder.js src/__tests__/normalizeAttachment.test.js
git commit -m "feat(attachments): add normalizeAttachment legacy→canonical mapper"
```

Expected: lint exit 0; commit created.

---

### Task 2: Migrate `computeEffectiveAttachments` + `applyBulkAttachmentEdit` to canonical names

**Files:**
- Modify: `src/__tests__/attachmentInheritance.test.js` (fixtures → canonical)
- Modify: `src/composables/useInfraBuilder.js` (read `target_node`; write `order_in_stage`)

- [ ] **Step 1: Migrate the test fixtures (test-first)**

In `src/__tests__/attachmentInheritance.test.js`, replace every attachment-record `node_id:` with `target_node:` and every `order:` with `order_in_stage:`. Concretely:

- Line 21: `[{ id: 'a1', node_id: 'vm-a', scope: 'node', stage: 'run' }]` → `[{ id: 'a1', target_node: 'vm-a', scope: 'node', stage: 'run' }]`
- Line 30: `[{ id: 'inh', node_id: 'g1', scope: 'group_inherited', stage: 'preflight' }]` → `[{ id: 'inh', target_node: 'g1', scope: 'group_inherited', stage: 'preflight' }]`
- Lines 48-50:
  ```js
      { id: 'direct', target_node: 'vm-a', scope: 'node', stage: 'post' },
      { id: 'inh', target_node: 'g1', scope: 'group_inherited', stage: 'pre' },
  ```
- Line 61: `[{ id: 'inh', node_id: 'g1', scope: 'group_inherited' }]` → `[{ id: 'inh', target_node: 'g1', scope: 'group_inherited' }]`
- Lines 70-72:
  ```js
    { id: 'a1', target_node: 'vm-a', stage: 'pre', order_in_stage: 0 },
    { id: 'a2', target_node: 'vm-b', stage: 'pre', order_in_stage: 1 },
    { id: 'a3', target_node: 'g1', scope: 'node' },
  ```

(The `out.get('vm-a')` assertions key on node ids and need no change.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/attachmentInheritance.test.js`
Expected: FAIL — `computeEffectiveAttachments` still reads `a.node_id`, so attachments no longer land on their nodes (e.g. `out.get('vm-a')` has length 0).

- [ ] **Step 3: Migrate `computeEffectiveAttachments`**

In `src/composables/useInfraBuilder.js`, in `computeEffectiveAttachments`, change the three `node_id` reads (lines 56, 61, 62, 68):

```js
  // 1) Direct attachments go on their owning node unchanged.
  const groupInherited = []
  for (const a of attachments || []) {
    if (!a?.target_node) continue
    if (a.scope === 'group_inherited') {
      groupInherited.push(a)
      continue
    }
    if (!byNode.has(a.target_node)) byNode.set(a.target_node, [])
    byNode.get(a.target_node).push({ ...a, inherited: false })
  }
```

and in the inherited loop:

```js
  for (const a of groupInherited) {
    const group = byId.get(a.target_node)
    if (!group) continue
```

Also update the doc comment above the function (line 44) so the example reads
`attachments: [{ id, target_node, scope?: 'node' | 'group_inherited', ... }]`.

- [ ] **Step 4: Migrate `applyBulkAttachmentEdit`**

In the same file, change line 111 so the bulk `setOrder` edit writes the canonical field:

```js
    if (edit?.setOrder !== undefined) next.order_in_stage = Number(edit.setOrder) || 0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/attachmentInheritance.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Lint + commit**

```bash
npx eslint src/composables/useInfraBuilder.js src/__tests__/attachmentInheritance.test.js
git add src/composables/useInfraBuilder.js src/__tests__/attachmentInheritance.test.js
git commit -m "refactor(attachments): read target_node/order_in_stage in inheritance + bulk edit"
```

---

### Task 3: `compose.ts` shape-guard test

`overlay/compose.ts` already keys on `target_node` and drops attachments without it; this task adds a regression guard documenting that contract (no production code change).

**Files:**
- Test: `src/__tests__/composeAttachments.test.js` (create)

- [ ] **Step 1: Write the guard test**

Create `src/__tests__/composeAttachments.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { compose } from '@/overlay/compose'

function baseDoc() {
  return {
    schema_version: '1.0',
    kind: 'lab',
    name: 'base',
    nodes: [{ id: 'vm-a', kind: 'vm' }],
  }
}

describe('compose — UI attachment shape reaches the right node', () => {
  it('appends a canonical attachment (target_node + source) onto its node, dropping target_node', () => {
    const overlay = {
      schema_version: '1.0',
      source_url: 'x',
      source_sha: 'y',
      attachments_added: [
        {
          id: 'att1',
          target_node: 'vm-a',
          stage: 'main',
          order_in_stage: 0,
          source: { kind: 'catalog_role', ref: 'src-a:roles/wazuh' },
        },
      ],
    }
    const eff = compose(baseDoc(), overlay)
    const node = eff.nodes.find((n) => n.id === 'vm-a')
    expect(node.attachments).toHaveLength(1)
    const att = node.attachments[0]
    expect(att.source.kind).toBe('catalog_role')
    expect(att.stage).toBe('main')
    expect(att.order_in_stage).toBe(0)
    expect(att.target_node).toBeUndefined() // compose strips the routing key
  })

  it('drops a legacy attachment that uses node_id instead of target_node (guards the drift)', () => {
    const overlay = {
      schema_version: '1.0',
      source_url: 'x',
      source_sha: 'y',
      attachments_added: [{ id: 'legacy', node_id: 'vm-a', stage: 'main' }],
    }
    const eff = compose(baseDoc(), overlay)
    expect(eff.nodes.find((n) => n.id === 'vm-a').attachments).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composeAttachments.test.js`
Expected: PASS (2 tests) — this confirms the canonical shape composes and the legacy shape is dropped, which is exactly why normalization matters.

- [ ] **Step 3: Lint + commit**

```bash
npx eslint src/__tests__/composeAttachments.test.js
git add src/__tests__/composeAttachments.test.js
git commit -m "test(attachments): guard that canonical attachments compose onto their node"
```

---

### Task 4: Migrate `AttachmentManager.vue` to canonical names

**Files:**
- Modify: `src/components/project/AttachmentManager.vue` (lines 53, 181, 183)

- [ ] **Step 1: Migrate `selectionIntersectsGroup`**

In `src/components/project/AttachmentManager.vue`, change line 53:

```js
    if (a.target_node && groupIds.has(a.target_node)) return true
```

- [ ] **Step 2: Migrate the table cells**

Change the node-id cell (line 181):

```html
          <td class="font-mono text-xs">{{ a.target_node }}</td>
```

Change the order cell (line 183):

```html
          <td>{{ a.order_in_stage ?? '—' }}</td>
```

(Leave the `bulk.order` input state and the `{ setOrder: bulk.value.order }` call unchanged — `setOrder` is the edit-param name; Task 2 already routes it to `order_in_stage`.)

- [ ] **Step 3: Run the attachment suite + lint**

Run: `npx vitest run src/__tests__/attachmentInheritance.test.js`
Expected: PASS (unchanged — this guards the helper the component uses).

Run: `npx eslint src/components/project/AttachmentManager.vue`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/project/AttachmentManager.vue
git commit -m "refactor(attachments): AttachmentManager reads target_node/order_in_stage"
```

---

### Task 5: Normalize legacy data at the read boundary + full verification

**Files:**
- Modify: `src/views/ProjectEditor.vue` (import + `attachmentsRef`, line 131)

- [ ] **Step 1: Import `normalizeAttachment`**

In `src/views/ProjectEditor.vue`, find the existing import from `@/composables/useInfraBuilder` (it already imports `computeDockerTetherEdges`). Add `normalizeAttachment` to that import's named list. For example:

```js
import { computeDockerTetherEdges, normalizeAttachment } from '@/composables/useInfraBuilder'
```

(If the existing import lists multiple names across lines, just add `normalizeAttachment` to the braces — do not create a second import statement.)

- [ ] **Step 2: Normalize at the read boundary**

Change line 131 so every consumer of `attachmentsRef` (the ProblemsPanel, ConfigTab → AttachmentManager) sees canonical rows even for legacy-persisted projects:

```js
const attachmentsRef = computed(() =>
  (currentProject.value?.attachments || []).map(normalizeAttachment),
)
```

- [ ] **Step 3: Lint the changed file**

Run: `npx eslint src/views/ProjectEditor.vue`
Expected: exit 0.

- [ ] **Step 4: Full verification (whole suite + build)**

```bash
npx vitest run
npm run build
```

Expected: all test files pass (the prior baseline was 51 files / 341 tests; this plan adds `normalizeAttachment.test.js` + `composeAttachments.test.js`, so expect 53 files and a higher test count, 0 failures). Build succeeds (ignore the pre-existing >500 kB chunk-size advisory).

- [ ] **Step 5: Commit**

```bash
git add src/views/ProjectEditor.vue
git commit -m "refactor(attachments): normalize legacy attachment rows on read"
```

- [ ] **Step 6: Push + open PR**

```bash
git push -u origin feature/attachments-phase0-datamodel
gh pr create --repo range42/range42-deployer-ui --base dev \
  --head feature/attachments-phase0-datamodel \
  --title "refactor(attachments): unify on canonical schema shape (Phase 0)" \
  --body "Migrates the runtime attachment shape onto the canonical schema field names (target_node, order_in_stage) and normalizes legacy persisted rows on read, so the UI stops producing attachments that overlay/compose.ts silently drops. Pure data-model migration — no user-facing behavior change, no new UI. Adds a compose.ts shape-guard test. Phase 0 of the attachments authoring work (#67/#62)."
```

Expected: PR URL printed.

---

## Self-review

- **Spec coverage:** Phase 0 of the spec = canonical shape + `normalizeAttachment` (Task 1), full field-rename inventory `computeEffectiveAttachments`/`applyBulkAttachmentEdit` (Task 2) + `AttachmentManager.selectionIntersectsGroup`/cells (Task 4), compose shape-guard test (Task 3), normalize-on-load (Task 5), update inheritance test (Task 2). `replicationIntent.test.js` correctly excluded (edge-only). ✔
- **Placeholder scan:** none — every code step shows full code; every run step shows the command + expected result. ✔
- **Type/name consistency:** `normalizeAttachment` defined in Task 1, imported/used in Task 5; canonical fields `target_node`/`order_in_stage` used consistently across Tasks 2/3/4; `setOrder` edit-param name preserved (maps to `order_in_stage` in Task 2, called unchanged in `AttachmentManager`). ✔
- **Out-of-scope guard:** `useProblems.ts` / `ProblemsPanel.vue` / `ProjectEditor.vue:235` `node_id` (Problem/node identity) explicitly not touched. ✔
