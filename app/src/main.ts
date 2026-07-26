import "./styles.css";
import { pdfjsLib } from "./lib/pdfjs";
import { buildUi } from "./ui";
import { initSettings, speechRequest } from "./reader-settings";
import { annotationPayload, collaborationMarkdown } from "./annotation-export";
import { addHighlightWithText, createParagraphTag, type AnnoApi } from "./annotation-create";
import { createSelectionPopover } from "./selection-popover";
import { createMinimap } from "./minimap";
import { initAnnotationModal } from "./annotation-modal";
import { scrollPageIntoView, visiblePage } from "./scroll";
import { addReadMarkers, setReadMarkerState, type ParagraphReadItem } from "./read-markers";
import { chunkText, fetchSpeech, playLocalChunk, playPremiumChunk, type PlaybackApi } from "./audio-playback";
import { scaleForMode, syncZoomSelect, type ZoomMode } from "./zoom";
import { buildLinkLayer } from "./link-layer";
import { createLinkPreview, type LinkPreview } from "./link-preview";
import { activateReaderItem, initReaderPlayer, readerPlayerActions, setReaderButtons, syncReaderPlayer } from "./reader-player";
import { attachVisualizer, stopVisualizer } from "./visualizer";
import { initPomodoro } from "./pomodoro";
import { createReadingFocus } from "./reading-focus";
import { initLobbyIntro } from "./lobby-intro";
import { track } from "./analytics";
import type { AppState, Annotation, Box, PdfOutlineItem, PdfPage, PdfViewport, ReadItem, ReadState } from "./types";

const ui = buildUi();
let linkPreview: LinkPreview | null = null;
const readingFocus = createReadingFocus(ui.viewer);
let zoomMode: ZoomMode = "fit-width"; // fit-width | fit-page | fixed

const state: AppState = {
  pdf: null,
  fileKey: "",
  fileName: "",
  page: 1,
  scale: 1.15,
  theme: "normal",
  color: "#ffd240",
  mode: "highlight",
  annotations: [],
  selectedId: null,
  pageTexts: new Map(),
  pageReadItems: new Map(),
  chunks: [],
  readHistory: [],
  currentReadItem: null,
  reading: false,
  audio: null,
  prefetch: null,
  prefetchItem: null,
  activeReadState: "idle",
  activeMarker: null,
  readingPage: null,
  renderId: 0,
  playToken: 0,
  playAbort: null
};

const setStatus = (message: string): void => {
  ui.status.textContent = message;
};

// Visible error toast — the status line is easy to miss, so surface failures clearly.
let errorToast: HTMLDivElement | null = null;
let errorToastTimer = 0;
function showError(message: string): void {
  if (!errorToast) {
    errorToast = document.createElement("div");
    errorToast.className = "toast toast-error";
    errorToast.setAttribute("role", "alert");
    errorToast.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.2h.01"/></svg>' +
      '<span class="toast-msg"></span><button type="button" class="toast-x" aria-label="Dismiss">×</button>';
    errorToast.querySelector<HTMLElement>(".toast-x")?.addEventListener("click", () => errorToast?.classList.remove("show"));
    document.body.appendChild(errorToast);
  }
  const msg = errorToast.querySelector<HTMLElement>(".toast-msg");
  if (msg) msg.textContent = message;
  errorToast.classList.add("show");
  window.clearTimeout(errorToastTimer);
  errorToastTimer = window.setTimeout(() => errorToast?.classList.remove("show"), 9000);
  setStatus(message);
}
const storageKey = (): string => `pdf-annotation-reader:${state.fileKey}`;
const currentAnnotation = (): Annotation | undefined => state.annotations.find((a) => a.id === state.selectedId);

function validAnnotation(item: unknown): item is Annotation {
  if (!item || typeof item !== "object") return false;
  const a = item as Record<string, unknown>;
  return (
    Number.isInteger(a.page) &&
    (a.type === "highlight" || a.type === "note") &&
    (["x", "y", "w", "h"].every((key) => Number.isFinite(a[key])) || Array.isArray(a.rects))
  );
}

function setPdfControls(enabled: boolean): void {
  // First-run takeover: hide the reading chrome and show the welcome screen until a PDF is open.
  ui.app.classList.toggle("no-doc", !enabled);
  if (enabled) {
    // One-time arrival: the reading area rises + fades in as the document opens.
    ui.app.classList.add("doc-arriving");
    window.setTimeout(() => ui.app.classList.remove("doc-arriving"), 700);
  }
  [ui.prevPage, ui.nextPage, ui.pageSlider, ui.readPage, ui.readAll, ui.exportAnno, ui.importAnnoButton, ui.copyCodex, ui.exportMarkdown].forEach(
    (el) => {
      el.disabled = !enabled;
    }
  );
  updatePageControls();
  syncReaderPlayer(ui, state);
}

function updatePageControls(): void {
  const total = state.pdf?.numPages || 0;
  ui.pageLabel.textContent = `${total ? state.page : 0} / ${total}`;
  ui.prevPage.disabled = !total || state.page <= 1;
  ui.nextPage.disabled = !total || state.page >= total;
  ui.pageSlider.disabled = !total;
  ui.pageSlider.max = String(Math.max(1, total));
  ui.pageSlider.value = String(Math.max(1, state.page));
  // Hide the resume bookmark when the thumb sits on it (avoids a doubled marker).
  if (bookmarkPage) ui.bookmarkMark.hidden = state.page === bookmarkPage;
  updateCurrentSection();
}

async function openPdf(file: File | undefined): Promise<void> {
  if (!file || file.type !== "application/pdf") {
    setStatus("Choose a valid PDF file.");
    return;
  }
  stopReading();
  showLoader("Opening document…");
  try {
    // Stable key (name + size) so annotations survive re-opening even if the
    // file's modified-time changes; lastModified used to make the key fragile.
    state.fileKey = `${file.name}:${file.size}`;
    state.fileName = file.name;
    state.page = 1;
    state.selectedId = null;
    state.pageTexts.clear();
    state.pageReadItems.clear();
    state.pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    linkPreview = createLinkPreview(state.pdf);
    loadAnnotations();
    // Reveal the reading layout FIRST (with the grid transition off) so the viewer
    // has its final width before we measure fit-to-width. Measuring while the
    // welcome is up (viewer display:none, width 0) produced a tiny, wrong scale.
    ui.app.classList.add("resizing");
    setPdfControls(true);
    void ui.viewer.offsetWidth; // flush layout at the final column sizes
    if (zoomMode === "fixed") zoomMode = "fit-width";
    state.scale = await scaleForMode(zoomMode, state.pdf, ui.viewer);
    syncZoomSelect(ui.zoom, state.scale, zoomMode);
    requestAnimationFrame(() => ui.app.classList.remove("resizing"));
    showLoader(`Rendering ${state.pdf.numPages} pages…`);
    await cachePageDims(); // exact per-page sizes up front → no layout shift on zoom/scroll
    await renderPages();
    showLoader("Loading contents & annotations…");
    renderAnnotationList();
    minimap.show();
    await buildOutline();
    // Restore last reading position (bookmark) for this file.
    const savedPage = Number(localStorage.getItem(`pdf-reader-pos:${state.fileKey}`));
    if (savedPage >= 1 && savedPage <= state.pdf.numPages) {
      if (savedPage > 1) await goToPage(savedPage);
      updateBookmarkMark(savedPage);
      setStatus(savedPage > 1 ? `Loaded ${file.name} — resumed at page ${savedPage}.` : `Loaded ${file.name}.`);
    } else {
      ui.bookmarkMark.hidden = true;
      setStatus(`Loaded ${file.name}.`);
    }
    maybeShowOnboarding();
    // Deliberately no file name, only the shape of the document.
    track("pdf_opened", { pages: state.pdf.numPages, size_kb: Math.round(file.size / 1024) });
  } catch (error) {
    track("pdf_open_failed");
    showError(`Couldn't open ${file.name}: ${(error as Error).message}`);
  } finally {
    hideLoader();
  }
}

// One-time quick-start coach-mark on the first document a reader opens.
const ONBOARD_KEY = "readitout:onboarded";
function maybeShowOnboarding(): void {
  if (localStorage.getItem(ONBOARD_KEY) === "true") return;
  ui.coachmark.hidden = false;
}
ui.coachmarkDismiss.addEventListener("click", () => {
  ui.coachmark.hidden = true;
  localStorage.setItem(ONBOARD_KEY, "true");
});

function showLoader(text: string): void {
  ui.loaderText.textContent = text;
  ui.loader.hidden = false;
}
function hideLoader(): void {
  ui.loader.hidden = true;
}

let posSaveTimer = 0;
function saveReadingPosition(): void {
  if (!state.fileKey) return;
  updateBookmarkMark(state.page);
  window.clearTimeout(posSaveTimer);
  posSaveTimer = window.setTimeout(() => {
    localStorage.setItem(`pdf-reader-pos:${state.fileKey}`, String(state.page));
  }, 400);
}

// A non-interactive marker on the scrubber showing the current position; resume
// on open jumps here. Kept pointer-events:none so it never blocks the slider thumb.
let bookmarkPage = 0;
function updateBookmarkMark(page: number): void {
  const total = state.pdf?.numPages || 0;
  if (total < 2) {
    ui.bookmarkMark.hidden = true;
    bookmarkPage = 0;
    return;
  }
  const p = Math.min(Math.max(1, page), total);
  bookmarkPage = p;
  const frac = (p - 1) / (total - 1);
  ui.bookmarkMark.style.setProperty("--frac", frac.toFixed(4));
  ui.bookmarkMark.hidden = state.page === p; // don't double up with the thumb when we're on it
}

