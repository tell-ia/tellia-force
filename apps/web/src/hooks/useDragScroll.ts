import { useEffect, useRef, useState } from "react";
import type { ScrollMetrics } from "../lib/scrollThumb";

/**
 * Sideways scrolling for a row that overflows. Touch already scrolls natively; this adds the
 * mouse (vertical wheel → sideways, click-and-drag), says which edges hide more content and
 * reports the scroll metrics for a drawn scrollbar (components/ui/ScrollTrack).
 * A drag swallows the click that ends it, so dragging across a button doesn't press it.
 *
 * const { ref, edges, metrics } = useDragScroll<HTMLDivElement>();  // <div ref={ref} style={{ overflowX: "auto" }}>
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ left: 0, client: 0, scroll: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = { left: el.scrollLeft, client: el.clientWidth, scroll: el.scrollWidth };
      setMetrics((m) => (m.left === next.left && m.client === next.client && m.scroll === next.scroll ? m : next));
    };

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault(); // keep the page from scrolling too
      el.scrollLeft += e.deltaY;
    };

    let drag: { x: number; left: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0) drag = { x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) el.scrollLeft = drag.left - dx;
    };
    const onUp = () => {
      if (drag?.moved) {
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, true)); // released off the row: no click
      }
      drag = null;
    };

    const resize = new ResizeObserver(update);
    resize.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    update();
    return () => {
      resize.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
    };
  }, []);

  const edges = { start: metrics.left > 1, end: metrics.left + metrics.client < metrics.scroll - 1 };
  return { ref, edges, metrics };
}
