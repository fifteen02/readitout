import type { AppState, ReadItem, ReadState, SpeechRequestBody, PrefetchResult } from "./types";
import type { UI } from "./ui";

export interface PlaybackApi {
  state: AppState;
  ui: UI;
  setStatus: (message: string) => void;
  stopReading: (message?: string) => void;
  speechRequest: (ui: UI, text: string) => SpeechRequestBody;
  activateReadItem?: (item: ReadItem, readState?: ReadState) => void;
  advancePage?: () => Promise<boolean>;
  onPlay?: (audio: HTMLAudioElement) => void;
  onError?: (message: string) => void;
}

export async function playPremiumChunk(api: PlaybackApi): Promise<void> {
  const token = api.state.playToken;
  const stale = () => api.state.playToken !== token;
  try {
    if (api.state.prefetchItem) api.activateReadItem?.(api.state.prefetchItem, "loading");
    const buffered = api.state.prefetch ? await api.state.prefetch : null;
    if (stale()) {
      if (buffered?.url) URL.revokeObjectURL(buffered.url);
      return;
    }
    if (buffered?.error) throw buffered.error;
    const item = buffered?.item || nextItem(api);
    if (!item) {
      if (await api.advancePage?.()) {
        if (stale()) return;
        return playPremiumChunk(api);
      }
      return api.stopReading("Finished reading.");
    }
    api.state.prefetch = null;
    api.state.prefetchItem = null;
    api.activateReadItem?.(item, "loading");
    api.setStatus("Generating premium voice audio...");
    const url = buffered?.url || (await fetchAudio(api, item));
    if (stale()) {
      URL.revokeObjectURL(url);
      return;
    }
    api.state.prefetch = prefetchNext(api);
    const audio = new Audio(url);
    api.state.audio = audio;
    audio.playbackRate = Number(api.ui.rate.value) || 1;
    // Free this chunk's blob before moving to the next paragraph. Without this, every
    // paragraph leaks an object URL; at >1x speed chunks end sooner, so the leak grows
    // faster and eventually crashes the tab. Revoking once here is safe — stop/skip
    // revoke state.audio.src too, but revoking an already-freed URL is a no-op.
    const release = (): void => URL.revokeObjectURL(url);
    audio.onended = () => { release(); void playPremiumChunk(api); };
    audio.onerror = () => { release(); api.stopReading("Audio playback failed."); };
    api.onPlay?.(audio);
    api.activateReadItem?.(item, "playing");
    await audio.play();
    api.setStatus("Reading with premium voice...");
  } catch (error) {
    // Cancelled playback (stale token) or an aborted fetch is expected — stay silent.
    if (stale() || (error as Error)?.name === "AbortError") return;
    const message = `Read-aloud failed: ${(error as Error).message}`;
    api.onError?.(message);
    api.stopReading(message);
  }
}

export function playLocalChunk(api: PlaybackApi): void {
  const token = api.state.playToken;
  const item = nextItem(api);
  if (!item) {
    Promise.resolve(api.advancePage?.()).then((more) => {
      if (api.state.playToken !== token) return;
      if (more) playLocalChunk(api);
      else api.stopReading("Finished reading.");
    });
    return;
  }
  api.activateReadItem?.(item, "playing");
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.rate = Number(api.ui.rate.value);
  const voiceName = api.ui.voiceSelect.value;
  const picked = voiceName ? speechSynthesis.getVoices().find((v) => v.name === voiceName) : undefined;
  if (picked) utterance.voice = picked;
  // Chrome's "Google ..." voices are network voices (localService === false): they call
  // Google's TTS backend, and when that is unreachable they never speak AND never fire an
  // error, so playback hangs with no way to detect it. Watch for the start event instead.
  let started = false;
  let watchdog = 0;
  const clearWatchdog = (): void => {
    if (watchdog) window.clearTimeout(watchdog);
    watchdog = 0;
  };
  utterance.onstart = () => {
    started = true;
    clearWatchdog();
  };
  utterance.onend = () => {
    clearWatchdog();
    if (api.state.playToken !== token) return;
    playLocalChunk(api);
  };
  utterance.onerror = (event) => {
    clearWatchdog();
    // speechSynthesis.cancel() is how stop, next/prev and a mid-read voice change are
    // implemented, and the browser reports that as an error on the utterance being
    // replaced. Treating it as a failure tore down the playback that had just started,
    // so next/prev appeared broken while automatic advance (which ends via onend) worked.
    if (event.error === "canceled" || event.error === "interrupted") return;
    // A newer utterance has taken over; this one's failure is no longer ours to report.
    if (api.state.playToken !== token) return;
    const message = "Local read-aloud stopped by the browser.";
    api.onError?.(message);
    api.stopReading(message);
  };
  speechSynthesis.speak(utterance);
  watchdog = window.setTimeout(() => {
    watchdog = 0;
    if (started || api.state.playToken !== token) return;
    speechSynthesis.cancel();
    const message = picked && !picked.localService
      ? `"${picked.name}" is a network voice and never responded. Pick one marked "on device" in the voice list.`
      : "The browser voice didn't start. Try another voice.";
    api.onError?.(message);
    api.stopReading(message);
  }, 4000);
  api.setStatus("Reading with local browser voice...");
}

