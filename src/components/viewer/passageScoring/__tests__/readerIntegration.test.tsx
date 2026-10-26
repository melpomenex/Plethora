import { act, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePassageScoring } from "../usePassageScoring";
import { PassageScoreOverlay } from "../PassageScoreOverlay";
import { createPassageScoringDeps } from "../deps";
import { DomBlockPassageAdapter, type DomVisibilitySource } from "../adapters/domBlocks";
import { FakeAIProvider } from "../../../../lib/ai/__fixtures__/FakeAIProvider";
import type { PassageScoringControllerDeps } from "../controller";
import { sharedRecentPassageScores, type StoredPassageScore } from "../cache";
import {
  PASSAGE_CLASSIFIER_VERSION,
  type PassagePolicyResolution,
  type ResolvedPassageScoringPolicy,
} from "../policy";

const readinessState = vi.hoisted(() => ({
  status: "ready" as "ready" | "setup-required",
}));

vi.mock("../../../../lib/ai/features/useFeatureReadiness", () => ({
  useFeatureReadiness: () => ({
    rows: [{
      featureId: "extract-worthiness",
      enabled: true,
      status: readinessState.status,
      checkedAt: 1,
      checking: false,
      dependencyRevision: "readiness-fixture",
      dependencies: [],
      operations: [],
      recoveryActions: [],
      limitations: [],
    }],
    context: null,
    loading: false,
    checkedAt: 1,
    revision: "readiness-fixture",
    refresh: vi.fn(),
  }),
}));

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
  remoteAuthorizationDenied?: boolean;
  skipReadinessGate?: boolean;
  showOverlay?: boolean;
  persistent: Map<string, StoredPassageScore>;
  counters: { classifications: number; lookups: number };
  visibilityRef: { current: ReturnType<typeof manualVisibility> | null };
  adapterFactoryCalls: { count: number };
}

function Harness({
  sourceRevision,
  text,
  featureEnabled = true,
  remoteAuthorizationDenied = false,
  skipReadinessGate = true,
  showOverlay = false,
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
      resolvePolicy: async () => {
        const policy: ResolvedPassageScoringPolicy = {
          classifierVersion: PASSAGE_CLASSIFIER_VERSION,
          servingRevision: "fake-ondevice\u0000fixture-model",
          providerClass: remoteAuthorizationDenied ? "configured-external" : "android-nano",
          capabilityRevision: "cap-fixture",
          provider,
          providerId: "fake-ondevice",
          destination: remoteAuthorizationDenied
            ? {
                providerClass: "configured-external",
                locality: "remote",
                keyless: true,
                billable: false,
                sendsOffDevice: true,
                requiresDisclosure: true,
                requiresCostConsent: false,
              }
            : {
                providerClass: "android-nano",
                locality: "device",
                keyless: true,
                billable: false,
                sendsOffDevice: false,
                requiresDisclosure: false,
                requiresCostConsent: false,
              },
          remote: remoteAuthorizationDenied,
          authorized: !remoteAuthorizationDenied,
        };
        const resolution: PassagePolicyResolution = remoteAuthorizationDenied
          ? {
              status: "denied-remote",
              policy,
              reasonKey: "ai.passageScoring.remoteAuthorizationRequired",
            }
          : { status: "ready", policy };
        return resolution;
      },
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
  }, [sourceRevision, provider, remoteAuthorizationDenied]);

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
    skipReadinessGate,
  });

  return (
    <div>
      <div id="reader-fixture">
        <p>{text}</p>
      </div>
      <span data-testid="result-count">{scoring.results.length}</span>
      <span data-testid="cache-hits">{scoring.counters.cacheHits}</span>
      <span data-testid="classifications">{scoring.counters.classifications}</span>
      <span data-testid="scoring-status">{scoring.status}</span>
      <span data-testid="status-reason">{scoring.statusReasonKey ?? ""}</span>
      <span data-testid="scoring-visible">{String(scoring.visible)}</span>
      <span data-testid="open-passage-id">{scoring.openPassageId ?? ""}</span>
      {showOverlay ? (
        <PassageScoreOverlay
          results={scoring.results}
          projectRects={() => [{ x: 300, y: 200, width: 220, height: 40 }]}
          narrow={false}
          visible={scoring.visible}
          openPassageId={scoring.openPassageId}
          onOpen={scoring.openSuggestion}
          onClose={scoring.closeSuggestion}
          onAction={scoring.performAction}
          onDismiss={scoring.dismiss}
          onShowSource={scoring.showSource}
          statusReasonKey={scoring.statusReasonKey}
        />
      ) : null}
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
  readinessState.status = "ready";
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
        showOverlay
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

    const marker = screen.getByRole("button", { name: /ai\.passageScoring\.indicatorLabel/ });
    fireEvent.click(marker);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("open-passage-id").textContent).not.toBe("");

    first.rerender(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        featureEnabled={false}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
        showOverlay
      />
    );
    expect(screen.getByTestId("result-count").textContent).toBe("0");
    expect(screen.getByTestId("open-passage-id").textContent).toBe("");
    expect(screen.getByTestId("scoring-status").textContent).toBe("disabled");
    expect(screen.getByTestId("scoring-visible").textContent).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(first.container.querySelector("[data-passage-scoring-ui]")).toBeNull();

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

  it("clears a remote authorization warning immediately when scoring is disabled", async () => {
    const mounted = render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        remoteAuthorizationDenied
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
        showOverlay
      />
    );
    await advance(10);
    act(() => visibilityRef.current?.enterAll());
    await advance(1_100);

    expect(screen.getByRole("status")).toHaveTextContent(
      "ai.passageScoring.remoteAuthorizationRequired"
    );
    expect(screen.getByTestId("scoring-visible").textContent).toBe("true");

    mounted.rerender(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        featureEnabled={false}
        remoteAuthorizationDenied
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
        showOverlay
      />
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("status-reason").textContent).toBe("");
    expect(screen.getByTestId("scoring-status").textContent).toBe("disabled");
    expect(screen.getByTestId("scoring-visible").textContent).toBe("false");
    expect(mounted.container.querySelector("[data-passage-scoring-ui]")).toBeNull();
  });

  it("keeps model readiness warnings visible only while scoring is enabled", () => {
    readinessState.status = "setup-required";
    const mounted = render(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        skipReadinessGate={false}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
        showOverlay
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "ai.passageScoring.unavailableModel"
    );
    expect(screen.getByTestId("scoring-visible").textContent).toBe("true");

    mounted.rerender(
      <Harness
        sourceRevision="rev-1"
        text={longText}
        featureEnabled={false}
        skipReadinessGate={false}
        persistent={persistent}
        counters={counters}
        visibilityRef={visibilityRef}
        adapterFactoryCalls={adapterFactoryCalls}
        showOverlay
      />
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("scoring-visible").textContent).toBe("false");
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
