export interface KokoroState {
  device?: 'webgpu' | 'wasm';
  phase: 'idle' | 'loading' | 'ready' | 'error';
  message: string;
  stage?: 'checking' | 'downloading' | 'preparing';
  progress?: number;
  loaded?: number;
  total?: number;
}
export interface SpeechProgress { id: number; completed: number; total: number; completedChars: number; totalChars: number; elapsedMs: number; }
const speechListeners = new Set<(value: SpeechProgress | null) => void>();
let speechProgress: SpeechProgress | null = null;
function updateSpeech(value: SpeechProgress | null): void {
  speechProgress = value;
  speechListeners.forEach(listener => listener(value));
}
export function onSpeechProgress(listener: (value: SpeechProgress | null) => void): () => void {
  speechListeners.add(listener); listener(speechProgress); return () => speechListeners.delete(listener);
}
const CONSENT = 'readitout:browser-kokoro-enabled';
let state: KokoroState = {phase:'idle', message:'Download the voice once to read on this device.'};
let worker: Worker | undefined;
let nextId = 0;
let loading: Promise<void> | undefined;
const listeners = new Set<(value: KokoroState) => void>();
const pending = new Map<number, {resolve: (buffer?: ArrayBuffer) => void; reject: (error: Error) => void; cleanup: () => void}>();
function update(phase: KokoroState['phase'], message: string, stage?: KokoroState['stage'], progress?: number, loaded?: number, total?: number): void {
  state = {phase, message, stage, loaded, total, device: state.device, progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress!)) : undefined};
  listeners.forEach(listener => listener(state));
}
export function onKokoroState(listener: (value: KokoroState) => void): () => void {
  listeners.add(listener); listener(state); return () => listeners.delete(listener);
}
function reset(error: Error): void {
  state = {...state, device: undefined};
  worker?.terminate(); worker = undefined; loading = undefined;
  for (const item of pending.values()) { item.cleanup(); item.reject(error); }
  pending.clear();
  updateSpeech(null);
}
export function cancelBrowserKokoro(): void {
  reset(new DOMException('Voice preparation cancelled.', 'AbortError'));
  update('idle', 'Cancelled. Downloaded files may be reused when you try again.');
}
function voiceReadyMessage(): string {
  return `Voice ready · ${state.device === 'webgpu' ? 'GPU accelerated' : 'CPU'}. Your text stays on this device.`;
}
function getWorker(): Worker {
  if (worker) return worker;
  const current = new Worker(new URL('./kokoro-worker.ts', import.meta.url), {type:'module'});
  worker = current;
  worker.onmessage = (event: MessageEvent<{id?: number; type?: string; device?: KokoroState['device']; message?: string; error?: string; buffer?: ArrayBuffer; stage?: KokoroState['stage']; progress?: number; loaded?: number; total?: number; speech?: SpeechProgress}>) => {
    if (worker !== current) return;
    const data = event.data;
    if (data.type === 'backend') { state = {...state, device:data.device}; return; }
    if (data.type === 'speech-timing') { console.debug('[speech generation]', data.message); return; }
    if (data.type === 'model-status') { update('loading', data.message!, data.stage, data.progress, data.loaded, data.total); return; }
    if (data.type === 'speech-progress' && data.speech && pending.has(data.speech.id)) { updateSpeech(data.speech); return; }
    // Speech generation and prefetch are not model downloads.
    if (data.type === 'status') { return; }
    if (data.type === 'ready') { update('ready', voiceReadyMessage()); return; }
    if (data.id === undefined) return;
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id); item.cleanup();
    if (speechProgress?.id === data.id) updateSpeech(null);
    if (data.error) { update('error', data.error); item.reject(new Error(data.error)); } else item.resolve(data.buffer);
  };
  worker.onerror = () => {
    if (worker !== current) return;
    const error = new Error('The on-device voice could not start. Try loading the reading voice again.');
    reset(error); update('error', error.message);
  };
  return worker;
}
function request(type: 'load' | 'generate', text?: string, voice?: string, signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      item.cleanup();
      if (speechProgress?.id === id) updateSpeech(null);
      // Cancel only this utterance. Keep the warmed model and unrelated lookahead.
      worker?.postMessage({type:'cancel', id});
      item.reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      const error = new Error('Voice preparation took too long. Try loading the reading voice again.');
      reset(error); update('error', error.message);
    }, 300_000);
    signal?.addEventListener('abort', abort, {once:true});
    pending.set(id, {resolve, reject, cleanup:() => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }});
    try { getWorker().postMessage({id,type,text,voice}); }
    catch (error) { reset(error as Error); update('error', (error as Error).message); }
  });
}
export async function prepareBrowserKokoro(): Promise<void> {
  if (state.phase === 'ready') return;
  if (loading) return loading;
  update('loading', 'Loading your reading voice…', 'checking');
  const operation = request('load').then(() => {
    localStorage.setItem(CONSENT, '1');
    update('ready', voiceReadyMessage());
  }).catch(error => {
    if (error.name !== 'AbortError') update('error', `${error.message} Try loading the reading voice again.`);
    throw error;
  }).finally(() => { if (loading === operation) loading = undefined; });
  loading = operation;
  return operation;
}
export async function generateBrowserSpeech(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (localStorage.getItem(CONSENT) !== '1') throw new Error('Choose Download reading voice in Settings first (about 120–450 MB).');
  // A new tab reloads cached model files, without transmitting text.
  if (!worker) update('loading', 'Loading your reading voice…', 'checking');
  const buffer = await request('generate', text, voice, signal);
  if (!buffer) throw new Error('The voice returned no audio. Try again.');
  return new Blob([buffer], {type:'audio/wav'});
}

export function browserKokoroEnabled(): boolean { return localStorage.getItem(CONSENT) === '1'; }
