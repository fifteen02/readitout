import { SpeechBuffer } from './speech-buffer';
import type { AppState } from './types';

/** Local speech arrives in segments; never present this as whole-book progress. */
export function audioProgress(audio: Pick<HTMLAudioElement, 'duration' | 'currentTime'> | null): number | null {
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, audio.currentTime / audio.duration)) * 100);
}

export function syncPlaybackProgress(state: AppState): void {
  const wrap = document.getElementById('playbackProgress');
  if (!wrap) return;
  wrap.hidden = !state.reading;
  const loading = state.activeReadState === 'loading';
  const paused = state.activeReadState === 'paused';
  const rate = Number((document.getElementById('rate') as HTMLInputElement | null)?.value) || state.audio?.playbackRate || 1;
  const current = loading ? state.speechBuffer?.currentSeconds ?? 0 : Math.max(0, (state.audio?.duration || 0) - (state.audio?.currentTime || 0));
  const buffered = Math.max(0, ((state.speechBuffer?.readySeconds() ?? 0) + (Number.isFinite(current) ? current : 0)) / rate);
  const seconds = Math.floor(buffered);
  const label = wrap.querySelector('.playback-label')!;
  wrap.dataset.buffering = String(loading);
  const amount = wrap.querySelector('.buffer-amount') as HTMLElement;
  amount.hidden = false;
  amount.textContent = `${seconds}s ready`;
  label.textContent = 'Buffer';
  wrap.title = loading ? 'Starts with 20 seconds of audio ready, or when the remaining text is fully prepared.' : 'Seconds of completed audio available at the current reading speed.';
  const progress = wrap.querySelector('progress')!;
  progress.hidden = false;
  progress.value = Math.min(100, buffered / SpeechBuffer.startupSeconds * 100);
  progress.setAttribute('aria-valuetext', `${seconds} seconds ready; starts at ${SpeechBuffer.startupSeconds} seconds or when the remaining text is ready`);
  wrap.dataset.playing = String(!loading && !paused && Boolean(state.audio && !state.audio.paused));
}

export function attachPlaybackProgress(state: AppState, audio: HTMLAudioElement): void {
  const update = () => { if (state.audio === audio) syncPlaybackProgress(state); };
  for (const event of ['timeupdate', 'durationchange', 'playing', 'pause', 'ended']) audio.addEventListener(event, update);
  update();
}
