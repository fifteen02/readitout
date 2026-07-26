import type { SpeechRequestBody, TtsModel } from "./types";
import type { UI } from "./ui";

const KEY = "pdf-reader-settings";

const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"];
const voices: Record<string, string[]> = {
  "hexgrad/kokoro-82m": KOKORO_VOICES,
  "microsoft/mai-voice-2": ["en-US-Harper:MAI-Voice-2", "es-MX-Valeria:MAI-Voice-2", "fr-FR-Soleil:MAI-Voice-2", "de-DE-Klaus:MAI-Voice-2"],
  "x-ai/grok-voice-tts-1.0": ["eve", "ara", "rex", "sal", "leo"]
};

// The two supported providers. Premium voices are OpenRouter with the user's own key;
// "local-server" is a keyless Kokoro running on the user's own machine.
const PROVIDERS = ["openrouter", "local-server"];
const DEFAULT_MODEL = "hexgrad/kokoro-82m";

const PRICES: Record<string, string> = {
  "x-ai/grok-voice-tts-1.0": "$15/1M",
  "microsoft/mai-voice-2": "$22/1M"
};

interface StoredSettings {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_LOCAL_URL = "http://localhost:8880/v1";

interface VoiceSyncUi {
  ttsModel: HTMLSelectElement;
  voiceSelect: HTMLSelectElement;
  playerVoice: HTMLSelectElement | null;
}

export function initSettings(ui: UI, setStatus: (message: string) => void): void {
  const saved = loadSettings();
  ui.apiProvider.value = saved.provider;
  ui.apiKey.value = saved.apiKey;
  ui.localUrl.value = saved.baseUrl;
  ui.ttsModel.value = saved.model;
  void loadModelOptions(ui, saved.model);

  // Provider-specific rows: cloud providers show an API key + family; the free
  // local server shows a URL field and a setup card, and hides the family (Kokoro only).
  const updateProviderUi = (): void => {
    const local = ui.apiProvider.value === "local-server";
    document.getElementById("apiKeyRow")?.toggleAttribute("hidden", local);
    document.getElementById("localUrlRow")?.toggleAttribute("hidden", !local);
    document.getElementById("localSetup")?.toggleAttribute("hidden", !local);
    const familyHint = document.getElementById("familyHint");
    if (familyHint) (familyHint as HTMLElement).hidden = local;
    const famLabel = document.querySelector('label[for="ttsModel"]');
    if (famLabel) (famLabel as HTMLElement).hidden = local;
    ui.ttsModel.hidden = local;
  };

  // The engine is chosen automatically from the saved key: premium when a key is
  // present, the local browser voice when not. readerMode is a hidden flag the
  // player reads; keep it (and the Listen-panel hint) in sync with the key.
  const readerMode = document.getElementById("readerMode") as HTMLSelectElement | null;
  const syncEngine = (): void => {
    const local = ui.apiProvider.value === "local-server";
    // The HTTP TTS path runs whenever there's a key OR the free local server is chosen;
    // otherwise fall back to the browser's built-in voice.
    const httpEngine = local || ui.apiKey.value.trim().length > 0;
    if (readerMode) readerMode.value = httpEngine ? "premium" : "local";
    // The browser voice is the robotic one every OS ships. Readers stay on it because
    // nothing tells them otherwise, so that state is called out in two places: a badge on
    // the transport bar (always visible) and a callout in Settings (has room for the how).
    const onBrowserVoice = !local && !httpEngine;
    const badge = document.getElementById("engineBadge");
    if (badge) {
      // Quality and cost are separate axes. Kokoro over Docker is the same model as the
      // paid route, so it is premium AND free; only the device's built-in voice is basic.
      // Labelling it "free" implied "lesser", which it is not.
      const state = local ? "local" : httpEngine ? "cloud" : "basic";
      const chip = {
        basic: {
          label: "Basic",
          detail: "Your device's built-in voice. Click to switch to a natural one: free with Docker, or a few cents with OpenRouter.",
          icon: '<path d="M3 9v6h4l5 4V5L7 9H3z"/>'
        },
        local: {
          label: "Local",
          detail: "Kokoro running on your own machine. Premium quality, free, and nothing leaves your computer. Click to manage the server.",
          icon: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'
        },
        cloud: {
          label: "Premium",
          detail: "Premium voice through your own OpenRouter key. Click to change the family or clear the key.",
          icon: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.64-1.5A3.75 3.75 0 0 0 6.75 19z"/>'
        }
      }[state];
      badge.classList.toggle("is-basic", state === "basic");
      badge.innerHTML =
        `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ` +
        `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${chip.icon}</svg>` +
        `<span class="eb-label"></span>`;
      const text = badge.querySelector(".eb-label");
      if (text) text.textContent = chip.label;
      badge.title = chip.detail;
      badge.setAttribute("aria-label", chip.detail);
    }
    const hint = document.getElementById("voiceEngineHint");
    if (hint) {
      hint.classList.toggle("voice-upsell", onBrowserVoice);
      if (onBrowserVoice) {
        // This hint sits in the Listen panel, but both setup routes live in Settings, so
        // it has to say where to go rather than "below".
        hint.innerHTML =
          '<strong>You are using the free voice built into your device.</strong> It is the ' +
          'robotic one. For a natural, audiobook-style voice there are two routes, both in ' +
          '<strong>Settings</strong>:<br>' +
          '<strong>Docker</strong> runs Kokoro on your own machine. Free, no key, nothing ' +
          'leaves your computer.<br>' +
          '<strong>OpenRouter</strong> uses your own key ' +
          '<span class="vu-cost">(a 400 page book costs well under a dollar)</span>.';
      } else {
        hint.textContent = local
          ? "Using free Kokoro voices running on your own machine. Manage the server in Settings."
          : "Using premium voices through your own OpenRouter key. Change the family or clear the key in Settings.";
      }
    }
    refreshVoices();
  };

  ui.apiKey.addEventListener("input", () => { applyKeyProvider(ui); syncEngine(); });
  ui.localUrl.addEventListener("input", () => localStorage.setItem(KEY, JSON.stringify(readSettings(ui))));
  ui.apiProvider.addEventListener("change", () => {
    updateProviderUi();
    if (ui.apiProvider.value !== "local-server") {
      ui.ttsModel.value = DEFAULT_MODEL;
      void loadModelOptions(ui, ui.ttsModel.value);
    }
    syncEngine();
  });
  ui.ttsModel.addEventListener("change", refreshVoices);
  window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);
  ui.saveSettings.addEventListener("click", () => {
    applyKeyProvider(ui);
    localStorage.setItem(KEY, JSON.stringify(readSettings(ui)));
    setStatus("Settings saved.");
    updateProviderUi();
    syncEngine();
  });
  ui.clearSettings.addEventListener("click", () => {
    ui.apiKey.value = "";
    localStorage.setItem(KEY, JSON.stringify(readSettings(ui)));
    setStatus("API key cleared.");
    syncEngine();
  });
  updateProviderUi();
  syncEngine();
  // Note: the "Local server" provider is always available — the browser talks to the
  // user's own localhost directly, so it works even on a hosted deploy.
}

