# Read It Out

A TypeScript + Vite PDF reader for hearing and reviewing a draft. Kokoro is the standard
speech model, running in a dedicated browser worker. The optional Node server serves
static files only. There are no cloud voice providers, API keys, or speech proxy endpoints.

## Develop

Use Node 22.13+ (required by the PDF dependency).

```sh
npm install
npm run dev:web
```

Open http://localhost:5273. Open a PDF, then use **Settings → Reading voice → Download
reading voice**. About 120 MB of runtime, model, tokenizer, and voice assets are needed
on first use. The browser caches downloaded files when storage allows. The English Kokoro
q8 model uses ONNX Runtime WebAssembly, one thread, without cross-origin isolation.
Inference runs off the UI thread; speed depends on the device. User text is never sent to a speech service.

## Lobby audio

The lobby plays shipped MP3 files, so visitors can hear the sample before downloading
Kokoro. To regenerate Heart and Emma locally (Node and ffmpeg required):

```sh
npm run sample:audio
```

The first run downloads Kokoro for local Node inference. Each sentence is synthesized
separately, joined as PCM, and encoded to MP3. `public/paper-sample.json` records boundaries
from PCM sample counts. Both sample PDFs use the exact transcript of the first page.
The `greeting` command is an alias for this local recorder. Older greeting files remain as legacy assets; the app does not use them.

## Validate and build

```sh
npm run typecheck
npx tsx --test tests/kokoro.test.ts tests/lobby-timing.test.ts
npm run build
npm start
```

The build emits a separate Kokoro worker, JavaScript runtime and WASM asset. They are loaded
only when a reader downloads/uses the voice. The standard build remains static-deployable.
`npm start` serves `dist/public` at http://localhost:4173; `PORT` changes the port.

## Hosting

Firebase configuration and the optional static server both permit the specific WASM
execution capability and Hugging Face model downloads. Runtime JavaScript/WASM are served
from the app origin. `.wasm` and `.mjs` have explicit MIME types. No API key is bundled.
Analytics remains restricted to the hosted readitout.me hostname; see the root README.

## Code map

- `src/browser-kokoro.ts`: lazy worker, progress, consent, cancellation and retry.
- `src/kokoro-worker.ts`: cached model, serialized generation, bounded input chunks.
- `src/kokoro-audio.ts`: text chunking and PCM/WAV encoding.
- `src/reader-settings.ts`: voice choice and download controls for the single reading engine.
- `src/audio-playback.ts`: playback/prefetch queue, using local generated audio.
- `src/lobby-intro.ts`: prerecorded manuscript playback with exact sentence timing.
- `src/word-highlight.ts`: existing reader word pacing is estimated for generated audio;
  it is distinct from the exact sentence timing of the lobby recording.

Download cancellation terminates the worker and rejects all pending requests. A subsequent
attempt creates a new worker and can reuse already cached files. Model initialization or
inference failure leaves a retry action available. There is no alternate engine or system-voice fallback.
