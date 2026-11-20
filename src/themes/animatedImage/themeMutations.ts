import { migratedGetItem } from "../../lib/brandMigration";
import type { Theme } from "../../types/theme";
import { openThemeImageDatabase, THEME_IMAGE_STORE_NAME } from "../imageDatabase";
import {
  AnimatedImagePreparationError,
  type PreparedAnimatedImage,
} from "./contracts";
import {
  animatedImagePackKey,
  animatedImagePosterKey,
  saveAnimatedImageAssets,
} from "./storage";

const REGISTRY_KEY = "plethora-custom-themes";
const SELECTION_KEY = "plethora-last-theme";
const JOURNAL_KEY = "plethora-image-theme-mutation-v1";
const MUTATION_GATE_KEY = "meta:image-theme-mutation-gate:v1";
const GENERATED_STILL_ID = /^img-[a-z0-9-]{1,100}$/i;
const MEDIA_ID = /^anim-[a-z0-9-]{8,64}$/;
let operationCounter = 0;

type MutationKind = "upsert" | "remove" | "select";
type MutationRequestKind = MutationKind | "import";
type JournalState = "prepared" | "committed";

interface ImageThemeMutationJournal {
  readonly version: 1;
  readonly operationId: string;
  state: JournalState;
  readonly kind: MutationKind;
  readonly themeId: string;
  readonly previousTheme: Theme | null;
  readonly previousIndex: number;
  readonly previousSelection: string | null;
  readonly mediaId?: string;
}

export interface ImageThemeMutationResult {
  readonly customThemes: Theme[];
  readonly selectedThemeId: string;
}

export function recoverImageThemeMutationJournal(): Promise<void> {
  if (typeof localStorage === "undefined") return Promise.resolve();
  const raw = localStorage.getItem(JOURNAL_KEY);
  if (!raw) return Promise.resolve();

  const journal = parseJournal(raw);
  if (journal.state === "committed") {
    localStorage.removeItem(JOURNAL_KEY);
    if (localStorage.getItem(JOURNAL_KEY) !== null) {
      throw mutationError("The previous image theme update could not be finalized.");
    }
    return journal.previousTheme
      ? cleanupGeneratedImageIfUnreferenced(journal.previousTheme.effects?.backgroundImage?.imageId)
      : Promise.resolve();
  }

  rollbackPreparedMutation(journal);
  return journal.mediaId
    ? cleanupGeneratedImageIfUnreferenced(animatedImagePosterKey(journal.mediaId))
    : Promise.resolve();
}

export async function commitAnimatedImageTheme(
  theme: Theme,
  prepared: PreparedAnimatedImage
): Promise<ImageThemeMutationResult> {
  validateImageThemeDraft(theme, prepared);
  await saveAnimatedImageAssets(prepared.mediaId, prepared.poster, prepared.pack, prepared.tier);
  try {
    return await commitMutation({
      kind: "upsert",
      theme,
      themeId: theme.id,
      selectedThemeId: theme.id,
      mediaId: prepared.mediaId,
      requirePoster: true,
      requirePack: Boolean(prepared.pack),
    });
  } catch (error) {
    // A failed metadata commit leaves the old selection usable. Reclaim this
    // generated staging identity only after rollback is known to have settled.
    try {
      const journalBeforeRecovery = localStorage.getItem(JOURNAL_KEY);
      const priorJournal = journalBeforeRecovery ? parseJournal(journalBeforeRecovery) : null;
      await recoverImageThemeMutationJournal();
      const registry = readThemeRegistry();
      const recoveredMediaId = priorJournal?.state === "prepared" ? priorJournal.mediaId : null;
      if (
        recoveredMediaId !== prepared.mediaId &&
        !registry.some((item) => referencesMedia(item, prepared.mediaId))
      ) {
        await cleanupGeneratedImageIfUnreferenced(animatedImagePosterKey(prepared.mediaId));
      }
    } catch {
      // Unknown ownership means keep both generations for the next recovery.
    }
    throw error;
  }
}

