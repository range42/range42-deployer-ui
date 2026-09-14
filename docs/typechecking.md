# Application typechecking

Run on the supported Node version after `npm ci`:

```sh
npm run typecheck
npm run test:typecheck
```

`typecheck` runs the pinned `vue-tsc` against `tsconfig.json` without emitting
files. This follows the [Vue TypeScript tooling guidance](https://vuejs.org/guide/typescript/overview):
Vite transpiles application code; the separate checker handles TypeScript and
Vue single-file components. CI runs both commands before its production build.

## Coverage

- Every implementation TypeScript/TSX and Vue file under `src` is included,
  including files not currently imported by the router. The coverage test walks
  the actual source tree and compares it with the compiler's resolved file list.
- TypeScript files and Vue components with `lang="ts"` use strict checking.
  `strictTemplates` remains enabled; only valid HTML `data-*` attributes are
  exempt from unknown-attribute checks.
- Existing JavaScript modules and JavaScript-script Vue components participate
  in module resolution and inferred public types through `allowJs: true`.
  Their bodies/templates are **not checked** with `checkJs: false`. This is not
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
