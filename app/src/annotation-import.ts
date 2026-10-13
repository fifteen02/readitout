import type { Annotation, Box } from "./types";

function validBox(value: unknown): value is Box {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return ["x", "y", "w", "h"].every(key => typeof box[key] === "number" && Number.isFinite(box[key]))
    && (box.w as number) >= 0 && (box.h as number) >= 0;
}

/** Reject the entire backup before replacing notes if any record cannot be rendered safely. */
export function validImportedAnnotations(value: unknown, pageCount: number): value is Annotation[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!validBox(item)) return false;
    const note = item as unknown as Record<string, unknown>;
    if (typeof note.id !== "string" || !note.id.trim() || ids.has(note.id)) return false;
    if (!Number.isInteger(note.page) || (note.page as number) < 1 || (note.page as number) > pageCount) return false;
    if (note.type !== "highlight" && note.type !== "note") return false;
    if (typeof note.text !== "string" || typeof note.color !== "string") return false;
    if (typeof note.createdAt !== "string" || typeof note.updatedAt !== "string") return false;
    if (note.quote !== undefined && typeof note.quote !== "string") return false;
    if (note.done !== undefined && typeof note.done !== "boolean") return false;
    if (note.tags !== undefined && (!Array.isArray(note.tags) || !note.tags.every(tag => typeof tag === "string"))) return false;
    if (note.rects !== undefined && (!Array.isArray(note.rects) || !note.rects.length || !note.rects.every(validBox))) return false;
    ids.add(note.id);
    return true;
  });
}

export type BackupReadResult = { kind: "stale" } | { kind: "error"; message: string } | { kind: "ready"; annotations: Annotation[] };

/** A delayed file read belongs to the document/import that started it. */
export async function readAnnotationBackup(
  file: Pick<File, "text">, pageCount: number, isCurrent: () => boolean
): Promise<BackupReadResult> {
  if (!isCurrent()) return { kind: "stale" };
  let parsed: unknown;
  try {
    const text = await file.text();
    if (!isCurrent()) return { kind: "stale" };
    parsed = JSON.parse(text);
  } catch {
    return isCurrent() ? { kind: "error", message: "That file isn't valid JSON." } : { kind: "stale" };
  }
  const annotations = parsed && typeof parsed === "object" && "annotations" in parsed ? parsed.annotations : undefined;
  if (!Array.isArray(annotations)) return { kind: "error", message: "This isn't a notes backup. Choose a file saved with Back up notes." };
  if (!validImportedAnnotations(annotations, pageCount)) return { kind: "error", message: "This backup contains invalid notes. Your notes are unchanged. Try another backup for this PDF." };
  return { kind: "ready", annotations };
}
