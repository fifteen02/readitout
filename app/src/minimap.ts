// A slim annotation overview ruler down the right edge of the reader, in the spirit of
// VS Code's overview ruler: each annotation is a tick in its highlight colour, placed at
// its content fraction ((page-1+y)/total) so it stays put regardless of lazy render.
// Click a tick to jump to it, or click the track to jump to that spot. A subtle box
// shows where the viewport is.

// Kept for the (separate) top page-scrubber marks; the ruler itself is annotations-only.
export interface StructureMark {
  title: string;
  page: number;
}
export interface AnnotationMark {
  id: string;
  page: number;
  y: number; // 0..1 within the page
  color: string;
  label: string; // shown on hover (feedback or quote snippet)
}

export interface MinimapDeps {
  root: HTMLElement;
  viewer: HTMLElement;
  total: () => number;
  annotations: () => AnnotationMark[];
  jumpToAnnotation: (id: string) => void;
  jumpToFraction: (frac: number) => void;
  tip: (target: HTMLElement, text: string) => void;
  hideTip: () => void;
}

export interface Minimap {
  render(): void;
  refreshViewport(): void;
  show(): void;
  hide(): void;
}

export function createMinimap(deps: MinimapDeps): Minimap {
  const { root } = deps;
  root.classList.add("minimap");
  root.hidden = true;

  const lane = document.createElement("div");
  lane.className = "mm-anno-lane";
  lane.title = "Annotations";
  const viewport = document.createElement("div");
  viewport.className = "mm-viewport";
  root.replaceChildren(lane, viewport);

  // Hovering the ruler shows the annotations around that spot — a readable, magnified
  // view of the marks (colour + note text + page) so you can see them clearly rather than
  // squinting at tiny ticks. Floated to the left of the ruler.
  const PREVIEW_W = 260;
  const preview = document.createElement("div");
  preview.className = "mm-preview";
  preview.hidden = true;
  document.body.appendChild(preview);

  function showPreview(clientY: number): void {
    const laneRect = lane.getBoundingClientRect();
    const total = Math.max(1, deps.total());
    const marks = deps.annotations().map((a) => ({ a, f: frac(a.page, a.y) }));
    if (!marks.length) { preview.hidden = true; return; }
    const f = Math.min(1, Math.max(0, (clientY - laneRect.top) / laneRect.height));
    // Only the annotations on the page under the cursor (not the whole neighbourhood).
    const page = Math.min(total, Math.floor(f * total) + 1);
    const near = marks.filter((m) => m.a.page === page).sort((x, y) => x.f - y.f);
    if (!near.length) { preview.hidden = true; return; }
    preview.replaceChildren(
      ...near.map(({ a }) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "mmp-item";
        const dot = document.createElement("span");
        dot.className = "mmp-dot";
        dot.style.setProperty("--c", a.color);
        const txt = document.createElement("span");
        txt.className = "mmp-text";
        txt.textContent = a.label || "Highlight";
        const pg = document.createElement("span");
        pg.className = "mmp-pg";
        pg.textContent = String(a.page);
        row.append(dot, txt, pg);
        row.addEventListener("click", () => { preview.hidden = true; deps.jumpToAnnotation(a.id); });
        return row;
      })
    );
    const mmRect = root.getBoundingClientRect();
    preview.style.left = `${Math.round(mmRect.left - PREVIEW_W - 12)}px`;
    preview.hidden = false;
    const h = preview.offsetHeight;
    preview.style.top = `${Math.round(Math.min(window.innerHeight - h - 10, Math.max(10, clientY - h / 2)))}px`;
  }
  const hidePreview = (): void => { preview.hidden = true; };
  // Keep it open while the pointer is over the ruler OR the preview (so marks are clickable).
  let hideTimer = 0;
  const scheduleHide = (): void => { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hidePreview, 180); };
  lane.addEventListener("pointermove", (event) => { window.clearTimeout(hideTimer); showPreview(event.clientY); });
  lane.addEventListener("pointerleave", scheduleHide);
  preview.addEventListener("pointerenter", () => window.clearTimeout(hideTimer));
  preview.addEventListener("pointerleave", scheduleHide);

  // Drag anywhere on the ruler to scrub-scroll (like a scrollbar); the viewport box is
  // pointer-transparent, so grabbing it drags too. Clicking a tick still jumps to it.
  let scrubbing = false;
  const scrubTo = (clientY: number): void => {
    const rect = lane.getBoundingClientRect();
    deps.jumpToFraction(Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)));
  };
  lane.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(".mm-anno")) return; // ticks handle their own click
    event.preventDefault();
    scrubbing = true;
    lane.classList.add("scrubbing");
    try { lane.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    scrubTo(event.clientY);
  });
  lane.addEventListener("pointermove", (event) => {
    if (scrubbing) scrubTo(event.clientY);
  });
  const endScrub = (event: PointerEvent): void => {
    if (!scrubbing) return;
    scrubbing = false;
    lane.classList.remove("scrubbing");
    try { lane.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  lane.addEventListener("pointerup", endScrub);
  lane.addEventListener("pointercancel", endScrub);

  const frac = (page: number, y: number): number => {
    const total = Math.max(1, deps.total());
    return Math.min(1, Math.max(0, (page - 1 + y) / total));
  };

  function render(): void {
    lane.querySelectorAll(".mm-anno").forEach((n) => n.remove());
    for (const anno of deps.annotations()) {
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "mm-anno";
      tick.dataset.f = String(frac(anno.page, anno.y));
      tick.style.top = `${(frac(anno.page, anno.y) * 100).toFixed(3)}%`;
      tick.style.setProperty("--c", anno.color);
      tick.setAttribute("aria-label", anno.label);
      tick.addEventListener("mouseenter", () => deps.tip(tick, anno.label));
      tick.addEventListener("mouseleave", deps.hideTip);
      tick.addEventListener("click", (e) => {
        e.stopPropagation();
        deps.hideTip();
        deps.jumpToAnnotation(anno.id);
      });
      lane.appendChild(tick);
    }
    refreshViewport();
  }

  function refreshViewport(): void {
    const { scrollHeight, clientHeight, scrollTop } = deps.viewer;
    const fits = scrollHeight <= clientHeight;
    const topF = fits ? 0 : scrollTop / scrollHeight;
    const botF = fits ? 1 : (scrollTop + clientHeight) / scrollHeight;
    viewport.style.top = `${(topF * 100).toFixed(3)}%`;
    viewport.style.height = `${((botF - topF) * 100).toFixed(3)}%`;
    // Emphasise the annotations currently on screen; dim the rest (whole-doc overview
    // stays visible, but you can see at a glance what's in view).
    lane.querySelectorAll<HTMLElement>(".mm-anno").forEach((el) => {
      const f = Number(el.dataset.f);
      el.classList.toggle("in-view", f >= topF && f <= botF);
    });
  }

  return {
    render,
    refreshViewport,
    show() {
      root.hidden = false;
      render();
    },
    hide() {
      root.hidden = true;
      hidePreview();
    }
  };
}
