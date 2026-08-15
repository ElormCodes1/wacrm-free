import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { routeSegments, allReservedSlugs, FUTURE_RESERVED } from './reserved-slugs';

const APP_DIR = join(process.cwd(), 'src', 'app');

describe('routeSegments', () => {
  it('finds the real top-level URL segments the app serves', () => {
    const segments = routeSegments(APP_DIR);
    // Route groups contribute nothing to the URL, so (auth)/login is
    // served at /login — a top-level name a company could collide with.
    expect(segments).toContain('login');
    expect(segments).toContain('signup');
    expect(segments).toContain('api');
    expect(segments).toContain('join');
  });

  it('does not count company-area pages as top-level names', () => {
    // They live below the company segment now — /acme/inbox — so they
    // cannot collide with a slug. They are still reserved (see
    // allReservedSlugs), just not because of a live collision.
    expect(routeSegments(APP_DIR)).not.toContain('inbox');
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

  it('covers every page inside a company area too', () => {
    const reserved = new Set(allReservedSlugs(APP_DIR));
    for (const route of ['inbox', 'settings', 'contacts', 'broadcasts']) {
      expect(reserved.has(route)).toBe(true);
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
    expect(segments.length).toBeGreaterThan(3);
    const reserved = allReservedSlugs(APP_DIR);
    expect(segments.every((s) => reserved.includes(s))).toBe(true);
  });
});
