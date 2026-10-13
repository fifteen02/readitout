/** Place passage actions only in measured free gutters; null keeps the legacy fallback. */
export function markerPlacement(left: number, right: number, pageWidth: number): { play: number; tag: number } | null {
  const size = 28, gap = 5, edge = 2, clearance = 2;
  const pair = size * 2 + gap;
  const leftRoom = left - edge;
  const rightRoom = pageWidth - right - edge;
  if (leftRoom >= pair + clearance) {
    const pad = Math.min(9, leftRoom - pair);
    return { play: left - pad - pair, tag: left - pad - size };
  }
  if (leftRoom >= size + clearance && rightRoom >= size + clearance) {
    return {
      play: left - Math.min(9, leftRoom - size) - size,
      tag: right + Math.min(9, rightRoom - size)
    };
  }
  if (rightRoom >= pair + clearance) {
    const start = right + Math.min(9, rightRoom - pair);
    return { play: start, tag: start + size + gap };
  }
  return null;
}
