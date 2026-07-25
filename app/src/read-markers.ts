import type { PdfTextContent, PdfViewport, ReadState } from "./types";
import type { PdfjsLib } from "./lib/pdfjs";

export interface TextLine {
  y: number;
  x: number;
  w: number;
  font: number;
  text: string;
}

export interface Paragraph extends TextLine {
  lines: TextLine[];
  markerId?: string;
}

export interface ParagraphReadItem {
  text: string;
  markerId: string;
  page: number;
}

export function addReadMarkers(
  pdfjsLib: PdfjsLib,
  layer: HTMLElement,
  content: PdfTextContent,
  viewport: PdfViewport,
  onRead: (items: ParagraphReadItem[], markerId: string) => void,
  onTag?: (paragraph: Paragraph) => void,
  onLines?: (rects: { top: number; left: number; width: number; height: number; text: string }[]) => void
): ParagraphReadItem[] {
  // Keep every non-empty line so a paragraph's short final line (e.g. "act.")
  // is still read and highlighted; drop only whole short fragments (page numbers).
  const lines = textLines(pdfjsLib, content, viewport).filter((line) => line.text.trim().length > 0);
  // Hand per-line boxes to the reading-focus band (one highlightable line each).
  onLines?.(lines.map((line) => ({
    left: line.x - 4,
    top: line.y - 2,
    width: line.w + 8,
    height: line.font * 1.35 + 4,
    text: line.text
  })));
  const paragraphs = paragraphStarts(lines).filter((paragraph) => paragraph.text.trim().length > 24);
  paragraphs.forEach((paragraph, index) => {
    const markerId = `${layer.dataset.page}:${index}`;
    paragraph.markerId = markerId;
    // One clean box covering the whole paragraph (instead of jagged per-line rects)
    const left = Math.min(...paragraph.lines.map((line) => line.x));
    const right = Math.max(...paragraph.lines.map((line) => line.x + line.w));
    const top = paragraph.lines[0].y;
    const last = paragraph.lines[paragraph.lines.length - 1];
    const bottom = last.y + last.font * 1.35;
    const focus = document.createElement("div");
    focus.className = "read-focus";
    focus.dataset.markerId = markerId;
    Object.assign(focus.style, {
      left: `${left - 4}px`,
      top: `${top - 2}px`,
      width: `${right - left + 8}px`,
      height: `${bottom - top + 4}px`
    });
    layer.appendChild(focus);

    // Lay the two controls out as an aligned pair in the left gutter,
    // vertically centred on the first line and clear of the text.
    const size = 28;
    const gap = 5;
    const pad = 9;
    let tagLeft = paragraph.x - pad - size;
    let playLeft = tagLeft - gap - size;
    if (playLeft < 2) {
      const shift = 2 - playLeft;
      playLeft += shift;
      tagLeft += shift;
    }
    // Centre on the first line's visual middle (~0.58em below its top) so the play/# pills
    // line up with the heading/paragraph text rather than sitting slightly low.
    const markerTop = paragraph.y + paragraph.font * 0.58 - size / 2;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "read-marker";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.1v13.8a1 1 0 0 0 1.53.85l11-6.9a1 1 0 0 0 0-1.7l-11-6.9A1 1 0 0 0 8 5.1Z"/></svg>';
    button.ariaLabel = "Read from here";
    button.dataset.markerId = markerId;
    button.dataset.ptop = String(top - 2);
    button.dataset.pbot = String(bottom + 2);
    button.style.left = `${playLeft}px`;
    button.style.top = `${markerTop}px`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onRead(
        paragraphs.slice(index).map((item) => ({
          text: item.text,
          markerId: item.markerId as string,
          page: Number(layer.dataset.page)
        })),
        button.dataset.markerId as string
      );
    });
    layer.appendChild(button);

    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "read-tag";
    tag.textContent = "#";
    tag.ariaLabel = "Tag this paragraph";
    tag.dataset.markerId = markerId;
    tag.dataset.ptop = String(top - 2);
    tag.dataset.pbot = String(bottom + 2);
    tag.style.left = `${tagLeft}px`;
    tag.style.top = `${markerTop}px`;
    tag.addEventListener("click", (event) => {
      event.stopPropagation();
      onTag?.(paragraph);
    });
    layer.appendChild(tag);
  });

  // Reveal the ▶/# controls only for the paragraph the pointer is over.
  let rafPending = false;
  layer.addEventListener("pointermove", (event) => {
    if (rafPending) return;
    rafPending = true;
    const clientY = event.clientY;
    requestAnimationFrame(() => {
      rafPending = false;
      const y = clientY - layer.getBoundingClientRect().top;
      layer.querySelectorAll<HTMLElement>(".read-marker, .read-tag").forEach((el) => {
        el.classList.toggle("near", y >= Number(el.dataset.ptop) && y <= Number(el.dataset.pbot));
      });
    });
  });
  layer.addEventListener("pointerleave", () => {
    layer.querySelectorAll<HTMLElement>(".read-marker.near, .read-tag.near").forEach((el) => el.classList.remove("near"));
  });

  return paragraphs.map((item) => ({
    text: item.text,
    markerId: item.markerId as string,
    page: Number(layer.dataset.page)
  }));
}

