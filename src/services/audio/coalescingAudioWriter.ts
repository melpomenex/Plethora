const RETRY_MS = [1000, 2000, 4000, 8000, 30_000];

/** Bounded, durable-acknowledgement write queue shared by checkpoints and recovery intent. */
export class CoalescingAudioWriter<T> {
  private pending = new Map<string, T>();
  private saved = new Map<string, string>();
  private running: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private disposed = false;

  constructor(private options: {
    key: (value: T) => string;
    fingerprint: (value: T) => string;
    commit: (value: T) => Promise<void>;
    onError?: (error: unknown) => void;
    onSaved?: () => void;
  }) {}

  enqueue(value: T, transition = false): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Audio writer disposed"));
    const id = this.options.key(value);
    if (!this.pending.has(id) && this.pending.size >= 128) return Promise.reject(new Error("Unsaved audio checkpoint capacity reached"));
    if (this.pending.has(id) || this.saved.get(id) !== this.options.fingerprint(value)) this.pending.set(id, value);
    if (transition) { clearTimeout(this.retry); this.retry = undefined; this.failures = 0; }
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed || this.retry || this.failures > RETRY_MS.length || !this.pending.size) return Promise.resolve();
    this.running = this.writePending().finally(() => { this.running = null; });
    return this.running;
  }

  private async writePending(): Promise<void> {
    while (this.pending.size && !this.disposed) {
      const [id, value] = this.pending.entries().next().value!;
      try {
        await this.options.commit(value);
        if (this.pending.get(id) === value) this.pending.delete(id);
        this.saved.set(id, this.options.fingerprint(value));
        if (this.saved.size > 128) this.saved.delete(this.saved.keys().next().value!);
        this.failures = 0;
        if (!this.pending.size) this.options.onSaved?.();
      } catch (error) {
        this.options.onError?.(error);
        const delay = RETRY_MS[this.failures++];
        if (delay !== undefined) this.retry = setTimeout(() => { this.retry = undefined; void this.drain(); }, delay);
        return;
      }
    }
  }

  getDirty(): readonly T[] { return [...this.pending.values()]; }

  dispose(): void {
    if (this.pending.size || this.running) throw new Error("Audio checkpoints still pending");
    this.disposed = true;
    clearTimeout(this.retry);
  }
}
