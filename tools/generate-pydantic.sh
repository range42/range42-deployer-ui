#!/usr/bin/env bash
# generate-pydantic.sh — runs datamodel-code-generator against bundled.json.
# Writes app/schemas/generated.py in the sibling backend repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$UI_ROOT/.." && pwd)"
BACKEND_ROOT="$REPO_ROOT/range42-backend-api"

IN="$UI_ROOT/schema/bundled.json"
OUT="$BACKEND_ROOT/app/schemas/generated.py"

if [[ ! -f "$IN" ]]; then
  echo "error: $IN not found — run bundle-refs.sh first" >&2
  exit 2
fi
if [[ ! -d "$BACKEND_ROOT" ]]; then
  echo "error: backend repo not found at $BACKEND_ROOT" >&2
  exit 2
fi

if ! command -v datamodel-codegen >/dev/null 2>&1; then
  echo "error: datamodel-codegen not on PATH — activate backend virtenv first" >&2
  exit 2
fi

datamodel-codegen \
  --input "$IN" \
  --input-file-type jsonschema \
  --output "$OUT" \
  --output-model-type pydantic_v2.BaseModel \
  --use-annotated \
  --field-constraints \
  --target-python-version 3.11 \
  --use-standard-collections \
  --use-schema-description \
  --use-union-operator \
  --use-double-quotes \
  --disable-timestamp \
  --reuse-model

# Datamodel-codegen emits discriminator info per oneOf when discriminator
# keyword is present. Our schema's top-level oneOf is structural; we rely
# on distinct required fields to disambiguate in the generated union.

echo "wrote $OUT"
