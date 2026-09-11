# Attachments Phase 1a — `useAttachments` Data-Ops Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, fully-tested `useAttachments` data-ops module (create / update / remove / scope / order / source / validate) that the attachment editor and host components (Phase 1b/1c) will consume — with zero DOM and zero content-file I/O.

**Architecture:** A new `src/composables/useAttachments.ts` exporting pure functions over the canonical `Attachment` shape (from Phase 0), plus a `validateAttachment` that returns per-kind problems and a `normalizeAttachments` convenience. No reactivity, no adapter, no network — this is the logic core, isolated for testing. Content-file storage (`inline_yaml`/`file_upload` → `content_ref`) is deliberately deferred to Phase 1b where the storage mechanism is decided.

**Tech Stack:** TypeScript, Vitest, Vue 3 ecosystem (no Vue reactivity used here — pure functions).

---

## Scope notes

- **Depends on Phase 0** (`normalizeAttachment` in `useInfraBuilder.js`, PR #76). Branch off the Phase 0 branch so that symbol exists.
- **Phase 1a only.** Phase 1b (`AttachmentEditor` + four source sub-forms, incl. the content-storage decision) and Phase 1c (ConfigPanel section + AttachmentManager Kind/Source columns + global add + i18n + `useProblems` wiring) are separate plans.
- The canonical `Attachment` / `AttachmentSource` / `AttachmentSourceKind` / `AttachmentScope` types already exist in `src/types/range42-schema.ts` — import, do not redefine.
- `validateAttachment` here only **returns** problems; wiring them into the ProblemsPanel via `useProblems.addProblem` happens in Phase 1c.

## File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/composables/useAttachments.ts` | Create | Pure attachment data ops + validation + normalize convenience |
| `src/__tests__/useAttachments.test.js` | Create | Unit tests for every exported function |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch off the Phase 0 branch**

`useAttachments` imports `normalizeAttachment`, which lives on the Phase 0 branch (PR #76, not yet merged to `dev`). Branch off it so the symbol resolves. (If #76 has since merged to `dev`, branch off `dev` instead.)

```bash
cd /home/ppa/projects/range42-base/range42-deployer-ui
git checkout feature/attachments-phase0-datamodel
git checkout -b feature/attachments-phase1a-useattachments
```

Expected: `Switched to a new branch 'feature/attachments-phase1a-useattachments'`.

---

### Task 1: `createAttachment`

**Files:**
- Create: `src/composables/useAttachments.ts`
- Create: `src/__tests__/useAttachments.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useAttachments.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createAttachment } from '../composables/useAttachments'

describe('createAttachment', () => {
  it('builds a canonical attachment with sane defaults', () => {
    const a = createAttachment('inline_yaml', 'vm-a', { id: 'fixed-id' })
    expect(a).toEqual({
      id: 'fixed-id',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml' },
      stage: 'main',
      scope: 'node',
    })
  })

  it('honors an explicit stage and title', () => {
    const a = createAttachment('catalog_role', 'vm-a', { id: 'x', stage: 'preflight', title: 'Wazuh' })
    expect(a.stage).toBe('preflight')
    expect(a.title).toBe('Wazuh')
  })

  it('generates a unique id when none is provided', () => {
    const a = createAttachment('external_git', 'vm-a')
    const b = createAttachment('external_git', 'vm-a')
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(a.id).not.toBe(b.id)
  })

  it('omits title when not provided', () => {
    const a = createAttachment('file_upload', 'vm-a', { id: 'x' })
    expect('title' in a).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: FAIL — cannot resolve `createAttachment` (module does not exist).

- [ ] **Step 3: Implement the module with `createAttachment`**

Create `src/composables/useAttachments.ts`:

```ts
/**
 * useAttachments — pure data operations over the canonical Attachment shape.
 *
 * No DOM, no reactivity, no network: every function takes plain data and
 * returns plain data, so the attachment editor and host components can compose
 * them while staying fully unit-testable. Content-file storage for
 * inline_yaml/file_upload is intentionally NOT handled here (Phase 1b).
 */
import type {
  Attachment,
  AttachmentScope,
  AttachmentSource,
  AttachmentSourceKind,
} from '@/types/range42-schema'
import { normalizeAttachment } from '@/composables/useInfraBuilder'

const DEFAULT_STAGE = 'main'

export interface CreateAttachmentOptions {
  id?: string
  stage?: string
  title?: string
}

/** Build a new canonical attachment for `targetNode` with sane defaults. */
export function createAttachment(
  kind: AttachmentSourceKind,
  targetNode: string,
  opts: CreateAttachmentOptions = {},
): Attachment {
  const att: Attachment = {
    id: opts.id ?? crypto.randomUUID(),
    target_node: targetNode,
    source: { kind },
    stage: opts.stage ?? DEFAULT_STAGE,
    scope: 'node',
  }
  if (opts.title) att.title = opts.title
  return att
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git add src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git commit -m "feat(attachments): add useAttachments.createAttachment"
```

Expected: lint exit 0; commit created.

---

### Task 2: Mutators — `updateAttachment`, `removeAttachment`, `setAttachmentScope`, `setAttachmentOrder`, `setAttachmentSource`

**Files:**
- Modify: `src/composables/useAttachments.ts`
- Modify: `src/__tests__/useAttachments.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/useAttachments.test.js`:

```js
import {
  updateAttachment,
  removeAttachment,
  setAttachmentScope,
  setAttachmentOrder,
  setAttachmentSource,
} from '../composables/useAttachments'

describe('attachment mutators (pure, immutable)', () => {
  const list = () => [
    { id: 'a1', target_node: 'vm-a', source: { kind: 'inline_yaml' }, stage: 'main', scope: 'node' },
    { id: 'a2', target_node: 'vm-b', source: { kind: 'catalog_role', ref: 'src:roles/x' }, stage: 'main', scope: 'node' },
  ]

  it('updateAttachment shallow-merges a patch onto the matching row only', () => {
    const out = updateAttachment(list(), 'a1', { stage: 'post', title: 'T' })
    expect(out.find((a) => a.id === 'a1')).toMatchObject({ stage: 'post', title: 'T' })
    expect(out.find((a) => a.id === 'a2').stage).toBe('main')
  })

  it('updateAttachment does not mutate the input array or rows', () => {
    const input = list()
    const snapshot = JSON.stringify(input)
    updateAttachment(input, 'a1', { stage: 'post' })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('removeAttachment drops the matching row', () => {
    expect(removeAttachment(list(), 'a1').map((a) => a.id)).toEqual(['a2'])
  })

  it('setAttachmentScope sets scope on the matching row', () => {
    expect(setAttachmentScope(list(), 'a1', 'group_inherited').find((a) => a.id === 'a1').scope).toBe(
      'group_inherited',
    )
  })

  it('setAttachmentOrder writes order_in_stage (canonical field)', () => {
    expect(setAttachmentOrder(list(), 'a2', 3).find((a) => a.id === 'a2').order_in_stage).toBe(3)
  })

  it('setAttachmentSource merges into source without dropping existing source fields', () => {
    const out = setAttachmentSource(list(), 'a2', { sha: 'abc123' })
    expect(out.find((a) => a.id === 'a2').source).toEqual({
      kind: 'catalog_role',
      ref: 'src:roles/x',
      sha: 'abc123',
    })
  })

  it('mutators tolerate null/undefined input', () => {
    expect(updateAttachment(null, 'a1', { stage: 'x' })).toEqual([])
    expect(removeAttachment(undefined, 'a1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: FAIL — the five mutator functions are not exported.

- [ ] **Step 3: Implement the mutators**

Append to `src/composables/useAttachments.ts`:

```ts
/** Shallow-merge `patch` onto the attachment with `id`. Returns a new array. */
export function updateAttachment(
  attachments: Attachment[] | null | undefined,
  id: string,
  patch: Partial<Attachment>,
): Attachment[] {
  return (attachments ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a))
}

/** Remove the attachment with `id`. Returns a new array. */
export function removeAttachment(
  attachments: Attachment[] | null | undefined,
  id: string,
): Attachment[] {
  return (attachments ?? []).filter((a) => a.id !== id)
}

/** Set `scope` on the attachment with `id`. */
export function setAttachmentScope(
  attachments: Attachment[] | null | undefined,
  id: string,
  scope: AttachmentScope,
): Attachment[] {
  return updateAttachment(attachments, id, { scope })
}

/** Set the canonical `order_in_stage` on the attachment with `id`. */
export function setAttachmentOrder(
  attachments: Attachment[] | null | undefined,
  id: string,
  order: number,
): Attachment[] {
  return updateAttachment(attachments, id, { order_in_stage: order })
}

/** Merge `sourcePatch` into the attachment's `source` (preserves other source fields). */
export function setAttachmentSource(
  attachments: Attachment[] | null | undefined,
  id: string,
  sourcePatch: Partial<AttachmentSource>,
): Attachment[] {
  return (attachments ?? []).map((a) =>
    a.id === id ? { ...a, source: { ...a.source, ...sourcePatch } } : a,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git add src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git commit -m "feat(attachments): add useAttachments mutators (update/remove/scope/order/source)"
```

---

### Task 3: `validateAttachment` + `normalizeAttachments`

**Files:**
- Modify: `src/composables/useAttachments.ts`
- Modify: `src/__tests__/useAttachments.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/useAttachments.test.js`:

```js
import { validateAttachment, normalizeAttachments } from '../composables/useAttachments'

const codes = (a) => validateAttachment(a).map((p) => p.code)

describe('validateAttachment — per-kind completeness rules', () => {
  it('flags a missing target_node', () => {
    const a = { id: 'x', source: { kind: 'inline_yaml', content_ref: 'attachments/x.yaml' } }
    expect(codes(a)).toContain('attachment.target_node.missing')
  })

  it('flags a missing source kind', () => {
    expect(codes({ id: 'x', target_node: 'vm-a' })).toContain('attachment.source.missing')
  })

  it('catalog kinds require a source.ref', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'catalog_role' } })).toContain(
      'attachment.catalog.ref.missing',
    )
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'catalog_container', ref: 'src:c/x' } }),
    ).toEqual([])
  })

  it('catalog kinds do NOT require a sha (sha is null from the backend today)', () => {
    const a = { id: 'x', target_node: 'vm-a', source: { kind: 'catalog_role', ref: 'src:roles/x' } }
    expect(codes(a)).not.toContain('attachment.git.sha.missing')
    expect(codes(a)).toEqual([])
  })

  it('inline_yaml and file_upload require content_ref', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'inline_yaml' } })).toContain(
      'attachment.content.missing',
    )
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'file_upload' } })).toContain(
      'attachment.content.missing',
    )
  })

  it('external_git requires a url and a pinned sha', () => {
    expect(codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git' } })).toEqual(
      expect.arrayContaining(['attachment.git.url.missing', 'attachment.git.sha.missing']),
    )
  })

  it('external_git rejects a malformed url', () => {
    const a = { id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'not a url', sha: 'abc' } }
    expect(codes(a)).toContain('attachment.git.url.invalid')
  })

  it('external_git accepts https and git@ ssh urls with a sha', () => {
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'https://gh/o/r.git', sha: 'abc' } }),
    ).toEqual([])
    expect(
      codes({ id: 'x', target_node: 'vm-a', source: { kind: 'external_git', url: 'git@gh:o/r.git', sha: 'abc' } }),
    ).toEqual([])
  })
})

describe('normalizeAttachments', () => {
  it('maps legacy rows to canonical and tolerates empty input', () => {
    const out = normalizeAttachments([{ id: 'a', node_id: 'vm-a', order: 1 }])
    expect(out[0]).toMatchObject({ target_node: 'vm-a', order_in_stage: 1 })
    expect(out[0].node_id).toBeUndefined()
    expect(normalizeAttachments(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: FAIL — `validateAttachment` / `normalizeAttachments` not exported.

- [ ] **Step 3: Implement validation + normalize convenience**

Append to `src/composables/useAttachments.ts`:

```ts
export interface AttachmentProblem {
  field: string
  code: string
  message: string
}

function isValidGitUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url) || /^git@[^:\s]+:\S+$/.test(url) || /^ssh:\/\/\S+$/.test(url)
}

/**
 * Return the completeness problems for an attachment (empty = valid/deployable).
 * Per-kind rules; catalog `sha` is intentionally NOT required (the backend
 * emits null shas today — see the attachments spec).
 */
export function validateAttachment(a: Attachment | null | undefined): AttachmentProblem[] {
  const problems: AttachmentProblem[] = []
  if (!a || typeof a !== 'object') return problems
  if (!a.target_node) {
    problems.push({
      field: 'target_node',
      code: 'attachment.target_node.missing',
      message: 'Attachment has no target node',
    })
  }
  const src = a.source
  if (!src || !src.kind) {
    problems.push({
      field: 'source.kind',
      code: 'attachment.source.missing',
      message: 'Attachment has no source kind',
    })
    return problems
  }
  switch (src.kind) {
    case 'catalog_role':
    case 'catalog_container':
      if (!src.ref) {
        problems.push({
          field: 'source.ref',
          code: 'attachment.catalog.ref.missing',
          message: 'Catalog attachment has no source reference',
        })
      }
      break
    case 'inline_yaml':
    case 'file_upload':
      if (!src.content_ref) {
        problems.push({
          field: 'source.content_ref',
          code: 'attachment.content.missing',
          message: 'Attachment has no content',
        })
      }
      break
    case 'external_git':
      if (!src.url) {
        problems.push({
          field: 'source.url',
          code: 'attachment.git.url.missing',
          message: 'External git attachment has no URL',
        })
      } else if (!isValidGitUrl(src.url)) {
        problems.push({
          field: 'source.url',
          code: 'attachment.git.url.invalid',
          message: 'External git URL must be https:// or git@host:path',
        })
      }
      if (!src.sha) {
        problems.push({
          field: 'source.sha',
          code: 'attachment.git.sha.missing',
          message: 'External git attachment must be pinned to a commit sha',
        })
      }
      break
  }
  return problems
}

/** Upgrade a list of (possibly legacy) attachment rows to canonical shape. */
export function normalizeAttachments(
  attachments: Attachment[] | null | undefined,
): Attachment[] {
  return (attachments ?? []).map(normalizeAttachment)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/useAttachments.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git add src/composables/useAttachments.ts src/__tests__/useAttachments.test.js
git commit -m "feat(attachments): add validateAttachment + normalizeAttachments"
```

---

### Task 4: Full verification + PR

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: 0 failures (this plan adds `useAttachments.test.js` only; all prior tests still pass).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds (ignore the pre-existing >500 kB chunk-size advisory).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feature/attachments-phase1a-useattachments
gh pr create --repo range42/range42-deployer-ui --base dev \
  --head feature/attachments-phase1a-useattachments \
  --title "feat(attachments): useAttachments data-ops core (Phase 1a)" \
  --body "Adds a pure, fully-tested useAttachments module: createAttachment, the update/remove/scope/order/source mutators, validateAttachment (per-kind completeness rules), and a normalizeAttachments convenience. No DOM, no content-file I/O — the logic core the attachment editor (Phase 1b) and host components (Phase 1c) build on. Depends on the Phase 0 normalizeAttachment (PR #76); merge that first."
```

Expected: PR URL printed. (The `gh` warning about uncommitted changes is the untracked `docs/superpowers/**` planning files — expected; do not stage them.)

---

## Self-review

- **Spec coverage:** Phase 1a = the `useAttachments` data-ops half of the spec's component architecture (`create / update / remove / reorder / setScope`, `validateAttachment`, normalize). `writeInlineContent` / `writeUploadedFile` (content I/O) are explicitly deferred to Phase 1b per the scope note — not a gap. ✔
- **Placeholder scan:** none — every code step has full code; every run step has command + expected result. ✔
- **Type/name consistency:** functions defined and imported by the exact names used in tests (`createAttachment`, `updateAttachment`, `removeAttachment`, `setAttachmentScope`, `setAttachmentOrder`, `setAttachmentSource`, `validateAttachment`, `normalizeAttachments`); canonical fields `target_node`/`order_in_stage`/`source` throughout; problem `code` strings in the implementation match the strings asserted in the tests. ✔
- **Dependency:** Task 0 branches off the Phase 0 branch so `normalizeAttachment` resolves; PR note flags the merge-order dependency on #76. ✔
