// Pure helpers for the chat sessions drawer: row label and relative date. No React, no fetch.

import { addDays, formatDay, localToday } from "./dates";

export const FALLBACK_THREAD_TITLE = "Conversation";

/** Titles that say nothing: Mastra's own default ("New Thread ...") and the like. */
const GENERIC_TITLE = /^(new (thread|chat|conversation)( .*)?|untitled( chat)?|chat|conversation|thread)$/i;

/** The row label: the generated title, or a readable fallback when it is missing or generic. */
export function threadLabel(title: string | null | undefined): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  return t && !GENERIC_TITLE.test(t) ? t : FALLBACK_THREAD_TITLE;
}

/**
 * "Today 14:05", "Yesterday", "Tue 21 Jul" (and "Tue 21 Jul 2025" in another year), in the
 * device's time zone. `now` is injectable for tests. An unreadable timestamp gives "".
 */
export function threadDateLabel(updatedAt: string, now: Date = new Date()): string {
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return "";
  const day = localToday(when);
  const today = localToday(now);
  if (day === today) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `Today ${p(when.getHours())}:${p(when.getMinutes())}`;
  }
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day, { year: day.slice(0, 4) !== today.slice(0, 4) });
}
