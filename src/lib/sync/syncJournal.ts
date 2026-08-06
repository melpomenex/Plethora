import { invokeCommand, isTauri } from "../tauri";
import { isSyncPayloadSafe } from "./syncPrivacy";
import { getSyncFeatureFlags } from "./featureFlags";
import { isYjsSyncEnabled } from "../yjsSync";

export type SyncOperationKind = "upsert" | "delete" | "append" | "review";

export interface SyncOutboxOperation {
  operationId: string;
  domain: string;
  entityKey: string;
  operation: SyncOperationKind;
  payload: unknown | null;
  clock: string;
  payloadHash?: string | null;
}

export interface SyncInboxOperation {
  operationId: string;
  domain: string;
  entityKey: string;
  operation: SyncOperationKind;
  payload: unknown | null;
}

function operationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function payloadString(payload: unknown): string | null {
  if (payload == null) return null;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

async function invokeOrNull<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    console.warn(`[sync-journal] ${command} failed`, error);
    return null;
  }
}

/** Enqueue a local operation; callers never need to wait for the relay. */
export async function enqueueSyncOperation(
  operation: Omit<SyncOutboxOperation, "operationId"> & { operationId?: string },
): Promise<string | null> {
  // The outbox is also the delta-log write path: the cutover seed phase (P2)
  // enqueues its rows here, and delta-log outbox publishers turn them into
  // POST /ops pushes. So the gate is journaled projection OR an active
  // delta-log cutover — otherwise a room opted into delta-log without the
  // older journaled-projection flag would silently drop every seed row.
  const flags = getSyncFeatureFlags();
  if (!flags.journaledProjection && !flags.deltaLogSync) return null;
  const id = operation.operationId ?? operationId();
  if (operation.payload != null && !isSyncPayloadSafe(operation.payload)) {
    console.warn(`[sync-journal] rejected unsafe payload for ${operation.domain}`);
    return null;
  }
  const payload = payloadString(operation.payload);
  const row = await invokeOrNull("enqueue_sync_outbox", {
    operationId: id,
    domain: operation.domain,
    entityKey: operation.entityKey,
    operation: operation.operation,
    payload,
    clock: operation.clock,
    payloadHash: operation.payloadHash ?? null,
  });
  return row ? id : null;
}

/**
 * Shared write-path helper. The local mutation completes first so offline use
 * is never blocked. A failed enqueue is observable to the caller, while an
 * optional compensator is reserved for callers whose local write cannot be
 * safely left pending.
 */
export async function commitLocalMutationWithSync<T>(args: {
  mutate: () => Promise<T>;
  operation: Omit<SyncOutboxOperation, "operationId"> & { operationId?: string };
  compensate?: (result: T) => Promise<void>;
}): Promise<T> {
  const result = await args.mutate();
  try {
    await enqueueSyncOperation(args.operation);
  } catch (error) {
    if (args.compensate) await args.compensate(result).catch(() => undefined);
    console.warn("[sync-journal] enqueue failed after local mutation", error);
  }
  return result;
}

export async function getPendingOutbox(limit = 100): Promise<unknown[]> {
  return (await invokeOrNull<unknown[]>("get_sync_outbox", { limit })) ?? [];
}

export async function markOutboxSent(operationIds: string[]): Promise<number> {
  return (await invokeOrNull<number>("mark_sync_outbox_sent", { operationIds })) ?? 0;
}

/** Insert into the inbox with operation-id deduplication. */
export async function recordIncomingSyncOperation(operation: SyncInboxOperation): Promise<boolean> {
  const inserted = await invokeOrNull<boolean>("record_sync_inbox", {
    operationId: operation.operationId,
    domain: operation.domain,
    entityKey: operation.entityKey,
    operation: operation.operation,
    payload: payloadString(operation.payload),
  });
  return inserted === true;
}

export async function getPendingInbox(limit = 100): Promise<unknown[]> {
  return (await invokeOrNull<unknown[]>("get_pending_sync_inbox", { limit })) ?? [];
}

export async function markIncomingApplied(args: {
  operationId: string;
  domain: string;
  entityKey: string;
  projectionHash?: string | null;
}): Promise<boolean> {
  return (await invokeOrNull<boolean>("mark_sync_inbox_applied", args)) === true;
}

export async function getSyncCheckpoint(domain: string): Promise<unknown | null> {
  return invokeOrNull("get_sync_checkpoint", { domain });
}

export async function setSyncCheckpoint(args: {
  domain: string;
  cursor?: string | null;
  shard?: string | null;
}): Promise<unknown | null> {
  return invokeOrNull("set_sync_checkpoint", args);
}

interface RawCutoverStateRow {
  room: string;
  phase: string;
  updated_at: string;
}

export async function getSyncCutoverState(room: string): Promise<{ room: string; phase: string; updatedAt: string } | null> {
  const row = await invokeOrNull<RawCutoverStateRow>("get_sync_cutover_state", { room });
  return row ? { room: row.room, phase: row.phase, updatedAt: row.updated_at } : null;
}

export async function setSyncCutoverState(
  room: string,
  phase: string,
): Promise<{ room: string; phase: string; updatedAt: string } | null> {
  const row = await invokeOrNull<RawCutoverStateRow>("set_sync_cutover_state", { room, phase });
  return row ? { room: row.room, phase: row.phase, updatedAt: row.updated_at } : null;
}

