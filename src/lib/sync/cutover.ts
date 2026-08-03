export interface DomainCutover {
  domain: string;
  schemaVersion: number;
  shardEpoch: number;
  parityHash: string;
  verifiedAt: string;
  legacyFallbackUntil: string;
}

export function canPreferShard(marker: DomainCutover, now = Date.now()): boolean {
  return marker.schemaVersion > 0 && Boolean(marker.parityHash) && now <= Date.parse(marker.legacyFallbackUntil);
}

/**
 * ---------------------------------------------------------------------
 * migrate-sync-to-delta-log cutover phase machine (design.md §6, task 6.1).
 *
 * Unrelated to DomainCutover/canPreferShard above (an older, separate
 * "sharded rooms" migration) — this section covers the Yjs -> delta-log
 * transport migration and shares this file only because task 6.1 names it
 * explicitly. State is persisted client-side, one row per room in
 * `sync_cutover_state` (migration 068), via the get/setSyncCutoverState
 * wrappers in syncJournal.ts.
 * ---------------------------------------------------------------------
 */

import {
  getSyncCutoverState,
  setSyncCutoverState,
  recordSyncCutoverDomainProgress,
  getSyncCutoverDomainProgress,
  countSyncDeadLettersSince,
} from "./syncJournal";
import { sha256, type SubKeys } from "./encryption";
import { nowHLC } from "./syncClock";
import { push, type DeltaLogClientConfig } from "./deltaLog/client";
import { buildOp } from "./deltaLog/envelope";
import { registerDeltaLogOutboxPublishers } from "./deltaLog/outboxPublisher";
import { setYjsPublishSuppressed } from "./deltaLog/yjsPublishGate";

export type CutoverPhase =
  | "not_started"
  | "drained"
  | "seeded"
  | "dual"
  | "verified"
  | "cutover"
  | "quiesced"
  | "retired";

const PHASE_ORDER: CutoverPhase[] = [
  "not_started",
  "drained",
  "seeded",
  "dual",
  "verified",
  "cutover",
  "quiesced",
  "retired",
];

