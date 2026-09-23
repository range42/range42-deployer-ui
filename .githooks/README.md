# Range42 git hooks

Enable for this clone:

```
git config core.hooksPath .githooks
```

## What `pre-commit` does

If the staged changes touch `schema/`, `tools/`, `src/overlay/`, or
`src/types/range42-schema.ts`, the hook:

1. Regenerates `schema/bundled.json` via `tools/bundle-refs.sh`.
2. Regenerates `range42-backend-api/app/schemas/generated.py` via
   `tools/generate-pydantic.sh` if the sibling repo and its virtenv
   are present.
3. Aborts if either regenerated file is out of date relative to the
   staged set — the author must stage the regenerated files and retry.

This mirrors the drift check in
`.github/workflows/schema-and-operators.yml`. CI is still authoritative.
