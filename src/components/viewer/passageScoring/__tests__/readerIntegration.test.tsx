import { act, render, screen } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePassageScoring } from "../usePassageScoring";
import { createPassageScoringDeps } from "../deps";
import { DomBlockPassageAdapter, type DomVisibilitySource } from "../adapters/domBlocks";
import { FakeAIProvider } from "../../../../lib/ai/__fixtures__/FakeAIProvider";
import type { PassageScoringControllerDeps } from "../controller";
import { sharedRecentPassageScores, type StoredPassageScore } from "../cache";
import { PASSAGE_CLASSIFIER_VERSION } from "../policy";

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const classifierJson = JSON.stringify({
  type: "definition",
  extractWorthiness: 0.93,
  reason: "Defines the load-bearing term.",
  suggestedLearningAction: "extract",
});

function manualVisibility() {
  const handlers = new Map<Element, { enter: () => void; exit: () => void }>();
  const source: DomVisibilitySource = {
    observe(element, onEnter, onExit) {
      handlers.set(element, { enter: onEnter, exit: onExit });
    },
    unobserve(element) {
      handlers.delete(element);
    },
    disconnect() {
      handlers.clear();
    },
  };
  return {
    source,
    enterAll() {
      for (const handler of handlers.values()) handler.enter();
    },
  };
}

interface HarnessProps {
  sourceRevision: string;
  text: string;
  featureEnabled?: boolean;
  persistent: Map<string, StoredPassageScore>;
  counters: { classifications: number; lookups: number };
  visibilityRef: { current: ReturnType<typeof manualVisibility> | null };
  adapterFactoryCalls: { count: number };
}

function Harness({
  sourceRevision,
  text,
  featureEnabled = true,
  persistent,
  counters,
  visibilityRef,
  adapterFactoryCalls,
}: HarnessProps) {
  const providerRef = useRef(
    new FakeAIProvider({
      id: "fake-ondevice",
      kind: "ondevice",
      responses: [{ requestId: "r1", text: classifierJson }],
    })
  );
  const provider = providerRef.current;

  const adapterFactory = () => {
    adapterFactoryCalls.count += 1;
    const root = document.getElementById("reader-fixture");
    if (!root) return null;
    const visibility = manualVisibility();
    visibilityRef.current = visibility;
    return new DomBlockPassageAdapter({
      ownerToken: "doc-1:html",
      documentId: "doc-1",
      sourceRevision,
      kind: "html",
      roots: [{ doc: document, root }],
      sourceText: () => text,
      observerFactory: () => visibility.source,
    });
  };

  const depsFactory = useMemo((): (() => PassageScoringControllerDeps) => () => {
    const base = createPassageScoringDeps({
      documentId: "doc-1",
      documentTitle: "Fixture",
      sourceRevision,
      durable: false,
    });
    return {
      ...base,
      resolvePolicy: async () => ({
        status: "ready",
        policy: {
          classifierVersion: PASSAGE_CLASSIFIER_VERSION,
          servingRevision: "fake-ondevice\u0000fixture-model",
          providerClass: "android-nano",
          capabilityRevision: "cap-fixture",
          provider,
          providerId: "fake-ondevice",
          destination: {
            providerClass: "android-nano",
            locality: "device",
            keyless: true,
            billable: false,
            sendsOffDevice: false,
            requiresDisclosure: false,
            requiresCostConsent: false,
          },
          remote: false,
          authorized: true,
        },
      }),
      lookup: async (digest) => {
        counters.lookups += 1;
        return persistent.get(digest) ?? null;
      },
      store: async (score) => {
        persistent.set(score.chunkHash, score);
      },
      classify: async (request) => {
        counters.classifications += 1;
        const { runPassageClassification } = await import(
          "../../../../lib/ai/tasks/definitions/passageClassificationTask"
        );
        const result = await runPassageClassification(
          { passage: request.text, documentTitle: "Fixture" },
          {
            provider,
            signal: request.signal,
            targetId: request.targetId,
            observation: request.observation,
          }
        );
        return {
          classification: result.classification,
          providerId: result.run.providerId,
          baseModelName: result.run.baseModelName,
        };
      },
    };
  }, [sourceRevision, provider]);

  const scoring = usePassageScoring({
    documentId: "doc-1",
    documentTitle: "Fixture",
    sourceRevision,
    adapterFactory,
    adapterKey: `${sourceRevision}:${featureEnabled}`,
    isForeground: true,
    featureEnabled,
    durable: false,
    depsFactory,
    skipReadinessGate: true,
  });

  return (
    <div>
      <div id="reader-fixture">
        <p>{text}</p>
      </div>
      <span data-testid="result-count">{scoring.results.length}</span>
      <span data-testid="cache-hits">{scoring.counters.cacheHits}</span>
      <span data-testid="classifications">{scoring.counters.classifications}</span>
    </div>
  );
}

