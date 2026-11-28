/**
 * Canonical frontend Learning Event Bus (Phase 1A).
 *
 * Responsibilities:
 * - Deterministic `idempotencyKey` deduplication and monotonic sequence tracking.
 * - Tauri event listener bridge (`learning-event:committed`) + localStorage fallback.
 * - Explicit retraction linking (`retractedByEventId`) without in-place payload mutation.
 * - Cross-surface reconciliation bridge with `reviewSync.ts` for `review_committed` /
 *   `review_undone` so Review, Scroll Mode, Queue, and Unified Sessions stay consistent.
 * - Strict Health Vault boundary enforcement (rejects any health entity or payload field).
 */

import {
  LEARNING_EVENT_COMMITTED_CHANNEL,
  LEARNING_EVENT_SCHEMA_VERSION,
  VALID_LEARNING_ENTITY_KINDS,
  VALID_LEARNING_EVENT_TYPES,
  VALID_LEARNING_SURFACES,
  type AppendLearningEventInput,
  type AppendLearningEventResult,
  type LearningEntityKind,
  type LearningEvent,
  type LearningEventFilter,
  type LearningEventType,
  type LearningSurface,
  type ReviewCommittedPayload,
  type ReviewUndonePayload,
} from "../../types/learningEvent";
import { isTauri, listen, type UnlistenFn } from "../tauri";
import {
  reconcileReviewUndo,
  reconcileScheduledReview,
  type ReviewSyncEvent,
  type ReviewSyncSource,
  type SyncableLearningItem,
} from "../reviewSync";

const STORAGE_KEY = "plethora.learning_events.bus_v1";
const MAX_BUFFERED_EVENTS = 2_000;

const VALID_EVENT_TYPE_SET = new Set<string>(VALID_LEARNING_EVENT_TYPES);
const VALID_ENTITY_KIND_SET = new Set<string>(VALID_LEARNING_ENTITY_KINDS);
const VALID_SURFACE_SET = new Set<string>(VALID_LEARNING_SURFACES);

const FORBIDDEN_HEALTH_IDENTIFIER_PATTERN =
  /(^|[_\-.])(health|health_vault|healthvault|health_db|healthdb|biometric|wearable|heart_rate|heartrate|hrv|blood_pressure|bloodpressure|blood_glucose|bloodglucose|sleep_stage|sleepstage|sleep_duration|sleepduration|spo2|vo2_max|vo2max|resting_heart|restingheart|medication|symptom|medical_record|medicalrecord|menstrual|body_weight|bodyweight|calories_burned|caloriesburned|steps_count|stepscount)($|[_\-.])/i;

const FORBIDDEN_HEALTH_PAYLOAD_KEYS = new Set<string>([
  "healthvaultid",
  "healthdb",
  "healthmetric",
  "healthmetrics",
  "healthentry",
  "healthrecord",
  "heartrate",
  "restingheartrate",
  "hrv",
  "bloodpressure",
  "systolic",
  "diastolic",
  "bloodglucose",
  "glucose",
  "sleepduration",
  "sleepstages",
  "spo2",
  "vo2max",
  "biometric",
  "biometrics",
  "wearablemetric",
  "wearablemetrics",
  "medication",
  "medications",
  "symptom",
  "symptoms",
  "medicalrecord",
  "bodyweight",
  "stepscount",
  "caloriesburned",
  "menstrualcycle",
]);

export class HealthVaultBoundaryError extends Error {
  readonly code = "health_vault_boundary_violation";

  constructor(message: string) {
    super(message);
    this.name = "HealthVaultBoundaryError";
  }
}

function normalizeKeyForHealthCheck(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scanPayloadForHealthFields(value: unknown, path = "payload"): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      scanPayloadForHealthFields(value[i], `${path}[${i}]`);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(obj)) {
    const normalized = normalizeKeyForHealthCheck(key);
    if (
      FORBIDDEN_HEALTH_PAYLOAD_KEYS.has(normalized) ||
      FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(key)
    ) {
      throw new HealthVaultBoundaryError(
        `Health Vault boundary violation: forbidden field "${path}.${key}" cannot enter learning_events`,
      );
    }
    scanPayloadForHealthFields(nested, `${path}.${key}`);
  }
}

/**
 * Validates that an incoming learning event or input strictly respects the
 * Health Vault isolation boundary and uses valid learning event types/entities.
 */
