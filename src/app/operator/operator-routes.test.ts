import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The operator sign-in page must not be guarded by the operator guard.
 *
 * This is not hypothetical. The guard originally lived at
 * src/app/operator/layout.tsx, which in the App Router wraps EVERY route
 * below it — including /operator/login. So the sign-in page was protected
 * by a rule whose failure action is "redirect to the sign-in page", and
 * it redirected to itself forever. The operator plane was unreachable
 * through a browser for as long as it existed, and nobody noticed because
 * every session in testing was minted by POSTing to the API directly —
 * the one path a real person never takes.
 *
 * The fix was structural: the guard moved into a (console) route group,
 * which adds no URL segment, leaving /operator/login outside it. This
 * test pins that arrangement, because the mistake is an easy one to make
 * again — putting a layout at src/app/operator/ is the obvious thing to
 * do, and it breaks sign-in silently for anyone not testing through a
 * browser.
 */
describe('the operator sign-in page', () => {
  it('is not wrapped by a layout that redirects to it', () => {
    expect(
      existsSync('src/app/operator/layout.tsx'),
      'A layout at src/app/operator/ wraps /operator/login too. If it redirects ' +
        'unauthenticated visitors to /operator/login, that page redirects to itself ' +
        'and nobody can sign in. Put the guard in src/app/operator/(console)/ instead.'
    ).toBe(false);
  });

  it('keeps the guard in the (console) group, next to the pages it protects', () => {
    const guard = 'src/app/operator/(console)/layout.tsx';
    expect(existsSync(guard), `${guard} is missing — the console would be unguarded`).toBe(true);
    expect(readFileSync(guard, 'utf8')).toContain('getOperator');
  });

  it('leaves the sign-in page outside the group', () => {
    expect(existsSync('src/app/operator/login/page.tsx')).toBe(true);
    expect(
      existsSync('src/app/operator/(console)/login/page.tsx'),
      'Moving sign-in inside (console) puts it back behind the guard'
    ).toBe(false);
  });
});
