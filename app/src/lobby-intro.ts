import { sentenceAt, recordedSentenceCues, type SentenceCue } from "./lobby-timing";
import { initSamplePages } from "./sample-pages";

interface VoiceEntry { name: string; file: string; duration: number; sentences: (SentenceCue & { paragraph: number })[] }
interface Manifest { text: string; voices: VoiceEntry[] }
const VOICE_KEY = "readitout:sample-voice";

/** Bundled audio and its transcript share one manifest. No speech service is used here. */
export function initLobbyIntro(): { stop: () => void; pause: () => void } {
  const root = document.getElementById("introPlayer")!;
  const play = document.getElementById("introPlay") as HTMLButtonElement;
  const seek = document.getElementById("introSeek") as HTMLInputElement;
  const voice = document.getElementById("introVoice") as HTMLSelectElement;
  const text = document.getElementById("introText")!;
  const pages = initSamplePages(() => pause());
  const elapsed = document.getElementById("introElapsed")!;
  const duration = document.getElementById("introDuration")!;
  const status = document.getElementById("introStatus")!;
  let manifest: Manifest | null = null;
  let audio: HTMLAudioElement | null = null;
  let cues: SentenceCue[] = [];
  let spans: HTMLSpanElement[] = [];
  let frame = 0;
  let request = 0;
  let active = -1;
  let buffering = false;

  const clock = (seconds: number): string => {
    const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  };
  function highlight(index: number, follow = false): void {
    if (index === active && !follow) return;
    active = index;
    spans.forEach((span, i) => {
      span.classList.toggle("active", i === index);
      if (i === index) span.setAttribute("aria-current", "true");
      else span.removeAttribute("aria-current");
    });

  }
  function update(follow = false): void {
    if (!audio) return;
    elapsed.textContent = clock(audio.currentTime);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      duration.textContent = clock(audio.duration);
      seek.max = String(audio.duration);
      seek.value = String(audio.currentTime);
      seek.disabled = false;
      seek.setAttribute("aria-valuetext", `${clock(audio.currentTime)} of ${clock(audio.duration)}`);
    }
    const index = audio.ended ? -1 : sentenceAt(cues, audio.currentTime);
    const changed = index !== active;
    highlight(index, follow);
    if (spans[index] && (!audio.paused || changed || follow)) {
      const cue = cues[index];
      pages.follow(spans[index], (audio.currentTime - cue.start) / (cue.end - cue.start));
    }
  }
  function tick(): void {
    update();
    if (audio && !audio.paused) frame = requestAnimationFrame(tick);
  }
  function playing(on: boolean): void {
    root.classList.toggle("playing", on);
    play.setAttribute("aria-label", on ? "Pause the example" : "Play the example");
    play.setAttribute("aria-pressed", String(on));
    cancelAnimationFrame(frame);
    if (on) { update(true); tick(); }
  }
  function pause(): void {
    request++;
    buffering = false;
    play.disabled = Boolean(manifest && !cues.length);
    audio?.pause();
    playing(false);
    if (audio && audio.currentTime > 0) status.textContent = "Paused · resume where you left off";
  }
  function stop(): void {
    request++;
    buffering = false;
    play.disabled = Boolean(manifest && !cues.length);
    audio?.pause();
    if (audio) audio.currentTime = 0;
    playing(false);
    seek.value = "0";
    elapsed.textContent = "0:00";
    highlight(-1);
  }
  function loadVoice(): void {
    stop();
    const entry = manifest?.voices[Number(voice.value) || 0];
    if (!entry || !manifest) return;
    root.classList.remove("has-error");
    const nextCues = recordedSentenceCues(manifest.text, entry.sentences, entry.duration);
    if (!nextCues.length) {
      cues = [];
      audio = null;
      root.classList.add("has-error");
      status.textContent = "The recording is unavailable. You can still read the sample.";
      play.disabled = true;
      seek.disabled = true;
      return;
    }
    cues = nextCues;
    spans = cues.map(cue => {
      const span = document.createElement("span");
      span.className = "ip-sentence";
      span.textContent = cue.text;
      return span;
    });
    const paragraphs: HTMLParagraphElement[] = [];
    spans.forEach((span, i) => {
      const group = entry.sentences[i].paragraph;
      if (!paragraphs[group]) paragraphs[group] = document.createElement("p");
      if (paragraphs[group].childNodes.length) paragraphs[group].append(" ");
      paragraphs[group].append(span);
    });
    text.replaceChildren(...paragraphs);
    spans.at(-1)?.classList.add("ip-marked");
    duration.textContent = "—";
    seek.disabled = true;
    const next = new Audio(entry.file);
    audio = next;
    next.preload = "metadata";
    next.addEventListener("loadedmetadata", () => {
      if (audio !== next) return;
      update(); highlight(-1);
    });
    next.addEventListener("ended", () => {
      if (audio !== next) return;
      playing(false); update();
      status.textContent = "Play again whenever you're ready.";
    });
    next.addEventListener("error", () => {
      if (audio !== next) return;
      playing(false); seek.disabled = true;
      root.classList.add("has-error");
      status.textContent = "The recording couldn't load. Press play to retry.";
    });
    status.textContent = "Recorded example · follows each sentence";
    play.disabled = false;
    next.load();
  }
  async function loadManifest(): Promise<boolean> {
    const intent = request;
    try {
      const response = await fetch("/paper-sample.json");
      if (!response.ok) throw new Error("Missing recording manifest");
      const data = await response.json() as Manifest;
      if (!data.text || !data.voices?.length) throw new Error("Empty recording manifest");
      manifest = data;
      const saved = localStorage.getItem(VOICE_KEY);
      const index = Math.max(0, data.voices.findIndex(entry => entry.name === saved));
      voice.replaceChildren(...data.voices.map((entry, i) => new Option(entry.name, String(i), false, i === index)));
      voice.disabled = false;
      const uninterrupted = intent === request;
      loadVoice();
      return uninterrupted;
    } catch {
      root.classList.add("has-error");
      status.textContent = "The example couldn't load. Press play to retry.";
      play.disabled = false;
      return false;
    }
  }
  voice.addEventListener("change", () => {
    localStorage.setItem(VOICE_KEY, manifest?.voices[Number(voice.value)]?.name ?? "");
    loadVoice();
  });
  play.addEventListener("click", async () => {
    if (buffering) return;
    if (!manifest) {
      buffering = true;
      const ready = await loadManifest();
      buffering = false;
      // A close or manual page turn during the request cancels the playback intent.
      if (!ready) return;
    }
    if (!audio || audio.error) loadVoice();
    if (!audio) return;
    if (!audio.paused) { audio.pause(); playing(false); status.textContent = "Paused · resume where you left off"; return; }
    if (audio.ended) audio.currentTime = 0;
    const current = audio;
    const token = ++request;
    buffering = true;
    play.disabled = true;
    status.textContent = "Loading audio…";
    try {
      await current.play();
      if (token !== request || current !== audio) { current.pause(); return; }
      root.classList.remove("has-error");
      playing(true);
      status.textContent = "Listening · follows each sentence";
    } catch {
      if (token === request) { root.classList.add("has-error"); status.textContent = "Playback couldn't start. Press play to retry."; }
    } finally {
      if (token === request) { buffering = false; play.disabled = false; }
    }
  });
  seek.addEventListener("input", () => {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, Number(seek.value)));
    update(true);
  });
  window.addEventListener("pagehide", stop);
  void loadManifest();
  return { stop, pause };
}
