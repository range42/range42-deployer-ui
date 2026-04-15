import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { expand_replication } from '@/overlay/expand_replication';
import { NotImplemented } from '@/overlay/errors';

const here = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = join(here, '..', '..', '..', 'schema', 'test-vectors', 'expand_replication');

describe('overlay/expand_replication — vector harness', () => {
  const files = readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const vec = JSON.parse(readFileSync(join(VECTORS_DIR, file), 'utf8'));
    const label = `${file} — ${vec.name}`;
    if (vec.edge) {
      it(`[edge] ${label} raises NotImplemented (Plan A skeleton)`, () => {
        expect(() => expand_replication(vec.input.document, vec.input.team_count))
          .toThrow(NotImplemented);
      });
    } else {
      it(`[trivial] ${label} matches expected`, () => {
        const got = expand_replication(vec.input.document, vec.input.team_count);
        expect(got.plays_per_team).toBe(vec.expected.plays_per_team);
        expect(got.handler_namespaces).toEqual(vec.expected.handler_namespaces);
        if (vec.expected.document) {
          expect(got.document).toEqual(vec.expected.document);
        }
      });
    }
  }
});
