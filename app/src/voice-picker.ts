import { onKokoroState, type KokoroState } from './browser-kokoro';
import { deskIcon } from "./desk-icons";
import './voice-picker.css';

const PERSONAS: Record<string, { portrait: string; role: string }> = {
  af_heart: { portrait: 'heart', role: 'The storyteller' },
  af_bella: { portrait: 'bella', role: 'The book lover' },
  af_nicole: { portrait: 'nicole', role: 'The daydreamer' },
  am_michael: { portrait: 'michael', role: 'The easygoing one' },
  bf_emma: { portrait: 'emma', role: 'Your pen pal' },
  bf_isabella: { portrait: 'isabella', role: 'The gentle soul' },
  bm_george: { portrait: 'george', role: 'The fireside friend' },
};
function voiceIdentity(value: string, label: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const persona = PERSONAS[value];
  if (persona) {
    const portrait = document.createElement('img');
    portrait.src = `/illustrations/voices/${persona.portrait}.png`;
    portrait.className = 'voice-portrait'; portrait.alt = ''; portrait.width = 48; portrait.height = 48;
    fragment.append(portrait);
  }
  const copy = document.createElement('span'); copy.className = 'voice-identity';
  const name = document.createElement('span'); name.className = 'voice-name'; name.textContent = label;
  copy.append(name);
  if (persona) {
    const role = document.createElement('span'); role.className = 'voice-persona'; role.textContent = persona.role;
    copy.append(role);
  }
  fragment.append(copy);
  return fragment;
}

/** Keep the existing select as the settings/playback boundary behind a themed picker. */
export function initVoicePicker(select: HTMLSelectElement, settings: HTMLSelectElement): void {
  const panel = document.createElement('div');
  if (typeof panel.showPopover !== 'function') return;
  panel.id = 'readingVoicePicker'; panel.className = 'voice-picker'; panel.setAttribute('popover', 'auto');
  panel.innerHTML = `<div class="voice-picker-heading"><h2 id="voicePickerTitle">Reading voice</h2><button class="voice-picker-close" type="button" aria-label="Close voice picker">${deskIcon("close")}</button></div><div class="voice-picker-options" role="listbox" aria-labelledby="voicePickerTitle"></div>`;
  const list = panel.querySelector<HTMLElement>('[role="listbox"]')!;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'voicePickerToggle'; trigger.className = 'player-voice voice-picker-trigger';
  trigger.setAttribute('popovertarget', panel.id); trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
  const options: HTMLButtonElement[] = [];
  for (const [accent, country] of [['American English','US'],['British English','UK']]) {
    const group = document.createElement('div'); group.className = 'voice-picker-group';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', accent);
    const label = document.createElement('p'); label.className = 'voice-picker-accent'; label.textContent = accent; label.setAttribute('aria-hidden','true'); group.append(label);
    for (const item of Array.from(select.options).filter(item => item.textContent?.endsWith(country))) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'voice-picker-option';
      option.dataset.name = item.textContent!.split(' · ')[0];
      option.setAttribute('role','option'); option.tabIndex = -1; option.dataset.value = item.value;
      const name = voiceIdentity(item.value, item.textContent!.split(' · ')[0]);
      const check = document.createElement('span'); check.className = 'voice-picker-check'; check.innerHTML = deskIcon('check'); check.setAttribute('aria-hidden','true'); option.append(name,check);
      option.addEventListener('click', () => {
        if (select.value !== item.value) { select.value = item.value; select.dispatchEvent(new Event('change', {bubbles:true})); }
        panel.hidePopover(); trigger.focus();
      });
      options.push(option); group.append(option);
    }
    list.append(group);
  }
  let voiceState: KokoroState | undefined;
  const sync = () => {
    const label = select.selectedOptions[0]?.textContent || 'Choose voice';
    const name = voiceIdentity(select.value, label);
    if (voiceState?.phase === 'ready' && voiceState.device) {
      const detail = name.querySelector('.voice-persona');
      if (detail) detail.textContent = voiceState.device === 'webgpu' ? 'GPU · On-device voice' : 'CPU · On-device voice';
    }
    const chevron = document.createElement('span'); chevron.className = 'voice-picker-chevron'; chevron.innerHTML = deskIcon('chevron'); chevron.setAttribute('aria-hidden','true');
    trigger.replaceChildren(name,chevron);
    const deviceLabel = voiceState?.phase === 'ready' && voiceState.device ? (voiceState.device === 'webgpu' ? 'GPU accelerated' : 'CPU') : PERSONAS[select.value]?.role;
    trigger.setAttribute('aria-label', `Reading voice: ${label}${deviceLabel ? `, ${deviceLabel}` : ''}`);
    options.forEach(option => { const selected = option.dataset.value === select.value; option.setAttribute('aria-selected', String(selected)); option.tabIndex = selected ? 0 : -1; });
  };
  const focusOption = (option: HTMLButtonElement | undefined) => {
    if (!option) return;
    // Arrow-key browsing moves the list's single Tab stop, without selecting a voice.
    options.forEach(item => { item.tabIndex = item === option ? 0 : -1; });
    option.focus();
  };
  onKokoroState(value => { voiceState = value; sync(); });
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    panel.style.width = `${Math.min(320, window.innerWidth - 32)}px`;
    panel.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 336))}px`;
    const playerTop = select.closest('.readerbar')!.getBoundingClientRect().top;
    panel.style.bottom = `${window.innerHeight - playerTop + 10}px`;
    panel.style.maxHeight = `${Math.max(80, playerTop - 26)}px`;
  };
  const close = () => { panel.hidePopover(); trigger.focus(); };
  panel.querySelector('button')!.addEventListener('click', close);
  panel.addEventListener('beforetoggle', event => { if ((event as ToggleEvent).newState === 'open') position(); });
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open'); trigger.setAttribute('aria-expanded', String(open));
    if (open) focusOption(options.find(option => option.dataset.value === select.value));
  });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const index = options.indexOf(document.activeElement as HTMLButtonElement); if (index < 0) return;
    if (event.key === 'Tab' && !event.shiftKey) {
      // Resume native Tab order beside the trigger, not at the end of the body
      // where the popover is mounted. Do not commit the browsed option.
      close();
      return;
    }
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
      const match = options.findIndex(option => option.dataset.name!.toLowerCase().startsWith(event.key.toLowerCase()));
      if (match < 0) return; next = match;
    } else return;
    event.preventDefault(); focusOption(options[next]);
  });
  panel.addEventListener('focusout', event => {
    // Pointer focus changes dispatch blur before focus. Check the destination, not
    // the transient activeElement (body), or a click closes before it can select.
    const next = event.relatedTarget as Node | null;
    if (next && !panel.contains(next) && next !== trigger && panel.matches(':popover-open')) panel.hidePopover();
  });
  trigger.addEventListener('keydown', event => {
    if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); panel.showPopover(); }
  });
  window.addEventListener('resize', () => { if (panel.matches(':popover-open')) position(); });
  select.addEventListener('change', sync); settings.addEventListener('change', sync);
  select.hidden = true; select.insertAdjacentElement('afterend',trigger); document.body.append(panel); sync();
}
