import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { COMPANY_ROUTES } from './routes';

/**
 * Words a company may not claim as its address.
 *
 * A company must not collide with a page in the app in either direction,
 * and being shadowed BY a page is the worse failure: Next resolves a
 * static segment before a dynamic one, so a company called "settings"
 * would send its own staff to the app's settings page — which looks like
 * a bug rather than something that explains itself.
 *
 * The route half of this list is READ FROM THE FILESYSTEM rather than
 * typed out, so adding a page protects its own name without anyone
 * remembering to update a list. A test asserts the database's copy matches
 * what this returns, so the two cannot drift silently.
 */

/** Directories under src/app that never become URL segments. */
function isUrlSegment(name: string): boolean {
  // (group) — route groups are organisational and don't appear in URLs,
  // but their CHILDREN do, so those are walked into instead.
  if (name.startsWith('(') || name.startsWith('_') || name.startsWith('@')) return false;
  // [param] — dynamic segments are not literal words anyone can claim.
  if (name.startsWith('[')) return false;
  if (name.startsWith('.')) return false;
  return !name.includes('.');
}

/**
 * Every literal first-path segment the app serves today.
 *
 * Walks into route groups because `(dashboard)/inbox` is served at
 * `/inbox` — the group contributes nothing to the URL, so its children
 * are top-level names and are exactly the ones at risk of collision.
 */
export function routeSegments(appDir: string): string[] {
  if (!existsSync(appDir)) return [];
  const found = new Set<string>();

  const walk = (dir: string, insideGroup: boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('(')) {
        // A group adds no segment; its children are still top-level.
        walk(join(dir, name), true);
        continue;
      }
      if (!isUrlSegment(name)) continue;
      found.add(name.toLowerCase());
      // Only the FIRST segment can collide with a company address, so
      // there is no need to descend past it.
      void insideGroup;
    }
  };

  walk(appDir, false);
  return [...found].sort();
}

/**
 * Words a hosted product will want later, independent of today's routes.
 *
 * Reserving costs nothing; reclaiming a word from a customer who has
 * already printed it is impossible. So this errs heavily towards holding
 * too much.
 */
export const FUTURE_RESERVED: readonly string[] = [
  'admin', 'operator', 'operators', 'billing', 'account', 'accounts',
  'auth', 'login', 'logout', 'signin', 'signup', 'register',
  'password', 'reset', 'verify', 'invite', 'invites', 'join',
  'app', 'www', 'api', 'cdn', 'static', 'assets', 'public',
  'docs', 'doc', 'help', 'support', 'status', 'blog', 'about', 'pricing',
  'terms', 'privacy', 'legal', 'security', 'contact', 'sales', 'demo',
  'trial', 'onboarding', 'welcome', 'home', 'dashboard', 'settings',
  'profile', 'search', 'health', 'metrics', 'webhook', 'webhooks',
  'callback', 'oauth', 'sso', 'mail', 'email', 'new', 'create', 'edit',
  'delete', 'test', 'testing', 'staging', 'dev',
] as const;

/**
 * The complete reserved set: what the app serves at the top level, every
 * route inside a company area, and what a hosted product will want.
 *
 * Company routes cannot collide today — they live BELOW the company
 * segment, so /acme/inbox and a company called "inbox" never meet. They
 * are reserved anyway: if a page is ever promoted to the top level, or a
 * marketing page claims the word, a company already printing it would be
 * shadowed with no way back. Holding the word costs nothing now and is
 * impossible to reclaim later.
 */
export function allReservedSlugs(appDir: string): string[] {
  return [
    ...new Set([...routeSegments(appDir), ...COMPANY_ROUTES, ...FUTURE_RESERVED]),
  ].sort();
}
