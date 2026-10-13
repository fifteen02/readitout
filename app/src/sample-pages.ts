import { deskIcon } from './desk-icons';

export function samplePageAt(left: number, stride: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor((left + 1) / stride)));
}

/** Fixed paper leaves in compact windows; roomy desktops keep the full-page layout. */
export function initSamplePages(onManualTurn: () => void): { follow: (sentence: HTMLElement, progress: number) => void } {
  const viewport = document.getElementById('introTextWindow')!;
  const text = document.getElementById('introText')!;
  const page = document.getElementById('introDoc')!;
  const previous = document.getElementById('samplePrevious') as HTMLButtonElement;
  const next = document.getElementById('sampleNext') as HTMLButtonElement;
  const number = document.getElementById('samplePageNumber')!;
  const mobile = matchMedia('(max-width: 1100px), (max-height: 850px)');
  previous.innerHTML = deskIcon('previous');
  next.innerHTML = deskIcon('next');
  let current = 0;
  let count = 1;
  let stride = 1;
  let bookmark: Range | null = null;
  function rememberPassage(): void {
    if (!mobile.matches) return;
    const origin = text.getBoundingClientRect().left;
    const nodes = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = nodes.nextNode())) {
      for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index!);
        range.setEnd(node, word.index! + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width && samplePageAt(rect.left - origin, stride, count) === current) {
          bookmark = range;
          return;
        }
      }
    }
  }
  function show(index: number, remember = true): void {
    current = Math.max(0, Math.min(count - 1, index));
    text.style.transform = mobile.matches ? `translateX(${-current * stride}px)` : '';
    const label = `${current + 1} / ${count}`;
    if (number.textContent !== label) number.textContent = label;
    // Disabling a focused button would send keyboard users back to the document body.
    if ((document.activeElement === previous && current === 0)
      || (document.activeElement === next && current === count - 1)) {
      page.focus({ preventScroll: true });
    }
    previous.disabled = current === 0;
    next.disabled = current === count - 1;
    if (remember) rememberPassage();
  }
  function measure(): void {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    stride = viewport.clientWidth + 24;
    count = mobile.matches ? Math.max(1, Math.ceil((text.scrollWidth + 24) / stride)) : 1;
    // Page numbers change with column height; keep the same word in view instead.
    const anchored = bookmark && text.contains(bookmark.startContainer);
    const target = mobile.matches && anchored
      ? samplePageAt(bookmark!.getBoundingClientRect().left - text.getBoundingClientRect().left, stride, count)
      : current;
    show(target, false);
    if (!anchored) rememberPassage();
  }
  function turn(delta: number): void { onManualTurn(); show(current + delta); }
  previous.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));
  page.addEventListener('keydown', event => {
    if (!mobile.matches || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    turn(event.key === 'ArrowLeft' ? -1 : 1);
  });
  new ResizeObserver(measure).observe(viewport);
  new MutationObserver(measure).observe(text, { childList: true, subtree: true });
  mobile.addEventListener('change', measure);
  void document.fonts.ready.then(measure);
  return { follow(sentence, progress) {
    if (!mobile.matches || count <= 1) return;
    const lines = Array.from(sentence.getClientRects()).filter(rect => rect.width && rect.height);
    if (!lines.length) return;
    // Sentence timing is measured; distribute its wrapped lines across that interval.
    const line = lines[Math.min(lines.length - 1, Math.floor(Math.max(0, Math.min(1, progress)) * lines.length))];
    const target = samplePageAt(line.left - text.getBoundingClientRect().left, stride, count);
    if (target !== current) show(target);
  } };
}
