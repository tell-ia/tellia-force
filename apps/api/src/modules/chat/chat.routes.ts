// GET /chat/history: today's conversation of the calling member, as AI SDK v7 UI messages.

import { Hono } from "hono";
import type { Mastra } from "@mastra/core";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { FarmData } from "../irrigation/data/farmData";
import type { IrrigationService } from "../irrigation/irrigation.service";
import { ADVISOR_ID } from "./advisor.agent";
import { MEMBER_HEADER, resolveMemberId, resourceIdFor, threadIdFor } from "./member.middleware";

export function createChatRoutes(
  deps: { mastra: Mastra; service: IrrigationService; data: FarmData },
) {
  const { mastra, service, data } = deps;
  const routes = new Hono();

  routes.get("/history", async (c) => {
    // Registered before Mastra's middleware, so the member is resolved here.
    const memberId = await resolveMemberId(c.req.header(MEMBER_HEADER), service, data);
    const resourceId = resourceIdFor(memberId);
    const threadId = threadIdFor(memberId, service.today());
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
