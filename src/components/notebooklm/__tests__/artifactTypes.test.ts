import { describe, expect, it } from "vitest";
import {
  assertArtifactTypeCoverage,
  canImportArtifactType,
  canViewArtifactType,
  isPayloadBackedArtifactType,
  isStructuredArtifactType,
  normalizeArtifactType,
  STUDIO_ARTIFACT_TYPES,
} from "../artifactTypes";

describe("artifact type normalization", () => {
  it("normalizes the three spellings in play to the canonical id", () => {
    // UI kebab-case
    expect(normalizeArtifactType("mind-map")).toBe("mind-map");
    expect(normalizeArtifactType("data-table")).toBe("data-table");
    expect(normalizeArtifactType("slide-deck")).toBe("slide-deck");
    // Python snake_case
    expect(normalizeArtifactType("mind_map")).toBe("mind-map");
    expect(normalizeArtifactType("data_table")).toBe("data-table");
    expect(normalizeArtifactType("slide_deck")).toBe("slide-deck");
    // Rust normalize_cli_type output (already kebab, lowercased)
    expect(normalizeArtifactType("STUDY_GUIDE")).toBe("study-guide");
    expect(normalizeArtifactType("Mind Map")).toBe("mind-map");
  });

  it("maps historical joined spellings", () => {
    expect(normalizeArtifactType("mindmap")).toBe("mind-map");
    expect(normalizeArtifactType("datatable")).toBe("data-table");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeArtifactType("  MIND-MAP  ")).toBe("mind-map");
  });
});

describe("capability lookups", () => {
  it("treats every studio tile as importable", () => {
    for (const type of STUDIO_ARTIFACT_TYPES) {
      expect(canImportArtifactType(type), type).toBe(true);
    }
  });

  it("viewer covers media and structured types but not flashcards/quiz", () => {
    expect(canViewArtifactType("audio")).toBe(true);
    expect(canViewArtifactType("video")).toBe(true);
    expect(canViewArtifactType("mind-map")).toBe(true);
    expect(canViewArtifactType("slide-deck")).toBe(true);
    expect(canViewArtifactType("infographic")).toBe(true);
    expect(canViewArtifactType("flashcards")).toBe(false);
    expect(canViewArtifactType("quiz")).toBe(false);
  });

  it("export is limited to payload-backed types", () => {
    for (const type of ["flashcards", "quiz", "report", "study-guide", "mind-map", "data-table"]) {
      expect(isPayloadBackedArtifactType(type), type).toBe(true);
    }
    for (const type of ["audio", "video", "slide-deck", "infographic"]) {
      expect(isPayloadBackedArtifactType(type), type).toBe(false);
    }
  });

  it("recognizes structured types across spellings", () => {
    expect(isStructuredArtifactType("mind-map")).toBe(true);
    expect(isStructuredArtifactType("data_table")).toBe(true);
    expect(isStructuredArtifactType("report")).toBe(false);
  });
});

describe("coverage assert", () => {
  it("passes when every studio tile has an import path and backend dispatch", () => {
    // The assert throws if a tile is missing from either set — this is the
    // check that would have caught slide-deck/infographic being viewable
    // with no way to generate or import them.
    expect(() => assertArtifactTypeCoverage()).not.toThrow();
  });
});
