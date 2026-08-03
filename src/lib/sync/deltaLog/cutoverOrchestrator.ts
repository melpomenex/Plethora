/**

 Boot-time cutover orchestrator (migrate-sync-to-delta-log Phase 6 wiring).

 This is the missing driver that walks a room through the cutover state
 machine (`cutover.ts`) on each boot, advancing one phase at a time until it
 reaches `verified` — at which point the user-driven "Finish migration"
 button (P5) in `DeltaLogMigrationPanel.tsx` takes over. It also starts the
 delta-log read path (pull loop + WS notifications) and presence heartbeat
 the first time the room is opted in.

 Why this module exists: every phase function (`runDrainPhase`,
 `runSeedPhase`, `startDualRun`, `runVerifyPhase`, `runQuiescePhase`) was
 implemented and unit-tested in `cutover.ts` but had ZERO production callers
 — the migration panel only wired P5/P7, and "Finish migration" is enabled
 only at `verified`, which nothing ever reached. Without this orchestrator
 no real room can leave `not_started`, so the real-room cutover the handoff
 gates Phase 9 on can never happen.

 Safety properties (preserved from the phase functions it calls):
   - One phase per boot. A failure leaves the phase unchanged and retries
     next boot (same pattern as `runSyncMigrationIfNeeded`).
   - Never auto-advances past `verified`. P5 (cutover), P6 (quiesce, time
     based), and P7 (retire, destructive) stay user-driven.
   - `deltaLogSync: false` makes the whole thing a no-op, and rollback is
     safe at every phase before P7 (design.md §6).

*/

import { isTauri } from "../../tauri";
import { getSyncRoomId } from "../../yjsSync";
import { getSyncFeatureFlags } from "../featureFlags";
import { getCachedSubKeys } from "../roomCrypto";
import { deriveDeltaLogUrls } from "./urls";
import {
  registerRoom,
  subscribe,
  reportCursor,
  head,
  type DeltaLogClientConfig,
  type DeltaLogSubscription,
  type DeltaLogDeviceEntry,
} from "./client";
import { runDeltaLogPullLoop } from "./pullLoop";
import { applyDeltaLogPage } from "./router";
import { getRoomCursor } from "./checkpoints";
import { registerDeltaLogOutboxPublishers } from "./outboxPublisher";
import {
  runDrainPhase,
  runSeedPhase,
  startDualRun,
  runVerifyPhase,
  runQuiescePhase,
  getCutoverPhase,
  computeDomainDigest,
  publishDomainDigest,
  checkDomainConvergence,
  type SeedEnqueue,
  type CutoverPhase,
} from "../cutover";
import { listCutoverDrainTargets } from "../cutoverTargets";
import { SEED_DOMAIN_READERS } from "./seedReaders";
import { getProgressiveSyncScheduler } from "../progressiveScheduler";
import { enqueueSyncOperation } from "../syncJournal";
import type { SubKeys } from "../encryption";

const ORCHESTRATOR_LOG = "[cutover-orchestrator]";

/**
 * Route diagnostics through @tauri-apps/plugin-log so they surface in the
 * Rust stdout (plain webview console.* calls do NOT surface there, leaving
 * the orchestrator's behavior invisible during live testing). Mirrors how
 * syncTelemetry.ts emits its [sync-telemetry] lines.
 */
let nativeLog: ((message: string) => void) | null | undefined;
function orchLog(message: string): void {
  // Always mirror to console for the webview inspector too.
  console.log(`${ORCHESTRATOR_LOG} ${message}`);
  if (nativeLog === undefined) {
    nativeLog = null;
    void import("@tauri-apps/plugin-log")
      .then((log) => {
        // Wrap in try/catch: in non-Tauri environments (tests) the plugin's
        // info() calls invoke() on an undefined handle and throws. A logging
        // failure must never propagate to the caller.
        try {
          nativeLog = log.info
            ? (m: string) => {
                try {
                  log.info(m);
                } catch {
                  /* non-Tauri env; swallow */
                }
              }
            : null;
        } catch {
          nativeLog = null;
        }
        nativeLog?.(`${ORCHESTRATOR_LOG} ${message}`);
      })
      .catch(() => {
        nativeLog = null;
      });
    return;
  }
  nativeLog?.(`${ORCHESTRATOR_LOG} ${message}`);
}

