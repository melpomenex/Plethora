/**
 * Minimal in-memory IndexedDB fake for unit tests (no DOM databases in
 * jsdom). Implements exactly the surface `src/utils/ttsCache.ts` uses:
 * open with onupgradeneeded, transactions, stores with keyPath, get/put/
 * delete/clear/count/getAll/getAllKeys, and key cursors. Requests resolve on
 * microtasks; transactions complete when their requests settle.
 *
 * Every store records its method calls in `calls` so tests can assert, e.g.,
 * that an eviction path never touched payload values.
 */

export interface FakeIDBRequest<T = unknown> {
  result: T;
  error: Error | null;
  readyState: "pending" | "done";
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  source: unknown;
}

interface CallLog {
  method: string;
  key?: unknown;
}

class FakeRequest<T = unknown> implements FakeIDBRequest<T> {
  result: T = undefined as unknown as T;
  error: Error | null = null;
  readyState: "pending" | "done" = "pending";
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  source: unknown = null;
  constructor(private queue: () => void) {}
  fire(result: T) {
    this.result = result;
    this.readyState = "done";
    queueMicrotask(() => this.onsuccess?.());
  }
  fail(error: Error) {
    this.error = error;
    this.readyState = "done";
    queueMicrotask(() => this.onerror?.());
  }
  get _neverFired() {
    return this.readyState === "pending" && !this.queue;
  }
}

class FakeCursor {
  constructor(
    public key: IDBValidKey,
    private advance: (cursor: FakeCursor) => void,
    private done: () => void,
  ) {}
  continue() {
    this.advance(this);
  }
  _finish() {
    this.done();
  }
}

class FakeIndex {
  constructor(private store: FakeObjectStore) {}
  openCursor(): FakeRequest<IDBCursorWithValue | null> {
    const req = new FakeRequest<IDBCursorWithValue | null>(() => {});
    const keys = [...this.store.records.keys()];
    let i = 0;
    const step = () => {
      if (i >= keys.length) {
        req.fire(null as unknown as IDBCursorWithValue | null);
        return;
      }
      const key = keys[i++];
      const cursor = new FakeCursor(key, step, () => {}) as unknown as IDBCursorWithValue;
      (cursor as unknown as { value: unknown }).value = this.store.records.get(key);
      req.fire(cursor);
    };
    queueMicrotask(step);
    return req;
  }
}

export class FakeObjectStore {
  records = new Map<IDBValidKey, Record<string, unknown>>();
  calls: CallLog[] = [];
  indexNames = new Set<string>();
  private indexes = new Map<string, FakeIndex>();

  constructor(public name: string, public keyPath: string | null) {}

  createIndex(name: string) {
    this.indexNames.add(name);
    this.indexes.set(name, new FakeIndex(this));
    return { name };
  }

  index(name: string) {
    return this.indexes.get(name) ?? this.assertIndex(name);
  }

  private assertIndex(name: string): FakeIndex {
    if (!this.indexes.has(name)) this.createIndex(name);
    return this.indexes.get(name)!;
  }

  private keyOf(value: Record<string, unknown>): IDBValidKey {
    if (!this.keyPath) throw new Error("in-line keys required");
    return value[this.keyPath] as IDBValidKey;
  }

  get(key: IDBValidKey): FakeRequest {
    this.calls.push({ method: "get", key });
    const req = new FakeRequest(() => {});
    const value = this.records.get(key);
    queueMicrotask(() => req.fire(value === undefined ? undefined : { ...value }));
    return req;
  }

  put(value: Record<string, unknown>): FakeRequest {
    this.calls.push({ method: "put", key: this.keyPath ? value[this.keyPath] : undefined });
    this.records.set(this.keyOf(value), { ...value });
    const req = new FakeRequest(() => {});
    queueMicrotask(() => req.fire(this.keyOf(value)));
    return req;
  }

  delete(key: IDBValidKey): FakeRequest {
    this.calls.push({ method: "delete", key });
    this.records.delete(key);
    const req = new FakeRequest(() => {});
    queueMicrotask(() => req.fire(undefined));
    return req;
  }

  clear(): FakeRequest {
    this.calls.push({ method: "clear" });
    this.records.clear();
    const req = new FakeRequest(() => {});
    queueMicrotask(() => req.fire(undefined));
    return req;
  }

  count(): FakeRequest<number> {
    this.calls.push({ method: "count" });
    const req = new FakeRequest<number>(() => {});
    queueMicrotask(() => req.fire(this.records.size));
    return req;
  }

  getAll(): FakeRequest<Record<string, unknown>[]> {
    this.calls.push({ method: "getAll" });
    const req = new FakeRequest<Record<string, unknown>[]>(() => {});
    queueMicrotask(() => req.fire([...this.records.values()].map((v) => ({ ...v }))));
    return req;
  }

  getAllKeys(): FakeRequest<IDBValidKey[]> {
    this.calls.push({ method: "getAllKeys" });
    const req = new FakeRequest<IDBValidKey[]>(() => {});
    queueMicrotask(() => req.fire([...this.records.keys()]));
    return req;
  }

  openKeyCursor(): FakeRequest<FakeCursor | null> {
    this.calls.push({ method: "openKeyCursor" });
    const req = new FakeRequest<FakeCursor | null>(() => {});
    const keys = [...this.records.keys()];
    let i = 0;
    const step = () => {
      if (i >= keys.length) {
        req.fire(null);
        return;
      }
      req.fire(new FakeCursor(keys[i++], step, () => {}));
    };
    queueMicrotask(step);
    return req;
  }
}

