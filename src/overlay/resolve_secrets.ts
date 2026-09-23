/**
 * resolve_secrets — substitute `env.secret.<name>` references against a
 * caller-provided vault map. Byte-parity with
 * range42-backend-api/app/overlay/resolve_secrets.py.
 *
 * Any dict field `<key>_from` whose string value starts with
 * `env.secret.` is rewritten to `<key>: { VAULT_MARKER: true, value: ... }`
 * and the original `<key>_from` entry is removed. Missing required
 * secrets throw a hard error — callers are expected to prompt.
 */
import type { CatalogEntry } from '@/types/range42-schema';

// Must match range42-backend-api/app/core/redaction.py VAULT_MARKER.
export const VAULT_MARKER = '__range42_vault_origin__';

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function walk(obj: unknown, lookup: Readonly<Record<string, string>>): void {
  if (isDict(obj)) {
    const rewrites: Array<[string, string]> = [];
    for (const [k, v] of Array.from(Object.entries(obj))) {
      if (typeof v === 'string' && k.endsWith('_from') && v.startsWith('env.secret.')) {
        const name = v.slice('env.secret.'.length);
        const val = Object.prototype.hasOwnProperty.call(lookup, name)
          ? lookup[name]
          : undefined;
        if (val === undefined || val === null) {
          throw new Error(`Secret not found: ${name}`);
        }
        const dst = k.slice(0, -'_from'.length);
        rewrites.push([k, dst]);
        obj[dst] = { [VAULT_MARKER]: true, value: val };
      }
    }
    for (const [k] of rewrites) {
      delete obj[k];
    }
    for (const v of Object.values(obj)) {
      walk(v, lookup);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      walk(item, lookup);
    }
  }
}

export function resolve_secrets(
  document: CatalogEntry,
  vault: Readonly<Record<string, string>>,
): CatalogEntry {
  const out = structuredClone(document);
  walk(out as unknown as Dict, vault);
  return out;
}