// Both supported providers are called straight from the browser, so the app needs no
// backend at all. The free local server runs on the USER's machine (localhost, permissive
// CORS from Kokoro-fastapi by default), and OpenRouter allows browser calls — so an
// OpenRouter key goes from the browser to OpenRouter and touches no server of ours.
export async function fetchSpeech(body: SpeechRequestBody, signal?: AbortSignal): Promise<Blob> {
  // Free local server on the user's machine — browser talks to it directly.
  if (body.provider === "local-server") {
    const base = (body.baseUrl || "http://localhost:8880/v1").replace(/\/+$/, "");
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", voice: body.voice || "af_heart", input: body.text, response_format: "mp3" }),
      signal
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  }
  // OpenRouter allows browser (CORS) calls, so we hit it directly with the user's own
  // key — no backend needed. This keeps the whole app static-deployable.
  if (body.provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Read It Out"
      },
      body: JSON.stringify({
        model: body.model,
        voice: body.voice,
        input: body.text,
        ...(body.instructions ? { instructions: body.instructions } : {}),
        response_format: "mp3"
      }),
      signal
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  }
  // Only "openrouter" and "local-server" are supported. Settings coerces anything else
  // (including an "openai" provider left in storage by an older build) to one of those,
  // so reaching here means the stored settings are corrupt rather than merely stale.
  throw new Error(`Unsupported voice provider "${body.provider}". Choose OpenRouter or Local server in Settings.`);
}

async function fetchAudio(api: PlaybackApi, item: ReadItem): Promise<string> {
  // Share one AbortController across the session's fetches so cancelling playback
  // aborts the outbound request(s) immediately instead of letting a late result play.
  const controller = api.state.playAbort ?? (api.state.playAbort = new AbortController());
  return URL.createObjectURL(await fetchSpeech(api.speechRequest(api.ui, item.text), controller.signal));
}

function prefetchNext(api: PlaybackApi): Promise<PrefetchResult | null> | null {
  const item = nextItem(api);
  api.state.prefetchItem = item;
  return item
    ? fetchAudio(api, item)
        .then((url) => (api.state.reading ? { item, url } : (URL.revokeObjectURL(url), null)))
        .catch((error) => ({ error }))
    : null;
}

export function chunkText(text: string, meta: Partial<ReadItem> = {}): ReadItem[] {
  const chunks: ReadItem[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?]+[.!?]*/g) || [text]) {
    if ((current + sentence).length > 2800) {
      chunks.push({ ...meta, text: current.trim() });
      current = "";
    }
    current += `${sentence} `;
  }
  if (current.trim()) chunks.push({ ...meta, text: current.trim() });
  return chunks;
}

function nextItem(api: PlaybackApi): ReadItem | null {
  const item = api.state.chunks.shift();
  if (!item) return null;
  return typeof item === "string" ? { text: item } : item;
}
