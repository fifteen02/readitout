// Real audio visualiser: taps the playing <audio> element through the Web Audio
// API and drives the equaliser bars from live frequency data. Falls back to the
// CSS animation if Web Audio is unavailable (e.g. the local speech-synthesis voice).

const SELECTOR = ".reading-wave";
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let raf = 0;
let currentSource: MediaElementAudioSourceNode | null = null;

function bars(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`${SELECTOR} span`)];
}

export function attachVisualizer(audio: HTMLAudioElement): void {
  const wave = document.querySelector<HTMLElement>(SELECTOR);
  const els = bars();
  if (!wave || !els.length) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      analyser.connect(ctx.destination);
    }
    // Each chunk is a fresh <audio>; route the new one through the analyser.
    if (currentSource) {
      try {
        currentSource.disconnect();
      } catch {
        /* ignore */
      }
    }
    currentSource = ctx.createMediaElementSource(audio);
    currentSource.connect(analyser);
    wave.classList.add("live");
    runLoop(els);
  } catch {
    wave.classList.remove("live"); // keep the CSS animation as a fallback
  }
}

function runLoop(els: HTMLElement[]): void {
  if (!analyser) return;
  cancelAnimationFrame(raf);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = (): void => {
    if (!analyser) return;
    analyser.getByteFrequencyData(data);
    // Speech energy lives in the lower spectrum; spreading bars across ALL bins leaves
    // the high-frequency (right) bars dead. Map bars across the lower ~half of the bins
    // and give the higher bars a gentle boost so the whole equaliser moves.
    const usable = Math.max(els.length, Math.floor(data.length * 0.5));
    els.forEach((bar, i) => {
      const idx = Math.min(data.length - 1, Math.floor((i / els.length) * usable) + 1);
      const boost = 1 + i * 0.14;
      const level = Math.min(1, ((data[idx] ?? 0) / 255) * boost);
      bar.style.height = `${Math.round(4 + level * 18)}px`;
    });
    raf = requestAnimationFrame(draw);
  };
  draw();
}

export function stopVisualizer(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  const wave = document.querySelector<HTMLElement>(SELECTOR);
  wave?.classList.remove("live");
  bars().forEach((bar) => {
    bar.style.height = "";
  });
}