export function assertLearningEventBoundary(input: {
  eventType: string;
  entityKind: string;
  surface?: string;
  payload?: unknown;
}): void {
  if (
    FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(input.entityKind) ||
    !VALID_ENTITY_KIND_SET.has(input.entityKind)
  ) {
    if (FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(input.entityKind)) {
      throw new HealthVaultBoundaryError(
        `Health Vault boundary violation: entityKind "${input.entityKind}" is forbidden in learning_events`,
      );
    }
    throw new Error(`Invalid learning event entityKind: "${input.entityKind}"`);
  }

  if (
    FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(input.eventType) ||
    !VALID_EVENT_TYPE_SET.has(input.eventType)
  ) {
    if (FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(input.eventType)) {
      throw new HealthVaultBoundaryError(
        `Health Vault boundary violation: eventType "${input.eventType}" is forbidden in learning_events`,
      );
    }
    throw new Error(`Invalid learning event type: "${input.eventType}"`);
  }

  if (input.surface !== undefined) {
    if (FORBIDDEN_HEALTH_IDENTIFIER_PATTERN.test(input.surface)) {
      throw new HealthVaultBoundaryError(
        `Health Vault boundary violation: surface "${input.surface}" is forbidden in learning_events`,
      );
    }
    if (!VALID_SURFACE_SET.has(input.surface)) {
      throw new Error(`Invalid learning event surface: "${input.surface}"`);
    }
  }

  if (input.payload !== undefined) {
    scanPayloadForHealthFields(input.payload);
  }
}

export type LearningEventListener<TPayload = Record<string, unknown>> = (
  event: LearningEvent<TPayload>,
) => void;

export interface LearningEventSubscriptionFilter {
  eventTypes?: LearningEventType[];
  surfaces?: LearningSurface[];
  entityKind?: LearningEntityKind;
  entityId?: string;
  documentId?: string;
  sessionId?: string;
  goalId?: string;
  excludeAiExcluded?: boolean;
}

interface SubscriptionEntry {
  filter: LearningEventSubscriptionFilter | null;
  handler: LearningEventListener;
}

interface PersistedBusState {
  highWaterSeq: number;
  events: LearningEvent[];
}

const subscriptions = new Set<SubscriptionEntry>();
const eventsByIdempotencyKey = new Map<string, LearningEvent>();
const eventsById = new Map<string, LearningEvent>();
const entityHighWaterSeq = new Map<string, number>();
let orderedEvents: LearningEvent[] = [];
let highWaterSeq = 0;
let eventCounter = 0;
let hydratedFromStorage = false;
let tauriUnlisten: UnlistenFn | null = null;
let tauriBridgePromise: Promise<UnlistenFn> | null = null;

function entityCompositeKey(entityKind: string, entityId: string): string {
  return `${entityKind}:${entityId}`;
}

function generateEventId(): string {
  eventCounter += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `le_${crypto.randomUUID()}`;
  }
  return `le_${Date.now()}_${eventCounter}`;
}

function getLocalStorageSafe(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return null;
}

function hydrateFromLocalStorageIfNeeded(): void {
  if (hydratedFromStorage || isTauri()) return;
  hydratedFromStorage = true;
  const storage = getLocalStorageSafe();
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedBusState>;
    if (!Array.isArray(parsed.events)) return;
    for (const evt of parsed.events) {
      if (!evt || typeof evt.idempotencyKey !== "string" || typeof evt.id !== "string") {
        continue;
      }
      if (eventsByIdempotencyKey.has(evt.idempotencyKey)) continue;
      eventsByIdempotencyKey.set(evt.idempotencyKey, evt);
      eventsById.set(evt.id, evt);
      orderedEvents.push(evt);
      if (typeof evt.seq === "number" && evt.seq > highWaterSeq) {
        highWaterSeq = evt.seq;
      }
      const eKey = entityCompositeKey(evt.entityKind, evt.entityId);
      const prevSeq = entityHighWaterSeq.get(eKey) ?? 0;
      if (evt.seq > prevSeq) {
        entityHighWaterSeq.set(eKey, evt.seq);
      }
    }
    if (typeof parsed.highWaterSeq === "number" && parsed.highWaterSeq > highWaterSeq) {
      highWaterSeq = parsed.highWaterSeq;
    }
  } catch {
    // Corrupted cache should never break the event bus
  }
}