/** Domains whose digests are compared in P4 verify (the durable row-domains). */
const VERIFY_DOMAINS = SEED_DOMAIN_READERS.map((r) => r.domain);

// --- transport lifecycle (started once per session) ------------------------

let transportStarted = false;
let activeSubscription: DeltaLogSubscription | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let unregisterOutbox: (() => void) | null = null;

/**
 * Start the delta-log read path + presence + dual-write outbox publishers
 * for this room. Idempotent within a session (a no-op if already started).
 * The caller passes the deviceTag used for presence; derived from the
 * file-manifest device id (btoa) to match what the server already indexes.
 */
function startDeltaLogTransport(
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
  deviceTag: string,
): void {
  if (transportStarted) return;
  transportStarted = true;

  // Read path: pull loop (cold start / catch-up) feeds the same projector the
  // Yjs path uses (router.ts), then a WS subscription re-pulls on head advance.
  void runDeltaLogPullLoop(config, (ops) => applyDeltaLogPage(ops, subKeys)).catch((err) =>
    orchLog(`initial pull loop failed (will retry via WS): ${err}`),
  );
  void getRoomCursor().then((since) => {
    activeSubscription = subscribe(config, since, () => {
      void runDeltaLogPullLoop(config, (ops) => applyDeltaLogPage(ops, subKeys)).catch((err) =>
        orchLog(`WS-triggered pull failed: ${err}`),
      );
    });
  });

  // Presence heartbeat: report this device's cursor + presence blob so the
  // roster (P4 verify + the migration panel's device list) sees us. Every 30s
  // is cheap (one signed POST) and keeps `seen_at` fresh within
  // DEVICE_STALE_DAYS on the server.
  const PRESENCE_INTERVAL_MS = 30_000;
  const tick = (): void => {
    void (async () => {
      try {
        const since = await getRoomCursor();
        await reportCursor(config, deviceTag, since);
      } catch (err) {
        orchLog(`presence report failed: ${err}`);
      }
      // Also bridge the delta-log roster into the FileManifest's in-memory
      // devicesMap so getOnlineDevices / file-transfer peer discovery see
      // peers that report presence via the delta-log path (the one that works
      // without Yjs). Best-effort; a failure retries next tick.
      try {
        const { getFileManifest } = await import("../../useFileSync");
        const manifest = getFileManifest();
        if (manifest) await manifest.refreshOnlineDevicesFromDeltaLog();
      } catch {
        // file-sync not initialized yet, or not a Tauri build — skip silently.
      }
    })();
  };
  tick();
  presenceTimer = setInterval(tick, PRESENCE_INTERVAL_MS);

  // Wire the FileManifest's delta-log presence source so updateMyPresence
  // reports to the roster and refreshOnlineDevicesFromDeltaLog can decode
  // peers. Best-effort — file-sync may not be initialized yet at transport
  // start; the presence tick above re-attempts the refresh every interval.
  void (async () => {
    try {
      const { getFileManifest } = await import("../../useFileSync");
      const manifest = getFileManifest();
      if (manifest) {
        manifest.setDeltaLogPresenceSource(config, subKeys.fileKey);
      }
    } catch {
      // not yet initialized; will be wired on a later boot once file-sync is up
    }
  })();

  // Outbox publishers: once dual-run starts these turn writes into delta-log
  // pushes. Registered here (rather than only inside startDualRun) so that
  // the seed rows enqueued during P2 — which go through the same outbox —
  // have a publisher to drain through as soon as the drain loop runs.
  unregisterOutbox = registerDeltaLogOutboxPublishers(VERIFY_DOMAINS, config, subKeys);
}

