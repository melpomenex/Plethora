/**
 * Bounded passage-score cache + dismissal state (tasks 1.3/1.4).
 *
 * - Recent results live in a 128-entry LRU; persistent storage is bounded by
 *   a 10,000-row LRU budget enforced by the Rust cleanup command (called off
 *   the interaction path by `src/api/passage-scores.ts`).
 * - Cache cleanup only removes derived scores. It never touches documents,
 *   extracts, highlights or cards.
 * - Dismissals are keyed (documentId, sourceRevision, passageId,
 *   classifierVersion). Ephemeral sources keep session-only dismissals.
 */

import {
  PASSAGE_TYPES,
  type PassageClassification,
  type SuggestedLearningAction,
} from "../../../lib/ai/schemas/passageClassification";
import { PASSAGE_RECENT_CACHE_LIMIT, type PassageScoringCounters } from "./types";

/** Wire shape of a `passage_scores` row (camelCase, matching Rust serde). */
export interface StoredPassageScore {
  chunkHash: string;
  passageType: string;
  extractWorthiness: number;
  suggestedAction?: SuggestedAction | null;
  model?: string | null;
  reason?: string | null;
  classifierVersion?: string | null;
  modelRevision?: string | null;
  normalizationVersion?: string | null;
  createdAt: string;
}

export type SuggestedAction = SuggestedLearningAction;

export interface PassageScoreStore {
  get(chunkHash: string): Promise<StoredPassageScore | null>;
  put(score: StoredPassageScore): Promise<void>;
}

/** Small LRU over recent scores; cache hits never consume inference quota. */
export class RecentPassageScoreCache {
  private readonly entries = new Map<string, StoredPassageScore>();

  constructor(private readonly limit = PASSAGE_RECENT_CACHE_LIMIT) {}

  get(key: string): StoredPassageScore | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    // Refresh insertion order (Map preserves it).
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: StoredPassageScore): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get capacity(): number {
    return this.limit;
  }
}

/** Shared recent cache across reader surfaces (still bounded to 128). */
export const sharedRecentPassageScores = new RecentPassageScoreCache();

/* ------------------------------------------------------------------------- */
/* Usage budget                                                              */
/* ------------------------------------------------------------------------- */

export type PassageBudgetDenial = "visit-quota" | "hour-quota" | "remote-quota";

const HOUR_MS = 60 * 60 * 1_000;

/**
 * Inference envelope: ≤12 new classifications per document visit, ≤60 per
 * local foreground hour, and a separate (default zero) remote budget.
 * Cache hits bypass this class entirely.
 */
export class PassageUsageBudget {
  private visitCount = 0;
  private remoteCount = 0;
  private readonly hourStamps: number[] = [];

  constructor(
    readonly visitLimit = 12,
    readonly hourLimit = 60,
    readonly remoteLimit = 0
  ) {}

  startVisit(): void {
    this.visitCount = 0;
    this.remoteCount = 0;
  }

  canClassify(now: number, remote: boolean): PassageBudgetDenial | null {
    this.prune(now);
    if (remote && this.remoteCount >= this.remoteLimit) return "remote-quota";
    if (this.visitCount >= this.visitLimit) return "visit-quota";
    if (this.hourStamps.length >= this.hourLimit) return "hour-quota";
    return null;
  }

  consume(now: number, remote: boolean): void {
    this.visitCount += 1;
    this.hourStamps.push(now);
    if (remote) this.remoteCount += 1;
  }

  private prune(now: number): void {
    const cutoff = now - HOUR_MS;
    while (this.hourStamps.length > 0 && this.hourStamps[0] <= cutoff) {
      this.hourStamps.shift();
    }
  }

  snapshot(now: number): { visitUsed: number; hourUsed: number; remoteUsed: number } {
    this.prune(now);
    return {
      visitUsed: this.visitCount,
      hourUsed: this.hourStamps.length,
      remoteUsed: this.remoteCount,
    };
  }
}

/** Shared hour/visit budget for the foreground reader. */
export const sharedPassageUsageBudget = new PassageUsageBudget();

/* ------------------------------------------------------------------------- */
/* Dismissals                                                                */
/* ------------------------------------------------------------------------- */

