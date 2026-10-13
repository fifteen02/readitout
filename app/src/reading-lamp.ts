import './reading-lamp.css';
import { bindPullCord } from './pull-cord';

const lamp = `<svg class="lamp-drawing" viewBox="0 0 56 56" fill="none" aria-hidden="true">
  <ellipse class="lamp-glow" cx="25" cy="29" rx="21" ry="17"/>
  <path class="lamp-stem" d="M23 26v19m-9 3h18M19 45h8"/>
  <path class="lamp-shade" d="M15 6h16l7 20H8L15 6Z"/>
  <path class="lamp-seam" d="m18 8-3 15m13-15 3 15"/>
  <path class="lamp-string-extension" d="M36 27v30"/>
  <g class="lamp-cord"><path d="M36 27v15"/><circle cx="36" cy="45" r="3"/></g>
</svg><span class="lamp-hint" aria-hidden="true">Pull for night</span>`;

export function syncReadingLamps(): void {
  const on = document.documentElement.dataset.theme !== 'dark';
  document.querySelectorAll<HTMLButtonElement>('[data-reading-lamp]').forEach(button => {
    button.setAttribute('aria-pressed', String(on));
    button.title = `Reading light ${on ? 'on' : 'off'}. Pull the cord or click for ${on ? 'night' : 'day'} reading.`;
    const hint = button.querySelector('.lamp-hint');
    if (hint) hint.textContent = `Pull for ${on ? 'night' : 'day'}`;
  });
}

export function initReadingLamps(toggle: () => void): void {
  document.querySelectorAll<HTMLButtonElement>('[data-reading-lamp]').forEach(button => {
    button.innerHTML = lamp;
    let motion: Animation[] = [];
    const stopMotion = () => {
      motion.forEach(animation => animation.cancel());
      motion = [];
      button.classList.remove('tugging');
    };
    button.addEventListener('pointerdown', stopMotion);
    bindPullCord(button, window, gesture => {
      stopMotion();
      toggle();
      if (gesture !== 'press' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      // A tap has no drag distance: give it the same visible tug and release.
      const travel = [0, 24, 0, 2, 0];
      const offsets = [0, .3, .72, .86, 1];
      const timing = { duration: 560, easing: 'ease-in-out' };
      button.classList.add('tugging');
      motion = [
        button.querySelector('.lamp-cord')!.animate(travel.map((y, i) => ({
          transform: `translateY(${y}px)`, offset: offsets[i]
        })), timing),
        button.querySelector('.lamp-string-extension')!.animate(travel.map((y, i) => ({
          transform: `scaleY(${y / 30})`, offset: offsets[i]
        })), timing)
      ];
      motion[0].onfinish = () => button.classList.remove('tugging');
    }, distance => {
      button.style.setProperty('--cord-pull', `${distance}px`);
      button.style.setProperty('--cord-stretch', String(distance / 30));
      button.classList.toggle('pulling', distance > 0);
    });
  });
  syncReadingLamps();
}
