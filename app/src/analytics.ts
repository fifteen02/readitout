// Thin wrapper over the gtag.js snippet loaded in index.html.
//
// The site is a single page that never changes its URL, so the automatic
// page_view only ever fires once per session. These events are what actually
// show whether anyone is reading, listening or annotating.
//
// No-ops silently when gtag is absent (dev server, blocked by an ad blocker,
// or the snippet failed to load). Analytics must never break the reader.

type EventParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(event: string, params: EventParams = {}): void {
  try {
    window.gtag?.("event", event, params);
  } catch {
    /* never let a metrics failure surface to the reader */
  }
}
