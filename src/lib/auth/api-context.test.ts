import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey } from "@/lib/api-keys/keys";
import type { ApiKeyRow } from "@/lib/api-keys/store";
import { ApiError } from "@/lib/api/v1/respond";
import { __resetRateLimitForTests, RATE_LIMITS } from "@/lib/rate-limit";

// Mock the service-role client factory — requireApiKey only stashes
// the returned client in the context; tests never call through it.
vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ __isMockAdminClient: true }),
}));

// Mock the store so we control which row a hash resolves to.
const findActiveKeyByHash = vi.fn<(hash: string) => Promise<ApiKeyRow | null>>();
const touchLastUsed = vi.fn();
const isApiAllowedForAccount = vi.fn<(accountId: string) => Promise<boolean>>();
vi.mock("@/lib/api-keys/store", () => ({
  findActiveKeyByHash: (hash: string) => findActiveKeyByHash(hash),
  touchLastUsed: (id: string) => touchLastUsed(id),
  isApiAllowedForAccount: (accountId: string) => isApiAllowedForAccount(accountId),
}));

// Import AFTER the mocks are registered.
const { requireApiKey } = await import("./api-context");

const KEY = generateApiKey().plaintext;

function reqWith(authHeader?: string): Request {
  return new Request("https://crm.example.com/api/v1/me", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: "key-1",
    account_id: "acct-1",
    created_by: "user-1",
    name: "Test key",
    scopes: ["messages:send"],
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  __resetRateLimitForTests();
  findActiveKeyByHash.mockReset();
  touchLastUsed.mockReset();
  // Allowed by default: the plan gate is off the critical path of every
  // other case here, and a company with no plan keeps API access anyway.
  isApiAllowedForAccount.mockReset();
  isApiAllowedForAccount.mockResolvedValue(true);
});

afterEach(() => {
  __resetRateLimitForTests();
});

async function expectApiError(p: Promise<unknown>, code: string, status: number) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: unknown) => {
    const err = e as ApiError;
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
}

describe("requireApiKey", () => {
  it("401s when no Authorization header is present", async () => {
    await expectApiError(requireApiKey(reqWith()), "unauthorized", 401);
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it("401s on a token that doesn't look like a wacrm key", async () => {
    await expectApiError(
      requireApiKey(reqWith("Bearer some-invite-token")),
      "unauthorized",
      401,
    );
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it("401s when the key is unknown / revoked / expired (store returns null)", async () => {
    findActiveKeyByHash.mockResolvedValue(null);
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "unauthorized",
      401,
    );
  });

  it("returns a context for a valid key with no scope required", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    expect(ctx.authType).toBe("api_key");
    expect(ctx.accountId).toBe("acct-1");
    expect(ctx.keyId).toBe("key-1");
    expect(ctx.scopes).toEqual(["messages:send"]);
    expect(touchLastUsed).toHaveBeenCalledWith("key-1");
  });

  it("accepts a bare key without the 'Bearer ' prefix", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(KEY));
    expect(ctx.accountId).toBe("acct-1");
  });

  it("403s when the key lacks the required scope", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ["contacts:read"] }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send"),
      "forbidden",
      403,
    );
  });

  it("passes when the key has the required scope", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ["messages:send"] }));
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send");
    expect(ctx.accountId).toBe("acct-1");
  });

  it("429s once the per-key budget is exhausted", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    // Burn the whole window.
    for (let i = 0; i < RATE_LIMITS.publicApi.limit; i++) {
      await requireApiKey(reqWith(`Bearer ${KEY}`));
    }
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "rate_limited",
      429,
    );
  });
});

/**
 * The plan gate.
 *
 * Enforced rather than advisory, so it needs the same care as the scope
 * check: it must refuse the request, and it must not tell an attacker
 * anything a valid key would not already reveal.
 */
describe("requireApiKey — plan gate", () => {
  const validKey = "wacrm_live_" + "k".repeat(43);

  function keyRow() {
    return {
      id: "key-1",
      account_id: "acct-1",
      created_by: null,
      name: "test",
      scopes: ["contacts:read"],
      expires_at: null,
      revoked_at: null,
    };
  }

  it("403s when the account's plan does not include the API", async () => {
    findActiveKeyByHash.mockResolvedValue(keyRow());
    isApiAllowedForAccount.mockResolvedValue(false);

    await expect(
      requireApiKey(new Request("https://x/api/v1/me", {
        headers: { authorization: `Bearer ${validKey}` },
      })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not record the key as used when the plan refuses it", async () => {
    // last_used_at is a signal that the key WORKED. Bumping it on a
    // refusal makes a blocked integration look like a live one.
    findActiveKeyByHash.mockResolvedValue(keyRow());
    isApiAllowedForAccount.mockResolvedValue(false);

    await requireApiKey(
      new Request("https://x/api/v1/me", {
        headers: { authorization: `Bearer ${validKey}` },
      }),
    ).catch(() => {});

    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it("is not consulted for an unknown key", async () => {
    // An unknown key must 401 before the plan is looked at, so a prober
    // cannot learn which accounts have API access by timing or status.
    findActiveKeyByHash.mockResolvedValue(null);

    await expect(
      requireApiKey(new Request("https://x/api/v1/me", {
        headers: { authorization: `Bearer ${validKey}` },
      })),
    ).rejects.toMatchObject({ status: 401 });

    expect(isApiAllowedForAccount).not.toHaveBeenCalled();
  });

  it("lets the request through when the plan allows it", async () => {
    findActiveKeyByHash.mockResolvedValue(keyRow());
    isApiAllowedForAccount.mockResolvedValue(true);

    const ctx = await requireApiKey(
      new Request("https://x/api/v1/me", {
        headers: { authorization: `Bearer ${validKey}` },
      }),
    );
    expect(ctx.accountId).toBe("acct-1");
  });
});
