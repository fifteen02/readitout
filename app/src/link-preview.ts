import type { PdfDocument } from "./types";

export interface LinkPreview {
  show(anchor: HTMLElement, dest: unknown): void;
  hide(): void;
}

interface Thumb {
  url: string;
  w: number;
  h: number;
  pageHeight: number;
}

// Renders a small preview of an internal link's target page on hover, so a
// cross-reference can be understood without navigating away.
export function createLinkPreview(pdf: PdfDocument): LinkPreview {
  const WIDTH = 620; // rendered preview width in the popover
  const cache = new Map<number, Thumb>();
  let box: HTMLDivElement | null = null;
  let hoverTimer = 0;
  let token = 0;

  function ensureBox(): HTMLDivElement {
    if (!box) {
      box = document.createElement("div");
      box.className = "link-preview";
      box.hidden = true;
      // The box is pointer-events:none (see styles.css) so it never captures the
      // cursor; it shows while the link is hovered and hides on the link's mouseleave.
      document.body.appendChild(box);
    }
    return box;
  }

  async function thumb(page: number): Promise<Thumb> {
    const cached = cache.get(page);
    if (cached) return cached;
    const p = await pdf.getPage(page);
    // render above display width (and ×DPR) so the preview text is crisp
    const viewport = p.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvasContext: canvas.getContext("2d", { alpha: false })!, viewport }).promise;
    const out: Thumb = {
      url: canvas.toDataURL("image/png"),
      w: canvas.width,
      h: canvas.height,
      pageHeight: p.getViewport({ scale: 1 }).height
    };
    cache.set(page, out);
    return out;
  }

  async function resolve(dest: unknown): Promise<{ page: number; top: number | null } | null> {
    try {
      const d = Array.isArray(dest) ? dest : await pdf.getDestination(dest as string);
      if (!d?.[0]) return null;
      const page = (await pdf.getPageIndex(d[0])) + 1;
      const kind = (d[1] as { name?: string } | undefined)?.name ?? "";
      let top: number | null = null;
      if (kind === "XYZ") top = typeof d[3] === "number" ? (d[3] as number) : null;
      else if (kind === "FitH" || kind === "FitBH") top = typeof d[2] === "number" ? (d[2] as number) : null;
      return { page, top };
    } catch {
      return null;
    }
  }

  function show(anchor: HTMLElement, dest: unknown): void {
    const my = ++token;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(async () => {
      const target = await resolve(dest);
      if (my !== token || !target) return;
      const t = await thumb(target.page);
      if (my !== token) return;
      const renderedH = Math.round((WIDTH * t.h) / t.w);
      const topFrac = target.top != null && t.pageHeight ? Math.min(1, Math.max(0, (t.pageHeight - target.top) / t.pageHeight)) : null;
      const markY = topFrac != null ? Math.round(topFrac * renderedH) : 0;
      const el = ensureBox();
      // Match the reader's chosen page scheme (sepia/dark/contrast) so the preview
      // isn't a glaring white page when the reading surface is tinted/dark.
      const viewer = document.querySelector(".viewer");
      const scheme = ["sepia", "dark", "contrast"].find((s) => viewer?.classList.contains(s)) ?? "normal";
      el.className = `link-preview ${scheme}`;
      el.innerHTML =
        `<div class="link-preview-head">Page ${target.page}</div>` +
        `<div class="link-preview-body"><div class="lp-inner" style="height:${renderedH}px">` +
        `<img src="${t.url}" alt="Page ${target.page} preview">` +
        `${topFrac != null ? `<div class="link-preview-mark" style="top:${markY}px"></div>` : ""}</div></div>`;
      el.hidden = false;
      const body = el.querySelector<HTMLElement>(".link-preview-body");
      if (body && topFrac != null) body.scrollTop = Math.max(0, markY - body.clientHeight / 2);
      position(el, anchor);
    }, 170);
  }

  function position(el: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = r.top - h - 8; // flip above
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top)); // keep fully in viewport
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function hide(): void {
    token++;
    window.clearTimeout(hoverTimer);
    if (box) box.hidden = true;
  }

  return { show, hide };
}
