// Pure check on a finished chat answer: did the chat write a watering? No React, no fetch.

import type { UIMessage } from "ai";

/** The chat only writes a watering in `confirmIrrigation`, after the farmer said Yes. */
const WRITES = new Set(["saved", "updated", "deleted"]);

/** True when the answer saved, corrected or deleted a watering (a cancelled one changes nothing). */
export function changesWater(message: Pick<UIMessage, "parts">): boolean {
  return message.parts.some((p) => {
    if (p.type !== "tool-confirmIrrigation" || !("state" in p) || p.state !== "output-available") return false;
    const status = (p.output as { status?: unknown } | null)?.status;
    return typeof status === "string" && WRITES.has(status);
  });
}
