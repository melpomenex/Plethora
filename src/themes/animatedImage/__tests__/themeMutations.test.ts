import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "../../../types/theme";
import type { AnimatedImagePack, PreparedAnimatedImage } from "../contracts";
import {
  animatedImagePackKey,
  animatedImagePosterKey,
} from "../storage";
import {
  commitAnimatedImageTheme,
  commitImportedTheme,
  recoverImageThemeMutationJournal,
  removeAnimatedImageTheme,
  selectAnimatedImageTheme,
} from "../themeMutations";

const MEDIA_A = "anim-00000000-0000-4000-8000-000000000001";
const MEDIA_B = "anim-00000000-0000-4000-8000-000000000002";
const REGISTRY_KEY = "plethora-custom-themes";
const SELECTION_KEY = "plethora-last-theme";
const JOURNAL_KEY = "plethora-image-theme-mutation-v1";

function pngBlob(): Blob {
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  ], { type: "image/png" });
}

function makePack(mediaId: string): AnimatedImagePack {
  const first = pngBlob();
  const second = pngBlob();
  return {
    version: 1,
    mediaId,
    sourceFormat: "gif",
    sourceWidth: 4,
    sourceHeight: 4,
    width: 4,
    height: 4,
    durationMs: 200,
    plays: "infinite",
    frames: [
      { startMs: 0, durationMs: 100, still: first, width: 4, height: 4 },
      { startMs: 100, durationMs: 100, still: second, width: 4, height: 4 },
    ],
    byteLength: first.size + second.size,
    droppedTransitions: false,
  };
}

function makeTheme(id: string, mediaId: string): Theme {
  return {
    id,
    name: id,
    variant: "dark",
    colors: {} as Theme["colors"],
    typography: {} as Theme["typography"],
    spacing: {} as Theme["spacing"],
    radius: {} as Theme["radius"],
    shadows: {} as Theme["shadows"],
    effects: {
      backgroundImage: {
        imageId: animatedImagePosterKey(mediaId),
        protectedSurfaces: true,
      },
      imageAnimation: {
        version: 1,
        mediaId,
        sourceFormat: "gif",
        enabled: true,
      },
    },
  };
}

function makePrepared(mediaId: string): PreparedAnimatedImage {
  const poster = pngBlob();
  const pack = makePack(mediaId);
  return {
    mediaId,
    tier: "desktop",
    outcome: "animated",
    poster,
    thumbnail: pngBlob(),
    thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    width: 4,
    height: 4,
    sourceWidth: 4,
    sourceHeight: 4,
    paletteSamples: [],
    pack,
  };
}

