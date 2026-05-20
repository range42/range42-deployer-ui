#!/usr/bin/env bash
# bundle-refs.sh — resolves $ref in range42.schema.json and writes bundled.json.
# Uses @apidevtools/json-schema-ref-parser (installed as devDep).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$UI_ROOT/schema/range42.schema.json"
OUT="$UI_ROOT/schema/bundled.json"

if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found" >&2
  exit 2
fi

cd "$UI_ROOT"
node --input-type=module -e "
  import('@apidevtools/json-schema-ref-parser').then(async ({ default: refParser }) => {
    const bundled = await refParser.bundle('$SRC');
    const fs = await import('node:fs');
    fs.writeFileSync('$OUT', JSON.stringify(bundled, null, 2) + '\n');
    console.log('wrote ' + '$OUT');
  }).catch(err => { console.error(err); process.exit(1); });
"
