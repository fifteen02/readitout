// A small Pomodoro timer for the topbar. Pick a focus length (15/25/45/60 min);
// the break scales from it (~1/5, min 3 min). At each focus↔break boundary the
// timer pauses and rings until the user acknowledges, then the next phase begins.
// Start/pause and reset. Self-contained (queries its own DOM).

const LEN_KEY = "readitout:pomo-min";
const BREAK_KEY = "readitout:pomo-break";
const SOUND_KEY = "readitout:pomo-sound";

type SoundKind = "chime" | "bell" | "marimba" | "off";

export function initPomodoro(): void {
  const root = document.getElementById("pomodoro");
  const timeEl = document.getElementById("pomoTime");
  const labelEl = document.getElementById("pomoLabel");
  const toggle = document.getElementById("pomoToggle");
  const reset = document.getElementById("pomoReset");
  const lengthSel = document.getElementById("pomoLength") as HTMLSelectElement | null;
  const focusInput = document.getElementById("pomoFocusMin") as HTMLInputElement | null;
  const breakInput = document.getElementById("pomoBreakMin") as HTMLInputElement | null;
  const soundSel = document.getElementById("pomoSound") as HTMLSelectElement | null;
  const soundPreview = document.getElementById("pomoSoundPreview");
  if (!root || !timeEl || !labelEl || !toggle || !reset || !lengthSel || !soundSel) return;

  let focusSecs = 25 * 60;
  let breakSecs = 5 * 60;
  let phase: "focus" | "break" = "focus";
  let remaining = focusSecs;
  let running = false;
  let timer = 0;
  // "Ringing" is the awaiting-acknowledgement state at a phase boundary.
  let ringing = false;
  let ringTimer = 0;
  let ringCount = 0;
  const RING_GAP = 2600; // ms between repeats
  const RING_CAP = 8; // stop ringing after ~20s if the user is away

  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

  // Reflect the current lengths back into the controls: the two number inputs, and the
  // topbar preset picker (a matching preset, else the "Custom" option showing the value).
  function reflectControls(focusMin: number, breakOverride: number | null): void {
    if (focusInput) focusInput.value = String(focusMin);
    if (breakInput) breakInput.value = breakOverride != null ? String(breakOverride) : "";
    const isPreset = [...lengthSel!.options].some((o) => o.value === String(focusMin) && o.value !== "custom");
    const custom = lengthSel!.querySelector<HTMLOptionElement>('option[value="custom"]');
    if (isPreset) {
      lengthSel!.value = String(focusMin);
    } else if (custom) {
      custom.textContent = `${focusMin}m`;
      custom.hidden = false;
      lengthSel!.value = "custom";
    }
  }

  // Single source of truth for the interval lengths. Break is auto (~1/5, min 3) unless
  // the user typed one. persist=false on initial restore so we don't rewrite storage.
  function applyLengths(focusMin: number, breakOverride: number | null, persist = true): void {
    const f = clamp(Math.round(focusMin) || 25, 1, 180);
    focusSecs = f * 60;
    const auto = Math.max(3, Math.round(f / 5));
    const brk = breakOverride != null ? clamp(Math.round(breakOverride), 1, 90) : auto;
    breakSecs = brk * 60;
    if (persist) {
      localStorage.setItem(LEN_KEY, String(f));
      localStorage.setItem(BREAK_KEY, breakOverride != null ? String(brk) : "");
    }
    reflectControls(f, breakOverride != null ? brk : null);
    resetAll();
  }

  function paint(): void {
    const next = phase === "focus" ? "Focus" : "Break";
    timeEl!.textContent = fmt(remaining);
    labelEl!.textContent = ringing ? `${next} ready` : next;
    root!.classList.toggle("is-break", phase === "break");
    root!.classList.toggle("running", running);
    root!.classList.toggle("ringing", ringing);
    toggle!.innerHTML = ringing
      ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
      : running
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.4"/><rect x="14" y="4.5" width="4" height="15" rx="1.4"/></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 5.1v13.8a1 1 0 0 0 1.53.85l11-6.9a1 1 0 0 0 0-1.7l-11-6.9A1 1 0 0 0 8 5.1Z"/></svg>';
    toggle!.setAttribute("aria-label", ringing ? `Acknowledge and start ${phase}` : running ? "Pause timer" : "Start timer");
    const total = phase === "focus" ? focusSecs : breakSecs;
    const elapsed = total > 0 ? (total - remaining) / total : 0;
    toggle!.style.setProperty("--progress", `${(elapsed * 360).toFixed(1)}deg`);
  }

  function tick(): void {
    remaining -= 1;
    if (remaining <= 0) {
      // Boundary: stop counting, flip to the next phase, and ring until acknowledged.
      pause();
      phase = phase === "focus" ? "break" : "focus";
      remaining = phase === "focus" ? focusSecs : breakSecs;
      startRing();
      return;
    }
    paint();
  }

  function startRing(): void {
    window.clearInterval(ringTimer);
    ringing = true;
    ringCount = 0;
    const kind = soundSel!.value as SoundKind;
    if (kind !== "off") {
      playSound(kind);
      ringTimer = window.setInterval(() => {
        ringCount += 1;
        if (ringCount >= RING_CAP) return stopRing();
        playSound(kind);
      }, RING_GAP);
    }
    paint();
  }
  function stopRing(): void {
    ringing = false;
    ringCount = 0;
    window.clearInterval(ringTimer);
    paint();
  }

  function start(): void {
    if (running) return;
    running = true;
    timer = window.setInterval(tick, 1000);
    paint();
  }
  function pause(): void {
    running = false;
    window.clearInterval(timer);
    paint();
  }
  function resetAll(): void {
    stopRing();
    pause();
    phase = "focus";
    remaining = focusSecs;
    paint();
  }
  // Acknowledge the boundary: silence the ring and start the next phase.
  function acknowledge(): void {
    stopRing();
    start();
  }

  toggle.addEventListener("click", () => (ringing ? acknowledge() : running ? pause() : start()));
  reset.addEventListener("click", resetAll);
  // Clicking anywhere on the pill (other than the controls) also acknowledges.
  root.addEventListener("click", (event) => {
    if (!ringing) return;
    const target = event.target as HTMLElement;
    if (target.closest("#pomoToggle") || target.closest("#pomoReset") || target.closest("select")) return;
    acknowledge();
  });
  const readBreak = (): number | null => {
    const v = breakInput?.value.trim();
    return v ? Number(v) : null;
  };
  // Preset picker → set focus to the preset and auto-scale the break.
  lengthSel.addEventListener("change", () => {
    if (lengthSel.value === "custom") return;
    applyLengths(Number(lengthSel.value), null);
  });
  // Custom minute inputs → whatever the user types drives the timer.
  focusInput?.addEventListener("change", () => applyLengths(Number(focusInput.value), readBreak()));
  breakInput?.addEventListener("change", () => applyLengths(Number(focusInput?.value || 25), readBreak()));
  // Save the chosen end-of-timer sound and play it once so the user hears the pick.
  soundSel.addEventListener("change", () => {
    localStorage.setItem(SOUND_KEY, soundSel.value);
    playSound(soundSel.value as SoundKind);
  });
  soundPreview?.addEventListener("click", () => playSound(soundSel.value as SoundKind));

  // Restore the saved intervals (focus + optional custom break).
  const savedFocus = Number(localStorage.getItem(LEN_KEY)) || 25;
  const savedBreakRaw = localStorage.getItem(BREAK_KEY);
  applyLengths(savedFocus, savedBreakRaw ? Number(savedBreakRaw) : null, false);
  // Restore the saved sound choice.
  const savedSound = localStorage.getItem(SOUND_KEY);
  if (savedSound && [...soundSel.options].some((o) => o.value === savedSound)) soundSel.value = savedSound;
  paint();
}

// Play the chosen end-of-phase sound. Each is a short synthesized motif so there
// are no audio assets to ship; "off" stays silent (the visual switch is enough).
function playSound(kind: SoundKind): void {
  if (kind === "off") return;
  try {
    const ctx = new AudioContext();
    // [frequency, startOffset, duration] notes per sound.
    const notes: Array<[number, number, number]> =
      kind === "bell"
        ? [[880, 0, 0.9], [1318.5, 0.02, 0.9]] // bright two-tone ring
        : kind === "marimba"
          ? [[523.25, 0, 0.3], [659.25, 0.12, 0.3], [783.99, 0.24, 0.35]] // gentle rising arpeggio
          : [[660, 0, 0.6]]; // "chime": the original soft single tone
    const wave: OscillatorType = kind === "marimba" ? "triangle" : "sine";
    const peak = kind === "marimba" ? 0.22 : 0.3;
    const start = ctx.currentTime;
    let end = start;
    notes.forEach(([freq, offset, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = start + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
      end = Math.max(end, t + dur);
    });
    window.setTimeout(() => void ctx.close(), (end - start) * 1000 + 300);
  } catch {
    /* audio not available — the visual switch is enough */
  }
}
