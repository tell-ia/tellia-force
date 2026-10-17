// Which conversation a chat request works on: the x-thread-id header, checked against the caller.
// Threads are created lazily by Mastra memory with the first message, never by this module.

import { HTTPException } from "hono/http-exception";
import type { MastraMemory } from "@mastra/core/memory";
import { type ChatThreadSummary, isThreadIdOfMember } from "@tellia/shared/app";

export const resourceIdFor = (memberId: number) => `member-${memberId}`;
/** The old one-thread-per-day id: the fallback when the member has no thread yet. */
export const threadIdFor = (memberId: number, date: string) => `member-${memberId}-${date}`;

export type MemoryGetter = () => Promise<MastraMemory | undefined>;

const forbidden = () => new HTTPException(403, { message: "thread does not belong to this member" });

/** The member's threads, most recently updated first. */
export async function listMemberThreads(
  memory: MastraMemory | undefined,
  memberId: number,
): Promise<ChatThreadSummary[]> {
  if (!memory) return [];
  const { threads } = await memory.listThreads({
    filter: { resourceId: resourceIdFor(memberId) },
    orderBy: { field: "updatedAt", direction: "DESC" },
    perPage: false,
  });
  return threads.map((t) => ({
    id: t.id,
    title: t.title?.trim() ? t.title : null,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt).toISOString(),
  }));
}

/**
 * The thread id for this request. With a header: it must carry the member's prefix and, if the
 * thread exists, belong to the member's resource (403 otherwise, both cases). Without: the
 * member's most recently updated thread, or today's day thread id when they have none.
 */
export async function resolveThreadId(opts: {
  getMemory: MemoryGetter;
  memberId: number;
  today: string;
  header: string | undefined;
}): Promise<string> {
  const { memberId, header } = opts;
  const memory = await opts.getMemory();
  if (header !== undefined && header !== "") {
    if (!isThreadIdOfMember(header, memberId)) throw forbidden();
    const existing = memory ? await memory.getThreadById({ threadId: header }) : null;
    if (existing && existing.resourceId !== resourceIdFor(memberId)) throw forbidden();
    return header;
  }
  const [latest] = await listMemberThreads(memory, memberId);
  return latest?.id ?? threadIdFor(memberId, opts.today);
}
