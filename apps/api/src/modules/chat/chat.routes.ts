// GET /chat/history: today's conversation of the calling member, as AI SDK v7 UI messages.

import { Hono } from "hono";
import type { Mastra } from "@mastra/core";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { FarmRegistry } from "../irrigation/farmRegistry";
import { ADVISOR_ID } from "./advisor.agent";
import { MEMBER_HEADER, resourceIdFor, threadIdFor } from "./member.middleware";

export function createChatRoutes(deps: { mastra: Mastra; registry: FarmRegistry }) {
  const { mastra, registry } = deps;
  const routes = new Hono();

  routes.get("/history", async (c) => {
    // Registered before Mastra's middleware, so the member is resolved here.
    const { memberId } = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    const resourceId = resourceIdFor(memberId);
    const threadId = threadIdFor(memberId, registry.today());
    const memory = await mastra.getAgentById(ADVISOR_ID).getMemory();
    const thread = memory ? await memory.getThreadById({ threadId }) : null;
    if (!memory || !thread || thread.resourceId !== resourceId) {
      return c.json({ data: { threadId, messages: [] } });
    }
    const { messages } = await memory.recall({ threadId, resourceId });
    return c.json({ data: { threadId, messages: toAISdkMessages(messages, { version: "v7" }) } });
  });

  return routes;
}
