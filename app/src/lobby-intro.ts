// Lobby intro player: a small "app" that greets the reader. The greeting text
// types itself in; pressing play speaks it. Pre-recorded premium voices (with
// per-word positions) are produced by scripts/generate-greeting.mjs and listed
// in public/greeting.json; the reader can switch voices, and the little wave is
// driven by the real audio while each word lights as it's spoken. With no
// recordings present it falls back to the browser voice so the lobby still works.

interface WordTiming {
  t: number; // start time in seconds
  w: string;
}

interface VoiceEntry {
  name: string;
  file: string;
  words: WordTiming[];
}

interface Manifest {
  text: string;
  voices: VoiceEntry[];
}

const DEFAULT_GREETING =
  "Drop in a PDF and I'll read it aloud, follow along, and annotate anything as you go. Highlights, notes and read-aloud all live in one calm place, and everything you mark stays with you.";
// The phrase that gets highlighted (and the note revealed) the moment it's spoken.
const TARGET_PHRASE = "annotate anything as you go";
// The note the "reader" types into the toolbar once the phrase is highlighted.
const FEEDBACK_NOTE = "This feature is great!";
const VOICE_KEY = "readitout:greeting-voice";
const BAR_COUNT = 28;

export function initLobbyIntro(): void {
  const root = document.getElementById("introPlayer");
  const playBtn = document.getElementById("introPlay") as HTMLButtonElement | null;
  const textEl = document.getElementById("introText");
  const waveEl = document.getElementById("introWave");
  const voiceSel = document.getElementById("introVoice") as HTMLSelectElement | null;
  const cursor = document.getElementById("introCursor");
  const popover = document.getElementById("introPopover");
  const page = document.getElementById("introPage");
  const staticNote = document.getElementById("introStaticNote");
  const liveNote = document.getElementById("introLiveNote");
  const liveNoteText = document.getElementById("introLiveNoteText");
  const livePh = document.getElementById("introLivePh");
  if (!root || !playBtn || !textEl || !waveEl) return;

  let text = DEFAULT_GREETING;
  let voices: VoiceEntry[] = [];
  let current = 0;
  let wordSpans: HTMLElement[] = [];

  const bars: HTMLElement[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement("span");
    bar.className = "ipw-bar";
    waveEl.appendChild(bar);
    bars.push(bar);
  }

  fetch("/greeting.json")
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((data) => {
      if (data?.text) text = data.text;
      if (data?.voices?.length) {
        voices = data.voices;
        const saved = voices.findIndex((v) => v.name === localStorage.getItem(VOICE_KEY));
        current = saved >= 0 ? saved : 0;
        populateVoices();
      }
    })
    .catch(() => undefined)
    .finally(() => renderWords());

  function populateVoices(): void {
    if (!voiceSel) return;
    voiceSel.replaceChildren(...voices.map((v, i) => new Option(v.name, String(i), false, i === current)));
    voiceSel.hidden = false;
    voiceSel.addEventListener("change", () => {
      stop();
      current = Number(voiceSel.value) || 0;
      localStorage.setItem(VOICE_KEY, voices[current]?.name ?? "");
    });
  }

  function renderWords(): void {
    textEl!.replaceChildren();
    wordSpans = [];
    for (const token of text.split(/(\s+)/)) {
      if (token === "") continue;
      if (/^\s+$/.test(token)) {
        textEl!.appendChild(document.createTextNode(token));
        continue;
      }
      const span = document.createElement("span");
      span.className = "ipw-word";
      span.textContent = token;
      textEl!.appendChild(span);
      wordSpans.push(span);
    }
    markTargetPhrase();
    // The page is "already open" — no typing; anchor the pre-existing margin note
    // to its highlight, then start the annotate vignette shortly after.
    positionNoteTo(staticNote, page?.querySelector<HTMLElement>(".ip-hl-static") ?? null);
    window.setTimeout(runVignette, 900);
  }

  // Line up a margin note's field (its input/text) with the line of its highlight,
  // so the note reads as attached to that line. Needs the note visible.
  function positionNoteTo(note: HTMLElement | null, target: HTMLElement | null): void {
    if (!note || !target || !page) return;
    const pr = page.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const lineCenter = r.top - pr.top + r.height / 2;
    const field = note.querySelector<HTMLElement>(".ip-mnote-field");
    const fieldMid = field ? field.offsetTop + field.offsetHeight / 2 : note.offsetHeight / 2;
    note.style.top = `${Math.max(8, lineCenter - fieldMid)}px`;
  }

  // Keep both notes aligned if the layout reflows (resize, font load).
  window.addEventListener("resize", () => {
    positionNoteTo(staticNote, page?.querySelector<HTMLElement>(".ip-hl-static") ?? null);
    if (liveNote && !liveNote.hidden) {
      const t = wordSpans.find((w) => w.classList.contains("ip-target"));
      positionNoteTo(liveNote, t ?? null);
    }
  });

  // Vignette timers, tracked so a replay or a real read can cancel them cleanly.
  let vigTimers: number[] = [];
  const at = (ms: number, fn: () => void): void => {
    vigTimers.push(window.setTimeout(fn, ms));
  };
  function clearVignette(): void {
    vigTimers.forEach((t) => window.clearTimeout(t));
    vigTimers = [];
    root!.classList.remove("selecting", "picking", "clicking", "annotating", "focusing");
    cursor?.classList.remove("show", "down");
    if (popover) { popover.style.left = ""; popover.style.top = ""; popover.style.bottom = ""; }
    if (liveNote) { liveNote.hidden = true; liveNote.classList.remove("in", "editing", "saving"); }
    if (liveNoteText) liveNoteText.textContent = "";
    if (livePh) livePh.style.opacity = "";
  }

  // "Someone annotating", start to finish: the cursor glides to the phrase, drags
  // to select it (blue), the annotate toolbar pops up, the cursor clicks the amber
  // swatch (highlight settles), then opens the note line and types the feedback in.
  function runVignette(): void {
    if (playing) return;
    clearVignette();
    const targets = wordSpans.filter((w) => w.classList.contains("ip-target"));
    if (!targets.length || !cursor || !popover) {
      root!.classList.add("annotating");
      return;
    }
    const rects = () => {
      const base = root!.getBoundingClientRect();
      const first = targets[0].getBoundingClientRect();
      const last = targets[targets.length - 1].getBoundingClientRect();
      return { base, first, last };
    };
    const { base, first, last } = rects();
    const y = first.top - base.top + first.height * 0.7;
    const startX = first.left - base.left;
    const endX = last.right - base.left - 6;
    const midX = (first.left + last.right) / 2 - base.left;
    const DRAG = 900;

    // 1) glide in to the start of the phrase
    cursor.style.transition = "none";
    cursor.style.left = `${startX - 26}px`;
    cursor.style.top = `${y + 30}px`;
    cursor.classList.add("show");
    window.requestAnimationFrame(() => {
      cursor.style.transition = "left .5s ease, top .5s ease, opacity .3s ease, transform .12s ease";
      cursor.style.left = `${startX}px`;
      cursor.style.top = `${y}px`;
    });

    // 2) press, then drag across to select the phrase (blue text selection)
    at(600, () => cursor.classList.add("down"));
    at(740, () => {
      root!.classList.add("selecting");
      cursor.style.transition = `left ${DRAG}ms ease, top ${DRAG}ms ease, transform .12s ease`;
      cursor.style.left = `${endX}px`;
      cursor.style.top = `${y}px`;
    });

    // 3) release → a small colour toolbar pops up just above the phrase
    const RELEASE = 740 + DRAG;
    const moveCursor = (r: DOMRect, dx: number, dy: number, dur = 0.42): void => {
      const b = root!.getBoundingClientRect();
      cursor.style.transition = `left ${dur}s ease, top ${dur}s ease, transform .12s ease`;
      cursor.style.left = `${r.left - b.left + dx}px`;
      cursor.style.top = `${r.top - b.top + dy}px`;
    };
    at(RELEASE, () => {
      cursor.classList.remove("down");
      root!.classList.remove("selecting");
      root!.classList.add("picking");
      const b = root!.getBoundingClientRect();
      const f = targets[0].getBoundingClientRect();
      const popW = popover.offsetWidth;
      const left = Math.max(6, Math.min(b.width - popW - 6, midX - popW / 2));
      popover.style.left = `${left}px`;
      popover.style.top = "auto";
      popover.style.bottom = `${b.height - (f.top - b.top) + 10}px`; // sits just above the line
    });

    // 4) cursor moves to the amber swatch and clicks → highlight settles amber,
    //    the toolbar disappears and the note opens as a form in the margin
    at(RELEASE + 120, () => {
      const sw = popover.querySelector<HTMLElement>(".ip-sw-pick");
      if (sw) moveCursor(sw.getBoundingClientRect(), sw.offsetWidth / 2 - 2, sw.offsetHeight / 2, 0.45);
    });
    at(RELEASE + 620, () => cursor.classList.add("down"));
    at(RELEASE + 640, () => root!.classList.add("clicking"));
    at(RELEASE + 780, () => {
      cursor.classList.remove("down");
      root!.classList.remove("clicking", "picking"); // toolbar goes away
      root!.classList.add("annotating");             // highlight settles amber
      if (liveNote && liveNoteText) {
        liveNoteText.textContent = "";
        liveNote.hidden = false;
        liveNote.classList.add("editing");           // open as a form (sets its height)
        void liveNote.offsetWidth;                   // reflow so height + slide-in are ready
        positionNoteTo(liveNote, targets[0]);        // centre on the line at editing height
        liveNote.classList.add("in");                // slide the margin note in
      }
    });
    // cursor drops into the margin note's field
    at(RELEASE + 900, () => {
      const field = liveNote?.querySelector<HTMLElement>(".ip-mnote-field");
      if (field) moveCursor(field.getBoundingClientRect(), 12, field.offsetHeight / 2, 0.4);
    });

    // 5) the caret blinks and the feedback types itself into the margin note
    const TYPE_START = RELEASE + 1300;
    for (let i = 1; i <= FEEDBACK_NOTE.length; i++) {
      at(TYPE_START + i * 55, () => {
        if (livePh) livePh.style.opacity = "0"; // hide placeholder once typing starts
        if (liveNoteText) liveNoteText.textContent = FEEDBACK_NOTE.slice(0, i);
      });
    }
    const TYPED_DONE = TYPE_START + FEEDBACK_NOTE.length * 55;

    // 6) cursor moves to the note's Save button and clicks it
    at(TYPED_DONE + 260, () => {
      const save = liveNote?.querySelector<HTMLElement>(".ip-mnote-save");
      if (save) moveCursor(save.getBoundingClientRect(), save.offsetWidth / 2 - 2, save.offsetHeight / 2, 0.38);
    });
    at(TYPED_DONE + 720, () => { cursor.classList.add("down"); liveNote?.classList.add("saving"); });

    // 7) saved: the form settles into a plain margin note beside the highlight
    at(TYPED_DONE + 860, () => {
      cursor.classList.remove("down");
      liveNote?.classList.remove("editing", "saving");
      positionNoteTo(liveNote, targets[0]); // recentre now the saved note is shorter
    });
    at(TYPED_DONE + 1160, () => cursor.classList.remove("show"));

    // 8) hold on the finished page (highlight + margin note), then reset and replay
    at(TYPED_DONE + 4200, () => {
      if (playing) return;
      clearVignette();
      at(1500, () => { if (!playing) runVignette(); });
    });
  }

  // Tag the target phrase so the annotation highlight draws across exactly it.
  function markTargetPhrase(): void {
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9']/g, "");
    const target = TARGET_PHRASE.split(/\s+/).map(norm);
    for (let i = 0; i + target.length <= wordSpans.length; i++) {
      if (target.every((tok, k) => norm(wordSpans[i + k].textContent || "") === tok)) {
        for (let k = 0; k < target.length; k++) {
          wordSpans[i + k].classList.add("ip-target");
          // fill each word a beat later so the highlight paints under the drag
          wordSpans[i + k].style.setProperty("--wd", `${(k * 0.16).toFixed(2)}s`);
        }
        return;
      }
    }
  }

  let playing = false;
  let audio: HTMLAudioElement | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let freq: Uint8Array<ArrayBuffer> | null = null;
  let raf = 0;
  let wordRaf = 0;

  // Follow-along: light the word being spoken, so the greeting demos the same
  // "highlight what's being read" effect the reader uses.
  function clearFollow(): void {
    window.cancelAnimationFrame(wordRaf);
    wordSpans.forEach((s) => s.classList.remove("active"));
  }
  function lightWord(idx: number): void {
    for (let i = 0; i < wordSpans.length; i++) wordSpans[i].classList.toggle("active", i === idx);
  }
  function followPremium(voice: VoiceEntry): void {
    const words = voice.words;
    const step = (): void => {
      if (!audio || !playing) return;
      let idx = -1;
      if (words && words.length) {
        const t = audio.currentTime;
        let i = 0;
        while (i < words.length - 1 && words[i + 1].t <= t) i++;
        idx = Math.min(wordSpans.length - 1, i);
      } else if (audio.duration) {
        idx = Math.min(wordSpans.length - 1, Math.floor((audio.currentTime / audio.duration) * wordSpans.length));
      }
      if (idx >= 0) lightWord(idx);
      wordRaf = window.requestAnimationFrame(step);
    };
    step();
  }

  function setPlaying(on: boolean): void {
    playing = on;
    root!.classList.toggle("playing", on);
    playBtn!.setAttribute("aria-label", on ? "Pause the intro" : "Play the intro");
  }

  function resetBars(): void {
    waveEl!.classList.remove("live");
    bars.forEach((b) => (b.style.transform = "scaleY(0.16)"));
  }

  // Drive the little wave from the actual audio (no word timing involved).
  function tick(): void {
    if (analyser && freq) {
      analyser.getByteFrequencyData(freq);
      for (let i = 0; i < bars.length; i++) {
        const v = freq[Math.min(freq.length - 1, i + 1)] / 255;
        bars[i].style.transform = `scaleY(${(0.16 + v * 1.05).toFixed(3)})`;
      }
    }
    raf = window.requestAnimationFrame(tick);
  }

  function stop(): void {
    setPlaying(false);
    window.cancelAnimationFrame(raf);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio = null;
    }
    window.speechSynthesis?.cancel();
    clearFollow();
    resetBars();
    // Replay the annotate demo once playback ends.
    window.setTimeout(() => { if (!playing) runVignette(); }, 500);
  }

  async function startPremium(voice: VoiceEntry): Promise<void> {
    audio = new Audio(voice.file);
    try {
      audioCtx = audioCtx || new AudioContext();
      await audioCtx.resume();
      const source = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch {
      analyser = null;
    }
    audio.onended = stop;
    audio.onerror = () => startFallback();
    await audio.play();
    setPlaying(true);
    followPremium(voice);
    if (analyser) tick();
    else waveEl!.classList.add("live");
  }

  function startFallback(): void {
    audio = null;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1;
    utter.onend = stop;
    utter.onboundary = (event) => {
      const before = (text.slice(0, event.charIndex).match(/\S+/g) || []).length;
      lightWord(Math.min(wordSpans.length - 1, before));
    };
    synth.cancel();
    synth.speak(utter);
    setPlaying(true);
    waveEl!.classList.add("live");
  }

  playBtn.addEventListener("click", () => {
    if (playing) {
      stop();
    } else {
      // Clear the demo (cancel its timers, fold the toolbar) so it doesn't
      // overlay the read; leave the highlight drawn as the resting state.
      clearVignette();
      root!.classList.add("annotating");
      if (voices[current]?.file) void startPremium(voices[current]);
      else startFallback();
    }
  });
}
