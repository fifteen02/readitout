// Pre-record the lobby greeting via OpenRouter — Kokoro voices + Whisper word
// timings — in several voices (run once). One OpenRouter key, no other accounts.
//
//   npm run greeting         # prompts for your OpenRouter API key
//   task greeting            # same, via Taskfile
//   node scripts/generate-greeting.mjs           # also prompts if the key isn't in the env
//   OPENROUTER_API_KEY=sk-or-... node scripts/generate-greeting.mjs   # non-interactive
//
// Optional overrides:
//   GREETING_TEXT="..."                          the words to speak
//   GREETING_VOICES="af_heart,am_adam,bf_emma"   Kokoro voice ids to record
//
// Writes one public/greeting-<voice>.mp3 per voice plus public/greeting.json (the
// text and, for each voice, its file and per-word timings). The lobby picks these
// up automatically and lets the reader switch voices. Your key is only read from
// the environment/prompt here and never written to disk.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted) rl.output.write(str);
    };
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

const DEFAULT_TEXT =
  "Drop in a PDF and I'll read it aloud, follow along, and annotate anything as you go. Highlights, notes and read-aloud all live in one calm place, and everything you mark stays with you.";

const KOKORO_NAMES = {
  af_heart: "Heart",
  af_bella: "Bella",
  af_nicole: "Nicole",
  af_sarah: "Sarah",
  am_adam: "Adam",
  am_michael: "Michael",
  bf_emma: "Emma",
  bf_isabella: "Isabella",
  bm_george: "George",
  bm_lewis: "Lewis"
};

let apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) apiKey = await askHidden("Enter your OpenRouter API key (input hidden): ");
if (!apiKey) {
  console.error("No API key provided.");
  process.exit(1);
}

const text = process.env.GREETING_TEXT || DEFAULT_TEXT;
const voiceIds = (process.env.GREETING_VOICES || "af_heart,am_adam,bf_emma")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(scriptDir, "..", "public");
await mkdir(publicDir, { recursive: true });

const orHeaders = { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "http://localhost", "X-Title": "Marginalia" };

function wordTimings(whisperWords) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let last = 0;
  return tokens.map((tok, i) => {
    const t = Number(whisperWords[i]?.start ?? last);
    last = t;
    return { t: Number(t.toFixed(3)), w: tok };
  });
}

async function record(voiceId) {
  const tts = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { ...orHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "hexgrad/kokoro-82m", voice: voiceId, input: text, response_format: "mp3" })
  });
  if (!tts.ok) {
    console.error(`Kokoro error for ${voiceId} (${tts.status}): ${await tts.text()}`);
    return null;
  }
  const audio = Buffer.from(await tts.arrayBuffer());
  const file = `greeting-${voiceId}.mp3`;
  await writeFile(join(publicDir, file), audio);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "speech.mp3");
  form.append("model", "openai/whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const align = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", { method: "POST", headers: orHeaders, body: form });
  let words = wordTimings([]);
  if (align.ok) {
    const parsed = await align.json();
    words = wordTimings(parsed.words || []);
  } else {
    console.warn(`  alignment failed for ${voiceId} — greeting will play without word highlighting`);
  }
  console.log(`  ${voiceId}: ${file} (${words.length} words)`);
  return { name: KOKORO_NAMES[voiceId] || voiceId, file: `/${file}`, words };
}

const voices = [];
for (const id of voiceIds) {
  const entry = await record(id);
  if (entry) voices.push(entry);
}

if (!voices.length) {
  console.error("No voices were recorded.");
  process.exit(1);
}

await writeFile(join(publicDir, "greeting.json"), JSON.stringify({ text, voices }, null, 2));
console.log(`Wrote greeting.json with ${voices.length} voice(s) to public/.`);
