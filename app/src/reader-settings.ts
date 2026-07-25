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
    const hint = document.getElementById("voiceEngineHint");
    if (hint) {
      hint.textContent = local
        ? "Using free local voices (Kokoro). Manage the server in Settings."
        : httpEngine
          ? "Using premium voices. Change the family or clear the key in Settings."
          : "Using the local browser voice. Add an OpenRouter key in Settings to switch on premium voices.";
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
  const voices = (() => { try { return window.speechSynthesis?.getVoices() ?? []; } catch { return []; } })();
  const current = voiceSelect.value;
  const build = (): HTMLOptionElement[] =>
    voices.length
      ? voices.map((v) => new Option(v.default ? `${v.name} (default)` : v.name, v.name))
      : [new Option("System default voice", "")];
  voiceSelect.replaceChildren(...build());
  voiceSelect.value = voices.some((v) => v.name === current)
    ? current
    : (voices.find((v) => v.default)?.name ?? voices[0]?.name ?? "");
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
