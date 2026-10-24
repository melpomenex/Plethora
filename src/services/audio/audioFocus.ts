export interface AudioOutputLease {
  readonly owner: string;
  readonly signal: AbortSignal;
  isCurrent: () => boolean;
  /** Release follows caller-owned stop/end. It never resumes a previous owner. */
  release: () => void;
}

interface FocusOwner {
  owner: string;
  cancellation: AbortController;
  stop: () => void | Promise<void>;
  lease: AudioOutputLease;
}

/** App-output arbitration; the Android service separately owns the single AudioManager request. */
export class AudioOutputFocus {
  private current: FocusOwner | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private request = 0;
  private pending: { owner: string; request: number; promise: Promise<AudioOutputLease> } | null = null;

  acquire(owner: string, stop: () => void | Promise<void>): Promise<AudioOutputLease> {
    if (!owner.trim()) return Promise.reject(new Error("Audio focus owner is required"));
    if (this.current?.owner === owner && !this.current.cancellation.signal.aborted) {
      this.current.stop = stop;
      return Promise.resolve(this.current.lease);
    }
    if (this.pending?.owner === owner && this.pending.request === this.request) return this.pending.promise;
    const request = ++this.request;
    // Revoke asynchronous callbacks immediately, before waiting for stop acknowledgement.
    this.current?.cancellation.abort();
    const result = this.serial.then(async () => {
      if (request !== this.request) throw new DOMException("Audio focus request superseded", "AbortError");
      const previous = this.current;
      if (previous && previous.owner !== owner) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve().then(previous.stop),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Competing audio did not acknowledge stop")), 2000); }),
          ]);
          this.current = null;
        } finally { clearTimeout(timeout); }
      }
      if (request !== this.request) throw new DOMException("Audio focus request superseded", "AbortError");
      const cancellation = new AbortController();
      const entry: FocusOwner = { owner, stop, cancellation, lease: null! };
      entry.lease = {
        owner, signal: cancellation.signal,
        isCurrent: () => this.current === entry && !cancellation.signal.aborted,
        release: () => {
          cancellation.abort();
          if (this.current === entry) this.current = null;
        },
      };
      this.current = entry;
      return entry.lease;
    });
    this.serial = result.catch(() => undefined);
    this.pending = { owner, request, promise: result };
    void result.finally(() => { if (this.pending?.request === request) this.pending = null; }).catch(() => undefined);
    return result;
  }
}

export const appAudioFocus = new AudioOutputFocus();
