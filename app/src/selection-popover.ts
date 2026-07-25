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

const NOTE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

export function createSelectionPopover(colors: string[], actions: PopoverActions): SelectionPopover {
  const el = document.createElement("div");
  el.className = "sel-popover";
  el.hidden = true;

  const hide = (): void => {
    el.hidden = true;
  };

  let selectedColor = colors[0];
  const swatches: HTMLButtonElement[] = [];
  const markChosen = (): void => {
    swatches.forEach((s) => s.classList.toggle("chosen", s.dataset.color === selectedColor));
  };

  colors.forEach((color) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "sel-swatch";
    dot.dataset.color = color;
    dot.style.setProperty("--c", color);
    dot.setAttribute("aria-label", `Highlight ${color}`);
    dot.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus on the note field
    dot.addEventListener("click", () => {
      // Choose the colour but keep the popover open so the user can keep writing.
      selectedColor = color;
      markChosen();
      input.focus();
    });
    swatches.push(dot);
    el.appendChild(dot);
  });

  const sep = document.createElement("span");
  sep.className = "sel-sep";
  el.appendChild(sep);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "sel-note";
  input.placeholder = "Write a note, then Enter…";
  input.setAttribute("aria-label", "Annotation note");
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      actions.onSubmit(selectedColor, input.value.trim());
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  });
  el.appendChild(input);

  const act = (label: string, svg: string, fn: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sel-act";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = svg;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", fn);
    el.appendChild(button);
  };
  act("Edit in full editor", NOTE_SVG, () => actions.onEdit(selectedColor, input.value.trim()));
  act("Copy text", COPY_SVG, actions.onCopy);
  act("Read from here", PLAY_SVG, actions.onListen);

  document.body.appendChild(el);

  return {
    showAt(rect: DOMRect, color: string) {
      el.hidden = false;
      input.value = "";
      selectedColor = colors.includes(color) ? color : colors[0];
      markChosen();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
      let top = rect.top - h - 8;
      if (top < 8) top = rect.bottom + 8; // flip below if no room above
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      requestAnimationFrame(() => input.focus()); // ready to type immediately
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
