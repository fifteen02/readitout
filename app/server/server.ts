import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

interface TtsModel {
  id: string;
  name: string;
  price: string;
  voices: string[];
}

interface SpeechBody {
  text?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  baseUrl?: string;
}

// Default endpoint for a locally-run kokoro-fastapi server (OpenAI-compatible).
const DEFAULT_LOCAL_TTS = process.env.LOCAL_TTS_URL || "http://localhost:8880/v1";
const LOCAL_KOKORO_MODEL = "kokoro";

// In the built app, server.js sits in dist/ next to dist/public.
const root = fileURLToPath(new URL("public", import.meta.url));
const port = Number(process.env.PORT || 4173);
// OpenRouter is the only keyed provider; the other supported option, "local-server",
// is a keyless Kokoro on the user's own machine.
const envApiKey = process.env.OPENROUTER_API_KEY || "";
// Public/hosted deploy: never spend the operator's key or compute on users. The
// free browser voice stays available; premium requires the user's own key, and the
// "Local server" proxy is disabled (localhost here is the server, not the user).
const publicDeploy = /^(1|true|yes)$/i.test(process.env.PUBLIC_DEPLOY || "");
const openRouterModel = process.env.OPENROUTER_TTS_MODEL || "microsoft/mai-voice-2";

const maiVoices = new Set(["en-US-Harper:MAI-Voice-2", "es-MX-Valeria:MAI-Voice-2", "fr-FR-Soleil:MAI-Voice-2", "de-DE-Klaus:MAI-Voice-2"]);
const grokVoices = new Set(["eve", "ara", "rex", "sal", "leo"]);

// A curated slice of Kokoro's ~54 preset voices (id → friendly label). Kokoro is
// cheap but returns no timings, so we recover them with a Whisper alignment pass.
const kokoroVoices: Record<string, string> = {
  af_heart: "Heart (US, f)",
  af_bella: "Bella (US, f)",
  af_nicole: "Nicole (US, f)",
  af_sarah: "Sarah (US, f)",
  am_adam: "Adam (US, m)",
  am_michael: "Michael (US, m)",
  bf_emma: "Emma (UK, f)",
  bf_isabella: "Isabella (UK, f)",
  bm_george: "George (UK, m)",
  bm_lewis: "Lewis (UK, m)"
};
const KOKORO_MODEL = "hexgrad/kokoro-82m";

// Sent with every static response. Note there is no googletagmanager/google-analytics
// entry: analytics is gated on the readitout.me hostname in index.html, so a self-hosted
// instance never loads it — and this policy makes that a rule rather than a promise.
// `connect-src` must keep http://localhost open: the free Kokoro voice runs on the
// user's own machine and the browser calls it directly. For the same reason there is
// deliberately no `upgrade-insecure-requests`, which would rewrite that to https.
const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data: https://openrouter.ai http://localhost:* http://127.0.0.1:*"
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  // The bundled pdf.js worker is an ES module served as .mjs. Without an explicit
  // JavaScript MIME type the browser refuses to run it and pdf.js silently falls back
  // to its "fake worker", which then fails too — so PDFs never render.
  [".mjs", "text/javascript; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"]
]);

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === "POST" && req.url === "/api/speech") return createSpeech(req, res);
    if (req.method === "GET" && req.url === "/api/config") return json(res, { publicDeploy });
    if (req.method === "GET" && req.url?.startsWith("/api/models")) return listModels(req, res);
    if (req.method !== "GET") return send(res, 405, "Method not allowed");
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) return send(res, 403, "Forbidden");
    const body = await readFile(file).catch(() => readFile(join(root, "index.html"))); // SPA fallback
    res.writeHead(200, { "Content-Type": types.get(extname(file)) || "application/octet-stream", ...securityHeaders });
    res.end(body);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    send(res, err.code === "ENOENT" ? 404 : 500, err.message);
  }
}).listen(port, () => {
  console.log(`Read It Out API: http://localhost:${port}`);
  if (publicDeploy) {
    console.log("PUBLIC_DEPLOY on: free browser voice for all; premium needs each user's own key; server key & local-server disabled.");
  } else {
    if (!envApiKey) console.log("Set a key in app settings or OPENROUTER_API_KEY to enable premium voices.");
    if (envApiKey) console.log("Premium voice provider: openrouter");
  }
});

function listModels(req: IncomingMessage, res: ServerResponse): void {
  const provider = new URL(req.url ?? "/", `http://${req.headers.host}`).searchParams.get("provider");
  json(res, provider === "local-server" ? localModels() : openRouterModels());
}

