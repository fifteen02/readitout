import './voice-download-dialog.css';

let dialog: HTMLDialogElement | undefined;
let pending: Promise<boolean> | undefined;

/** Native modal keeps focus and Escape behavior without turning Settings into onboarding. */
export function requestVoiceDownload(): Promise<boolean> {
  if (pending) return pending;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'voice-download-dialog';
    dialog.setAttribute('aria-labelledby', 'voiceDownloadTitle');
    dialog.setAttribute('aria-describedby', 'voiceDownloadDescription');
    dialog.innerHTML = `<form method="dialog">
      <h2 id="voiceDownloadTitle" tabindex="-1">Download the reading voice</h2>
      <p id="voiceDownloadDescription">Before your first listen, download about <strong>120 MB</strong> of voice files. Your browser can reuse them next time.</p>
      <p class="voice-download-privacy">Your draft stays on this device. The voice reads it here, without uploading your text.</p>
      <p class="voice-download-next">You’ll see the download progress, then reading will start from where you chose.</p>
      <div class="voice-download-actions">
        <button value="cancel" type="submit">Not now</button>
        <button value="download" type="submit" class="primary">Download voice &amp; listen</button>
      </div>
    </form>`;
    // Let native dialog/button keys work without reaching reader playback shortcuts.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    document.body.appendChild(dialog);
  }
  const current = dialog;
  pending = new Promise<boolean>(resolve => {
    current.addEventListener('close', () => {
      const accepted = current.returnValue === 'download';
      pending = undefined;
      resolve(accepted);
    }, {once:true});
    current.returnValue = '';
    current.showModal();
    current.querySelector<HTMLElement>('h2')!.focus();
  });
  return pending;
}