export async function updateAnimatedImageTheme(theme: Theme): Promise<ImageThemeMutationResult> {
  const mediaId = theme.effects?.imageAnimation?.mediaId || parsePosterMediaId(theme.effects?.backgroundImage?.imageId);
  if (
    !mediaId ||
    !MEDIA_ID.test(mediaId) ||
    theme.effects?.backgroundImage?.imageId !== animatedImagePosterKey(mediaId) ||
    (theme.effects?.imageAnimation &&
      (theme.effects.imageAnimation.version !== 1 ||
        theme.effects.imageAnimation.sourceFormat !== "gif"))
  ) {
    throw new AnimatedImagePreparationError("invalid-pack", "The saved animation identity is missing.");
  }
  return commitMutation({
    kind: "upsert",
    theme,
    themeId: theme.id,
    selectedThemeId: readSelectedThemeId() || theme.id,
    mediaId,
    requirePoster: true,
  });
}

/** Import sanitized theme JSON and select it in the same journaled write. */
export async function commitImportedTheme(theme: Theme): Promise<ImageThemeMutationResult> {
  if (theme.effects?.imageAnimation || theme.effects?.backgroundImage?.imageId) {
    throw new AnimatedImagePreparationError(
      "invalid-pack",
      "Imported themes cannot claim a local image asset."
    );
  }
  return commitMutation({
    kind: "import",
    theme,
    themeId: theme.id,
    selectedThemeId: theme.id,
  });
}

export async function selectAnimatedImageTheme(themeId: string): Promise<ImageThemeMutationResult> {
  return commitMutation({ kind: "select", themeId, selectedThemeId: themeId });
}

export async function removeAnimatedImageTheme(
  themeId: string,
  fallbackThemeId: string
): Promise<ImageThemeMutationResult> {
  return commitMutation({ kind: "remove", themeId, selectedThemeId: fallbackThemeId });
}

interface MutationRequest {
  readonly kind: MutationRequestKind;
  readonly themeId: string;
  readonly selectedThemeId: string;
  readonly theme?: Theme;
  readonly mediaId?: string;
  readonly requirePoster?: boolean;
  readonly requirePack?: boolean;
}

