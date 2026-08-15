import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The front door.
 *
 * The bug this guards against already happened once: the root page
 * redirected to /dashboard, that route moved under /[company], and the
 * product's own home page started answering "No company at this address".
 * Nobody noticed because everyone testing it was signed in and went
 * somewhere else immediately.
 *
 * So the cases worth pinning are the ones a signed-in developer never
 * sees: what an anonymous visitor gets, and what someone whose company is
 * suspended gets.
 */

const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    // Next's redirect() signals by throwing, and the real control flow
    // depends on that — code after it must not run.
    const err = new Error(`NEXT_REDIRECT:${path}`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;${path}`;
    throw err;
  })
);
const getCompany = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/tenancy/company', () => ({ getCompany }));
// Rendering the marketing page is not what is under test here, and pulling
// in its icon set would only slow the suite down.
vi.mock('@/components/marketing/landing-page', () => ({
  LandingPage: () => null,
}));

import RootPage from './page';

/** Runs the page and reports where it sent the visitor, if anywhere. */
async function visit(): Promise<{ redirectedTo: string | null; rendered: boolean }> {
  try {
    const out = await RootPage();
    return { redirectedTo: null, rendered: out != null };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT;')) {
      return { redirectedTo: digest.slice('NEXT_REDIRECT;'.length), rendered: false };
    }
    throw err;
  }
}

describe('the root page', () => {
  beforeEach(() => {
    redirect.mockClear();
    getCompany.mockReset();
  });

  it('sends a signed-in member to their own company', async () => {
    getCompany.mockResolvedValue({
      ok: true,
      company: { slug: 'adusei-enterprise', accountId: 'acc-1', name: 'Adusei Enterprise' },
    });

    expect(await visit()).toEqual({ redirectedTo: '/adusei-enterprise', rendered: false });
  });

  it('takes the destination from the session, never from a fixed path', async () => {
    // The original bug was a hardcoded '/dashboard'. Two different sessions
    // must produce two different destinations.
    getCompany.mockResolvedValue({ ok: true, company: { slug: 'first-co' } });
    expect((await visit()).redirectedTo).toBe('/first-co');

    getCompany.mockResolvedValue({ ok: true, company: { slug: 'second-co' } });
    expect((await visit()).redirectedTo).toBe('/second-co');
  });

  it('shows the landing page to a visitor with no session', async () => {
    getCompany.mockResolvedValue({ ok: false, failure: { reason: 'unauthenticated' } });

    expect(await visit()).toEqual({ redirectedTo: null, rendered: true });
  });

  it.each([
    ['suspended', { reason: 'suspended', slug: 'x', name: 'X' }],
    ['deactivated', { reason: 'deactivated' }],
    ['no-company', { reason: 'no-company' }],
  ])('shows the landing page rather than an error when %s', async (_label, failure) => {
    getCompany.mockResolvedValue({ ok: false, failure });

    // A suspended company's explanation lives on its own branded address.
    // This page cannot know which company is meant before a sign-in, so the
    // one thing it must not do is fail.
    expect(await visit()).toEqual({ redirectedTo: null, rendered: true });
  });

  it('never redirects anywhere but a company root', async () => {
    getCompany.mockResolvedValue({ ok: true, company: { slug: 'acme-co' } });
    await visit();

    const target = redirect.mock.calls[0][0];
    expect(target).toMatch(/^\/[a-z0-9][a-z0-9-]*$/);
  });
});