/**
 * Stop the transport (room switch / sync disabled). Safe to call when not
 * started. Exposed for the room-change listener, not called automatically.
 */
export function stopDeltaLogTransport(): void {
  if (activeSubscription) {
    activeSubscription.close();
    activeSubscription = null;
  }
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  if (unregisterOutbox) {
    unregisterOutbox();
    unregisterOutbox = null;
  }
  transportStarted = false;
}

// --- phase drivers ---------------------------------------------------------

/**
 * Build the delta-log client config the same way the migration panel does
 * (so the boot path and the visible UI agree on endpoints). Returns null
 * when encryption isn't provisioned for this room or no endpoint is set —
 * the orchestrator then no-ops until the user finishes pairing.
 */
async function buildConfig(room: string): Promise<{ config: DeltaLogClientConfig; subKeys: SubKeys } | null> {
  const subKeys = await getCachedSubKeys(room);
  if (!subKeys) return null;
  // settings.sync.yjs.url is the single endpoint value (task 7.5). Read it
  // lazily to avoid importing the settings store at module top. Fall back to
  // the default endpoint when the user never set a custom URL — the settings
  // default is "" (empty), and SyncSettings.tsx applies this same fallback at
  // derive time (line 131). Without it the orchestrator silently no-op'd for
  // every room whose URL field was never filled in.
  const { useSettingsStore } = await import("../../../stores/settingsStore");
  const rawUrl = useSettingsStore.getState().settings.sync?.yjs?.url;
  const syncUrl = rawUrl || "wss://sync.readsync.org";
  const { httpBase, wsBase } = deriveDeltaLogUrls(syncUrl);
  return {
    config: { httpBase, wsBase, room, manifestAuthKey: subKeys.manifestAuthKey },
    subKeys,
  };
}

/**
 * deviceTag for the wire = base64 of this device's stable id, matching
 * file-manifest.ts::deviceIdToWireTag. Read lazily.
 */
async function getDeviceTag(): Promise<string> {
  const { getDeviceId } = await import("../../file-manifest");
  return btoa(getDeviceId());
}

/**
 * P2 seed enqueue: route through the existing outbox so the normal drain
 * loop pushes the rows. The seed's idempotency (re-seed = no-op via LWW)
 * holds regardless of when the drain runs.
 */
const seedEnqueue: SeedEnqueue = (op) =>
  enqueueSyncOperation({
    domain: op.domain,
    entityKey: op.entityKey,
    operation: op.operation,
    payload: op.payload,
    clock: op.clock,
  });

/**
 * Drive the room one phase forward. Returns the phase it reached this boot
 * (which may equal the entry phase if no advance happened, e.g. at/above
 * `verified` or on a transient failure).
 */
