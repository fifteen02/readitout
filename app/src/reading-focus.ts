// A reading-focus band: highlights one line at a time so you can read without
// audio. Reuses the per-line geometry the read-markers already compute. Moves by
// keyboard/click; hides itself while TTS is narrating (the speech highlight leads).

export interface LineRect {
  top: number;
  left: number;
  width: number;
  height: number;
  text: string;
}

interface PageLines {
  layer: HTMLElement;
  rects: LineRect[];
  band: HTMLElement;
}

export interface ReadingFocus {
  enabled(): boolean;
  toggle(): boolean;
  setEnabled(on: boolean): void;
  setDim(on: boolean): void;
  registerPage(page: number, layer: HTMLElement, rects: LineRect[]): void;
  move(delta: number): void;
  focusAtPoint(page: number, clientY: number, scroll?: "none" | "ensure" | "anchor" | "center"): void;
  suspend(on: boolean): void;
  current(): { page: number; band: HTMLElement; text: string } | null;
}

export function createReadingFocus(viewer: HTMLElement): ReadingFocus {
  const pages = new Map<number, PageLines>();
  let on = false;
  let dim = false;
  let suspended = false;
  let cur: { page: number; line: number } | null = null;

  // One retargetable eased scroll. Native smooth scrollBy stacks per keypress and
  // stutters; this cancels the in-flight animation and re-aims, so holding the
  // arrow key glides continuously.
  let scrollAnim = 0;
  function smoothScrollTo(top: number): void {
    cancelAnimationFrame(scrollAnim);
    const start = viewer.scrollTop;
    const change = top - start;
    if (Math.abs(change) < 1) return;
    const dur = 200;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
      viewer.scrollTop = start + change * e;
      if (p < 1) scrollAnim = requestAnimationFrame(tick);
    };
    scrollAnim = requestAnimationFrame(tick);
  }

  function sortedPages(): number[] {
    return [...pages.keys()].sort((a, b) => a - b);
  }

  function hideAll(): void {
    pages.forEach((pl) => pl.band.classList.remove("show"));
  }

  // "anchor" keeps the focus line at a fixed screen position (typewriter scroll):
  // stepping lines moves the page, not your eyes. "ensure" only scrolls if the
  // line is off-screen. "none" leaves the scroll where it is.
  function render(scroll: "none" | "ensure" | "anchor" | "center"): void {
    hideAll();
    if (!on || suspended || !cur) return;
    const pl = pages.get(cur.page);
    const rect = pl?.rects[cur.line];
    if (!pl || !rect) return;
    Object.assign(pl.band.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
    pl.band.classList.add("show");
    pl.band.classList.toggle("dim", dim);
    if (scroll === "ensure") scrollBandIntoView(pl, rect);
    else if (scroll === "anchor") anchorBand(pl, rect);
    else if (scroll === "center") centerBand(pl, rect);
  }

  // Put the focus line at the vertical centre of the viewport.
  function centerBand(pl: PageLines, rect: LineRect): void {
    const layerTop = pl.layer.getBoundingClientRect().top;
    const vr = viewer.getBoundingClientRect();
    const bandCentre = layerTop + rect.top + rect.height / 2;
    smoothScrollTo(viewer.scrollTop + (bandCentre - (vr.top + vr.height / 2)));
  }

  function scrollBandIntoView(pl: PageLines, rect: LineRect): void {
    const layerTop = pl.layer.getBoundingClientRect().top;
    const vr = viewer.getBoundingClientRect();
    const bandTop = layerTop + rect.top;
    const bandBottom = bandTop + rect.height;
    if (bandTop < vr.top + 90) smoothScrollTo(viewer.scrollTop + bandTop - (vr.top + 90));
    else if (bandBottom > vr.bottom - 90) smoothScrollTo(viewer.scrollTop + bandBottom - (vr.bottom - 90));
  }

  // Hold the focus line at ~38% down the viewport, so the page scrolls up under it.
  function anchorBand(pl: PageLines, rect: LineRect): void {
    const layerTop = pl.layer.getBoundingClientRect().top;
    const vr = viewer.getBoundingClientRect();
    const bandTop = layerTop + rect.top;
    const anchor = vr.top + vr.height * 0.38;
    smoothScrollTo(viewer.scrollTop + (bandTop - anchor));
  }

  // First line at/below the top of the viewport — the top of the page you're on.
  // We do NOT scroll to it, so enabling focus stays on the current page.
  function focusVisible(): void {
    const top = viewer.getBoundingClientRect().top + 4;
    for (const page of sortedPages()) {
      const pl = pages.get(page)!;
      const layerTop = pl.layer.getBoundingClientRect().top;
      for (let i = 0; i < pl.rects.length; i++) {
        if (layerTop + pl.rects[i].top >= top) {
          cur = { page, line: i };
          return;
        }
      }
    }
    const order = sortedPages();
    const last = order[order.length - 1];
    const pl = last !== undefined ? pages.get(last) : undefined;
    if (pl && pl.rects.length) cur = { page: last, line: pl.rects.length - 1 };
  }

  return {
    enabled: () => on,
    setEnabled(next: boolean) {
      on = next;
      if (on) focusVisible(); // always land on the current page's first visible line
      render("none");         // ...without scrolling away from it
    },
    toggle() {
      this.setEnabled(!on);
      return on;
    },
    setDim(next: boolean) {
      dim = next;
      render("none");
    },
    registerPage(page, layer, rects) {
      let band = layer.querySelector<HTMLElement>(".focus-band");
      if (!band) {
        band = document.createElement("div");
        band.className = "focus-band";
        layer.appendChild(band);
      }
      pages.set(page, { layer, rects, band });
      if (on && cur?.page === page) render("none");
    },
    move(delta) {
      if (!on) return;
      if (!cur) {
        focusVisible();
        render("anchor");
        return;
      }
      const pl = pages.get(cur.page);
      if (!pl) return;
      let line = cur.line + delta;
      if (line < 0 || line >= pl.rects.length) {
        // step into the adjacent rendered page, if any
        const order = sortedPages();
        const i = order.indexOf(cur.page);
        const next = order[i + (delta > 0 ? 1 : -1)];
        if (next !== undefined) {
          const np = pages.get(next)!;
          cur = { page: next, line: delta > 0 ? 0 : np.rects.length - 1 };
        } else {
          line = Math.max(0, Math.min(pl.rects.length - 1, line));
          cur = { page: cur.page, line };
        }
      } else {
        cur = { page: cur.page, line };
      }
      render("anchor");
    },
    focusAtPoint(page, clientY, scroll = "none") {
      const pl = pages.get(page);
      if (!on || !pl) return;
      const layerTop = pl.layer.getBoundingClientRect().top;
      const y = clientY - layerTop;
      let best = 0;
      let bestD = Infinity;
      pl.rects.forEach((r, i) => {
        const d = Math.abs(r.top + r.height / 2 - y);
        if (d < bestD) { bestD = d; best = i; }
      });
      cur = { page, line: best };
      render(scroll);
    },
    suspend(next: boolean) {
      suspended = next;
      render("none");
    },
    current() {
      if (!on || !cur) return null;
      const pl = pages.get(cur.page);
      if (!pl) return null;
      return { page: cur.page, band: pl.band, text: pl.rects[cur.line]?.text ?? "" };
    }
  };
}
