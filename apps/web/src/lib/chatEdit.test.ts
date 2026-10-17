import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { canEditMessage, editedText, editHint, messagesAfter, messageText } from "./chatEdit";

const msg = (id: string, role: "user" | "assistant", ...parts: object[]): UIMessage =>
  ({ id, role, parts }) as UIMessage;
const text = (t: string) => ({ type: "text", text: t });
const tool = { type: "tool-getFarmAdvice", state: "output-available", output: {} };

describe("messageText", () => {
  it("joins the text parts with a blank line and skips tools and empty parts", () => {
    const m = msg("a", "assistant", text("First **bold**"), tool, text("  "), text("Second\n- item"));
    expect(messageText(m)).toBe("First **bold**\n\nSecond\n- item");
  });
  it("is empty when there is no text", () => {
    expect(messageText(msg("a", "assistant", tool))).toBe("");
  });
});

describe("canEditMessage", () => {
  const farmer = msg("u", "user", text("Will it rain?"));
  it("farmer text messages, when no reply is running", () => {
    expect(canEditMessage(farmer, false)).toBe(true);
    expect(canEditMessage(farmer, true)).toBe(false);
  });
  it("never the advisor's messages, files or empty messages", () => {
    expect(canEditMessage(msg("a", "assistant", text("Yes")), false)).toBe(false);
    expect(canEditMessage(msg("u", "user", text("x"), { type: "file", url: "u", mediaType: "image/png" }), false)).toBe(false);
    expect(canEditMessage(msg("u", "user", text("  ")), false)).toBe(false);
  });
});

describe("messagesAfter and editHint", () => {
  const all = [msg("1", "user"), msg("2", "assistant"), msg("3", "user"), msg("4", "assistant")];
  it("counts what the edit replaces", () => {
    expect(messagesAfter(all, "1")).toBe(3);
    expect(messagesAfter(all, "3")).toBe(1);
    expect(messagesAfter(all, "4")).toBe(0);
    expect(messagesAfter(all, "zzz")).toBe(0);
  });
  it("hints only when something follows", () => {
    expect(editHint(0)).toBeNull();
    expect(editHint(1)).toBe("The reply after this message will be replaced.");
    expect(editHint(3)).toBe("The replies after this message will be replaced.");
  });
});

describe("editedText", () => {
  it("trims, and refuses empty or unchanged text", () => {
    expect(editedText("  Which field?  ", "Will it rain?")).toBe("Which field?");
    expect(editedText("   ", "Will it rain?")).toBeNull();
    expect(editedText(" Will it rain? ", "Will it rain?")).toBeNull();
  });
});
