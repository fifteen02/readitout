import { deskIcon } from './desk-icons';
import './speed-picker.css';

/** Reuse the existing rate input so settings and live audio keep one value. */
export function initSpeedPicker(slider: HTMLInputElement, value: HTMLElement, rate: HTMLInputElement): void {
  const panel = document.createElement('div');
  if (typeof panel.showPopover !== 'function') { slider.style.display = 'block'; return; }
  panel.id = 'readingSpeedPicker'; panel.className = 'speed-picker';
  panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'speedPickerTitle');
  panel.innerHTML = `<header><h2 id="speedPickerTitle">Reading speed</h2><button type="button" class="speed-picker-close" aria-label="Close speed controls">${deskIcon('close')}</button></header><div class="speed-presets" role="group" aria-label="Common reading speeds"></div><div class="speed-adjustment"><label for="playerRate">Fine tune <output id="speedPickerValue" for="playerRate"></output></label><div class="speed-range"></div><div class="speed-limits"><span>0.6× · Slower</span><span>Faster · 1.6×</span></div></div>`;
  const trigger = document.createElement('button'); trigger.id = 'speedPickerToggle'; trigger.type = 'button';
  trigger.setAttribute('popovertarget', panel.id); trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
  value.before(trigger); trigger.append(value);
  const chevron = document.createElement('span'); chevron.className = 'speed-chevron'; chevron.innerHTML = deskIcon('chevron'); chevron.setAttribute('aria-hidden','true'); trigger.append(chevron);
  panel.querySelector('.speed-range')!.append(slider);
  const presets = [[.8, 'Slower'], [1, 'Normal'], [1.2, 'Faster']] as const;
  const buttons = presets.map(([speed, label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.speed = String(speed);
    button.innerHTML = `<span>${speed.toFixed(1)}×</span><small>${label}</small>`;
    button.addEventListener('click', () => { slider.value = String(speed); slider.dispatchEvent(new Event('input', {bubbles:true})); });
    panel.querySelector('.speed-presets')!.append(button); return button;
  });
  const sync = () => {
    const current = Number(rate.value);
    const label = `${current.toFixed(1)}×`;
    panel.querySelector('output')!.textContent = label;
    trigger.setAttribute('aria-label', `Reading speed: ${label}. Change speed`);
    trigger.title = `Reading speed: ${label}`;
    slider.setAttribute('aria-valuetext', `${current.toFixed(1)} times normal speed`);
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === current)));
  };
  const position = () => {
    const width = Math.min(304, innerWidth - 32);
    const rect = trigger.getBoundingClientRect();
    const top = trigger.closest('.readerbar')!.getBoundingClientRect().top;
    Object.assign(panel.style, { width: `${width}px`, left: `${Math.max(16, Math.min(rect.right - width, innerWidth - width - 16))}px`, bottom: `${innerHeight - top + 12}px`, maxHeight: `${Math.max(80, top - 28)}px` });
  };
  const close = () => { panel.hidePopover(); trigger.focus({preventScroll:true}); };
  panel.querySelector('.speed-picker-close')!.addEventListener('click', close);
  panel.addEventListener('beforetoggle', event => { if ((event as ToggleEvent).newState === 'open') { sync(); position(); } });
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open'); trigger.setAttribute('aria-expanded', String(open));
    if (open) slider.focus({preventScroll:true});
  });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab' && !event.shiftKey && event.target === slider) close();
  });
  panel.addEventListener('focusout', event => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.contains(next) && next !== trigger && panel.matches(':popover-open')) panel.hidePopover();
  });
  window.addEventListener('resize', () => { if (panel.matches(':popover-open')) position(); });
  slider.addEventListener('input', sync); rate.addEventListener('input', sync);
  document.body.append(panel); sync();
}
