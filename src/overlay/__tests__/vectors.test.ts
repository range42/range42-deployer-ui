/**
 * Consolidated shared-vector harness (Plan C task C1.14 step 5).
 *
 * Every JSON vector under schema/test-vectors/{compose,expand_replication}
 * feeds both the TS and Python operator halves. This file is the TS side —
 * each `expected` block is compared byte-identically with the TS operator
 * output. The Python side lives in range42-backend-api/tests/overlay/.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compose } from '@/overlay/compose';
import { expand_replication } from '@/overlay/expand_replication';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', 'schema', 'test-vectors');

function load(dir: string): Array<Record<string, unknown>> {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')));
}

describe('compose vectors', () => {
  for (const v of load('compose')) {
    const title = (v.name as string) ?? 'vector';
    // eslint-disable-next-line vitest/valid-title
    it(title, () => {
      const input = v.input as { base: unknown; overlay: unknown };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const got = compose(input.base as any, input.overlay as any);
      expect(got).toEqual(v.expected);
    });
  }
});

describe('expand_replication vectors', () => {
  for (const v of load('expand_replication')) {
    const title = (v.name as string) ?? 'vector';
    // eslint-disable-next-line vitest/valid-title
    it(title, () => {
      const input = v.input as { document: unknown; team_count: number };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const got = expand_replication(input.document as any, input.team_count);
      const exp = v.expected as Record<string, unknown>;
      expect(got.plays_per_team).toEqual(exp.plays_per_team);
      expect(got.handler_namespaces).toEqual(exp.handler_namespaces);
      if (exp.document !== undefined) {
        expect(got.document).toEqual(exp.document);
      }
    });
  }
});
