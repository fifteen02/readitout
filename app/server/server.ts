import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Speech runs in the browser. This optional server only serves the built application.
const root = fileURLToPath(new URL("public", import.meta.url));
const port = Number(process.env.PORT || 4173);
const securityHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co"
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
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".wav", "audio/wav"],
  [".wasm", "application/wasm"]
]);

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) return send(res, 403, "Forbidden");
    const body = await readFile(file).catch(error => {
      if (extname(file) || pathname.startsWith('/api/')) throw error;
      return readFile(join(root, "index.html"));
    });
    res.writeHead(200, { "Content-Type": types.get(extname(file)) || (extname(file) ? "application/octet-stream" : "text/html; charset=utf-8"), ...securityHeaders });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    send(res, err.code === "ENOENT" ? 404 : 500, err.code === "ENOENT" ? "Not found" : "Unable to serve this file");
  }
}).listen(port, () => console.log(`Read It Out: http://localhost:${port} (Kokoro runs in the browser)`));

function send(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders });
  res.end(message);
}
