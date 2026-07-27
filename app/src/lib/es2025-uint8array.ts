// pdf.js 6 calls the ES2025 Uint8Array hex/base64 methods: `toHex()` on the
// document-fingerprint path (so *every* document open fails without it), and
// `toBase64()`/`fromBase64()` for embedded images and signatures. Those methods
// only landed in Chrome 140 / Firefox 133 / Safari 18.2, so any slightly older
// browser can't open a PDF at all. This fills them in when missing.
//
// Imported for side effects on both the main thread and the pdf.js worker —
// each realm needs its own install.

interface Ctor {
  fromBase64?: (s: string) => Uint8Array;
}

function define(target: object, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false
  });
}

define(Uint8Array.prototype, "toHex", function toHex(this: Uint8Array): string {
  let out = "";
  for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, "0");
  return out;
});

// String.fromCharCode is applied in chunks: spreading a whole image's bytes at
// once overflows the argument limit.
const CHUNK = 0x2000;

define(Uint8Array.prototype, "toBase64", function toBase64(this: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < this.length; i += CHUNK) {
    binary += String.fromCharCode(...this.subarray(i, i + CHUNK));
  }
  return btoa(binary);
});

define(Uint8Array as unknown as Ctor, "fromBase64", function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
});

export {};