/** Phases advance one step at a time — never skip ahead, never skip a gate. */
export function canAdvancePhase(from: CutoverPhase, to: CutoverPhase): boolean {
  const fromIdx = PHASE_ORDER.indexOf(from);
  const toIdx = PHASE_ORDER.indexOf(to);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

export async function getCutoverPhase(room: string): Promise<CutoverPhase> {
  const state = await getSyncCutoverState(room);
  return (state?.phase as CutoverPhase | undefined) ?? "not_started";
}

export async function advanceCutoverPhase(room: string, to: CutoverPhase): Promise<CutoverPhase> {
  const current = await getCutoverPhase(room);
  if (!canAdvancePhase(current, to)) {
    throw new Error(`cutover: cannot advance from "${current}" to "${to}" (one step at a time)`);
  }
  const result = await setSyncCutoverState(room, to);
  return (result?.phase as CutoverPhase | undefined) ?? to;
}

/**
 * Rollback safety (task 6.8). design.md §6: "Reverting to deltaLogSync:
 * false is safe at any phase before P7 because SQLite is untouched by
 * transport choice ... and no Yjs data is deleted before P7." Nothing in
 * this module (or the drain/seed functions below) ever deletes Yjs data —
 * only retireYjs() (P7, task 6.7) does, gated on explicit confirmation — so
 * "safe to roll back" reduces to "not yet retired".
 */
export function isRollbackSafe(phase: CutoverPhase): boolean {
  return phase !== "retired";
}

// --- P1 drain (task 6.2) ---------------------------------------------------

export interface DrainTarget {
  domain: string;
  /** Triggers the existing createReplicatedMap/documentReplication init+replay path for this domain (idempotent — safe to call even if already initialized). */
  ensureReady: () => Promise<void>;
  /** Number of live entries this domain's shared map currently holds (diagnostic only, not a completeness gate by itself). */
  count: () => number;
}

export interface SchedulerStats {
  queued: number;
  running: boolean;
}

export interface DrainResult {
  /** "drained" only if the gate passed and the phase actually advanced. Otherwise "retry" — call again next boot, per design.md §6's drain-completeness rule. */
  outcome: "drained" | "retry";
  perDomainCounts: Record<string, number>;
  deadLetterCount: number;
  quiesced: boolean;
}

/**
 * P1 DRAIN: every domain's existing Yjs replay path has already enqueued
 * (or will enqueue, via ensureReady) a scheduler task per map entry — this
 * function's job is to wait for that to fully settle and gate the phase
 * transition on it, not to re-implement the replay itself. Advances to
 * "drained" only when every domain enumerated (ensureReady resolved),
 * every enqueued task drained (scheduler idle), and zero dead-letter rows
 * were recorded during the window; otherwise leaves the phase unchanged so
 * the caller retries next boot (design.md §6: "the phase stays at
 * drained=false and retries next boot rather than proceeding").
 */
export async function runDrainPhase(
  room: string,
  targets: DrainTarget[],
  getSchedulerStats: () => SchedulerStats,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<DrainResult> {
  const startedAt = new Date().toISOString();
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Every map enumerated: ensureReady() is what triggers (or confirms
  // already-triggered) the full forEach replay of existing entries.
  await Promise.all(targets.map((t) => t.ensureReady()));

  // Every enqueued task drained: poll the scheduler until idle or timeout.
  const deadline = Date.now() + timeoutMs;
  let quiesced = false;
  do {
    const stats = getSchedulerStats();
    quiesced = stats.queued === 0 && !stats.running;
    if (quiesced) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);

  const deadLetterCount = await countSyncDeadLettersSince(startedAt);

  const perDomainCounts: Record<string, number> = {};
  for (const target of targets) {
    const count = target.count();
    perDomainCounts[target.domain] = count;
    await recordSyncCutoverDomainProgress({ room, domain: target.domain, drainedDelta: count });
  }

  if (!quiesced || deadLetterCount > 0) {
    return { outcome: "retry", perDomainCounts, deadLetterCount, quiesced };
  }

  await advanceCutoverPhase(room, "drained");
  return { outcome: "drained", perDomainCounts, deadLetterCount, quiesced };
}

// --- P2 seed (task 6.3) -----------------------------------------------------

export interface SeedRow {
  entityKey: string;
  /** The row's EXISTING hlc, carried verbatim — never re-stamped. This is what makes seeding idempotent and order-independent (design.md §6). */
  hlc: string;
  operation: "upsert" | "delete" | "append";
  payload: unknown;
}

export interface SeedTarget {
  domain: string;
  /** Read every synced row for this domain from SQLite (the ONLY seed source — never the Yjs document). Must include each row's existing hlc verbatim. */
  readAllRows: () => Promise<SeedRow[]>;
}

export interface SeedResult {
  perDomainCounts: Record<string, number>;
}

/**
 * P2 SEED: enqueue an outbox op per SQLite row, carrying its existing hlc
 * verbatim. Idempotent by construction — re-running enqueues the same
 * (entityKey, hlc) pairs, and the server's LWW upsert (`WHERE excluded.hlc
 * > ops.hlc`) makes a re-seed with an unchanged hlc a no-op; a partially
 * completed seed is therefore a correct prefix, not a corrupt state (no
 * seeded row can ever move backwards). Requires deltaLogSync's outbox
 * publisher to already be registered for every domain (task 4.4) — this
 * function only enqueues, it does not push directly.
 */
export async function runSeedPhase(room: string, targets: SeedTarget[], enqueue: SeedEnqueue): Promise<SeedResult> {
  const perDomainCounts: Record<string, number> = {};
  for (const target of targets) {
    const rows = await target.readAllRows();
    for (const row of rows) {
      await enqueue({
        domain: target.domain,
        entityKey: row.entityKey,
        operation: row.operation,
        payload: row.payload,
        clock: row.hlc,
      });
    }
    perDomainCounts[target.domain] = rows.length;
    await recordSyncCutoverDomainProgress({ room, domain: target.domain, seededDelta: rows.length });
  }
  await advanceCutoverPhase(room, "seeded");
  return { perDomainCounts };
}

export type SeedEnqueue = (op: {
  domain: string;
  entityKey: string;
  operation: "upsert" | "delete" | "append";
  payload: unknown;
  clock: string;
}) => Promise<unknown>;

// --- P3 dual-run (task 6.4) -------------------------------------------------

/**
 * P3 DUAL-RUN: publish every mutation to both transports, read from both.
 *
 * The write side is fan-out through the outbox publisher registry
 * (syncJournal.ts's registerSyncOutboxPublisher now supports multiple
 * publishers per domain, precisely so the Yjs mirror publisher
 * createReplicatedMap already registers and the delta-log publisher
 * registered here can coexist). The read side needs no new code at all:
 * Yjs's map.observe and the delta-log router both dispatch through the SAME
 * domain-registry handler (task 5.4) sharing one projector instance, so a
 * row delivered by both transports is applied once — appliedClocks already
 * makes the second delivery a no-op (proved directly in
 * deltaLog.router.test.ts's dual-run test).
 */
export async function startDualRun(
  room: string,
  domains: string[],
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
): Promise<() => void> {
  const unregister = registerDeltaLogOutboxPublishers(domains, config, subKeys);
  await advanceCutoverPhase(room, "dual");
  return unregister;
}

// --- P4 verify (task 6.5) ---------------------------------------------------

export interface DigestRow {
  entityKey: string;
  hlc: string;
}

/** SHA-256 over sorted "entityKey:hlc" pairs — order-independent, so two devices with the same live set produce the same digest regardless of local enumeration order. */
export async function computeDomainDigest(rows: DigestRow[]): Promise<string> {
  const sorted = [...rows].sort((a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0));
  const material = sorted.map((r) => `${r.entityKey}:${r.hlc}`).join("\n");
  const bytes = await sha256(new TextEncoder().encode(material));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Publish this device's digest for a domain as an append-only op on the log
 * (design.md §6: "published to the log so peers can compare"), keyed by
 * device so each device's most recent digest per domain is independently
 * retrievable. Uses the ordinary op transport, not a side channel — the
 * digest is just another encrypted row from the server's point of view.
 */
export async function publishDomainDigest(
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
  deviceTag: string,
  domain: string,
  digest: string,
): Promise<void> {
  const op = await buildOp(
    { domain: "__verify", entityKey: `${domain}:${deviceTag}`, operation: "append", row: { digest } },
    nowHLC(),
    subKeys,
  );
  await push(config, [op]);
}

export interface ConvergenceResult {
  converged: boolean;
  allRosterDevicesCheckedIn: boolean;
  /** Devices in the roster with no digest for this domain yet. */
  missingDigests: string[];
  /** Devices whose digest disagrees with this device's own. */
  disagreeing: string[];
}

/**
 * P4's gate: "Converged + all roster devices checked in ⇒ surface cutover
 * as available." `otherDigests` is keyed by deviceTag (already pulled and
 * decoded by the caller from the `__verify` domain's ops); `rosterDeviceTags`
 * comes from GET /head's device list.
 */
export function checkDomainConvergence(
  ownDigest: string,
  otherDigests: Map<string, string>,
  rosterDeviceTags: string[],
  ownDeviceTag: string,
): ConvergenceResult {
  const missingDigests: string[] = [];
  const disagreeing: string[] = [];
  for (const deviceTag of rosterDeviceTags) {
    if (deviceTag === ownDeviceTag) continue;
    const digest = otherDigests.get(deviceTag);
    if (digest === undefined) {
      missingDigests.push(deviceTag);
    } else if (digest !== ownDigest) {
      disagreeing.push(deviceTag);
    }
  }
  const allRosterDevicesCheckedIn = missingDigests.length === 0;
  const converged = allRosterDevicesCheckedIn && disagreeing.length === 0;
  return { converged, allRosterDevicesCheckedIn, missingDigests, disagreeing };
}

/**
 * Run P4 for every domain and, if every domain converges, advance the phase
 * to "verified". Returns per-domain results either way so the UI (Phase 7)
 * can show exactly what's blocking convergence.
 */
export async function runVerifyPhase(
  room: string,
  perDomainConvergence: Record<string, ConvergenceResult>,
): Promise<{ allConverged: boolean; perDomainConvergence: Record<string, ConvergenceResult> }> {
  const allConverged = Object.values(perDomainConvergence).every((r) => r.converged);
  if (allConverged) {
    await advanceCutoverPhase(room, "verified");
  }
  return { allConverged, perDomainConvergence };
}

// --- P5/P6 cutover + quiesce (task 6.6) ------------------------------------

/**
 * P5 CUTOVER: stop publishing to Yjs, keep reading it (yjsPublishGate — see
 * that module for why suppression is global rather than per-domain).
 */
export async function runCutoverPhase(room: string): Promise<void> {
  setYjsPublishSuppressed(true);
  await advanceCutoverPhase(room, "cutover");
}

const QUIESCE_DAYS = 14;

/**
 * P6 QUIESCE: "≥14 days with no Yjs-only rows observed." Exact attribution
 * of "did this row ALSO arrive via delta-log" would need cross-transport
 * correlation this module doesn't have; instead treat every Yjs-delivered,
 * non-stale remote value as "Yjs activity" — a conservative proxy that only
 * ever OVER-counts recent activity (delaying quiesce), never under-counts
 * it (never falsely declaring quiet when a peer is still Yjs-only).
 * `recordYjsActivity` is meant to be called from the Yjs read path
 * (map.observe) whenever it actually applies something new.
 */
export async function recordYjsActivity(room: string): Promise<void> {
  await recordSyncCutoverDomainProgress({ room, domain: "__yjs-activity", drainedDelta: 0, seededDelta: 0 });
  // recordSyncCutoverDomainProgress's updated_at column (set unconditionally
  // on every call, delta or not) is what quiesce checks below — the delta
  // counters aren't meaningful for this synthetic "domain".
}

export async function daysSinceLastYjsActivity(room: string): Promise<number> {
  const rows = await getSyncCutoverDomainProgress(room);
  const activity = rows.find((r) => r.domain === "__yjs-activity");
  if (!activity) return Infinity; // never recorded -> as quiesced as it gets
  const ms = Date.now() - Date.parse(activity.updatedAt);
  return ms / (24 * 60 * 60 * 1000);
}

export async function runQuiescePhase(room: string): Promise<{ quiesced: boolean; daysSinceActivity: number }> {
  const days = await daysSinceLastYjsActivity(room);
  if (days >= QUIESCE_DAYS) {
    await advanceCutoverPhase(room, "quiesced");
    return { quiesced: true, daysSinceActivity: days };
  }
  return { quiesced: false, daysSinceActivity: days };
}

// --- P7 retire (task 6.7) ---------------------------------------------------

export interface RetireOptions {
  /**
   * Caller (Phase 7 UI) must have already obtained explicit user
   * confirmation AND triggered a backup (backup_create, see
   * BackupRestorePanel.tsx) before calling this. retireYjs() enforces the
   * gate structurally — it refuses to run without it — but does not own
   * the confirmation UI or the backup call itself.
   */
  userConfirmed: boolean;
  backedUp: boolean;
  /** Deletes an IndexedDB database by name. Injected so this stays testable without a real IndexedDB. */
  deleteIndexedDb: (name: string) => Promise<void>;
  /** Names of this device's `incrementum-yjs:*` IndexedDB databases to drop. */
  yjsIndexedDbNames: string[];
}

/**
 * P7 RETIRE: disable Yjs and drop its local IndexedDB. The only irreversible
 * step in the whole migration (design.md §6) — gated on explicit
 * confirmation and a completed backup, never called automatically.
 *
 * "request frame-log deletion" (the relay's server-side ciphertext log) is
 * intentionally NOT done here: the relay has no delete-by-room endpoint
 * (frameLog.js is filesystem-only, no HTTP surface), and Phase 9 removes
 * the entire relay service and its persisted logs wholesale — adding a
 * single-room delete endpoint to a service being deleted in the same
 * change would be dead code within days of shipping.
 */
export async function retireYjs(room: string, options: RetireOptions): Promise<void> {
  if (!options.userConfirmed) {
    throw new Error("retireYjs: refused — no explicit user confirmation");
  }
  if (!options.backedUp) {
    throw new Error("retireYjs: refused — no backup was taken before retirement");
  }
  const current = await getCutoverPhase(room);
  if (current !== "quiesced") {
    throw new Error(`retireYjs: refused — phase is "${current}", expected "quiesced"`);
  }

  for (const name of options.yjsIndexedDbNames) {
    await options.deleteIndexedDb(name);
  }
  await advanceCutoverPhase(room, "retired");
}
