/** Native button activation plus a downward pull; each gesture changes state once. */
export function bindPullCord(
  button: HTMLButtonElement,
  host: EventTarget,
  toggle: (gesture: 'pull' | 'press') => void,
  draw: (distance: number) => void
): void {
  let pointer: number | null = null;
  let startX = 0, startY = 0, dx = 0, dy = 0;
  let suppressClickUntil = 0;
  const reset = () => {
    const id = pointer;
    pointer = null;
    draw(0);
    if (id !== null && button.hasPointerCapture(id)) button.releasePointerCapture(id);
  };
  const cancel = () => {
    if (pointer === null) return;
    suppressClickUntil = Date.now() + 500;
    reset();
  };
  button.addEventListener('pointerdown', event => {
    if (pointer !== null || !event.isPrimary || event.button !== 0) return;
    suppressClickUntil = 0;
    pointer = event.pointerId;
    startX = event.clientX; startY = event.clientY; dx = 0; dy = 0;
    button.setPointerCapture(pointer);
  });
  button.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    dx = event.clientX - startX; dy = event.clientY - startY;
    draw(Math.min(30, Math.max(0, dy * .7)));
  });
  button.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    dx = event.clientX - startX; dy = event.clientY - startY;
    const moved = Math.abs(dx) > 4 || Math.abs(dy) > 4;
    if (moved) {
      suppressClickUntil = Date.now() + 500;
      event.preventDefault();
      if (dy >= 18 && Math.abs(dx) <= 36) toggle('pull');
    }
    reset();
  });
  button.addEventListener('click', event => {
    // Pointer-generated click follows pointerup. Keyboard activation has detail=0.
    if (event.detail !== 0 && Date.now() < suppressClickUntil) return;
    toggle('press');
  });
  button.addEventListener('pointercancel', event => { if (event.pointerId === pointer) cancel(); });
  button.addEventListener('lostpointercapture', event => { if (event.pointerId === pointer) cancel(); });
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
    // Keep the reader’s global Space shortcut from starting audio on this button.
    if (event.key === ' ' || event.code === 'Space' || event.key === 'Enter') event.stopPropagation();
  });
  host.addEventListener('blur', cancel);
}
