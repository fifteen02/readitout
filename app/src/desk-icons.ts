/** Illustrated reading-desk tools. Shared geometry keeps static and live controls alike. */
const paper = '<path class="di-paper" d="M12 8h24l8 8v31H12Z"/><path class="di-fold" d="M36 8v9h8"/>';
const round = '<circle class="di-metal" cx="28" cy="27" r="19"/><circle class="di-light" cx="28" cy="27" r="15"/>';
const pageArrow = '<path class="di-metal" d="m9 28 16-15v10h22v10H25v10Z"/><path class="di-highlight" d="m16 27 6-6m6 5h15"/>';
const drawings = {
  book: '<path class="di-binding" d="M5 15q12-6 23 0 12-6 23 0v31q-12-5-23 0-11-5-23 0Z"/><path class="di-paper" d="M7 10q11-4 21 2v30q-10-6-21-2Z"/><path class="di-detail" d="M12 17l10 2m-10 5 10 2m-10 5 10 2"/><g class="di-book-right"><path class="di-paper" d="M28 12q10-6 21-2v30q-11-4-21 2Z"/><path class="di-detail" d="m34 19 10-2m-10 9 10-2m-10 9 10-2"/><path class="di-ribbon" d="M37 10h5v18l-2.5-2-2.5 3Z"/></g><path class="di-detail" d="M28 13v28"/>',
  settings: '<path class="di-wood" d="M6 11h44v35H6Z"/><path class="di-light" d="M9 14h38v29H9Z"/><path class="di-detail" d="M16 19v19M28 19v19M40 19v19"/><circle class="di-metal" cx="16" cy="25" r="5"/><circle class="di-metal" cx="28" cy="33" r="5"/><circle class="di-metal" cx="40" cy="23" r="5"/><path class="di-detail" d="M16 22v3m12 5v3m12-13v3"/>',
  listen: '<path class="di-leather" d="M9 33v-8a19 19 0 0 1 38 0v8h-5v-8a14 14 0 0 0-28 0v8Z"/><path class="di-metal" d="M10 28h6v17h-6q-4 0-4-5v-7q0-5 4-5Zm36 0h-6v17h6q4 0 4-5v-7q0-5-4-5Z"/><rect class="di-leather" x="13" y="26" width="7" height="21" rx="3"/><rect class="di-leather" x="36" y="26" width="7" height="21" rx="3"/><path class="di-highlight" d="M16 31v10m23-10v10"/>',
  focus: '<path class="di-wood" d="m34 32 15 13q3 3 0 6t-6 0L30 36Z"/><path class="di-metal" d="m32 30 7 7-4 4-7-7Z"/><circle class="di-metal" cx="23" cy="23" r="17"/><circle class="di-light" cx="23" cy="23" r="14.5"/><circle class="di-glass focus-lens" cx="23" cy="23" r="12"/><path class="di-detail focus-context" d="M17 18h12m-12 10h9"/><path class="di-detail focus-line" d="M15 23h16"/><path class="di-highlight" d="M12 21q1-8 9-9m18 29 7 7"/>',
  notes: '<path class="di-binding" d="M9 7h31v42H9Z"/><path class="di-paper" d="M13 8h25v38H13Z"/><path class="di-detail" d="M18 16h14M18 22h14M18 28h10M13 43h21"/><path class="di-metal" d="m41 13 6 2-9 29-6 5-1-8Z"/><path class="di-detail" d="m44 16-9 26m-3 7 3-1"/>',
  page: paper+'<path class="di-detail" d="M19 30h17M19 37h12"/><path class="di-ribbon" d="M19 8h8v16l-4-3-4 3Z"/>',
  copy: '<path class="di-fold" d="M6 6h29v36H6Z"/>'+paper+'<path class="di-detail" d="M19 24h17M19 31h17M19 38h11"/>',
  pen: '<path class="di-paper" d="M7 14h32v34H7Z"/><path class="di-detail" d="M13 38h16"/><path class="di-metal" d="m38 6 10 5-16 29-11 6 1-12Z"/><path class="di-detail" d="m43 11-16 27m-5-4 10 6m-11 6 4-2"/>',
  play: round+'<path class="di-engrave" d="m24 18 13 9-13 9Z"/>',
  pause: round+'<path class="di-engrave" d="M21 18h4v18h-4Zm10 0h4v18h-4Z"/>',
  skipBack: round+'<path class="di-engrave" d="M19 18h3v18h-3Zm17 0L24 27l12 9Z"/>',
  skipForward: round+'<path class="di-engrave" d="M34 18h3v18h-3Zm-14 0 12 9-12 9Z"/>',
  previous: pageArrow,
  next: '<g transform="translate(56 0) scale(-1 1)">'+pageArrow+'</g>',
  lineUp: '<g transform="rotate(90 28 28)">'+pageArrow+'</g>',
  lineDown: '<g transform="rotate(-90 28 28)">'+pageArrow+'</g>',
  chevron: '<path class="di-metal" d="m10 19 6-6 12 12 12-12 6 6-18 18Z"/>',
  up: paper+'<path class="di-detail di-bold" d="m20 32 8-8 8 8"/>',
  down: paper+'<path class="di-detail di-bold" d="m20 24 8 8 8-8"/>',
  close: round+'<path class="di-detail di-bold" d="m22 21 12 12m0-12L22 33"/>',
  plus: round+'<path class="di-detail di-bold" d="M20 27h16m-8-8v16"/>',
  minus: round+'<path class="di-detail di-bold" d="M20 27h16"/>',
  reset: round+'<path class="di-detail di-bold" d="M36 25a9 9 0 1 1-5-7m0 0h-7m7 0v7"/>',
  back: paper+'<path class="di-detail di-bold" d="M22 21l-6 6 6 6m-6-6h16q6 0 6 8"/>',
  day: '<circle class="di-metal" cx="28" cy="28" r="12"/><circle class="di-light" cx="28" cy="28" r="8"/><path class="di-detail" d="M28 6v5m0 34v5M6 28h5m34 0h5M12 12l4 4m24 24 4 4M12 44l4-4m24-24 4-4"/>',
  night: '<path class="di-metal" d="M33 6a22 22 0 1 0 17 32A21 21 0 0 1 33 6Z"/><path class="di-highlight" d="M21 13a17 17 0 0 0-8 19"/>',
  check: round+'<path class="di-detail di-bold" d="m19 27 6 6 12-13"/>',
  loading: '<path class="di-wood" d="M14 6h28v5H14Zm0 39h28v5H14Z"/><path class="di-glass" d="M18 11q0 12 10 17-10 5-10 17h20q0-12-10-17 10-5 10-17Z"/><path class="di-metal hourglass-upper" d="m21 18 7 10 7-10Z"/><path class="di-metal hourglass-lower" d="M21 42l7-9 7 9Z"/><path class="di-metal hourglass-stream" d="M27.5 27h1v13h-1Z"/>',
  alert: paper+'<path class="di-detail di-bold" d="M28 22v10m0 6v1"/>'
};
export type DeskIcon = keyof typeof drawings;
export function deskIcon(name: DeskIcon, extraClass = ''): string {
  return `<svg class="desk-icon desk-icon-${name} ${extraClass}" viewBox="0 0 56 56" width="32" height="32" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawings[name]}</svg>`;
}

