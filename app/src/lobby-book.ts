import { deskIcon } from "./desk-icons";
import { createBookTurn } from "./book-turn";

/** One silent welcome reveal; listening remains an explicit action. */
export function initLobbyBook(onClose: () => void): void {
  const book = document.getElementById("lobbyBook")!;
  const page = document.getElementById("introDoc")!;
  const cover = document.getElementById("lobbyBookOpen") as HTMLButtonElement;
  const replay = document.getElementById("lobbyBookReplay") as HTMLButtonElement;
  cover.querySelector('.lobby-cover-invite')!.innerHTML = '<span class="ribbon-action">Open</span><span class="ribbon-caption">the book</span>';
  replay.innerHTML = '<span class="ribbon-action">Close</span><span class="ribbon-caption">the book</span>';
  document.getElementById("welcomeSample")!.innerHTML = `${deskIcon("book")}<span>Read the sample</span>`;
  const turn = createBookTurn(book, cover);
  const compact = matchMedia('(max-width: 1100px)');
  const actions = document.querySelector('.lobby-book-actions') as HTMLElement;
  const demo = actions.parentElement!;
  const placeActions = (): void => {
    (compact.matches ? demo : book).append(actions);
  };
  placeActions();
  compact.addEventListener('change', placeActions);
  let timer = 0;
  let inView = false;
  let openedOnce = false;
  let inspectingCover = false;
  cover.hidden = false;
  book.classList.add("is-closed");
  page.inert = true;
  page.setAttribute("aria-hidden", "true");
  const cancel = (): void => { window.clearTimeout(timer); };
  const open = (): void => {
    cancel();
    if (book.classList.contains("is-open")) return;
    openedOnce = true;
    const hadFocus = document.activeElement === cover;
    book.classList.remove("is-closed");
    book.classList.add("is-open");
    turn(true);
    page.inert = false;
    page.removeAttribute("aria-hidden");
    cover.disabled = true;
    cover.setAttribute("aria-hidden", "true");
    replay.hidden = false;

    replay.setAttribute("aria-expanded", "true");
    if (hadFocus) replay.focus({ preventScroll: true });
  };
  compact.addEventListener('change', () => { if (compact.matches) open(); });
  if (compact.matches) open();
  const close = (): void => {
    const hadFocus = document.activeElement === replay;
    cancel();
    onClose();
    book.classList.remove("is-open");
    book.classList.add("is-closed");
    turn(false);
    page.inert = true;
    page.setAttribute("aria-hidden", "true");
    cover.disabled = false;
    cover.removeAttribute("aria-hidden");
    replay.hidden = true;
    replay.setAttribute("aria-expanded", "false");
    if (hadFocus) cover.focus({ preventScroll: true });
  };
  replay.setAttribute("aria-controls", "introDoc");
  const schedule = (): void => {
    cancel();
    if (inView && !document.hidden && !openedOnce && !inspectingCover && document.activeElement !== cover) {
      timer = window.setTimeout(() => open(), 5000);
    }
  };
  new IntersectionObserver(entries => {
    inView = entries[0].intersectionRatio >= .4;
    schedule();
  }, { threshold: [0, .4] }).observe(book);
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pagehide", cancel);
  cover.addEventListener("pointerenter", event => {
    if (event.pointerType === "touch") return;
    inspectingCover = true;
    cancel();
  });
  cover.addEventListener("pointerleave", () => { inspectingCover = false; schedule(); });
  cover.addEventListener("focus", cancel);
  cover.addEventListener("blur", schedule);
  cover.addEventListener("click", () => open());
  replay.addEventListener("click", () => book.classList.contains("is-open") ? close() : open());
  document.getElementById("introPlay")!.addEventListener("click", () => open());
}
