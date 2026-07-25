// pdf.js is bundled with the app rather than fetched from a CDN at runtime, so the
// reader works offline and no third-party origin can run script in the page — which
// matters here, because the page holds the user's API key.
// We expose a small, typed surface for the parts of the API the app uses.
import type { PdfDocument, PdfViewport } from "../types";

// @ts-expect-error - pdfjs-dist ships types we don't use; the narrow surface is below.
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
// Vite fingerprints the worker and emits it next to the bundle.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export interface PdfjsUtil {
  transform(a: number[], b: number[]): number[];
}

export interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string };
  Util: PdfjsUtil;
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}

export const pdfjsLib = pdfjs as unknown as PdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type { PdfDocument, PdfViewport };
