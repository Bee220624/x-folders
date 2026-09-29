import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLeaks } from '../helpers/sanitizedCheck';

/** Samples taken with tools/capture-fixture.js (M2 onwards); the v0.1 samples predate it. */
const SANITIZED_FIXTURES = ['x-home-rich.html', 'x-status-long.html', 'x-bookmarks.html'];

describe('committed page samples leak nothing (work order 3.3 rule 2)', () => {
  for (const name of SANITIZED_FIXTURES) {
    const path = resolve(process.cwd(), 'tests/fixtures', name);
    // Task 14 captures these and turns the skip into a plain `it`.
    it.skipIf(!existsSync(path))(name, () => {
      expect(findLeaks(readFileSync(path, 'utf8'))).toEqual([]);
    });
  }
});
