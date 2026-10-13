import type { ReadItem } from './types';

export interface BufferedSpeech {
  item: ReadItem;
  controller: AbortController;
  audio: Promise<{ blob?: Blob; error?: unknown }>;
  seconds: number;
}

/** Keep a small, ordered window ahead; inference itself remains serial in the worker. */
export class SpeechBuffer {
  private entries: BufferedSpeech[] = [];
  private current: BufferedSpeech | null = null;
  currentSeconds = 0;
  static readonly startupSeconds = 20;

  /** Only contiguous, completed audio counts toward the playable reserve. */
  readySeconds(): number {
    let seconds = 0;
    for (const entry of this.entries) {
      if (!entry.seconds) break;
      seconds += entry.seconds;
    }
    return seconds;
  }
  private finishDisposal!: () => void;
  private whenDisposed = new Promise<void>(resolve => { this.finishDisposal = resolve; });
  private controllers = new Set<AbortController>();
  private filling: Promise<void> | null = null;
  private ended = false;
  private disposed = false;
  private sourceError: unknown;
  private waiters = new Set<() => void>();

  constructor(
    private next: () => Promise<ReadItem | null>,
    private generate: (item: ReadItem, signal: AbortSignal) => Promise<Blob>,
    private capacity = 4,
    private changed: () => void = () => {}
  ) {}

  upcoming(): ReadItem[] { return this.entries.map(entry => entry.item); }

  async take(): Promise<BufferedSpeech | null> {
    while (!this.entries.length && !this.ended && !this.disposed) {
      const available = new Promise<void>(resolve => this.waiters.add(resolve));
      void this.fill();
      await available;
    }
    if (this.disposed) return null;
    const entry = this.entries.shift();
    if (!entry) {
      if (this.sourceError) throw this.sourceError;
      return null;
    }
    this.current = entry;
    this.currentSeconds = 0;
    void entry.audio.then(() => {
      if (!this.disposed && this.current === entry) { this.currentSeconds = entry.seconds; this.changed(); }
    });
    this.changed();
    void this.fill();
    return entry;
  }

  /** Wait until completed audio meets the advertised duration target.
   * Short documents start when all remaining audio is ready. Expand the lookahead
   * only as needed when unusually short sentences cannot fill the reserve.
   */
  async prepareAhead(currentSeconds?: number, rate: number | (() => number) = 1): Promise<void> {
    if (currentSeconds !== undefined && (!Number.isFinite(currentSeconds) || currentSeconds <= 0)) {
      throw new Error('The voice returned no playable audio. Try reading this passage again.');
    }
    const normalCapacity = this.capacity;
    let seconds = currentSeconds ?? 0;
    let index = 0;
    try {
      while (!this.disposed) {
        const target = SpeechBuffer.startupSeconds * Math.max(0.25, typeof rate === 'function' ? rate() : rate);
        if (currentSeconds !== undefined && seconds >= target) return;
        while (this.entries.length <= index && !this.ended && !this.disposed) {
          this.capacity = Math.max(this.capacity, index + 1);
          const available = new Promise<void>(resolve => this.waiters.add(resolve));
          void this.fill();
          await available;
        }
        if (this.disposed) return;
        const entry = this.entries[index];
        if (!entry) return;
        const result = await Promise.race([entry.audio, this.whenDisposed]);
        if (!result || this.disposed) return;
        if (result.error) throw result.error;
        if (currentSeconds !== undefined && (!Number.isFinite(entry.seconds) || entry.seconds <= 0)) {
          throw new Error('The voice returned no playable audio. Try reading this passage again.');
        }
        seconds += entry.seconds;
        index++;
        if (currentSeconds === undefined) return;
      }
    } finally { this.capacity = normalCapacity; }
  }

  dispose(): void {
    this.disposed = true;
    this.finishDisposal();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.entries = [];
    this.current = null;
    this.currentSeconds = 0;
    this.changed();
    this.wake();
  }

  private wake(): void {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  private fill(): Promise<void> {
    if (this.filling) return this.filling;
    this.filling = (async () => {
      try {
        while (!this.disposed && !this.ended && this.entries.length < this.capacity) {
          const item = await this.next();
          if (this.disposed) return;
          if (!item) { this.ended = true; return; }
          const controller = new AbortController();
          this.controllers.add(controller);
          // Handle failures immediately, but surface them only when this item is consumed.
          const entry: BufferedSpeech = {item, controller, seconds: 0, audio: Promise.resolve({})};
          const audio = Promise.resolve().then(() => this.generate(item, controller.signal))
            .then(async blob => {
              entry.seconds = await speechSeconds(blob);
              if (!this.disposed) this.changed();
              return {blob};
            }).catch(error => ({error}))
            .finally(() => this.controllers.delete(controller));
          entry.audio = audio;
          this.entries.push(entry);
          this.wake();
        }
      } catch (error) { this.sourceError = error; this.ended = true; }
    })().finally(() => { this.filling = null; this.wake(); });
    return this.filling;
  }
}

/** Our on-device engine emits PCM WAV with a fixed 44-byte header. */
export async function speechSeconds(blob: Blob): Promise<number> {
  if (blob.size < 44) return 0;
  const header = new DataView(await blob.slice(0, 44).arrayBuffer());
  if (header.getUint32(0, false) !== 0x52494646 || header.getUint32(8, false) !== 0x57415645) return 0;
  const bytesPerSecond = header.getUint32(28, true);
  return bytesPerSecond > 0 ? Math.min(header.getUint32(40, true), blob.size - 44) / bytesPerSecond : 0;
}
