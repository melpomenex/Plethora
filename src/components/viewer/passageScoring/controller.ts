/**
 * Bounded passage-scoring controller (tasks 2.1–2.4).
 *
 * Responsibilities:
 *  - turn adapter visibility events into a bounded candidate queue
 *    (≥1s dwell, ≥750ms idle, queue ≤8, concurrency 1);
 *  - resolve the serving policy/destination BEFORE reading private text for a
 *    remote query, with remote automatic quota defaulting to zero;
 *  - look up the versioned digest cache first (cache hits bypass inference and
 *    quota);
 *  - classify at most 12 new passages per document visit and 60 per foreground
 *    hour, through the existing `runPassageClassification` pipeline;
 *  - cancel/suppress stale work on disable, background, navigation, selection/
 *    reflow, model contention or owner revision change;
 *  - emit content-free D0 observations and explicit counters.
 *
 * No scroll handler calls this class's inference path: adapters only emit
 * visibility events, and the queue is pumped from timers idle-gated by
 * `noteActivity`.
 */

import { recordFeatureObservation } from "../../../lib/ai/diagnostics";
import { getInFlightTaskCount } from "../../../lib/ai/tasks/runTask";
import type { PassageClassification } from "../../../lib/ai/schemas/passageClassification";
import {
  PassageCandidateQueue,
} from "./queue";
import {
  RecentPassageScoreCache,
  PassageDismissalStore,
  PassageUsageBudget,
  classificationFromStoredScore,
  emptyPassageScoringCounters,
  sharedRecentPassageScores,
  sharedPassageUsageBudget,
  type StoredPassageScore,
} from "./cache";
import { sha256Short } from "./hash";
import {
  PASSAGE_NORMALIZATION_VERSION,
  boundPassageText,
  classifyErrorMessage,
  computePassageDigest,
  isExtractWorthinessEligible,
  toPlainReason,
} from "./identity";
import {
  consumePassageRemoteAuthorization,
  getPassageRemoteScoringAuthorization,
  recordObservedServingRevision,
  subscribePassageScoringAuthorization,
  type PassagePolicyResolution,
  type ResolvedPassageScoringPolicy,
} from "./policy";
import { releaseModelLease, tryAcquireModelLease } from "./lease";
import {
  PASSAGE_COOPERATIVE_SLICE_MS,
  PASSAGE_DWELL_MS,
  PASSAGE_IDLE_MS,
  PASSAGE_QUEUE_LIMIT,
  type PassageAdapter,
  type PassageEncounterEvent,
  type PassageScoringControllerEvents,
  type PassageScoringCounters,
  type PassageScoringResult,
  type PassageScoringStatus,
} from "./types";

export interface PassageClassificationRun {
  classification: PassageClassification;
  providerId: string;
  baseModelName?: string;
  servedModelClass?: string;
}

export interface PassageClassificationRequest {
  policy: ResolvedPassageScoringPolicy;
  text: string;
  documentTitle?: string;
  signal: AbortSignal;
  targetId: string;
  observation: {
    featureId: "extract-worthiness";
    runId: string;
    capabilityRevision: string;
  };
}

export interface PassageScoringControllerDeps {
  resolvePolicy: (sourceScope: string) => Promise<PassagePolicyResolution>;
  lookup: (digest: string) => Promise<StoredPassageScore | null>;
  store: (score: StoredPassageScore) => Promise<void>;
  classify: (request: PassageClassificationRequest) => Promise<PassageClassificationRun>;
  dismissals: PassageDismissalStore;
  budget?: PassageUsageBudget;
  recent?: RecentPassageScoreCache;
  now?: () => number;
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Foreground explicit AI or another model consumer is busy. */
  isModelBusy?: () => boolean;
  /** "working" status callback is emitted through events. */
}

