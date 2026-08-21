import { describe, it, expect } from "vitest";
import {
  matchesContactFilters,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

/**
 * The business filter exists because a linked WhatsApp number is a
 * PERSONAL number: family and group chats land in the inbox beside real
 * customers, and only a human can say which is which.
 */
describe("matchesContactFilters — business", () => {
  const none = { tagIds: [], company: null };

  it("is a no-op when not asked for", () => {
    const personal = makeConversation({ is_business: false });
    expect(matchesContactFilters(personal, none)).toBe(true);
    expect(matchesContactFilters(personal, { ...none, businessOnly: false })).toBe(
      true,
    );
  });

  it("keeps marked contacts and drops unmarked ones", () => {
    expect(
      matchesContactFilters(makeConversation({ is_business: true }), {
        ...none,
        businessOnly: true,
      }),
    ).toBe(true);
    expect(
      matchesContactFilters(makeConversation({ is_business: false }), {
        ...none,
        businessOnly: true,
      }),
    ).toBe(false);
  });

  /**
   * Rows predating the column read as null/undefined. They are unmarked,
   * not business — treating "nobody has said" as a yes would leave the
   * filter showing the whole inbox on day one and look like it is broken.
   */
  it("treats an unset flag as not business", () => {
    for (const value of [null, undefined]) {
      expect(
        matchesContactFilters(makeConversation({ is_business: value }), {
          ...none,
          businessOnly: true,
        }),
      ).toBe(false);
    }
  });

  it("drops a conversation with no contact row", () => {
    expect(
      matchesContactFilters(makeConversation(null), {
        ...none,
        businessOnly: true,
      }),
    ).toBe(false);
  });

  it("combines with the other filters rather than replacing them", () => {
    const conv = makeConversation({ is_business: true, company: "Acme" });
    expect(
      matchesContactFilters(conv, {
        tagIds: [],
        company: "Other",
        businessOnly: true,
      }),
    ).toBe(false);
  });
});
