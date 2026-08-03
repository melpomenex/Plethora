/**

 Wires drainSyncOutboxBatch (src/lib/sync/syncJournal.ts) to the delta-log
 transport (task 4.4), reusing its existing per-domain publisher registry
 rather than changing syncJournal.ts itself — the outbox already models
 attempts/status/dead-lettering generically; publishing is the only part
 that's transport-specific.

*/

import { registerSyncOutboxPublisher, type JournalRow } from "../syncJournal";
import type { SubKeys } from "../encryption";
import { buildOp } from "./envelope";
import { push, type DeltaLogClientConfig } from "./client";
import { measureSyncPhase } from "../syncTelemetry";

type OutboxRow = JournalRow & { clock: string };

/**
 * Register a delta-log publisher for each given domain. Returns a single
 * function that unregisters all of them (e.g. on room switch or when
 * deltaLogSync is toggled off).
 */
export function registerDeltaLogOutboxPublishers(
  domains: string[],
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
): () => void {
  const unregisterFns = domains.map((domain) =>
    registerSyncOutboxPublisher(domain, async (row: OutboxRow, payload: unknown | null) => {
      await measureSyncPhase("delta-log-push-drain", async () => {
        const op = await buildOp(
          { domain: row.domain, entityKey: row.entity_key, operation: row.operation, row: payload },
          row.clock,
          subKeys,
        );
        await push(config, [op]);
      });
    }),
  );
  return () => {
    for (const unregister of unregisterFns) unregister();
  };
}