export function setReadMarkerState(markerId: string | null, state: ReadState): void {
  // Keep the # tag visible next to the play control on the active line (both, no gap).
  document.querySelectorAll<HTMLElement>(".read-tag").forEach((t) => {
    t.classList.toggle("active", t.dataset.markerId === markerId && state !== "idle");
  });
  document.querySelectorAll<HTMLElement>(".read-marker,.read-focus").forEach((item) => {
    const active = item.dataset.markerId === markerId && state !== "idle";
    item.classList.toggle("loading", active && state === "loading");
    item.classList.toggle("playing", active && state === "playing");
    item.classList.toggle("paused", active && state === "paused");
    if (!item.classList.contains("read-marker")) return;
    if (active && state === "loading") {
      // Same equaliser effect as the reader-player play button.
      item.innerHTML = '<span class="eq-load" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
    } else {
      item.textContent = active && state === "playing" ? "Ⅱ" : "▶";
    }
    item.ariaLabel =
      active && state === "loading" ? "Loading audio" : active && state === "playing" ? "Pause reading" : "Read from here";
  });
}

export function scrollMarkerIntoView(markerId: string, viewer: HTMLElement): void {
  const marker = document.querySelector<HTMLElement>(`.read-marker[data-marker-id="${CSS.escape(markerId)}"]`);
  if (!marker) return;
  const markerRect = marker.getBoundingClientRect();
  const viewerRect = viewer.getBoundingClientRect();
  const topDelta =
    markerRect.top < viewerRect.top + 64
      ? markerRect.top - viewerRect.top - 64
      : markerRect.bottom > viewerRect.bottom - 64
        ? markerRect.bottom - viewerRect.bottom + 64
        : 0;
  const leftDelta =
    markerRect.left < viewerRect.left + 40
      ? markerRect.left - viewerRect.left - 40
      : markerRect.right > viewerRect.right - 40
        ? markerRect.right - viewerRect.right + 40
        : 0;
  if (topDelta || leftDelta) {
    viewer.scrollTo({ top: viewer.scrollTop + topDelta, left: viewer.scrollLeft + leftDelta, behavior: "smooth" });
  }
}

function textLines(pdfjsLib: PdfjsLib, content: PdfTextContent, viewport: PdfViewport): TextLine[] {
  interface Row {
    y: number;
    x: number;
    font: number;
    parts: { x: number; w: number; text: string }[];
  }
  const rows: Row[] = [];
  content.items.forEach((item) => {
    const m = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const font = Math.hypot(m[2], m[3]) || 10;
    const y = m[5] - font;
    const row = rows.find((candidate) => Math.abs(candidate.y - y) < font * 0.7);
    const target = row || rows[rows.push({ y, x: m[4], font, parts: [] }) - 1];
    target.x = Math.min(target.x, m[4]);
    target.parts.push({ x: m[4], w: item.width * viewport.scale, text: item.str });
  });
  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => ({
      y: row.y,
      x: row.x,
      w: Math.max(...row.parts.map((part) => part.x + part.w)) - row.x,
      font: row.font,
      text: row.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    }));
}

function paragraphStarts(lines: TextLine[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (!previous || Math.abs(line.y - previous.y) > line.font * 1.45) {
      paragraphs.push({ ...line, lines: [line] });
    } else {
      const last = paragraphs[paragraphs.length - 1];
      last.text += ` ${line.text}`;
      last.lines.push(line);
    }
  });
  return paragraphs;
}
