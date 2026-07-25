// Follow-along highlight for read-aloud. Builds per-word boxes for the active
// paragraph from its text-layer spans, then lights up the current word:
//  • local browser voice → exact word (speech boundary charIndex)
//  • premium voices → estimated by elapsed-time fraction. The estimate paces on
//    each word's character count (+ a pause after punctuation) rather than
//    assuming every word takes equal time, which tracks real speech far better.

interface WordBox { left: number; top: number; width: number; height: number; }

export interface WordHighlighter {
  setParagraph(markerId: string | null): void;
  atFraction(fraction: number): void;
  atCharIndex(charIndex: number, chunkText: string): void;
  clear(): void;
}

// Rough per-word "speaking cost": longer words take longer, and a sentence
// break adds a pause. Tuned to feel right, not to be physically exact.
function speakingCost(word: string): number {
  let cost = word.length + 1; // +1 for the gap to the next word
  if (/[.!?]$/.test(word)) cost += 4;        // full stop / question — longer pause
  else if (/[,;:)\]]$/.test(word)) cost += 2; // clause break — shorter pause
  return cost;
}

export function createWordHighlighter(): WordHighlighter {
  let words: WordBox[] = [];
  let cum: number[] = []; // cumulative speaking cost at the END of each word
  let totalCost = 1;
  let bar: HTMLElement | null = null;
  let last = -1;

  function reset(): void {
    words = [];
    cum = [];
    totalCost = 1;
    last = -1;
    if (bar) bar.style.display = "none";
  }

  function show(index: number): void {
    if (!bar || index < 0 || index >= words.length || index === last) return;
    last = index;
    const w = words[index];
    Object.assign(bar.style, {
      display: "block",
      left: `${w.left - 1}px`,
      top: `${w.top - 1}px`,
      width: `${w.width + 2}px`,
      height: `${w.height + 2}px`
    });
  }

  return {
    setParagraph(markerId) {
      reset();
      if (!markerId) return;
      const focus = document.querySelector<HTMLElement>(`.read-focus[data-marker-id="${CSS.escape(markerId)}"]`);
      const host = focus?.parentElement;
      if (!focus || !host) return;
      const lr = host.getBoundingClientRect();
      const fr = focus.getBoundingClientRect();
      const costs: number[] = [];
      // Words in reading order, from the spans that sit on this paragraph's lines.
      [...host.querySelectorAll<HTMLElement>("span")].forEach((span) => {
        const r = span.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (r.width <= 0 || cy < fr.top - 2 || cy > fr.bottom + 2) return;
        const text = span.textContent || "";
        const total = text.length || 1;
        let consumed = 0;
        for (const token of text.split(/(\s+)/)) {
          const word = token.trim();
          if (word) {
            words.push({
              left: r.left - lr.left + (consumed / total) * r.width,
              top: r.top - lr.top,
              width: (word.length / total) * r.width,
              height: r.height
            });
            costs.push(speakingCost(word));
          }
          consumed += token.length;
        }
      });
      if (!words.length) return;
      let acc = 0;
      cum = costs.map((c) => (acc += c));
      totalCost = acc || 1;
      bar = host.querySelector<HTMLElement>(".word-hl");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "word-hl";
        host.appendChild(bar);
      }
    },
    atFraction(fraction) {
      if (!words.length) return;
      const target = Math.max(0, Math.min(1, fraction)) * totalCost;
      // First word whose cumulative cost reaches the elapsed target.
      let idx = 0;
      while (idx < cum.length - 1 && cum[idx] < target) idx++;
      show(idx);
    },
    atCharIndex(charIndex, chunkText) {
      if (!words.length) return;
      const before = (chunkText.slice(0, charIndex).match(/\S+/g) || []).length;
      show(Math.min(words.length - 1, before));
    },
    clear() {
      reset();
    }
  };
}
