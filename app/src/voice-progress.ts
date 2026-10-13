/** Estimates use observed work only; a first sample or stalled transfer has no ETA. */
export class TransferEstimator {
  private samples: { loaded: number; at: number }[] = [];
  private total = 0;
  sample(loaded: number, total: number, at: number): void {
    if (!Number.isFinite(loaded) || !Number.isFinite(total) || loaded < 0 || total <= 0) return;
    const last = this.samples.at(-1);
    if (total !== this.total || (last && loaded < last.loaded)) this.samples = [];
    this.total = total;
    if (last?.loaded === loaded && this.samples.length) return;
    this.samples.push({loaded, at});
    while (this.samples.length > 2 && this.samples[1].at < at - 5000) this.samples.shift();
  }
  read(now: number): { bytesPerSecond?: number; secondsLeft?: number } {
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last || last.at - first.at < 1000 || now - last.at > 5000) return {};
    const rate = (last.loaded - first.loaded) / ((last.at - first.at) / 1000);
    if (!(rate > 0)) return {};
    return {bytesPerSecond: rate, secondsLeft: Math.max(0, (this.total - last.loaded) / rate)};
  }
}
export function duration(seconds: number): string {
  const value = Math.max(1, Math.ceil(seconds));
  return value < 60 ? `${value}s` : `${Math.ceil(value / 60)} min`;
}
export function speechSecondsLeft(completed: number, total: number, elapsedMs: number): number | undefined {
  if (!(completed > 0 && total > completed && elapsedMs >= 1000)) return undefined;
  return elapsedMs / 1000 * (total - completed) / completed;
}
