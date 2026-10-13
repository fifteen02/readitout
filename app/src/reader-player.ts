import { syncPlaybackProgress } from './playback-progress';
import { deskIcon } from "./desk-icons";
import { setReadMarkerState } from "./read-markers";
import type { AppState, ReadItem, ReadState } from "./types";
import type { UI } from "./ui";

export interface ReaderActions {
  toggle: () => void;
  goto: () => void;
  skip: (direction: number) => void;
  restart: () => void;
}

const LISTEN_ICON = deskIcon("listen");
const PLAY_ICON = deskIcon("play");
const PAUSE_ICON = deskIcon("pause");
// An hourglass marks preparation without implying that sound is already playing.
const LOADING_ICON = deskIcon("loading");

export function initReaderPlayer(ui: UI, actions: ReaderActions): void {
  const progress = document.createElement('div');
  progress.id = 'playbackProgress';
  progress.hidden = true;
  progress.title = 'Audio buffer';
  progress.innerHTML = '<span class="playback-label">Buffer</span><span class="buffer-amount"></span><progress max="100" value="0" aria-label="Audio buffer reserve"></progress>';
  document.getElementById('railSettings')!.before(progress);
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
  syncPlaybackProgress(state);
  const canRead = Boolean(state.pdf);
  const active = state.reading;
  ui.playerPlay.disabled = !canRead;
  ui.playerPrev.disabled = !active || !state.readHistory.length;
  ui.playerNext.disabled = !active;
  ui.playerGoto.disabled = !active;
  const loading = active && state.activeReadState === "loading";
  const playing = active && state.activeReadState !== "paused" && !loading;
  ui.app.classList.toggle("is-reading", active);
  ui.app.classList.toggle("is-paused", active && state.activeReadState === "paused");
  ui.app.classList.toggle("is-loading", loading);
  ui.playerPlay.classList.toggle("loading", loading);
  const label = loading ? "Preparing" : playing ? "Pause" : active ? "Resume" : "Listen";
  ui.playerPlay.innerHTML = loading ? LOADING_ICON : playing ? PAUSE_ICON : active ? PLAY_ICON : LISTEN_ICON;
  ui.playerPlay.title = loading ? "Cancel audio preparation" : `${label} (Space)`;
  ui.playerPlay.setAttribute("aria-label", loading ? "Preparing audio — cancel" : playing ? "Pause reading" : active ? "Resume reading" : "Listen to your draft");
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
  state.activeReadState = readState;
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
    state.playAbort?.abort(); // cancel pending voice generation before starting the next
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
      if (!state.reading || (direction < 0 && !state.readHistory.length)) return;
      // Invalidate any in-flight fetch/prefetch so a late result from the paragraph we
      // just skipped away from can't come back and play over the new one.
      state.playToken += 1;
      if (direction < 0) {
        const previous = state.readHistory.pop();
        if (!previous) return;
        const queue = [previous, state.currentReadItem, ...(state.speechBuffer?.upcoming() ?? []), ...state.chunks].filter(
          Boolean
        ) as ReadItem[];
        const history = [...state.readHistory];
        stopReading("");
        state.readHistory = history;
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
      const queue = [state.currentReadItem, ...(state.speechBuffer?.upcoming() ?? []), ...state.chunks].filter(Boolean) as ReadItem[];
      if (!queue.length) return;
      stopReading("");
      state.chunks = queue;
      state.reading = true;
      setSpeechButtons(true);
      playCurrentQueue();
    }
  };
}