function persistToLocalStorage(): void {
  if (isTauri()) return;
  const storage = getLocalStorageSafe();
  if (!storage) return;
  try {
    const snapshot: PersistedBusState = {
      highWaterSeq,
      events: orderedEvents.slice(-MAX_BUFFERED_EVENTS),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota or privacy-mode storage errors
  }
}

function matchesSubscriptionFilter(
  event: LearningEvent,
  filter: LearningEventSubscriptionFilter | null,
): boolean {
  if (!filter) return true;
  if (filter.eventTypes && filter.eventTypes.length > 0 && !filter.eventTypes.includes(event.eventType)) {
    return false;
  }
  if (filter.surfaces && filter.surfaces.length > 0 && !filter.surfaces.includes(event.surface)) {
    return false;
  }
  if (filter.entityKind && event.entityKind !== filter.entityKind) {
    return false;
  }
  if (filter.entityId && event.entityId !== filter.entityId) {
    return false;
  }
  if (filter.documentId && event.documentId !== filter.documentId) {
    return false;
  }
  if (filter.sessionId && event.sessionId !== filter.sessionId) {
    return false;
  }
  if (filter.goalId && event.goalId !== filter.goalId) {
    return false;
  }
  if (filter.excludeAiExcluded && event.isAiExcluded) {
    return false;
  }
  return true;
}

function notifySubscribers(event: LearningEvent): void {
  for (const sub of subscriptions) {
    if (!matchesSubscriptionFilter(event, sub.filter)) continue;
    try {
      sub.handler(event);
    } catch (error) {
      console.error("[learningEventBus] Listener error:", error);
    }
  }
}

function recordCommittedEventInternal(
  event: LearningEvent,
  retractsEventId?: string | null,
): boolean {
  hydrateFromLocalStorageIfNeeded();
  assertLearningEventBoundary({
    eventType: event.eventType,
    entityKind: event.entityKind,
    surface: event.surface,
    payload: event.payload,
  });

  if (eventsByIdempotencyKey.has(event.idempotencyKey)) {
    return false;
  }

  const normalizedEvent: LearningEvent = {
    ...event,
    schemaVersion: event.schemaVersion ?? LEARNING_EVENT_SCHEMA_VERSION,
    isLocalOnly: Boolean(event.isLocalOnly),
    isAiExcluded: Boolean(event.isAiExcluded),
    retractedByEventId: event.retractedByEventId ?? null,
  };

  if (normalizedEvent.seq > highWaterSeq) {
    highWaterSeq = normalizedEvent.seq;
  }

  eventsByIdempotencyKey.set(normalizedEvent.idempotencyKey, normalizedEvent);
  eventsById.set(normalizedEvent.id, normalizedEvent);
  orderedEvents.push(normalizedEvent);
  if (orderedEvents.length > MAX_BUFFERED_EVENTS) {
    const evicted = orderedEvents.shift();
    if (evicted) {
      eventsByIdempotencyKey.delete(evicted.idempotencyKey);
      eventsById.delete(evicted.id);
    }
  }

  const eKey = entityCompositeKey(normalizedEvent.entityKind, normalizedEvent.entityId);
  const prevSeq = entityHighWaterSeq.get(eKey) ?? 0;
  if (normalizedEvent.seq > prevSeq) {
    entityHighWaterSeq.set(eKey, normalizedEvent.seq);
  }

  if (retractsEventId) {
    const target = eventsById.get(retractsEventId);
    if (target && !target.retractedByEventId) {
      const updatedTarget: LearningEvent = {
        ...target,
        retractedByEventId: normalizedEvent.id,
      };
      eventsById.set(target.id, updatedTarget);
      eventsByIdempotencyKey.set(target.idempotencyKey, updatedTarget);
      const idx = orderedEvents.findIndex((e) => e.id === target.id);
      if (idx !== -1) {
        orderedEvents[idx] = updatedTarget;
      }
    }
  }

  persistToLocalStorage();
  notifySubscribers(normalizedEvent);
  return true;
}

/**
 * Emits a new learning event into the canonical local event bus.
 * Deduplicates deterministically by `idempotencyKey` and enforces the Health Vault boundary.
 */
export function emitLearningEvent<TPayload = Record<string, unknown>>(
  input: AppendLearningEventInput<TPayload>,
): AppendLearningEventResult<TPayload> {
  hydrateFromLocalStorageIfNeeded();
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new Error("Learning event requires a non-empty idempotencyKey");
  }

  assertLearningEventBoundary({
    eventType: input.eventType,
    entityKind: input.entityKind,
    surface: input.surface,
    payload: input.payload,
  });

  const existing = eventsByIdempotencyKey.get(input.idempotencyKey);
  if (existing) {
    return {
      event: existing as LearningEvent<TPayload>,
      inserted: false,
    };
  }

  const nowIso = new Date().toISOString();
  const nextSeq = highWaterSeq + 1;
  const event: LearningEvent<TPayload> = {
    seq: nextSeq,
    id: generateEventId(),
    idempotencyKey: input.idempotencyKey,
    schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
    eventType: input.eventType,
    actor: input.actor ?? "user",
    surface: input.surface,
    sessionId: input.sessionId ?? null,
    goalId: input.goalId ?? null,
    entityKind: input.entityKind,
    entityId: input.entityId,
    documentId: input.documentId ?? null,
    isLocalOnly: Boolean(input.isLocalOnly),
    isAiExcluded: Boolean(input.isAiExcluded),
    payload: (input.payload ?? {}) as TPayload,
    occurredAt: input.occurredAt ?? nowIso,
    createdAt: nowIso,
    retractedByEventId: null,
  };

  recordCommittedEventInternal(event as LearningEvent, input.retractsEventId);
  return { event, inserted: true };
}

