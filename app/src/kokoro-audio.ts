/** Keep requests comfortably below Kokoro's phoneme-token limit without losing text. */
export function splitKokoroText(text: string, limit = 350): string[] {
  const parts: string[] = [];
  let current = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (word.length > limit) throw new Error('This passage contains an unusually long word. Choose a shorter passage.');
    if (current && (current.length + word.length + 1 > limit)) { parts.push(current); current = ''; }
    current += (current ? ' ' : '') + word;
    if (/[.!?]["”’']?$/.test(word)) { parts.push(current); current = ''; }
  }
  if (current) parts.push(current);
  return parts;
}

export function pcmToWav(parts: Float32Array[], sampleRate = 24000): ArrayBuffer {
  const count = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const string = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  string(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); string(8, 'WAVE');
  string(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  string(36, 'data'); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const part of parts) for (const sample of part) {
    const value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return buffer;
}
