// Shared domain types for the reader.

export type AnnotationType = "highlight" | "note";
export type ThemeMode = "normal" | "sepia" | "dark" | "contrast";
export type ReadState = "idle" | "loading" | "playing" | "paused";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation extends Box {
  id: string;
  type: AnnotationType;
  page: number;
  /** The text that was highlighted (empty for drawn note areas). */
  quote?: string;
  /** The reader's comment. */
  text: string;
  color: string;
  /** Marked resolved/addressed by the reader. */
  done?: boolean;
  /** Optional freeform tags for organising annotations. */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  rects?: Box[];
}

export interface ReadItem {
  text: string;
  markerId?: string;
  page?: number;
}

export interface PrefetchResult {
  item?: ReadItem;
  url?: string;
  error?: unknown;
}

export interface AppState {
  pdf: PdfDocument | null;
  fileKey: string;
  fileName: string;
  page: number;
  scale: number;
  theme: ThemeMode;
  color: string;
  mode: AnnotationType;
  annotations: Annotation[];
  selectedId: string | null;
  pageTexts: Map<number, string>;
  pageReadItems: Map<number, ReadItem[]>;
  chunks: ReadItem[];
  readHistory: ReadItem[];
  currentReadItem: ReadItem | null;
  reading: boolean;
  audio: HTMLAudioElement | null;
  prefetch: Promise<PrefetchResult | null> | null;
  prefetchItem: ReadItem | null;
  activeReadState: ReadState;
  activeMarker: string | null;
  readingPage: number | null;
  renderId: number;
  playToken: number;
  playAbort: AbortController | null; // aborts in-flight TTS fetches when playback is cancelled
}

export interface TtsModel {
  id: string;
  name: string;
  price?: string;
  voices?: string[];
}

export interface SpeechRequestBody {
  text: string;
  provider: string;
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  baseUrl?: string;
}

// --- Minimal structural types for the pdf.js bits we use ---
export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  transform: number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

export interface PdfTextContent {
  items: PdfTextItem[];
}

export interface PdfLinkAnnotation {
  subtype: string;
  rect?: number[];
  url?: string;
  dest?: unknown;
}

export interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
  getTextContent(): Promise<PdfTextContent>;
  getAnnotations(params: { intent: string }): Promise<PdfLinkAnnotation[]>;
}

export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  items: PdfOutlineItem[];
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  getOutline(): Promise<PdfOutlineItem[] | null>;
}
