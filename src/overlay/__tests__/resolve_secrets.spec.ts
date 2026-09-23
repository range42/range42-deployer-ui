import { describe, it, expect } from 'vitest';
import { resolve_secrets, VAULT_MARKER } from '@/overlay/resolve_secrets';
import type { CatalogEntry } from '@/types/range42-schema';

describe('overlay/resolve_secrets — unit + edge cases', () => {
  it('[trivial] empty vault with declared env — identity pass', () => {
    const doc: CatalogEntry = {
      schema_version: '1.0',
      kind: 'lab',
      name: 'x',
      env: [{ name: 'admin_password', scope: 'per_team', secret: true, required: true }],
    };
    expect(resolve_secrets(doc, {})).toEqual(doc);
  });

  it('[trivial] no env with vault — identity pass', () => {
    const doc: CatalogEntry = { schema_version: '1.0', kind: 'lab', name: 'x' };
    expect(resolve_secrets(doc, { admin_password: 'hunter2' })).toEqual(doc);
  });

  it('[edge] rewrites `*_from: env.secret.<name>` into a vault-marker object', () => {
    const doc: CatalogEntry = {
      schema_version: '1.0',
      kind: 'lab',
      name: 'x',
      env: [{ name: 'admin_password', secret: true, required: true }],
      nodes: [
        {
          id: 'dc',
          kind: 'vm',
          attachments: [
            {
              source: { kind: 'catalog_role', ref: 'software.install.ad_dc' },
              stage: 'install',
              vars: {
                admin_password_from: 'env.secret.admin_password',
              } as Record<string, unknown>,
            },
          ],
        },
      ],
    };
    const out = resolve_secrets(doc, { admin_password: 'hunter2' });
    const vars = (out.nodes?.[0].attachments?.[0].vars ?? {}) as Record<string, unknown>;
    expect(vars.admin_password_from).toBeUndefined();
    expect(vars.admin_password).toEqual({
      [VAULT_MARKER]: true,
      value: 'hunter2',
    });
  });

  it('[edge] missing required secret throws', () => {
    const doc: CatalogEntry = {
      schema_version: '1.0',
      kind: 'lab',
      name: 'x',
      nodes: [
        {
          id: 'dc',
          kind: 'vm',
          attachments: [
            {
              source: { kind: 'catalog_role', ref: 'x' },
              stage: 'install',
              vars: {
                admin_password_from: 'env.secret.admin_password',
              } as Record<string, unknown>,
            },
          ],
        },
      ],
    };
    expect(() => resolve_secrets(doc, {})).toThrow(/Secret not found: admin_password/);
  });
});