async function commitMutation(request: MutationRequest): Promise<ImageThemeMutationResult> {
  await recoverImageThemeMutationJournal();
  const database = await openThemeImageDatabase();
  if (!database) {
    throw new AnimatedImagePreparationError("storage-unavailable", "Local image storage is unavailable.");
  }

  return new Promise((resolve, reject) => {
    let journal: ImageThemeMutationJournal | null = null;
    let result: ImageThemeMutationResult | null = null;
    let failure: unknown = null;
    let settled = false;

    const resolveOnce = (value: ImageThemeMutationResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      const transaction = database.transaction(THEME_IMAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(THEME_IMAGE_STORE_NAME);
      const gateRequest = store.put(createOperationId(), MUTATION_GATE_KEY);
      gateRequest.onerror = () => {
        failure = mutationError("The image theme update could not acquire its storage gate.");
        transaction.abort();
      };

      const checks: IDBRequest<IDBValidKey | undefined>[] = [];
      if (request.requirePoster && request.mediaId) {
        checks.push(store.getKey(animatedImagePosterKey(request.mediaId)));
      }
      if (request.requirePack && request.mediaId) {
        checks.push(store.getKey(animatedImagePackKey(request.mediaId)));
      }
      let checksPending = checks.length;
      let checksPassed = true;

      const commitWhenReady = () => {
        if (checksPending !== 0 || journal) return;
        if (!checksPassed) {
          failure = mutationError("The staged image assets are missing from local storage.");
          transaction.abort();
          return;
        }
        try {
          const beforeThemes = readThemeRegistry();
          let mutationThemeId = request.themeId;
          let mutationSelectionId = request.selectedThemeId;
          let mutationTheme = request.theme;
          let previousIndex = beforeThemes.findIndex((item) => item.id === mutationThemeId);
          let previousTheme = previousIndex >= 0 ? beforeThemes[previousIndex] : null;
          if (request.kind === "select" && previousIndex < 0) {
            throw mutationError("The saved image theme is no longer available.");
          }
          if (request.kind === "remove" && previousIndex < 0) {
            throw mutationError("The saved image theme is no longer available.");
          }
          if ((request.kind === "upsert" || request.kind === "import") && !request.theme) {
            throw mutationError("The image theme update is incomplete.");
          }
          if (request.kind === "import" && previousTheme && isAnimatedMediaTheme(previousTheme)) {
            mutationTheme = {
              ...request.theme!,
              id: createFreshImportedThemeId(request.theme!.id, beforeThemes),
            };
            mutationThemeId = mutationTheme.id;
            mutationSelectionId = mutationTheme.id;
            previousIndex = -1;
            previousTheme = null;
          }
          const normalizedMutation: MutationRequest & { kind: MutationKind } = {
            ...request,
            kind: request.kind === "import" ? "upsert" : request.kind,
            theme: mutationTheme,
            themeId: mutationThemeId,
            selectedThemeId: mutationSelectionId,
          };

          const journalValue: ImageThemeMutationJournal = {
            version: 1,
            operationId: createOperationId(),
            state: "prepared",
            kind: normalizedMutation.kind,
            themeId: mutationThemeId,
            previousTheme,
            previousIndex,
            previousSelection: localStorage.getItem(SELECTION_KEY),
            mediaId: request.mediaId,
          };
          journal = journalValue;

          const nextThemes = applyThemeMutation(beforeThemes, normalizedMutation);
          const nextRegistryJson = JSON.stringify(nextThemes);
          result = { customThemes: nextThemes, selectedThemeId: mutationSelectionId };
          writeAndVerify(JOURNAL_KEY, JSON.stringify(journalValue));
          if (normalizedMutation.kind !== "select") writeAndVerify(REGISTRY_KEY, nextRegistryJson);
          writeAndVerify(SELECTION_KEY, mutationSelectionId);

          const committedJournal: ImageThemeMutationJournal = { ...journalValue, state: "committed" };
          writeAndVerify(JOURNAL_KEY, JSON.stringify(committedJournal));
          journalValue.state = "committed";

          scheduleUnreferencedCleanup(store, previousTheme, nextThemes);
          store.delete(MUTATION_GATE_KEY);
        } catch (error) {
          failure = normalizeMutationError(error);
          if (journal) {
            try {
              const savedJournal = localStorage.getItem(JOURNAL_KEY);
              const durableJournal = savedJournal ? parseJournal(savedJournal) : null;
              if (durableJournal?.state === "committed") {
                journal.state = "committed";
              } else if (durableJournal?.state === "prepared") {
                journal.state = "prepared";
                rollbackPreparedMutation(journal);
              }
            } catch {
              // Keep the journal and both generations for startup recovery.
            }
          }
          try {
            transaction.abort();
          } catch {
            rejectOnce(failure);
          }
        }
      };

      for (const check of checks) {
        check.onsuccess = () => {
          if (check.result === undefined) checksPassed = false;
          checksPending -= 1;
          commitWhenReady();
        };
        check.onerror = () => {
          checksPassed = false;
          checksPending -= 1;
          commitWhenReady();
        };
      }
      commitWhenReady();

      transaction.oncomplete = () => {
        database.close();
        if (!journal || journal.state !== "committed" || !result) {
          rejectOnce(failure || mutationError("The image theme update did not complete."));
          return;
        }
        try {
          localStorage.removeItem(JOURNAL_KEY);
        } catch {
          // The committed record is safe to recover on the next startup.
        }
        resolveOnce(result);
      };
      transaction.onerror = () => {
        failure ||= mutationError("The image theme update could not be saved.");
      };
      transaction.onabort = () => {
        database.close();
        if (journal?.state === "committed" && result) {
          // Metadata and selection are durable. A cleanup abort only retains
          // the old generation, which is safer than deleting a live asset.
          resolveOnce(result);
        } else {
          rejectOnce(failure || mutationError("The image theme update was interrupted."));
        }
      };
    } catch (error) {
      database.close();
      rejectOnce(normalizeMutationError(error));
    }
  });
}

function applyThemeMutation(themes: Theme[], request: MutationRequest): Theme[] {
  if (request.kind === "select") return themes;
  if (request.kind === "remove") return themes.filter((item) => item.id !== request.themeId);
  const updated = request.theme!;
  const index = themes.findIndex((item) => item.id === updated.id);
  if (index < 0) return [...themes, updated];
  return themes.map((item, itemIndex) => itemIndex === index ? updated : item);
}

function scheduleUnreferencedCleanup(
  store: IDBObjectStore,
  previousTheme: Theme | null,
  nextThemes: Theme[]
): void {
  if (!previousTheme) return;
  const previousImageId = previousTheme.effects?.backgroundImage?.imageId;
  const previousMediaId = previousTheme.effects?.imageAnimation?.mediaId || parsePosterMediaId(previousImageId);
  if (previousMediaId && MEDIA_ID.test(previousMediaId) && !nextThemes.some((item) => referencesMedia(item, previousMediaId))) {
    store.delete(animatedImagePosterKey(previousMediaId));
    store.delete(animatedImagePackKey(previousMediaId));
    return;
  }
  if (
    previousImageId &&
    GENERATED_STILL_ID.test(previousImageId) &&
    !nextThemes.some((item) => item.effects?.backgroundImage?.imageId === previousImageId)
  ) {
    store.delete(previousImageId);
  }
}

function cleanupGeneratedImageIfUnreferenced(imageId: string | undefined): Promise<void> {
  const mediaId = parsePosterMediaId(imageId);
  const isGeneratedStill = Boolean(imageId && GENERATED_STILL_ID.test(imageId));
  if (!mediaId && !isGeneratedStill) return Promise.resolve();

  return (async () => {
    const database = await openThemeImageDatabase();
    if (!database) return;
    await new Promise<void>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(THEME_IMAGE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(THEME_IMAGE_STORE_NAME);
        const gate = store.put(createOperationId(), MUTATION_GATE_KEY);
        gate.onerror = () => transaction.abort();
        gate.onsuccess = () => {
          try {
            const themes = readThemeRegistry();
            if (mediaId) {
              if (!themes.some((theme) => referencesMedia(theme, mediaId))) {
                store.delete(animatedImagePosterKey(mediaId));
                store.delete(animatedImagePackKey(mediaId));
              }
            } else if (!themes.some((theme) => theme.effects?.backgroundImage?.imageId === imageId)) {
              store.delete(imageId!);
            }
            store.delete(MUTATION_GATE_KEY);
          } catch {
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          resolve();
        };
        transaction.onabort = () => {
          database.close();
          resolve();
        };
      } catch {
        database.close();
        resolve();
      }
    });
  })();
}

