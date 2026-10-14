import { deskIcon } from './desk-icons';
import { createVoiceNoticeSurface } from './voice-notice-surface';
import { onKokoroState, prepareBrowserKokoro, type KokoroState } from './browser-kokoro';
import { TransferEstimator, duration } from './voice-progress';

/** Model setup and actionable failures only; passage buffering stays in the player. */
export function initVoiceNotice(player: HTMLElement, cancel: () => void): void {
  const notice = document.createElement('section');
  notice.className = 'voice-notice';
  notice.hidden = true;
  notice.setAttribute('aria-label', 'Reading voice preparation');
  notice.innerHTML = `<span class="voice-notice-icon" aria-hidden="true"></span><div class="voice-notice-copy">
    <strong class="voice-notice-title" role="status" aria-live="polite"></strong>
    <span class="voice-notice-detail"></span>
  </div><div class="voice-notice-meter"><progress max="100" aria-label="Reading voice download"></progress><span class="voice-notice-percent" aria-hidden="true"></span></div>
  <button class="voice-notice-action" type="button">Cancel</button>`;
  player.prepend(notice);
  const surface = createVoiceNoticeSurface(notice, player);
  const icon = notice.querySelector<HTMLElement>('.voice-notice-icon')!;
  const title = notice.querySelector<HTMLElement>('.voice-notice-title')!;
  const detail = notice.querySelector<HTMLElement>('.voice-notice-detail')!;
  const meter = notice.querySelector<HTMLElement>('.voice-notice-meter')!;
  const progress = notice.querySelector('progress')!;
  const percent = notice.querySelector<HTMLElement>('.voice-notice-percent')!;
  const action = notice.querySelector('button')!;
  let current: KokoroState = {phase:'idle', message:''};
  let stageStarted = performance.now();
  let transfer = new TransferEstimator();
  let readyUntil = 0, wasLoading = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const hide = () => surface.hide(current.phase === 'ready');
  function render(): void {
    const now = performance.now();
    const loading = current.phase === 'loading';
    if (!loading && current.phase !== 'error' && now >= readyUntil) { hide(); return; }
    surface.show();
    const phase = loading ? 'loading' : current.phase;
    if (notice.dataset.phase !== phase) {
      notice.dataset.phase = phase;
      icon.innerHTML = deskIcon(phase === 'error' ? 'alert' : phase === 'ready' ? 'check' : 'loading');
    }
    meter.hidden = !loading;
    progress.removeAttribute('value');
    percent.textContent = '';
    action.textContent = loading ? 'Cancel' : current.phase === 'error' ? 'Retry' : 'Dismiss';
    const elapsed = duration((now - stageStarted) / 1000);
    title.textContent = current.phase === 'error' ? 'The reading voice couldn’t load' : current.phase === 'ready' ? 'Your reading voice is ready' : current.message;
    progress.setAttribute('aria-label', current.stage === 'downloading' ? 'Reading voice download' : 'Reading voice preparation');
    if (current.progress !== undefined && current.phase === 'loading') {
      progress.value = current.progress;
      percent.textContent = `${Math.floor(current.progress)}%`;
    }
    if (current.phase === 'error') detail.textContent = `${current.message} You can retry here.`;
    else if (current.phase === 'ready') detail.textContent = current.message;
    else if (current.stage === 'downloading') {
      const measured = transfer.read(now);
      const bytes = current.total && current.loaded !== undefined ? `${(current.loaded / 1e6).toFixed(1)} / ${(current.total / 1e6).toFixed(1)} MB` : 'Downloading voice files';
      const rate = measured.bytesPerSecond ? ` · ${(measured.bytesPerSecond / 1e6).toFixed(1)} MB/s` : '';
      const eta = measured.secondsLeft === undefined ? ' · estimating download time…' : ` · about ${duration(measured.secondsLeft)} left to download`;
      detail.textContent = bytes + rate + eta;
    } else detail.textContent = `${current.device === 'webgpu' ? 'GPU' : current.device === 'wasm' ? 'CPU' : 'On-device'} · ${elapsed} elapsed · ${current.stage === 'preparing' ? 'Warming up the voice. Time remaining isn’t available yet.' : 'Checking saved files on this device.'}`;
  }
  function schedule(): void {
    if (ticker) clearInterval(ticker);
    ticker = undefined;
    if (current.phase === 'loading' || readyUntil > performance.now()) ticker = setInterval(() => {
      render();
      if (current.phase !== 'loading' && performance.now() >= readyUntil) {
        clearInterval(ticker); ticker = undefined;
      }
    }, 1000);
  }
  onKokoroState(value => {
    const now = performance.now();
    if (value.stage !== current.stage || value.phase !== current.phase) {
      stageStarted = now;
      if (value.stage === 'downloading') transfer = new TransferEstimator();
    }
    if (value.loaded !== undefined && value.total !== undefined) transfer.sample(value.loaded, value.total, now);
    if (value.phase === 'ready' && wasLoading) readyUntil = now + 2500;
    if (value.phase !== 'ready') readyUntil = 0;
    wasLoading = value.phase === 'loading';
    current = value;
    render(); schedule();
  });
  action.addEventListener('click', () => {
    if (current.phase === 'loading') cancel();
    else if (current.phase === 'error') void prepareBrowserKokoro().catch(() => { /* State carries the failure. */ });
    else { readyUntil = 0; hide(); }
  });
}
