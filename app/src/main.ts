import { attachPlaybackProgress } from './playback-progress';
import { attachNotePreview, hideNotePreview } from "./note-preview";
import { collectReadingPages } from "./reading-start";
import { createLatestJobQueue } from "./latest-job";
import { bindCommandKeys } from "./command-keys";
import { bindNoteInputKeys } from "./note-input";
import { deskIcon, initDeskIcons, type DeskIcon } from "./desk-icons";
import { initReadingLamps, syncReadingLamps } from "./reading-lamp";
import { initNotesActions } from "./notes-actions";
import { initSpeedPicker } from "./speed-picker";
import { initMobileReader } from "./mobile-reader";
import { browserKokoroEnabled, prepareBrowserKokoro, cancelBrowserKokoro } from "./browser-kokoro";
import { ensureReadingVoice } from "./voice-readiness";
import { requestVoiceDownload } from "./voice-download-dialog";
import "./styles.css";
import "./book-paper.css";
import { pdfjsLib } from "./lib/pdfjs";
import { buildUi } from "./ui";
import { initSettings, speechRequest } from "./reader-settings";
import { annotationPayload, collaborationMarkdown, feedbackMarkdown } from "./annotation-export";
import { readAnnotationBackup } from "./annotation-import";
import { addHighlightWithText, createParagraphTag, type AnnoApi } from "./annotation-create";
import { alignHighlightBoxes, padHighlightBottom } from "./highlight-geometry";
import { textRunGeometry } from "./text-run-geometry";
import { createSelectionPopover } from "./selection-popover";
import { createMinimap } from "./minimap";
import { initAnnotationModal } from "./annotation-modal";
import { scrollPageIntoView, visiblePage } from "./scroll";
import { trackPageSliderDrag } from "./page-slider";
import { addReadMarkers, setReadMarkerState, type ParagraphReadItem } from "./read-markers";
import { chunkText, fetchSpeech, playKokoroChunk, type PlaybackApi } from "./audio-playback";
import { scaleForMode, syncZoomSelect, type ZoomMode } from "./zoom";
import { buildLinkLayer } from "./link-layer";
import { createLinkPreview, type LinkPreview } from "./link-preview";
import { activateReaderItem, initReaderPlayer, readerPlayerActions, setReaderButtons, syncReaderPlayer } from "./reader-player";
import { attachVisualizer, stopVisualizer } from "./visualizer";
import { initPomodoro } from "./pomodoro";
import { createReadingFocus } from "./reading-focus";
import { createFocusGuide } from "./focus-guide";
import { initLobbyBook } from "./lobby-book";
import { initLobbyIntro } from "./lobby-intro";
import { track } from "./analytics";
import type { AppState, Annotation, Box, PdfOutlineItem, PdfPage, PdfViewport, ReadItem, ReadState } from "./types";
import "./reader-clarity.css";
import "./desk-icons.css";

const ui = buildUi();
// Keep in sync with the overlay Notes layout in reader-clarity.css.
const notesDrawerLayout = window.matchMedia("(max-width: 980px)");
let linkPreview: LinkPreview | null = null;
let documentVersion = 0;
let documentOpening = false;
let notesImportVersion = 0;
const readingFocus = createReadingFocus(ui.viewer, syncVisiblePage);
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
  speechBuffer: null,
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
      deskIcon("alert") +
      '<span class="toast-msg"></span><button type="button" class="toast-x" aria-label="Dismiss">' + deskIcon('close') + '</button>';
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
  [ui.prevPage, ui.nextPage, ui.pageSlider, ui.readPage, ui.readAll, ui.exportAnno, ui.importAnnoButton, ui.copyReviewBrief, ui.exportMarkdown].forEach(
    (el) => {
      el.disabled = !enabled;
    }
  );
  ui.copyNotes.disabled = !enabled || !state.annotations.length;
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
  const pageProgress = total > 1 ? Math.max(0, Math.min(1, (state.page - 1) / (total - 1))) : 0;
  ui.pageSlider.style.setProperty("--page-progress", `${pageProgress * 100}%`);
  ui.pageSlider.setAttribute("aria-valuetext", total ? `Page ${state.page} of ${total}` : "No document open");
  // Hide the resume bookmark when the thumb sits on it (avoids a doubled marker).
  if (bookmarkPage) ui.bookmarkMark.hidden = state.page === bookmarkPage;
  updateCurrentSection();
}

const queuePdfOpen = createLatestJobQueue();
async function openPdf(file: File | undefined): Promise<void> {
  if (!file || file.type !== "application/pdf") {
    setStatus("Choose a valid PDF file.");
    return;
  }
  // Save pending edits against the old file before its identity can change.
  if (!ui.annoModal.hidden) annoModalCtl.close();
  documentVersion += 1; // Invalidate pending imports before the next PDF starts loading.
  documentOpening = true;
  stopReading(); // Cancel extraction/playback immediately, even if another load is settling.
  return queuePdfOpen(isCurrent => loadPdf(file, isCurrent));
}