export function initDeskIcons(): void {
  const replace = (selector: string, icon: DeskIcon, extraClass = '') => {
    document.querySelectorAll<SVGElement>(selector).forEach(svg => { svg.outerHTML = deskIcon(icon, extraClass); });
  };
  replace('#readerOpen > svg, #welcomeOpen > svg', 'book');
  replace('#railSettings > svg', 'settings');
  replace('#focusToggle > svg', 'focus');
  replace('#prevPage > svg', 'previous');
  replace('#toggleAnnoPanel > svg', 'close');
  replace('#nextPage > svg', 'next');
  replace('#playerPrev > svg', 'skipBack');
  replace('#playerNext > svg', 'skipForward');
  replace('#playerGoto > svg', 'page');
  replace('#railFlyoutClose > svg, #teaClose > svg', 'close');
  replace('#pomoReset > svg', 'reset');
  replace('#voicePreview > svg', 'play');
  replace('[data-appearance="light"] > svg', 'day');
  replace('[data-appearance="dark"] > svg', 'night');
  replace('.ip-i-play', 'play', 'ip-i-play');
  replace('.ip-i-pause', 'pause', 'ip-i-pause');
  replace('.cmdk-search > svg', 'focus');
  const modalClose = document.getElementById('annoModalClose');
  if (modalClose) modalClose.innerHTML = deskIcon('close');
  for (const [id, icon] of [['zoomIn', 'plus'], ['zoomOut', 'minus']] as const) {
    const button = document.getElementById(id);
    if (button) button.innerHTML = deskIcon(icon);
  }
}