async function advanceOnePhase(
  room: string,
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
  deviceTag: string,
  entryPhase: CutoverPhase,
): Promise<CutoverPhase> {
  try {
    switch (entryPhase) {
      case "not_started": {
        const targets = listCutoverDrainTargets();
        const result = await runDrainPhase(
          room,
          targets,
          () => {
            const s = getProgressiveSyncScheduler().stats();
            return { queued: s.queued, running: s.running };
          },
        );
        if (result.outcome !== "drained") {
          orchLog(`drain did not complete (deadLetters=${result.deadLetterCount}, quiesced=${result.quiesced}); retrying next boot`);
          return entryPhase;
        }
        orchLog(`drained → ${result.perDomainCounts}`);
        return "drained";
      }
      case "drained": {
        const seedTargets = SEED_DOMAIN_READERS.map((r) => ({ domain: r.domain, readAllRows: r.readAllRows }));
        const result = await runSeedPhase(room, seedTargets, seedEnqueue);
        orchLog(`seeded → ${result.perDomainCounts}`);
        return "seeded";
      }
      case "seeded": {
        // Dual-run also registers the outbox publishers, but we registered
        // them eagerly in startDeltaLogTransport so the seed drain already
        // had somewhere to go. startDualRun is still the phase transition
        // + the read-from-both contract.
        await startDualRun(room, VERIFY_DOMAINS, config, subKeys);
        orchLog(`dual-run started`);
        return "dual";
      }
      case "dual": {
        const convergence = await runVerifyForAllDomains(room, config, subKeys, deviceTag);
        const result = await runVerifyPhase(room, convergence);
        if (result.allConverged) {
          orchLog(`verified — all domains converged`);
          return "verified";
        }
        const blockers = Object.entries(convergence)
          .filter(([, r]) => !r.converged)
          .map(([d, r]) => `${d}(missing=${r.missingDigests.length},disagree=${r.disagreeing.length})`);
        orchLog(`not yet verified; waiting on [${blockers.join(", ")}]`);
        return entryPhase;
      }
      case "verified":
      case "cutover":
        // P5 (cutover) and P6 (quiesce) are user/time-driven. Poll quiesce
        // opportunistically: once the user has clicked "Finish migration"
        // (P5 → cutover) and 14 days pass with no Yjs activity, advance to
        // quiesced so the panel can offer P7 retire.
        if (entryPhase === "cutover") {
          try {
            const q = await runQuiescePhase(room);
            if (q.quiesced) {
              orchLog(`quiesced after ${q.daysSinceActivity.toFixed(1)} days idle`);
              return "quiesced";
            }
          } catch (err) {
            orchLog(`quiesce check failed: ${err}`);
          }
        }
        return entryPhase;
      case "quiesced":
      case "retired":
        // P7 retire is destructive and user-confirmed; never auto-advance.
        return entryPhase;
    }
  } catch (err) {
    orchLog(`phase "${entryPhase}" failed (will retry next boot): ${err}`);
    return entryPhase;
  }
  return entryPhase;
}

/**
 * P4 verify for every durable domain: compute this device's digest from
 * SQLite, publish it, fetch peer digests from the `__verify` domain, and
 * check convergence against the device roster.
 */
async function runVerifyForAllDomains(
  room: string,
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
  deviceTag: string,
): Promise<Record<string, ReturnType<typeof checkDomainConvergence>>> {
  // The device roster from GET /head is what "all devices checked in" means.
  let roster: DeltaLogDeviceEntry[] = [];
  try {
    const headResponse = await head(config);
    roster = headResponse.devices;
  } catch (err) {
    orchLog(`could not fetch device roster for verify: ${err}`);
  }
  const rosterTags = roster.map((d) => d.deviceTag);

  const result: Record<string, ReturnType<typeof checkDomainConvergence>> = {};
  for (const target of SEED_DOMAIN_READERS) {
    const rows = await target.readAllRows();
    const digest = await computeDomainDigest(rows.map((r) => ({ entityKey: r.entityKey, hlc: r.hlc })));
    // Publish this device's current digest for the domain.
    try {
      await publishDomainDigest(config, subKeys, deviceTag, target.domain, digest);
    } catch (err) {
      orchLog(`failed to publish digest for ${target.domain}: ${err}`);
    }
    // Read peers' most-recent digests from the __verify domain. Each digest
    // is stored as an append op keyed `${domain}:${deviceTag}`; pull a fresh
    // page covering them. We fetch via the room's verify ops by pulling the
    // whole __verify stream — it is small (one row per device per domain).
    const otherDigests = await readPeerDigests(config, subKeys, target.domain, deviceTag);
    result[target.domain] = checkDomainConvergence(digest, otherDigests, rosterTags, deviceTag);
  }
  void room;
  return result;
}

/**
 * Pull the `__verify` domain's ops and decode the most-recent digest per
 * (domain, deviceTag). Returns a Map keyed by deviceTag for `domain`.
 *
 * `__verify` ops are published as `{ domain: "__verify", entityKey:
 * "${domain}:${deviceTag}", row: { digest } }` (cutover.ts:285). We pull the
 * full room log (cursors aside) and keep the latest digest per device for
 * the requested domain. The log is bounded by (devices × domains), so this
 * is a small, cheap page.
 */
