import { describe, expect, it } from "vitest";
import { ChatThreadListSchema, isThreadIdOfMember, memberThreadPrefix, newThreadId } from "./app";

describe("chat thread ids", () => {
  it("builds a member-prefixed id", () => {
    expect(memberThreadPrefix(7)).toBe("member-7-");
    expect(newThreadId(7, "abc-123")).toBe("member-7-abc-123");
  });

  it("accepts only the member's own ids (uuids and old day ids)", () => {
    expect(isThreadIdOfMember(newThreadId(1, crypto.randomUUID()), 1)).toBe(true);
    expect(isThreadIdOfMember("member-1-2026-07-05", 1)).toBe(true);
    expect(isThreadIdOfMember("member-1-abc", 11)).toBe(false);
    expect(isThreadIdOfMember("member-11-abc", 1)).toBe(false);
    expect(isThreadIdOfMember("member-1-", 1)).toBe(false);
    expect(isThreadIdOfMember("member-1-a/b", 1)).toBe(false);
    expect(isThreadIdOfMember("other", 1)).toBe(false);
  });

  it("parses a thread list with a missing title", () => {
    const now = new Date().toISOString();
    expect(ChatThreadListSchema.parse([{ id: "member-1-x", title: null, createdAt: now, updatedAt: now }])).toHaveLength(1);
    expect(() => ChatThreadListSchema.parse([{ id: "", title: null, createdAt: now, updatedAt: now }])).toThrow();
  });
});
