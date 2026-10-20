import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassageScoringController } from "../controller";
import { PassageDismissalStore, PassageUsageBudget, RecentPassageScoreCache, type StoredPassageScore } from "../cache";
import {
  digestNormalizedPassage,
  normalizePassageText,
} from "../identity";
import type { PassageClassification } from "../../../../lib/ai/schemas/passageClassification";
import type { DestinationClassification } from "../../../../lib/ai/features/destinations";
import type { AIProvider } from "../../../../lib/ai/providers";
import type { ResolvedPassageScoringPolicy } from "../policy";
import type {
  PassageAdapter,
  PassageEncounterEvent,
  PassageLocator,
  PassagePolicyIdentity,
  PassageProjectedRect,
  PassageScoringCounters,
  PassageScoringResult,
} from "../types";

const destination: DestinationClassification = {
  providerClass: "android-nano",
  locality: "device",
  keyless: true,
  billable: false,
  sendsOffDevice: false,
  requiresDisclosure: false,
  requiresCostConsent: false,
};

const fakeProvider = {
  id: "fake-ondevice",
  kind: "ondevice",
  getCapabilities: async () => ({}) as never,
  generateStream: async () => ({}) as never,
} as unknown as AIProvider;

function makePolicy(overrides: Partial<ResolvedPassageScoringPolicy> = {}): ResolvedPassageScoringPolicy {
  return {
    classifierVersion: "classifier-a",
    servingRevision: "fake-ondevice\u0000model-a",
    providerClass: "android-nano",
    capabilityRevision: "cap-a",
    provider: fakeProvider,
    providerId: "fake-ondevice",
    destination,
    remote: false,
    authorized: true,
    ...overrides,
  };
}

class FakeAdapter implements PassageAdapter {
  readonly ownerToken = "owner-1";
  private policy: PassagePolicyIdentity | null = null;
  private readonly listenerSet = new Set<(event: PassageEncounterEvent) => void>();
  readonly records = new Map<
    string,
    { text: string; locator: PassageLocator; mounted: boolean }
  >();
  disposed = false;

  configure(policy: PassagePolicyIdentity): void {
    this.policy = policy;
  }
  subscribeEncountered(listener: (event: PassageEncounterEvent) => void): () => void {
    this.listenerSet.add(listener);
    return () => this.listenerSet.delete(listener);
  }
  add(passageId: string, text: string, locator?: Partial<PassageLocator>) {
    const padded =
      text.length >= 60
        ? text
        : `${text} This fixture passage carries enough detail to qualify.`;
    this.records.set(passageId, {
      text: padded,
      mounted: true,
      locator: {
        kind: "html",
        sourceType: "html",
        documentId: "doc-1",
        anchorId: `a:${passageId}`,
        startOffset: 0,
        endOffset: padded.length,
        quote: padded,
        ...(locator as object),
      } as PassageLocator,
    });
  }
  emit(event: PassageEncounterEvent) {
    for (const listener of this.listenerSet) listener(event);
  }
  snapshot(passageId: string) {
    const record = this.records.get(passageId);
    if (!record || !record.mounted || !this.policy) return null;
    return {
      ownerToken: this.ownerToken,
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageId,
      contentHash: digestNormalizedPassage(normalizePassageText(record.text), this.policy),
      locator: record.locator,
      text: record.text,
    };
  }
  projectRects(): PassageProjectedRect[] | null {
    return [{ x: 10, y: 20, width: 200, height: 40 }];
  }
  resolveLocator(): boolean {
    return true;
  }
  dispose(): void {
    this.disposed = true;
    this.listenerSet.clear();
  }
}

function classification(
  overrides: Partial<PassageClassification> = {}
): PassageClassification {
  return {
    type: "definition",
    extractWorthiness: 0.9,
    reason: "Defines the central term.",
    suggestedLearningAction: "extract",
    ...overrides,
  };
}