// Populate the voice pickers to match the engine: the browser's own installed voices
// for the local engine, the model's premium voices otherwise.
function refreshVoices(): void {
  const voiceSelect = document.getElementById("voiceSelect") as HTMLSelectElement | null;
  const playerVoice = document.getElementById("playerVoice") as HTMLSelectElement | null;
  const ttsModel = document.getElementById("ttsModel") as HTMLSelectElement | null;
  const mode = (document.getElementById("readerMode") as HTMLSelectElement | null)?.value ?? "premium";
  const provider = (document.getElementById("apiProvider") as HTMLSelectElement | null)?.value;
  if (!voiceSelect) return;
  // Free local server: fixed to Kokoro's preset voices.
  if (provider === "local-server") {
    const current = voiceSelect.value;
    const make = (): HTMLOptionElement[] => KOKORO_VOICES.map((v) => new Option(labelVoice(v), v));
    voiceSelect.replaceChildren(...make());
    voiceSelect.value = KOKORO_VOICES.includes(current) ? current : KOKORO_VOICES[0];
    if (playerVoice) {
      playerVoice.replaceChildren(...make());
      playerVoice.value = voiceSelect.value;
    }
    const customRow = document.getElementById("voiceCustomRow");
    if (customRow) (customRow as HTMLElement).hidden = true;
    return;
  }
  if (mode !== "local") {
    if (ttsModel) syncVoiceOptions({ ttsModel, voiceSelect, playerVoice });
    return;
  }
  const allVoices = (() => { try { return window.speechSynthesis?.getVoices() ?? []; } catch { return []; } })();
  // Hide network voices. Chrome's "Google ..." voices synthesise on Google's servers, and
  // when that is unreachable they never speak AND never fire an error, so the reader just
  // gets silence with nothing to click. Offering them at all is a trap.
  // Some platforms (notably Android/ChromeOS) ship only network voices, so fall back to the
  // full list rather than presenting an empty picker.
  const onDevice = allVoices.filter((v) => v.localService);
  const voices = onDevice.length ? onDevice : allVoices;
  const current = voiceSelect.value;
  // Only reachable in the fallback above, where every available voice is a network one.
  const label = (v: SpeechSynthesisVoice): string => {
    const suffix = v.localService ? "" : " (network)";
    return v.default ? `${v.name} (default)${suffix}` : `${v.name}${suffix}`;
  };
  const build = (): HTMLOptionElement[] =>
    voices.length
      ? voices.map((v) => new Option(label(v), v.name))
      : [new Option("System default voice", "")];
  voiceSelect.replaceChildren(...build());
  // A stored preference may name a voice that is no longer offered (an older build let
  // network voices be chosen), so fall through to the platform default.
  const preferred = voices.find((v) => v.default) ?? voices[0];
  voiceSelect.value = voices.some((v) => v.name === current) ? current : (preferred?.name ?? "");
  if (playerVoice) {
    playerVoice.replaceChildren(...build());
    playerVoice.value = voiceSelect.value;
  }
  const customRow = document.getElementById("voiceCustomRow");
  if (customRow) (customRow as HTMLElement).hidden = true; // custom voice ids are premium-only
}

