# Application typechecking

Run on the supported Node version after `npm ci`:

```sh
npm run typecheck
npm run typecheck:migrated
npm run test:typecheck
```

`typecheck` runs the pinned `vue-tsc` against `tsconfig.json` without emitting
files. This follows the [Vue TypeScript tooling guidance](https://vuejs.org/guide/typescript/overview):
Vite transpiles application code; the separate checker handles TypeScript and
Vue single-file components. CI runs the migrated-source gate (which includes the application check) and
compiler regressions before its production build.

## Coverage

- Every implementation TypeScript/TSX and Vue file under `src` is included,
  including files not currently imported by the router. The coverage test walks
  the actual source tree and compares it with the compiler's resolved file list.
- TypeScript files and Vue components with `lang="ts"` use strict checking.
  `strictTemplates` remains enabled; only valid HTML `data-*` attributes are
  exempt from unknown-attribute checks.
- Existing JavaScript modules and JavaScript-script Vue components participate
  in module resolution and inferred public types through `allowJs: true`.
  Their bodies/templates are **not checked by default** with `checkJs: false`.
  The files listed in `typecheck-migrated.json` explicitly opt in through
  `@ts-check`; their JavaScript bodies and Vue templates are checked. This is not
  a claim that all JavaScript or all Vue components have strict type safety.
  See the [TypeScript `checkJs` contract](https://www.typescriptlang.org/tsconfig/checkJs.html).
- Unit/browser fixtures, tooling configuration and dependency declarations are
  outside this application gate. Unit tests and ESLint remain separate checks;
  `skipLibCheck` skips third-party declaration validation, not application code.

The compiler regression runs real temporary fixtures. It verifies that a bad
TypeScript assignment and a bad TypeScript Vue template call both fail, while
an equivalent legacy JavaScript module/SFC remains outside checked coverage.
It does not use a fake compiler or infer coverage from the production bundle.

## Initial source corrections

The first complete configured run exposed missing local project/store types,
nullable focus targets, repository-field update type boundaries, an incorrect
writable-computed return type and incomplete legacy topology declarations.
The fixes preserve the existing authored project fields and exact destination
identity. Local store import annotations now retain the supplied project type;
they do not replace the existing runtime format/file validation.

Historical acceptance reports that mention scoped temporary TypeScript checks
remain historical evidence. This new gate does not retroactively extend their
coverage or establish live Git/editor/provider acceptance.

The initial checkpoint passed the application checker, both real compiler
contract tests, 92 affected unit tests across 10 files, and scoped ESLint.
The full unit suite and production build are separate integration gates; they
were not repeated for this type-only checkpoint. Enabling strict JavaScript
checking remains a follow-up and is not represented by this green result.

## Incremental JavaScript coverage

`npm run typecheck:migrated` first verifies that every entry in
`typecheck-migrated.json` remains an implementation JavaScript module/SFC with
a leading `@ts-check` and no unchecked override. It then runs the same strict
application compiler. The regression includes real checked JavaScript and
checked JavaScript-script Vue fixtures whose deliberate type errors must fail.

The first migrated files are the Git-opening dialog and local project store.
Their refs, reviewed Git connection and project inputs have explicit JSDoc
types. Blank projects now carry an empty attachment collection. File import
refuses a non-text FileReader result before changing the existing project list.

A separate **read-only** `checkJs: true` inventory on 14 September 2026 found
1,693 diagnostics across 95 files: 1,330 in Vue, 359 in JavaScript and four in a
concurrently prepared TypeScript snapshot service. The largest areas were the
project editor (203), scenario authoring modal (120), concrete scenario compiler
(97), replication panel (94) and deployment detail (87). These are an initial
inventory, not a current remaining-error count after later edits. Raw local
evidence: `/tmp/r42-ui-checkjs-inventory.json` and its `.log` companion.

The small migrated-file gate does not resolve that full inventory. Remaining
JavaScript/Vue domains require additional typed boundaries and source-specific
regressions before their annotations are enabled; no blanket suppressions are
used to label them complete.

This first JavaScript slice passed `typecheck:migrated`, four compiler/gate
regressions, 51 affected tests across five files, and scoped ESLint. The normal
strict gate stayed enabled; the remaining JavaScript inventory was not hidden
or marked resolved.

## Checked project editor

The next migrated file is `src/views/ProjectEditor.vue`. Its JavaScript script
and Vue template now use `@ts-check`, with explicit project/Git state, nullable
refs, timer handles and event payloads. Adding that annotation first produced
210 diagnostics; the completed slice passes the maintained application checker.

VueFlow rows cross the local-project boundary as plain copied objects that keep
all existing fields, including desired configuration and observations. The
Problems API accepts readonly object rows instead of requiring arbitrary index
signatures. Four public ref annotations in `useInfraBuilder.js` describe its
existing VueFlow values; that helper's remaining JavaScript is **not** claimed
as migrated or fully checked.

The checks exposed two narrow runtime cases: missing/non-object node data now
returns a topology validation error before the existing validator dereferences
it, and a legacy Git provider without commit-list support reports that missing
capability before exposing a broken History provider. Focused regressions cover
both plus preservation of local graph fields and binary files.

Validation for this isolated slice: `typecheck:migrated`, four compiler/gate
regressions, 51 affected tests across five files, and scoped ESLint pass. It was
not deployed and does not include a new production build or full-suite run.
The 1,693-error inventory above remains a historical baseline; no arithmetic
remaining-count claim is inferred from removing this editor's diagnostics.
