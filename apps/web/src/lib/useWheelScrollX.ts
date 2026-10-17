import { useCallback, useRef } from "react";

/**
 * A sideways-scrolling row also scrolls with a mouse on a computer: drag it, or use the wheel
 * (up/down → left/right). Touch swipes and trackpads keep their native scroll. A drag doesn't
 * click the chip under the mouse. Returns a callback ref: the row may appear after data loads.
 */
export function useWheelScrollX<T extends HTMLElement>(): (el: T | null) => void {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (wheelScrollsX(el, e)) e.preventDefault();
    };

    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      down = false;
      el.style.cursor = "";
    };
    // After a drag, the click that follows must not pick a chip.
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    detach.current = () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, []);
}

/**
 * Moves the row sideways for a mostly-vertical wheel and says if it did. Leaves sideways wheels
 * (trackpads) alone, and lets the page scroll once the row is at an end.
 */
export function wheelScrollsX(
  el: { scrollWidth: number; clientWidth: number; scrollLeft: number },
  e: { deltaX: number; deltaY: number },
): boolean {
  const room = el.scrollWidth - el.clientWidth;
  if (room <= 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return false;
  if ((el.scrollLeft <= 0 && e.deltaY < 0) || (el.scrollLeft >= room - 1 && e.deltaY > 0)) return false;
  el.scrollLeft += e.deltaY;
  return true;
}