/**
 * Publishes an already-committed event (e.g., returned from a Tauri command or
 * delivered via Tauri IPC event channel). Returns false if deduplicated.
 */
export function publishCommittedLearningEvent<TPayload = Record<string, unknown>>(
  event: LearningEvent<TPayload>,
  retractsEventId?: string | null,
): boolean {
  return recordCommittedEventInternal(event as LearningEvent, retractsEventId);
}

/**
 * Appends a compensating event that retracts a prior event without mutating the
 * prior event's payload. Links `retractedByEventId` on the target event.
 */
export function retractLearningEvent<TPayload = Record<string, unknown>>(
  targetEventId: string,
  compensatingInput: Omit<AppendLearningEventInput<TPayload>, "retractsEventId">,
): AppendLearningEventResult<TPayload> {
  if (!targetEventId || targetEventId.trim().length === 0) {
    throw new Error("retractLearningEvent requires a non-empty targetEventId");
  }
  return emitLearningEvent({
    ...compensatingInput,
    retractsEventId: targetEventId,
  });
}

/**
 * Subscribe to committed learning events with an optional filter.
 */
export function subscribeLearningEvents<TPayload = Record<string, unknown>>(
  filter: LearningEventSubscriptionFilter | null | undefined,
  handler: LearningEventListener<TPayload>,
): () => void {
  const entry: SubscriptionEntry = {
    filter: filter ?? null,
    handler: handler as LearningEventListener,
  };
  subscriptions.add(entry);
  return () => {
    subscriptions.delete(entry);
  };
}

export function getHighWaterSeq(): number {
  hydrateFromLocalStorageIfNeeded();
  return highWaterSeq;
}

/**
 * Returns true if any learning event has been committed for `(entityKind, entityId)`
 * strictly after `startedAtSeq`. Used by in-flight queries (e.g., `getDueItems`)
 * to prevent resurrecting stale state.
 */
export function isStaleRelativeTo(
  entityKind: LearningEntityKind | string,
  entityId: string,
  startedAtSeq: number,
): boolean {
  hydrateFromLocalStorageIfNeeded();
  const lastSeq = entityHighWaterSeq.get(entityCompositeKey(entityKind, entityId));
  return lastSeq !== undefined && lastSeq > startedAtSeq;
}

export function getLearningEventById(id: string): LearningEvent | null {
  hydrateFromLocalStorageIfNeeded();
  return eventsById.get(id) ?? null;
}

