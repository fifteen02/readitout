import type { AppState, Box } from "./types";
import type { Paragraph } from "./read-markers";

export interface AnnoApi {
  state: AppState;
  saveAnnotations: () => void;
  renderAnnotations: (layer?: HTMLElement) => void;
  renderAnnotationList: () => void;
  setStatus: (message: string) => void;
  openModal?: () => void;
}

// Highlight the current text selection in the given color. When `openAfter` is
// true the note editor opens on the new highlight (used by the "Note" action).
// Returns true if a highlight was created.
export function highlightSelection(api: AnnoApi, textLayer: HTMLElement, color: string, openAfter: boolean): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !textLayer.contains(selection.anchorNode)) return false;
  const pageNumber = Number(textLayer.dataset.page);
  const pageRect = textLayer.getBoundingClientRect();
  const text = selection.toString().replace(/\s+/g, " ").trim();
  const rects = [...selection.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 2 && rect.height > 2);
  if (!text || !rects.length) return false;
  // Snap each selection rect to the tight glyph box of the span under it (line-height:1),
  // so highlights sit on the text instead of low (the selection reports the font line-box).
  const spans = [...textLayer.querySelectorAll("span")].map((s) => s.getBoundingClientRect());
  addHighlight(
    api,
    pageNumber,
    text,
    rects.map((rect) => {
      const cy = rect.top + rect.height / 2;
      const g = spans.find((b) => cy >= b.top && cy <= b.bottom && rect.left < b.right && rect.right > b.left);
      const top = g ? g.top : rect.top;
      const h = g ? g.height : rect.height;
      return {
        x: (rect.left - pageRect.left) / pageRect.width,
        y: (top - pageRect.top) / pageRect.height,
        w: rect.width / pageRect.width,
        h: h / pageRect.height
      };
    }),
    color,
    openAfter
  );
  selection.removeAllRanges();
  return true;
}

// Commit a highlight from already-captured geometry (used by the inline note field
// in the selection popover, where focusing the input has cleared the live selection).
// `text` is the optional note typed by the user.
export function addHighlightWithText(api: AnnoApi, page: number, quote: string, rects: Box[], color: string, text: string): void {
  if (!quote || !rects.length) return;
  addHighlight(api, page, quote, rects, color, false, text);
}

export function createParagraphTag(api: AnnoApi, textLayer: HTMLElement, pageNumber: number, paragraph: Paragraph): void {
  const width = textLayer.clientWidth;
  const height = textLayer.clientHeight;
  const rects = paragraph.lines.map((line) => ({
    x: line.x / width,
    y: line.y / height,
    w: line.w / width,
    h: (line.font * 1.35) / height
  }));
  addHighlight(api, pageNumber, paragraph.text, rects, api.state.color, true);
}

function addHighlight(api: AnnoApi, page: number, quote: string, rects: Box[], color: string, openAfter: boolean, text = ""): void {
  const now = new Date().toISOString();
  const anno = {
    id: crypto.randomUUID(),
    type: "highlight" as const,
    page,
    quote,
    text,
    color,
    createdAt: now,
    updatedAt: now,
    ...rects[0],
    rects
  };
  api.state.annotations.push(anno);
  api.saveAnnotations();
  api.renderAnnotations();
  api.renderAnnotationList();
  api.state.selectedId = anno.id;
  api.setStatus(text ? `Noted: ${quote.slice(0, 60)}${quote.length > 60 ? "…" : ""}` : `Tagged: ${quote.slice(0, 80)}${quote.length > 80 ? "..." : ""}`);
  if (openAfter && api.openModal) api.openModal();
}
