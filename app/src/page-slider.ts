/** Track a native range gesture without taking over its pointer capture or scrolling. */
export function trackPageSliderDrag(
  slider: EventTarget,
  eventRoot: EventTarget,
  onDragging: (dragging: boolean) => void
): () => void {
  let pointerId: number | null = null;
  const finish = () => {
    if (pointerId === null) return;
    pointerId = null;
    onDragging(false);
  };
  const start = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointerId !== null || !pointer.isPrimary || pointer.button !== 0) return;
    pointerId = pointer.pointerId;
    onDragging(true);
  };
  const endPointer = (event: Event) => {
    if ((event as PointerEvent).pointerId === pointerId) finish();
  };
  slider.addEventListener("pointerdown", start);
  slider.addEventListener("change", finish);
  slider.addEventListener("lostpointercapture", endPointer);
  // Listen at the window, including releases outside the slider and cancelled touches.
  eventRoot.addEventListener("pointerup", endPointer, true);
  eventRoot.addEventListener("pointercancel", endPointer, true);
  eventRoot.addEventListener("blur", finish);
  return () => {
    slider.removeEventListener("pointerdown", start);
    slider.removeEventListener("change", finish);
    slider.removeEventListener("lostpointercapture", endPointer);
    eventRoot.removeEventListener("pointerup", endPointer, true);
    eventRoot.removeEventListener("pointercancel", endPointer, true);
    eventRoot.removeEventListener("blur", finish);
    finish();
  };
}
