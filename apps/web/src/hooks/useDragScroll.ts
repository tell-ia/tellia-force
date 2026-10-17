import { useEffect, useRef, useState } from "react";

/**
 * Sideways scrolling for a row that overflows. Touch already scrolls natively; this adds the
 * mouse (vertical wheel → sideways, click-and-drag) and says which edges hide more content.
 * A drag swallows the click that ends it, so dragging across a button doesn't press it.
 *
 * const { ref, edges } = useDragScroll<HTMLDivElement>();  // <div ref={ref} style={{ overflowX: "auto" }}>
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
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

  return { ref, edges };
}
