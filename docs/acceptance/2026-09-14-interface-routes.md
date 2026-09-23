# Local production browser interface checks

These checks use a built UI served over HTTP and controlled API/provider fixtures.
They are **not shared-backend or guest execution acceptance**. No request reaches
GitHub, another Git provider or Proxmox. The fixture rejects unexpected writes.

## Route coverage

`e2e/route-regressions.spec.ts` contains ten cases. The two route-matrix cases
visit all nine routes at 1440 and 390 pixels, check visible content, navigation,
page errors and outer horizontal overflow, then reload project files.

| Route | Additional behavior checked |
| --- | --- |
| `/` | Empty-project form, labels, keyboard opening/cancellation and focus return; Deploy shortcut opens project review without saving or creating a deployment. |
| `/sources` | Loading and failed backend read remain visible. |
| `/catalog` | Cached entries retain an expired-auth warning; retry clears it; publication handoff preserves state on denied destination access. |
| `/catalog/:source/:entry` | Detail rendering and the same denied publication handoff/cancellation. |
| `/project/:id` | Canvas, lazy Config entry, file persistence after reload and the deployment review prompt. |
| `/deployments` | Loading versus empty; completed/partial/unknown history; in-progress filter; single-link keyboard navigation without nested interactive elements. |
| `/deployments/:id` | Failed record, scoped runtime/claim reads and navigation. No live lifecycle action is exercised by the route matrix. |
| `/deployments/:id/preflight` | Saved blocking report, missing report, expired auth and keyboard return navigation. |
| `/settings` | Readiness Test displays Git as Not checked with two registered sources and a concrete failed Proxmox explanation; retention remains Not enforced. |

The Settings case uses the actual readiness response shape: required database,
workspace and Proxmox checks plus `git.ok: null`, `required: false`,
`connectivity: "not_checked"` and `sources_registered: 2`. Source registration
does not become a successful repository connectivity result.

## Regressions and workflow checks

Browser regressions were observed before fixing hidden cached-catalog errors,
missing deployment loading status, mobile dashboard overflow and the create
dialog's semantics/keyboard behavior. A separate unit regression reproduced
completed/partial/unknown outcomes being classified as active. The updated rows
are ordinary navigation links. The original fork actions wrote a reference stub,
swallowed failures and navigated to an unregistered source; they now reuse the
reviewed import and subsequent explicit Save/Publish workflow. Home's old
quick-deploy bypassed the editor's registration/allocation flow; it now opens
project review, without an automatic Save from the URL.

The existing `fork-reuse` and `deploy-happy` browser fixtures were stale: the
former used the old catalog response and fabricated a post-fork source; the
latter assumed ambiguous Deploy controls and the old vault/preflight form.
Their replacements verify supported behavior:

- Fork review imports all seven unchanged default NTP role files, retains
  origin and writable destination, and survives reload. Review/import makes no
  provider mutation and does not claim that publication has happened.
- The deployment workflow reserves three literal replicas, applies them, saves
  the generated Git snapshot through the real UI/provider adapter, registers a
  backend project identity distinct from the local identity, and submits the
  private lease header with the exact saved revision. The controlled backend
  then returns a claim, accepts preflight/start and supplies a terminal state on
  reload. The fixture verifies VM IDs 3101–3103 and that owner/API/Git tokens are
  absent from the committed files. Its five allowed API mutations are reserve,
  project registration, deployment creation, preflight and full-attempt creation.
  All Git commits target the dedicated working branch with non-force updates.

The requested regression set is 16 tests across the route, catalog-handoff,
fork-reuse, deploy-happy and host-capacity specs. Initial execution exposed the
two stale fixtures; the corrected workflows passed. Final release evidence must
bind a fresh run to the exact archived UI distribution after all source slices
are integrated. Earlier local runs do not prove that later release bytes match.

## Reproduce against production assets

Use supported Node 24, install the locked dependencies and build. Start the
preview in one terminal, then run the selected specs in another:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4196
```

```sh
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:4196 npm run test:e2e -- \
  e2e/route-regressions.spec.ts e2e/catalog-handoff.spec.ts \
  e2e/fork-reuse.spec.ts e2e/deploy-happy.spec.ts e2e/host-capacity.spec.ts
```

The existing Playwright configuration reuses the running preview in local mode.
Confirm it serves `dist`; the fallback configuration can otherwise start Vite's
development server. Route/fixture TypeScript was checked strictly, focused
save/registration/editor tests passed, and scoped ESLint/build checks passed.
The existing build advisory for chunks above 500 kB remains. This is targeted
keyboard/layout coverage, not a complete accessibility or all-features audit.
