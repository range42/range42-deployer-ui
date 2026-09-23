import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compose } from '@/overlay/compose';

const here = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = join(here, '..', '..', '..', 'schema', 'test-vectors', 'compose');

describe('overlay/compose — shared vector harness', () => {
  const files = readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const vec = JSON.parse(readFileSync(join(VECTORS_DIR, file), 'utf8'));
    const label = `${file} — ${vec.name}`;
    // eslint-disable-next-line vitest/valid-title
    it(label, () => {
      const got = compose(vec.input.base, vec.input.overlay);
      expect(got).toEqual(vec.expected);
    });
  }
});
