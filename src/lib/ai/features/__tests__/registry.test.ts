import { describe, expect, it } from "vitest";
import {
  evaluateFeatureReadiness,
  findFeatureReadiness,
  summarizeActivation,
} from "../registry";
import { planEnableAll, buildEnableAllFeaturesPatch } from "../activation";
import {
  FEATURE_DESCRIPTORS,
  FEATURE_IDS,
  type FeatureDependencyContext,
} from "../types";

function makeContext(
  overrides: Partial<FeatureDependencyContext> = {}
): FeatureDependencyContext {
  return {
    revision: "rev-1",
    checkedAt: 1_000,
    checking: false,
    flags: {
      aiLearnThis: true,
      aiLibraryRag: true,
      aiSocraticTutor: true,
      aiOcclusionAssist: true,
      aiSemanticIndex: true,
      aiAnswerAssessment: true,
      aiPrerequisites: true,
      aiConceptLinks: true,
      aiExtractWorthiness: true,
      aiAgent: true,
      aiActiveRecall: true,
    },
    activeRecallMode: "auto",
    platform: { os: "linux", mobile: false },
    generation: {
      state: "available",
      detail: {
        providerClass: "ollama-local",
        destination: "loopback",
        reasoning: true,
        vision: false,
      },
    },
    embeddings: {
      state: "available",
      detail: {
        providerClass: "ollama-local",
        destination: "loopback",
        lexicalFallback: true,
      },
    },
    ocr: { state: "available" },
    index: { state: "ready", detail: { completeness: "complete" } },
    relationships: {
      state: "available",
      detail: { prerequisites: true, links: true },
    },
    passageAdapter: { state: "available" },
    source: { state: "available" },
    disclosure: { state: "available" },
    billing: { state: "available" },
    ...overrides,
  };
}

