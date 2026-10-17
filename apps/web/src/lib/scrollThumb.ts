// Geometry of a drawn horizontal scrollbar (the chat's suggestion row). Mobile WebViews only
// flash their native scrollbar while scrolling, so the row draws its own. Fractions of the track.

export interface ScrollMetrics {
  left: number; // scrollLeft
  client: number; // clientWidth: what is visible
  scroll: number; // scrollWidth: the whole row
}

/** The thumb's width and start, as fractions of the track. Null when nothing overflows. */
export function scrollThumb(m: ScrollMetrics, minSize = 0.15): { size: number; start: number } | null {
  if (m.scroll <= m.client + 1 || m.client <= 0) return null;
  const size = Math.max(minSize, m.client / m.scroll);
  const progress = clamp01(m.left / (m.scroll - m.client));
  return { size, start: progress * (1 - size) };
}

/** scrollLeft that puts the thumb's start at `start` (fraction of the track). */
export function scrollLeftForThumb(m: ScrollMetrics, start: number, size: number): number {
  if (size >= 1) return 0;
  return clamp01(start / (1 - size)) * (m.scroll - m.client);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