interface Harness {
  adapter: FakeAdapter;
  controller: PassageScoringController;
  results: PassageScoringResult[];
  removed: string[];
  cleared: number;
  statuses: string[];
  counters: PassageScoringCounters[];
  classify: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  dismissals: PassageDismissalStore;
  setEnabled: (value: boolean) => void;
  setForeground: (value: boolean) => void;
}

function createHarness(options: {
  classification?: PassageClassification;
  cached?: StoredPassageScore | null;
  visitLimit?: number;
  hourLimit?: number;
  classifyImpl?: (request: { text: string; signal: AbortSignal }) => Promise<{
    classification: PassageClassification;
    providerId: string;
    baseModelName?: string;
  }>;
} = {}): Harness {
  const adapter = new FakeAdapter();
  let enabled = true;
  let foreground = true;
  const results: PassageScoringResult[] = [];
  const removed: string[] = [];
  const statuses: string[] = [];
  const counters: PassageScoringCounters[] = [];
  let cleared = 0;

  const lookup = vi.fn(async () => options.cached ?? null);
  const store = vi.fn(async () => {});
  const classify = vi.fn(
    options.classifyImpl ??
      (async () => ({
        classification: options.classification ?? classification(),
        providerId: "fake-ondevice",
      }))
  );
  const dismissals = new PassageDismissalStore({
    durable: false,
    documentId: "doc-1",
    sourceRevision: "rev-1",
    classifierVersion: "classifier-a",
  });

  const controller = new PassageScoringController({
    adapter,
    documentId: "doc-1",
    documentTitle: "Fixture",
    sourceRevision: "rev-1",
    isForeground: () => foreground,
    isEnabled: () => enabled,
    getConfigRevision: () => "config-1",
    deps: {
      resolvePolicy: async () => ({ status: "ready", policy: makePolicy() }),
      lookup,
      store,
      classify: classify as never,
      dismissals,
      budget: new PassageUsageBudget(options.visitLimit ?? 12, options.hourLimit ?? 60),
      recent: new RecentPassageScoreCache(),
    },
    events: {
      onResult: (result) => results.push(result),
      onRemove: (passageId) => removed.push(passageId),
      onClear: () => {
        cleared += 1;
      },
      onCounters: (value) => counters.push(value),
      onStatus: (status) => statuses.push(status),
    },
  });
  controller.start();
  return {
    adapter,
    controller,
    results,
    removed,
    counters,
    classify,
    lookup,
    store,
    dismissals,
    get cleared() {
      return cleared;
    },
    setEnabled: (value) => {
      enabled = value;
      controller.setEnabled(value);
    },
    setForeground: (value) => {
      foreground = value;
      controller.setForeground(value);
    },
  } as Harness;
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PassageScoringController dwell and scheduling", () => {
  it("waits ≥1s of visibility before enqueueing and scores only once idle", async () => {
    const harness = createHarness();
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });

    await advance(999);
    expect(harness.classify).not.toHaveBeenCalled();
    await advance(1);
    expect(harness.controller.getCounters().enqueued).toBe(1);
    await advance(20);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.results).toHaveLength(1);
    expect(harness.results[0].fromCache).toBe(false);
    expect(harness.store).toHaveBeenCalledTimes(1);
  });

  it("leaving before the dwell elapses cancels the candidate", async () => {
    const harness = createHarness();
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(400);
    harness.adapter.emit({ kind: "exit", passageId: "p1" });
    await advance(5_000);
    expect(harness.classify).not.toHaveBeenCalled();
  });

  it("wait ≥750ms after scroll/selection activity before starting work", async () => {
    const harness = createHarness();
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_000);
    expect(harness.controller.getCounters().enqueued).toBe(1);
    harness.controller.noteActivity("scroll");
    await advance(700);
    expect(harness.classify).not.toHaveBeenCalled();
    await advance(60);
    expect(harness.classify).toHaveBeenCalledTimes(1);
  });

  it("bounds the queue at 8 and counts skipped candidates", async () => {
    const harness = createHarness();
    harness.setForeground(false);
    for (let index = 0; index < 12; index += 1) {
      const id = `p${index}`;
      harness.adapter.add(id, `A precise definition number ${index} worth keeping as an extract.`);
      harness.adapter.emit({ kind: "enter", passageId: id });
    }
    await advance(1_000);
    const counters = harness.controller.getCounters();
    expect(counters.enqueued).toBe(8);
    expect(counters.skippedQueueFull).toBe(4);
  });

  it("never runs two classifications concurrently", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running: string[] = [];
    const harness = createHarness({
      classifyImpl: async ({ text }) => {
        running.push(text);
        await gate;
        return {
          classification: classification(),
          providerId: "fake-ondevice",
        };
      },
    });
    harness.adapter.add("p1", "First definition that is worth keeping as an extract.");
    harness.adapter.add("p2", "Second definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    harness.adapter.emit({ kind: "enter", passageId: "p2" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(running).toHaveLength(1);
    release();
    await advance(100);
    expect(harness.classify).toHaveBeenCalledTimes(2);
  });

  it("reuses an in-memory recent result for duplicate text without a persistent lookup", async () => {
    const harness = createHarness();
    const text = "A precise definition that is worth keeping as an extract for later review.";
    harness.adapter.add("p1", text);
    harness.adapter.add("p2", text);
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledTimes(1);

    harness.adapter.emit({ kind: "enter", passageId: "p2" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    // The 128-entry recent cache answers the repeat without another backend get.
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.controller.getCounters().cacheHits).toBe(1);
    expect(harness.results).toHaveLength(2);
  });

  it("enforces the per-visit classification cap and cache hits bypass quota", async () => {
    const cached: StoredPassageScore = {
      chunkHash: "unused",
      passageType: "definition",
      extractWorthiness: 0.9,
      suggestedAction: "extract",
      reason: "Cached.",
      classifierVersion: "classifier-a",
      modelRevision: "fake-ondevice\u0000model-a",
      normalizationVersion: "passage-normalization-v1",
      createdAt: "2026-10-20T00:00:00Z",
    };
    const harness = createHarness({ visitLimit: 2, cached: null });
    for (let index = 0; index < 4; index += 1) {
      harness.adapter.add(
        `p${index}`,
        `Distinct definition number ${index} that is worth keeping as an extract.`
      );
      harness.adapter.emit({ kind: "enter", passageId: `p${index}` });
    }
    await advance(1_400);
    expect(harness.classify).toHaveBeenCalledTimes(2);
    expect(harness.controller.getCounters().skippedVisitQuota).toBeGreaterThan(0);

    const hitHarness = createHarness({ cached: { ...cached, chunkHash: "x" } });
    hitHarness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    hitHarness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(hitHarness.classify).not.toHaveBeenCalled();
    expect(hitHarness.controller.getCounters().cacheHits).toBe(1);
    expect(hitHarness.results).toHaveLength(1);
    expect(hitHarness.results[0].fromCache).toBe(true);
  });
});

