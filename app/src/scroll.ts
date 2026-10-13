// The "current" page is the one under the vertical CENTER of the viewport — what the
// reader is actually looking at — not whichever page edge is nearest the top. Anchoring
// on the top made zoom jump forward a page when reading across a page boundary.
export function visiblePage(viewer: HTMLElement, fallback: number, focus?: { page: number; band: HTMLElement } | null): number {
  const viewerRect = viewer.getBoundingClientRect();
  // A visible Focus line is a more precise reading position than the viewport centre.
  // Once it scrolls out of view (or is suspended), ordinary page tracking takes over.
  if (focus?.band.classList.contains("show")) {
    const band = focus.band.getBoundingClientRect();
    if (band.bottom > viewerRect.top && band.top < viewerRect.bottom) return focus.page;
  }
  const centerY = viewerRect.top + viewerRect.height / 2;
  const pages = [...viewer.querySelectorAll<HTMLElement>(".page")];
  let best = fallback;
  let bestDistance = Infinity;
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    if (rect.top <= centerY && rect.bottom >= centerY) return Number(page.dataset.page); // center is inside this page
    const distance = Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = Number(page.dataset.page);
    }
  }
  return best;
}

export function scrollPageIntoView(viewer: HTMLElement, pageNumber: number): void {
  const page = viewer.querySelector<HTMLElement>(`.page[data-page="${pageNumber}"]`);
  if (!page) return;
  viewer.scrollTo({ left: Math.max(0, page.offsetLeft - 24), top: Math.max(0, page.offsetTop - 24) });
}
