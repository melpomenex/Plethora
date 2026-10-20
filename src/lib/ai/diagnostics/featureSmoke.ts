/**
 * Bounded, fixture-only feature smoke runner (D0 task 3.1).
 *
 * Contract:
 *  - one run at a time;
 *  - per-adapter timeout ≤ 60s (agent inherits its own hard deadline);
 *  - the user explicitly starts each case and any remote/billable destination
 *    requires its own authorization;
 *  - Stop aborts, suppresses late output and NEVER falls back to another
 *    destination;
 *  - a missing production adapter reports `not-run`, never a pass;
 *  - no user data is read or written (`mutatesUserData: false`).
 */

import {
  recordFeatureObservation,
  type FeatureObservationOutcome,
  type FeatureStage,
} from "../diagnostics";
import { FEATURE_IDS, type FeatureId } from "../features/types";

export const MAX_SMOKE_DURATION_MS = 60_000;

export type SmokeDestination = "device" | "loopback" | "lan" | "remote" | "unknown";

export interface FeatureSmokeAdapter {
  readonly featureId: FeatureId;
  /** Stages the adapter actually exercises (never a superset). */
  readonly stages: readonly FeatureStage[];
  /** Bundled, non-personal fixture identity. */
  readonly fixtureId: string;
  readonly maxDurationMs: number;
  readonly destinations: readonly SmokeDestination[];
  /** Always false: in-app smoke cannot touch the user's learning collection. */
  readonly mutatesUserData: false;
  /** True when any declared destination processes data off-device. */
  readonly requiresConsent: boolean;
  /**
   * Fixture-backed stages the adapter cannot verify in-app (storage,
   * navigation) stay listed as unverified, not passed.
   */
  readonly unverifiedStages?: readonly FeatureStage[];
  run(context: FeatureSmokeContext): Promise<FeatureSmokeRunResult>;
}

export interface FeatureSmokeContext {
  readonly signal: AbortSignal;
  readonly capabilityRevision: string;
  /** Record one stage outcome; the runner correlates it with the smoke run. */
  reportStage(
    stage: FeatureStage,
    outcome: FeatureObservationOutcome,
    details?: { durationMs?: number; errorCategory?: string; recoveryCode?: string }
  ): void;
}

export interface FeatureSmokeRunResult {
  readonly outcome: FeatureObservationOutcome;
  /** Stages actually exercised (adapter-declared minus unexecuted). */
  readonly stages: readonly FeatureStage[];
  /** Safe recovery code when the run failed. */
  readonly recoveryCode?: string;
  readonly errorCategory?: string;
  /** Route class actually exercised, when known. */
  readonly providerClass?: string;
  readonly notesKey?: string;
}

export type SmokeState =
  | "not-run"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "unsupported"
  | "consent-required";

export interface FeatureSmokeRecord {
  readonly featureId: FeatureId;
  readonly state: SmokeState;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly fixtureId?: string;
  readonly stages: readonly FeatureStage[];
  readonly unverifiedStages: readonly FeatureStage[];
  readonly outcome?: FeatureObservationOutcome;
  readonly recoveryCode?: string;
  readonly errorCategory?: string;
  readonly providerClass?: string;
}

const adapters = new Map<FeatureId, FeatureSmokeAdapter>();
const records = new Map<FeatureId, FeatureSmokeRecord>();

let active: { featureId: FeatureId; controller: AbortController } | null = null;

export function registerFeatureSmokeAdapter(adapter: FeatureSmokeAdapter): void {
  if (!FEATURE_IDS.includes(adapter.featureId)) {
    throw new Error(`Unknown smoke feature: ${adapter.featureId}`);
  }
  if (adapter.maxDurationMs <= 0 || adapter.maxDurationMs > MAX_SMOKE_DURATION_MS) {
    throw new Error(
      `Smoke adapter ${adapter.featureId} must declare maxDurationMs in (0, ${MAX_SMOKE_DURATION_MS}]`
    );
  }
  if (adapter.mutatesUserData !== false) {
    throw new Error("In-app smoke adapters must declare mutatesUserData: false");
  }
  adapters.set(adapter.featureId, adapter);
}

/** Test-only: remove registered adapters. */
export function clearFeatureSmokeAdapters(): void {
  adapters.clear();
  records.clear();
  active = null;
}

export function getFeatureSmokeAdapter(featureId: FeatureId): FeatureSmokeAdapter | undefined {
  return adapters.get(featureId);
}

export function getFeatureSmokeRecord(featureId: FeatureId): FeatureSmokeRecord {
  return (
    records.get(featureId) ?? {
      featureId,
      state: adapters.has(featureId) ? "not-run" : "unsupported",
      stages: [],
      unverifiedStages: [],
    }
  );
}

export function getFeatureSmokeRecords(): readonly FeatureSmokeRecord[] {
  return FEATURE_IDS.map((id) => getFeatureSmokeRecord(id));
}

