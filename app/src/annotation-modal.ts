import type { AppState, Annotation } from "./types";

export interface ModalEls {
  overlay: HTMLElement;
  meta: HTMLElement;
  dot: HTMLElement;
  quoteEl: HTMLElement;
  colors: HTMLElement;
  textarea: HTMLTextAreaElement;
  tags: HTMLInputElement;
  suggest: HTMLElement;
  saveBtn: HTMLElement;
  deleteBtn: HTMLElement;
  closeBtn: HTMLElement;
}

export interface ModalApi {
  save: () => void;
  renderList: () => void;
  recolor: (anno: Annotation) => void;
  remove: () => void;
}

export interface ModalController {
  open(): void;
  close(): void;
}

// Feedback modal for a single annotation. Opens when an annotation (or its
// list entry) is selected, so notes are written in a focused dialog rather
// than a cramped sidebar field.
export function initAnnotationModal(els: ModalEls, state: AppState, api: ModalApi): ModalController {
  const { overlay, meta, dot, quoteEl, colors, textarea, tags, suggest, saveBtn, deleteBtn, closeBtn } = els;
  const current = (): Annotation | undefined => state.annotations.find((a) => a.id === state.selectedId);

  // Clickable chips for tags already used elsewhere, so tagging stays consistent.
  function renderSuggest(anno: Annotation): void {
    const applied = new Set((anno.tags || []).map((t) => t.toLowerCase()));
    const all = [...new Set(state.annotations.flatMap((a) => a.tags || []))].filter((t) => !applied.has(t.toLowerCase()));
    suggest.replaceChildren(
      ...all.slice(0, 12).map((tag) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-suggest-chip";
        chip.textContent = `+ ${tag}`;
        chip.addEventListener("click", () => {
          anno.tags = [...(anno.tags || []), tag];
          anno.updatedAt = new Date().toISOString();
          tags.value = anno.tags.join(", ");
          queueSave();
          renderSuggest(anno);
        });
        return chip;
      })
    );
  }

  function syncColors(color: string): void {
    colors.querySelectorAll<HTMLElement>(".swatch").forEach((sw) => {
      const active = sw.dataset.color === color;
      sw.classList.toggle("active", active);
      sw.setAttribute("aria-pressed", String(active));
    });
  }

  function open(): void {
    const anno = current();
    if (!anno) return;
    meta.textContent = `Page ${anno.page}`;
    dot.style.background = anno.color || "#ffd240";
    const quote = (anno.quote || "").trim();
    if (quote) {
      quoteEl.textContent = `“${quote}”`;
      quoteEl.hidden = false;
    } else {
      quoteEl.hidden = true;
    }
    textarea.value = anno.text || "";
    tags.value = (anno.tags || []).join(", ");
    renderSuggest(anno);
    syncColors(anno.color || "#ffd240");
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });
  }

  // Persisting + re-rendering the (blurred) list on every keystroke makes typing
  // janky, so debounce it. The annotation text is updated immediately in memory.
  let saveTimer = 0;
  let pending = false;
  function flushSave(): void {
    if (!pending) return;
    pending = false;
    window.clearTimeout(saveTimer);
    api.save();
    api.renderList();
  }
  function queueSave(): void {
    pending = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 300);
  }

  function close(): void {
    flushSave();
    overlay.hidden = true;
    document.body.classList.remove("modal-open");
  }

  textarea.addEventListener("input", () => {
    const anno = current();
    if (!anno) return;
    anno.text = textarea.value;
    anno.updatedAt = new Date().toISOString();
    pending = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 300);
  });

  tags.addEventListener("input", () => {
    const anno = current();
    if (!anno) return;
    anno.tags = tags.value.split(",").map((t) => t.trim()).filter(Boolean);
    anno.updatedAt = new Date().toISOString();
    queueSave();
    renderSuggest(anno);
  });

  colors.addEventListener("click", (event) => {
    const sw = (event.target as HTMLElement).closest<HTMLElement>(".swatch");
    if (!sw) return;
    const anno = current();
    if (!anno) return;
    anno.color = sw.dataset.color as string;
    anno.updatedAt = new Date().toISOString();
    syncColors(anno.color);
    api.save();
    api.recolor(anno);
    api.renderList();
  });

  saveBtn.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  deleteBtn.addEventListener("click", () => {
    api.remove();
    close();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      event.preventDefault();
      const anno = current();
      if (anno && !(anno.text || "").trim()) {
        // Escaping out of an annotation with no comment discards it.
        pending = false;
        window.clearTimeout(saveTimer);
        overlay.hidden = true;
        document.body.classList.remove("modal-open");
        api.remove();
      } else {
        close();
      }
    }
  });

  return { open, close };
}