export function getBufferedLearningEvents(filter?: LearningEventFilter): LearningEvent[] {
  hydrateFromLocalStorageIfNeeded();
  let results = orderedEvents.slice();

  if (!filter?.includeRetracted) {
    results = results.filter((e) => e.retractedByEventId === null);
  }

  if (filter) {
    if (filter.sinceSeq !== undefined) {
      results = results.filter((e) => e.seq > filter.sinceSeq!);
    }
    if (filter.excludeAiExcluded) {
      results = results.filter((e) => !e.isAiExcluded);
    }
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      results = results.filter((e) => filter.eventTypes!.includes(e.eventType));
    }
    if (filter.surfaces && filter.surfaces.length > 0) {
      results = results.filter((e) => filter.surfaces!.includes(e.surface));
    }
    if (filter.entityKind) {
      results = results.filter((e) => e.entityKind === filter.entityKind);
    }
    if (filter.entityId) {
      results = results.filter((e) => e.entityId === filter.entityId);
    }
    if (filter.documentId) {
      results = results.filter((e) => e.documentId === filter.documentId);
    }
    if (filter.sessionId) {
      results = results.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter.goalId) {
      results = results.filter((e) => e.goalId === filter.goalId);
    }
    if (filter.limit !== undefined && filter.limit >= 0) {
      results = results.slice(0, filter.limit);
    }
  }

  return results;
}

/**
 * Maps a LearningSurface to the corresponding `reviewSync.ts` ReviewSyncSource.
 */
export function surfaceToReviewSyncSource(surface: LearningSurface): ReviewSyncSource {
  switch (surface) {
    case "review":
      return "reviewStore";
    case "scroll_mode":
      return "scrollMode";
    case "quick_review":
      return "quickReview";
    case "zen_review":
      return "zenReview";
    default:
      return "unknown";
  }
}

function buildMinimalSyncableItem(
  entityId: string,
  dueDate: string | null | undefined,
  isSuspended: boolean | undefined,
  intervalDays?: number,
  difficulty?: number,
): SyncableLearningItem {
  const nowIso = new Date().toISOString();
  return {
    id: entityId,
    question: "",
    answer: "",
    due_date: dueDate ?? nowIso,
    interval: intervalDays ?? 0,
    ease_factor: 2.5,
    difficulty: difficulty ?? 5,
    review_count: 0,
    lapses: 0,
    state: "Review",
    is_suspended: Boolean(isSuspended),
    tags: [],
    date_created: nowIso,
    date_modified: nowIso,
  };
}

/**
 * Cross-surface bridge: emits a `review_committed` event into `learningEventBus`
 * and reconciles `reviewSync.ts` (queueStore, reviewStore, Scroll Mode, and
 * `recentCommitStates` stale-fetch guard) exactly once per `idempotencyKey`.
 */
export function emitAndReconcileReviewCommitted(params: {
  idempotencyKey: string;
  surface: LearningSurface;
  updatedItem: SyncableLearningItem;
  payload?: ReviewCommittedPayload;
  sessionId?: string | null;
  goalId?: string | null;
  documentId?: string | null;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
  nowMs?: number;
}): {
  eventResult: AppendLearningEventResult<ReviewCommittedPayload>;
  syncEvent: ReviewSyncEvent | null;
} {
  const payload: ReviewCommittedPayload = {
    newDueDate: params.updatedItem.due_date,
    isSuspended: params.updatedItem.is_suspended,
    scheduledDays: params.updatedItem.interval,
    ...params.payload,
  };

  const eventResult = emitLearningEvent<ReviewCommittedPayload>({
    idempotencyKey: params.idempotencyKey,
    eventType: "review_committed",
    surface: params.surface,
    entityKind: "learning_item",
    entityId: params.updatedItem.id,
    sessionId: params.sessionId ?? null,
    goalId: params.goalId ?? null,
    documentId: params.documentId ?? params.updatedItem.document_id ?? null,
    isLocalOnly: params.isLocalOnly,
    isAiExcluded: params.isAiExcluded,
    payload,
  });

  if (!eventResult.inserted) {
    return { eventResult, syncEvent: null };
  }

  const syncEvent = reconcileScheduledReview(params.updatedItem, {
    source: surfaceToReviewSyncSource(params.surface),
    buryExtractId: payload.buryExtractId ?? null,
    nowMs: params.nowMs,
  });

  return { eventResult, syncEvent };
}

/**
 * Cross-surface bridge: emits a `review_undone` compensating event retracting
 * the original `review_committed` event and reconciles `reviewSync.ts`.
 */
