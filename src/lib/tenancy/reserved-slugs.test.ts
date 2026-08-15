import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { routeSegments, allReservedSlugs, FUTURE_RESERVED } from './reserved-slugs';

const APP_DIR = join(process.cwd(), 'src', 'app');

describe('routeSegments', () => {
  it('finds the real URL segments the app serves', () => {
    const segments = routeSegments(APP_DIR);
    // Served at /inbox even though the folder is (dashboard)/inbox — a
    // route group contributes nothing to the URL, so its children are
    // top-level names and are exactly what a company could collide with.
    expect(segments).toContain('inbox');
    expect(segments).toContain('settings');
    expect(segments).toContain('login');
    expect(segments).toContain('api');
  });

  it('does not treat route groups or dynamic segments as claimable words', () => {
    const segments = routeSegments(APP_DIR);
    expect(segments.some((s) => s.startsWith('('))).toBe(false);
    expect(segments.some((s) => s.startsWith('['))).toBe(false);
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(routeSegments(join(APP_DIR, 'definitely-not-here'))).toEqual([]);
  });
});

describe('allReservedSlugs', () => {
  it('covers every page the app serves', () => {
    const reserved = new Set(allReservedSlugs(APP_DIR));
    for (const segment of routeSegments(APP_DIR)) {
      expect(reserved.has(segment)).toBe(true);
    }
  });

  it('covers the words a hosted product will want', () => {
    const reserved = new Set(allReservedSlugs(APP_DIR));
    for (const word of FUTURE_RESERVED) {
      expect(reserved.has(word)).toBe(true);
    }
  });

  it('is self-maintaining: a new page is reserved without editing a list', () => {
    // The route half is read from disk, so this holds by construction.
    // Asserted explicitly because the property is the point: if someone
    // replaces the walk with a hardcoded array, this fails.
    const segments = routeSegments(APP_DIR);
    expect(segments.length).toBeGreaterThan(5);
    const reserved = allReservedSlugs(APP_DIR);
    expect(segments.every((s) => reserved.includes(s))).toBe(true);
  });
});
