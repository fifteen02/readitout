// PDF text advances along its baseline, which need not be horizontal.
export function textRunGeometry(m: number[], width: number) {
  const font = Math.hypot(m[2], m[3]) || 10;
  const angle = Math.atan2(m[1], m[0]);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const left = m[4] + font * sin;
  const top = m[5] - font * cos;
  const xs = [left, left + width * cos, left - font * sin, left + width * cos - font * sin];
  const ys = [top, top + width * sin, top + font * cos, top + width * sin + font * cos];
  return {
    left, top, font, angle,
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    along: m[4] * cos + m[5] * sin,
    across: -m[4] * sin + m[5] * cos,
    vertical: Math.abs(sin) > Math.abs(cos)
  };
}