// Model lists are static, client-side data — no backend call needed (keeps the app
// fully static-deployable).
function loadModelOptions(ui: UI, selected: string): void {
  setModelOptions(ui.ttsModel, modelOptions(), selected);
}

function modelPriceNum(price?: string): number {
  const match = /\$\s*([\d.]+)/.exec(price || "");
  return match ? Number(match[1]) : Infinity; // unpriced/unknown sorts last
}

function setModelOptions(select: HTMLSelectElement, models: TtsModel[], selected: string): void {
  const resolved = models.map((model) => ({ ...model, price: model.price || PRICES[model.id] || "" }));
  const sorted = resolved.sort((a, b) => modelPriceNum(a.price) - modelPriceNum(b.price));
  const value = selected || select.value;
  select.replaceChildren(...sorted.map((model) => optionForModel(model)));
  select.value = [...select.options].some((option) => option.value === value) ? value : sorted[0]?.id;
  refreshVoices();
}

function modelOptions(): TtsModel[] {
  return [
    { id: "hexgrad/kokoro-82m", name: "Kokoro 82M", price: "$0.60/1M", voices: KOKORO_VOICES },
    { id: "x-ai/grok-voice-tts-1.0", name: "xAI Grok Voice TTS 1.0", price: "$15/1M", voices: voices["x-ai/grok-voice-tts-1.0"] },
    { id: "microsoft/mai-voice-2", name: "Microsoft MAI Voice 2", price: "$22/1M", voices: voices["microsoft/mai-voice-2"] }
  ];
}

