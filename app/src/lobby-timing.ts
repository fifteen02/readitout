export interface WordTiming { t: number; w: string }
export interface SentenceCue { text: string; start: number; end: number }

/** Match the recording to its exact transcript; never estimate highlight positions. */
export function sentenceCues(text: string, words: WordTiming[]): SentenceCue[] {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length !== words.length || words.some((word, i) =>
    word.w !== tokens[i] || !Number.isFinite(word.t) || word.t < 0 ||
    (i > 0 && word.t < words[i - 1].t)
  )) return [];
  const cues: SentenceCue[] = [];
  let first = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (/[.!?]["'”’)]*$/.test(tokens[i]) || i === tokens.length - 1) {
      cues.push({ text: tokens.slice(first, i + 1).join(" "), start: words[first].t,
        end: words[i + 1]?.t ?? Infinity });
      first = i + 1;
    }
  }
  return cues;
}

export function sentenceAt(cues: SentenceCue[], time: number): number {
  return cues.findIndex(cue => time >= cue.start && time < cue.end);
}

/** New recordings are stitched sentence clips, so their measured boundaries need no word estimation. */
export function recordedSentenceCues(text: string, sentences: SentenceCue[], duration: number): SentenceCue[] {
  if (!sentences.length || sentences.map(cue => cue.text).join(' ') !== text || !Number.isFinite(duration) || duration <= 0) return [];
  if (sentences.some((cue, i) => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration + .001 || (i > 0 && Math.abs(cue.start - sentences[i - 1].end) > .001))) return [];
  return sentences;
}
