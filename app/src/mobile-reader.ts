/** Keep secondary controls reachable without filling the phone's reading area. */
export function initMobileReader(): void {
  const phone = window.matchMedia("(max-width: 720px)");
  const placements = [
    { control: document.querySelector<HTMLElement>(".slider-wrap")!, slot: document.getElementById("mobilePagePosition")!, fallback: document.getElementById("railSettings")! }
  ].map(item => {
    const anchor = document.createComment("desktop control position");
    item.control.before(anchor);
    return { ...item, anchor };
  });
  function sync(): void {
    for (const { control, slot, anchor, fallback } of placements) {
      const focused = control.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      if (phone.matches) {
        if (control.parentElement !== slot) slot.append(control);
      } else if (anchor.nextSibling !== control) anchor.after(control);
      if (focused) {
        const visible = focused.getClientRects().length && getComputedStyle(focused).visibility === "visible";
        (visible ? focused : fallback).focus({ preventScroll: true });
      }
    }
  }
  phone.addEventListener("change", sync);
  sync();
}
