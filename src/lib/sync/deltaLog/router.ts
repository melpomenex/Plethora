/**

 Delta-log read-path dispatcher (task 5.4). Feeds decrypted ops pulled from
 the delta log (client.ts::pull, decoded by envelope.ts::decodeOp) into the
 SAME per-domain handlers the Yjs path drives (registered via
 domainRegistry.ts by createReplicatedMap and documentReplication.ts) — this
 is what makes dual-run (design.md §6 P3) a projection no-op rather than a
 second code path: both transports ultimately call the identical handler.

 An op with no registered handler for its domain is durably deferred into
 `sync_inbox` rather than dropped or thrown: one unrecognized domain (e.g. a
 newer app version wrote a domain this build doesn't know about yet) must
 not stall the whole page, but neither may it be lost — the pull loop
 advances the room cursor past every applied page, so a dropped op is never
 re-delivered. Deferred rows are retried after each page and on every boot.

*/

import type { SubKeys } from "../encryption";
import type { DeltaLogOpRow } from "./client";
import { decodeOp } from "./envelope";
import { getDomainHandler } from "./domainRegistry";
import { measureSyncPhase } from "../syncTelemetry";
import { invokeCommand, isTauri } from "../../tauri";
import type { JournalRow } from "../syncJournal";

/**
 * Reconstruct the value shape a domain handler expects: a tombstone object
 * for kind=1 (matching what tombstone.ts::writeTombstone produces), or the
 * row itself for kind=0 (upsert) / kind=2 (append). `hlc` doubles as
 * `deletedAt` for tombstones — the same clock string either transport uses.
 */
function toHandlerValue(kind: DeltaLogOpRow["kind"], hlc: string, row: unknown): unknown {
  if (kind === 1) {
    return { _deleted: true, deletedAt: hlc };
  }
  return row;
}

/**
 * Reserved control-plane domains. `__`-prefixed domains carry protocol state
 * (P4 verify digests) that the publisher reads back itself; they are never
 * projected into SQLite and so must never be deferred for a handler that will
 * not exist.
 */
function isInternalDomain(domain: string): boolean {
  return domain.startsWith("__");
}

function operationName(kind: DeltaLogOpRow["kind"]): JournalRow["operation"] {
  return kind === 1 ? "delete" : kind === 2 ? "append" : "upsert";
}

/**
 * Persist a failed projection before its server cursor is allowed to advance.
 * The id is stable across replays and server seq re-issuance: equal-HLC
 * upserts are the same logical operation even if compaction moves their seq.
 */
async function deferFailedProjection(args: {
  domain: string;
  entityKey: string;
  hlc: string;
  operation: JournalRow["operation"];
  value: unknown;
}): Promise<void> {
  if (!isTauri()) throw new Error("cannot durably defer a delta-log projection outside Tauri");
  await invokeCommand("record_sync_inbox", {
    operationId: `delta:${args.domain}:${args.entityKey}:${args.hlc}`,
    domain: args.domain,
    entityKey: args.entityKey,
    operation: args.operation,
    payload: JSON.stringify(args.value),
  });
}

/**
 * Retry delta-log rows previously deferred after a projection failure. Rows
 * stay pending until their handler succeeds; this is what lets a child row in
 * an earlier page wait safely for a parent document in a later page/boot.
 */
export async function replayPendingDeltaLogInbox(limit = 500): Promise<{ applied: number; pending: number }> {
  if (!isTauri()) return { applied: 0, pending: 0 };
  const result = await invokeCommand<JournalRow[] | null>("get_pending_sync_inbox", {
    limit: Math.min(500, Math.max(1, limit)),
  });
  const rows = Array.isArray(result) ? result : [];
  let applied = 0;
  let pending = 0;
  for (const row of rows) {
    const handler = getDomainHandler(row.domain);
    if (!handler) {
      pending += 1;
      continue;
    }
    try {
      const value = row.payload == null ? null : JSON.parse(row.payload);
      await measureSyncPhase("delta-log-projection", () =>
        handler(row.entity_key, value),
      );
      await invokeCommand("mark_sync_inbox_applied", {
        operationId: row.operation_id,
        domain: row.domain,
        entityKey: row.entity_key,
        projectionHash: null,
      });
      applied += 1;
    } catch (err) {
      pending += 1;
      console.warn(
        `[deltaLog:router] deferred handler for domain "${row.domain}" still failed`,
        row.entity_key,
        err,
      );
    }
  }
  return { applied, pending };
}

export async function applyDeltaLogPage(ops: DeltaLogOpRow[], subKeys: SubKeys): Promise<void> {
  for (const op of ops) {
    let decoded: Awaited<ReturnType<typeof decodeOp>>;
    try {
      decoded = await decodeOp(op, subKeys);
    } catch (err) {
      console.warn("[deltaLog:router] failed to decode op, skipping", op.seq, err);
      continue;
    }
    const handler = getDomainHandler(decoded.domain);
    if (!handler && isInternalDomain(decoded.domain)) {
      // Control-plane ops (currently `__verify` digests, cutover.ts) are read
      // directly by the code that publishes them, never projected. They must
      // NOT be deferred — there is no handler to wait for, so they would pile
      // up in sync_inbox and be re-tried after every page forever.
      continue;
    }
    if (!handler) {
      // Dropping here used to be permanent data loss: the pull loop advances
      // the room cursor once the page is applied, so an op skipped for want of
      // a handler is never delivered again. A domain whose module had not yet
      // been imported when the first pull ran (documents, most notably) lost
      // its entire history that way, with nothing in sync_inbox to show for
      // it. Defer durably instead — replayPendingDeltaLogInbox retries after
      // every page and on every boot, and leaves genuinely unknown domains
      // pending rather than stalling the page.
      try {
        await deferFailedProjection({
          domain: decoded.domain,
          entityKey: decoded.entityKey,
          hlc: decoded.hlc,
          operation: operationName(decoded.kind),
          value: toHandlerValue(decoded.kind, decoded.hlc, decoded.row),
        });
        console.warn(
          `[deltaLog:router] no handler registered for domain "${decoded.domain}"; deferred for retry`,
          op.seq,
        );
      } catch (err) {
        console.warn(
          `[deltaLog:router] no handler for domain "${decoded.domain}" and deferral failed; op dropped`,
          op.seq,
          err,
        );
      }
      continue;
    }
    try {
      await measureSyncPhase("delta-log-projection", () =>
        handler(decoded.entityKey, toHandlerValue(decoded.kind, decoded.hlc, decoded.row)),
      );
    } catch (err) {
      const value = toHandlerValue(decoded.kind, decoded.hlc, decoded.row);
      // Do not lose the row by advancing the room cursor past it. Once this
      // durable insert succeeds the page may continue; replay below (and on
      // every boot) retries after other domains/parents have been projected.
      await deferFailedProjection({
        domain: decoded.domain,
        entityKey: decoded.entityKey,
        hlc: decoded.hlc,
        operation: operationName(decoded.kind),
        value,
      });
      console.warn(
        `[deltaLog:router] handler for domain "${decoded.domain}" failed; deferred for retry`,
        decoded.entityKey,
        err,
      );
    }
  }
  await replayPendingDeltaLogInbox();
}