// PDF outlines often carry LaTeX-style quotes (``like this'') — tidy them into real
// typographic quotes so headings and the breadcrumb read cleanly.
function tidyTitle(s: string): string {
  return s
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/`/g, "‘")
    .replace(/\s+/g, " ")
    .trim();
}

async function buildOutline(): Promise<void> {
  ui.tocList.replaceChildren();
  ui.sliderMarks.replaceChildren();
  const outline = await state.pdf!.getOutline().catch(() => null);
  if (!outline || !outline.length) {
    ui.tocDrawer.hidden = true;
    return;
  }
  ui.tocDrawer.hidden = false;
  void buildSliderMarks(outline);
  const frag = document.createDocumentFragment();
  const addItems = (items: PdfOutlineItem[], depth: number): void => {
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toc-item";
      btn.style.paddingLeft = `${10 + depth * 12}px`;
      btn.textContent = tidyTitle(item.title);
      btn.addEventListener("click", async () => {
        const page = await destPage(item.dest);
        if (page) await goToLinkTarget(page);
      });
      frag.appendChild(btn);
      if (item.items?.length) addItems(item.items, depth + 1);
    }
  };
  addItems(outline, 0);
  ui.tocList.appendChild(frag);
}

interface FlatEntry { title: string; page: number; depth: number; end: number }
let structure: FlatEntry[] = []; // resolved outline (parts/sections/subsections), for the breadcrumb
async function buildSliderMarks(outline: PdfOutlineItem[]): Promise<void> {
  ui.sliderMarks.replaceChildren();
  ui.sliderSegs.replaceChildren();
  const total = state.pdf?.numPages || 0;
  if (total < 2) return;
  // Resolve the outline down to three levels (parts / sections / subsections), in
  // document order, keeping each entry's depth.
  const flat: FlatEntry[] = [];
  const walk = async (items: PdfOutlineItem[], depth: number): Promise<void> => {
    for (const item of items) {
      const page = await destPage(item.dest);
      if (page) flat.push({ title: tidyTitle(item.title), page, depth, end: total + 1 });
      if (item.items?.length && depth < 2) await walk(item.items, depth + 1);
    }
  };
  await walk(outline, 0);
  // Each entry runs until the next entry at the same-or-shallower depth begins.
  flat.forEach((f, i) => {
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].depth <= f.depth) { f.end = flat[j].page; break; }
    }
  });
  structure = flat;
  const pct = (p: number): number => ((Math.min(Math.max(1, p), total) - 1) / (total - 1)) * 100;

  // One tracker, three colour-coded lanes: parts (0), sections (1), subsections (2).
  const lanes = [0, 1, 2].map((depth) => {
    const lane = document.createElement("div");
    lane.className = `struct-lane lane-${depth}`;
    ui.sliderSegs.appendChild(lane);
    return lane;
  });
  const playhead = document.createElement("div");
  playhead.className = "struct-playhead";
  ui.sliderSegs.appendChild(playhead);
  flat.forEach((f) => {
    const lane = lanes[f.depth];
    if (!lane) return;
    const lastPage = Math.max(f.page, f.end - 1);
    const range = lastPage > f.page ? `p.${f.page}–${lastPage}` : `p.${f.page}`;
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "struct-seg";
    seg.dataset.page = String(f.page);
    seg.dataset.end = String(f.end);
    seg.style.left = `${pct(f.page)}%`;
    seg.style.width = `${Math.max(0.5, pct(Math.min(f.end, total)) - pct(f.page))}%`;
    seg.setAttribute("aria-label", `${f.title}, ${range}`);
    seg.addEventListener("mouseenter", () => showMarkTip(seg, `${f.title} · ${range}`));
    seg.addEventListener("mouseleave", hideMarkTip);
    seg.addEventListener("click", () => {
      hideMarkTip();
      void goToPage(f.page);
    });
    lane.appendChild(seg);
  });
  updateCurrentSection();
}

// The heading the current page falls into — shown as a live label and highlighted
// in each lane of the tracker.
const currentSectionEl = document.getElementById("currentSection");
function updateCurrentSection(): void {
  // Breadcrumb: the current heading at each level (part › section › subsection),
  // each colour-matched to its lane.
  const crumbs: string[] = [];
  for (const depth of [0, 1, 2]) {
    const here = structure.find((f) => f.depth === depth && state.page >= f.page && state.page < f.end);
    if (here) crumbs.push(`<span class="cr${depth}">${escapeHtml(here.title)}</span>`);
  }
  if (currentSectionEl) {
    currentSectionEl.hidden = crumbs.length === 0;
    currentSectionEl.innerHTML = crumbs.join('<span class="cr-sep">›</span>');
  }
  ui.sliderSegs.querySelectorAll<HTMLElement>(".struct-seg").forEach((seg) => {
    const start = Number(seg.dataset.page);
    const end = Number(seg.dataset.end);
    seg.classList.toggle("current", state.page >= start && state.page < end);
  });
  // Playhead line — cuts across all three lanes at the current page.
  const ph = ui.sliderSegs.querySelector<HTMLElement>(".struct-playhead");
  const total = state.pdf?.numPages || 1;
  if (ph) ph.style.left = `${((Math.min(Math.max(1, state.page), total) - 1) / Math.max(1, total - 1)) * 100}%`;
}

let markTip: HTMLDivElement | undefined;
function showMarkTip(mark: HTMLElement, text: string): void {
  if (!markTip) {
    markTip = document.createElement("div");
    markTip.className = "mark-tip";
    markTip.hidden = true;
    document.body.appendChild(markTip);
  }
  markTip.textContent = text;
  markTip.hidden = false;
  const r = mark.getBoundingClientRect();
  const x = Math.max(8, Math.min(window.innerWidth - markTip.offsetWidth - 8, r.left + r.width / 2 - markTip.offsetWidth / 2));
  markTip.style.left = `${x}px`;
  const above = r.top - markTip.offsetHeight - 8;
  markTip.style.top = `${above < 8 ? r.bottom + 8 : above}px`; // flip below if no room above
}
function hideMarkTip(): void {
  if (markTip) markTip.hidden = true;
}

async function destPage(dest: unknown): Promise<number | null> {
  if (!state.pdf) return null;
  try {
    const resolved = Array.isArray(dest) ? dest : await state.pdf.getDestination(dest as string);
    const ref = resolved?.[0];
    if (ref) return (await state.pdf.getPageIndex(ref)) + 1;
  } catch {
    /* ignore unresolved destinations */
  }
  return null;
}

function loadAnnotations(): void {
  try {
    const raw = localStorage.getItem(storageKey());
    state.annotations = raw ? (JSON.parse(raw) as unknown[]).filter(validAnnotation) : [];
  } catch {
    state.annotations = [];
  }
}

function saveAnnotations(): void {
  if (state.fileKey) localStorage.setItem(storageKey(), JSON.stringify(state.annotations));
}

// Render pages lazily: lay out sized placeholders immediately, render each
// page's canvas/text/links only when it scrolls near the viewport. This keeps
// opening a large document near-instant instead of rendering every page up front.
const pageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const box = entry.target as HTMLDivElement;
      pageObserver.unobserve(box);
      if (Number(box.dataset.renderId) === state.renderId) void renderPageContent(box, Number(box.dataset.page));
    }
  },
  { root: ui.viewer, rootMargin: "1200px 1200px" }
);

// Exact base size (scale 1, rotation-aware) of every page, cached once per document.
// Placeholders sized from this NEVER change when the real canvas later arrives, so the
// page layout never shifts under the viewport — which is what made zoom/scroll jump
// (never-rendered pages were guessed as page-1 shaped, then snapped to their real size
// as they scrolled into view, dragging everything below them). With exact placeholders
// the zoom re-centre lands perfectly and needs no browser scroll-anchoring help.
const pageDims = new Map<number, { w: number; h: number }>();
async function cachePageDims(): Promise<void> {
  if (!state.pdf) return;
  const pdf = state.pdf;
  pageDims.clear();
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    if (state.pdf !== pdf) return; // a newer document superseded this one
    const vp = pg.getViewport({ scale: 1 });
    pageDims.set(n, { w: vp.width, h: vp.height });
  }
}

async function renderPages(sizeHints?: Map<number, { w: number; h: number }>): Promise<void> {
  if (!state.pdf) return;
  const renderId = state.renderId + 1;
  state.renderId = renderId;
  pageObserver.disconnect();
  ui.pages.replaceChildren();
  state.pageReadItems.clear();
  applyTheme();
  // Page 1 sizes placeholders by default; on zoom, sizeHints carry each page's real
  // (proportionally-scaled) size so the layout doesn't collapse to uniform and jump.
  const first = await state.pdf.getPage(1);
  const vp = first.getViewport({ scale: state.scale });
  if (state.renderId !== renderId) return;
  const width = Math.floor(vp.width);
  const height = Math.floor(vp.height);
  const pageList = Array.from({ length: state.pdf.numPages }, (_, i) => i + 1);
  for (const pageNumber of pageList) {
    const box = document.createElement("div");
    box.className = `page pending ${state.theme}`;
    box.dataset.page = String(pageNumber);
    box.dataset.renderId = String(renderId);
    // Exact dims win: floor(base * scale) equals renderPageContent's floor(viewport.width),
    // so the real canvas arriving is a no-op resize (zero layout shift). sizeHints and the
    // page-1 fallback only cover the brief window before dims are cached.
    const dim = pageDims.get(pageNumber);
    const hint = sizeHints?.get(pageNumber);
    box.style.width = `${dim ? Math.floor(dim.w * state.scale) : hint ? Math.round(hint.w) : width}px`;
    box.style.height = `${dim ? Math.floor(dim.h * state.scale) : hint ? Math.round(hint.h) : height}px`;
    ui.pages.appendChild(box);
    pageObserver.observe(box);
  }
  applyTheme();
  updatePageControls();
  minimap.refreshViewport();
}

async function renderPageContent(pageBox: HTMLDivElement, pageNumber: number): Promise<void> {
  if (!state.pdf || pageBox.dataset.rendered === "1") return;
  pageBox.dataset.rendered = "1";
  try {
    const page = await state.pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.scale });
    // Canvas backing store at device pixel ratio so text stays crisp on retina.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: state.scale * dpr });
    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    await page.render({ canvasContext: canvas.getContext("2d", { alpha: false })!, viewport: renderViewport }).promise;
    if (Number(pageBox.dataset.renderId) !== state.renderId) return; // a newer render superseded this one
    pageBox.style.width = `${cssWidth}px`;
    pageBox.style.height = `${cssHeight}px`;
    pageBox.classList.remove("pending");
    const layer = document.createElement("div");
    layer.className = "anno-layer";
    layer.dataset.page = String(pageNumber);
    const textLayer = await buildTextLayer(page, viewport, pageNumber);
    pageBox.append(canvas, textLayer, await buildLinkLayer(page, viewport, state.pdf, goToLinkTarget, linkPreview ?? undefined), layer);
    updateLayerMode(layer);
    wireAnnotationDrawing(layer, pageNumber);
    renderAnnotations(layer);
  } catch (error) {
    console.warn(`Page ${pageNumber} failed to render`, error);
    pageBox.classList.remove("pending");
    pageBox.classList.add("placeholder");
    pageBox.textContent = `Page ${pageNumber} could not be rendered`;
  }
}

async function buildTextLayer(page: PdfPage, viewport: PdfViewport, pageNumber: number): Promise<HTMLDivElement> {
  const textLayer = document.createElement("div");
  textLayer.className = "text-layer";
  textLayer.dataset.page = String(pageNumber);
  const content = await page.getTextContent();
  content.items.forEach((item) => {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(tx[2], tx[3]);
    const span = document.createElement("span");
    span.textContent = item.str;
    Object.assign(span.style, {
      left: `${tx[4]}px`,
      top: `${tx[5] - fontSize}px`,
      fontSize: `${fontSize}px`,
      width: `${item.width * viewport.scale}px`
    });
    span.dataset.page = String(pageNumber);
    textLayer.appendChild(span);
  });
  const annoApi = makeAnnoApi();
  state.pageReadItems.set(
    pageNumber,
    addReadMarkers(
      pdfjsLib,
      textLayer,
      content,
      viewport,
      (items: ParagraphReadItem[], markerId: string) => readFromItems(pageNumber, items, markerId),
      (paragraph) => createParagraphTag(annoApi, textLayer, pageNumber, paragraph),
      (rects) => readingFocus.registerPage(pageNumber, textLayer, rects)
    )
  );
  textLayer.addEventListener("mouseup", () => handleTextSelection(textLayer));
  return textLayer;
}

function makeAnnoApi(): AnnoApi {
  return { state, saveAnnotations, renderAnnotations, renderAnnotationList, setStatus, openModal: () => annoModalCtl.open() };
}

function renderAnnotations(layer?: HTMLElement): void {
  const layers = layer ? [layer] : [...document.querySelectorAll<HTMLElement>(".anno-layer")];
  layers.forEach((target) => renderAnnotationLayer(target));
}

function renderAnnotationLayer(layer: HTMLElement): void {
  const pageNumber = Number(layer.dataset.page || state.page);
  layer.querySelectorAll(".anno").forEach((el) => el.remove());
  state.annotations
    .filter((a) => a.page === pageNumber)
    .forEach((anno) => {
      const boxes = anno.rects || [anno];
      boxes.forEach((box) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `anno ${anno.type}${anno.id === state.selectedId ? " active" : ""}`;
        el.dataset.annoId = anno.id;
        Object.assign(el.style, {
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`
        });
        el.style.setProperty("--anno-color", anno.color || "#ffd240");
        el.ariaLabel = anno.text || anno.quote || anno.type;
        el.addEventListener("mouseenter", (event) => showAnnoTip(anno, event));
        el.addEventListener("mousemove", positionAnnoTip);
        el.addEventListener("mouseleave", hideAnnoTip);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          hideAnnoTip();
          selectAnnotation(anno.id);
        });
        el.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          hideAnnoTip();
          selectAnnotation(anno.id);
          annoModalCtl.open(); // double-click opens the edit panel
        });
        layer.appendChild(el);
      });
    });
}