describe("feature readiness registry", () => {
  it("registers exactly the ten program features", () => {
    expect(FEATURE_IDS).toHaveLength(10);
    expect(Object.keys(FEATURE_DESCRIPTORS)).toHaveLength(10);
    for (const id of FEATURE_IDS) {
      expect(FEATURE_DESCRIPTORS[id].id).toBe(id);
    }
  });

  it("is ready when every dependency is satisfied", () => {
    const rows = evaluateFeatureReadiness(makeContext());
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.status, row.featureId).toBe("ready");
      expect(row.checkedAt).toBe(1_000);
      expect(row.dependencyRevision).toBe("rev-1");
    }
  });

  it("reports disabled for an explicit false preference and offers no recovery", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({ flags: { ...makeContext().flags, aiLearnThis: false } })
    );
    const learn = findFeatureReadiness(rows, "learn-this")!;
    expect(learn.enabled).toBe(false);
    expect(learn.status).toBe("disabled");
    expect(learn.recoveryActions).toEqual([]);
    expect(learn.dependencies.map((d) => d.code)).toContain("feature-enabled");
  });

  it("never reports ready while a probe is checking", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        checking: true,
        generation: { state: "checking" },
      })
    );
    const learn = findFeatureReadiness(rows, "learn-this")!;
    expect(learn.checking).toBe(true);
    expect(learn.status).toBe("checking");
  });

  it("distinguishes a downloadable model from a missing provider", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        generation: {
          state: "unavailable",
          modelDownloadRequired: true,
          setupAvailable: true,
        },
      })
    );
    const learn = findFeatureReadiness(rows, "learn-this")!;
    expect(learn.status).toBe("model-download-required");
    expect(learn.dependencies.some((d) => d.code === "model")).toBe(true);
    expect(learn.recoveryActions.map((a) => a.targetId)).toContain("ai.onDevice");
  });

  it("degrades library RAG to lexical instead of calling embeddings a total outage", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        embeddings: {
          state: "unavailable",
          reasonKey: "ai.reason.paidEmbeddingsConsent",
          detail: {
            providerClass: "configured-external",
            destination: "remote",
            lexicalFallback: true,
          },
        },
        index: { state: "ready", detail: { completeness: "partial" } },
      })
    );
    const library = findFeatureReadiness(rows, "library-rag")!;
    expect(library.status).toBe("ready");
    expect(library.limitations).toContain("ai.limitation.lexicalRetrieval");
    expect(library.operations.find((o) => o.operationId === "retrieval")?.status).toBe("ready");

    // Semantic indexing itself is NOT ready without embeddings.
    const index = findFeatureReadiness(rows, "semantic-index")!;
    expect(index.status).toBe("setup-required");
    expect(index.dependencies.some((d) => d.code === "embeddings" && d.state === "missing")).toBe(true);
  });

  it("keeps knowledge prerequisites and concept links independent", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({ flags: { ...makeContext().flags, aiConceptLinks: false } })
    );
    const knowledge = findFeatureReadiness(rows, "knowledge-relationships")!;
    expect(knowledge.enabled).toBe(true);
    const prerequisites = knowledge.operations.find((o) => o.operationId === "prerequisites")!;
    const links = knowledge.operations.find((o) => o.operationId === "links")!;
    expect(prerequisites.status).toBe("ready");
    expect(links.status).toBe("disabled");
    expect(knowledge.status).toBe("ready");
  });

  it("reports platform-unavailable only for an unsupported native route", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({ generation: { state: "unsupported", reasonKey: "ai.reason.platformUnsupported" } })
    );
    expect(findFeatureReadiness(rows, "learn-this")!.status).toBe("unavailable-platform");
  });

  it("shows indexing while a required index is building", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({ index: { state: "indexing", detail: { completeness: "partial", documentsPending: 3 } } })
    );
    expect(findFeatureReadiness(rows, "library-rag")!.status).toBe("indexing");
  });

  it("keeps active recall disabled when the interaction mode is off", () => {
    const rows = evaluateFeatureReadiness(makeContext({ activeRecallMode: "off" }));
    const recall = findFeatureReadiness(rows, "active-recall")!;
    expect(recall.status).toBe("disabled");
    expect(recall.operations[0].dependencies.some((d) => d.code === "recall-mode")).toBe(true);
  });

  it("requires OCR and generation separately for occlusion", () => {
    const rows = evaluateFeatureReadiness(makeContext({ ocr: { state: "unavailable" } }));
    const occlusion = findFeatureReadiness(rows, "occlusion-assist")!;
    expect(occlusion.status).toBe("setup-required");
    expect(occlusion.operations.find((o) => o.operationId === "ocr")!.status).toBe("setup-required");
    expect(occlusion.operations.find((o) => o.operationId === "region-proposals")!.status).toBe("setup-required");
  });

  it("summarizes activation without counting booleans as ready", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        generation: {
          state: "unavailable",
          modelDownloadRequired: true,
        },
      })
    );
    const summary = summarizeActivation(rows);
    expect(summary.total).toBe(10);
    // Only semantic indexing does not need a generation route; every other
    // feature must stay out of "ready" while generation is model-download.
    expect(summary.ready).toBe(1);
    expect(summary.needsSetup).toBeGreaterThan(0);
  });

  it("requires cloud disclosure for a remote generation destination", () => {
    const remote = {
      providerClass: "configured-external" as const,
      destination: "remote" as const,
      reasoning: true,
      vision: false,
    };
    const blocked = evaluateFeatureReadiness(
      makeContext({
        generation: { state: "available", detail: remote },
        disclosure: { state: "unavailable", reasonKey: "ai.reason.disclosureRequired" },
      })
    );
    expect(findFeatureReadiness(blocked, "learn-this")!.status).toBe("setup-required");

    const allowed = evaluateFeatureReadiness(
      makeContext({
        generation: { state: "available", detail: remote },
        disclosure: { state: "available" },
      })
    );
    expect(findFeatureReadiness(allowed, "learn-this")!.status).toBe("ready");
  });

  it("requires disclosure for a LAN Ollama destination (keyless is not local)", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        generation: {
          state: "degraded",
          detail: {
            providerClass: "ollama-local",
            destination: "lan",
            reasoning: false,
            vision: false,
          },
        },
        disclosure: { state: "unavailable", reasonKey: "ai.reason.disclosureRequired" },
      })
    );
    expect(findFeatureReadiness(rows, "library-rag")!.status).toBe("setup-required");
  });

  it("reports a permitted configured route when the native model is unavailable", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        platform: { os: "windows", mobile: false },
        generation: {
          state: "degraded",
          reasonKey: "ai.reason.nativeModelUnavailable",
          detail: {
            providerClass: "foundry-local",
            destination: "loopback",
            reasoning: false,
            vision: false,
          },
        },
      })
    );
    const learn = findFeatureReadiness(rows, "learn-this")!;
    expect(learn.status).toBe("ready");
    expect(learn.provider?.providerClass).toBe("foundry-local");
    expect(learn.dependencies.find((d) => d.code === "generation")?.state).toBe("degraded");
  });

  it("keeps each native route distinct in the provider summary", () => {
    for (const providerClass of ["android-nano", "apple-native", "windows-system"] as const) {
      const rows = evaluateFeatureReadiness(
        makeContext({
          generation: {
            state: "available",
            detail: {
              providerClass,
              destination: "device",
              reasoning: true,
              vision: false,
            },
          },
        })
      );
      expect(findFeatureReadiness(rows, "learn-this")!.provider?.providerClass).toBe(providerClass);
      expect(findFeatureReadiness(rows, "learn-this")!.status).toBe("ready");
    }
  });
});

