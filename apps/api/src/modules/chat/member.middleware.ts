// Who is chatting: the x-member-id header (default: the main contact). No auth by team decision.

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import type { FarmData } from "../irrigation/data/farmData";
import type { IrrigationService } from "../irrigation/irrigation.service";
import { MEMBER_ID_KEY } from "./requestContext";

export const MEMBER_HEADER = "x-member-id";

export const resourceIdFor = (memberId: number) => `member-${memberId}`;
export const threadIdFor = (memberId: number, date: string) => `member-${memberId}-${date}`;

/** Resolves the calling member from the header; throws HTTPException 400 when unknown. */
export async function resolveMemberId(
  header: string | undefined | null,
  service: IrrigationService,
  data: FarmData,
): Promise<number> {
  let id: number | null;
  if (header === undefined || header === null || header.trim() === "") {
    id = await service.defaultMemberId();
  } else {
    id = /^\d+$/.test(header.trim()) ? Number(header.trim()) : NaN;
  }
  if (id === null || !Number.isInteger(id) || !(await data.getMember(id))) {
    throw new HTTPException(400, { message: "Unknown member" });
  }
  return id;
}

/**
 * Mastra `server.middleware` for the chat routes. It sets the reserved memory keys, so any
 * `memory` object sent in the request body is ignored.
 */
export function createMemberMiddleware(service: IrrigationService, data: FarmData) {
  const handler: MiddlewareHandler = async (c: Context, next) => {
    if (c.req.method === "OPTIONS") return next();
    let memberId: number;
    try {
      memberId = await resolveMemberId(c.req.header(MEMBER_HEADER), service, data);
    } catch (e) {
      if (e instanceof HTTPException) {
        return c.json({ error: { code: `http_${e.status}`, message: e.message } }, e.status);
      }
      throw e;
    }
    const rc = c.get("requestContext");
    rc.set(MASTRA_RESOURCE_ID_KEY, resourceIdFor(memberId));
    rc.set(MASTRA_THREAD_ID_KEY, threadIdFor(memberId, service.today()));
    rc.set(MEMBER_ID_KEY, memberId);
    return next();
  };
  return [
    { path: "/chat", handler },
    { path: "/chat/*", handler },
    { path: "/api/*", handler },
  ];
}
