import { useRef, type RefObject } from "react";
import { v } from "../../theme/tokens";
import { scrollLeftForThumb, scrollThumb, type ScrollMetrics } from "../../lib/scrollThumb";

/**
 * A drawn horizontal scrollbar for a row that overflows (mobile WebViews hide theirs).
 * Drag the thumb, or tap the track to jump there; touch and mouse alike.
 * Pair with useDragScroll: <ScrollTrack target={ref} metrics={metrics} label="…" />
 */
export function ScrollTrack({ target, metrics, label }: { target: RefObject<HTMLElement | null>; metrics: ScrollMetrics; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null); // where the thumb was grabbed, as a fraction of it
  const thumb = scrollThumb(metrics);
  if (!thumb) return null;

  const moveTo = (clientX: number) => {
    const el = target.current;
    const track = trackRef.current?.getBoundingClientRect();
    if (!el || !track || grab.current === null) return;
    const start = (clientX - track.left) / track.width - grab.current * thumb.size;
    el.scrollLeft = scrollLeftForThumb(metrics, start, thumb.size);
  };
  const step = (dir: 1 | -1) => target.current?.scrollBy({ left: dir * metrics.client * 0.8, behavior: "smooth" });

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((thumb.start / Math.max(1e-6, 1 - thumb.size)) * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      onPointerDown={(e) => {
        const track = e.currentTarget.getBoundingClientRect();
        const at = (e.clientX - track.left) / track.width;
        const onThumb = at >= thumb.start && at <= thumb.start + thumb.size;
        // On the thumb: keep the grab point. On the track: center the thumb under the finger.
        grab.current = onThumb ? (at - thumb.start) / thumb.size : 0.5;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => moveTo(e.clientX)}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
      style={{ position: "relative", height: 20, margin: "0 12px", cursor: "pointer", touchAction: "none" }}
    >
      <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 8, height: 4, borderRadius: 2, background: v("sunk") }} />
      <div
        aria-hidden
        style={{ position: "absolute", top: 7, height: 6, borderRadius: 3, background: v("ink2"), opacity: 0.55, left: `${thumb.start * 100}%`, width: `${thumb.size * 100}%` }}
      />
    </div>
  );
}
