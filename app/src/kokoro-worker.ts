import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import wasmUrl from '../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from '../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import { pcmToWav, splitKokoroText } from './kokoro-audio';
import type { KokoroState } from './browser-kokoro';

// Self-host the runtime; only public model/voice files come from Hugging Face.
env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
// Shared WASM memory requires an isolated page. Keep a safe single-thread
// fallback for hosts that do not supply the isolation headers.
env.backends.onnx.wasm!.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
let model: Promise<KokoroTTS> | undefined;
let queue = Promise.resolve();
const cancelled = new Set<number>();
const queued = new Set<number>();
const scope = self as unknown as { postMessage: (value: unknown, transfer?: Transferable[]) => void; onmessage: ((event: MessageEvent) => void) | null };
const modelStatus = (stage: KokoroState['stage'], message: string, progress?: number, loaded?: number, total?: number) => scope.postMessage({type:'model-status', stage, message, progress, loaded, total});

function load(): Promise<KokoroTTS> {
  if (model) return model;
  modelStatus('checking', 'Loading your reading voice…');
  return model ??= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype:'q8', device:'wasm',
    progress_callback: progress => {
      // Only the model file owns the percentage; tokenizer/config files must not
      // reset the bar or imply that the whole download is already complete.
      if ('file' in progress && progress.file.endsWith('.onnx')) {
        if (progress.status === 'progress') modelStatus('downloading', 'Downloading reading voice…', progress.progress, progress.loaded, progress.total);
        else if (progress.status === 'download') modelStatus('downloading', 'Downloading reading voice…');
        else if (progress.status === 'done') modelStatus('preparing', 'Preparing your reading voice…');
      }
    }
  }).then(tts => { modelStatus('preparing', 'Preparing your reading voice…'); return tts; })
    .catch(error => { model = undefined; throw error; });
}

scope.onmessage = (event: MessageEvent<{id: number; type: 'load' | 'generate' | 'cancel'; text?: string; voice?: string}>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (queued.has(request.id)) cancelled.add(request.id);
    return;
  }
  queued.add(request.id);
  // ONNX and the phonemizer share state. Serializing also keeps reader prefetch safe.
  queue = queue.then(async () => {
    try {
      if (cancelled.has(request.id)) return;
      const tts = await load();
      if (cancelled.has(request.id)) { scope.postMessage({type:'ready'}); return; }
      if (request.type === 'load') {
        // Load a voice and warm the model now, while progress is visible.
        await tts.generate('Ready.', {voice:'af_heart'});
        if (cancelled.has(request.id)) return;
        scope.postMessage({type:'ready'});
        scope.postMessage({id:request.id});
        return;
      }
      scope.postMessage({type:'ready'});
      const text = splitKokoroText(request.text || '');
      if (!text.length) throw new Error('Choose a passage to read.');
      const voice = request.voice as keyof typeof tts.voices;
      if (!Object.hasOwn(tts.voices, voice)) throw new Error('Choose one of the Kokoro voices.');
      const parts: Float32Array[] = [];
      const started = performance.now();
      const totalChars = text.reduce((sum, part) => sum + part.length, 0);
      let completedChars = 0;
      const report = (completed: number) => scope.postMessage({type:'speech-progress', speech: {
        id: request.id, completed, total: text.length, completedChars, totalChars, elapsedMs: performance.now() - started
      }});
      report(0);
      for (const [i, sentence] of text.entries()) {
        const audio = await tts.generate(sentence, {voice});
        if (cancelled.has(request.id)) return;
        parts.push(audio.audio);
        completedChars += sentence.length;
        report(i + 1);
      }
      const buffer = pcmToWav(parts);
      scope.postMessage({type:'speech-timing', message: JSON.stringify({generationMs:Math.round(performance.now()-started), audioMs:Math.round((buffer.byteLength-44)/48), characters:totalChars})});
      scope.postMessage({id:request.id, buffer}, [buffer]);
    } catch (error) {
      if (!cancelled.has(request.id)) scope.postMessage({id:request.id, error:(error as Error).message || 'The local voice could not start.'});
    } finally { cancelled.delete(request.id); queued.delete(request.id); }
  });
};
