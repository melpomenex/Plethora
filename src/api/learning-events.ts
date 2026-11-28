/**
 * Tauri IPC wrappers for the unified learning event spine (Phase 1A)
 * with clean in-memory / localStorage fallback when running outside Tauri.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import {
  assertLearningEventBoundary,
  bridgeCommittedReviewEventToSync,
  emitLearningEvent,
  getBufferedLearningEvents,
  publishCommittedLearningEvent,
  retractLearningEvent as retractLearningEventOnBus,
} from "../lib/learning-events/learningEventBus";
import type {
  AppendLearningEventInput,
  AppendLearningEventResult,
  LearningEvent,
  LearningEventCheckpoint,
  LearningEventFilter,
} from "../types/learningEvent";

const CHECKPOINT_STORAGE_KEY = "plethora.learning_events.checkpoints_v1";
const fallbackCheckpoints = new Map<string, LearningEventCheckpoint>();
let checkpointsHydrated = false;

function getLocalStorageSafe(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

function hydrateCheckpointsIfNeeded(): void {
  if (checkpointsHydrated || isTauri()) return;
  checkpointsHydrated = true;
  const storage = getLocalStorageSafe();
  if (!storage) return;
  try {
    const raw = storage.getItem(CHECKPOINT_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as LearningEventCheckpoint[];
    if (!Array.isArray(entries)) return;
    for (const cp of entries) {
      if (cp && typeof cp.consumerId === "string") {
        fallbackCheckpoints.set(cp.consumerId, cp);
      }
    }
  } catch {
    // Ignore corrupted cache
  }
}

function persistCheckpoints(): void {
  if (isTauri()) return;
  const storage = getLocalStorageSafe();
  if (!storage) return;
  try {
    storage.setItem(
      CHECKPOINT_STORAGE_KEY,
      JSON.stringify(Array.from(fallbackCheckpoints.values())),
    );
  } catch {
    // Ignore quota errors
  }
}

export async function appendLearningEvent<TPayload = Record<string, unknown>>(
  input: AppendLearningEventInput<TPayload>,
): Promise<AppendLearningEventResult<TPayload>> {
  assertLearningEventBoundary({
    eventType: input.eventType,
    entityKind: input.entityKind,
    surface: input.surface,
    payload: input.payload,
  });

  if (isTauri()) {
    const result = await invokeCommand<AppendLearningEventResult<TPayload>>(
      "append_learning_event",
      { input },
    );
    const newlyPublished = publishCommittedLearningEvent(
      result.event,
      input.retractsEventId,
    );
    if (
      newlyPublished &&
      (result.event.eventType === "review_committed" ||
        result.event.eventType === "review_undone")
    ) {
      bridgeCommittedReviewEventToSync(result.event as LearningEvent);
    }
    return result;
  }

  return emitLearningEvent(input);
}

export async function retractLearningEvent<TPayload = Record<string, unknown>>(
  targetEventId: string,
  input: Omit<AppendLearningEventInput<TPayload>, "retractsEventId">,
): Promise<AppendLearningEventResult<TPayload>> {
  assertLearningEventBoundary({
    eventType: input.eventType,
    entityKind: input.entityKind,
    surface: input.surface,
    payload: input.payload,
  });

  if (isTauri()) {
    const result = await invokeCommand<AppendLearningEventResult<TPayload>>(
      "retract_learning_event",
      {
        targetEventId,
        input: { ...input, retractsEventId: targetEventId },
      },
    );
    const newlyPublished = publishCommittedLearningEvent(result.event, targetEventId);
    if (
      newlyPublished &&
      (result.event.eventType === "review_committed" ||
        result.event.eventType === "review_undone")
    ) {
      bridgeCommittedReviewEventToSync(result.event as LearningEvent);
    }
    return result;
  }

  return retractLearningEventOnBus(targetEventId, input);
}

export async function listLearningEvents(
  filter?: LearningEventFilter,
): Promise<LearningEvent[]> {
  if (isTauri()) {
    return invokeCommand<LearningEvent[]>("list_learning_events", {
      filter: filter ?? {},
    });
  }
  return getBufferedLearningEvents(filter);
}

export async function getLearningEventCheckpoint(
  consumerId: string,
): Promise<LearningEventCheckpoint | null> {
  if (isTauri()) {
    return invokeCommand<LearningEventCheckpoint | null>(
      "get_learning_event_checkpoint",
      { consumerId },
    );
  }
  hydrateCheckpointsIfNeeded();
  return fallbackCheckpoints.get(consumerId) ?? null;
}

export async function advanceLearningEventCheckpoint(
  consumerId: string,
  lastSeq: number,
  policyVersion = "v1",
): Promise<LearningEventCheckpoint> {
  if (isTauri()) {
    return invokeCommand<LearningEventCheckpoint>(
      "advance_learning_event_checkpoint",
      { consumerId, lastSeq, policyVersion },
    );
  }
  hydrateCheckpointsIfNeeded();
  const existing = fallbackCheckpoints.get(consumerId);
  const nextSeq = existing ? Math.max(existing.lastSeq, lastSeq) : lastSeq;
  const checkpoint: LearningEventCheckpoint = {
    consumerId,
    lastSeq: nextSeq,
    policyVersion,
    updatedAt: new Date().toISOString(),
  };
  fallbackCheckpoints.set(consumerId, checkpoint);
  persistCheckpoints();
  return checkpoint;
}

/** Test-only helper to clear browser/test checkpoint fallback state. */
export function _resetLearningEventsApiFallbackForTests(): void {
  fallbackCheckpoints.clear();
  checkpointsHydrated = false;
  const storage = getLocalStorageSafe();
  if (storage) {
    try {
      storage.removeItem(CHECKPOINT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
