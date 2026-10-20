import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../lib/tauri", () => ({ invokeCommand: invoke }));

import {
  canonicalConceptLinkFingerprint,
  conceptLinkEndpointKey,
  conceptLinkFingerprintDismissed,
  getConceptEvidenceAnnotation,
  normalizeConceptName,
  saveConceptLinkSuggestions,
  updateConceptLink,
} from "../concept-links";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
});

describe("concept-link command adapter", () => {
  it("mirrors Rust normalize_concept_name (lowercase + collapse Unicode whitespace)", () => {
    expect(normalizeConceptName("  Context-Free   Grammars ")).toBe("context-free grammars");
    expect(normalizeConceptName("Parse\u00a0Trees")).toBe("parse trees");
    expect(normalizeConceptName("PARSE\tTREES")).toBe("parse trees");
    expect(normalizeConceptName("   ")).toBe("");
  });

  it("builds directional and symmetric fingerprints deterministically", () => {
    expect(conceptLinkEndpointKey(" Concept ", " id ")).toBe("concept:id");
    const same = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "a",
      targetKind: "concept",
      targetId: "b",
      relationType: "same-as",
    });
    const reversed = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "b",
      targetKind: "concept",
      targetId: "a",
      relationType: "same-as",
    });
    expect(same).toBe(reversed);
    expect(same).toContain("policy=relationship-policy-v1");
  });

  it("serializes the transactional save batch and unresolved concept handles", async () => {
    invoke.mockResolvedValue([]);
    await saveConceptLinkSuggestions({
      analysisId: "analysis-1",
      proposals: [
        {
          sourceKind: "concept",
          sourceId: "draft:concept:0",
          targetKind: "document",
          targetId: "doc-1",
          relationType: "prerequisite-of",
          confidence: 0.9,
          sourceRevision: "rev-1",
          provenance: { taskId: "concept-relationship-analysis", origin: "ai" },
          fingerprint: "fp-1",
        },
      ],
      newConcepts: [{ handle: "draft:concept:0", name: "Gravity" }],
    });
    expect(invoke).toHaveBeenCalledWith("save_concept_link_suggestions", {
      analysisId: "analysis-1",
      proposals: [
        expect.objectContaining({
          sourceKind: "concept",
          sourceId: "draft:concept:0",
          relationType: "prerequisite-of",
          provenance: { taskId: "concept-relationship-analysis", origin: "ai" },
        }),
      ],
      newConcepts: [{ handle: "draft:concept:0", name: "Gravity" }],
    });
  });

  it("serializes a narrow edit and annotation evidence read", async () => {
    invoke.mockResolvedValue({ outcome: "updated" });
    await updateConceptLink({
      linkId: "link-1",
      relationType: "supports",
      confidence: 0.8,
    });
    expect(invoke).toHaveBeenCalledWith("update_concept_link", {
      linkId: "link-1",
      relationType: "supports",
      confidence: 0.8,
      sourceKind: null,
      sourceId: null,
      targetKind: null,
      targetId: null,
      sourceRevision: null,
    });

    invoke.mockResolvedValue(null);
    await getConceptEvidenceAnnotation("annotation-1");
    expect(invoke).toHaveBeenCalledWith("get_concept_evidence_annotation", {
      annotationId: "annotation-1",
    });
  });

  it("pre-checks dismissal by canonical fingerprint", async () => {
    invoke.mockResolvedValue(true);
    await expect(conceptLinkFingerprintDismissed("fp-1")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("concept_link_fingerprint_dismissed", {
      fingerprint: "fp-1",
    });
  });
});