function optionForModel(model: TtsModel): HTMLOptionElement {
  const option = new Option(`${model.name}${model.price ? ` - ${model.price}` : ""}`, model.id);
  option.dataset.price = model.price || "";
  if (model.voices) option.dataset.voices = model.voices.join(",");
  return option;
}

function syncVoiceOptions(ui: VoiceSyncUi): void {
  const model = ui.ttsModel.value;
  const modelVoices = ui.ttsModel.selectedOptions[0]?.dataset.voices?.split(",").filter(Boolean) || voices[model] || [];
  const current = ui.voiceSelect.value;
  const voiceList = modelVoices.length ? modelVoices : [""];
  const makeOpts = (): HTMLOptionElement[] =>
    voiceList.map((voice) => new Option(voice ? labelVoice(voice) : "Default — set a custom voice below", voice));
  ui.voiceSelect.replaceChildren(...makeOpts());
  ui.voiceSelect.value = modelVoices.includes(current) ? current : voiceList[0];
  if (ui.playerVoice) {
    ui.playerVoice.replaceChildren(...makeOpts());
    ui.playerVoice.value = ui.voiceSelect.value;
  }
  const customRow = document.getElementById("voiceCustomRow");
  if (customRow) (customRow as HTMLElement).hidden = modelVoices.length > 0;
}

function labelVoice(voice: string): string {
  const kokoro = /^([ab])([fm])_(.+)$/.exec(voice);
  if (kokoro) {
    const name = kokoro[3].charAt(0).toUpperCase() + kokoro[3].slice(1);
    return `${name} · ${kokoro[1] === "a" ? "US" : "UK"}`;
  }
  return voice.split(":")[0].replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/-/g, " ").trim() || voice;
}

export function speechRequest(ui: UI, text: string): SpeechRequestBody {
  const settings = readSettings(ui);
  const custom = (ui.voiceCustom.value || "").trim();
  return {
    text,
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    voice: custom || ui.voiceSelect.value,
    instructions: ui.stylePrompt.value,
    baseUrl: settings.baseUrl
  };
}

function readSettings(ui: UI): StoredSettings {
  const apiKey = ui.apiKey.value.trim();
  const provider = inferProvider(ui.apiProvider.value);
  const model = ui.ttsModel.value.trim();
  const inDropdown = [...ui.ttsModel.options].some((option) => option.value === model);
  return {
    provider,
    apiKey,
    model: model && (inDropdown || validModel(model)) ? model : DEFAULT_MODEL,
    baseUrl: ui.localUrl.value.trim() || DEFAULT_LOCAL_URL
  };
}

function loadSettings(): StoredSettings {
  const defaults: StoredSettings = { provider: "openrouter", apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_LOCAL_URL };
  try {
    const saved = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<StoredSettings>) };
    // A browser that used an older build may still hold provider "openai" and its model.
    // Neither exists any more, and assigning an unknown value to the <select> would leave
    // it blank, so fold anything unrecognised back onto OpenRouter.
    if (!PROVIDERS.includes(saved.provider)) {
      saved.provider = "openrouter";
      // Don't carry another vendor's key over to OpenRouter. It would only 401, but it
      // would also hand an OpenAI key to a provider that has no business seeing it.
      if (!saved.apiKey.startsWith("sk-or-")) saved.apiKey = "";
    }
    if (!validModel(saved.model)) saved.model = DEFAULT_MODEL;
    return saved;
  } catch {
    return defaults;
  }
}

function validModel(model: string): boolean {
  return modelOptions().some((item) => item.id === model);
}

function applyKeyProvider(ui: UI): void {
  ui.apiProvider.value = inferProvider(ui.apiProvider.value);
}

function inferProvider(selectedProvider: string): string {
  // An explicit "Local server" choice always wins — a leftover key in the (hidden) key
  // field must not flip the provider back to OpenRouter on save. Everything else is
  // OpenRouter: it's the only keyed provider we support.
  return selectedProvider === "local-server" ? "local-server" : "openrouter";
}
