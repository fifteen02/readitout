/** Keep note submission keys separate from input-method candidate selection. */
export function bindNoteInputKeys(
  input: HTMLInputElement,
  submit: (text: string) => void,
  dismiss: () => void
): void {
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      submit(input.value.trim());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  });
}
