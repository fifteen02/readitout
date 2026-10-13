/** A lightly flexing cover, assembled from narrow continuous strips only while moving. */
export function createBookTurn(book: HTMLElement, cover: HTMLElement): (open: boolean) => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const layer = document.createElement('div');
  layer.className = 'book-turn';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  layer.hidden = true;
  const count = 18;
  const strips = Array.from({ length: count }, () => {
    const strip = document.createElement('div');
    strip.className = 'book-turn-strip';
    const faces = ['front', 'inside'].map((side) => {
      const face = document.createElement('div');
      face.className = `book-turn-face book-turn-${side}`;
      const art = cover.querySelector(`.lobby-cover-${side}`)!.cloneNode(true) as HTMLElement;
      face.append(art);
      strip.append(face);
      return art;
    });
    layer.append(strip);
    return { strip, front: faces[0], inside: faces[1] };
  });
  book.append(layer);
  let progress = 0;
  let target = 0;
  let frame = 0;
  const settle = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    progress = target;
    layer.hidden = true;
    book.classList.remove('is-turning');
  };
  const draw = (width: number): void => {
    const segment = width / count;
    const flex = Math.sin(Math.PI * progress) * .58;
    const fade = Math.max(0, Math.min(1, (progress - .55) / .45));
    let x = 0;
    let z = 0;
    strips.forEach(({ strip, front, inside }, i) => {
      const angle = -Math.PI * progress - flex * ((i + .5) / count - .5);
      strip.style.width = `${segment + 1}px`;
      strip.style.transform = `translate3d(${x}px,0,${z}px) rotateY(${angle}rad)`;
      front.style.width = inside.style.width = `${width}px`;
      front.style.left = `${-i * segment}px`;
      inside.style.left = `${-(width - (i + 1) * segment)}px`;
      inside.style.maskSize = `${1000 - 900 * fade}% 100%`;
      x += segment * Math.cos(angle);
      z -= segment * Math.sin(angle);
    });
  };
  const turn = (open: boolean): void => {
    target = open ? 1 : 0;
    cancelAnimationFrame(frame);
    if (reduced.matches || document.hidden) { settle(); return; }
    const from = progress;
    const width = cover.offsetWidth;
    const duration = (open ? 1700 : 1300) * Math.abs(target - from);
    if (!duration || !width) { settle(); return; }
    const started = performance.now();
    layer.hidden = false;
    book.classList.add('is-turning');
    draw(width);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / duration);
      // Gentle pickup and settling, without overshoot or a fixed-speed hinge.
      const ease = t * t * t * (t * (t * 6 - 15) + 10);
      progress = from + (target - from) * ease;
      draw(width);
      if (t < 1) frame = requestAnimationFrame(tick);
      else settle();
    };
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener('resize', settle);
  window.addEventListener('pagehide', settle);
  reduced.addEventListener('change', settle);
  document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });
  return turn;
}
