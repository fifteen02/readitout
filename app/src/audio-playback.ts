import { generateBrowserSpeech } from "./browser-kokoro";
import type { AppState, ReadItem, ReadState, SpeechRequestBody } from "./types";
import { syncPlaybackProgress } from "./playback-progress";
import { SpeechBuffer } from "./speech-buffer";
import { splitKokoroText } from "./kokoro-audio";
import type { UI } from "./ui";

export interface PlaybackApi {
  state: AppState;
  ui: UI;
  setStatus: (message: string) => void;
  stopReading: (message?: string) => void;
  speechRequest: (ui: UI, text: string) => SpeechRequestBody;
  activateReadItem?: (item: ReadItem, readState?: ReadState) => void;
  nextPage?: (after: number) => Promise<ReadItem[]>;
  onPlay?: (audio: HTMLAudioElement) => void;
  onError?: (message: string) => void;
}

export async function playKokoroChunk(api: PlaybackApi): Promise<void> {
  const transitionStarted = performance.now();
  const token = api.state.playToken;
  const stale = () => api.state.playToken !== token;
  try {
    const starting = !api.state.speechBuffer;
    const buffer = api.state.speechBuffer ??= createSpeechBuffer(api);
    const entry = await buffer.take();
    if (stale()) return;
    if (!entry) return api.stopReading("Finished reading.");
    api.state.playAbort = entry.controller;
    const item = entry.item;
    api.activateReadItem?.(item, "loading");
    api.setStatus("Preparing speech on this device…");
    const depleted = entry.seconds === 0;
    const result = await entry.audio;
    if (result.blob && (starting || depleted)) {
      await buffer.prepareAhead(entry.seconds, () => Number(api.ui.rate.value) || 1);
    }
    const audioReadyAt = performance.now();
    if (stale()) return;
    if (result.error) throw result.error;
    if (!result.blob) throw new Error("The voice returned no audio.");
    const url = URL.createObjectURL(result.blob);
    const audio = new Audio(url);
    api.state.audio = audio;
    audio.playbackRate = Number(api.ui.rate.value) || 1;
    // Free this chunk's blob before moving to the next paragraph. Without this, every
    // paragraph leaks an object URL; at >1x speed chunks end sooner, so the leak grows
    // faster and eventually crashes the tab. Revoking once here is safe — stop/skip
    // revoke state.audio.src too, but revoking an already-freed URL is a no-op.
    const release = (): void => URL.revokeObjectURL(url);
    audio.onended = () => { release(); if (!stale()) void playKokoroChunk(api); };
    audio.onerror = () => { release(); if (!stale()) api.stopReading("Audio playback failed."); };
    api.onPlay?.(audio);
    api.activateReadItem?.(item, "playing");
    await audio.play();
    console.debug('[speech playback]', JSON.stringify({waitMs:Math.round(audioReadyAt-transitionStarted), startMs:Math.round(performance.now()-audioReadyAt)}));
    if (!stale()) api.setStatus("Reading aloud on this device…");
  } catch (error) {
    // Cancelled playback (stale token) or an aborted fetch is expected — stay silent.
    if (stale() || (error as Error)?.name === "AbortError") return;
    const message = `Read-aloud failed: ${(error as Error).message}`;
    api.onError?.(message);
    api.stopReading(message);
  }
}

export async function fetchSpeech(body: SpeechRequestBody, signal?: AbortSignal): Promise<Blob> {
  return generateBrowserSpeech(body.text, body.voice || 'af_heart', signal);
}

function createSpeechBuffer(api: PlaybackApi): SpeechBuffer {
  const { state } = api;
  const voice = api.speechRequest(api.ui, "").voice;
  let throughPage = state.chunks.at(-1)?.page ?? state.readingPage ?? state.page;
  const document = state.pdf;
  let buffer: SpeechBuffer;
  buffer = new SpeechBuffer(async () => {
    if (!state.chunks.length) {
      const items = await api.nextPage?.(throughPage) ?? [];
      // Page extraction can finish after stop, a voice change, or a different PDF.
      if (state.speechBuffer !== buffer || state.pdf !== document) return null;
      if (!items.length) return null;
      throughPage = items.at(-1)?.page ?? throughPage;
      state.chunks.push(...items);
    }
    return state.chunks.shift() ?? null;
  }, (item, signal) => fetchSpeech({text: item.text, voice}, signal), 4, () => {
    if (state.speechBuffer === buffer) syncPlaybackProgress(state);
  });
  return buffer;
}

export function chunkText(text: string, meta: Partial<ReadItem> = {}): ReadItem[] {
  // Short speech units start sooner than waiting for a whole 2,800-character passage.
  // Preserve the page/marker on every unit so highlighting and navigation still agree.
  try { return splitKokoroText(text).map(part => ({ ...meta, text: part })); }
  catch {
    // Let the worker report unsupported text through the normal playback error UI,
    // rather than throwing out of the PDF/read-button event handler.
    return text.trim() ? [{ ...meta, text: text.trim() }] : [];
  }
}
