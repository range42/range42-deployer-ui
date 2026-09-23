import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { serializeToCatalogEntry } from '@/overlay/serialize';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '..', '..', '..', 'schema', 'test-vectors', 'serialize');

describe('overlay/serialize — vector harness', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const vec = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    it(`${file} — ${vec.name}`, () => {
      const got = serializeToCatalogEntry(vec.input.canvas, vec.input.meta);
      expect(got).toEqual(vec.expected);
    });
  }
});
