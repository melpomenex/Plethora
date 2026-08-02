import { invokeCommand, isTauri } from "../tauri";

class ClockCache {
  private learningItems = new Map<string, string>();
  private documents = new Map<string, string>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (!isTauri()) {
      this.initialized = true;
      return;
    }
    try {
      const [cardClocks, docClocks] = await Promise.all([
        invokeCommand<Record<string, string>>("get_all_learning_item_clocks"),
        invokeCommand<Record<string, string>>("get_all_document_clocks"),
      ]);

      this.learningItems = new Map(Object.entries(cardClocks));
      this.documents = new Map(Object.entries(docClocks));
      this.initialized = true;
    } catch (err) {
      console.warn("[sync:clockCache] failed to initialize clock cache:", err);
      // Fallback: mark initialized so we don't stall sync, but replay will fetch
      this.initialized = true;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isStale(entityType: "learningItems" | "documents", key: string, remoteClock: string): boolean {
    // If cache initialization failed or hasn't run, default to stale so we check SQLite
    if (!this.initialized) return true;

    const map = entityType === "learningItems" ? this.learningItems : this.documents;
    const localClock = map.get(key);

    if (!localClock) {
      return true; // Not present locally
    }

    if (entityType === "documents") {
      const localMs = Date.parse(localClock);
      const remoteMs = Date.parse(remoteClock);
      if (Number.isNaN(localMs) || Number.isNaN(remoteMs)) {
        return true;
      }
      return remoteMs > localMs;
    }

    // Stale if remote clock is strictly newer than local clock (HLC strings)
    return remoteClock > localClock;
  }

  updateClock(entityType: "learningItems" | "documents", key: string, clock: string): void {
    const map = entityType === "learningItems" ? this.learningItems : this.documents;
    map.set(key, clock);
  }

  /**
   * Forget the cached clock for a key. Used when a tombstone is written
   * out-of-band from the normal clock comparison (e.g. document delete): the
   * next publish for this key must not be skipped as "unchanged" just because
   * it carries the same pre-delete clock the cache still remembers.
   */
  clearClock(entityType: "learningItems" | "documents", key: string): void {
    const map = entityType === "learningItems" ? this.learningItems : this.documents;
    map.delete(key);
  }
}

export const syncClockCache = new ClockCache();
