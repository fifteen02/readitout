import { bindNoteInputKeys } from "./note-input";
import { deskIcon } from "./desk-icons";
// Floating toolbar shown at a text selection: pick a highlight colour and write a note,
// then Enter to save. Clicking a colour only *chooses* it (the popover stays open so you
// can keep typing); the highlight is committed on Enter.

export interface PopoverActions {
  onSubmit: (color: string, text: string) => void; // Enter → highlight in the chosen colour, with the note
  onEdit: (color: string, text: string) => void; // pencil → highlight, then open the full editor
  onCopy: () => void;
  onListen: () => void;
}

export interface SelectionPopover {
  showAt(rect: DOMRect, color: string): void;
  hide(): void;
  visible(): boolean;
  contains(node: Node | null): boolean;
}

interface PopoverViewport { left: number; top: number; width: number; height: number }

export function selectionPopoverPosition(
  anchor: Pick<DOMRect, "left" | "top" | "bottom" | "width">,
  size: { width: number; height: number },
  viewport: PopoverViewport
): { left: number; top: number } {
  const minLeft = viewport.left + 8;
  const minTop = viewport.top + 8;
  const left = Math.max(minLeft, Math.min(
    viewport.left + viewport.width - size.width - 8,
    anchor.left + anchor.width / 2 - size.width / 2
  ));
  const above = anchor.top - size.height - 8;
  const preferredTop = above < minTop ? anchor.bottom + 8 : above;
  const top = Math.max(minTop, Math.min(preferredTop, viewport.top + viewport.height - size.height - 8));
  return { left, top };
}

const NOTE_SVG = deskIcon("pen");
const COPY_SVG = deskIcon("copy");
const PLAY_SVG = deskIcon("play");

export function createSelectionPopover(colors: string[], actions: PopoverActions): SelectionPopover {
  const el = document.createElement("div");
  el.className = "sel-popover";
  el.hidden = true;

  let anchor: DOMRect | null = null;
  let placementFrame = 0;
  const viewport = window.visualViewport;
  const reposition = (): void => {
    placementFrame = 0;
    if (el.hidden || !anchor) return;
    const bounds = {
      left: viewport?.offsetLeft ?? 0,
      top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight
    };
    // A virtual keyboard changes the visual viewport without resizing the layout.
    el.style.maxWidth = `${Math.max(0, bounds.width - 24)}px`;
    el.style.maxHeight = `${Math.max(0, bounds.height - 16)}px`;
    const position = selectionPopoverPosition(anchor, { width: el.offsetWidth, height: el.offsetHeight }, bounds);
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
  };
  const schedulePlacement = (): void => {
    if (!placementFrame) placementFrame = requestAnimationFrame(reposition);
  };
  const hide = (): void => {
    el.hidden = true;
    anchor = null;
    cancelAnimationFrame(placementFrame);
    placementFrame = 0;
    window.removeEventListener("resize", schedulePlacement);
    viewport?.removeEventListener("resize", schedulePlacement);
    viewport?.removeEventListener("scroll", schedulePlacement);
  };

  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Selected passage");
  const tools = document.createElement("div");
  tools.className = "sel-tools";
  const palette = document.createElement("div");
  palette.className = "sel-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "Highlight colour");
  const shortcuts = document.createElement("div");
  shortcuts.className = "sel-shortcuts";
  const noteRow = document.createElement("div");
  noteRow.className = "sel-note-row";
  tools.append(palette, shortcuts);
  el.append(tools, noteRow);
  let selectedColor = colors[0];
  const swatches: HTMLButtonElement[] = [];
  const markChosen = (): void => {
    swatches.forEach((s) => {
      const chosen = s.dataset.color === selectedColor;
      s.classList.toggle("chosen", chosen);
      s.setAttribute("aria-pressed", String(chosen));
    });
  };

  colors.forEach((color) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "sel-swatch";
    dot.dataset.color = color;
    dot.style.setProperty("--c", color);
    const colorNames: Record<string, string> = {
      "#ffd240": "yellow", "#72d6a3": "green", "#7db7ff": "blue",
      "#ff8f8a": "coral", "#b99cff": "lavender"
    };
    dot.setAttribute("aria-label", `Highlight ${colorNames[color] ?? color}`);
    dot.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus on the note field
    dot.addEventListener("click", () => {
      // Choose the colour but keep the popover open so the user can keep writing.
      selectedColor = color;
      markChosen();
      input.focus();
    });
    swatches.push(dot);
    palette.appendChild(dot);
  });

  const input = document.createElement("input");
  input.type = "text";
  input.className = "sel-note";
  input.placeholder = "Write a note…";
  input.setAttribute("aria-label", "Annotation note");
  bindNoteInputKeys(input, text => actions.onSubmit(selectedColor, text), hide);
  noteRow.appendChild(input);

  const act = (label: string, svg: string, fn: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sel-act";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = svg;
    if (label === "Add note") {
      button.classList.add("sel-act-note");
      const caption = document.createElement("span");
      caption.textContent = label;
      button.appendChild(caption);
    }
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", fn);
    (label === "Add note" ? noteRow : shortcuts).appendChild(button);
  };
  act("Add note", NOTE_SVG, () => actions.onEdit(selectedColor, input.value.trim()));
  act("Copy text", COPY_SVG, actions.onCopy);
  act("Read from here", PLAY_SVG, actions.onListen);

  document.body.appendChild(el);

  return {
    showAt(rect: DOMRect, color: string) {
      el.hidden = false;
      input.value = "";
      selectedColor = colors.includes(color) ? color : colors[0];
      markChosen();
      anchor = rect;
      reposition();
      window.addEventListener("resize", schedulePlacement);
      viewport?.addEventListener("resize", schedulePlacement);
      viewport?.addEventListener("scroll", schedulePlacement);
      requestAnimationFrame(() => {
        if (!el.hidden) input.focus({ preventScroll: true });
      }); // ready to type; viewport events keep controls above the keyboard
    },
    hide,
    visible() {
      return !el.hidden;
    },
    contains(node: Node | null) {
      return !!node && el.contains(node);
    }
  };
}
