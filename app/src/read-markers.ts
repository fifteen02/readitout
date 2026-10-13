import { deskIcon } from "./desk-icons";
import { textRunGeometry } from "./text-run-geometry";
import { markerPlacement } from "./marker-placement";
import type { PdfTextContent, PdfViewport, ReadState } from "./types";
import type { PdfjsLib } from "./lib/pdfjs";

// Keep margin controls optically consistent across playback states and fonts.
const PLAY_ICON = deskIcon("play");
const PAUSE_ICON = deskIcon("pause");
const LOADING_ICON = deskIcon("loading");
const TAG_ICON = deskIcon("pen");

export interface TextLine {
  y: number;
  x: number;
  w: number;
  font: number;
  height?: number;
  angle?: number;
  flow?: number;
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
    height: (line.height ?? line.font * 1.35) + 4,
    text: line.text
  })));
  const paragraphs = paragraphStarts(lines).filter((paragraph) => paragraph.text.trim().length > 24);
  paragraphs.forEach((paragraph, index) => {
    const markerId = `${layer.dataset.page}:${index}`;
    paragraph.markerId = markerId;
    // Paragraph bounds position the editorial bracket and optional focus dimming.
    const left = Math.min(...paragraph.lines.map((line) => line.x));
    const right = Math.max(...paragraph.lines.map((line) => line.x + line.w));
    const top = Math.min(...paragraph.lines.map((line) => line.y));
    const bottom = Math.max(...paragraph.lines.map((line) => line.y + (line.height ?? line.font * 1.35)));
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
    // At narrow widths the pair may not fit on the left. Use both gutters,
    // or the right gutter, rather than shifting an action over the passage.
    const placement = markerPlacement(left, right, viewport.width);
    if (placement) {
      playLeft = placement.play;
      tagLeft = placement.tag;
    }
    // Centre on the first line's visual middle (~0.58em below its top) so the margin controls
    // line up with the heading/paragraph text rather than sitting slightly low.
    const markerTop = paragraph.y + paragraph.font * 0.58 - size / 2;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "read-marker";
    button.innerHTML = PLAY_ICON;
    button.ariaLabel = "Read from here";
    button.title = button.ariaLabel;
    const passageDescription = `Page ${layer.dataset.page}, passage ${index + 1}: ${paragraph.text.replace(/\s+/g, " ").slice(0, 100)}`;
    button.dataset.passageDescription = passageDescription;
    button.ariaLabel = `Read from here. ${passageDescription}`;
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
    tag.innerHTML = TAG_ICON;
    tag.ariaLabel = "Tag this paragraph";
    tag.title = "Add note to this passage";
    tag.ariaLabel = "Add note to this passage";
    tag.ariaLabel = `Add note to this passage. ${passageDescription}`;
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
      // A steady waiting glyph keeps motion out of the reading margin.
      item.innerHTML = LOADING_ICON;
    } else {
      item.innerHTML = active && state === "playing" ? PAUSE_ICON : PLAY_ICON;
    }
    const action =
      active && state === "loading" ? "Loading audio" : active && state === "playing" ? "Pause reading" : active && state === "paused" ? "Resume reading" : "Read from here";
    item.title = action;
    item.ariaLabel = `${action}. ${item.dataset.passageDescription || ""}`;
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

export function textLines(pdfjsLib: PdfjsLib, content: PdfTextContent, viewport: PdfViewport): TextLine[] {
  type Run = ReturnType<typeof textRunGeometry> & { text: string };
  const groups = new Map<number, { across: number; font: number; parts: Run[] }[]>();
  content.items.forEach((item) => {
    const m = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const run = { ...textRunGeometry(m, item.width * viewport.scale), text: item.str };
    // Group in the text's own baseline coordinates, not screen rows. Keep
    // orientation groups in document order when horizontal/rotated text coexist.
    const angle = Math.round(run.angle * 10000) / 10000;
    const rows = groups.get(angle) ?? [];
    groups.set(angle, rows);
    const row = rows.find((candidate) => Math.abs(candidate.across - run.across) < run.font * .7);
    if (row) row.parts.push(run);
    else rows.push({ across: run.across, font: run.font, parts: [run] });
  });
  return [...groups.entries()].flatMap(([angle, rows]) => rows
    .sort((a, b) => a.across - b.across)
    .map((row) => {
      const x = Math.min(...row.parts.map((run) => run.x));
      const y = Math.min(...row.parts.map((run) => run.y));
      return {
        x, y, angle, flow: row.across,
        w: Math.max(...row.parts.map((run) => run.x + run.w)) - x,
        height: angle === 0 ? row.font * 1.35 : Math.max(...row.parts.map((run) => run.y + run.h)) - y,
        font: row.font,
        text: row.parts.sort((a, b) => a.along - b.along).map((run) => run.text).join(" ").replace(/\s+/g, " ").trim()
      };
    }));
}

export function paragraphStarts(lines: TextLine[]): Paragraph[] {
  // PDF leading varies by font/layout. A fixed 1.45em cutoff classified the
  // sample's 1.6em body lines as separate paragraphs (and speech requests).
  const spacings = lines.flatMap((line, index) => {
    const previous = lines[index - 1];
    if (!previous || line.angle !== previous.angle || Math.abs(line.font / previous.font - 1) > .15) return [];
    const spacing = Math.abs((line.flow ?? line.y) - (previous.flow ?? previous.y)) / line.font;
    return spacing >= .9 && spacing <= 2 ? [spacing] : [];
  }).sort((a, b) => a - b);
  const leading = spacings.length ? spacings[Math.floor((spacings.length - 1) / 2)] : 1.16;
  const paragraphGap = Math.max(1.45, Math.min(2, leading * 1.25));
  const paragraphs: Paragraph[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (!previous || line.angle !== previous.angle || Math.abs(line.font / previous.font - 1) > .15 || Math.abs((line.flow ?? line.y) - (previous.flow ?? previous.y)) > line.font * paragraphGap) {
      paragraphs.push({ ...line, lines: [line] });
    } else {
      const last = paragraphs[paragraphs.length - 1];
      last.text += ` ${line.text}`;
      last.lines.push(line);
    }
  });
  return paragraphs;
}
