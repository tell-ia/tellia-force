import { DefaultChatTransport, type UIMessage } from "ai";
import {
  CHAT_THREAD_HEADER,
  ChatThreadListSchema,
  TruncateChatThreadResultSchema,
  type TruncateChatThreadResult,
  newThreadId,
  type ChatThreadSummary,
} from "@tellia/shared";
import { API_URL, getMemberId, http, memberHeaders } from "./core";

// Chat is LIVE from day one (no mock): it talks to Imad's advisor backend.
//   POST /chat          — AI SDK v7 UI message stream (Mastra). useChat transport.
//   GET  /chat/history  — one conversation for the x-member-id member.
//   GET  /chat/threads  — the member's past conversations, newest first.
//   POST /chat/threads/:id/truncate — edit a message: drop it and every later one from memory.
// The conversation is picked with the x-thread-id header (none = the member's latest).
// See docs/chat-contract.md.

export interface ChatHistory {
  threadId: string;
  messages: UIMessage[];
}

const threadHeaders = (threadId: string | null): Record<string, string> =>
  threadId ? { [CHAT_THREAD_HEADER]: threadId } : {};

export async function getChatHistory(threadId: string | null = null): Promise<ChatHistory> {
  const res = await fetch(`${API_URL}/chat/history`, { headers: { ...memberHeaders(), ...threadHeaders(threadId) } });
  if (!res.ok) throw new Error(`chat history: HTTP ${res.status}`);
  const json = (await res.json()) as { data: ChatHistory };
  return json.data;
}

/** The member's conversations, most recently updated first. */
export function listChatThreads(): Promise<ChatThreadSummary[]> {
  return http.get("/chat/threads", ChatThreadListSchema);
}

/** Edit a sent message: the server removes it and everything after it from the thread's memory
 *  (and cancels confirmation cards waiting in them). Resend the new text afterwards. */
export function truncateChatThread(threadId: string, fromMessageId: string): Promise<TruncateChatThreadResult> {
  return http.post(`/chat/threads/${encodeURIComponent(threadId)}/truncate`, { fromMessageId }, TruncateChatThreadResultSchema);
}

/** A fresh thread id for the current member. The thread exists once its first message is sent.
 *  (Without a member the API falls back to member 1, so the prefix does too.) */
export function createThreadId(): string {
  return newThreadId(getMemberId() ?? 1, crypto.randomUUID());
}

/** Transport for useChat. Reads x-member-id dynamically so a persona switch
 *  (new member) is picked up without rebuilding the component; `getThreadId` is read on every
 *  request too (the thread the screen shows right now). */
export function createChatTransport(getThreadId: () => string | null = () => null): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport({
    api: `${API_URL}/chat`,
    headers: () => ({ ...memberHeaders(), ...threadHeaders(getThreadId()) }),
  });
}
