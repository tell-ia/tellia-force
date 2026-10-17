// Pure helpers for editing a sent chat message and copying an answer. No React, no fetch.

import type { UIMessage } from "ai";

/** The plain text of a message: its text parts joined by a blank line, trimmed. Markdown markers
 *  of the advisor's answers are kept as they are (they paste fine into notes and chats). */
export function messageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text.trim()] : []))
    .join("\n\n");
}

/** A farmer message can be edited when it is typed text (not files) and no reply is running. */
export function canEditMessage(message: UIMessage, busy: boolean): boolean {
  return !busy && message.role === "user" && message.parts.every((p) => p.type === "text") &&
    messageText(message) !== "";
}

/** How many messages come after `messageId`: what an edit of that message replaces. */
export function messagesAfter(messages: Pick<UIMessage, "id">[], messageId: string): number {
  const i = messages.findIndex((m) => m.id === messageId);
  return i === -1 ? 0 : messages.length - i - 1;
}

/** Hint under the editor. `null` when nothing comes after the message. */
export function editHint(after: number): string | null {
  if (after <= 0) return null;
  return after === 1
    ? "The reply after this message will be replaced."
    : "The replies after this message will be replaced.";
}

/** The trimmed text to send, or `null` when there is nothing to send or nothing changed. */
export function editedText(draft: string, original: string): string | null {
  const t = draft.trim();
  return t && t !== original.trim() ? t : null;
}

/** An assistant message gets a copy button once it has text and is not still streaming. */
export function canCopyMessage(message: UIMessage, streaming: boolean): boolean {
  return message.role === "assistant" && !streaming && messageText(message) !== "";
}