export interface RunFeatureSmokeOptions {
  readonly capabilityRevision: string;
  readonly runId: string;
  /**
   * Explicit authorization for the selected destinations. Called only when
   * the adapter declares a remote/billable route. A denial skips the run.
   */
  readonly authorize?: (info: {
    readonly featureId: FeatureId;
    readonly destinations: readonly SmokeDestination[];
    readonly requiresConsent: boolean;
  }) => Promise<boolean>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

function terminalRecord(
  adapter: FeatureSmokeAdapter,
  state: SmokeState,
  extra: Partial<FeatureSmokeRecord>
): FeatureSmokeRecord {
  const record: FeatureSmokeRecord = {
    featureId: adapter.featureId,
    state,
    fixtureId: adapter.fixtureId,
    stages: [...adapter.stages],
    unverifiedStages: [...(adapter.unverifiedStages ?? [])],
    ...extra,
  };
  records.set(adapter.featureId, record);
  return record;
}

/**
 * Run one selected fixture smoke. Resolves with the record rather than
 * throwing; UI can render state directly.
 */
export async function runFeatureSmoke(
  featureId: FeatureId,
  options: RunFeatureSmokeOptions
): Promise<FeatureSmokeRecord> {
  const adapter = adapters.get(featureId);
  if (!adapter) return getFeatureSmokeRecord(featureId);

  if (active) {
    // Single-flight across features: one smoke at a time, and no stealing.
    return getFeatureSmokeRecord(featureId);
  }

  if (adapter.requiresConsent) {
    const granted = options.authorize
      ? await options.authorize({
          featureId,
          destinations: adapter.destinations,
          requiresConsent: adapter.requiresConsent,
        })
      : false;
    if (!granted) {
      terminalRecord(adapter, "consent-required", {});
      recordFeatureObservation({
        featureId,
        runId: options.runId,
        stage: "preflight",
        level: "operational",
        outcome: "skipped",
        durationMs: 0,
        capabilityRevision: options.capabilityRevision,
        recoveryCode: "smoke_consent_denied",
        smoke: true,
      });
      return getFeatureSmokeRecord(featureId);
    }
  }

  const now = options.now ?? Date.now;
  const controller = new AbortController();
  active = { featureId, controller };
  const startedAt = now();
  const executed = new Set<FeatureStage>();
  let latest: FeatureSmokeRunResult | undefined;

  records.set(featureId, {
    featureId,
    state: "running",
    startedAt,
    fixtureId: adapter.fixtureId,
    stages: [...adapter.stages],
    unverifiedStages: [...(adapter.unverifiedStages ?? [])],
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FeatureSmokeRunResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ outcome: "cancelled", stages: [...executed], recoveryCode: "smoke_timeout" });
    }, Math.min(adapter.maxDurationMs, MAX_SMOKE_DURATION_MS));
  });

  const context: FeatureSmokeContext = {
    signal: controller.signal,
    capabilityRevision: options.capabilityRevision,
    reportStage(stage, outcome, details) {
      // A late callback from a native call that could not abort immediately
      // must not record a success after Stop/deadline.
      if (controller.signal.aborted && outcome === "success") return;
      executed.add(stage);
      recordFeatureObservation({
        featureId,
        runId: options.runId,
        stage,
        level: "operational",
        outcome,
        durationMs: details?.durationMs ?? 0,
        capabilityRevision: options.capabilityRevision,
        errorCategory: details?.errorCategory,
        recoveryCode: details?.recoveryCode,
        smoke: true,
      });
    },
  };

  try {
    latest = await Promise.race([
      adapter.run(context),
      timeout,
    ]);
  } catch {
    latest = {
      outcome: controller.signal.aborted ? "cancelled" : "failed",
      stages: [...executed],
      errorCategory: controller.signal.aborted ? "Cancelled" : "GenerationFailed",
      recoveryCode: controller.signal.aborted ? "smoke_cancelled" : "smoke_failed",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    active = null;
  }

  const finishedAt = now();
  // A late success after cancellation is suppressed: the abort is
  // authoritative and the result is never rendered as passed.
  const outcome: FeatureObservationOutcome = controller.signal.aborted
    ? "cancelled"
    : latest.outcome;

  const state: SmokeState =
    outcome === "success"
      ? "passed"
      : outcome === "cancelled"
        ? "cancelled"
        : outcome === "skipped"
          ? "consent-required"
          : "failed";

  const record = terminalRecord(adapter, state, {
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    outcome,
    stages: [...new Set([...executed, ...latest.stages])],
    recoveryCode: latest.recoveryCode,
    errorCategory: latest.errorCategory,
    providerClass: latest.providerClass,
  });

  return record;
}

/** Cancel the active smoke run (Stop button). */
export function cancelActiveFeatureSmoke(): void {
  active?.controller.abort();
}

/** True while any smoke run is active. */
export function isFeatureSmokeRunning(): boolean {
  return active !== null;
}

/** Reset recorded smoke results (Clear diagnostics). */
export function clearFeatureSmokeRecords(): void {
  records.clear();
}