export interface PassageDismissalKey {
  documentId: string;
  sourceRevision: string;
  passageId: string;
  classifierVersion: string;
}

export interface StoredPassageDismissal {
  documentId: string;
  sourceRevision: string;
  passageId: string;
  classifierVersion: string;
  dismissedAt: string;
}

export function passageDismissalId(key: PassageDismissalKey): string {
  return [key.documentId, key.sourceRevision, key.passageId, key.classifierVersion].join("\u0000");
}

export interface PassageDismissalOptions {
  /** Durable document-backed source, or ephemeral (session-only). */
  durable: boolean;
  documentId?: string;
  sourceRevision: string;
  classifierVersion: string;
  load?: (documentId: string) => Promise<StoredPassageDismissal[]>;
  persist?: (key: PassageDismissalKey) => Promise<void>;
}

/**
 * Dismissal state for one reader revision. Durable sources reload from the
 * backend (surviving reopen); ephemeral sources never leave memory.
 */
export class PassageDismissalStore {
  private readonly session = new Set<string>();
  private readonly durable = new Set<string>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly options: PassageDismissalOptions) {}

  private isDurable(): boolean {
    return this.options.durable && Boolean(this.options.documentId);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.isDurable() || this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const rows = await this.options.load?.(this.options.documentId!) ?? [];
        for (const row of rows) {
          if (row.sourceRevision !== this.options.sourceRevision) continue;
          if (row.classifierVersion !== this.options.classifierVersion) continue;
          this.durable.add(
            passageDismissalId({
              documentId: row.documentId,
              sourceRevision: row.sourceRevision,
              passageId: row.passageId,
              classifierVersion: row.classifierVersion,
            })
          );
        }
      } catch {
        // A backend hiccup degrades to session-only dismissal, never blocks
        // reading and never resurrects a fresh indicator mid-session.
      } finally {
        this.loaded = true;
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  async isDismissed(passageId: string): Promise<boolean> {
    const key = passageDismissalId({
      documentId: this.options.documentId ?? "",
      sourceRevision: this.options.sourceRevision,
      passageId,
      classifierVersion: this.options.classifierVersion,
    });
    if (this.session.has(key)) return true;
    await this.ensureLoaded();
    return this.durable.has(key);
  }

  async dismiss(passageId: string): Promise<void> {
    const key: PassageDismissalKey = {
      documentId: this.options.documentId ?? "",
      sourceRevision: this.options.sourceRevision,
      passageId,
      classifierVersion: this.options.classifierVersion,
    };
    const id = passageDismissalId(key);
    this.session.add(id);
    if (!this.isDurable()) return;
    this.durable.add(id);
    try {
      await this.options.persist?.(key);
    } catch {
      // Keep the in-memory dismissal; it remains valid for this session.
    }
  }

  /** True when a durable backend will keep the dismissal after reopen. */
  get durableSource(): boolean {
    return this.isDurable();
  }
}

/* ------------------------------------------------------------------------- */
/* Cache row helpers                                                         */
/* ------------------------------------------------------------------------- */

export function classificationFromStoredScore(score: StoredPassageScore): PassageClassification | null {
  if (!(PASSAGE_TYPES as readonly string[]).includes(score.passageType)) return null;
  const passageType = score.passageType as PassageClassification["type"];
  const action = (score.suggestedAction ?? "none") as SuggestedLearningAction;
  if (!Number.isFinite(score.extractWorthiness)) return null;
  return {
    type: passageType,
    extractWorthiness: score.extractWorthiness,
    reason: typeof score.reason === "string" ? score.reason : "",
    suggestedLearningAction: action,
  };
}

/** Counters initializer shared by the controller and tests. */
export function emptyPassageScoringCounters(): PassageScoringCounters {
  return {
    encounters: 0,
    dwelled: 0,
    enqueued: 0,
    dequeued: 0,
    cacheHits: 0,
    classifications: 0,
    cacheWrites: 0,
    skippedDisabled: 0,
    skippedHidden: 0,
    skippedQueueFull: 0,
    skippedVisitQuota: 0,
    skippedHourQuota: 0,
    skippedRemote: 0,
    skippedDismissed: 0,
    cancelled: 0,
    failures: 0,
    queueLength: 0,
    inFlight: 0,
  };
}
