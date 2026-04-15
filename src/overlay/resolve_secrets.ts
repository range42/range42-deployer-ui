import type { CatalogEntry } from '@/types/range42-schema';
import { NotImplemented } from './errors';

/**
 * resolve_secrets — substitutes env/secret references against a vault map.
 * v1 Plan A skeleton: identity-only when the vault is empty OR the document
 * declares no env entries. Otherwise raises NotImplemented.
 */
export function resolve_secrets(
  document: CatalogEntry,
  vault: Readonly<Record<string, string>>,
): CatalogEntry {
  const hasEnv = (document.env?.length ?? 0) > 0;
  const hasVault = Object.keys(vault).length > 0;
  if (hasEnv && hasVault) {
    throw new NotImplemented('resolve_secrets', 'env-substitution', 'Plan B delivery');
  }
  return structuredClone(document);
}
