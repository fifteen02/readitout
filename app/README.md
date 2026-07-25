# Read It Out

A PDF reader that reads documents aloud, keeps the line being read highlighted, and turns
margin notes into something you can export. TypeScript + Vite front-end with a small typed
Node API server.

Live at **[readitout.me](https://readitout.me)**.

Everything runs in the browser. No account, no upload, and the file never leaves your
machine. The Node server exists only as an optional proxy for premium voices. Analytics
runs on the hosted site only; self-hosted builds send nothing (see the root README).

- Read-aloud via the free browser voice, OpenRouter (Kokoro / Grok / MAI) with your own
  key, or a self-hosted Kokoro server
- Highlights, notes and tags, with colour filtering and grouping by outline section
- Export as Markdown, JSON, or LLM-ready text
- Pomodoro focus timer and a focus-line reading mode

## Develop

```bash
npm install
npm run dev
```

- `npm run dev` runs the Vite dev server (front-end, http://localhost:5273) **and** the API server (http://localhost:4173) together. Vite proxies `/api/*` to the API server.
- Open http://localhost:5273.

To enable premium read-aloud, paste an API key in **Settings**, or set an env var before `npm run dev`:

```bash
OPENROUTER_API_KEY=sk-or-... npm run dev   # OpenRouter: Kokoro (with word highlighting), Grok, MAI
```

The default premium engine is **Kokoro** via OpenRouter: cheap voices whose word
timings are recovered by a Whisper alignment pass, so words highlight as they're
read, all on one OpenRouter key. The free local browser voice also highlights.

Prefer no key at all? Run Kokoro locally with Docker (see **Settings → Run free voices
locally**) and point the app at `http://localhost:8880/v1`.

## Lobby greeting

The welcome screen plays a short greeting that reads itself aloud and animates an
annotation. Record it (once) in a few Kokoro voices via OpenRouter:

```bash
npm run greeting     # prompts for your OpenRouter key (hidden)
# or: task greeting
# pick voices: task greeting:voices VOICES=af_heart,bm_george
```

This writes `public/greeting-<voice>.mp3` + `public/greeting.json` (text + per-word
timings). The lobby picks them up automatically and offers a voice switcher.

## Type-check

```bash
npm run typecheck   # front-end (tsconfig.json) + server (tsconfig.server.json)
```

## Build & run (production)

```bash
npm run build       # type-checks, builds the front-end to dist/public, bundles the server to dist/server.js
npm start           # serves the built app + API on http://localhost:4173 (set PORT to change)
```

`dist/server.js` serves the static front-end from `dist/public` and handles `/api/speech` and `/api/models`.

## Deploy

The app is fully static, so Firebase Hosting is the simplest route:

```bash
npm run deploy:firebase
```

See [DEPLOY.md](DEPLOY.md) for the Firebase and Cloud Run options.

## Layout

```
  index.html            Vite entry
  Taskfile.yml          `task greeting` records the lobby greeting
  scripts/
    generate-greeting.mjs  Kokoro + Whisper greeting recorder (OpenRouter)
  src/
    main.ts             app bootstrap + wiring
    types.ts            shared domain types
    ui.ts               typed DOM element map
    analytics.ts        gtag wrapper for usage events
    reader-settings.ts  provider/model/voice settings + speech request
    annotation-*.ts     create / modal / export
    audio-playback.ts   premium + local TTS playback queue
    read-markers.ts     paragraph play/tag gutter controls
    reader-player.ts    bottom transport bar
    pomodoro.ts         focus/break timer
    link-layer.ts, scroll.ts, zoom.ts
    lib/pdfjs.ts         typed pdf.js (bundled from pdfjs-dist)
    styles.css
  server/server.ts      typed Node API + static server
  public/fonts/          bundled fonts
```

## Notes

- pdf.js is bundled from the pinned `pdfjs-dist` dependency, not fetched from a CDN, so the
  reader works offline and no third-party origin can run script in a page that holds the
  user's API key. Vite emits the worker alongside the bundle.
- Analytics only runs on the hosted site: the gtag snippet in `index.html` is gated on the
  `readitout.me` hostname, and the self-hosted CSP in `server/server.ts` doesn't allow
  Google at all. See the root README for the list of events.
- Both deploy paths set a CSP. `connect-src` deliberately allows `http://localhost:*` —
  the free Kokoro voice runs on the user's own machine and the browser calls it directly —
  and just as deliberately omits `upgrade-insecure-requests`, which would rewrite that to
  https and break it.
- Two voice providers only: **OpenRouter** (your own key, Kokoro/Grok/MAI) and **Local
  server** (keyless Kokoro on your own machine). Both are called straight from the browser,
  so the app needs no backend; `/api/speech` remains as an optional proxy for self-hosters.
  `readerMode` is a hidden flag with values `premium` and `local` — it selects the engine,
  not the provider.
