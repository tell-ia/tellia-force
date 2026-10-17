// Editing a sent message: cut the thread's memory at that message (it and every later one go),
// and cancel the irrigation confirmations that were waiting in the removed messages.

import { HTTPException } from "hono/http-exception";
import type { Mastra } from "@mastra/core";
import type { MastraMemory } from "@mastra/core/memory";
import { RequestContext } from "@mastra/core/request-context";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { TruncateChatThreadResult } from "@tellia/shared/app";
import { CONFIRMABLE } from "./tools";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "./requestContext";
import { resourceIdFor } from "./threads";

/** The edited message and everything after it, oldest first. `null` when the id is unknown. */
export function fromMessage<T extends { id: string }>(ordered: T[], messageId: string): T[] | null {
  const i = ordered.findIndex((m) => m.id === messageId);
  return i === -1 ? null : ordered.slice(i);
}

/** runIds of the confirmation cards (recordIrrigation / correctIrrigation) in UI messages. */
export function confirmationRunIds(
  messages: { parts?: { type: string; output?: unknown }[] }[],
): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type !== "tool-recordIrrigation" && p.type !== "tool-correctIrrigation") continue;
      const runId = (p.output as { runId?: unknown } | undefined)?.runId;
      if (typeof runId === "string" && runId) ids.add(runId);
    }
  }
  return [...ids];
}

/**
 * Answers "No" for each run that is still suspended and belongs to this member and farm: the
 * draft is deleted (record) or nothing changes (correction). Runs already answered are left
 * alone (a saved irrigation stays saved). Never throws: returns how many runs it cancelled.
 */
export async function cancelPendingRuns(
  mastra: Mastra,
  runIds: string[],
  caller: { memberId: number; farmId: number },
): Promise<number> {
  const rc = new RequestContext();
  rc.set(MEMBER_ID_KEY, caller.memberId);
  rc.set(FARM_ID_KEY, caller.farmId);
  let cancelled = 0;
  for (const runId of runIds) {
    try {
      for (const c of CONFIRMABLE) {
        const workflow = mastra.getWorkflow(c.workflowId);
        const state = await workflow.getWorkflowRunById(runId);
        if (!state) continue;
        if (
          state.status === "suspended" && state.payload?.memberId === caller.memberId &&
          state.payload?.farmId === caller.farmId
        ) {
          const run = await workflow.createRun({ runId });
          const result = await run.resume({
            step: c.step,
            resumeData: { confirmed: false },
            requestContext: rc,
          });
          if (result.status === "success") cancelled++;
        }
        break;
      }
    } catch (e) {
      console.warn(`truncate: could not cancel run ${runId}:`, e);
    }
  }
  return cancelled;
}

/**
 * Removes `fromMessageId` and every later message of the thread. The caller must already have
 * been checked against the thread (resolveThreadId). 404 for an unknown thread or message,
 * 400 when the message is not a farmer message.
 */
export async function truncateThread(opts: {
  mastra: Mastra;
  memory: MastraMemory | undefined;
  memberId: number;
  farmId: number;
  threadId: string;
  fromMessageId: string;
}): Promise<TruncateChatThreadResult> {
  const { memory, threadId } = opts;
  const resourceId = resourceIdFor(opts.memberId);
  const thread = memory ? await memory.getThreadById({ threadId }) : null;
  if (!memory || !thread || thread.resourceId !== resourceId) {
    throw new HTTPException(404, { message: "thread not found" });
  }
  // Every message, signals included, so nothing after the cut survives.
  const { messages } = await memory.recall({ threadId, resourceId, perPage: false, hideSignals: false });
  const ordered = [...messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const doomed = fromMessage(ordered, opts.fromMessageId);
  if (!doomed) throw new HTTPException(404, { message: "message not found in this thread" });
  if (doomed[0].role !== "user") {
    throw new HTTPException(400, { message: "only a farmer message can be edited" });
  }
  // Cards first: their runIds come from the messages we are about to delete.
  const runIds = confirmationRunIds(toAISdkMessages(doomed, { version: "v7" }));
  await memory.deleteMessages(doomed.map((m) => m.id));
  const cancelledRuns = await cancelPendingRuns(opts.mastra, runIds, {
    memberId: opts.memberId,
    farmId: opts.farmId,
  });
  return { threadId, removed: doomed.length, cancelledRuns };
}
