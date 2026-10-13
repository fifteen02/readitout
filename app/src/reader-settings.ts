import { initVoicePicker } from './voice-picker';
import type { SpeechRequestBody } from './types';
import type { UI } from './ui';
import { prepareBrowserKokoro, cancelBrowserKokoro, onKokoroState, browserKokoroEnabled } from './browser-kokoro';
import { initVoiceNotice } from './voice-notice';

const KEY = 'readitout:voice-settings';
const VOICES = [
  ['af_heart', 'Heart · US'], ['af_bella', 'Bella · US'], ['af_nicole', 'Nicole · US'],
  ['am_michael', 'Michael · US'], ['bf_emma', 'Emma · UK'], ['bf_isabella', 'Isabella · UK'], ['bm_george', 'George · UK']
];

export function initSettings(ui: UI, setStatus: (message: string) => void, stopReading: () => void): void {
  const download = document.getElementById('kokoroDownload') as HTMLButtonElement;
  const cancel = document.getElementById('kokoroCancel') as HTMLButtonElement;
  const status = document.getElementById('kokoroStatus')!;
  const cancelPreparation = () => { stopReading(); cancelBrowserKokoro(); };
  initVoiceNotice(document.querySelector('.readerbar')!, cancelPreparation);
  let preferred = 'af_heart';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (VOICES.some(([id]) => id === saved.voice)) preferred = saved.voice;
  } catch { /* Use the default voice when saved settings are invalid. */ }
  const save = () => localStorage.setItem(KEY, JSON.stringify({voice:ui.voiceSelect.value}));
  for (const select of [ui.voiceSelect, ui.playerVoice]) {
    select.replaceChildren(...VOICES.map(([id, name]) => new Option(name, id)));
    select.value = preferred;
    select.addEventListener('change', () => {
      ui.voiceSelect.value = select.value;
      ui.playerVoice.value = select.value;
      save();
    });
  }
  initVoicePicker(ui.playerVoice, ui.voiceSelect);
  // Discard legacy engine preferences; all reading uses the same local engine.
  save();
  onKokoroState(value => {
    status.textContent = value.phase === "idle" && browserKokoroEnabled() ? "Load the voice for this tab. Saved files will be reused when available." : `${value.message}${value.progress === undefined ? '' : ` ${Math.floor(value.progress)}%`}`;
    download.disabled = value.phase === 'loading' || value.phase === 'ready';
    download.textContent = value.phase === 'ready' ? 'Voice ready' : value.phase === 'loading' ? 'Preparing voice…' : value.phase === 'error' ? 'Retry voice download' : browserKokoroEnabled() ? 'Load reading voice' : 'Download reading voice';
    cancel.hidden = value.phase !== 'loading';
  });
  download.addEventListener('click', async () => {
    try { await prepareBrowserKokoro(); save(); setStatus('Your reading voice is ready. Press play to listen.'); }
    catch (error) { if ((error as Error).name !== 'AbortError') setStatus((error as Error).message); }
  });
  cancel.addEventListener('click', cancelPreparation);
}

export function speechRequest(ui: UI, text: string): SpeechRequestBody {
  return {text, voice:ui.voiceSelect.value};
}