interface RawCutoverDomainProgressRow {
  room: string;
  domain: string;
  drained_count: number;
  seeded_count: number;
  updated_at: string;
}

export async function recordSyncCutoverDomainProgress(args: {
  room: string;
  domain: string;
  drainedDelta?: number;
  seededDelta?: number;
}): Promise<{ domain: string; drainedCount: number; seededCount: number } | null> {
  const row = await invokeOrNull<RawCutoverDomainProgressRow>("record_sync_cutover_domain_progress", {
    room: args.room,
    domain: args.domain,
    drainedDelta: args.drainedDelta ?? 0,
    seededDelta: args.seededDelta ?? 0,
  });
  return row ? { domain: row.domain, drainedCount: row.drained_count, seededCount: row.seeded_count } : null;
}

export async function getSyncCutoverDomainProgress(
  room: string,
): Promise<Array<{ domain: string; drainedCount: number; seededCount: number; updatedAt: string }>> {
  const rows = (await invokeOrNull<RawCutoverDomainProgressRow[]>("get_sync_cutover_domain_progress", { room })) ?? [];
  return rows.map((row) => ({
    domain: row.domain,
    drainedCount: row.drained_count,
    seededCount: row.seeded_count,
    updatedAt: row.updated_at,
  }));
}

export async function countSyncDeadLettersSince(sinceIso: string): Promise<number> {
  return (await invokeOrNull<number>("count_sync_dead_letters_since", { since: sinceIso })) ?? 0;
}

export async function deadLetterSyncOperation(args: {
  operationId: string;
  domain: string;
  payload?: unknown;
  error: string;
}): Promise<void> {
  await invokeOrNull("dead_letter_sync_operation", {
    ...args,
    payload: payloadString(args.payload),
  });
}

export interface JournalRow {
  operation_id: string;
  domain: string;
  entity_key: string;
  operation: SyncOperationKind;
  payload: string | null;
}

type OutboxRow = JournalRow & { clock: string; payload_hash?: string | null };
type OutboxPublisher = (row: OutboxRow, payload: unknown | null) => Promise<void>;
// Fan-out, not single-slot (task 6.4): during P3 dual-run, a domain needs
// BOTH its Yjs mirror publisher (registered by createReplicatedMap) and its
// delta-log publisher (registered by deltaLog/outboxPublisher.ts) active at
// once. A single-publisher-per-domain map would let the second registration
// silently replace the first, breaking one transport without any error.
const outboxPublishers = new Map<string, Set<OutboxPublisher>>();

export function registerSyncOutboxPublisher(domain: string, publisher: OutboxPublisher): () => void {
  let set = outboxPublishers.get(domain);
  if (!set) {
    set = new Set();
    outboxPublishers.set(domain, set);
  }
  set.add(publisher);
  return () => {
    set!.delete(publisher);
    if (set!.size === 0) outboxPublishers.delete(domain);
  };
}

/**
 * Drain a bounded outbox batch. Unknown domains remain pending for a newer
 * adapter. A row is marked sent only once EVERY registered publisher for
 * its domain has succeeded (dual-run: a row that reached Yjs but failed to
 * reach the delta log must stay pending and retry, not be dropped as if
 * fully delivered).
 */
export async function drainSyncOutboxBatch(limit = 50): Promise<{ sent: number; deferred: number; failed: number }> {
  if (!isYjsSyncEnabled()) {
    return { sent: 0, deferred: 0, failed: 0 };
  }
  const rows = (await getPendingOutbox(Math.min(100, Math.max(1, limit)))) as OutboxRow[];
  const sentIds: string[] = [];
  let deferred = 0;
  let failed = 0;
  for (const row of rows) {
    const publishers = outboxPublishers.get(row.domain);
    if (!publishers || publishers.size === 0) {
      deferred += 1;
      continue;
    }
    try {
      const payload = row.payload == null ? null : JSON.parse(row.payload);
      await Promise.all(Array.from(publishers, (publisher) => publisher(row, payload)));
      sentIds.push(row.operation_id);
    } catch (error) {
      failed += 1;
      await deadLetterSyncOperation({
        operationId: row.operation_id,
        domain: row.domain,
        payload: row.payload,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (sentIds.length) await markOutboxSent(sentIds);
  return { sent: sentIds.length, deferred, failed };
}

/**
 * Apply a bounded inbox batch. The projection callback is intentionally
 * idempotent; the applied-operation marker is written only after it succeeds.
 * If the app dies between those two calls, the callback is replayed safely.
 */
export async function projectInboxBatch(
  apply: (row: JournalRow, payload: unknown | null) => Promise<void>,
  limit = 50,
): Promise<{ applied: number; failed: number }> {
  const rows = (await getPendingInbox(Math.min(100, Math.max(1, limit)))) as JournalRow[];
  let applied = 0;
  let failed = 0;
  for (const row of rows) {
    let payload: unknown | null = null;
    try {
      payload = row.payload == null ? null : JSON.parse(row.payload);
      await apply(row, payload);
      await markIncomingApplied({
        operationId: row.operation_id,
        domain: row.domain,
        entityKey: row.entity_key,
      });
      applied += 1;
    } catch (error) {
      failed += 1;
      await deadLetterSyncOperation({
        operationId: row.operation_id,
        domain: row.domain,
        payload,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Give the scheduler a chance to service input between projection rows.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { applied, failed };
}

export const __syncJournalTest = { payloadString, operationId };