export interface PassageScoringControllerOptions {
  adapter: PassageAdapter;
  documentId?: string;
  documentTitle?: string;
  sourceRevision: string;
  /**
   * Current active-tab/foreground state. The controller never starts work
   * while this is false.
   */
  isForeground: () => boolean;
  isEnabled: () => boolean;
  /** Optional feature-config revision probe (disable/re-enable on change). */
  getConfigRevision?: () => string;
  events: PassageScoringControllerEvents;
  deps: PassageScoringControllerDeps;
}

interface EncounterState {
  timer: unknown;
  enteredAt: number;
}

interface ActiveRun {
  token: number;
  passageId: string;
  digest: string;
  controller: AbortController;
  removeAbortListener?: () => void;
}

const DEFAULTS = {
  now: () => Date.now(),
  setTimeout: (handler: () => void, timeoutMs: number) =>
    setTimeout(handler, Math.max(0, timeoutMs)),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class PassageScoringController {
  private readonly adapter: PassageAdapter;
  private readonly documentId?: string;
  private readonly documentTitle?: string;
  private sourceRevision: string;
  private readonly isForeground: () => boolean;
  private readonly isEnabled: () => boolean;
  private readonly getConfigRevision?: () => string;
  private readonly events: PassageScoringControllerEvents;
  private readonly deps: PassageScoringControllerDeps;
  private readonly now: () => number;
  private readonly schedule: (handler: () => void, timeoutMs: number) => unknown;
  private readonly unschedule: (handle: unknown) => void;
  private readonly budget: PassageUsageBudget;
  private readonly recent: RecentPassageScoreCache;

  private readonly queue = new PassageCandidateQueue(PASSAGE_QUEUE_LIMIT);
  private readonly encounters = new Map<string, EncounterState>();
  private readonly dwelled = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  private counters: PassageScoringCounters = emptyPassageScoringCounters();
  private status: PassageScoringStatus = "idle";
  private policy: ResolvedPassageScoringPolicy | null = null;
  private policyPromise: Promise<void> | null = null;
  private policyFailureKey: string | null = null;

  private lastActivityAt: number;
  private idleTimer: unknown = null;
  private pumpTimer: unknown = null;
  private running = false;
  private detached = false;
  private suspended = false;
  private generation = 0;
  private activeRun: ActiveRun | null = null;
  private readonly ownerAbort = new AbortController();
  private readonly unsubscribeAuthorization: () => void;
  private configRevision: string;

  constructor(options: PassageScoringControllerOptions) {
    this.adapter = options.adapter;
    this.documentId = options.documentId;
    this.documentTitle = options.documentTitle;
    this.sourceRevision = options.sourceRevision;
    this.isForeground = options.isForeground;
    this.isEnabled = options.isEnabled;
    this.getConfigRevision = options.getConfigRevision;
    this.events = options.events;
    this.deps = options.deps;
    this.now = options.deps.now ?? DEFAULTS.now;
    this.schedule = options.deps.setTimeout ?? DEFAULTS.setTimeout;
    this.unschedule = options.deps.clearTimeout ?? DEFAULTS.clearTimeout;
    this.budget =
      options.deps.budget ??
      sharedPassageUsageBudget;
    this.recent = options.deps.recent ?? sharedRecentPassageScores;
    this.configRevision = options.getConfigRevision?.() ?? "";
    // Reading starts idle: the first eligible encounter only needs its dwell.
    this.lastActivityAt = this.now() - PASSAGE_IDLE_MS;
    this.unsubscribeAuthorization = subscribePassageScoringAuthorization(() => {
      if (this.detached) return;
      if (this.policy?.remote) {
        const grant = getPassageRemoteScoringAuthorization();
        const stillAuthorized =
          grant &&
          grant.remaining > 0 &&
          grant.authorization.providerId === this.policy.providerId;
        if (!stillAuthorized) {
          this.policy = null;
          this.invalidate("authorization-revoked", true);
          this.setStatus(
            "denied-remote",
            "ai.passageScoring.remoteAuthorizationRequired"
          );
          return;
        }
      }
      // A new grant may unblock a previously denied owner.
      if (!this.policy) this.refreshPolicy();
    });
  }

  /** Subscribe to adapter visibility. Idempotent. */
  start(): void {
    if (this.detached || this.unsubscribe) return;
    this.unsubscribe = this.adapter.subscribeEncountered((event) =>
      this.handleEncounter(event)
    );
    if (!this.isEnabled()) {
      this.setStatus("disabled");
    } else if (!this.isForeground()) {
      this.suspended = true;
      this.setStatus("suspended");
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.detached) return;
    if (!enabled) {
      this.invalidate("disabled", true);
      this.setStatus("disabled");
      return;
    }
    this.lastActivityAt = this.now() - PASSAGE_IDLE_MS;
    this.policyFailureKey = null;
    this.setStatus("idle");
    this.schedulePump();
  }

  setForeground(foreground: boolean): void {
    if (this.detached) return;
    if (!foreground) {
      this.suspended = true;
      // Keep the bounded queue/encounters (no work runs while suspended), but
      // abort any in-flight request so a background provider call cannot
      // complete against a surface the user can no longer see.
      this.cancelActive("background");
      this.clearTimer("pump");
      this.setStatus("suspended");
      return;
    }
    this.suspended = false;
    this.lastActivityAt = this.now() - PASSAGE_IDLE_MS;
    this.setStatus("idle");
    this.schedulePump(0);
  }

  /** Reading activity resets the idle gate. Selection/reflow also cancels. */
  noteActivity(kind: "scroll" | "selection" | "reflow" = "scroll"): void {
    if (this.detached) return;
    this.lastActivityAt = this.now();
    this.clearTimer("idle");
    if (kind === "selection" || kind === "reflow") {
      this.cancelActive("activity");
    }
    this.schedulePump();
  }

  /** Scroll events only reset idle; they never touch the queue or inference. */
  noteScroll(): void {
    this.noteActivity("scroll");
  }

  /**
   * Owner/source/config revision change: abort everything derived from the
   * old revision and remove indicators immediately.
   */
  invalidate(reason: string, clearResults = true): void {
    this.generation += 1;
    this.cancelActive(reason);
    this.clearEncounters();
    this.queue.clear();
    this.clearTimer("idle");
    this.clearTimer("pump");
    if (clearResults) this.events.onClear();
    this.emitCounters();
  }

  setSourceRevision(revision: string): void {
    if (revision === this.sourceRevision) return;
    this.sourceRevision = revision;
    this.policy = null;
    this.policyFailureKey = null;
    this.invalidate("source-revision", true);
  }

  /** A provider/settings/authorization change requires a new preflight. */
  refreshPolicy(): void {
    this.policy = null;
    this.policyFailureKey = null;
    this.schedulePump(0);
  }

  startVisit(): void {
    this.budget.startVisit();
    this.queue.clear();
    this.clearEncounters();
    this.invalidate("visit", true);
    this.lastActivityAt = this.now() - PASSAGE_IDLE_MS;
  }

  async dismiss(passageId: string): Promise<void> {
    await this.deps.dismissals.dismiss(passageId);
    this.queue.remove(passageId);
    this.dwelled.delete(passageId);
    const encounter = this.encounters.get(passageId);
    if (encounter) this.unschedule(encounter.timer);
    this.encounters.delete(passageId);
    this.events.onRemove(passageId);
    this.emitCounters();
  }

  getStatus(): PassageScoringStatus {
    return this.status;
  }

  getCounters(): PassageScoringCounters {
    return { ...this.counters };
  }

  getDurableDismissals(): boolean {
    return this.deps.dismissals.durableSource;
  }

  /** Current adapter passage snapshot, or null when stale/detached. */
  snapshot(passageId: string): import("./types").PassageSnapshot | null {
    if (this.detached || !this.isEnabled()) return null;
    try {
      return this.adapter.snapshot(passageId);
    } catch {
      return null;
    }
  }

  projectRects(passageId: string) {
    if (this.detached) return null;
    try {
      return this.adapter.projectRects(passageId);
    } catch {
      return null;
    }
  }

  resolveLocator(locator: import("./types").PassageLocator): boolean {
    if (this.detached) return false;
    try {
      return this.adapter.resolveLocator(locator);
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this.detached) return;
    this.detached = true;
    this.generation += 1;
    this.cancelActive("dispose");
    this.ownerAbort.abort();
    this.unsubscribeAuthorization();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearEncounters();
    this.queue.clear();
    this.clearTimer("idle");
    this.clearTimer("pump");
    releaseModelLease(this.ownerToken);
    try {
      this.adapter.dispose();
    } catch {
      // Adapter teardown must never throw into React unmount.
    }
    this.events.onClear();
  }

  /* --------------------------------------------------------------------- */
  /* Encounter / dwell                                                     */
  /* --------------------------------------------------------------------- */

  private handleEncounter(event: PassageEncounterEvent): void {
    if (this.detached) return;
    if (!this.isEnabled()) {
      this.counters.skippedDisabled += 1;
      this.emitCounters();
      return;
    }
    if (event.kind === "exit") {
      const state = this.encounters.get(event.passageId);
      if (state) {
        this.unschedule(state.timer);
        this.encounters.delete(event.passageId);
      }
      return;
    }

    if (this.encounters.has(event.passageId) || this.dwelled.has(event.passageId)) {
      return;
    }
    this.counters.encounters += 1;
    // Bound encounter bookkeeping even if the adapter reports a large page.
    if (this.encounters.size >= PASSAGE_QUEUE_LIMIT * 4) {
      this.counters.skippedQueueFull += 1;
      this.emitCounters();
      return;
    }

    const timer = this.schedule(() => {
      this.handleDwellElapsed(event.passageId);
    }, PASSAGE_DWELL_MS);
    this.encounters.set(event.passageId, { timer, enteredAt: this.now() });
    this.emitCounters();
  }

  private handleDwellElapsed(passageId: string): void {
    if (this.detached || !this.isEnabled()) return;
    const state = this.encounters.get(passageId);
    if (!state) return;
    this.encounters.delete(passageId);
    this.dwelled.add(passageId);
    this.counters.dwelled += 1;

    if (!this.queue.push(passageId)) {
      this.counters.skippedQueueFull += 1;
      this.emitCounters();
      return;
    }
    this.counters.enqueued += 1;
    this.emitCounters();
    this.schedulePump();
  }

  private clearEncounters(): void {
    for (const state of this.encounters.values()) this.unschedule(state.timer);
    this.encounters.clear();
    this.dwelled.clear();
  }

  /* --------------------------------------------------------------------- */
  /* Scheduling                                                            */
  /* --------------------------------------------------------------------- */

  private schedulePump(delayMs?: number): void {
    if (this.detached) return;
    const delay =
      delayMs ??
      Math.max(0, PASSAGE_IDLE_MS - (this.now() - this.lastActivityAt));
    this.clearTimer("pump");
    this.pumpTimer = this.schedule(() => {
      this.pumpTimer = null;
      void this.pump();
    }, delay);
  }

  private async ensurePolicy(): Promise<ResolvedPassageScoringPolicy | null> {
    if (this.policy) return this.policy;
    if (this.policyPromise) {
      await this.policyPromise;
      return this.policy;
    }
    const runId = sha256Short(`${this.ownerToken}:policy`, 16);
    this.policyPromise = (async () => {
      try {
        const resolution = await this.deps.resolvePolicy(this.sourceScope);
        if (this.detached || !this.isEnabled()) {
          this.policy = null;
          this.setStatus("disabled");
          return;
        }
        if (!this.isForeground()) {
          this.policy = null;
          this.suspended = true;
          this.setStatus("suspended");
          return;
        }
        if (resolution.status === "ready") {
          this.policy = resolution.policy;
          this.adapter.configure(resolution.policy);
          this.counters.skippedRemote = 0;
          this.policyFailureKey = null;
          this.observe(runId, "preflight", "success");
        } else if (resolution.status === "denied-remote") {
          this.policy = resolution.policy;
          this.counters.skippedRemote += 1;
          this.policyFailureKey = resolution.reasonKey;
          this.observe(runId, "preflight", "skipped", "remote-authorization-required");
          this.setStatus("denied-remote", resolution.reasonKey);
        } else {
          this.policy = null;
          this.policyFailureKey = resolution.reasonKey;
          this.observe(runId, "preflight", "failed", "model-unavailable");
          this.setStatus("unavailable", resolution.reasonKey);
        }
      } catch {
        this.policy = null;
        this.policyFailureKey = "ai.passageScoring.unavailableModel";
        this.observe(runId, "preflight", "failed", "preflight-error");
        this.setStatus("unavailable", this.policyFailureKey);
      } finally {
        this.policyPromise = null;
      }
    })();
    await this.policyPromise;
    return this.policy;
  }

  private async pump(): Promise<void> {
    if (this.detached || this.running || this.suspended) return;
    if (!this.isEnabled()) {
      this.setStatus("disabled");
      return;
    }
    if (!this.isForeground()) {
      this.suspended = true;
      this.setStatus("suspended");
      return;
    }
    if (this.queue.size === 0) return;

    const configRevision = this.getConfigRevision?.() ?? "";
    if (configRevision !== this.configRevision) {
      this.configRevision = configRevision;
      this.policy = null;
      this.policyFailureKey = null;
    }

    const idleFor = this.now() - this.lastActivityAt;
    if (idleFor < PASSAGE_IDLE_MS) {
      this.schedulePump(PASSAGE_IDLE_MS - idleFor);
      return;
    }

    const policy = await this.ensurePolicy();
    if (!policy || !policy.authorized) return;

    const denial = this.budget.canClassify(this.now(), false);
    if (denial) {
      if (denial === "remote-quota") this.counters.skippedRemote += 1;
      else if (denial === "visit-quota") this.counters.skippedVisitQuota += 1;
      else this.counters.skippedHourQuota += 1;
      this.queue.clear();
      this.emitCounters();
      this.setStatus("unavailable", `ai.passageScoring.${denial}`);
      return;
    }

    if ((this.deps.isModelBusy?.() ?? getInFlightTaskCount() > 0)) {
      // Foreground explicit AI has priority; wait instead of competing.
      this.schedulePump(500);
      return;
    }
    if (!tryAcquireModelLease(this.ownerToken)) {
      this.schedulePump(500);
      return;
    }

    const candidate = this.queue.pop();
    if (!candidate) {
      releaseModelLease(this.ownerToken);
      return;
    }
    this.counters.dequeued += 1;

    const startedAt = this.now();
    this.running = true;
    const token = ++this.generation;
    const controller = new AbortController();
    const onOwnerAbort = () => controller.abort();
    this.ownerAbort.signal.addEventListener("abort", onOwnerAbort, { once: true });
    this.activeRun = {
      token,
      passageId: candidate.passageId,
      digest: "",
      controller,
      removeAbortListener: () =>
        this.ownerAbort.signal.removeEventListener("abort", onOwnerAbort),
    };
    this.emitCounters();

    try {
      const snapshot = this.adapter.snapshot(candidate.passageId);
      if (!snapshot) {
        this.counters.skippedHidden += 1;
        return;
      }
      const bounded = boundPassageText(snapshot.text);
      if (!bounded) {
        this.counters.skippedHidden += 1;
        return;
      }
      const digest = computePassageDigest({ text: bounded.text, policy });
      this.activeRun.digest = digest;

      const recentHit = this.recent.get(digest);
      const [dismissed, persistentHit] = await Promise.all([
        this.deps.dismissals.isDismissed(snapshot.passageId),
        recentHit ? Promise.resolve(null) : this.deps.lookup(digest),
      ]);
      const cached = recentHit ?? persistentHit;
      if (this.isStale(token)) return;

      if (dismissed) {
        this.counters.skippedDismissed += 1;
        this.events.onRemove(snapshot.passageId);
        return;
      }

      if (cached && this.isCacheUsable(cached, policy)) {
        this.counters.cacheHits += 1;
        const fromCache = this.resultFromStored(cached, snapshot.passageId, policy, true);
        if (fromCache) this.emitResultIfEligible(fromCache);
        return;
      }

      if (policy.remote) {
        const authorized = consumePassageRemoteAuthorization(
          policy.providerId,
          policy.destination.locality,
          this.sourceScope
        );
        if (!authorized) {
          this.counters.skippedRemote += 1;
          this.queue.clear();
          this.emitCounters();
          this.setStatus("denied-remote", "ai.passageScoring.remoteAuthorizationRequired");
          return;
        }
      }
      this.budget.consume(this.now(), policy.remote);
      this.counters.classifications += 1;
      this.setStatus("working");

      const runId = sha256Short(`${this.ownerToken}:${snapshot.passageId}:${token}`, 16);
      const run = await this.deps.classify({
        policy,
        text: bounded.text,
        documentTitle: this.documentTitle,
        signal: controller.signal,
        targetId: digest,
        observation: {
          featureId: "extract-worthiness",
          runId,
          capabilityRevision: policy.capabilityRevision ?? "",
        },
      });
      if (this.isStale(token)) return;

      // The provider may report a different actual serving model. Store the
      // verdict under its real identity so a later lookup is a true hit for
      // the configuration that produced it.
      let finalPolicy = policy;
      let finalDigest = digest;
      const actualModel = run.baseModelName?.trim();
      if (actualModel && actualModel !== requestedModelOf(policy)) {
        const actualRevision = `${run.providerId}\u0000${actualModel}`;
        recordActualServingRevision(run.providerId, requestedModelOf(policy), actualModel);
        finalPolicy = { ...policy, servingRevision: actualRevision };
        finalDigest = computePassageDigest({ text: bounded.text, policy: finalPolicy });
      }

      const stored = this.scoreFromRun(run.classification, finalDigest, finalPolicy, snapshot.passageId);
      this.recent.set(finalDigest, stored);
      this.counters.cacheWrites += 1;
      await this.deps.store(stored).catch(() => {
        // A failed cache write loses optimization only; the result stays valid
        // for this render and is never retried on the interaction path.
      });
      if (this.isStale(token)) return;

      this.observe(runId, "validation", "success");
      const result = this.resultFromStored(stored, snapshot.passageId, finalPolicy, false);
      if (result) {
        this.observe(runId, "preview", "success");
        this.emitResultIfEligible(result);
      }
      void startedAt;
    } catch (error) {
      if (this.isStale(token) || controller.signal.aborted) {
        this.counters.cancelled += 1;
        this.observe(sha256Short(`${this.ownerToken}:cancel`, 16), "generation", "cancelled");
      } else {
        this.counters.failures += 1;
        const category = classifyErrorMessage(error);
        this.observe(
          sha256Short(`${this.ownerToken}:failure`, 16),
          "validation",
          "failed",
          category,
          category
        );
      }
    } finally {
      releaseModelLease(this.ownerToken);
      this.activeRun?.removeAbortListener?.();
      this.activeRun = null;
      this.running = false;
      this.emitCounters();
      if (!this.detached && !this.suspended && this.isEnabled() && this.queue.size > 0) {
        // Yield a cooperative slice before the next bounded unit of work.
        this.schedulePump(PASSAGE_COOPERATIVE_SLICE_MS);
      }
    }
  }

  private isStale(token: number): boolean {
    return (
      this.detached ||
      this.suspended ||
      !this.isEnabled() ||
      token !== this.generation ||
      this.activeRun?.controller.signal.aborted === true
    );
  }

  private isCacheUsable(
    cached: StoredPassageScore,
    policy: ResolvedPassageScoringPolicy
  ): boolean {
    if (!cached.classifierVersion || cached.classifierVersion !== policy.classifierVersion) {
      return false;
    }
    if (!cached.modelRevision || cached.modelRevision !== policy.servingRevision) {
      return false;
    }
    if (!Number.isFinite(cached.extractWorthiness)) return false;
    if (cached.extractWorthiness < 0 || cached.extractWorthiness > 1) return false;
    return true;
  }

  private scoreFromRun(
    classification: PassageClassification,
    digest: string,
    policy: ResolvedPassageScoringPolicy,
    _passageId: string
  ): StoredPassageScore {
    return {
      chunkHash: digest,
      passageType: classification.type,
      extractWorthiness: classification.extractWorthiness,
      suggestedAction: classification.suggestedLearningAction,
      model: policy.servingRevision,
      reason: toPlainReason(classification.reason),
      classifierVersion: policy.classifierVersion,
      modelRevision: policy.servingRevision,
      normalizationVersion: PASSAGE_NORMALIZATION_VERSION,
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  private resultFromStored(
    stored: StoredPassageScore,
    passageId: string,
    policy: ResolvedPassageScoringPolicy,
    fromCache: boolean
  ): PassageScoringResult | null {
    const classification = classificationFromStoredScore(stored);
    if (!classification) return null;
    return {
      passageId,
      contentHash: stored.chunkHash,
      classification,
      reason: toPlainReason(classification.reason),
      fromCache,
      classifierVersion: stored.classifierVersion ?? policy.classifierVersion,
      modelRevision: stored.modelRevision ?? policy.servingRevision,
      createdAt: stored.createdAt,
    };
  }

  private emitResultIfEligible(result: PassageScoringResult): void {
    if (!isExtractWorthinessEligible(result.classification)) {
      this.events.onRemove(result.passageId);
      return;
    }
    this.events.onResult(result);
  }

  private setStatus(status: PassageScoringStatus, reasonKey?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status, reasonKey);
  }

  private observe(
    runId: string,
    stage: "preflight" | "generation" | "validation" | "preview",
    outcome: "success" | "failed" | "cancelled" | "skipped",
    recoveryCode?: string,
    errorCategory?: string
  ): void {
    recordFeatureObservation({
      featureId: "extract-worthiness",
      runId,
      stage,
      level: stage === "preflight" ? "dependency" : "operational",
      outcome,
      durationMs: 0,
      capabilityRevision: this.policy?.capabilityRevision ?? this.configRevision,
      providerClass: this.policy?.providerClass,
      modelClass: "fast",
      errorCategory,
      recoveryCode,
    });
  }

  private emitCounters(): void {
    this.counters.queueLength = this.queue.size;
    this.counters.inFlight = this.running ? 1 : 0;
    this.events.onCounters({ ...this.counters });
  }

  private clearTimer(kind: "idle" | "pump"): void {
    if (kind === "idle" && this.idleTimer !== null) {
      this.unschedule(this.idleTimer);
      this.idleTimer = null;
    }
    if (kind === "pump" && this.pumpTimer !== null) {
      this.unschedule(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private cancelActive(reason: string): void {
    void reason;
    if (!this.activeRun) return;
    // Invalidate the request token before aborting so a provider that ignores
    // the signal still cannot write a late result into a newer generation.
    this.generation += 1;
    this.activeRun.controller.abort();
    this.counters.cancelled += 1;
    this.activeRun.removeAbortListener?.();
    this.activeRun = null;
    this.running = false;
    releaseModelLease(this.ownerToken);
    this.emitCounters();
  }

  private get ownerToken(): string {
    return this.adapter.ownerToken;
  }

  private get sourceScope(): string {
    return this.documentId ?? this.ownerToken;
  }
}

function requestedModelOf(policy: ResolvedPassageScoringPolicy): string {
  // `servingRevision` is `<providerId>\u0000<model>` (see policy.ts).
  const parts = policy.servingRevision.split("\u0000");
  return parts.length > 1 ? parts.slice(1).join("\u0000") : policy.servingRevision;
}

function recordActualServingRevision(
  providerId: string,
  requestedModel: string,
  actualModel: string
): void {
  recordObservedServingRevision(providerId, requestedModel, actualModel);
}
