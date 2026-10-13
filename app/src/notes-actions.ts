import { deskIcon, type DeskIcon } from "./desk-icons";
import "./notes-actions.css";

/** A light-dismissable tray keeps file actions out of the notes list. */
export function initNotesActions(): void {
  const trigger = document.getElementById("notesActionsToggle") as HTMLButtonElement;
  const panel = document.getElementById("notesActionsPopover")!;
  const icons: [string, DeskIcon][] = [
    ["notesActionsToggle", "notes"], ["copyNotes", "copy"],
    ["exportMarkdown", "down"], ["copyReviewBrief", "pen"],
    ["exportAnno", "notes"], ["importAnnoButton", "up"]
  ];
  for (const [id, icon] of icons) {
    const button = document.getElementById(id)!;
    const label = document.createElement("span");
    label.textContent = button.textContent;
    button.innerHTML = deskIcon(icon);
    button.append(label);
  }
  document.getElementById("notesActionsClose")!.innerHTML = deskIcon("close");
  document.getElementById("notesOrganiseToggle")!.innerHTML = deskIcon("settings");
  document.getElementById("notesOrganiseClose")!.innerHTML = deskIcon("close");
  bindTray(trigger, panel, "above");
  bindTray(
    document.getElementById("notesOrganiseToggle") as HTMLButtonElement,
    document.getElementById("notesOrganisePopover")!, "below"
  );
}

function bindTray(trigger: HTMLButtonElement, panel: HTMLElement, placement: "above" | "below"): void {
  // Native popover dismissal and control keys must not also change the reader behind it.
  panel.addEventListener("keydown", event => event.stopPropagation());
  function position(): void {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(304, window.innerWidth - 24);
    const left = placement === "below" ? rect.right - width : rect.left;
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
    if (placement === "above") {
      panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      panel.style.maxHeight = `${Math.max(120, rect.top - 20)}px`;
    } else {
      const top = Math.min(rect.bottom + 8, window.innerHeight - 132);
      panel.style.top = `${top}px`;
      panel.style.maxHeight = `${window.innerHeight - top - 12}px`;
    }
  }
  panel.addEventListener("beforetoggle", event => {
    if ((event as ToggleEvent).newState === "open") position();
  });
  panel.addEventListener("toggle", () => {
    trigger.setAttribute("aria-expanded", String(panel.matches(":popover-open")));
  });
  // Follow the anchor across desktop/drawer layout changes.
  window.addEventListener("resize", () => {
    if (!panel.matches(":popover-open")) return;
    if (!trigger.getClientRects().length) panel.hidePopover();
    else position();
  });
}
