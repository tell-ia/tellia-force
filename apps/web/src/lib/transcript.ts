// Live transcript assembly for the chat's voice input (OpenAI Realtime transcription events).
// Pure: the hook feeds it every server event and shows `transcriptText` in the message box.
//
//   conversation.item.input_audio_transcription.delta     { item_id, delta }      words so far
//   conversation.item.input_audio_transcription.completed { item_id, transcript } final text
//
// Completions of different items can arrive out of order: items keep the order of their first event.

export interface Transcript {
  /** item ids, in the order they were first heard */
  order: string[];
  text: Record<string, string>;
  /** item ids whose final transcript arrived */
  done: Record<string, true>;
}

export const emptyTranscript: Transcript = { order: [], text: {}, done: {} };

const DELTA = "conversation.item.input_audio_transcription.delta";
const COMPLETED = "conversation.item.input_audio_transcription.completed";

export function applyTranscriptEvent(t: Transcript, event: unknown): Transcript {
  if (!event || typeof event !== "object") return t;
  const e = event as { type?: unknown; item_id?: unknown; delta?: unknown; transcript?: unknown };
  if (typeof e.item_id !== "string") return t;
  const id = e.item_id;
  const order = t.order.includes(id) ? t.order : [...t.order, id];
  if (e.type === DELTA && typeof e.delta === "string") {
    if (t.done[id]) return t; // a late delta never overwrites the final text
    return { ...t, order, text: { ...t.text, [id]: (t.text[id] ?? "") + e.delta } };
  }
  if (e.type === COMPLETED && typeof e.transcript === "string") {
    return { order, text: { ...t.text, [id]: e.transcript }, done: { ...t.done, [id]: true } };
  }
  return t;
}

/** What the farmer said, one line. */
export function transcriptText(t: Transcript): string {
  return t.order.map((id) => t.text[id] ?? "").join(" ").replace(/\s+/g, " ").trim();
}

export const isTranscriptCompletion = (event: unknown): boolean =>
  (event as { type?: unknown } | null)?.type === COMPLETED;