function installImageDatabase() {
  const values = new Map<string, unknown>();
  let storeCreated = false;
  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => {
      storeCreated = true;
      return {};
    },
    close: () => undefined,
    transaction: () => {
      const snapshot = new Map(values);
      const queue: Array<() => void> = [];
      let scheduled = false;
      let finished = false;
      let aborted = false;
      const transaction: Record<string, unknown> = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        abort: () => {
          aborted = true;
          schedule();
        },
        objectStore: () => store,
      };
      const schedule = () => {
        if (scheduled || finished) return;
        scheduled = true;
        queueMicrotask(pump);
      };
      const request = (run: (item: Record<string, unknown>) => void) => {
        const item: Record<string, unknown> = {
          result: undefined,
          onsuccess: null,
          onerror: null,
          error: null,
        };
        queue.push(() => {
          if (aborted) return;
          run(item);
          (item.onsuccess as ((event: unknown) => void) | null)?.({ target: item });
        });
        schedule();
        return item;
      };
      const store = {
        put: (value: unknown, key: string) => request((item) => {
          values.set(key, value);
          item.result = key;
        }),
        get: (key: string) => request((item) => {
          item.result = values.get(key);
        }),
        getKey: (key: string) => request((item) => {
          item.result = values.has(key) ? key : undefined;
        }),
        delete: (key: string) => request(() => {
          values.delete(key);
        }),
      };
      function pump() {
        scheduled = false;
        if (finished) return;
        if (aborted) {
          values.clear();
          snapshot.forEach((value, key) => values.set(key, value));
          finished = true;
          (transaction.onabort as ((event: unknown) => void) | null)?.({ target: transaction });
          return;
        }
        const next = queue.shift();
        if (next) {
          next();
          schedule();
          return;
        }
        finished = true;
        (transaction.oncomplete as ((event: unknown) => void) | null)?.({ target: transaction });
      }
      schedule();
      return transaction;
    },
  };
  const indexedDb = {
    open: () => {
      const openRequest: Record<string, unknown> = { result: database, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (!storeCreated) {
          (openRequest.onupgradeneeded as ((event: unknown) => void) | null)?.({ target: openRequest });
        }
        (openRequest.onsuccess as ((event: unknown) => void) | null)?.({ target: openRequest });
      });
      return openRequest;
    },
  };
  vi.stubGlobal("indexedDB", indexedDb);
  return { values };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("animated image theme mutations", () => {
  it("saves metadata and both assets before selecting the new theme", async () => {
    const db = installImageDatabase();
    const theme = makeTheme("animated-one", MEDIA_A);
    const prepared = makePrepared(MEDIA_A);

    const result = await commitAnimatedImageTheme(theme, prepared);

    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]")).toEqual([theme]);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(theme.id);
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(db.values.get(animatedImagePosterKey(MEDIA_A))).toEqual(prepared.poster);
    expect(db.values.get(animatedImagePackKey(MEDIA_A))).toEqual(prepared.pack);
    expect(result).toMatchObject({ selectedThemeId: theme.id, customThemes: [theme] });
  });

  it("compensates a partially written localStorage commit and reclaims only the new generation", async () => {
    const db = installImageDatabase();
    const previous = makeTheme("animated-old", MEDIA_A);
    const next = makeTheme("animated-new", MEDIA_B);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([previous]));
    localStorage.setItem(SELECTION_KEY, previous.id);
    db.values.set(animatedImagePosterKey(MEDIA_A), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_A), makePack(MEDIA_A));

    const originalSetItem = Storage.prototype.setItem;
    let failOnce = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === SELECTION_KEY && value === next.id && failOnce) {
        failOnce = false;
        originalSetItem.call(this, key, value);
        throw new DOMException("Simulated partial selection write", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    await expect(commitAnimatedImageTheme(next, makePrepared(MEDIA_B)))
      .rejects.toMatchObject({ code: "storage-write-failed" });

    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]")).toEqual([previous]);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(previous.id);
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(db.values.has(animatedImagePosterKey(MEDIA_B))).toBe(false);
    expect(db.values.has(animatedImagePackKey(MEDIA_B))).toBe(false);
    expect(db.values.has(animatedImagePosterKey(MEDIA_A))).toBe(true);
    expect(db.values.has(animatedImagePackKey(MEDIA_A))).toBe(true);
  });

  it("recovers a prepared journal and reclaims its unreferenced staged generation", async () => {
    const db = installImageDatabase();
    const previous = makeTheme("animated-old", MEDIA_A);
    const next = makeTheme("animated-new", MEDIA_B);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([next]));
    localStorage.setItem(SELECTION_KEY, next.id);
    db.values.set(animatedImagePosterKey(MEDIA_B), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_B), makePack(MEDIA_B));
    localStorage.setItem(JOURNAL_KEY, JSON.stringify({
      version: 1,
      operationId: "interrupted-operation",
      state: "prepared",
      kind: "upsert",
      themeId: next.id,
      previousTheme: previous,
      previousIndex: 0,
      previousSelection: previous.id,
      mediaId: MEDIA_B,
    }));

    await recoverImageThemeMutationJournal();

    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]")).toEqual([previous]);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(previous.id);
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(db.values.has(animatedImagePosterKey(MEDIA_B))).toBe(false);
    expect(db.values.has(animatedImagePackKey(MEDIA_B))).toBe(false);
  });

  it("cleans the previous generation when finishing a committed recovery journal", async () => {
    const db = installImageDatabase();
    const previous = makeTheme("animated-old", MEDIA_A);
    const current = makeTheme("animated-current", MEDIA_B);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([current]));
    localStorage.setItem(SELECTION_KEY, current.id);
    db.values.set(animatedImagePosterKey(MEDIA_A), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_A), makePack(MEDIA_A));
    db.values.set(animatedImagePosterKey(MEDIA_B), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_B), makePack(MEDIA_B));
    localStorage.setItem(JOURNAL_KEY, JSON.stringify({
      version: 1,
      operationId: "committed-operation",
      state: "committed",
      kind: "upsert",
      themeId: current.id,
      previousTheme: previous,
      previousIndex: 0,
      previousSelection: previous.id,
      mediaId: MEDIA_B,
    }));

    await recoverImageThemeMutationJournal();

    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(db.values.has(animatedImagePosterKey(MEDIA_A))).toBe(false);
    expect(db.values.has(animatedImagePackKey(MEDIA_A))).toBe(false);
    expect(db.values.has(animatedImagePosterKey(MEDIA_B))).toBe(true);
    expect(db.values.has(animatedImagePackKey(MEDIA_B))).toBe(true);
  });

  it("keeps a shared media generation until its final referencing theme is removed", async () => {
    const db = installImageDatabase();
    const first = makeTheme("animated-first", MEDIA_A);
    const second = makeTheme("animated-second", MEDIA_A);
    const fallback = { id: "milky-matcha" } as Theme;
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([first, second]));
    localStorage.setItem(SELECTION_KEY, first.id);
    db.values.set(animatedImagePosterKey(MEDIA_A), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_A), makePack(MEDIA_A));

    const afterFirstRemoval = await removeAnimatedImageTheme(first.id, fallback.id);
    expect(afterFirstRemoval.customThemes).toEqual([second]);
    expect(db.values.has(animatedImagePosterKey(MEDIA_A))).toBe(true);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(fallback.id);

    await removeAnimatedImageTheme(second.id, fallback.id);
    expect(db.values.has(animatedImagePosterKey(MEDIA_A))).toBe(false);
    expect(db.values.has(animatedImagePackKey(MEDIA_A))).toBe(false);
  });

  it("selects an existing saved media theme through the journaled path", async () => {
    installImageDatabase();
    const theme = makeTheme("animated-saved", MEDIA_A);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([theme]));

    const result = await selectAnimatedImageTheme(theme.id);

    expect(result.customThemes).toEqual([theme]);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(theme.id);
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
  });

  it("commits an imported colors-only theme and selection atomically", async () => {
    installImageDatabase();
    const imported = makeTheme("imported-colors-only", MEDIA_A);
    delete imported.effects?.imageAnimation;
    imported.effects!.backgroundImage = { imageId: "", thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgo=" };

    const result = await commitImportedTheme(imported);

    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]")).toEqual([imported]);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(imported.id);
    expect(result.selectedThemeId).toBe(imported.id);
    await expect(commitImportedTheme(makeTheme("unsafe-import", MEDIA_A)))
      .rejects.toMatchObject({ code: "invalid-pack" });
  });

  it("preserves an animated theme that appears in storage during a colors-only import", async () => {
    const db = installImageDatabase();
    const existing = makeTheme("cross-window-collision", MEDIA_A);
    const imported = makeTheme("cross-window-collision", MEDIA_B);
    delete imported.effects?.imageAnimation;
    imported.effects!.backgroundImage = { imageId: "" };
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([existing]));
    localStorage.setItem(SELECTION_KEY, existing.id);
    db.values.set(animatedImagePosterKey(MEDIA_A), pngBlob());
    db.values.set(animatedImagePackKey(MEDIA_A), makePack(MEDIA_A));

    const result = await commitImportedTheme(imported);
    const saved = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]") as Theme[];

    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(existing);
    expect(saved[1].id).toBe(result.selectedThemeId);
    expect(result.selectedThemeId).not.toBe(existing.id);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(result.selectedThemeId);
    expect(db.values.has(animatedImagePosterKey(MEDIA_A))).toBe(true);
    expect(db.values.has(animatedImagePackKey(MEDIA_A))).toBe(true);
  });
});
