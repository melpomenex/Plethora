/**
 * Storage backends for `ConversationRepositoryCore` (task 1.4).
 *
 * - `IndexedDbConversationStore` — the browser adapter. Uses the existing
 *   `idb` dependency, one object store with `[key, value]` tuples so prefix
 *   scans (`list`) stay inside a single transaction. Quota errors propagate
 *   to the core, which maps them to `quota_exceeded` so the UI can keep the
 *   in-memory draft editable.
 * - `MemoryConversationStore` — deterministic test backend. Lives in test
 *   files too? No: exported here so conformance fixtures and component tests
 *   share exactly one implementation.
 *
 * Both report the same durability contract: device-local, no native sync.
 */

import type { ConversationKeyValueStore } from "./core";

interface IdbTuple {
  key: string;
  value: string;
}

interface IdbIndexRow {
  index: string;
  key: string;
}

/** Browser IndexedDB backend. */
export class IndexedDbConversationStore implements ConversationKeyValueStore {
  private dbPromise: Promise<import("idb").IDBPDatabase<unknown>> | null = null;

  constructor(
    private databaseName = "plethora-assistant-conversations",
    private version = 1,
  ) {}

  private async db(): Promise<import("idb").IDBPDatabase<unknown>> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const { openDB } = await import("idb");
        return openDB(this.databaseName, this.version, {
          upgrade(database) {
            if (!database.objectStoreNames.contains("records")) {
              database.createObjectStore("records", { keyPath: "key" });
            }
            if (!database.objectStoreNames.contains("indexes")) {
              database.createObjectStore("indexes", { keyPath: ["index", "key"] });
            }
          },
        });
      })();
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<string | undefined> {
    const database = await this.db();
    const row = (await database.get("records", key)) as IdbTuple | undefined;
    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    const database = await this.db();
    await database.put("records", { key, value } satisfies IdbTuple);
  }

  async delete(key: string): Promise<void> {
    const database = await this.db();
    await database.delete("records", key);
  }

  async list(prefix: string): Promise<string[]> {
    const database = await this.db();
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const rows = (await database.getAll("records", range)) as IdbTuple[];
    return rows.map((row) => row.key);
  }

  async indexAdd(index: string, key: string): Promise<void> {
    const database = await this.db();
    await database.put("indexes", { index, key } satisfies IdbIndexRow);
  }

  async indexRemove(index: string, key: string): Promise<void> {
    const database = await this.db();
    await database.delete("indexes", [index, key]);
  }

  async indexList(index: string): Promise<string[]> {
    const database = await this.db();
    const range = IDBKeyRange.bound([index, ""], [index, "\uffff"]);
    const rows = (await database.getAll("indexes", range)) as IdbIndexRow[];
    return rows.map((row) => row.key);
  }
}

/** Deterministic in-memory backend. Fails writes when `failWrites` is set. */
export class MemoryConversationStore implements ConversationKeyValueStore {
  private records = new Map<string, string>();
  private indexes = new Map<string, Set<string>>();
  /** When set, every `set` throws this error (simulates quota/disk failure). */
  failWrites: Error | null = null;

  async get(key: string): Promise<string | undefined> {
    return this.records.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failWrites) throw this.failWrites;
    this.records.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.records.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async indexAdd(index: string, key: string): Promise<void> {
    const set = this.indexes.get(index) ?? new Set<string>();
    set.add(key);
    this.indexes.set(index, set);
  }

  async indexRemove(index: string, key: string): Promise<void> {
    this.indexes.get(index)?.delete(key);
  }

  async indexList(index: string): Promise<string[]> {
    return [...(this.indexes.get(index) ?? [])].sort();
  }

  /** Test hook: snapshot of raw keys (asserts no unbounded growth). */
  keys(): string[] {
    return [...this.records.keys()].sort();
  }
}