function wireAnnotationDrawing(layer: HTMLElement, pageNumber: number): void {
  let start: { x: number; y: number; rect: DOMRect } | null = null;
  let draft: HTMLDivElement | null = null;
  layer.addEventListener("pointerdown", (event) => {
    if (state.mode !== "note" || event.target !== layer) return;
    const rect = layer.getBoundingClientRect();
    start = { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
    draft = document.createElement("div");
    draft.className = "draft";
    layer.appendChild(draft);
    layer.setPointerCapture(event.pointerId);
  });
  layer.addEventListener("pointermove", (event) => {
    if (!start || !draft) return;
    drawDraft(draft, start.x, start.y, event.clientX - start.rect.left, event.clientY - start.rect.top);
  });
  layer.addEventListener("pointerup", (event) => {
    if (!start || !draft) return;
    const box = normalizedBox(start.x, start.y, event.clientX - start.rect.left, event.clientY - start.rect.top, start.rect);
    draft.remove();
    start = null;
    draft = null;
    if (box.w < 0.01 || box.h < 0.01) return;
    const now = new Date().toISOString();
    const anno: Annotation = {
      id: crypto.randomUUID(),
      type: state.mode,
      page: pageNumber,
      quote: "",
      text: "",
      color: state.color,
      createdAt: now,
      updatedAt: now,
      ...box
    };
    state.annotations.push(anno);
    selectAnnotation(anno.id);
    saveAnnotations();
    renderAnnotations(layer);
    renderAnnotationList();
    annoModalCtl.open();
  });
}

function drawDraft(el: HTMLElement, x1: number, y1: number, x2: number, y2: number): void {
  Object.assign(el.style, {
    left: `${Math.min(x1, x2)}px`,
    top: `${Math.min(y1, y2)}px`,
    width: `${Math.abs(x2 - x1)}px`,
    height: `${Math.abs(y2 - y1)}px`
  });
}

function normalizedBox(x1: number, y1: number, x2: number, y2: number, rect: DOMRect): Box {
  return {
    x: Math.max(0, Math.min(x1, x2) / rect.width),
    y: Math.max(0, Math.min(y1, y2) / rect.height),
    w: Math.min(1, Math.abs(x2 - x1) / rect.width),
    h: Math.min(1, Math.abs(y2 - y1) / rect.height)
  };
}

function selectAnnotation(id: string | null): void {
  state.selectedId = id;
  const anno = currentAnnotation();
  ui.noteText.disabled = !anno;
  ui.noteText.value = anno?.text || "";
  if (anno?.color) setSwatch(anno.color);
  ui.deleteAnno.disabled = !anno;
  if (anno) setStatus("Annotation selected — press E to edit, Delete to remove.");
  renderAnnotations();
  renderAnnotationList();
  if (anno) requestAnimationFrame(() => scrollAnnotationIntoView(anno.id));
}

// Bring the selected highlight into view on the page (not just its page top).
function scrollAnnotationIntoView(id: string): void {
  const el = document.querySelector<HTMLElement>(`.anno[data-anno-id="${CSS.escape(id)}"]`);
  if (!el) return;
  const er = el.getBoundingClientRect();
  const vr = ui.viewer.getBoundingClientRect();
  if (er.top < vr.top + 70 || er.bottom > vr.bottom - 70) {
    ui.viewer.scrollBy({ top: er.top - vr.top - vr.height * 0.35, behavior: "smooth" });
  }
}

// --- Grouping annotations by the document outline, and copy actions ---
const GROUP_KEY = "readitout:anno-group";
let annoGroupMode = localStorage.getItem(GROUP_KEY) ?? "0"; // "none" | "0" (section) | "1" (subsection)
const annoGroupSel = document.getElementById("annoGroupBy") as HTMLSelectElement | null;
if (annoGroupSel) {
  annoGroupSel.value = annoGroupMode;
  annoGroupSel.addEventListener("change", () => {
    annoGroupMode = annoGroupSel.value;
    localStorage.setItem(GROUP_KEY, annoGroupMode);
    renderAnnotationList();
  });
}

// The outline entry (at or above `depth`) whose page range contains this page.
function groupForPage(page: number, depth: number): FlatEntry | null {
  let best: FlatEntry | null = null;
  for (const f of structure) {
    if (f.depth <= depth && f.page <= page && page < f.end && (!best || f.page > best.page)) best = f;
  }
  return best;
}

function formatAnno(a: Annotation): string {
  const q = (a.quote || "").trim();
  const c = (a.text || "").trim();
  const head = q ? `“${q}” (p.${a.page})` : `(p.${a.page})`;
  return c ? `${head}\n${c}` : head;
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${label} to the clipboard.`);
  } catch {
    showError("Couldn't copy to the clipboard.");
  }
}

const COPY_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

function buildNoteItem(anno: Annotation): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `note-item${anno.id === state.selectedId ? " active" : ""}${anno.done ? " done" : ""}`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.style.setProperty("--anno-color", anno.color || "#ffd240");
  const quote = (anno.quote || "").trim();
  const quoteHtml = quote
    ? `<p class="quote">“${escapeHtml(quote.slice(0, 120))}${quote.length > 120 ? "…" : ""}”</p>`
    : `<p class="quote placeholder-text">Highlight</p>`;
  const feedback = anno.text?.trim();
  const feedbackHtml = feedback
    ? `<p class="note-comment">${escapeHtml(feedback)}</p>`
    : `<p class="note-comment placeholder-text">No feedback yet</p>`;
  const hashHtml = (anno.tags || []).length
    ? `<span class="note-hash">${(anno.tags as string[]).map((t) => `#${escapeHtml(t)}`).join(" ")}</span>`
    : "";
  item.innerHTML =
    `<div class="note-body">` +
    `<span class="note-ref"><span class="note-dot"></span>p.${anno.page}</span>` +
    `${quoteHtml}${feedbackHtml}${hashHtml}` +
    `<span class="note-kbd"><kbd>E</kbd> edit · <kbd>Del</kbd> remove</span></div>` +
    `<button type="button" class="note-copy" title="Copy this annotation" aria-label="Copy annotation">${COPY_SVG}</button>` +
    `<input type="checkbox" class="note-check" title="Mark done"${anno.done ? " checked" : ""}>`;

  const copyBtn = item.querySelector(".note-copy") as HTMLButtonElement;
  copyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyText(formatAnno(anno), "annotation");
  });

  const check = item.querySelector(".note-check") as HTMLInputElement;
  check.addEventListener("click", (event) => event.stopPropagation());
  check.addEventListener("change", () => {
    anno.done = check.checked;
    anno.updatedAt = new Date().toISOString();
    saveAnnotations();
    renderAnnotationList();
  });

  const select = async (): Promise<void> => {
    await goToPage(anno.page);
    selectAnnotation(anno.id);
  };
  item.addEventListener("click", () => void select());
  item.addEventListener("dblclick", () => annoModalCtl.open());
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void select();
    }
  });
  return item;
}

function renderAnnotationList(): void {
  ui.app.classList.toggle("has-annos", state.annotations.length > 0);
  minimap.render(); // keep the minimap's annotation lane in sync with every change
  if (!state.annotations.length) {
    ui.annoList.innerHTML =
      '<div class="empty"><span class="empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span><strong>No highlights yet</strong>Select text on the page to highlight it in the colour of your choice.</div>';
    updateDoneAll();
    return;
  }
  renderFilterColors();
  const query = annoFilter.query.trim().toLowerCase();
  const visible = state.annotations.filter((anno) => {
    if (annoFilter.color && anno.color !== annoFilter.color) return false;
    if (!query) return true;
    const hay = `${anno.quote || ""} ${anno.text || ""} ${(anno.tags || []).join(" ")}`.toLowerCase();
    return hay.includes(query);
  });
  if (!visible.length) {
    ui.annoList.innerHTML = '<div class="empty"><strong>No matches</strong>Try a different search or clear the colour filter.</div>';
    updateDoneAll();
    return;
  }
  const ordered = [...visible].sort((a, b) => a.page - b.page || (a.y || 0) - (b.y || 0));
  const depth = annoGroupMode === "none" ? null : Number(annoGroupMode);
  if (depth != null && structure.length) {
    // Bucket by the containing outline entry, in document order.
    const groups: { title: string; page: number; annos: Annotation[] }[] = [];
    const byKey = new Map<string, { title: string; page: number; annos: Annotation[] }>();
    for (const anno of ordered) {
      const g = groupForPage(anno.page, depth);
      const key = g ? `${g.page}:${g.depth}:${g.title}` : "~none";
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { title: g?.title ?? "Unsectioned", page: g?.page ?? Number.MAX_SAFE_INTEGER, annos: [] };
        byKey.set(key, bucket);
        groups.push(bucket);
      }
      bucket.annos.push(anno);
    }
    groups.sort((a, b) => a.page - b.page);
    const frag = document.createDocumentFragment();
    for (const grp of groups) {
      const header = document.createElement("div");
      header.className = "note-group";
      header.innerHTML =
        `<span class="note-group-title">${escapeHtml(grp.title)}</span>` +
        `<span class="note-group-count">${grp.annos.length}</span>` +
        `<button type="button" class="note-group-copy" title="Copy this section's annotations" aria-label="Copy section">${COPY_SVG}</button>`;
      (header.querySelector(".note-group-copy") as HTMLButtonElement).addEventListener("click", () => {
        const body = grp.annos.map(formatAnno).join("\n\n");
        void copyText(`${grp.title}\n\n${body}`, "section");
      });
      frag.appendChild(header);
      grp.annos.forEach((a) => frag.appendChild(buildNoteItem(a)));
    }
    ui.annoList.replaceChildren(frag);
  } else {
    ui.annoList.replaceChildren(...ordered.map(buildNoteItem));
  }
  updateDoneAll();
}

const annoFilter = { query: "", color: "" };
// Render the colour-filter dots from the colours actually in use.
function renderFilterColors(): void {
  const colors = [...new Set(state.annotations.map((a) => a.color))];
  ui.annoFilterColors.replaceChildren(
    ...colors.map((color) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `filter-dot${annoFilter.color === color ? " active" : ""}`;
      dot.style.setProperty("--c", color);
      dot.title = "Filter by this colour";
      dot.setAttribute("aria-pressed", String(annoFilter.color === color));
      dot.addEventListener("click", () => {
        annoFilter.color = annoFilter.color === color ? "" : color;
        renderAnnotationList();
      });
      return dot;
    })
  );
  ui.annoFilterColors.hidden = colors.length < 2;
}
ui.annoSearch.addEventListener("input", () => {
  annoFilter.query = ui.annoSearch.value;
  renderAnnotationList();
});

function updateDoneAll(): void {
  const total = state.annotations.length;
  const done = state.annotations.filter((a) => a.done).length;
  ui.doneAll.checked = total > 0 && done === total;
  ui.doneAll.indeterminate = done > 0 && done < total;
  ui.doneAll.disabled = total === 0;
  ui.deleteDone.hidden = done === 0;
}

const escapeHtml = (text: string): string =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

let annoTip: HTMLDivElement | undefined;
function annoTipEl(): HTMLDivElement {
  if (!annoTip) {
    annoTip = document.createElement("div");
    annoTip.className = "anno-tip";
    annoTip.hidden = true;
    document.body.appendChild(annoTip);
  }
  return annoTip;
}
function showAnnoTip(anno: Annotation, event: MouseEvent): void {
  const tip = annoTipEl();
  const quote = (anno.quote || "").trim();
  const comment = (anno.text || "").trim();
  const quoteHtml = quote ? `<em>“${escapeHtml(quote.length > 120 ? `${quote.slice(0, 120)}…` : quote)}”</em>` : "";
  // With a comment, the quoted line is redundant — just show the comment. Without one,
  // show the quoted text plus a hint to add a comment.
  tip.innerHTML = comment
    ? `<span>${escapeHtml(comment)}</span>`
    : `${quoteHtml}<span>No comment yet — click to add one</span>`;
  tip.hidden = false;
  positionAnnoTip(event);
}
function positionAnnoTip(event: MouseEvent): void {
  const tip = annoTipEl();
  const pad = 14;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + tip.offsetWidth > window.innerWidth - 8) x = event.clientX - tip.offsetWidth - pad;
  if (y + tip.offsetHeight > window.innerHeight - 8) y = event.clientY - tip.offsetHeight - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideAnnoTip(): void {
  if (annoTip) annoTip.hidden = true;
}

async function getPageText(pageNumber: number): Promise<string> {
  if (state.pageTexts.has(pageNumber)) return state.pageTexts.get(pageNumber)!;
  const page = await state.pdf!.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  state.pageTexts.set(pageNumber, text);
  return text;
}

async function readPages(from: number, to: number): Promise<void> {
  if (!state.pdf || state.reading) return;
  const chunks: ReadItem[] = [];
  for (let page = from; page <= to; page += 1) {
    const items = state.pageReadItems.get(page);
    if (items?.length) chunks.push(...items.flatMap((item) => chunkText(item.text, item)));
    else {
      const text = await getPageText(page);
      if (text) chunks.push(...chunkText(`Page ${page}. ${text}`, { page }));
    }
  }
  if (!chunks.length) {
    setStatus("No readable text found in this PDF range.");
    return;
  }
  state.chunks = chunks;
  state.reading = true;
  if (readingFocus.enabled()) setFocusMode(false, false); // audio takes over from the focus band
  updateDimButtonVisibility();
  updateSpotlight();
  setSpeechButtons(true);
  // Fired at the start of a listening session only. playCurrentQueue also runs
  // per chunk and on next/prev, which would otherwise flood the event.
  track("read_aloud_started", { mode: ui.readerMode.value, source: "range" });
  playCurrentQueue();
}

async function advancePage(): Promise<boolean> {
  if (!state.pdf) return false;
  let next = (state.readingPage || state.page) + 1;
  while (next <= state.pdf.numPages) {
    const items = state.pageReadItems.get(next);
    let chunks: ReadItem[];
    if (items?.length) chunks = items.flatMap((item) => chunkText(item.text, item));
    else {
      const text = await getPageText(next);
      chunks = text ? chunkText(`Page ${next}. ${text}`, { page: next }) : [];
    }
    if (chunks.length) {
      state.chunks = chunks;
      state.readingPage = next;
      state.page = next;
      updatePageControls();
      scrollPageIntoView(ui.viewer, next);
      return true;
    }
    next += 1;
  }
  return false;
}

function readFromItems(pageNumber: number, items: ParagraphReadItem[], markerId: string): void {
  if (state.activeMarker === markerId && state.reading) return toggleMarkerPause(markerId);
  stopReading("");
  state.page = pageNumber;
  state.activeMarker = markerId;
  state.chunks = items.flatMap((item) => chunkText(item.text, item));
  state.reading = true;
  if (readingFocus.enabled()) setFocusMode(false, false); // audio takes over from the focus band
  updateDimButtonVisibility();
  updateSpotlight();
  setSpeechButtons(true);
  setReadMarkerState(markerId, "loading");
  track("read_aloud_started", { mode: ui.readerMode.value, source: "paragraph" });
  playCurrentQueue();
}

function toggleMarkerPause(markerId: string): void {
  // Clicking while it's still loading means "cancel" — there's nothing to pause yet,
  // so stop and abort the outbound request rather than letting it play when it lands.
  if (state.activeReadState === "loading") {
    stopReading("Cancelled.");
    return;
  }
  const paused = state.audio ? state.audio.paused : speechSynthesis.paused;
  if (paused) ui.resumeRead.click();
  else ui.pauseRead.click();
  setReadMarkerState(markerId, paused ? "playing" : "paused");
}

function playCurrentQueue(): void {
  const api: PlaybackApi = {
    state, ui, setStatus, stopReading, speechRequest, activateReadItem, advancePage,
    onPlay: attachVisualizer, onError: showError
  };
  if (ui.readerMode.value === "premium") void playPremiumChunk(api);
  else playLocalChunk(api);
}

function activateReadItem(item: ReadItem, readState: ReadState = "playing"): void {
  if (item?.page) state.readingPage = item.page;
  activateReaderItem(ui, state, item, readState, updatePageControls);
  centerActiveRead();
}

// Keep the paragraph being read vertically centred in the viewport as reading advances.
function centerActiveRead(force = false): void {
  if (!state.activeMarker) return;
  const sel = CSS.escape(state.activeMarker);
  const target =
    document.querySelector<HTMLElement>(`.read-focus[data-marker-id="${sel}"]`) ||
    document.querySelector<HTMLElement>(`.read-marker[data-marker-id="${sel}"]`);
  if (!target) {
    // The reading page isn't rendered/visible yet — at least jump to it.
    if (force && state.readingPage) void goToPage(state.readingPage);
    return;
  }
  const viewerRect = ui.viewer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta = targetRect.top + targetRect.height / 2 - (viewerRect.top + viewerRect.height / 2);
  if (force || Math.abs(delta) > 8) ui.viewer.scrollBy({ top: delta, behavior: "smooth" });
}

function stopReading(message = "Read aloud stopped."): void {
  state.playToken += 1; // invalidate any in-flight playback
  state.playAbort?.abort(); // cancel any outbound TTS request so a late result can't play
  state.playAbort = null;
  speechSynthesis.cancel();
  if (state.audio) {
    state.audio.pause();
    URL.revokeObjectURL(state.audio.src);
  }
  state.audio = null;
  state.prefetch = null;
  state.prefetchItem = null;
  state.chunks = [];
  state.readHistory = [];
  state.currentReadItem = null;
  state.reading = false;
  updateDimButtonVisibility();
  updateSpotlight();
  state.activeMarker = null;
  state.readingPage = null;
  state.activeReadState = "idle";
  setReadMarkerState(null, "idle");
  setSpeechButtons(false);
  stopVisualizer();
  if (message) setStatus(message);
}

function setSpeechButtons(active: boolean): void {
  setReaderButtons(ui, state, active);
}


// Lobby intro player — greeting text + play button that reads a premium recording
// (or the browser voice as a fallback) with a live, audio-reactive wave.
initLobbyIntro();

// Selection popover: select text on a page → a toolbar with quick highlight
// colours, Note, Copy and Read-from-here.
const HL_PALETTE = ["#ffd240", "#72d6a3", "#7db7ff", "#ff8f8a", "#b99cff"];
// Selection is captured up front (geometry + text) because focusing the popover's
// note field clears the live DOM selection — the committed highlight uses this.
let pendingSel: { textLayer: HTMLElement; page: number; text: string; rects: Box[]; top: number } | null = null;
function commitSelection(color: string, text: string): void {
  if (pendingSel) {
    addHighlightWithText(makeAnnoApi(), pendingSel.page, pendingSel.text, pendingSel.rects, color, text);
    // No highlighted text or note body, only whether a note was attached.
    track("annotation_created", { has_note: text.trim().length > 0 });
  }
  pendingSel = null;
  window.getSelection()?.removeAllRanges();
  selPopover.hide();
}
const selPopover = createSelectionPopover(HL_PALETTE, {
  onSubmit: (color, text) => commitSelection(color, text),
  onEdit: (color, text) => {
    commitSelection(color, text);
    if (state.selectedId) annoModalCtl.open();
  },
  onCopy: () => {
    if (pendingSel?.text) void navigator.clipboard?.writeText(pendingSel.text).catch(() => {});
    setStatus("Copied selection.");
    pendingSel = null;
    window.getSelection()?.removeAllRanges();
    selPopover.hide();
  },
  onListen: () => {
    listenFromSelection();
    selPopover.hide();
  }
});
function handleTextSelection(textLayer: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !textLayer.contains(sel.anchorNode)) {
    selPopover.hide();
    pendingSel = null;
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width < 2 && rect.height < 2) {
    selPopover.hide();
    return;
  }
  const pageRect = textLayer.getBoundingClientRect();
  const text = sel.toString().replace(/\s+/g, " ").trim();
  // The browser reports a selection at the font's full line-box, which is taller than the
  // glyphs (leading above and below) — so a highlight drawn from it sits low, off the text.
  // Snap each rect's vertical extent to the covering text span's tight glyph box (the spans
  // are line-height:1, so their box == the letters) and keep the selection's left/width.
  const spans = [...textLayer.querySelectorAll<HTMLElement>("span")].map((s) => s.getBoundingClientRect());
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 2 && r.height > 2)
    .map((r) => {
      const cy = r.top + r.height / 2;
      const g = spans.find((b) => cy >= b.top && cy <= b.bottom && r.left < b.right && r.right > b.left);
      const top = g ? g.top : r.top;
      const h = g ? g.height : r.height;
      return {
        x: (r.left - pageRect.left) / pageRect.width,
        y: (top - pageRect.top) / pageRect.height,
        w: r.width / pageRect.width,
        h: h / pageRect.height
      };
    });
  if (!text || !rects.length) {
    selPopover.hide();
    pendingSel = null;
    return;
  }
  pendingSel = { textLayer, page: Number(textLayer.dataset.page), text, rects, top: rect.top };
  selPopover.showAt(rect, state.color);
}
// "Read from here" — start narration from the paragraph the selection begins in.
// Uses the captured selection (the live one is gone once the note field focuses).
function listenFromSelection(): void {
  if (!pendingSel) return;
  const top = pendingSel.top;
  const markers = [...pendingSel.textLayer.querySelectorAll<HTMLElement>(".read-marker")];
  let best: HTMLElement | null = null;
  let bestTop = -Infinity;
  markers.forEach((marker) => {
    const mt = marker.getBoundingClientRect().top;
    if (mt <= top + 6 && mt > bestTop) { bestTop = mt; best = marker; }
  });
  (best ?? markers[0])?.click();
  pendingSel = null;
  window.getSelection()?.removeAllRanges();
}
document.addEventListener("mousedown", (event) => {
  if (selPopover.visible() && !selPopover.contains(event.target as Node)) selPopover.hide();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") selPopover.hide();
});

// Copy buttons on the local-server setup commands.
document.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".cmd-copy");
  if (!btn) return;
  const code = btn.parentElement?.querySelector("code");
  if (!code) return;
  void navigator.clipboard?.writeText(code.textContent || "").then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    btn.classList.add("copied");
    window.setTimeout(() => { btn.innerHTML = original; btn.classList.remove("copied"); }, 1300);
  }).catch(() => {});
});

// Two-lane minimap (chapter structure + annotations) down the right edge.
const minimap = createMinimap({
  root: document.getElementById("minimap") as HTMLElement,
  viewer: ui.viewer,
  total: () => state.pdf?.numPages || 0,
  annotations: () => state.annotations.map((a) => {
    const feedback = a.text?.trim();
    const quote = (a.quote || "").trim();
    const gist = feedback || quote || "Highlight";
    return {
      id: a.id, page: a.page, y: a.y, color: a.color || "#ffd240",
      label: `p.${a.page} · ${gist.slice(0, 80)}${gist.length > 80 ? "…" : ""}`
    };
  }),
  jumpToAnnotation: (id) => {
    const anno = state.annotations.find((a) => a.id === id);
    if (anno) void goToPage(anno.page).then(() => selectAnnotation(anno.id));
  },
  jumpToFraction: (frac) => {
    const range = ui.viewer.scrollHeight - ui.viewer.clientHeight;
    ui.viewer.scrollTop = Math.max(0, frac * range); // instant so dragging tracks the pointer
  },
  tip: (target, text) => showMarkTip(target, text),
  hideTip: hideMarkTip
});

ui.pdfInput.addEventListener("change", () => {
  const file = ui.pdfInput.files?.[0];
  if (file) void openPdf(file); // start the load (captures the file) before clearing the input
  ui.pdfInput.value = ""; // reset so the same (or a new) file can be re-picked while one is open
});
ui.welcomeOpen.addEventListener("click", () => ui.pdfInput.click());
ui.welcome.addEventListener("dragover", (event) => {
  event.preventDefault();
  ui.welcome.classList.add("dragging");
});
ui.welcome.addEventListener("dragleave", () => ui.welcome.classList.remove("dragging"));
ui.welcome.addEventListener("drop", (event) => {
  event.preventDefault();
  ui.welcome.classList.remove("dragging");
  openPdf(event.dataTransfer?.files?.[0]);
});
ui.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  ui.dropZone.classList.add("dragging");
});
ui.dropZone.addEventListener("dragleave", () => ui.dropZone.classList.remove("dragging"));
ui.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  ui.dropZone.classList.remove("dragging");
  openPdf(event.dataTransfer?.files?.[0]);
});
ui.prevPage.addEventListener("click", () => goToPage(state.page - 1));
ui.nextPage.addEventListener("click", () => goToPage(state.page + 1));
let scrubbing = false;
ui.pageSlider.addEventListener("pointerdown", () => { scrubbing = true; });
ui.pageSlider.addEventListener("pointerup", () => { scrubbing = false; });
ui.pageSlider.addEventListener("change", () => { scrubbing = false; });
ui.pageSlider.addEventListener("input", () => goToPage(Number(ui.pageSlider.value)));
// Layout is continuous-only now (single/two-page/horizontal removed).
// App appearance: auto (follow OS) / light / dark, persisted and applied to <html>.
const APPEARANCE_KEY = "readitout:appearance";
type Appearance = "auto" | "light" | "dark";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
function applyAppearance(pref: Appearance): void {
  localStorage.setItem(APPEARANCE_KEY, pref);
  const dark = pref === "dark" || (pref === "auto" && darkMedia.matches);
  ui.appearanceTabs.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.appearance === pref)
  );
  // Light/dark is just the matching colour scheme. Routing Appearance through setScheme
  // keeps ONE source of truth for data-theme, so the two controls can't overwrite each
  // other (which is why picking Sepia/Contrast appeared to do nothing).
  setScheme(dark ? "dark" : "normal");
}
// At load, only reflect the saved appearance on the tabs — the actual theme is applied by
// the colour-scheme restore below (single writer of data-theme).
{
  const savedAppearance = (localStorage.getItem(APPEARANCE_KEY) as Appearance | null) || "dark";
  ui.appearanceTabs.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.appearance === savedAppearance)
  );
}
darkMedia.addEventListener("change", () => {
  // Re-resolve only while following the system setting.
  if ((localStorage.getItem(APPEARANCE_KEY) || "auto") === "auto") applyAppearance("auto");
});
ui.appearanceTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-appearance]");
  if (button) applyAppearance(button.dataset.appearance as Appearance);
});
// Lobby light/dark toggle: flip to the opposite of whatever is currently showing.
document.getElementById("lobbyTheme")?.addEventListener("click", () => {
  applyAppearance(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

// App theme preset: Editorial (the base palette) / Mono / Soft / Glass. This is
// independent of light/dark mode — each preset ships both — and only swaps the
// chrome token set on <html>. Persisted; the head script applies it pre-paint.
const PRESET_KEY = "readitout:preset";
type Preset = "aurora" | "terracotta" | "honey" | "rose" | "ocean" | "forest" | "slate";
function applyPreset(preset: Preset): void {
  localStorage.setItem(PRESET_KEY, preset);
  document.documentElement.dataset.preset = preset;
  ui.presetTiles.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) =>
    b.classList.toggle("active", b.dataset.preset === preset)
  );
}
const PRESETS: Preset[] = ["aurora", "terracotta", "honey", "rose", "ocean", "forest", "slate"];
const savedPreset = localStorage.getItem(PRESET_KEY) as Preset | null;
applyPreset(savedPreset && PRESETS.includes(savedPreset) ? savedPreset : "aurora");
// Hover a tile to preview that theme live; leaving restores the saved one.
let previewRestore: string | null = null;
ui.presetTiles.addEventListener("pointerover", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-preset]");
  if (!button) return;
  if (previewRestore === null) previewRestore = document.documentElement.dataset.preset ?? "terracotta";
  document.documentElement.dataset.preset = button.dataset.preset as string;
});
ui.presetTiles.addEventListener("pointerleave", () => {
  if (previewRestore !== null) {
    document.documentElement.dataset.preset = previewRestore;
    previewRestore = null;
  }
});
ui.presetTiles.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-preset]");
  if (button) {
    applyPreset(button.dataset.preset as Preset);
    previewRestore = null; // commit — don't revert on pointerleave
  }
});

// Speed as a stepper chip in the player pill: click cycles common speeds.
// The fine slider lives in the Listen panel; both drive the same #rate input.
const RATE_STEPS = [0.8, 1, 1.2, 1.4, 1.6];
ui.playerRateValue.setAttribute("role", "button");
ui.playerRateValue.setAttribute("tabindex", "0");
ui.playerRateValue.title = "Playback speed — click to change";
function cycleRate(): void {
  const cur = Number(ui.playerRate.value);
  const idx = RATE_STEPS.findIndex((v) => v >= cur - 0.001);
  const next = RATE_STEPS[(idx + 1) % RATE_STEPS.length];
  ui.playerRate.value = String(next);
  ui.playerRate.dispatchEvent(new Event("input"));
}
ui.playerRateValue.addEventListener("click", cycleRate);
ui.playerRateValue.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleRate(); }
});

// ---- Command palette (⌘K / Ctrl+K) -----------------------------
const CMDK_ICON: Record<string, string> = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.1v13.8a1 1 0 0 0 1.53.85l11-6.9a1 1 0 0 0 0-1.7l-11-6.9A1 1 0 0 0 8 5.1Z"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};
interface Cmd { label: string; tag: string; icon: string; run: () => void; }
function cmdkCommands(query: string): Cmd[] {
  const q = query.trim();
  const n = Number(q);
  if (q && Number.isInteger(n) && n > 0) {
    return [{ label: `Go to page ${n}`, tag: "Jump", icon: "page", run: () => void goToPage(n) }];
  }
  const all: Cmd[] = [
    { label: "Read this page", tag: "Listen", icon: "play", run: () => ui.readPage.click() },
    { label: "Read whole document", tag: "Listen", icon: "play", run: () => ui.readAll.click() },
    { label: "Toggle focus line", tag: "Read", icon: "tool", run: () => ui.focusToggle.click() },
    { label: "Open a PDF", tag: "File", icon: "tool", run: () => ui.pdfInput.click() },
    { label: "Next page", tag: "Navigate", icon: "page", run: () => void goToPage(state.page + 1) },
    { label: "Previous page", tag: "Navigate", icon: "page", run: () => void goToPage(state.page - 1) },
    ...PRESETS.map((p) => ({ label: `Theme: ${p[0].toUpperCase()}${p.slice(1)}`, tag: "Theme", icon: "theme", run: () => applyPreset(p) })),
    { label: "Appearance: Light", tag: "Theme", icon: "theme", run: () => applyAppearance("light") },
    { label: "Appearance: Dark", tag: "Theme", icon: "theme", run: () => applyAppearance("dark") },
    { label: "Appearance: Auto", tag: "Theme", icon: "theme", run: () => applyAppearance("auto") },
  ];
  const ql = q.toLowerCase();
  return ql ? all.filter((c) => c.label.toLowerCase().includes(ql)) : all;
}
let cmdkSel = 0;
let cmdkCurrent: Cmd[] = [];
function setCmdkSel(i: number): void {
  cmdkSel = i;
  const items = ui.cmdkList.querySelectorAll<HTMLElement>(".cmdk-item");
  items.forEach((el, idx) => el.classList.toggle("sel", idx === i));
  items[i]?.scrollIntoView({ block: "nearest" });
}
function renderCmdk(): void {
  cmdkCurrent = cmdkCommands(ui.cmdkInput.value);
  if (!cmdkCurrent.length) { ui.cmdkList.innerHTML = '<div class="cmdk-empty">No matching actions</div>'; return; }
  ui.cmdkList.replaceChildren(...cmdkCurrent.map((c, i) => {
    const row = document.createElement("div");
    row.className = "cmdk-item" + (i === 0 ? " sel" : "");
    row.setAttribute("role", "option");
    row.innerHTML = `<span class="cmdk-ico">${CMDK_ICON[c.icon]}</span><span class="cmdk-label"></span><span class="cmdk-tag"></span>`;
    row.querySelector(".cmdk-label")!.textContent = c.label;
    row.querySelector(".cmdk-tag")!.textContent = c.tag;
    row.addEventListener("mousemove", () => setCmdkSel(i));
    row.addEventListener("click", () => runCmdk(i));
    return row;
  }));
  cmdkSel = 0;
}
function runCmdk(i: number): void { const c = cmdkCurrent[i]; closeCmdk(); if (c) c.run(); }
function openCmdk(): void {
  ui.cmdk.hidden = false;
  ui.cmdkInput.value = "";
  renderCmdk();
  requestAnimationFrame(() => ui.cmdkInput.focus());
}
function closeCmdk(): void { ui.cmdk.hidden = true; }
ui.cmdkInput.addEventListener("input", renderCmdk);
ui.cmdkInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setCmdkSel(Math.min(cmdkSel + 1, cmdkCurrent.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setCmdkSel(Math.max(cmdkSel - 1, 0)); }
  else if (e.key === "Enter") { e.preventDefault(); runCmdk(cmdkSel); }
  else if (e.key === "Escape") { e.preventDefault(); closeCmdk(); }
});
ui.cmdk.addEventListener("click", (e) => { if (e.target === ui.cmdk) closeCmdk(); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    if (ui.cmdk.hidden) openCmdk(); else closeCmdk();
  }
});

// ---- Reading focus band + page dimming --------------------------------------
const FOCUS_KEY = "readitout:focus";
const FOCUS_DIM_KEY = "readitout:focus-dim";
// Focus band and audio narration are mutually exclusive: turning one on turns the
// other off. `persist` is false when audio disables focus, so the saved preference survives.
function setFocusMode(next: boolean, persist = true): void {
  if (next && state.reading) stopReading();
  readingFocus.setEnabled(next);
  if (persist) localStorage.setItem(FOCUS_KEY, String(next));
  ui.focusToggle.classList.toggle("focus-on", next);
  ui.focusToggle.setAttribute("aria-pressed", String(next));
  updateDimButtonVisibility();
  syncDimButton();
  updateSpotlight();
}
function toggleFocus(): void {
  setFocusMode(!readingFocus.enabled());
}
let focusDim = localStorage.getItem(FOCUS_DIM_KEY) !== "false";
readingFocus.setDim(focusDim);
ui.app.classList.toggle("focus-dim", focusDim);
function toggleFocusDim(): void {
  focusDim = !focusDim;
  localStorage.setItem(FOCUS_DIM_KEY, String(focusDim));
  readingFocus.setDim(focusDim);
  ui.app.classList.toggle("focus-dim", focusDim);
  syncDimButton();
  updateSpotlight();
}
function syncDimButton(): void {
  ui.dimToggle.classList.toggle("focus-on", focusDim);
  ui.dimToggle.setAttribute("aria-pressed", String(focusDim));
}
// Dimming applies both in focus mode and while narrating, so surface the control in both.
function updateDimButtonVisibility(): void {
  ui.dimToggle.hidden = !(readingFocus.enabled() || state.reading);
}
// Spotlight = dim every page, only while a highlight is actually active (focus or reading).
function updateSpotlight(): void {
  ui.app.classList.toggle("spotlight", focusDim && (readingFocus.enabled() || state.reading));
}
ui.focusToggle.addEventListener("click", toggleFocus);
ui.dimToggle.addEventListener("click", toggleFocusDim);
// Click a line to move the band there (unless a text selection is in progress).
ui.viewer.addEventListener("click", (event) => {
  if (!readingFocus.enabled() || state.reading) return;
  if (!(window.getSelection()?.isCollapsed ?? true)) return;
  const page = (event.target as HTMLElement).closest<HTMLElement>(".page")?.dataset.page;
  if (page) readingFocus.focusAtPoint(Number(page), event.clientY);
});
if (localStorage.getItem(FOCUS_KEY) === "true") setFocusMode(true);

ui.viewToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = ui.app.querySelector(".view-options")!.classList.toggle("open");
  ui.viewToggle.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
  const opts = ui.app.querySelector(".view-options");
  if (opts?.classList.contains("open") && !opts.contains(event.target as Node)) {
    opts.classList.remove("open");
    ui.viewToggle.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    ui.app.querySelector(".view-options")?.classList.remove("open");
    ui.viewToggle.setAttribute("aria-expanded", "false");
    if (readingFocus.enabled() && !state.reading) setFocusMode(false); // exit focus band
  }
});
ui.zoom.addEventListener("change", () => {
  const v = ui.zoom.value;
  if (v === "fit-width" || v === "fit-page") { zoomMode = v; void applyFit(); }
  else { zoomMode = "fixed"; void setZoom(Number(v)); }
});
ui.zoomOut.addEventListener("click", () => { zoomMode = "fixed"; setZoom(Math.max(0.6, state.scale - 0.15)); });
ui.zoomIn.addEventListener("click", () => { zoomMode = "fixed"; setZoom(Math.min(3, state.scale + 0.15)); });

// Trackpad pinch-to-zoom (arrives as ctrl+wheel). The +/- buttons go through setZoom's
// centre-anchored re-render and work flawlessly, so pinch just funnels into the exact
// same path — no live CSS transform, no separate commit step, nothing to drift. We
// accumulate the gesture's deltas into a target scale and let setZoom's own coalescing
// (zoomBusy/pendingZoom) throttle the re-renders.
let pinchTarget = 0;
let pinchRaf = 0;
ui.viewer.addEventListener("wheel", (event) => {
  if (!event.ctrlKey || !state.pdf) return;
  event.preventDefault(); // otherwise the browser zooms the whole page
  const base = pinchTarget || state.scale;
  const d = Math.max(-24, Math.min(24, event.deltaY));
  pinchTarget = Math.max(0.6, Math.min(3, base * Math.exp(-d * 0.01)));
  zoomMode = "fixed";
  if (pinchRaf) return;
  pinchRaf = requestAnimationFrame(() => {
    pinchRaf = 0;
    const t = pinchTarget;
    pinchTarget = 0;
    void setZoom(t); // same centre-anchored path as the buttons
  });
}, { passive: false });
const lobbySchemes = document.getElementById("lobbySchemes");
const introDoc = document.getElementById("introDoc");
const SCHEME_KEY = "readitout:scheme";
// Each reading scheme is a whole-app theme (drives the root data-theme).
// Scheme → whole-app appearance. Sepia is the DARK chrome with a sepia-toned page, so it
// maps to data-theme="dark" (only the page/viewer .sepia classes differ). This also lets
// every scheme inherit the accent presets automatically.
const APP_THEME_FOR: Record<string, string> = { normal: "light", sepia: "dark", dark: "dark" };
function setScheme(scheme: string, persist = true): void {
  ui.theme.value = scheme;
  state.theme = scheme as AppState["theme"];
  document.documentElement.dataset.theme = APP_THEME_FOR[scheme] ?? "light"; // re-theme the whole page
  ui.themePreviews.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.theme === scheme));
  lobbySchemes?.querySelectorAll<HTMLElement>(".scheme-dot").forEach((b) => b.classList.toggle("active", b.dataset.theme === scheme));
  introDoc?.classList.remove("scheme-normal", "scheme-sepia", "scheme-dark");
  introDoc?.classList.add(`scheme-${scheme}`);
  if (persist) localStorage.setItem(SCHEME_KEY, scheme);
  applyTheme();
}
// Restore the saved whole-app scheme, else derive it from the current appearance.
const savedScheme = localStorage.getItem(SCHEME_KEY);
setScheme(
  savedScheme && ["normal", "sepia", "dark"].includes(savedScheme)
    ? savedScheme
    : document.documentElement.dataset.theme === "dark" ? "dark" : "normal",
  false
);
ui.theme.addEventListener("change", () => setScheme(ui.theme.value));
ui.themePreviews.addEventListener("click", (event) => {
  const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-theme]");
  if (tile) setScheme(tile.dataset.theme as string);
});
// Lobby: pick the reading color scheme up front, one click.
lobbySchemes?.addEventListener("click", (event) => {
  const dot = (event.target as HTMLElement).closest<HTMLElement>(".scheme-dot");
  if (dot) setScheme(dot.dataset.theme as string);
});
ui.toggleAnnoPanel.addEventListener("click", () => {
  const hidden = ui.app.classList.toggle("annotations-hidden");
  localStorage.setItem("pdf-reader-hide-annotations", String(hidden));
});
ui.annoTab.addEventListener("click", () => {
  ui.app.classList.remove("annotations-hidden");
  localStorage.setItem("pdf-reader-hide-annotations", "false");
});
ui.highlightMode.addEventListener("click", () => {
  state.mode = "highlight";
  ui.highlightMode.className = "primary";
  updateAnnotationMode();
});
ui.annoColor.addEventListener("click", (event) => {
  const swatch = (event.target as HTMLElement).closest<HTMLElement>(".swatch");
  if (!swatch) return;
  setSwatch(swatch.dataset.color as string);
  const anno = currentAnnotation();
  if (!anno) return;
  anno.color = state.color;
  anno.updatedAt = new Date().toISOString();
  saveAnnotations();
  updateAnnotationColor(anno);
  renderAnnotationList();
});
ui.noteText.addEventListener("input", () => {
  const anno = currentAnnotation();
  if (!anno) return;
  anno.text = ui.noteText.value;
  anno.updatedAt = new Date().toISOString();
  saveAnnotations();
  renderAnnotationList();
});
ui.deleteAnno.addEventListener("click", deleteSelectedAnnotation);
ui.doneAll.addEventListener("change", () => {
  const done = ui.doneAll.checked;
  const now = new Date().toISOString();
  state.annotations.forEach((anno) => {
    anno.done = done;
    anno.updatedAt = now;
  });
  saveAnnotations();
  renderAnnotationList();
});
ui.deleteDone.addEventListener("click", () => {
  const doneCount = state.annotations.filter((a) => a.done).length;
  if (!doneCount) return;
  if (!window.confirm(`Delete ${doneCount} annotation${doneCount > 1 ? "s" : ""} marked done?`)) return;
  const removedSelected = state.annotations.some((a) => a.done && a.id === state.selectedId);
  state.annotations = state.annotations.filter((a) => !a.done);
  if (removedSelected) state.selectedId = null;
  hideAnnoTip();
  saveAnnotations();
  renderAnnotations();
  renderAnnotationList();
  setStatus(`Deleted ${doneCount} completed annotation${doneCount > 1 ? "s" : ""}.`);
});

document.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName || "";
  // Spacebar always toggles play/pause (unless typing). preventDefault stops it
  // from also re-activating a focused button — e.g. the ▶ marker that started
  // reading, which would otherwise jump back to that paragraph.
  if ((event.code === "Space" || event.key === " ") && !["INPUT", "TEXTAREA", "SELECT"].includes(tag) && state.pdf) {
    event.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    ui.playerPlay.click();
    return;
  }
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  // F focuses the line nearest the viewport centre (enabling the band if needed);
  // pressing it again turns the band off. D toggles page dimming — during focus OR
  // while narrating (the dim button is shown in both).
  if ((event.key === "f" || event.key === "F") && state.pdf && !state.reading) {
    event.preventDefault();
    // Always grab the line nearest the viewport centre and centre it in view (turn the
    // band off from the reader-bar Focus button or Escape). Pressing F again re-grabs.
    if (!readingFocus.enabled()) setFocusMode(true);
    const vr = ui.viewer.getBoundingClientRect();
    readingFocus.focusAtPoint(visiblePage(ui.viewer, state.page), vr.top + vr.height / 2, "center");
    return;
  }
  if ((event.key === "d" || event.key === "D") && (readingFocus.enabled() || state.reading)) {
    event.preventDefault();
    toggleFocusDim();
    return;
  }
  // Up/Down move the focus band (when on and not narrating), otherwise scroll.
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && state.pdf) {
    event.preventDefault();
    if (readingFocus.enabled() && !state.reading) readingFocus.move(event.key === "ArrowDown" ? 1 : -1);
    else ui.viewer.scrollBy({ top: event.key === "ArrowDown" ? 130 : -130 });
    return;
  }
  // While reading: arrows move between lines, E captures a note for the current line.
  if (state.reading) {
    if (event.key === "ArrowRight") { event.preventDefault(); ui.playerNext.click(); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); ui.playerPrev.click(); return; }
    if (event.key === "e" || event.key === "E") { event.preventDefault(); openQuickNote(); return; }
  }
  // In focus mode, E annotates the focused line (same as E while reading).
  if (readingFocus.enabled() && (event.key === "e" || event.key === "E")) {
    event.preventDefault();
    openQuickNote();
    return;
  }
  if (!state.selectedId) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedAnnotation();
  } else if (event.key === "e" || event.key === "E") {
    event.preventDefault();
    annoModalCtl.open();
  }
});

function openQuickNote(): void {
  if (!state.activeMarker && !readingFocus.current()) {
    setStatus("No line is active yet.");
    return;
  }
  ui.quickNote.hidden = false;
  ui.quickNoteInput.value = "";
  ui.quickNoteInput.focus();
}

ui.quickNoteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const text = ui.quickNoteInput.value.trim();
    if (text) {
      if (state.reading && state.activeMarker) annotateCurrentLine(text);
      else annotateFocusLine(text);
    }
    ui.quickNote.hidden = true;
    ui.quickNoteInput.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    ui.quickNote.hidden = true;
    ui.quickNoteInput.blur();
  }
});

// Create a highlight over the line/paragraph currently being read, with the typed note.
function annotateCurrentLine(comment: string): void {
  const markerId = state.activeMarker;
  if (!markerId) return;
  const page = state.currentReadItem?.page ?? state.page;
  const layer = document.querySelector<HTMLElement>(`.anno-layer[data-page="${page}"]`);
  const focuses = [...document.querySelectorAll<HTMLElement>(`.read-focus[data-marker-id="${CSS.escape(markerId)}"]`)];
  if (!layer || !focuses.length) {
    setStatus("Couldn't locate the current line.");
    return;
  }
  const base = layer.getBoundingClientRect();
  const rects: Box[] = focuses.map((focus) => {
    const r = focus.getBoundingClientRect();
    return { x: (r.left - base.left) / base.width, y: (r.top - base.top) / base.height, w: r.width / base.width, h: r.height / base.height };
  });
  const now = new Date().toISOString();
  const anno: Annotation = {
    id: crypto.randomUUID(),
    type: "highlight",
    page,
    quote: state.currentReadItem?.text ?? "",
    text: comment,
    color: state.color,
    createdAt: now,
    updatedAt: now,
    ...rects[0],
    rects
  };
  state.annotations.push(anno);
  saveAnnotations();
  renderAnnotations();
  renderAnnotationList();
  setStatus("Added note to the current line.");
}

// Create a highlight over the line the focus band is on, with the typed note.
function annotateFocusLine(comment: string): void {
  const target = readingFocus.current();
  if (!target) {
    setStatus("No focused line.");
    return;
  }
  const layer = document.querySelector<HTMLElement>(`.anno-layer[data-page="${target.page}"]`);
  if (!layer) {
    setStatus("Couldn't locate the focused line.");
    return;
  }
  const base = layer.getBoundingClientRect();
  const r = target.band.getBoundingClientRect();
  const box: Box = {
    x: (r.left - base.left) / base.width,
    y: (r.top - base.top) / base.height,
    w: r.width / base.width,
    h: r.height / base.height
  };
  const now = new Date().toISOString();
  const anno: Annotation = {
    id: crypto.randomUUID(),
    type: "highlight",
    page: target.page,
    quote: target.text,
    text: comment,
    color: state.color,
    createdAt: now,
    updatedAt: now,
    ...box,
    rects: [box]
  };
  state.annotations.push(anno);
  saveAnnotations();
  renderAnnotations();
  renderAnnotationList();
  setStatus("Added note to the focused line.");
}

function deleteSelectedAnnotation(): void {
  state.annotations = state.annotations.filter((a) => a.id !== state.selectedId);
  hideAnnoTip(); // the hovered element is gone, so mouseleave won't fire — clear the tooltip
  selectAnnotation(null);
  saveAnnotations();
  renderAnnotations();
  renderAnnotationList();
}

ui.exportAnno.addEventListener("click", () => {
  downloadText("pdf-annotations.json", JSON.stringify(annotationPayload(state, ui), null, 2), "application/json");
});
ui.importAnnoButton.addEventListener("click", () => ui.importAnno.click());
ui.importAnno.addEventListener("change", async () => {
  const file = ui.importAnno.files?.[0];
  if (!file || !file.name.endsWith(".json")) {
    showError("Choose a JSON annotation file.");
    return;
  }
  let parsed: { annotations?: unknown[] };
  try {
    parsed = JSON.parse(await file.text()) as { annotations?: unknown[] };
  } catch {
    showError("That file isn't valid JSON.");
    return;
  }
  if (!Array.isArray(parsed.annotations) || !parsed.annotations.every(validAnnotation)) {
    showError("Invalid annotation JSON — no valid annotations found.");
    return;
  }
  state.annotations = parsed.annotations as Annotation[];
  saveAnnotations();
  await renderPages();
  renderAnnotationList();
  setStatus("Imported annotations.");
});
ui.copyCodex.addEventListener("click", async () => {
  await navigator.clipboard.writeText(await collaborationMarkdown(state, ui, getPageText));
  setStatus("Copied feedback for an LLM.");
});
ui.exportMarkdown.addEventListener("click", async () => {
  downloadText("pdf-annotations.md", await collaborationMarkdown(state, ui, getPageText), "text/markdown");
});
ui.readPage.addEventListener("click", () => {
  state.page = visiblePage(ui.viewer, state.page);
  updatePageControls();
  void readPages(state.page, state.page);
});
ui.readAll.addEventListener("click", () => void readPages(1, state.pdf!.numPages));
ui.gotoRead.addEventListener("click", () => {
  if (state.activeMarker) centerActiveRead(true); // jump to & centre the paragraph being read
});
ui.pauseRead.addEventListener("click", () => {
  // No audio yet (still fetching) → pause can't hold it; cancel the load instead.
  if (state.activeReadState === "loading") {
    stopReading("Cancelled.");
    return;
  }
  if (state.audio) state.audio.pause();
  speechSynthesis.pause();
  state.activeReadState = "paused";
  if (state.activeMarker) setReadMarkerState(state.activeMarker, "paused");
  syncReaderPlayer(ui, state);
  setStatus("Read aloud paused.");
});
ui.resumeRead.addEventListener("click", () => {
  if (state.audio) void state.audio.play();
  speechSynthesis.resume();
  state.activeReadState = "playing";
  if (state.activeMarker) setReadMarkerState(state.activeMarker, "playing");
  syncReaderPlayer(ui, state);
  setStatus("Reading aloud...");
});
ui.stopRead.addEventListener("click", () => stopReading());

let previewAudio: HTMLAudioElement | null = null;
ui.voicePreview.addEventListener("click", async () => {
  const sample = "This is a preview of the selected reading voice.";
  // Use the HTTP engine when it's active: a key is present, or the free local
  // server is selected. Otherwise preview with the browser voice so it always sounds.
  const usePremium =
    ui.readerMode.value === "premium" &&
    (ui.apiKey.value.trim().length > 0 || ui.apiProvider.value === "local-server");
  track("voice_previewed", { engine: usePremium ? ui.apiProvider.value : "browser" });
  if (!usePremium) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(sample);
    utter.rate = Number(ui.rate.value) || 1;
    const picked = ui.voiceSelect.value ? window.speechSynthesis.getVoices().find((v) => v.name === ui.voiceSelect.value) : undefined;
    if (picked) utter.voice = picked;
    window.speechSynthesis.speak(utter);
    setStatus(`Previewing ${picked?.name ?? "the local browser voice"}.`);
    return;
  }
  const previewHtml = ui.voicePreview.innerHTML;
  ui.voicePreview.disabled = true;
  ui.voicePreview.classList.add("loading");
  ui.voicePreview.innerHTML = '<span class="eq-load" aria-hidden="true"><i></i><i></i><i></i></span>Generating…';
  setStatus("Generating voice preview…");
  try {
    const url = URL.createObjectURL(await fetchSpeech(speechRequest(ui, sample)));
    if (previewAudio) previewAudio.pause();
    previewAudio = new Audio(url);
    previewAudio.onended = () => URL.revokeObjectURL(url);
    await previewAudio.play();
    setStatus(`Previewing voice: ${ui.voiceCustom.value.trim() || ui.voiceSelect.value}.`);
  } catch (error) {
    showError(`Voice preview failed: ${(error as Error).message}`);
  } finally {
    ui.voicePreview.disabled = false;
    ui.voicePreview.classList.remove("loading");
    ui.voicePreview.innerHTML = previewHtml;
  }
});
ui.rate.addEventListener("input", () => {
  ui.rateValue.textContent = Number(ui.rate.value).toFixed(1);
  if (state.audio) state.audio.playbackRate = Number(ui.rate.value) || 1;
  syncReaderPlayer(ui, state);
});
ui.viewer.addEventListener("scroll", () => {
  selPopover.hide();
  // While dragging the slider it is the source of truth; while zooming, the transient
  // re-render scroll events must not rewrite the page number (that was the zoom bug).
  if (!scrubbing && !zooming) {
    state.page = visiblePage(ui.viewer, state.page);
    updatePageControls();
  }
  minimap.refreshViewport();
  saveReadingPosition();
});

initReaderPlayer(ui, readerPlayerActions(ui, state, playCurrentQueue, stopReading, setSpeechButtons));

const annoModalCtl = initAnnotationModal(
  {
    overlay: ui.annoModal,
    meta: ui.annoModalMeta,
    dot: ui.annoModalDot,
    quoteEl: ui.annoModalQuote,
    colors: ui.modalColor,
    textarea: ui.modalNoteText,
    tags: ui.modalTags,
    suggest: ui.modalTagSuggest,
    saveBtn: ui.modalSave,
    deleteBtn: ui.modalDelete,
    closeBtn: ui.annoModalClose
  },
  state,
  { save: saveAnnotations, renderList: renderAnnotationList, recolor: updateAnnotationColor, remove: deleteSelectedAnnotation }
);

// Icon rail → slide-out flyout. Each icon opens its tool panel; clicking the
// active icon (or the close button) hides the flyout again.
const PANEL_TITLES: Record<string, string> = {
  document: "Document",
  annotate: "Annotate",
  listen: "Read aloud",
  settings: "Settings",
};
const railIcons = Array.from(document.querySelectorAll<HTMLButtonElement>(".rail-ico"));
const railPanels = Array.from(document.querySelectorAll<HTMLElement>(".rail-panel"));
const flyoutOpen = (): boolean => ui.railFlyout.classList.contains("open");
function openPanel(name: string): void {
  ui.railFlyout.dataset.panel = name;
  ui.railFlyout.classList.add("open");
  ui.flyoutTitle.textContent = PANEL_TITLES[name] ?? "";
  railIcons.forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  railPanels.forEach((p) => p.classList.toggle("show", p.dataset.panel === name));
}
function closePanel(): void {
  ui.railFlyout.classList.remove("open");
  railIcons.forEach((b) => b.classList.remove("active"));
}
railIcons.forEach((btn) => {
  if (!btn.dataset.panel) return; // non-panel rail buttons (e.g. About) handle themselves
  btn.addEventListener("click", () => {
    const name = btn.dataset.panel as string;
    if (flyoutOpen() && ui.railFlyout.dataset.panel === name) closePanel();
    else openPanel(name);
  });
});
ui.railFlyoutClose.addEventListener("click", closePanel);

// The transport-bar engine badge is a shortcut into voice setup: seeing "Free voice" is
// only useful if acting on it is one click away.
document.getElementById("engineBadge")?.addEventListener("click", (event) => {
  // The badge sits outside the rail and its flyout, so without this the document-level
  // "click outside dismisses the panel" handler fires on the same click and closes what
  // we just opened.
  event.stopPropagation();
  openPanel("settings");
  document.getElementById("localSetup")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

// "About" info button → small popover with app + fifteen02 credit.
const railInfo = document.getElementById("railInfo");
const infoPopover = document.getElementById("infoPopover");
railInfo?.addEventListener("click", (event) => {
  event.stopPropagation();
  const show = infoPopover?.hasAttribute("hidden");
  infoPopover?.toggleAttribute("hidden", !show);
  railInfo.setAttribute("aria-expanded", String(!!show));
});
document.addEventListener("click", (event) => {
  if (!infoPopover || infoPopover.hasAttribute("hidden")) return;
  const target = event.target as HTMLElement;
  if (infoPopover.contains(target) || target.closest("#railInfo")) return;
  infoPopover.setAttribute("hidden", "");
  railInfo?.setAttribute("aria-expanded", "false");
});

// The header overlays the page (so the PDF flows full-bleed beneath it). It wraps to
// two rows when a structure breadcrumb is present, so keep the viewer's top padding in
// sync with its real height via --topbar-h.
const topbarEl = document.querySelector<HTMLElement>(".topbar");
if (topbarEl) {
  const syncTopbarH = (): void =>
    document.documentElement.style.setProperty("--topbar-h", `${Math.ceil(topbarEl.getBoundingClientRect().height)}px`);
  new ResizeObserver(syncTopbarH).observe(topbarEl);
  syncTopbarH();
}

// Typewriter reveal for the lobby hero line — types the sentence out, accent phrase and
// all, with a blinking caret. Only on the first-run lobby, and skipped for reduced-motion.
{
  const title = document.querySelector<HTMLElement>(".welcome-title");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (title && ui.app.classList.contains("no-doc") && !reduce) {
    const segs = [...title.childNodes].map((n) =>
      n.nodeType === Node.TEXT_NODE
        ? { text: n.textContent || "", cls: "" }
        : { text: (n as HTMLElement).textContent || "", cls: (n as HTMLElement).className }
    );
    title.textContent = "";
    title.classList.add("typing");
    const spans = segs.map((s) => {
      const sp = document.createElement("span");
      if (s.cls) sp.className = s.cls;
      title.appendChild(sp);
      return { sp, text: s.text };
    });
    const caret = document.createElement("span");
    caret.className = "wt-caret";
    title.appendChild(caret);
    let si = 0;
    let ci = 0;
    const tick = (): void => {
      // Done: just drop the caret. Keep the .typing class so the title's rise-in stays
      // disabled — it's already visible from typing, no need for a second animation.
      if (si >= spans.length) { window.setTimeout(() => caret.remove(), 650); return; }
      const cur = spans[si];
      if (ci < cur.text.length) {
        const ch = cur.text[ci++];
        cur.sp.textContent = (cur.sp.textContent || "") + ch;
        window.setTimeout(tick, ch === "." ? 360 : ch === " " ? 44 : 32 + Math.random() * 40);
      } else {
        si++; ci = 0;
        window.setTimeout(tick, 70);
      }
    };
    window.setTimeout(tick, 460); // let the card rise in first
  }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && infoPopover && !infoPopover.hasAttribute("hidden")) {
    infoPopover.setAttribute("hidden", "");
    railInfo?.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && flyoutOpen()) closePanel();
});
// Click anywhere outside the rail or its flyout dismisses the panel.
document.addEventListener("click", (e) => {
  if (!flyoutOpen()) return;
  const target = e.target as HTMLElement;
  if (ui.railFlyout.contains(target) || target.closest(".rail-icons")) return;
  closePanel();
});

// Safety net: flush the latest annotation text/state to storage before unload
// (covers any in-flight debounced save from the modal).
window.addEventListener("beforeunload", () => {
  const anno = currentAnnotation();
  if (anno && ui.modalNoteText && !ui.annoModal.hidden) {
    anno.text = ui.modalNoteText.value;
    anno.updatedAt = new Date().toISOString();
  }
  saveAnnotations();
});

ui.app.classList.toggle("annotations-hidden", localStorage.getItem("pdf-reader-hide-annotations") === "true");
initResizers();
setSpeechButtons(false);
setPdfControls(false);
initSettings(ui, setStatus);
initPomodoro();
// Styles are applied and the UI is wired — reveal the page (see the fade-in in index.html).
document.documentElement.classList.add("app-ready");

function applyTheme(): void {
  ui.viewer.classList.remove("normal", "sepia", "dark");
  ui.viewer.classList.add(state.theme);
  ui.pages.classList.add("vertical"); // continuous scroll is the only layout
  document.querySelectorAll<HTMLElement>(".page").forEach((page) => {
    page.classList.remove("normal", "sepia", "dark");
    page.classList.add(state.theme);
  });
}

function updateAnnotationMode(): void {
  document.querySelectorAll<HTMLElement>(".anno-layer").forEach(updateLayerMode);
}

function updateLayerMode(layer: HTMLElement): void {
  layer.classList.toggle("draw", state.mode === "note");
}

function setSwatch(color: string): void {
  state.color = color;
  ui.annoColor.querySelectorAll<HTMLElement>(".swatch").forEach((swatch) => {
    const active = swatch.dataset.color === color;
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-pressed", String(active));
  });
}

let zoomBusy = false;
let pendingZoom: { scale: number; anchorScroll: boolean } | null = null;
async function setZoom(scale: number, anchorScroll = true): Promise<void> {
  const next = Math.round(scale * 100) / 100;
  if (next === state.scale || Number.isNaN(next)) return;
  // Coalesce rapid zoom clicks: while one re-render is in flight the DOM is mid-rebuild
  // (scroll briefly at 0), so reading the anchor then would snap to page 1. Defer the
  // latest request and run it once the current one has settled on the anchor page.
  if (zoomBusy) {
    pendingZoom = { scale: next, anchorScroll };
    return;
  }
  zoomBusy = true;
  // Anchor on the spot under the viewport CENTER (the page + how far into it), so the
  // exact thing you're reading stays centred after the re-render instead of hopping.
  const viewerRect = ui.viewer.getBoundingClientRect();
  const centerY = viewerRect.top + viewerRect.height / 2;
  const anchorPage = visiblePage(ui.viewer, state.page);
  const before = ui.viewer.querySelector<HTMLElement>(`.page[data-page="${anchorPage}"]`);
  const beforeRect = before?.getBoundingClientRect();
  const frac = beforeRect && beforeRect.height ? Math.min(1, Math.max(0, (centerY - beforeRect.top) / beforeRect.height)) : 0.5;
  // Capture each page's current size, scaled by the zoom ratio, so the re-render keeps
  // every page's real proportions (crucial for docs with differently-sized pages —
  // otherwise the anchor page's position is miscomputed and you land on a nearby page).
  const ratio = next / state.scale;
  const sizeHints = new Map<number, { w: number; h: number }>();
  ui.pages.querySelectorAll<HTMLElement>(".page").forEach((p) => {
    const pg = Number(p.dataset.page);
    if (pg && p.offsetHeight) sizeHints.set(pg, { w: p.offsetWidth * ratio, h: p.offsetHeight * ratio });
  });
  zooming = true; // freeze the page number while the re-render's scroll events fire
  state.scale = next;
  state.page = anchorPage;
  syncZoomSelect(ui.zoom, state.scale, "fixed");
  await renderPages(sizeHints);
  // Pinch drives its own cursor-anchored scroll — skip so the two don't fight.
  if (anchorScroll) {
    // Anchor directly to the anchor page's live rect (not offsetTop, which depends on
    // every page above it). Do this once now and once before paint to settle the initial
    // placement; from there the browser's native scroll-anchoring keeps the spot put as
    // neighbouring pages lazily render — running our own timers too would double-count
    // that compensation and drift the view to the bottom.
    const recenter = (): void => {
      const after = ui.viewer.querySelector<HTMLElement>(`.page[data-page="${anchorPage}"]`);
      if (!after) { scrollPageIntoView(ui.viewer, anchorPage); return; }
      const rect = after.getBoundingClientRect();
      const vr = ui.viewer.getBoundingClientRect();
      const delta = rect.top + frac * rect.height - (vr.top + vr.height / 2);
      if (Math.abs(delta) > 0.5) ui.viewer.scrollTop = Math.max(0, ui.viewer.scrollTop + delta);
    };
    recenter();
    requestAnimationFrame(recenter);
  }
  releaseZoom(anchorPage);
  zoomBusy = false;
  if (pendingZoom) {
    const nextZoom = pendingZoom;
    pendingZoom = null;
    await setZoom(nextZoom.scale, nextZoom.anchorScroll);
  }
}

// After a zoom, lock the page number to the anchor and lift the freeze once the
// re-render's transient scroll events (placeholder → real sizes) have settled.
let zooming = false;
let zoomReleaseTimer = 0;
function releaseZoom(anchorPage: number): void {
  window.clearTimeout(zoomReleaseTimer);
  state.page = anchorPage;
  updatePageControls();
  zoomReleaseTimer = window.setTimeout(() => { zooming = false; }, 220);
}

// Fit width / fit page — recomputes the scale to the viewport and stays responsive.
async function applyFit(): Promise<void> {
  if (!state.pdf) return;
  // Anchor on the spot under the viewport centre (page + fraction into it) and restore it
  // after the re-fit — same as the zoom path — so a window resize doesn't jump you to the
  // top of the page.
  const viewerRect = ui.viewer.getBoundingClientRect();
  const centerY = viewerRect.top + viewerRect.height / 2;
  const anchor = visiblePage(ui.viewer, state.page);
  const before = ui.viewer.querySelector<HTMLElement>(`.page[data-page="${anchor}"]`);
  const beforeRect = before?.getBoundingClientRect();
  const frac = beforeRect && beforeRect.height ? Math.min(1, Math.max(0, (centerY - beforeRect.top) / beforeRect.height)) : 0.5;
  zooming = true;
  state.scale = await scaleForMode(zoomMode, state.pdf, ui.viewer);
  state.page = anchor;
  syncZoomSelect(ui.zoom, state.scale, zoomMode);
  await renderPages();
  const after = ui.viewer.querySelector<HTMLElement>(`.page[data-page="${anchor}"]`);
  if (after) {
    const r = after.getBoundingClientRect();
    const vr = ui.viewer.getBoundingClientRect();
    const delta = r.top + frac * r.height - (vr.top + vr.height / 2);
    if (Math.abs(delta) > 0.5) ui.viewer.scrollTop = Math.max(0, ui.viewer.scrollTop + delta);
  } else {
    scrollPageIntoView(ui.viewer, anchor);
  }
  releaseZoom(anchor);
}
// Keep a fit mode fitting when the window (viewer) resizes.
let fitResizeTimer = 0;
window.addEventListener("resize", () => {
  if (zoomMode === "fixed" || !state.pdf) return;
  window.clearTimeout(fitResizeTimer);
  fitResizeTimer = window.setTimeout(() => void applyFit(), 160);
});

function updateAnnotationColor(anno: Annotation): void {
  document.querySelectorAll<HTMLElement>(`.anno[data-anno-id="${CSS.escape(anno.id)}"]`).forEach((el) => {
    el.style.setProperty("--anno-color", anno.color);
  });
}

async function goToLinkTarget(pageNumber: number): Promise<void> {
  await goToPage(pageNumber);
}

async function goToPage(pageNumber: number): Promise<void> {
  state.page = Math.min(Math.max(1, pageNumber), state.pdf?.numPages || 1);
  updatePageControls();
  scrollPageIntoView(ui.viewer, state.page);
}

function initResizers(): void {
  const MIN = 200;
  const MAX = 560;
  const varName = (edge: string): string => (edge === "left" ? "--left-expanded" : "--right-expanded");
  const storeKey = (edge: string): string => (edge === "left" ? "pdf-reader-left-w" : "pdf-reader-right-w");

  (["left", "right"] as const).forEach((edge) => {
    const saved = Number(localStorage.getItem(storeKey(edge)));
    if (saved >= MIN && saved <= MAX) ui.app.style.setProperty(varName(edge), `${saved}px`);
  });

  document.querySelectorAll<HTMLElement>(".resize-handle").forEach((handle) => {
    const edge = handle.dataset.edge === "right" ? "right" : "left";
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
      ui.app.classList.add("resizing");
      document.body.classList.add("resizing");
      let latest = 0;
      const move = (ev: PointerEvent): void => {
        const raw = edge === "left" ? ev.clientX : window.innerWidth - ev.clientX;
        latest = Math.max(MIN, Math.min(MAX, Math.round(raw)));
        ui.app.style.setProperty(varName(edge), `${latest}px`);
      };
      const up = (ev: PointerEvent): void => {
        handle.releasePointerCapture(ev.pointerId);
        handle.classList.remove("dragging");
        ui.app.classList.remove("resizing");
        document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (latest) localStorage.setItem(storeKey(edge), String(latest));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}

function downloadText(fileName: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
