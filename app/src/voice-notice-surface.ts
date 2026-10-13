/** A transient info box that returns to its voice control without moving the reader. */
export function createVoiceNoticeSurface(notice: HTMLElement, player: HTMLElement) {
  let retiring: Animation | undefined;
  const anchor = () => player.querySelector<HTMLElement>('#voicePickerToggle') || player.querySelector<HTMLElement>('#playerPlay');
  const position = () => {
    const rect = anchor()?.getBoundingClientRect();
    const top = player.getBoundingClientRect().top;
    const width = Math.min(360, innerWidth - 32);
    Object.assign(notice.style, {
      width: `${width}px`, left: `${Math.max(16, Math.min(rect?.left ?? 16, innerWidth - width - 16))}px`,
      bottom: `${innerHeight - top + 12}px`, maxHeight: `${Math.max(80, top - 28)}px`
    });
  };
  const show = () => {
    if (retiring) { const previous = retiring; retiring = undefined; previous.cancel(); }
    notice.inert = false;
    notice.hidden = false;
    position();
  };
  const hide = (returnToVoice: boolean) => {
    if (notice.hidden || retiring) return;
    if (notice.contains(document.activeElement)) anchor()?.focus({preventScroll:true});
    const target = anchor();
    if (!returnToVoice || !target || typeof notice.animate !== 'function') { notice.hidden = true; return; }
    const from = notice.getBoundingClientRect();
    const to = (target.querySelector('img') || target).getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transform = `translate(${to.left + to.width / 2 - from.left}px, ${to.top + to.height / 2 - from.top}px) scale(.06)`;
    notice.inert = true;
    const animation = notice.animate(reduced
      ? [{opacity: 1}, {opacity: 0}]
      : [{transform: 'none', opacity: 1}, {transform, opacity: 0}],
      {duration: reduced ? 120 : 320, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards'});
    retiring = animation;
    void animation.finished.then(() => {
      if (retiring !== animation) return;
      notice.hidden = true; retiring = undefined; animation.cancel();
    }, () => { /* A new preparation interrupted the return. */ });
  };
  window.addEventListener('resize', () => { if (!notice.hidden) position(); });
  return {show, hide};
}