async function loadPdf(file: File, isCurrent: () => boolean): Promise<void> {
  lobbyAudio.stop();
  stopReading();
  showLoader("Opening document…");
  try {
    const data = await file.arrayBuffer();
    if (!isCurrent()) return;
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    if (!isCurrent()) { await pdf.destroy(); return; }
    // Stable key (name + size) so annotations survive re-opening even if the
    // file's modified-time changes; lastModified used to make the key fragile.
    state.fileKey = `${file.name}:${file.size}`;
    state.fileName = file.name;
    const readerTitle = document.getElementById("readerTitle")!;
    const bookTitle = file.name === "The Quiet Hour.pdf" ? "The Quiet Hour" : file.name.replace(/\.pdf$/i, "");
    readerTitle.textContent = bookTitle;
    readerTitle.title = bookTitle;
    state.page = 1;
    state.selectedId = null;
    state.pageTexts.clear();
    state.pageReadItems.clear();
    state.pdf = pdf;
    readingFocus.clearPages();
    linkPreview = createLinkPreview(state.pdf);
    loadAnnotations();
    // Reveal the reading layout FIRST (with the grid transition off) so the viewer
    // has its final width before we measure fit-to-width. Measuring while the
    // welcome is up (viewer display:none, width 0) produced a tiny, wrong scale.
    ui.app.classList.add("resizing");
    // Overlay Notes starts closed so each document opens ready to read.
    if (notesDrawerLayout.matches) ui.app.classList.add("annotations-hidden");
    setPdfControls(true);
    void ui.viewer.offsetWidth; // flush layout at the final column sizes
    const headerHeight = document.querySelector(".topbar")!.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--topbar-h", `${Math.ceil(headerHeight)}px`);
    if (zoomMode === "fixed") zoomMode = "fit-width";
    const scale = await scaleForMode(zoomMode, state.pdf, ui.viewer);
    if (!isCurrent()) return;
    state.scale = scale;
    syncReaderZoom(ui.zoom, state.scale, zoomMode);
    requestAnimationFrame(() => { if (isCurrent()) ui.app.classList.remove("resizing"); });
    showLoader(`Rendering ${state.pdf.numPages} pages…`);
    await cachePageDims(); // exact per-page sizes up front → no layout shift on zoom/scroll
    if (!isCurrent()) return;
    await renderPages();
    if (!isCurrent()) return;
    showLoader("Loading contents & annotations…");
    renderAnnotationList();
    minimap.show();
    await buildOutline();
    if (!isCurrent()) return;
    // Restore last reading position (bookmark) for this file.
    const savedPage = Number(localStorage.getItem(`pdf-reader-pos:${state.fileKey}`));
    if (savedPage >= 1 && savedPage <= state.pdf.numPages) {
      if (savedPage > 1) await goToPage(savedPage);
      if (!isCurrent()) return;
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
    if (!isCurrent()) return;
    track("pdf_open_failed");
    showError(`Couldn't open ${file.name}: ${(error as Error).message}`);
  } finally {
    if (isCurrent()) { documentOpening = false; hideLoader(); }
    ui.app.classList.remove("resizing");
  }
}

// One-time quick-start coach-mark on the first document a reader opens.
const ONBOARD_KEY = "readitout:onboarded";
function maybeShowOnboarding(): void {
  if (localStorage.getItem(ONBOARD_KEY) === "true") return;
  ui.coachmark.hidden = false;
}
ui.coachmarkDismiss.addEventListener("click", () => {
  const hadFocus = ui.coachmark.contains(document.activeElement);
  ui.coachmark.hidden = true;
  if (hadFocus) ui.playerPlay.focus({ preventScroll: true });
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
  const trackHelp = document.getElementById("pageTrackHelp");
  if (trackHelp) trackHelp.textContent = "Drag the brass knob to change page.";
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
  if (trackHelp && flat.length) trackHelp.textContent = "Drag to change page. Marks show top-level sections; select one to jump.";
  const pct = (p: number): number => ((Math.min(Math.max(1, p), total) - 1) / (total - 1)) * 100;

  // Keep the overview quiet; the complete hierarchy remains in Contents.
  const lanes = [0].map((depth) => {
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
    seg.setAttribute("aria-label", `Jump to ${f.title}, ${range}, outline level ${f.depth + 1}`);
    const tip = `${f.title} · ${range} · Outline level ${f.depth + 1}`;
    seg.addEventListener("mouseenter", () => showMarkTip(seg, tip));
    seg.addEventListener("focus", () => showMarkTip(seg, tip));
    seg.addEventListener("blur", hideMarkTip);
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
  readingFocus.clearPages(true);
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
    const textLayer = await buildTextLayer(page, viewport, pageNumber, Number(pageBox.dataset.renderId));
    if (Number(pageBox.dataset.renderId) !== state.renderId) return;
    const linkLayer = await buildLinkLayer(page, viewport, state.pdf, goToLinkTarget, linkPreview ?? undefined);
    if (Number(pageBox.dataset.renderId) !== state.renderId) return;
    pageBox.append(canvas, textLayer, linkLayer, layer);
    // Zoom and fit replace the marker nodes while playback keeps its state.
    // Restore the current state only after the new nodes join the document.
    setReadMarkerState(state.activeMarker, state.activeReadState);
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

async function buildTextLayer(page: PdfPage, viewport: PdfViewport, pageNumber: number, renderId: number): Promise<HTMLDivElement> {
  const textLayer = document.createElement("div");
  textLayer.className = "text-layer";
  textLayer.dataset.page = String(pageNumber);
  const content = await page.getTextContent();
  // Text extraction can finish after a zoom or document replacement. Do not
  // register obsolete passage/focus geometry, even if the layer is never mounted.
  if (renderId !== state.renderId) return textLayer;
  const measure = document.createElement("canvas").getContext("2d");
  content.items.forEach((item) => {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const geometry = textRunGeometry(tx, item.width * viewport.scale);
    const fontSize = geometry.font;
    const span = document.createElement("span");
    span.textContent = item.str;
    // The canvas has already loaded the PDF fonts. Use the same face for text
    // selection, then match its advance width to the PDF's text run. Setting
    // width alone leaves character selection using the unrelated UI font.
    const fallbackFont = content.styles?.[item.fontName || ""]?.fontFamily || "sans-serif";
    const fontFamily = item.fontName ? `${JSON.stringify(item.fontName)}, ${fallbackFont}` : fallbackFont;
    if (measure) measure.font = `${fontSize}px ${fontFamily}`;
    const measuredWidth = measure?.measureText(item.str).width || 0;
    const pdfWidth = item.width * viewport.scale;
    const matchWidth = measuredWidth > 0 && pdfWidth > 0;
    Object.assign(span.style, {
      left: `${geometry.left}px`,
      top: `${geometry.top}px`,
      fontSize: `${fontSize}px`,
      fontFamily,
      letterSpacing: "normal",
      wordSpacing: "normal",
      width: `${matchWidth ? measuredWidth : pdfWidth}px`,
      transform: `rotate(${geometry.angle}rad) scaleX(${matchWidth ? pdfWidth / measuredWidth : 1})`
    });
    span.dataset.vertical = String(geometry.vertical);
    span.dataset.page = String(pageNumber);
    textLayer.appendChild(span);
    // PDF text items are positioned independently, so the browser cannot infer
    // line boundaries. Preserve pdf.js's EOL marker for selection and copying.
    if (item.hasEOL) {
      const lineBreak = document.createElement("br");
      lineBreak.setAttribute("role", "presentation");
      textLayer.appendChild(lineBreak);
    }
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
  hideNotePreview();
  const pageNumber = Number(layer.dataset.page || state.page);
  layer.querySelectorAll(".anno").forEach((el) => el.remove());
  const bounds = layer.getBoundingClientRect();
  const textBoxes = [...(layer.parentElement?.querySelectorAll<HTMLElement>(".text-layer > span") ?? [])]
    .filter((span) => span.textContent?.trim())
    .map((span) => {
      const rect = span.getBoundingClientRect();
      return { x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height,
        w: rect.width / bounds.width, h: rect.height / bounds.height, vertical: span.dataset.vertical === "true" };
    });
  state.annotations
    .filter((a) => a.page === pageNumber)
    .forEach((anno) => {
      const storedBoxes = anno.rects || [anno];
      const boxes = anno.type === "highlight" ? alignHighlightBoxes(storedBoxes, textBoxes).map(box => padHighlightBottom(box, textBoxes)) : storedBoxes;
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
        attachNotePreview(el, anno.text || "");
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          selectAnnotation(anno.id);
          setNotesOpen(true);
        });
        el.addEventListener("dblclick", (event) => {
          event.stopPropagation();
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

const COPY_SVG = deskIcon("copy");

function buildNoteItem(anno: Annotation): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `note-item${anno.id === state.selectedId ? " active" : ""}${anno.done ? " done" : ""}`;
  item.dataset.annoId = anno.id;
  item.style.setProperty("--anno-color", anno.color || "#ffd240");
  const quote = (anno.quote || "").trim();
  const quoteHtml = quote
    ? `<span class="quote">“${escapeHtml(quote)}”</span>`
    : `<span class="quote placeholder-text">Highlight</span>`;
  const feedback = anno.text?.trim();
  const feedbackHtml = feedback
    ? `<span class="note-comment">${escapeHtml(feedback)}</span>`
    : "";
  const hashHtml = (anno.tags || []).length
    ? `<span class="note-hash">${(anno.tags as string[]).map((t) => `#${escapeHtml(t)}`).join(" ")}</span>`
    : "";
  item.innerHTML =
    `<button type="button" class="note-jump" aria-label="Go to passage on page ${anno.page}: ${escapeHtml((anno.quote || anno.text || "Highlight").slice(0, 80))}"><span class="note-body">` +
    `${feedbackHtml}${quoteHtml}${hashHtml}` +
    `<span class="note-ref">${deskIcon("page")}<span>Page ${anno.page}</span></span>` +
    `</span></button><div class="note-actions"><button type="button" class="note-edit" aria-label="${feedback ? "Edit note" : "Add note"}">${deskIcon("pen")}<span>${feedback ? "Edit" : "Add note"}</span></button>` +
    `<button type="button" class="note-copy" title="Copy this annotation" aria-label="Copy annotation">${COPY_SVG}<span>Copy</span></button>` +
    `<button type="button" class="note-resolve" aria-label="${anno.done ? "Reopen note" : "Resolve note"}">${deskIcon(anno.done ? "reset" : "check")}<span>${anno.done ? "Reopen" : "Resolve"}</span></button></div>`;

  const copyBtn = item.querySelector(".note-copy") as HTMLButtonElement;
  copyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyText(formatAnno(anno), "annotation");
  });

  const resolve = item.querySelector<HTMLButtonElement>(".note-resolve")!;
  resolve.addEventListener("click", event => {
    event.stopPropagation();
    anno.done = !anno.done;
    anno.updatedAt = new Date().toISOString();
    saveAnnotations();
    const hadFocus = document.activeElement === resolve;
    renderAnnotationList();
    if (hadFocus) ui.annoList.querySelector<HTMLButtonElement>(`[data-anno-id="${CSS.escape(anno.id)}"] .note-resolve`)?.focus({ preventScroll: true });
  });

  const select = async (): Promise<void> => {
    await goToPage(anno.page);
    selectAnnotation(anno.id);
  };
  item.querySelector(".note-jump")!.addEventListener("click", async () => {
    await select();
    if (window.matchMedia("(max-width: 720px)").matches) setNotesOpen(false);
    else ui.annoList.querySelector<HTMLButtonElement>(`[data-anno-id="${CSS.escape(anno.id)}"] .note-jump`)?.focus({ preventScroll: true });
  });
  item.querySelector(".note-edit")!.addEventListener("click", () => {
    selectAnnotation(anno.id);
    annoModalCtl.open();
  });
  return item;
}

function renderAnnotationList(): void {
  ui.copyNotes.disabled = !state.annotations.length;
  ui.app.classList.toggle("has-annos", state.annotations.length > 0);
  minimap.render(); // keep the minimap's annotation lane in sync with every change
  if (!state.annotations.length) {
    ui.annoList.innerHTML =
      '<div class="empty"><strong>No notes yet.</strong><p>Select a passage, then choose <b>Add note</b>.</p></div>';
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

async function getPageText(pageNumber: number): Promise<string> {
  if (state.pageTexts.has(pageNumber)) return state.pageTexts.get(pageNumber)!;
  const pdf = state.pdf!;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (state.pdf === pdf) state.pageTexts.set(pageNumber, text);
  return text;
}

async function readPages(from: number, to: number): Promise<void> {
  if (!state.pdf || state.reading || documentOpening) return;
  const pdf = state.pdf;
  const token = ++state.playToken;
  const isCurrent = () => state.pdf === pdf && state.playToken === token && !documentOpening;
  let chunks: ReadItem[] | null;
  try {
    chunks = await collectReadingPages(from, to, async page => {
      const items = state.pageReadItems.get(page);
      if (items?.length) return items.flatMap(item => chunkText(item.text, item));
      const text = await getPageText(page);
      return text ? chunkText(`Page ${page}. ${text}`, { page }) : [];
    }, isCurrent);
  } catch (error) {
    if (isCurrent()) showError(`Couldn't prepare this passage: ${(error as Error).message}`);
    return;
  }
  if (!chunks || !isCurrent()) return;
  if (!chunks.length) {
    setStatus("No readable text found in this PDF range.");
    return;
  }
  state.chunks = chunks;
  state.reading = true;
  if (readingFocus.enabled()) setFocusMode(false, false); // audio takes over from the focus band
  syncFocusControls();
  updateSpotlight();
  setSpeechButtons(true);
  // Fired at the start of a listening session only. playCurrentQueue also runs
  // per chunk and on next/prev, which would otherwise flood the event.
  track("read_aloud_started", { mode: "kokoro", source: "range" });
  playCurrentQueue();
}

async function nextReadingPage(after: number): Promise<ReadItem[]> {
  if (!state.pdf) return [];
  const pdf = state.pdf;
  let next = after + 1;
  while (next <= pdf.numPages) {
    const items = state.pageReadItems.get(next);
    let chunks: ReadItem[];
    if (items?.length) chunks = items.flatMap((item) => chunkText(item.text, item));
    else {
      const text = await getPageText(next);
      chunks = text ? chunkText(`Page ${next}. ${text}`, { page: next }) : [];
    }
    if (state.pdf !== pdf) return [];
    if (chunks.length) return chunks;
    next += 1;
  }
  return [];
}

function readFromItems(pageNumber: number, items: ParagraphReadItem[], markerId: string): void {
  if (documentOpening) return;
  if (state.activeMarker === markerId && state.reading) return toggleMarkerPause(markerId);
  stopReading("");
  state.page = pageNumber;
  state.activeMarker = markerId;
  state.chunks = items.flatMap((item) => chunkText(item.text, item));
  state.reading = true;
  if (readingFocus.enabled()) setFocusMode(false, false); // audio takes over from the focus band
  syncFocusControls();
  updateSpotlight();
  setSpeechButtons(true);
  setReadMarkerState(markerId, "loading");
  track("read_aloud_started", { mode: "kokoro", source: "paragraph" });
  playCurrentQueue();
}

function toggleMarkerPause(markerId: string): void {
  // Clicking while it's still loading means "cancel" — there's nothing to pause yet,
  // so stop and abort the outbound request rather than letting it play when it lands.
  if (state.activeReadState === "loading") {
    stopReading("Cancelled.");
    return;
  }
  const paused = state.audio?.paused ?? false;
  if (paused) ui.resumeRead.click();
  else ui.pauseRead.click();
  setReadMarkerState(markerId, paused ? "playing" : "paused");
}

function playCurrentQueue(): void {
  if (!browserKokoroEnabled()) {
    const token = state.playToken;
    const isCurrent = () => token === state.playToken && state.reading;
    state.activeReadState = "loading";
    setSpeechButtons(true);
    void ensureReadingVoice({
      enabled: browserKokoroEnabled,
      confirm: requestVoiceDownload,
      prepare: () => {
        const controller = new AbortController();
        state.playAbort = controller;
        controller.signal.addEventListener("abort", cancelBrowserKokoro, {once:true});
        return prepareBrowserKokoro().finally(() => {
          controller.signal.removeEventListener("abort", cancelBrowserKokoro);
        });
      },
      isCurrent
    }).then(ready => {
      if (!isCurrent()) return;
      if (ready) playCurrentQueue();
      else stopReading("");
    }).catch(error => {
      if (isCurrent()) stopReading(error.name === "AbortError" ? "Voice download cancelled." : "The voice could not download. Try Listen again.");
    });
    return;
  }
  const api: PlaybackApi = {
    state, ui, setStatus, stopReading, speechRequest, activateReadItem, nextPage: nextReadingPage,
    onPlay: audio => { attachVisualizer(audio); attachPlaybackProgress(state, audio); }, onError: showError
  };
  void playKokoroChunk(api);
}

function activateReadItem(item: ReadItem, readState: ReadState = "playing"): void {
  const changedPage = item.page && item.page !== state.readingPage;
  if (item?.page) state.readingPage = item.page;
  activateReaderItem(ui, state, item, readState, updatePageControls);
  if (changedPage) scrollPageIntoView(ui.viewer, item.page!);
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
  if (state.audio) {
    state.audio.pause();
    URL.revokeObjectURL(state.audio.src);
  }
  state.audio = null;
  state.speechBuffer?.dispose();
  state.speechBuffer = null;
  state.chunks = [];
  state.readHistory = [];
  state.currentReadItem = null;
  state.reading = false;
  syncFocusControls();
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


// Lobby manuscript player — prerecorded Kokoro with measured sentence boundaries.
const lobbyAudio = initLobbyIntro();
initLobbyBook(lobbyAudio.pause);

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
  const spans = [...textLayer.querySelectorAll<HTMLElement>("span")].map((s) => ({ rect: s.getBoundingClientRect(), vertical: s.dataset.vertical === "true" }));
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 2 && r.height > 2)
    .map((r) => {
      const cy = r.top + r.height / 2;
      const run = spans.find(({ rect: b }) => cy >= b.top && cy <= b.bottom && r.left < b.right && r.right > b.left);
      const g = run?.rect;
      const top = g && !run?.vertical ? g.top : r.top;
      const h = g && !run?.vertical ? g.height : r.height;
      return {
        x: ((g && run?.vertical ? g.left : r.left) - pageRect.left) / pageRect.width,
        y: (top - pageRect.top) / pageRect.height,
        w: (g && run?.vertical ? g.width : r.width) / pageRect.width,
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
    btn.innerHTML = deskIcon("check");
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
const readerNotes = document.getElementById("readerNotes");
readerNotes?.addEventListener("click", () => {
  if (ui.railFlyout.contains(readerNotes)) closePanel();
  ui.toggleAnnoPanel.click();
});
function syncNotesVisibility(): void {
  const open = !ui.app.classList.contains("annotations-hidden");
  readerNotes?.setAttribute("aria-expanded", String(open));
  readerNotes?.setAttribute("aria-label", open ? "Close notes" : "Open notes");
  readerNotes?.setAttribute("title", open ? "Close notes" : "Open notes");
  // The drawer stays mounted for its slide-out animation, but closed controls
  // must leave the keyboard and accessibility trees immediately.
  document.getElementById("notesPanel")!.inert = !open;
}
new MutationObserver(syncNotesVisibility).observe(ui.app, { attributes: true, attributeFilter: ["class"] });
document.getElementById("welcomeSample")?.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    const mobileSample = window.matchMedia("(max-width: 720px)").matches;
    const response = await fetch(mobileSample ? "/paper-reading-copy-mobile.pdf" : "/paper-reading-copy.pdf");
    if (!response.ok) throw new Error("The sample could not be loaded. Please try again.");
    zoomMode = mobileSample ? "fit-width" : "fit-page";
    await openPdf(new File([await response.blob()], "The Quiet Hour.pdf", { type: "application/pdf" }));
  } catch (error) { showError((error as Error).message); }
  finally { button.disabled = false; }
});
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
trackPageSliderDrag(ui.pageSlider, window, (dragging) => { scrubbing = dragging; });
ui.pageSlider.addEventListener("input", () => goToPage(Number(ui.pageSlider.value)));
// Layout is continuous-only now (single/two-page/horizontal removed).
// Day and Night each own the chrome and manuscript colours together.
const APPEARANCE_KEY = "readitout:appearance";
type Appearance = "light" | "dark";
function applyAppearance(pref: Appearance): void {
  localStorage.setItem(APPEARANCE_KEY, pref);
  ui.appearanceTabs.querySelectorAll<HTMLElement>("button").forEach(button => {
    const selected = button.dataset.appearance === pref;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  setScheme(pref === "dark" ? "dark" : "normal");
}
ui.appearanceTabs.addEventListener("click", event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-appearance]");
  if (button) applyAppearance(button.dataset.appearance as Appearance);
});
document.documentElement.dataset.preset = "book";

initSpeedPicker(ui.playerRate, ui.playerRateValue, ui.rate);

// ---- Command palette (⌘K / Ctrl+K) -----------------------------
interface Cmd { label: string; tag: string; icon: DeskIcon; run: () => void; }
function cmdkCommands(query: string): Cmd[] {
  const q = query.trim();
  const n = Number(q);
  if (q && Number.isInteger(n) && n > 0) {
    return [{ label: `Go to page ${n}`, tag: "Jump", icon: "page", run: () => void goToPage(n) }];
  }
  const all: Cmd[] = [
    { label: "Read this page", tag: "Listen", icon: "play", run: () => ui.readPage.click() },
    { label: "Read whole document", tag: "Listen", icon: "play", run: () => ui.readAll.click() },
    { label: "Focus controls", tag: "Read", icon: "focus", run: () => ui.focusToggle.click() },
    { label: "Open a PDF", tag: "File", icon: "book", run: () => ui.pdfInput.click() },
    { label: "Next page", tag: "Navigate", icon: "next", run: () => void goToPage(state.page + 1) },
    { label: "Previous page", tag: "Navigate", icon: "previous", run: () => void goToPage(state.page - 1) },
    { label: "Appearance: Day", tag: "Theme", icon: "day", run: () => applyAppearance("light") },
    { label: "Appearance: Night", tag: "Theme", icon: "night", run: () => applyAppearance("dark") },
  ];
  const ql = q.toLowerCase();
  return ql ? all.filter((c) => c.label.toLowerCase().includes(ql)) : all;
}
let cmdkSel = 0;
let cmdkCurrent: Cmd[] = [];
let cmdkOpener: HTMLElement | null = null;
function setCmdkSel(i: number): void {
  cmdkSel = i;
  const items = ui.cmdkList.querySelectorAll<HTMLElement>(".cmdk-item");
  items.forEach((el, idx) => {
    el.classList.toggle("sel", idx === i);
    el.setAttribute("aria-selected", String(idx === i));
  });
  if (items[i]) ui.cmdkInput.setAttribute("aria-activedescendant", items[i].id);
  else ui.cmdkInput.removeAttribute("aria-activedescendant");
  items[i]?.scrollIntoView({ block: "nearest" });
}
function renderCmdk(): void {
  cmdkCurrent = cmdkCommands(ui.cmdkInput.value);
  if (!cmdkCurrent.length) {
    ui.cmdkList.innerHTML = '<div class="cmdk-empty" role="status">No matching actions</div>';
    cmdkSel = 0;
    ui.cmdkInput.removeAttribute("aria-activedescendant");
    return;
  }
  ui.cmdkList.replaceChildren(...cmdkCurrent.map((c, i) => {
    const row = document.createElement("div");
    row.className = "cmdk-item" + (i === 0 ? " sel" : "");
    row.id = `cmdk-option-${i}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === 0));
    row.innerHTML = `<span class="cmdk-ico">${deskIcon(c.icon)}</span><span class="cmdk-label"></span><span class="cmdk-tag"></span>`;
    row.querySelector(".cmdk-label")!.textContent = c.label;
    row.querySelector(".cmdk-tag")!.textContent = c.tag;
    row.addEventListener("mousemove", () => setCmdkSel(i));
    row.addEventListener("click", () => runCmdk(i));
    return row;
  }));
  setCmdkSel(0);
}
function runCmdk(i: number): void { const c = cmdkCurrent[i]; closeCmdk(); if (c) c.run(); }
function openCmdk(): void {
  cmdkOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ui.cmdk.hidden = false;
  ui.cmdkInput.setAttribute("aria-expanded", "true");
  ui.cmdkInput.value = "";
  renderCmdk();
  requestAnimationFrame(() => { if (!ui.cmdk.hidden) ui.cmdkInput.focus(); });
}
function closeCmdk(): void {
  ui.cmdk.hidden = true;
  ui.cmdkInput.setAttribute("aria-expanded", "false");
  const target = cmdkOpener?.isConnected && cmdkOpener !== document.body && cmdkOpener.getClientRects().length
    ? cmdkOpener : state.pdf ? ui.focusToggle : ui.welcomeOpen;
  target?.focus({ preventScroll: true });
  cmdkOpener = null;
}
ui.cmdkInput.addEventListener("input", renderCmdk);
bindCommandKeys(ui.cmdkInput, {
  move: delta => setCmdkSel(Math.max(0, Math.min(cmdkSel + delta, cmdkCurrent.length - 1))),
  run: () => runCmdk(cmdkSel),
  close: closeCmdk
});
ui.cmdk.addEventListener("click", (e) => { if (e.target === ui.cmdk) closeCmdk(); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    if (ui.cmdk.hidden) openCmdk(); else closeCmdk();
  }
});

// ---- Reading focus band + page dimming --------------------------------------
const focusGuide = createFocusGuide(ui.focusToggle, {
  move: delta => readingFocus.move(delta),
  dim: () => toggleFocusDim(),
  enable: enabled => setFocusMode(enabled)
});
const FOCUS_KEY = "readitout:focus";
const FOCUS_DIM_KEY = "readitout:focus-dim";
// Focus band and audio narration are mutually exclusive: turning one on turns the
// other off. `persist` is false when audio disables focus, so the saved preference survives.
function setFocusMode(next: boolean, persist = true): void {
  if (next && state.reading) stopReading();
  readingFocus.setEnabled(next);
  if (persist) localStorage.setItem(FOCUS_KEY, String(next));
  ui.focusToggle.classList.toggle("focus-on", next);
  ui.focusToggle.dataset.active = String(next);
  syncFocusControls();
  updateSpotlight();
}
function toggleFocus(): void {
  // On small screens the notes drawer covers the reading controls panel.
  if (window.matchMedia("(max-width: 980px)").matches && !ui.app.classList.contains("annotations-hidden")) ui.toggleAnnoPanel.click();
  focusGuide.toggleControls();
}
let focusDim = localStorage.getItem(FOCUS_DIM_KEY) !== "false";
readingFocus.setDim(focusDim);
ui.app.classList.toggle("focus-dim", focusDim);
function toggleFocusDim(): void {
  focusDim = !focusDim;
  localStorage.setItem(FOCUS_DIM_KEY, String(focusDim));
  readingFocus.setDim(focusDim);
  ui.app.classList.toggle("focus-dim", focusDim);
  syncFocusControls();
  updateSpotlight();
}
function syncFocusControls(): void {
  focusGuide.sync(readingFocus.enabled(), focusDim, state.reading);
}
// Spotlight = dim every page, only while a highlight is actually active (focus or reading).
function updateSpotlight(): void {
  ui.app.classList.toggle("spotlight", focusDim && (readingFocus.enabled() || state.reading));
}
ui.focusToggle.addEventListener("click", toggleFocus);
syncFocusControls();
// Click a line to move the band there (unless a text selection is in progress).
ui.viewer.addEventListener("click", (event) => {
  if (!readingFocus.enabled() || state.reading) return;
  if (!(window.getSelection()?.isCollapsed ?? true)) return;
  const page = (event.target as HTMLElement).closest<HTMLElement>(".page")?.dataset.page;
  if (page) readingFocus.focusAtPoint(Number(page), event.clientY, "none", event.clientX);
});
if (localStorage.getItem(FOCUS_KEY) === "true") setFocusMode(true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) {
    if (flyoutOpen()) return; // Settings handles its own dismissal below.
    if (readingFocus.enabled() && !state.reading) setFocusMode(false);
  }
});
ui.zoom.addEventListener("change", () => {
  const v = ui.zoom.value;
  if (v === "fit-width" || v === "fit-page") { zoomMode = v; void applyFit(); }
  else { zoomMode = "fixed"; void setZoom(Number(v)); }
});
function syncReaderZoom(select: HTMLSelectElement, scale: number, mode: ZoomMode = 'fixed'): void {
  syncZoomSelect(select, scale, mode);
  for (const [id, disabled] of [['readerZoomOut', scale <= 0.2], ['readerZoomIn', scale >= 3]] as const) {
    const button = document.getElementById(id) as HTMLButtonElement;
    button.disabled = disabled;
    button.title = `${id === 'readerZoomOut' ? 'Zoom out' : 'Zoom in'} · ${Math.round(scale * 100)}%`;
  }
}
document.getElementById('readerZoomOut')!.addEventListener('click', () => ui.zoomOut.click());
document.getElementById('readerZoomIn')!.addEventListener('click', () => ui.zoomIn.click());
ui.zoomOut.addEventListener("click", () => { zoomMode = "fixed"; setZoom(Math.max(0.2, state.scale - 0.15)); });
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
const introDoc = document.getElementById("introDoc");
function setScheme(scheme: "normal" | "dark"): void {
  state.theme = scheme;
  document.documentElement.dataset.theme = scheme === "dark" ? "dark" : "light";
  introDoc?.classList.remove("scheme-normal", "scheme-sepia", "scheme-dark");
  introDoc?.classList.add(`scheme-${scheme}`);
  syncReadingLamps();
  localStorage.setItem("readitout:scheme", scheme);
  applyTheme();
}
applyAppearance(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
initReadingLamps(() => applyAppearance(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
function setNotesOpen(open: boolean): void {
  if (!open) {
    document.getElementById("notesActionsPopover")?.hidePopover();
    document.getElementById("notesOrganisePopover")?.hidePopover();
  }
  ui.app.classList.toggle("annotations-hidden", !open);
  syncNotesVisibility();
  // A temporary drawer must not overwrite the desktop sidebar preference.
  if (!notesDrawerLayout.matches) {
    localStorage.setItem("pdf-reader-hide-annotations", String(!open));
  }
  if (open) requestAnimationFrame(() => readerNotes?.focus({ preventScroll: true }));
  else {
    const notes = document.getElementById("readerNotes");
    const returnTarget = notes?.getClientRects().length && getComputedStyle(notes).visibility === "visible"
      ? notes : document.getElementById("railSettings");
    returnTarget?.focus({ preventScroll: true });
  }
}
ui.toggleAnnoPanel.addEventListener("click", () => setNotesOpen(ui.app.classList.contains("annotations-hidden")));
ui.annoTab.addEventListener("click", () => setNotesOpen(true));
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
  saveAnnotations();
  renderAnnotations();
  renderAnnotationList();
  setStatus(`Deleted ${doneCount} completed annotation${doneCount > 1 ? "s" : ""}.`);
});

document.addEventListener("keydown", (event) => {
  // A control that already handled a key, or a browser/OS shortcut, owns it.
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as Element | null;
  const tag = document.activeElement?.tagName || "";
  if (target?.closest('[contenteditable="true"], [role="dialog"], #annoModal:not([hidden])')) return;
  // Space activates the focused control. Only passage playback markers retain
  // the intentional global pause/resume behavior after starting a passage.
  if ((event.code === "Space" || event.key === " ") &&
      target?.closest('button, a[href], [role="button"], #notesPanel, #railFlyout, .rail-icons, #pomodoro') &&
      !target.closest('.read-marker')) return;
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
  // F focuses the line nearest the viewport centre (enabling the band if needed).
  // D toggles page dimming — during focus OR
  // while narrating (available inside Focus controls in both).
  if ((event.key === "f" || event.key === "F") && state.pdf && !state.reading) {
    event.preventDefault();
    // Always grab the line nearest the viewport centre and centre it in view (turn the
    // band off with Follow one line in its controls or Escape). Pressing F again re-grabs.
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

const dismissQuickNote = (): void => {
  ui.quickNote.hidden = true;
  ui.quickNoteInput.blur();
};
bindNoteInputKeys(ui.quickNoteInput, text => {
  if (text) {
    if (state.reading && state.activeMarker) annotateCurrentLine(text);
    else annotateFocusLine(text);
  }
  dismissQuickNote();
}, dismissQuickNote);

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
  // Reset after capturing the File so a corrected file can be selected again.
  ui.importAnno.value = "";
  if (!file) return;
  if (documentOpening || !state.pdf) {
    showError("Wait for the PDF to finish opening, then import your backup.");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".json")) {
    showError("Choose a JSON file saved with Back up notes.");
    return;
  }
  const pdfAtStart = state.pdf;
  const documentAtStart = documentVersion;
  const importAtStart = ++notesImportVersion;
  const isCurrent = () => !documentOpening && state.pdf === pdfAtStart &&
    documentAtStart === documentVersion && importAtStart === notesImportVersion;
  const result = await readAnnotationBackup(file, state.pdf?.numPages || 0, isCurrent);
  if (!isCurrent() || result.kind === "stale") return;
  if (result.kind === "error") { showError(result.message); return; }
  state.annotations = result.annotations;
  saveAnnotations();
  await renderPages();
  if (!isCurrent()) return;
  renderAnnotationList();
  setStatus("Imported annotations.");
});
ui.copyNotes.addEventListener("click", async () => {
  await copyText(feedbackMarkdown(state), "notes");
});
ui.copyReviewBrief.addEventListener("click", async () => {
  await copyText(await collaborationMarkdown(state, ui, getPageText), "review brief");
});
ui.exportMarkdown.addEventListener("click", async () => {
  downloadText("review-notes.md", feedbackMarkdown(state), "text/markdown");
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
  state.activeReadState = "paused";
  if (state.activeMarker) setReadMarkerState(state.activeMarker, "paused");
  syncReaderPlayer(ui, state);
  setStatus("Read aloud paused.");
});
ui.resumeRead.addEventListener("click", () => {
  if (state.audio) void state.audio.play();
  state.activeReadState = "playing";
  if (state.activeMarker) setReadMarkerState(state.activeMarker, "playing");
  syncReaderPlayer(ui, state);
  setStatus("Reading aloud...");
});
ui.stopRead.addEventListener("click", () => stopReading());

let previewAudio: HTMLAudioElement | null = null;
ui.voicePreview.addEventListener("click", async () => {
  const sample = "This is a preview of the selected reading voice.";
  if (!browserKokoroEnabled()) {
    requestAnimationFrame(() => { openPanel("listen"); document.getElementById("kokoroDownload")?.focus(); }); return;
  }
  track("voice_previewed", { engine: "kokoro" });
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
    setStatus(`Previewing voice: ${ui.voiceSelect.value}.`);
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
function syncVisiblePage(): void {
  if (!state.pdf || scrubbing || zooming) return;
  state.page = visiblePage(ui.viewer, state.page, readingFocus.current());
  updatePageControls();
}
ui.viewer.addEventListener("scroll", () => {
  selPopover.hide();
  // While dragging the slider it is the source of truth; while zooming, the transient
  // re-render scroll events must not rewrite the page number (that was the zoom bug).
  syncVisiblePage();
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

// Settings contains all secondary reader tools.
const railIcons = Array.from(document.querySelectorAll<HTMLButtonElement>(".rail-ico"));
const railPanels = Array.from(document.querySelectorAll<HTMLElement>(".rail-panel"));
const settingsSections = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-settings-panel]"));
const flyoutOpen = (): boolean => ui.railFlyout.classList.contains("open");
let panelTrigger: HTMLElement | null = null;
function selectSettingsSection(name: string): void {
  ui.railFlyout.dataset.panel = name;
  ui.railFlyout.querySelector(".settings-body")?.scrollTo(0, 0);
  railPanels.forEach((p) => p.classList.toggle("show", p.dataset.panel === name));
  settingsSections.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.settingsPanel === name)));
}
settingsSections.forEach((button) => button.addEventListener("click", () => {
  selectSettingsSection(button.dataset.settingsPanel!);
}));
function openPanel(name: string): void {
  if (document.activeElement instanceof HTMLElement && !ui.railFlyout.contains(document.activeElement)) panelTrigger = document.activeElement;
  ui.railFlyout.classList.add("open");
  ui.flyoutTitle.textContent = "Settings";
  selectSettingsSection(name);
  railIcons.forEach((b) => {
    b.classList.add("active");
    b.setAttribute("aria-expanded", "true");
  });
  ui.railFlyoutClose.focus({preventScroll:true});
}
function closePanel(): void {
  if (ui.railFlyout.contains(document.activeElement)) panelTrigger?.focus({preventScroll:true});
  ui.railFlyout.classList.remove("open");
  railIcons.forEach((b) => {
    b.classList.remove("active");
    if (b.dataset.panel) b.setAttribute("aria-expanded", "false");
  });
}
railIcons.forEach((btn) => {
  if (!btn.dataset.panel) return; // non-panel rail buttons (e.g. About) handle themselves
  btn.setAttribute("aria-controls", "railFlyout");
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", () => {
    const name = btn.dataset.panel as string;
    if (flyoutOpen()) closePanel();
    else openPanel(name);
  });
});
ui.railFlyoutClose.addEventListener("click", closePanel);

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
  if (state.fileKey) localStorage.setItem(`pdf-reader-pos:${state.fileKey}`, String(state.page));
  const anno = currentAnnotation();
  if (anno && ui.modalNoteText && !ui.annoModal.hidden) {
    anno.text = ui.modalNoteText.value;
    anno.updatedAt = new Date().toISOString();
  }
  saveAnnotations();
});

ui.app.classList.toggle("annotations-hidden",
  notesDrawerLayout.matches || localStorage.getItem("pdf-reader-hide-annotations") !== "false");
syncNotesVisibility();
initResizers();
setSpeechButtons(false);
setPdfControls(false);
initSettings(ui, setStatus, stopReading);
initPomodoro();
initMobileReader();
initDeskIcons();
initNotesActions();
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
  syncReaderZoom(ui.zoom, state.scale, "fixed");
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
  if (!state.pdf || zoomMode === "fixed") return;
  const pdf = state.pdf;
  const mode = zoomMode;
  const nextScale = await scaleForMode(mode, pdf, ui.viewer);
  // A manual zoom or a different document may supersede this asynchronous fit.
  if (state.pdf !== pdf || zoomMode !== mode) return;
  if (state.scale === nextScale) {
    syncReaderZoom(ui.zoom, state.scale, mode);
    return;
  }
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
  state.scale = nextScale;
  state.page = anchor;
  syncReaderZoom(ui.zoom, state.scale, zoomMode);
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
// Observe the content box: notes change its width, while focus/audio notices
// change its padding. All of those alter the space available for a fitted page.
let fitResizeTimer = 0;
const fitLayoutObserver = new ResizeObserver(() => {
  window.clearTimeout(fitResizeTimer);
  if (zoomMode === "fixed" || !state.pdf || document.documentElement.classList.contains("note-preview-open")) return;
  fitResizeTimer = window.setTimeout(() => void applyFit(), 160);
});
fitLayoutObserver.observe(ui.viewer);

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
        const fromLeft = edge === "left" || handle.dataset.side === "left";
        const raw = fromLeft ? ev.clientX : window.innerWidth - ev.clientX;
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
