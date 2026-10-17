// Who is chatting: the x-member-id header (default: main contact of the first farm). No auth by
// team decision. The member's farm scopes everything the agent can see or write.

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import { type FarmRegistry, MEMBER_HEADER } from "../irrigation/farmRegistry";
import { CHAT_THREAD_HEADER } from "@tellia/shared/app";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "./requestContext";
import { type MemoryGetter, resolveThreadId, resourceIdFor } from "./threads";

export { MEMBER_HEADER };
export { resourceIdFor, threadIdFor } from "./threads";

/**
 * Mastra `server.middleware` for the chat routes. It sets the reserved memory keys, so any
 * `memory` object sent in the request body is ignored. The thread comes from `x-thread-id`
 * (checked against the member), see `resolveThreadId`.
 */
export function createMemberMiddleware(registry: FarmRegistry, getMemory: MemoryGetter) {
  const handler: MiddlewareHandler = async (c: Context, next) => {
    if (c.req.method === "OPTIONS") return next();
    let caller;
    let threadId;
    try {
      caller = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
      threadId = await resolveThreadId({
        getMemory,
        memberId: caller.memberId,
        today: registry.today(),
        header: c.req.header(CHAT_THREAD_HEADER),
      });
    } catch (e) {
      if (e instanceof HTTPException) {
        return c.json({ error: { code: `http_${e.status}`, message: e.message } }, e.status);
      }
      throw e;
    }
    const rc = c.get("requestContext");
    rc.set(MASTRA_RESOURCE_ID_KEY, resourceIdFor(caller.memberId));
    rc.set(MASTRA_THREAD_ID_KEY, threadId);
    rc.set(MEMBER_ID_KEY, caller.memberId);
    rc.set(FARM_ID_KEY, caller.scope.farmId);
    return next();
  };
  return [
    { path: "/chat", handler },
    { path: "/chat/*", handler },
    { path: "/api/*", handler },
  ];
}
