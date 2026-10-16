// Who is chatting: the x-member-id header (default: main contact of the first farm). No auth by
// team decision. The member's farm scopes everything the agent can see or write.

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import { type FarmRegistry, MEMBER_HEADER } from "../irrigation/farmRegistry";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "./requestContext";

export { MEMBER_HEADER };

export const resourceIdFor = (memberId: number) => `member-${memberId}`;
export const threadIdFor = (memberId: number, date: string) => `member-${memberId}-${date}`;

/**
 * Mastra `server.middleware` for the chat routes. It sets the reserved memory keys, so any
 * `memory` object sent in the request body is ignored.
 */
export function createMemberMiddleware(registry: FarmRegistry) {
  const handler: MiddlewareHandler = async (c: Context, next) => {
    if (c.req.method === "OPTIONS") return next();
    let caller;
    try {
      caller = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    } catch (e) {
      if (e instanceof HTTPException) {
        return c.json({ error: { code: `http_${e.status}`, message: e.message } }, e.status);
      }
      throw e;
    }
    const rc = c.get("requestContext");
    rc.set(MASTRA_RESOURCE_ID_KEY, resourceIdFor(caller.memberId));
    rc.set(MASTRA_THREAD_ID_KEY, threadIdFor(caller.memberId, registry.today()));
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