export class FakeTransaction {
  onComplete: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;
  onAbort: ((error: Error) => void) | null = null;
  completeHandler: ((ev: unknown) => void) | null = null;
  errorHandler: ((ev: unknown) => void) | null = null;
  abortHandler: ((ev: unknown) => void) | null = null;

  constructor(
    public objectStores: Map<string, FakeObjectStore>,
    private autoComplete: (tx: FakeTransaction) => void,
  ) {}

  get objectStoreNames(): Set<string> {
    return new Set(this.objectStores.keys());
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.objectStores.get(name);
    if (!store) throw new Error(`no such store: ${name}`);
    return store;
  }

  get oncomplete() {
    return this.completeHandler;
  }
  set oncomplete(handler: ((ev: unknown) => void) | null) {
    this.completeHandler = handler;
    this.onComplete = handler as (() => void) | null;
    this.autoComplete(this);
  }
  get onerror() {
    return this.errorHandler;
  }
  set onerror(handler: ((ev: unknown) => void) | null) {
    this.errorHandler = handler;
    this.onError = handler as unknown as ((error: Error) => void) | null;
  }
  get onabort() {
    return this.abortHandler;
  }
  set onabort(handler: ((ev: unknown) => void) | null) {
    this.abortHandler = handler;
    this.onAbort = handler as unknown as ((error: Error) => void) | null;
  }
}

/** DOMStringList-alike with `contains` (what IDBDatabase exposes). */
class FakeStringList {
  private items: string[] = [];
  contains(name: string): boolean {
    return this.items.includes(name);
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
  _add(name: string) {
    if (!this.items.includes(name)) this.items.push(name);
  }
  _remove(name: string) {
    this.items = this.items.filter((n) => n !== name);
  }
}

export class FakeIDBDatabase {
  objectStoreNames = new FakeStringList();
  onClose: (() => void) | null = null;
  closed = false;
  stores = new Map<string, FakeObjectStore>();
  transactions: FakeTransaction[] = [];
  openCount = 0;

  constructor(public name: string, public version: number) {}

  close() {
    this.closed = true;
    this.onClose?.();
  }

  createObjectStore(name: string, options?: { keyPath?: string }) {
    const store = new FakeObjectStore(name, options?.keyPath ?? null);
    this.stores.set(name, store);
    this.objectStoreNames._add(name);
    return store;
  }

  deleteObjectStore(name: string) {
    this.stores.delete(name);
    this.objectStoreNames._remove(name);
  }

  transaction(storeNames: string | string[], _mode?: "readonly" | "readwrite"): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const stores = new Map(names.map((n) => [n, this.stores.get(n)!].filter(Boolean) as [string, FakeObjectStore]));
    for (const n of names) {
      if (!this.stores.has(n)) throw new Error(`no such store: ${n}`);
      stores.set(n, this.stores.get(n)!);
    }
    const tx = new FakeTransaction(stores, (t) => scheduleCompletion(t));
    this.transactions.push(tx);
    // Requests already fired synchronously inside the Promise constructor may
    // complete before handlers attach; completion is always async anyway.
    scheduleCompletion(tx);
    return tx;
  }
}

function scheduleCompletion(tx: FakeTransaction) {
  queueMicrotask(() => {
    queueMicrotask(() => {
      if (tx.completeHandler) tx.completeHandler({});
    });
  });
}

export class FakeIndexedDB {
  databases = new Map<string, FakeIDBDatabase>();
  openCalls: { name: string; version: number }[] = [];

  open(name: string, version?: number): FakeRequest<FakeIDBDatabase> & { onupgradeneeded: ((event: { oldVersion: number; target: unknown }) => void) | null; transaction: unknown } {
    this.openCalls.push({ name, version: version ?? 1 });
    const req = new FakeRequest<FakeIDBDatabase>(() => {}) as FakeRequest<FakeIDBDatabase> & {
      onupgradeneeded: ((event: { oldVersion: number; target: unknown }) => void) | null;
      transaction: unknown;
    };
    req.onupgradeneeded = null;
    req.transaction = null;
    queueMicrotask(() => {
      let db = this.databases.get(name);
      const oldVersion = db?.version ?? 0;
      const targetVersion = version ?? (db?.version ?? 1);
      let upgraded = false;
      if (!db || targetVersion > db.version) {
        upgraded = true;
        db = new FakeIDBDatabase(name, targetVersion);
        // Carry stores forward (a real upgrade keeps existing stores).
        if (this.databases.has(name)) {
          for (const [storeName, store] of this.databases.get(name)!.stores) {
            const copy = new FakeObjectStore(store.name, store.keyPath);
            copy.records = new Map(store.records);
            db.stores.set(storeName, copy);
            db.objectStoreNames._add(storeName);
          }
        }
        this.databases.set(name, db);
      }
      const database = db!;
      database.openCount += 1;
      // Real IndexedDB exposes target.result (the database) during
      // onupgradeneeded; set it before the handler runs.
      req.result = database;
      if (upgraded && req.onupgradeneeded) {
        const upgradeTx = new FakeTransaction(new Map(database.stores), () => {});
        (req as unknown as { transaction: unknown }).transaction = upgradeTx;
        req.onupgradeneeded({ oldVersion, target: req });
      }
      req.fire(database);
    });
    return req;
  }

  deleteDatabase(name: string): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>(() => {});
    queueMicrotask(() => {
      this.databases.delete(name);
      req.fire(undefined);
    });
    return req;
  }
}

/** Install a fresh fake as the global `indexedDB`; returns it. */
export function installFakeIndexedDb(): FakeIndexedDB {
  const fake = new FakeIndexedDB();
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = fake;
  return fake;
}

/** Test helper: wait until pending microtasks (request completions) settle. */
export async function flushIDb(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
