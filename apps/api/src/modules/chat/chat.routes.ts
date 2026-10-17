// GET /chat/history (one conversation) and GET /chat/threads (the member's list), as AI SDK v7
// UI messages and shared thread summaries. The thread is picked with the x-thread-id header.

import { Hono } from "hono";
import type { Mastra } from "@mastra/core";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { CHAT_THREAD_HEADER } from "@tellia/shared/app";
import type { FarmRegistry } from "../irrigation/farmRegistry";
import { ADVISOR_ID } from "./advisor.agent";
import { MEMBER_HEADER } from "./member.middleware";
import { listMemberThreads, resolveThreadId, resourceIdFor } from "./threads";

export function createChatRoutes(deps: { mastra: Mastra; registry: FarmRegistry }) {
  const { mastra, registry } = deps;
  const routes = new Hono();
  const getMemory = async () => await mastra.getAgentById(ADVISOR_ID).getMemory();

  routes.get("/history", async (c) => {
    // Registered before Mastra's middleware, so the member is resolved here.
    const { memberId } = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    const resourceId = resourceIdFor(memberId);
    const threadId = await resolveThreadId({
      getMemory,
      memberId,
      today: registry.today(),
      header: c.req.header(CHAT_THREAD_HEADER),
    });
    const memory = await getMemory();
    const thread = memory ? await memory.getThreadById({ threadId }) : null;
    if (!memory || !thread || thread.resourceId !== resourceId) {
      return c.json({ data: { threadId, messages: [] } });
    }
    const { messages } = await memory.recall({ threadId, resourceId });
    return c.json({ data: { threadId, messages: toAISdkMessages(messages, { version: "v7" }) } });
  });

  routes.get("/threads", async (c) => {
    const { memberId } = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    return c.json({ data: await listMemberThreads(await getMemory(), memberId) });
  });

  return routes;
}
