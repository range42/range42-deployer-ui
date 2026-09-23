# Shared catalog handoff acceptance

UI commit `602c9264027ededae3ad29f207d4bc4a7148925e` was installed at
**http://100.64.0.14:3002** on 11 September 2026 at 14:41 UTC. The 91-file build
matches the locally tested production bytes. Existing assets and runtime config
were retained; API `f068f2f`, runtime `af5ed422…` and schema `0006` stayed unchanged.

A fresh browser passed the actual backend/public-GitHub flow at 14:43 UTC:

- Authenticate to the shared backend and read its existing default catalog.
- Customize the real `service.reload.ntp` role into a reviewed project path,
  with a dedicated working branch and an explicit pending-fork destination.
- Import all seven role files with bytes matching the committed default fixture.
- Retain original repository/path/commit provenance independently of the Git
  destination and its pinned base commit.
- Reload the project and display Config at desktop/mobile sizes without page
  errors or horizontal overflow.

No API/provider request was intercepted and no backend/provider mutation was
sent. This verifies real catalog/provider reads and local authoring persistence;
it does not verify Git Save, fork creation, publication or role execution.
The indexed public catalog SHA was `9155746b3a0f688febf2437632e4f5dca1cdc981`.

Source validation: 161 focused tests, strict service TypeScript, scoped ESLint,
production build, two local production-browser tests and both exact-head CI
runs passed. The shared browser ran after source activation against those exact
production bytes. Its evidence is retained in
`/tmp/r42-shared-release-catalog-handoff-602c926-20260911/browser-outcome.json`;
deployment `docs/15-shared-catalog-handoff-results.md` and its committed release
JSON record the activation, preservation checks and initial pre-transfer retry.

Role-to-VM execution attachment, broader role dependencies/file modes,
container/bundle customization, legacy Fork & publish and distributed editing
remain separate unfinished work. The prior three-VM cloud-init failure remains
unresolved; this authoring acceptance does not supersede it.
