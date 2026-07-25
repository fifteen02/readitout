import { setReadMarkerState } from "./read-markers";
import type { AppState, ReadItem, ReadState } from "./types";
import type { UI } from "./ui";

export interface ReaderActions {
  toggle: () => void;
  goto: () => void;
  skip: (direction: number) => void;
  restart: () => void;
}

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.1v13.8a1 1 0 0 0 1.53.85l11-6.9a1 1 0 0 0 0-1.7l-11-6.9A1 1 0 0 0 8 5.1Z" fill="currentColor"/></svg>';
const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="22" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.5" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.5" fill="currentColor"/></svg>';
// Animated equaliser shown on the play disc while a TTS chunk is being generated —
// on-brand (matches the app's waveform motif) and clearly "working".
const LOADING_ICON = '<span class="eq-load rp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

export function initReaderPlayer(ui: UI, actions: ReaderActions): void {
  ui.playerPlay.addEventListener("click", actions.toggle);
  ui.playerPrev.addEventListener("click", () => actions.skip(-1));
  ui.playerNext.addEventListener("click", () => actions.skip(1));
  ui.playerGoto.addEventListener("click", actions.goto);
  ui.playerVoice.addEventListener("change", () => {
    ui.voiceSelect.value = ui.playerVoice.value;
    actions.restart(); // swap the voice immediately (re-reads the current paragraph)
  });
  ui.playerRate.addEventListener("input", () => {
    ui.rate.value = ui.playerRate.value;
    ui.rate.dispatchEvent(new Event("input")); // single source of truth: updates labels + live audio
  });
  ui.voiceSelect.addEventListener("change", () => {
    ui.playerVoice.value = ui.voiceSelect.value;
    actions.restart();
  });
}

export function syncReaderPlayer(ui: UI, state: AppState): void {
  const canRead = Boolean(state.pdf);
  const active = state.reading;
  ui.playerPlay.disabled = !canRead;
  ui.playerPrev.disabled = !active;
  ui.playerNext.disabled = !active;
  ui.playerGoto.disabled = !active;
  const loading = active && state.activeReadState === "loading";
  const playing = active && state.activeReadState !== "paused" && !loading;
  ui.app.classList.toggle("is-reading", active);
  ui.app.classList.toggle("is-paused", active && state.activeReadState === "paused");
  ui.app.classList.toggle("is-loading", loading);
  ui.playerPlay.classList.toggle("loading", loading);
  ui.playerPlay.innerHTML = loading ? LOADING_ICON : playing ? PAUSE_ICON : PLAY_ICON;
  ui.playerPlay.title = loading ? "Loading…" : playing ? "Pause" : "Play";
  ui.playerPlay.setAttribute("aria-label", loading ? "Loading audio" : playing ? "Pause" : "Play");
  ui.playerVoice.value = ui.voiceSelect.value;
  ui.playerRate.value = ui.rate.value;
  ui.playerRateValue.textContent = `${Number(ui.rate.value).toFixed(1)}x`;
}

export function activateReaderItem(
  ui: UI,
  state: AppState,
  item: ReadItem,
  readState: ReadState,
  updatePageControls: () => void
): void {
  if (item.page) state.page = item.page;
  if (state.currentReadItem && state.currentReadItem !== item && readState === "loading") {
    state.readHistory.push(state.currentReadItem);
  }
  state.currentReadItem = item;
  state.activeMarker = item.markerId || null;
  state.activeReadState = state.activeMarker ? readState : "idle";
  setReadMarkerState(state.activeMarker, state.activeReadState);
  updatePageControls();
  syncReaderPlayer(ui, state);
}

export function setReaderButtons(ui: UI, state: AppState, active: boolean): void {
  [ui.pauseRead, ui.resumeRead, ui.stopRead, ui.gotoRead].forEach((button) => {
    button.disabled = !active;
  });
  syncReaderPlayer(ui, state);
}

export function readerPlayerActions(
  ui: UI,
  state: AppState,
  playCurrentQueue: () => void,
  stopReading: (message?: string) => void,
  setSpeechButtons: (active: boolean) => void
): ReaderActions {
  const stopActiveAudio = (): void => {
    speechSynthesis.cancel();
    state.playAbort?.abort(); // cancel any outbound TTS request before starting the next
    state.playAbort = null;
    if (state.audio) {
      state.audio.pause();
      URL.revokeObjectURL(state.audio.src);
    }
    state.audio = null;
  };
  return {
    toggle: () =>
      state.reading
        ? state.activeReadState === "paused"
          ? ui.resumeRead.click()
          : ui.pauseRead.click()
        : ui.readPage.click(),
    goto: () => ui.gotoRead.click(),
    skip: (direction: number) => {
      if (!state.reading) return;
      // Invalidate any in-flight fetch/prefetch so a late result from the paragraph we
      // just skipped away from can't come back and play over the new one.
      state.playToken += 1;
      if (direction < 0) {
        const previous = state.readHistory.pop();
        if (!previous) return;
        const queue = [previous, state.currentReadItem, state.prefetchItem, ...state.chunks].filter(
          Boolean
        ) as ReadItem[];
        stopReading("");
        state.chunks = queue;
        state.reading = true;
        setSpeechButtons(true);
      } else {
        stopActiveAudio();
      }
      playCurrentQueue();
    },
    // Re-read from the current paragraph — used when the voice changes mid-read so the
    // switch is immediate rather than only affecting the next paragraph.
    restart: () => {
      if (!state.reading) return;
      state.playToken += 1; // drop any in-flight fetch with the old voice
      const queue = [state.currentReadItem, state.prefetchItem, ...state.chunks].filter(Boolean) as ReadItem[];
      if (!queue.length) return;
      stopReading("");
      state.chunks = queue;
      state.reading = true;
      setSpeechButtons(true);
      playCurrentQueue();
    }
  };
}
