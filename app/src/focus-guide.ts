import { deskIcon } from "./desk-icons";
import "./focus-guide.css";

/** Keep the manual reading aid's controls in a dismissible panel beside the focus button. */
export function createFocusGuide(trigger: HTMLButtonElement, actions: {
  move(delta: number): void;
  dim(): void;
  enable(enabled: boolean): void;
}): { sync(enabled: boolean, dimmed: boolean, reading: boolean): void; toggleControls(): void } {
  let active = false;
  let expanded = false;
  const panel = document.createElement("section");
  panel.id = "lineFocusGuide";
  panel.className = "line-focus-guide";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Focus controls");
  panel.innerHTML = `
    <div class="line-focus-copy">
      <h2>Focus</h2>
    </div>
    <label class="line-focus-dim line-focus-mode"><span>Follow one line</span><input type="checkbox" aria-describedby="lineFocusHint"></label>
    <div class="line-focus-steps" role="group" aria-label="Move the focus line">
      <button type="button" data-step="-1" aria-label="Previous line" title="Previous line (Up arrow)">${deskIcon("lineUp")}<span>Previous</span></button>
      <button type="button" data-step="1" aria-label="Next line" title="Next line (Down arrow)"><span>Next</span>${deskIcon("lineDown")}</button>
    </div>
    <p class="line-focus-hint" id="lineFocusHint">Click a line or use the arrow keys.</p>
    <label class="line-focus-dim line-focus-shade"><span>Dim the rest</span><input type="checkbox"></label>
    <div class="line-focus-tools">
      <button type="button" class="line-focus-collapse" aria-label="Close focus controls" title="Close controls — keep your place (Esc)">${deskIcon("close")}</button>
    </div>`;
  trigger.closest(".readerbar")!.append(panel);
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Highlight one line at a time for quiet reading (F)";
  const dim = panel.querySelector<HTMLInputElement>(".line-focus-dim:not(.line-focus-mode) input")!;
  panel.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(button => {
    button.addEventListener("click", () => actions.move(Number(button.dataset.step)));
  });
  dim.addEventListener("change", actions.dim);
  const mode = panel.querySelector<HTMLInputElement>(".line-focus-mode input")!;
  mode.addEventListener("change", () => actions.enable(mode.checked));
  function render(): void {
    const visible = expanded;
    panel.hidden = !visible;
    trigger.setAttribute("aria-expanded", String(visible));
    trigger.setAttribute("aria-label", `Focus${active ? " on" : ""} — ${visible ? "hide" : "show"} controls`);
    trigger.title = `${visible ? "Hide" : "Show"} focus controls`;
    document.querySelector("#app")?.classList.toggle("line-focus-open", visible);
  }
  function collapse(restoreFocus = true): void {
    expanded = false;
    render();
    if (restoreFocus) trigger.focus();
  }
  panel.querySelector(".line-focus-collapse")!.addEventListener("click", () => collapse());
  document.addEventListener("click", event => {
    if (!panel.hidden && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) collapse(false);
  });
  trigger.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault(); event.stopPropagation(); collapse();
    }
  });
  // Space should activate these controls, never the global audio shortcut.
  for (const el of [panel, trigger]) el.addEventListener("keydown", event => {
    if (event.key === " " || event.code === "Space") event.stopPropagation();
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      collapse();
    }
  });
  return {
    sync(enabled, dimmed, reading) {
      if (enabled && !active) expanded = true;
      active = enabled;
      dim.checked = dimmed;
      mode.checked = enabled;
      panel.querySelector<HTMLElement>(".line-focus-steps")!.hidden = !enabled;
      panel.querySelector(".line-focus-hint")!.textContent = enabled
        ? "Click a line or use the arrow keys."
        : reading ? "Dim the passage as you listen. Following one line stops listening."
        : "Follow one line, or dim the rest while listening.";
      render();
    },
    toggleControls() {
      expanded = !expanded;
      render();
      if (expanded) panel.querySelector<HTMLButtonElement>(".line-focus-collapse")!.focus();
    }
  };
}
