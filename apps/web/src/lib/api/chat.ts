import { DefaultChatTransport, type UIMessage } from "ai";
import { API_URL, memberHeaders } from "./core";

// Chat is LIVE from day one (no mock): it talks to Imad's advisor backend.
//   POST /chat        — AI SDK v7 UI message stream (Mastra). useChat transport.
//   GET  /chat/history — today's conversation for the x-member-id member.
// See docs/chat-contract.md.

export interface ChatHistory {
  threadId: string;
  messages: UIMessage[];
}

export async function getChatHistory(): Promise<ChatHistory> {
  const res = await fetch(`${API_URL}/chat/history`, { headers: memberHeaders() });
  if (!res.ok) throw new Error(`chat history: HTTP ${res.status}`);
  const json = (await res.json()) as { data: ChatHistory };
  return json.data;
}

/** Transport for useChat. Reads x-member-id dynamically so a persona switch
 *  (new member) is picked up without rebuilding the component. */
export function createChatTransport(): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport({
    api: `${API_URL}/chat`,
    headers: () => memberHeaders(),
  });
}
