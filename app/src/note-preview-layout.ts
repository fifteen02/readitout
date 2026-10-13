/** Keep previews outside the manuscript and between the fixed reader controls. */
export function notePreviewLayout(input: {
  width: number; ceiling: number; floor: number; pageLeft: number; pageRight: number;
  anchorTop: number; contentHeight: number;
}): { docked: boolean; left: number; top: number; width: number; height: number } {
  const edge = 12, gap = 16, width = 240;
  const available = Math.max(0, input.floor - input.ceiling);
  const rightFits = input.pageRight + gap + width <= input.width - edge;
  const leftFits = input.pageLeft - gap - width >= edge;
  if (input.width > 720 && (rightFits || leftFits)) {
    const height = Math.min(input.contentHeight, 280, available);
    return { docked: false, width, height,
      left: rightFits ? input.pageRight + gap : input.pageLeft - gap - width,
      top: Math.max(input.ceiling, Math.min(input.anchorTop, input.floor - height)) };
  }
  const height = Math.min(input.contentHeight, 240, Math.max(0, available * .45 - 16));
  const noteWidth = Math.min(720, input.width - 24);
  return { docked: true, left: (input.width - noteWidth) / 2,
    top: input.floor - height - 8, width: noteWidth, height };
}
