import { describe, it, expect } from 'vitest';
import { resolve_secrets } from '@/overlay/resolve_secrets';
import { NotImplemented } from '@/overlay/errors';
import type { CatalogEntry } from '@/types/range42-schema';

describe('overlay/resolve_secrets — skeleton', () => {
  it('[trivial] empty vault with env — identity pass', () => {
    const doc: CatalogEntry = {
      schema_version: '1.0', kind: 'lab', name: 'x',
      env: [{ name: 'admin_password', scope: 'per_team', secret: true, required: true }],
    };
    expect(resolve_secrets(doc, {})).toEqual(doc);
  });

  it('[trivial] no env with vault — identity pass', () => {
    const doc: CatalogEntry = { schema_version: '1.0', kind: 'lab', name: 'x' };
    expect(resolve_secrets(doc, { admin_password: 'hunter2' })).toEqual(doc);
  });

  it('[edge] env + vault raises NotImplemented (Plan B)', () => {
    const doc: CatalogEntry = {
      schema_version: '1.0', kind: 'lab', name: 'x',
      env: [{ name: 'admin_password', secret: true, required: true }],
    };
    expect(() => resolve_secrets(doc, { admin_password: 'hunter2' })).toThrow(NotImplemented);
  });
});
