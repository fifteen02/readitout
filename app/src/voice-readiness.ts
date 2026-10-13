/** Confirm first use, then finish preparation only for the still-current reading request. */
export async function ensureReadingVoice(options: {
  enabled: () => boolean;
  confirm: () => Promise<boolean>;
  prepare: () => Promise<void>;
  isCurrent: () => boolean;
}): Promise<boolean> {
  if (!options.isCurrent()) return false;
  if (options.enabled()) return true;
  if (!await options.confirm() || !options.isCurrent()) return false;
  await options.prepare();
  return options.isCurrent();
}
