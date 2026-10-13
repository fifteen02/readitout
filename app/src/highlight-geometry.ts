import type { Box } from "./types";

// Stored selections can include font leading or the reading band's padding.
// Resolve them against this render's text runs without changing the saved note.
// Splitting a paragraph box also keeps the spaces between lines unpainted.
export function alignHighlightBoxes(boxes: Box[], textRuns: (Box & { vertical?: boolean })[]): Box[] {
  const alignedBoxes = boxes.flatMap((box) => {
    const aligned = textRuns.filter((run) => {
      if (run.vertical) {
        const middle = run.x + run.w / 2;
        return middle >= box.x && middle <= box.x + box.w &&
          run.y < box.y + box.h && run.y + run.h > box.y;
      }
      const middle = run.y + run.h / 2;
      return middle >= box.y && middle <= box.y + box.h &&
        run.x < box.x + box.w && run.x + run.w > box.x;
    }).map((run) => {
      if (run.vertical) {
        const y = Math.max(box.y, run.y);
        return { x: run.x, y, w: run.w, h: Math.min(box.y + box.h, run.y + run.h) - y };
      }
      const x = Math.max(box.x, run.x);
      return { x, y: run.y, w: Math.min(box.x + box.w, run.x + run.w) - x, h: run.h };
    });
    // Image-only pages and unmatched older selections keep their original bounds.
    return aligned.length ? aligned : [box];
  });
  // DOM ranges may report both a span and its text rectangle. Paint their union
  // once, otherwise the same ink receives multiple translucent highlight coats.
  const merged: Box[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-7;
  for (const source of alignedBoxes) {
    let box = { ...source };
    for (let i = 0; i < merged.length;) {
      const other = merged[i];
      const horizontal = near(box.y, other.y) && near(box.h, other.h) &&
        box.x <= other.x + other.w + 1e-7 && other.x <= box.x + box.w + 1e-7;
      const vertical = near(box.x, other.x) && near(box.w, other.w) &&
        box.y <= other.y + other.h + 1e-7 && other.y <= box.y + box.h + 1e-7;
      if (!horizontal && !vertical) { i++; continue; }
      const x = Math.min(box.x, other.x), y = Math.min(box.y, other.y);
      box = { x, y, w: Math.max(box.x + box.w, other.x + other.w) - x,
        h: Math.max(box.y + box.h, other.y + other.h) - y };
      merged.splice(i, 1);
      i = 0;
    }
    merged.push(box);
  }
  return merged;
}

/** PDF span bounds can end at the baseline; leave room for the printed descenders. */
export function padHighlightBottom(box: Box, runs: (Box & { vertical?: boolean })[]): Box {
  const matching = runs.find(run => !run.vertical && Math.abs(run.y - box.y) < 1e-7 && Math.abs(run.h - box.h) < 1e-7);
  if (!matching) return box;
  const bottom = box.y + box.h;
  const next = runs.filter(run => run.y >= bottom && run.x < box.x + box.w && run.x + run.w > box.x)
    .reduce((edge, run) => Math.min(edge, run.y), 1);
  const padding = Math.max(0, Math.min(box.h * .18, (next - bottom) / 2, 1 - bottom));
  return { ...box, h: box.h + padding };
}
