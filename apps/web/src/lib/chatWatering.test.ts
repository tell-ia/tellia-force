import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { changesWater } from "./chatWatering";

const msg = (...parts: unknown[]) => ({ id: "a", role: "assistant", parts }) as unknown as UIMessage;
const confirm = (status: string, state = "output-available") =>
  ({ type: "tool-confirmIrrigation", toolCallId: "c", state, input: {}, output: { status } });

describe("a chat answer that changes the water", () => {
  it("a watering saved, corrected or deleted by the chat", () => {
    for (const s of ["saved", "updated", "deleted"]) expect(changesWater(msg({ type: "text", text: "Done." }, confirm(s)))).toBe(true);
  });
  it("not a cancelled one, a proposal still waiting for Yes, or a plain answer", () => {
    expect(changesWater(msg(confirm("cancelled")))).toBe(false);
    expect(changesWater(msg(confirm("saved", "input-available")))).toBe(false);
    expect(changesWater(msg({ type: "tool-recordIrrigation", toolCallId: "r", state: "output-available", input: {}, output: { mm: 40 } }))).toBe(false);
    expect(changesWater(msg({ type: "text", text: "Water 40 mm today." }))).toBe(false);
  });
});