describe("PassageScoringController eligibility, cancellation and lifecycle", () => {
  it("stays quiet at exactly 0.75 and for bibliography/no-action results", async () => {
    const harness = createHarness({
      classification: classification({ extractWorthiness: 0.75 }),
    });
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.results).toHaveLength(0);
    expect(harness.store).toHaveBeenCalledTimes(1);
    expect(harness.removed).toContain("p1");

    harness.adapter.add("p2", "A bibliography entry that is not extract material at all.");
    harness.adapter.emit({ kind: "enter", passageId: "p2" });
    await advance(1_100);
    expect(harness.results).toHaveLength(0);
  });

  it("treats a cached verdict from another serving model or classifier as a miss", async () => {
    const base: StoredPassageScore = {
      chunkHash: "unused",
      passageType: "definition",
      extractWorthiness: 0.9,
      suggestedAction: "extract",
      reason: "Cached.",
      classifierVersion: "classifier-a",
      modelRevision: "fake-ondevice\u0000old-model",
      normalizationVersion: "passage-normalization-v1",
      createdAt: "2026-10-20T00:00:00Z",
    };
    const harness = createHarness({ cached: base });
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.controller.getCounters().cacheHits).toBe(0);

    const classifierMiss = createHarness({
      cached: { ...base, modelRevision: "fake-ondevice\u0000model-a", classifierVersion: "classifier-old" },
    });
    classifierMiss.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    classifierMiss.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(classifierMiss.classify).toHaveBeenCalledTimes(1);
    expect(classifierMiss.controller.getCounters().cacheHits).toBe(0);
  });

  it("selection/reflow aborts the in-flight request and suppresses a late result", async () => {
    let resolveClassification!: (value: {
      classification: PassageClassification;
      providerId: string;
    }) => void;
    const harness = createHarness({
      classifyImpl: () =>
        new Promise((resolve) => {
          resolveClassification = resolve;
        }),
    });
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    harness.controller.noteActivity("selection");
    resolveClassification({
      classification: classification(),
      providerId: "fake-ondevice",
    });
    await advance(100);
    expect(harness.results).toHaveLength(0);
    expect(harness.store).not.toHaveBeenCalled();
    expect(harness.controller.getCounters().cancelled).toBeGreaterThan(0);
  });

  it("disable clears indicators, cancels work and stops new encounters", async () => {
    const harness = createHarness();
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.results).toHaveLength(1);

    harness.setEnabled(false);
    expect(harness.cleared).toBe(1);
    harness.adapter.add("p2", "Another precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p2" });
    await advance(2_000);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.controller.getCounters().skippedDisabled).toBeGreaterThan(0);
  });

  it("background suspends work, and resume does not reuse a stale queue silently", async () => {
    const harness = createHarness();
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_000);
    harness.setForeground(false);
    await advance(1_000);
    expect(harness.classify).not.toHaveBeenCalled();
    harness.setForeground(true);
    // Backgrounding discarded the old candidate; a fresh encounter is needed.
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).toHaveBeenCalledTimes(1);
  });

  it("source revision changes invalidate the old owner and suppress late writes", async () => {
    let resolveClassification!: (value: {
      classification: PassageClassification;
      providerId: string;
    }) => void;
    const harness = createHarness({
      classifyImpl: () =>
        new Promise((resolve) => {
          resolveClassification = resolve;
        }),
    });
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    harness.controller.setSourceRevision("rev-2");
    resolveClassification({
      classification: classification(),
      providerId: "fake-ondevice",
    });
    await advance(100);
    expect(harness.results).toHaveLength(0);
    expect(harness.store).not.toHaveBeenCalled();
  });

  it("a dismissed passage never classifies or renders", async () => {
    const harness = createHarness();
    await harness.dismissals.dismiss("p1");
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    expect(harness.classify).not.toHaveBeenCalled();
    expect(harness.results).toHaveLength(0);
    expect(harness.removed).toContain("p1");
    expect(harness.controller.getCounters().skippedDismissed).toBe(1);
  });

  it("dispose detaches the adapter, aborts work and releases the lease", async () => {
    const harness = createHarness({
      classifyImpl: () =>
        new Promise(() => {
          // never resolves (simulates a slow provider)
        }),
    });
    harness.adapter.add("p1", "A precise definition that is worth keeping as an extract.");
    harness.adapter.emit({ kind: "enter", passageId: "p1" });
    await advance(1_100);
    harness.controller.dispose();
    expect(harness.adapter.disposed).toBe(true);
    expect(harness.controller.getCounters().inFlight).toBe(0);
    // No timer may enqueue more work after dispose.
    await advance(5_000);
    expect(harness.classify).toHaveBeenCalledTimes(1);
  });
});
