import { invokeCommand, isTauri } from "../tauri";
import { isSyncPayloadSafe } from "./syncPrivacy";
import { getSyncFeatureFlags } from "./featureFlags";

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
  if (!getSyncFeatureFlags().journaledProjection) return null;
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
const outboxPublishers = new Map<string, (row: OutboxRow, payload: unknown | null) => Promise<void>>();

export function registerSyncOutboxPublisher(
  domain: string,
  publisher: (row: OutboxRow, payload: unknown | null) => Promise<void>,
): () => void {
  outboxPublishers.set(domain, publisher);
  return () => {
    if (outboxPublishers.get(domain) === publisher) outboxPublishers.delete(domain);
  };
}

/** Drain a bounded outbox batch. Unknown domains remain pending for a newer adapter. */
export async function drainSyncOutboxBatch(limit = 50): Promise<{ sent: number; deferred: number; failed: number }> {
  const rows = (await getPendingOutbox(Math.min(100, Math.max(1, limit)))) as OutboxRow[];
  const sentIds: string[] = [];
  let deferred = 0;
  let failed = 0;
  for (const row of rows) {
    const publisher = outboxPublishers.get(row.domain);
    if (!publisher) {
      deferred += 1;
      continue;
    }
    try {
      const payload = row.payload == null ? null : JSON.parse(row.payload);
      await publisher(row, payload);
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