function referencesMedia(theme: Theme, mediaId: string): boolean {
  if (theme.effects?.imageAnimation?.mediaId === mediaId) return true;
  return theme.effects?.backgroundImage?.imageId === animatedImagePosterKey(mediaId);
}

function isAnimatedMediaTheme(theme: Theme): boolean {
  return Boolean(theme.effects?.imageAnimation || parsePosterMediaId(theme.effects?.backgroundImage?.imageId));
}

function createFreshImportedThemeId(originalId: string, themes: Theme[]): string {
  const occupied = new Set(themes.map((theme) => theme.id));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = createOperationId();
    const candidate = `${originalId.slice(0, 96)}-import-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw mutationError("A unique imported theme identifier could not be created.");
}

function parsePosterMediaId(imageId: string | undefined): string | null {
  if (!imageId) return null;
  const match = /^media:v1:(anim-[a-z0-9-]{8,64}):poster$/.exec(imageId);
  return match?.[1] ?? null;
}

function readThemeRegistry(): Theme[] {
  const raw = localStorage.getItem(REGISTRY_KEY) ?? migratedGetItem(REGISTRY_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw mutationError("Saved theme metadata is unreadable; the existing selection was kept.");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== "object" || typeof item.id !== "string")) {
    throw mutationError("Saved theme metadata is unreadable; the existing selection was kept.");
  }
  return parsed as Theme[];
}

function rollbackPreparedMutation(journal: ImageThemeMutationJournal): void {
  if (journal.state === "committed") return;
  const themes = readThemeRegistry();
  const withoutChangedId = themes.filter((item) => item.id !== journal.themeId);
  if (journal.previousTheme) {
    const insertionIndex = Math.min(Math.max(journal.previousIndex, 0), withoutChangedId.length);
    withoutChangedId.splice(insertionIndex, 0, journal.previousTheme);
  }
  writeAndVerify(REGISTRY_KEY, JSON.stringify(withoutChangedId));
  if (journal.previousSelection === null) {
    localStorage.removeItem(SELECTION_KEY);
    if (localStorage.getItem(SELECTION_KEY) !== null) throw mutationError("Theme selection rollback failed.");
  } else {
    writeAndVerify(SELECTION_KEY, journal.previousSelection);
  }
  localStorage.removeItem(JOURNAL_KEY);
  if (localStorage.getItem(JOURNAL_KEY) !== null) throw mutationError("Theme recovery could not be finalized.");
}

function parseJournal(raw: string): ImageThemeMutationJournal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw mutationError("The previous image theme update needs manual recovery.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<ImageThemeMutationJournal>).version !== 1 ||
    typeof (value as Partial<ImageThemeMutationJournal>).operationId !== "string" ||
    !["prepared", "committed"].includes((value as Partial<ImageThemeMutationJournal>).state || "") ||
    !["upsert", "remove", "select"].includes((value as Partial<ImageThemeMutationJournal>).kind || "") ||
    typeof (value as Partial<ImageThemeMutationJournal>).themeId !== "string" ||
    !Number.isInteger((value as Partial<ImageThemeMutationJournal>).previousIndex) ||
    !("previousSelection" in value) ||
    !("previousTheme" in value) ||
    ("mediaId" in value && (typeof (value as Partial<ImageThemeMutationJournal>).mediaId !== "string" || !MEDIA_ID.test((value as Partial<ImageThemeMutationJournal>).mediaId!)))
  ) {
    throw mutationError("The previous image theme update needs manual recovery.");
  }
  return value as ImageThemeMutationJournal;
}

function writeAndVerify(key: string, value: string): void {
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw mutationError("Local theme storage did not confirm the update.");
}

function readSelectedThemeId(): string | null {
  return localStorage.getItem(SELECTION_KEY) ?? migratedGetItem(SELECTION_KEY);
}

function validateImageThemeDraft(theme: Theme, prepared: PreparedAnimatedImage): void {
  const animation = theme.effects?.imageAnimation;
  if (
    !MEDIA_ID.test(prepared.mediaId) ||
    theme.effects?.backgroundImage?.imageId !== animatedImagePosterKey(prepared.mediaId) ||
    (prepared.outcome === "animated" &&
      (!prepared.pack ||
        animation?.version !== 1 ||
        animation.sourceFormat !== "gif" ||
        animation.mediaId !== prepared.mediaId ||
        typeof animation.enabled !== "boolean")) ||
    (prepared.outcome === "still" && animation) ||
    theme.effects?.backgroundImage?.protectedSurfaces !== true
  ) {
    throw new AnimatedImagePreparationError("invalid-pack", "The prepared image theme does not match its local asset.");
  }
}

function createOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `image-theme-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  operationCounter += 1;
  return `image-theme-${Date.now()}-${operationCounter}`;
}

function mutationError(message: string): AnimatedImagePreparationError {
  return new AnimatedImagePreparationError("storage-write-failed", message);
}

function normalizeMutationError(error: unknown): AnimatedImagePreparationError {
  if (error instanceof AnimatedImagePreparationError) return error;
  const message = error instanceof DOMException && error.name === "QuotaExceededError"
    ? "Local Storage is full. The image theme could not be saved."
    : "The image theme update could not be saved.";
  return new AnimatedImagePreparationError("storage-write-failed", message, { cause: error });
}
