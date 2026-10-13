import './note-preview.css';
import { notePreviewLayout } from './note-preview-layout';

let tip: HTMLDivElement | undefined;
let content: HTMLDivElement;
let anchor: HTMLButtonElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const cancelHide = () => { clearTimeout(timer); };
export function hideNotePreview(): void {
  cancelHide();
  if (tip) tip.hidden = true;
  document.documentElement.classList.remove('note-preview-open');
  document.documentElement.style.removeProperty('--note-preview-h');
  anchor?.removeAttribute('aria-describedby');
  anchor = undefined;
}
const deferHide = () => {
  cancelHide();
  if (!tip?.classList.contains('is-docked')) timer = setTimeout(hideNotePreview, 160);
};

function showNotePreview(button: HTMLButtonElement, text: string): void {
  hideNotePreview();
  if (!text.trim()) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'notePreview'; tip.className = 'note-preview'; tip.role = 'region';
    tip.setAttribute('aria-label', 'Note preview');
    const head = document.createElement('div'); head.className = 'note-preview-head';
    const label = document.createElement('span'); label.textContent = 'Note';
    const close = document.createElement('button'); close.type = 'button';
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    close.title = 'Close note preview';
    close.setAttribute('aria-label', 'Close note preview');
    close.addEventListener('click', () => {
      const opener = anchor; hideNotePreview();
      // Prevent focusing the opener from immediately reopening the preview.
      opener?.focus({preventScroll:true}); hideNotePreview();
    });
    head.append(label, close);
    content = document.createElement('div'); content.id = 'notePreviewText';
    content.className = 'note-preview-content'; content.tabIndex = 0;
    content.setAttribute('role', 'region'); content.setAttribute('aria-label', 'Note text');
    tip.append(head, content);
    tip.addEventListener('mouseenter', cancelHide);
    tip.addEventListener('mouseleave', deferHide);
    document.body.append(tip);
    document.addEventListener('scroll', event => {
      if (tip?.contains(event.target as Node)) return;
      if (!tip?.classList.contains('is-docked')) hideNotePreview();
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!tip?.hidden && !tip?.contains(event.target as Node) && event.target !== anchor) hideNotePreview();
    });
    window.addEventListener('resize', hideNotePreview);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && tip && !tip.hidden) {
        event.preventDefault(); event.stopPropagation();
        const opener = anchor; hideNotePreview();
        if (tip.contains(document.activeElement)) { opener?.focus({preventScroll:true}); hideNotePreview(); }
      }
    }, true);
  }
  anchor = button;
  button.setAttribute('aria-describedby', content.id);
  content.textContent = text;
  content.scrollTop = 0;
  tip.classList.remove('is-docked');
  tip.style.cssText = ''; tip.hidden = false;
  const page = button.closest('.page')!.getBoundingClientRect();
  const ceiling = Math.max(12, document.querySelector('.topbar')!.getBoundingClientRect().bottom);
  const floor = Math.min(window.innerHeight, document.querySelector('.readerbar')!.getBoundingClientRect().top);
  let layout = notePreviewLayout({width: window.innerWidth, ceiling, floor,
    pageLeft: page.left, pageRight: page.right, anchorTop: button.getBoundingClientRect().top,
    contentHeight: tip.scrollHeight});
  tip.classList.toggle('is-docked', layout.docked);
  if (layout.docked) {
    // Measure at the final reading measure, not the narrow margin-card width.
    tip.style.width = `${layout.width}px`;
    const style = getComputedStyle(tip);
    const head = tip.firstElementChild as HTMLElement;
    const headHeight = getComputedStyle(head).position === 'absolute' ? 0 : head.getBoundingClientRect().height;
    const naturalHeight = headHeight +
      content.scrollHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth);
    layout = notePreviewLayout({width: window.innerWidth, ceiling, floor,
      pageLeft: page.left, pageRight: page.right, anchorTop: button.getBoundingClientRect().top,
      contentHeight: naturalHeight});
  }
  Object.assign(tip.style, {left: `${layout.left}px`, top: `${layout.top}px`,
    width: `${layout.width}px`, height: `${layout.height}px`});
  if (layout.docked) {
    document.documentElement.style.setProperty('--note-preview-h', `${layout.height + 16}px`);
    document.documentElement.classList.add('note-preview-open');
    const viewer = document.getElementById('viewer')!;
    const mark = button.getBoundingClientRect();
    const visibleBottom = layout.top - 12;
    if (mark.bottom > visibleBottom) viewer.scrollTop += mark.bottom - visibleBottom;
    else if (mark.top < ceiling + 12) viewer.scrollTop -= ceiling + 12 - mark.top;
  }
}

export function attachNotePreview(button: HTMLButtonElement, text: string): void {
  if (!text.trim()) return;
  button.addEventListener('mouseenter', () => showNotePreview(button, text));
  button.addEventListener('mouseleave', deferHide);
  button.addEventListener('focus', () => showNotePreview(button, text));
  button.addEventListener('blur', event => {
    if (!tip?.contains(event.relatedTarget as Node) && !tip?.classList.contains('is-docked')) hideNotePreview();
  });
  button.addEventListener('click', hideNotePreview);
}
