export function bindCommandKeys(input: HTMLInputElement, actions: {
  move: (delta: number) => void;
  run: () => void;
  close: () => void;
}): void {
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (!['Tab', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    // Search is the palette's only Tab stop; arrows select and Escape exits.
    if (event.key === 'ArrowDown') actions.move(1);
    else if (event.key === 'ArrowUp') actions.move(-1);
    else if (event.key === 'Enter') actions.run();
    else if (event.key === 'Escape') actions.close();
  });
}