const longText =
  "A definition of the core term explains its scope and the conditions under which it applies to the reader.";

const persistent = new Map<string, StoredPassageScore>();
const counters = { classifications: 0, lookups: 0 };
const visibilityRef: { current: ReturnType<typeof manualVisibility> | null } = { current: null };
const adapterFactoryCalls = { count: 0 };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  persistent.clear();
  sharedRecentPassageScores.clear();
  counters.classifications = 0;
  counters.lookups = 0;
  adapterFactoryCalls.count = 0;
  visibilityRef.current = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reader surface integration (real adapter + classifier + cache)", () => {
  it("encounters a mounted block, classifies once, and reuses the cache on reopen", async () => {
    const first = render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
      />
    );
    await advance(10);
    expect(adapterFactoryCalls.count).toBe(1);
    act(() => visibilityRef.current?.enterAll());
    await advance(1_100);
    expect(screen.getByTestId("classifications").textContent).toBe("1");
    expect(screen.getByTestId("result-count").textContent).toBe("1");
    expect(screen.getByTestId("cache-hits").textContent).toBe("0");
    expect(persistent.size).toBe(1);
    const stored = [...persistent.values()][0];
    expect(stored.reason).toBe("Defines the load-bearing term.");
    expect(stored.classifierVersion).toBeTruthy();
    expect(stored.modelRevision).toBe("fake-ondevice\u0000fixture-model");
    expect(stored.normalizationVersion).toBe("passage-normalization-v1");

    first.unmount();

    // Reopen the same revision: the persistent cache is reused, zero inference.
    render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
      />
    );
    await advance(10);
    act(() => visibilityRef.current?.enterAll());
    await advance(1_100);
    // Counters are per-controller; the shared fake classifier recorded no
    // second inference. The reopen is served from the bounded recent in-memory
    // cache, so only the first controller performed a persistent lookup.
    expect(counters.classifications).toBe(1);
    expect(screen.getByTestId("cache-hits").textContent).toBe("1");
    expect(screen.getByTestId("result-count").textContent).toBe("1");
    expect(counters.lookups).toBe(1);
  });

  it("a source edit changes the revision and misses the old cache entry", async () => {
    persistent.clear();
    counters.classifications = 0;
    counters.lookups = 0;

    const first = render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
      />
    );
    await advance(10);
    act(() => visibilityRef.current?.enterAll());
    await advance(1_100);
    expect(screen.getByTestId("classifications").textContent).toBe("1");
    first.unmount();

    render(
      <Harness
        sourceRevision="rev-2"
        text={`${longText} An edited clause changes the meaning of the definition.`}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
      />
    );
    await advance(10);
    act(() => visibilityRef.current?.enterAll());
    await advance(1_100);
    expect(counters.classifications).toBe(2);
    expect(persistent.size).toBe(2);
  });

  it("disabled creates no adapter, no lookups and no inference", async () => {
    persistent.clear();
    counters.classifications = 0;
    counters.lookups = 0;
    adapterFactoryCalls.count = 0;

    render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        featureEnabled={false}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
      />
    );
    await advance(2_000);
    expect(adapterFactoryCalls.count).toBe(0);
    expect(counters.lookups).toBe(0);
    expect(counters.classifications).toBe(0);
    expect(screen.getByTestId("result-count").textContent).toBe("0");
  });
});
