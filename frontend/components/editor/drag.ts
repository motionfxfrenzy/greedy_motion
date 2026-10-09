/**
 * Pointer drag with the editor's rules: starts after 3 px of movement, Esc cancels and restores the
 * start state, and a plain click (no movement) reports `onClick`. Window-level listeners, so the drag
 * survives leaving the element, and everything is torn down on end or cancel.
 */
export type DragHandlers = {
  onStart?: () => void;
  onMove: (dx: number, dy: number, event: PointerEvent) => void;
  onEnd?: (event: PointerEvent) => void;
  onCancel?: () => void;
  onClick?: (event: PointerEvent) => void;
};

export const DRAG_THRESHOLD = 3;

export function startDrag(down: { clientX: number; clientY: number }, handlers: DragHandlers, threshold = DRAG_THRESHOLD): void {
  const x0 = down.clientX;
  const y0 = down.clientY;
  let started = false;

  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    document.body.classList.remove("ed-dragging");
  };
  const move = (event: PointerEvent) => {
    // The button was released somewhere we never heard about (over the preview iframe, outside the window): finish rather than keep dragging.
    if (event.pointerType === "mouse" && event.buttons === 0) { up(event); return; }
    const dx = event.clientX - x0;
    const dy = event.clientY - y0;
    if (!started) {
      if (Math.hypot(dx, dy) < threshold) return;
      started = true;
      document.body.classList.add("ed-dragging");
      handlers.onStart?.();
    }
    handlers.onMove(dx, dy, event);
  };
  const up = (event: PointerEvent) => {
    finish();
    if (started) handlers.onEnd?.(event);
    else handlers.onClick?.(event);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    finish();
    if (started) handlers.onCancel?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}
