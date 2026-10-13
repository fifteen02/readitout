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

  const completion = document.getElementById("teaComplete") as HTMLDialogElement;
  const completionTitle = document.getElementById("teaCompleteTitle")!;
  const completionDescription = document.getElementById("teaCompleteDescription")!;
  const completionStart = document.getElementById("teaCompleteStart")!;
  const completionLater = document.getElementById("teaCompleteLater")!;
  completion.addEventListener("keydown", event => event.stopPropagation());
  completion.addEventListener("cancel", () => stopRing());
  completionLater.addEventListener("click", () => { stopRing(); completion.close(); });
  completionStart.addEventListener("click", () => acknowledge());

  const cup = document.getElementById("teaTimer")!;
  completion.addEventListener("close", () => {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused === document.body || !focused.getClientRects().length) cup.focus();
  });
  const controls = document.getElementById("teaControls")!;
  const caption = document.getElementById("teaCaption")!;
  const announcement = document.getElementById("teaAnnouncement")!;
  function closeControls(): void {
    controls.hidden = true;
    cup.setAttribute("aria-expanded", "false");
    if (controls.contains(document.activeElement)) cup.focus();
  }
  cup.addEventListener("click", () => {
    if (!controls.hidden) return closeControls();
    controls.hidden = false;
    cup.setAttribute("aria-expanded", "true");
    toggle!.focus();
  });
  document.getElementById("teaClose")!.addEventListener("click", closeControls);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); closeControls(); }
  });
  document.addEventListener("click", event => {
    if (!root.contains(event.target as Node)) closeControls();
  });
  const syncVisibility = () => root.classList.toggle("tea-motion-paused", document.hidden);
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();

  let awaitingNext = false;
  let deadline = 0;
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
    labelEl!.textContent = awaitingNext ? `${next} ready` : `${next} timer`;
    root!.classList.toggle("is-break", phase === "break");
    root!.classList.toggle("running", running);
    root!.classList.toggle("ringing", ringing);
    root!.classList.toggle("tea-ready", awaitingNext);
    const phaseTotal = phase === "focus" ? focusSecs : breakSecs;
    const action = running ? "Pause" : remaining < phaseTotal ? "Resume" : "Start";
    toggle!.textContent = action;
    toggle!.setAttribute("aria-label", `${action} ${phase} timer`);
    toggle!.title = ringing ? `Start your ${phase === "break" ? "break" : "next focus session"}` : `${action} the timer; audio is separate`;
    const total = phase === "focus" ? focusSecs : breakSecs;
    const fraction = awaitingNext ? 0 : Math.max(0, Math.min(1, remaining / total));
    root!.style.setProperty("--tea-level", String(fraction));
    caption.textContent = awaitingNext ? `${next} ready` : running ? next === "Break" ? "Break time" : "Reading time" : remaining < total ? "Paused" : "Tea timer";
    const timerState = awaitingNext ? `${next} ready` : `${next} ${running ? "running" : remaining < total ? "paused" : "ready"}`;
    cup.setAttribute("aria-label", `Tea timer. ${timerState}, ${fmt(remaining)} remaining. Open timer controls`);
    cup.title = `${timerState} · ${fmt(remaining)} remaining`;
    const elapsed = total > 0 ? (total - remaining) / total : 0;
    toggle!.style.setProperty("--progress", `${(elapsed * 360).toFixed(1)}deg`);
  }

  function tick(): void {
    remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining <= 0) {
      // Boundary: stop counting, flip to the next phase, and ring until acknowledged.
      pause();
      phase = phase === "focus" ? "break" : "focus";
      remaining = phase === "focus" ? focusSecs : breakSecs;
      awaitingNext = true;
      announcement.textContent = `${phase === "break" ? "Reading session complete. Your break" : "Break complete. Your next reading session"} is ready.`;
      startRing();
      closeControls();
      completionTitle.textContent = phase === "break" ? "Time for a break" : "Your break is complete";
      const nextMinutes = Math.round(remaining / 60);
      const nextDuration = `${nextMinutes} ${nextMinutes === 1 ? "minute" : "minutes"}`;
      completionDescription.textContent = phase === "break"
        ? `Your reading session is complete. Take ${nextDuration} away from the page when you’re ready.`
        : `Ready to return to your draft? Your next reading timer is set to ${nextDuration}. Audio stays under your control.`;
      completionStart.textContent = phase === "break" ? "Start break" : "Start reading timer";
      if (!completion.open) completion.showModal();
      completionTitle.focus();
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
    if (completion.open) completion.close();
    awaitingNext = false;
    running = true;
    deadline = Date.now() + remaining * 1000;
    timer = window.setInterval(tick, 1000);
    paint();
  }
  function pause(): void {
    running = false;
    window.clearInterval(timer);
    paint();
  }
  function resetAll(): void {
    if (completion.open) completion.close();
    awaitingNext = false;
    announcement.textContent = "";
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