describe("Enable All planning", () => {
  it("enables supported preferences and preserves unsupported ones", () => {
    const rows = evaluateFeatureReadiness(
      makeContext({
        // Only extract-worthiness is unsupported on this profile.
        passageAdapter: { state: "unsupported", reasonKey: "ai.reason.readerUnsupported" },
        flags: { ...makeContext().flags, aiLearnThis: false, aiAgent: false },
      })
    );
    const plan = planEnableAll(rows, { aiLearnThis: false, aiAgent: false });
    expect(plan.updates.aiAgent).toBe(true);
    expect(plan.updates.aiExtractWorthiness).toBeUndefined();
    expect(plan.updates.aiLearnThis).toBe(true);
    expect(plan.preservedFeatureIds).toContain("extract-worthiness");
    expect(plan.preservedFeatureIds).not.toContain("learn-this");
    expect(
      plan.outcomes.find((o) => o.featureId === "extract-worthiness")!.preserved
    ).toBe(true);

    const patch = buildEnableAllFeaturesPatch(plan, {
      aiLearnThis: false,
      aiAgent: false,
      aiExtractWorthiness: true,
    });
    expect(patch.aiAgent).toBe(true);
    expect(patch.aiLearnThis).toBe(true);
    // Preserved preferences are never part of the patch, so an unsupported
    // feature cannot be silently changed by this action.
    expect(patch.aiExtractWorthiness).toBeUndefined();
  });

  it("never includes consent/provider/freeform/recall-mode keys", () => {
    const rows = evaluateFeatureReadiness(makeContext());
    const plan = planEnableAll(rows, {});
    const patch = buildEnableAllFeaturesPatch(plan, {
      aiOcclusionFreeform: false,
      aiLearnThis: false,
    });
    const keys = Object.keys(patch);
    expect(keys).not.toContain("aiOcclusionFreeform");
    expect(keys).not.toContain("allowCloudFallback");
    expect(keys).not.toContain("preferOnDevice");
    expect(keys).not.toContain("paidEmbeddingsEnabled");
    expect(keys).not.toContain("activeRecallMode");
    expect(patch.aiOcclusionFreeform).toBeUndefined();
  });

  it("treats checking rows as unsupported so it cannot overclaim", () => {
    const rows = evaluateFeatureReadiness(makeContext({ generation: { state: "checking" } }));
    const plan = planEnableAll(rows, {});
    expect(plan.preservedFeatureIds.length).toBeGreaterThan(0);
  });
});
