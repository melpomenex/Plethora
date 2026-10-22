import { describe, expect, it } from "vitest";
import { learningAgentBlockedReason } from "../readinessCopy";
import type { TranslateFn } from "../../../i18n";
import type { FeatureDependency, FeatureReadiness } from "../types";

const COPY: Record<string, string> = {
  "assistant.agent.modeBlocked": "AI setup is not finished yet.",
  "ai.reason.noGenerationRoute": "No generation provider is available.",
  "ai.reason.noEmbeddingRoute": "No embedding provider is configured.",
  "ai.reason.probeUnknown": "The dependency state could not be checked yet.",
  "ai.limitation.lexicalRetrieval": "Lexical evidence only.",
};

/** Mirrors `t()`: missing keys come back verbatim. */
const t: TranslateFn = ((key: string, fallbackOrVars?: string | Record<string, string | number>) => {
  const copy = COPY[key];
  if (copy !== undefined) return copy;
  return typeof fallbackOrVars === "string" ? fallbackOrVars : key;
}) as TranslateFn;

function dependency(
  code: FeatureDependency["code"],
  state: FeatureDependency["state"],
  reasonKey?: string
): FeatureDependency {
  return { code, state, reasonKey };
}

function row(overrides: Partial<FeatureReadiness> = {}): FeatureReadiness {
  return {
    featureId: "learning-agent",
    enabled: true,
    status: "setup-required",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev-1",
    dependencies: [],
    operations: [],
    recoveryActions: [],
    limitations: [],
    ...overrides,
  };
}

describe("learningAgentBlockedReason", () => {
  it("returns null without a probed row", () => {
    expect(learningAgentBlockedReason(undefined, t)).toBeNull();
  });

  it("returns null for a ready row even when it carries limitations", () => {
    const ready = row({
      status: "ready",
      dependencies: [dependency("lexical-retrieval", "degraded", "ai.reason.lexicalOnly")],
      limitations: ["ai.limitation.lexicalRetrieval"],
    });

    expect(learningAgentBlockedReason(ready, t)).toBeNull();
  });

  it("uses the first unmet dependency in registry order", () => {
    const blocked = row({
      dependencies: [
        // Satisfied/degraded dependencies may still carry a reason key; they
        // must never become the blocking reason.
        dependency("generation", "satisfied", "ai.reason.noGenerationRoute"),
        dependency("lexical-retrieval", "degraded", "ai.reason.lexicalOnly"),
        dependency("embeddings", "missing", "ai.reason.noEmbeddingRoute"),
        dependency("index", "unknown", "ai.reason.indexStatusUnknown"),
      ],
      limitations: ["ai.limitation.lexicalRetrieval"],
    });

    expect(learningAgentBlockedReason(blocked, t)).toBe(
      "No embedding provider is configured."
    );
  });

  it("skips an unmet dependency without a reason key", () => {
    const blocked = row({
      dependencies: [
        dependency("source", "missing"),
        dependency("generation", "checking", "ai.reason.probeUnknown"),
      ],
    });

    expect(learningAgentBlockedReason(blocked, t)).toBe(
      "The dependency state could not be checked yet."
    );
  });

  it("falls back when no unmet dependency exposes copy", () => {
    const blocked = row({
      dependencies: [
        dependency("generation", "satisfied", "ai.reason.noGenerationRoute"),
        dependency("source", "missing"),
      ],
      limitations: ["ai.limitation.lexicalRetrieval"],
    });

    expect(learningAgentBlockedReason(blocked, t)).toBe(
      "AI setup is not finished yet."
    );
  });

  it("never renders a raw key when a reason key is untranslated", () => {
    const blocked = row({
      dependencies: [dependency("generation", "missing", "ai.reason.notYetTranslated")],
    });

    const reason = learningAgentBlockedReason(blocked, t);
    expect(reason).toBe("AI setup is not finished yet.");
    expect(reason).not.toMatch(/^[a-z]+\.[a-zA-Z0-9.]+$/);
  });

  it("never uses a limitation as the blocking reason", () => {
    const blocked = row({
      status: "model-download-required",
      limitations: ["ai.limitation.lexicalRetrieval"],
    });

    expect(learningAgentBlockedReason(blocked, t)).toBe(
      "AI setup is not finished yet."
    );
  });
});