export function emitAndReconcileReviewUndone(params: {
  idempotencyKey: string;
  targetEventId: string;
  surface: LearningSurface;
  restoredItem: SyncableLearningItem;
  payload?: ReviewUndonePayload;
  sessionId?: string | null;
  goalId?: string | null;
  documentId?: string | null;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
  nowMs?: number;
}): {
  eventResult: AppendLearningEventResult<ReviewUndonePayload>;
  syncEvent: ReviewSyncEvent | null;
} {
  const payload: ReviewUndonePayload = {
    restoredDueDate: params.restoredItem.due_date,
    restoredState: params.restoredItem.state,
    isSuspended: params.restoredItem.is_suspended,
    ...params.payload,
  };

  const eventResult = retractLearningEvent<ReviewUndonePayload>(params.targetEventId, {
    idempotencyKey: params.idempotencyKey,
    eventType: "review_undone",
    surface: params.surface,
    entityKind: "learning_item",
    entityId: params.restoredItem.id,
    sessionId: params.sessionId ?? null,
    goalId: params.goalId ?? null,
    documentId: params.documentId ?? params.restoredItem.document_id ?? null,
    isLocalOnly: params.isLocalOnly,
    isAiExcluded: params.isAiExcluded,
    payload,
  });

  if (!eventResult.inserted) {
    return { eventResult, syncEvent: null };
  }

  const syncEvent = reconcileReviewUndo(params.restoredItem, {
    source: surfaceToReviewSyncSource(params.surface),
    nowMs: params.nowMs,
  });

  return { eventResult, syncEvent };
}

/**
 * Bridges an incoming committed `review_committed` or `review_undone` event
 * (e.g., from Tauri backend IPC) into `reviewSync.ts`.
 */
export function bridgeCommittedReviewEventToSync(
  event: LearningEvent,
  options?: { nowMs?: number },
): ReviewSyncEvent | null {
  if (event.entityKind !== "learning_item") return null;

  if (event.eventType === "review_committed") {
    const payload = event.payload as ReviewCommittedPayload;
    const item = buildMinimalSyncableItem(
      event.entityId,
      payload.newDueDate,
      payload.isSuspended,
      payload.scheduledDays,
    );
    return reconcileScheduledReview(item, {
      source: surfaceToReviewSyncSource(event.surface),
      buryExtractId: payload.buryExtractId ?? null,
      nowMs: options?.nowMs,
    });
  }

  if (event.eventType === "review_undone") {
    const payload = event.payload as ReviewUndonePayload;
    const item = buildMinimalSyncableItem(
      event.entityId,
      payload.restoredDueDate,
      payload.isSuspended,
    );
    return reconcileReviewUndo(item, {
      source: surfaceToReviewSyncSource(event.surface),
      nowMs: options?.nowMs,
    });
  }

  return null;
}

/**
 * Initializes the Tauri `"learning-event:committed"` listener once per runtime.
 * Incoming events are deduplicated by `idempotencyKey` and bridged into `reviewSync`.
 */
export async function initTauriLearningEventBridge(): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  if (tauriUnlisten) {
    return tauriUnlisten;
  }
  if (!tauriBridgePromise) {
    tauriBridgePromise = listen<LearningEvent>(
      LEARNING_EVENT_COMMITTED_CHANNEL,
      ({ payload }) => {
        if (!payload) return;
        const inserted = publishCommittedLearningEvent(payload);
        if (
          inserted &&
          (payload.eventType === "review_committed" || payload.eventType === "review_undone")
        ) {
          bridgeCommittedReviewEventToSync(payload);
        }
      },
    )
      .then((unlisten) => {
        tauriUnlisten = unlisten;
        return unlisten;
      })
      .catch((error) => {
        tauriBridgePromise = null;
        throw error;
      });
  }
  return tauriBridgePromise;
}

export const learningEventBus = {
  emit: emitLearningEvent,
  publishCommitted: publishCommittedLearningEvent,
  retract: retractLearningEvent,
  subscribe: subscribeLearningEvents,
  getHighWaterSeq,
  isStaleRelativeTo,
  getEventById: getLearningEventById,
  getBufferedEvents: getBufferedLearningEvents,
  initTauriBridge: initTauriLearningEventBridge,
};

/** Test-only helper to clear all in-memory and localStorage event bus state. */
export function _resetLearningEventBusForTests(): void {
  subscriptions.clear();
  eventsByIdempotencyKey.clear();
  eventsById.clear();
  entityHighWaterSeq.clear();
  orderedEvents = [];
  highWaterSeq = 0;
  eventCounter = 0;
  hydratedFromStorage = false;
  if (tauriUnlisten) {
    tauriUnlisten();
    tauriUnlisten = null;
  }
  tauriBridgePromise = null;
  const storage = getLocalStorageSafe();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
