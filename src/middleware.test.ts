import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to their company's sign-in", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      // A company page: pages live at /{company}/... now, and the
      // redirect carries the company so the sign-in is branded.
      new NextRequest("https://app.test/acme/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("company=acme");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      // A company page: pages live at /{company}/... now, and the
      // redirect carries the company so the sign-in is branded.
      new NextRequest("https://app.test/acme/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

/**
 * The company-segment rule decides, structurally, that anything with a
 * non-app word in the first position is a company address. That is what
 * makes new company pages protected the day they are added — but it also
 * means every genuinely top-level route has to be declared, and the
 * declaration is a hand-kept list.
 *
 * This is where that list went wrong once already: /operator/audit was
 * read as the company "operator" and redirected to the CUSTOMER sign-in,
 * so the operator console demanded a session it never uses. /operator on
 * its own was fine (one segment), and /operator/login was fine (the login
 * exception), so the gap only appeared once the console grew a second
 * page — long after the list was written.
 *
 * Deriving the list at request time is not possible: middleware cannot
 * read the filesystem. Deriving it in a TEST is, so a new top-level route
 * fails here until it is declared, rather than silently sending its
 * visitors to the wrong sign-in.
 */
describe("middleware — every top-level route is declared", () => {
  it("declares every real top-level route directory", async () => {
    const { routeSegments } = await import("@/lib/tenancy/reserved-slugs");
    const { readFileSync } = await import("node:fs");

    const onDisk = routeSegments("src/app");

    // Read the set out of the source rather than exporting it: the export
    // would exist only for this test, and middleware.ts is loaded by the
    // edge runtime where an extra export is not free.
    const source = readFileSync("src/middleware.ts", "utf8");
    const block = source.match(/TOP_LEVEL_ROUTES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(block, "could not find TOP_LEVEL_ROUTES in middleware.ts").toBeTruthy();
    const declared = new Set(
      [...block![1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]),
    );

    const missing = onDisk.filter((segment) => !declared.has(segment));
    expect(
      missing,
      `these top-level routes are not declared in TOP_LEVEL_ROUTES, so a URL ` +
        `two segments deep under them redirects to the customer sign-in: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