async function readPeerDigests(
  config: DeltaLogClientConfig,
  subKeys: SubKeys,
  domain: string,
  ownDeviceTag: string,
): Promise<Map<string, string>> {
  const { pull } = await import("./client");
  const { decodeOp } = await import("./envelope");
  const digestByDevice = new Map<string, string>();
  let since = 0;
  // Page through the entire room log once per verify run. Capped so a
  // pathological log can't loop forever; in practice __verify ops are a
  // tiny fraction of a single page.
  const MAX_PAGES = 50;
  for (let i = 0; i < MAX_PAGES; i++) {
    let page;
    try {
      page = await pull(config, since, 500);
    } catch (err) {
      orchLog(`verify digest pull failed: ${err}`);
      break;
    }
    if (page.ops.length === 0) break;
    for (const op of page.ops) {
      try {
        const decoded = await decodeOp(op, subKeys);
        if (decoded.domain !== "__verify") continue;
        const key = decoded.entityKey;
        const sep = key.indexOf(":");
        if (sep < 0) continue;
        const opDomain = key.slice(0, sep);
        const opDevice = key.slice(sep + 1);
        if (opDomain !== domain) continue;
        if (opDevice === ownDeviceTag) continue;
        const row = decoded.row as { digest?: unknown } | null;
        if (row && typeof row.digest === "string") {
          digestByDevice.set(opDevice, row.digest); // last write wins (highest seq seen last)
        }
      } catch {
        // skip undecodable verify op
      }
    }
    since = page.ops[page.ops.length - 1].seq;
    if (since >= page.head) break;
  }
  return digestByDevice;
}

// --- entry point -----------------------------------------------------------

/**
 * Run the cutover orchestrator for the current room. Called from the boot
 * chain (`startSyncSubsystems`) when `deltaLogSync` is enabled. Safe to call
 * on every boot; idempotent and non-fatal.
 *
 * Returns the phase reached this boot (mainly for tests/diagnostics).
 */
export async function runCutoverOrchestrator(): Promise<CutoverPhase | null> {
  if (!isTauri()) {
    orchLog(`not running: not Tauri`);
    return null;
  }
  if (!getSyncFeatureFlags().deltaLogSync) {
    orchLog(`not running: deltaLogSync flag off`);
    return null;
  }

  const room = getSyncRoomId();
  if (!room) {
    orchLog(`not running: no room id`);
    return null;
  }
  orchLog(`running for room ${room}`);

  const built = await buildConfig(room);
  if (!built) {
    // Encryption not provisioned yet, or no endpoint — wait for the user to
    // finish pairing. This is not an error.
    orchLog(`not running: buildConfig returned null (no subkeys or no endpoint)`);
    return null;
  }
  orchLog(`config built, registering room...`);
  const { config, subKeys } = built;

  // TOFU registration: registerRoom is a no-op-ish GET /head that records
  // this device's manifestAuthKey on first contact. If the room is already
  // registered it simply succeeds; if it 401s we can't proceed this boot but
  // should not crash the app.
  try {
    await registerRoom(config);
  } catch (err) {
    orchLog(`room registration failed (will retry next boot): ${err}`);
    return null;
  }

  const deviceTag = await getDeviceTag();

  // Start the transport once. This must happen before the seed phase so that
  // enqueued seed rows have a publisher to drain through.
  startDeltaLogTransport(config, subKeys, deviceTag);

  const entryPhase = await getCutoverPhase(room);
  const reached = await advanceOnePhase(room, config, subKeys, deviceTag, entryPhase);
  return reached;
}

/** Test-only: reset transport state between tests. */
export function __resetCutoverOrchestratorForTest(): void {
  stopDeltaLogTransport();
}
