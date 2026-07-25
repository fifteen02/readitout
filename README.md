# Read It Out

**A PDF reader that reads your documents aloud.** The line being read stays lit so you
don't lose your place, and anything you highlight along the way exports as Markdown, JSON,
or LLM-ready text.

### → [readitout.me](https://readitout.me)

For the kind of reading where you reach the bottom of a page and realise you've skimmed
it: a draft, a paper, a contract. Hearing it read back catches what reading past it
doesn't.

---

## What it does

- **Reads PDFs aloud** with the line being read highlighted, and follows along as it goes
- **Highlights, notes and tags**, colour-coded, filterable and groupable by outline section
- **Exports** to Markdown, JSON, or a format you can paste straight into an LLM
- **Pomodoro timer** and a focus-line mode that dims everything but the current line
- **Themes**, sepia/light/dark, zoom presets, an outline sidebar and a page minimap

## Your documents never leave your machine

No account, no sign-up, no upload. The PDF is parsed client-side, your annotations live in
local storage, and nothing about the contents of what you read is ever transmitted. pdf.js
is bundled rather than loaded from a CDN, so the reader works offline and no third-party
origin can run script on the page. The Node server exists only as an optional proxy for
premium voices, and the app is fully usable without it.

**Analytics.** The hosted site at [readitout.me](https://readitout.me) records five
anonymous events through Google Analytics: `pdf_opened` (page count and file size in KB),
`pdf_open_failed`, `read_aloud_started` (which mode), `annotation_created` (whether it has
a note), and `voice_previewed` (which engine). No filenames, no document text, no page
content, no account, no identifier you gave us.

Self-hosted builds send nothing at all. The snippet in `app/index.html` is gated on the
`readitout.me` hostname, so a fork, a local run or an offline build never contacts Google —
and the self-hosted Content-Security-Policy doesn't allow it either. To strip it entirely,
delete that one `<script>` block.

**Your API key.** There are two voice providers, and neither routes through a server of
ours. OpenRouter allows browser calls, so your key goes from your browser straight to
OpenRouter; it's stored in local storage and sent nowhere else. The free local server runs
on your own machine and needs no key at all.

## Try it without finding a document

A short sample chapter ships with the app, so you can hear it working straight away:
[`app/public/the-quiet-hour.pdf`](app/public/the-quiet-hour.pdf), or
[readitout.me/the-quiet-hour.pdf](https://readitout.me/the-quiet-hour.pdf) on the hosted
site. It's invented, not a real manuscript.

## Voices

| Option | Key needed | Cost |
|---|---|---|
| Browser voice | no | free |
| [Kokoro](https://github.com/remsky/Kokoro-FastAPI) via Docker, self-hosted | no | free |
| Kokoro via OpenRouter | your own | ~$0.60 / 1M characters |
| xAI Grok Voice / Microsoft MAI Voice | your own | $15 to $22 / 1M characters |

The default browser voice works immediately with no setup. Kokoro on OpenRouter is the
default premium engine, and a 400-page book runs to well under a dollar. Keys are yours and
are never sent anywhere but the provider.

## Running it locally

```bash
cd app
npm install
npm run dev          # front-end on :5273, API on :4173
```

Build and serve the production bundle:

```bash
npm run build
npm start
```

See [`app/README.md`](app/README.md) for the full development guide, covering voice
providers, recording the lobby greeting, type-checking and project layout. See
[`app/DEPLOY.md`](app/DEPLOY.md) for Firebase Hosting and Cloud Run deployment.

## Built with

TypeScript, Vite, and [pdf.js](https://mozilla.github.io/pdf.js/) (bundled, not CDN-loaded),
with a small typed Node server. No front-end framework.

---

Built by [fifteen02](https://fifteen02.com).
