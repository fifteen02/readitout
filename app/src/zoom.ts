import type { PdfDocument } from "./types";

export type ZoomMode = "fit-width" | "fit-page" | "fixed";

function avail(viewer: HTMLElement): { w: number; h: number } {
  const s = getComputedStyle(viewer);
  const padX = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
  const padY = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
  return {
    w: Math.max(320, viewer.clientWidth - padX - 18),
    h: Math.max(320, viewer.clientHeight - padY - 18)
  };
}

export async function fitPageWidthScale(pdf: PdfDocument, viewer: HTMLElement): Promise<number> {
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  return Math.min(3, Math.max(0.4, Math.round((avail(viewer).w / viewport.width) * 100) / 100));
}

// Fit the whole first page inside the viewport (width AND height).
export async function fitPageScale(pdf: PdfDocument, viewer: HTMLElement): Promise<number> {
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  const { w, h } = avail(viewer);
  return Math.min(3, Math.max(0.4, Math.round(Math.min(w / viewport.width, h / viewport.height) * 100) / 100));
}

export async function scaleForMode(mode: ZoomMode, pdf: PdfDocument, viewer: HTMLElement): Promise<number> {
  return mode === "fit-page" ? fitPageScale(pdf, viewer) : fitPageWidthScale(pdf, viewer);
}

// Reflect the current zoom in the select. In a fit mode, keep the fit option
// selected (so it stays responsive); otherwise show the exact percentage.
export function syncZoomSelect(select: HTMLSelectElement, scale: number, mode: ZoomMode = "fixed"): void {
  if (mode === "fit-width" || mode === "fit-page") {
    select.value = mode;
    return;
  }
  const value = String(scale);
  if (![...select.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${Math.round(scale * 100)}%`;
    select.appendChild(option);
  }
  select.value = value;
}
