import type { AppState, Annotation, Box } from "./types";
import type { UI } from "./ui";

type ExportUi = Pick<UI, "voiceSelect" | "stylePrompt">;

export interface AnnotationPayload {
  fileName: string;
  fileKey: string;
  pageCount: number;
  voice: string;
  narrationStyle: string;
  exportedAt: string;
  annotations: Annotation[];
}

export function annotationPayload(state: AppState, ui: ExportUi): AnnotationPayload {
  return {
    fileName: state.fileName,
    fileKey: state.fileKey,
    pageCount: state.pdf?.numPages || 0,
    voice: ui.voiceSelect.value,
    narrationStyle: ui.stylePrompt.value,
    exportedAt: new Date().toISOString(),
    annotations: state.annotations
  };
}

export async function collaborationMarkdown(
  state: AppState,
  ui: ExportUi,
  getPageText?: (page: number) => Promise<string>
): Promise<string> {
  const payload = annotationPayload(state, ui);
  const doc = payload.fileName || "the document";
  const lines = [
    "# Document review request",
    "",
    `You are an expert editor and technical reviewer. A reader has gone through "${doc}" (${payload.pageCount} pages) and left the highlights, comments, and questions listed below. Work through every item in order, and for each one:`,
    "",
    "1. Read the **Passage** together with its **Context** to understand what the text actually says.",
    "2. Address the reader's **Comment** directly — answer questions, resolve confusion, and verify any claim the reader doubts.",
    "3. Where the comment signals a problem (unclear wording, a possible error, a missing explanation), propose a concrete fix: a specific rewrite or addition, quoted so it can be pasted back in.",
    "4. If a passage actually reads fine, say so briefly and move on.",
    "",
    "Be specific and actionable — prefer concrete rewrites over general advice, and preserve the document's terminology and voice. End with a short, prioritised summary of the most important changes.",
    "",
    "---",
    "",
    `Document: ${doc} (${payload.pageCount} pages)`,
    `Exported: ${payload.exportedAt}`,
    "",
    "Legend for each entry:",
    "- **Passage** — the exact text the reader highlighted.",
    "- **Comment** — the reader's feedback or question.",
    "- **Context** — surrounding text from the same page, for reference.",
    ""
  ];
  const annotations = [...state.annotations]
    .filter((a) => !a.done) // resolved items are omitted from the copy
    .sort((a, b) => a.page - b.page || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  if (!annotations.length) {
    lines.push("_No open annotations._");
    return `${lines.join("\n")}\n`;
  }

  let lastPage: number | null = null;
  for (const anno of annotations) {
    if (anno.page !== lastPage) {
      lines.push("", `## Page ${anno.page}`);
      lastPage = anno.page;
    }
    const rawQuote = (anno.quote || "").trim();
    const quote = dehyphenate(rawQuote);
    const comment = (anno.text || "").trim();
    const heading = anno.type === "note" ? "Note (drawn area)" : "Highlight";
    lines.push("", `### ${heading}`);
    if (quote) lines.push("", `**Passage:** "${quote}"`);
    lines.push("", `**Comment:** ${comment || "_(none yet)_"}`);
    if (rawQuote && getPageText) {
      // match against the raw page text, then clean the result for the LLM
      const context = dehyphenate(await contextFor(getPageText, anno.page, rawQuote));
      if (context) lines.push("", `**Context:** …${context}…`);
    }
    if (!quote) {
      const box = (anno.rects || [anno])[0] as Box;
      lines.push("", `**Location:** drawn area near x ${pct(box.x)}, y ${pct(box.y)} on page ${anno.page}.`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function contextFor(
  getPageText: (page: number) => Promise<string>,
  page: number,
  quote: string
): Promise<string> {
  try {
    const text = await getPageText(page);
    if (!text) return "";
    const probe = quote.slice(0, 40);
    const idx = text.indexOf(probe);
    if (idx < 0) return "";
    const start = Math.max(0, idx - 200);
    const end = Math.min(text.length, idx + quote.length + 200);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

// Join words split across lines by a hyphen ("combin- ing" -> "combining").
// Only acts when the hyphen is followed by whitespace and a lowercase letter,
// so real compound hyphens ("well-being") are left intact.
function dehyphenate(text: string): string {
  return (text || "")
    .replace(/([A-Za-z])[-\u00AD]\s+([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