async function createSpeech(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<SpeechBody>(req);
  // On a public deploy we ignore the operator's env key entirely, so users can only
  // spend their own key — never ours.
  const apiKey = String(body.apiKey || (publicDeploy ? "" : envApiKey) || "").trim();
  const provider = inferProvider(body.provider);
  const local = provider === "local-server";
  if (publicDeploy && local) {
    return send(res, 403, "Local server voices aren't available on this hosted instance. Self-host the app to use them.");
  }
  // Cloud providers need a key; the local Kokoro server runs on the user's machine
  // with no auth, so it is free and keyless.
  if (!local && !apiKey) {
    return send(res, 500, publicDeploy
      ? "Add your own API key in Settings to use premium voices, or use the free local browser voice."
      : "Add an API key in Settings or set OPENROUTER_API_KEY.");
  }
  const text = String(body.text || "").trim();
  if (!text || text.length > 4000) return send(res, 400, "Text must be between 1 and 4000 characters.");
  const instructions = String(body.instructions || "").trim().slice(0, 4096);
  const model = local ? LOCAL_KOKORO_MODEL : String(body.model || "").trim() || speechModel();
  const voice = normalizeVoice(provider, model, body.voice);
  const endpoint = local ? localEndpoint(body.baseUrl) : speechEndpoint();
  if (local && !endpoint) return send(res, 400, "Local TTS server URL must point to localhost (e.g. http://localhost:8880/v1).");
  let response: Response;
  try {
    response = await fetch(endpoint as string, {
      method: "POST",
      // The local Kokoro server's schema has no `instructions` field; only send it
      // to the cloud providers that support it.
      headers: speechHeaders(provider, apiKey),
      body: JSON.stringify(
        local
          ? { model, voice, input: text, response_format: "mp3" }
          : { model, voice, input: text, instructions, response_format: "mp3" }
      )
    });
  } catch (error) {
    // A connection refused here almost always means the local server isn't running.
    if (local) return send(res, 502, `Could not reach the local TTS server. Is kokoro-fastapi running? (${(error as Error).message})`);
    throw error;
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok) return send(res, response.status, data.toString("utf8"));
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
  res.end(data);
}

function speechEndpoint(): string {
  return "https://openrouter.ai/api/v1/audio/speech";
}

// Only allow proxying to a loopback address — the browser hands us this URL, so
// restricting it to localhost prevents the app server being used to reach elsewhere.
function localEndpoint(baseUrl: string | undefined): string | null {
  const raw = String(baseUrl || DEFAULT_LOCAL_TTS).trim();
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]") return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}/audio/speech`;
  } catch {
    return null;
  }
}

function speechHeaders(provider: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider === "local-server") return headers; // keyless local server
  headers.Authorization = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Read It Out";
  }
  return headers;
}

function speechModel(): string {
  return openRouterModel;
}

function openRouterModels(): TtsModel[] {
  // Confirmed-working OpenRouter speech models only, cheapest first.
  return [
    { id: KOKORO_MODEL, name: "Kokoro 82M", price: "~$0.60 / 1M characters", voices: Object.keys(kokoroVoices) },
    { id: "x-ai/grok-voice-tts-1.0", name: "xAI Grok Voice TTS 1.0", price: "$15 / 1M tokens", voices: ["eve", "ara", "rex", "sal", "leo"] },
    { id: "microsoft/mai-voice-2", name: "Microsoft MAI Voice 2", price: "$22 / 1M characters", voices: ["en-US-Harper:MAI-Voice-2", "es-MX-Valeria:MAI-Voice-2", "fr-FR-Soleil:MAI-Voice-2", "de-DE-Klaus:MAI-Voice-2"] }
  ];
}

function localModels(): TtsModel[] {
  return [{ id: LOCAL_KOKORO_MODEL, name: "Kokoro (local, free)", price: "Free — runs on your machine", voices: Object.keys(kokoroVoices) }];
}

function normalizeVoice(provider: string, model: string, voice: string | undefined): string {
  if (provider === "local-server") return kokoroVoices[voice ?? ""] ? (voice as string) : "af_heart";
  if (provider === "openrouter" && model === KOKORO_MODEL) return kokoroVoices[voice ?? ""] ? (voice as string) : "af_heart";
  if (provider === "openrouter" && model.startsWith("microsoft/")) return maiVoices.has(voice ?? "") ? (voice as string) : "en-US-Harper:MAI-Voice-2";
  if (provider === "openrouter" && model.startsWith("x-ai/")) return grokVoices.has(voice ?? "") ? (voice as string) : "eve";
  return String(voice || "Kore");
}

function inferProvider(requestedProvider: string | undefined): string {
  return requestedProvider === "local-server" ? "local-server" : "openrouter";
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function send(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
