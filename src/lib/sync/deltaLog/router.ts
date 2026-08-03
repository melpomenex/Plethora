/**

 Delta-log read-path dispatcher (task 5.4). Feeds decrypted ops pulled from
 the delta log (client.ts::pull, decoded by envelope.ts::decodeOp) into the
 SAME per-domain handlers the Yjs path drives (registered via
 domainRegistry.ts by createReplicatedMap and documentReplication.ts) — this
 is what makes dual-run (design.md §6 P3) a projection no-op rather than a
 second code path: both transports ultimately call the identical handler.

 An op with no registered handler for its domain is dropped with a warning
 rather than thrown — one unrecognized domain (e.g. a newer app version
 wrote a domain this build doesn't know about yet) must not stall the whole
 page.

*/

import type { SubKeys } from "../encryption";
import type { DeltaLogOpRow } from "./client";
import { decodeOp } from "./envelope";
import { getDomainHandler } from "./domainRegistry";
import { measureSyncPhase } from "../syncTelemetry";

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
    if (!handler) {
      console.warn(`[deltaLog:router] no handler registered for domain "${decoded.domain}", dropping op`, op.seq);
      continue;
    }
    try {
      await measureSyncPhase("delta-log-projection", () =>
        handler(decoded.entityKey, toHandlerValue(decoded.kind, decoded.hlc, decoded.row)),
      );
    } catch (err) {
      console.warn(`[deltaLog:router] handler for domain "${decoded.domain}" failed`, decoded.entityKey, err);
    }
  }
}
