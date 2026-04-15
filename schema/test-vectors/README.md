# Test Vectors

Shared JSON fixtures driving parity between the TypeScript (`src/overlay/*.ts`)
and Python (`range42-backend-api/app/overlay/*.py`) operator libraries.

## Layout

- `compose/` — `compose(base, overlay) -> effective_document`
- `expand_replication/` — `expand_replication(document, team_count) -> { plays_per_team, handler_namespaces, document }`
- `redaction/` — `apply_redactions(event, layers) -> { event, redactions[] }`

## File shape

```
{
  "name": "human label",
  "operator": "compose|expand_replication|redaction",
  "edge": true,    // optional — marks the edge vector (may NotImplemented pre-land)
  "input": { ... },
  "expected": { ... }
}
```

## Running

- TS: `npm run test:unit` (vitest reads vectors via `src/overlay/__tests__/*.spec.ts`)
- Python: `cd range42-backend-api && source _virtenv.enable.sh && pytest tests/overlay/`
- CI: `.github/workflows/schema-and-operators.yml` runs both plus a cross-compare.

## Rules

- One trivial-pass vector and one edge vector per operator in v1.
- `edge: true` vectors may raise `NotImplemented` / `NotImplementedError`
  pre-implementation; the harness records this separately from failures.
- Adding an operator means adding a vector. No vector, no merge.
