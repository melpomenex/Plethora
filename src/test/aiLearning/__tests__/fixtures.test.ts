import { describe, expect, it } from "vitest";
import {
  FIXTURE_MANIFEST,
  PLATFORM_PROFILES,
  QUALIFICATION_MATRIX,
  validateQualificationMatrix,
  fixtureHash,
  AI_LEARNING_FEATURES,
} from "../fixtures";
import {
  resolveCellState,
  validateEvidenceRecord,
  validateEvidenceManifest,
  type EvidenceRecord,
} from "../evidence";

const CONTEXT = {
  releaseCommit: "abc123",
  capabilityRevision: "cap-1",
};

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev-1",
    cellId: "linux:learn-this",
    feature: "learn-this",
    platform: "linux",
    commit: "abc123",
    appVersion: "3.4.0",
    osVersion: "Linux 6.12",
    runtimeVersion: "WebKit 2.48",
    capabilityRevision: "cap-1",
    layer: "desktop-real-provider",
    fixtureHashes: [FIXTURE_MANIFEST[0].hash],
    outcome: "pass",
    exercisedStages: ["generation", "validation", "preview", "persistence"],
    redactedEvidencePath: "docs/ai-learning-readiness/evidence/linux-learn-this.json",
    command: "npm run test:ai:fixtures -- linux learn-this",
    host: "linux-desktop-ollama",
    owner: "release-owner",
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("synthetic fixture manifest", () => {
  it("contains no personal content and stable content hashes", () => {
    for (const fixture of FIXTURE_MANIFEST) {
      expect(fixture.hash).toBe(fixtureHash(fixture.kind, fixture.content));
      expect(fixture.id).toMatch(/^fixture-/);
      expect(fixture.title).not.toMatch(/\/Users\/|C:\\\\|sk-live/);
    }
  });

  it("covers every supported reader format and the hard cases", () => {
    const kinds = new Set(FIXTURE_MANIFEST.map((fixture) => fixture.kind));
    for (const kind of ["pdf", "epub", "html", "markdown", "text", "rss", "image", "reflow"]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    const ids = FIXTURE_MANIFEST.map((fixture) => fixture.id);
    expect(ids).toContain("fixture-malicious-directive");
    expect(ids).toContain("fixture-stale-revision");
    expect(ids).toContain("fixture-duplicate-cards");
    expect(ids).toContain("fixture-two-papers-a");
    expect(ids).toContain("fixture-two-papers-b");
  });
});

describe("qualification matrix", () => {
  it("has one cell per profile/feature pair and starts nothing as passed", () => {
    expect(validateQualificationMatrix()).toEqual([]);
    expect(QUALIFICATION_MATRIX).toHaveLength(PLATFORM_PROFILES.length * AI_LEARNING_FEATURES.length);
    expect(QUALIFICATION_MATRIX.every((cell) => cell.state !== "pass")).toBe(true);
  });

  it("requires real execution evidence for native profiles", () => {
    const android = QUALIFICATION_MATRIX.find((cell) => cell.id === "android-nano:learn-this")!;
    expect(android.requiredLayers).toContain("physical-device");
    const mockOnly = record({
      cellId: android.id,
      platform: "android-nano",
      layer: "mock-integration",
    });
    expect(resolveCellState(android, [mockOnly], CONTEXT)).toBe("pending");
  });

  it("does not let an emulator substitute a physical device", () => {
    const ios = QUALIFICATION_MATRIX.find((cell) => cell.id === "ios:learning-agent")!;
    const emulator = record({
      cellId: ios.id,
      feature: "learning-agent",
      platform: "ios",
      layer: "emulator",
      exercisedStages: ["preflight", "retrieval", "generation", "validation", "persistence"],
    });
    expect(resolveCellState(ios, [emulator], CONTEXT)).toBe("pending");
  });
});

describe("evidence validation", () => {
  it("accepts a complete current record", () => {
    expect(validateEvidenceRecord(record(), CONTEXT)).toEqual([]);
  });

  it("rejects a stale commit or capability revision", () => {
    expect(validateEvidenceRecord(record({ commit: "old" }), CONTEXT)).toContain(
      "ev-1: commit old is not the release commit"
    );
    expect(
      validateEvidenceRecord(record({ capabilityRevision: "cap-0" }), CONTEXT)
    ).toContain("ev-1: stale capability revision");
  });

  it("rejects a missing stage even when generation succeeded", () => {
    const problems = validateEvidenceRecord(
      record({ exercisedStages: ["generation", "validation"] }),
      CONTEXT
    );
    expect(problems.some((problem) => problem.includes("missing required stages"))).toBe(true);
  });

  it("rejects metrics without units and failed evidence without an owner blocker", () => {
    const problems = validateEvidenceRecord(
      record({ metrics: [{ name: "frame", value: 12, unit: "" }] }),
      CONTEXT
    );
    expect(problems.some((problem) => problem.includes("no unit"))).toBe(true);

    const failed = validateEvidenceRecord(
      record({ outcome: "fail", blockerId: undefined }),
      { ...CONTEXT, requiredStages: {} }
    );
    expect(failed.some((problem) => problem.includes("blocker"))).toBe(true);
  });

  it("can resolve a cell to pass only with every required layer current", () => {
    const linux = QUALIFICATION_MATRIX.find((cell) => cell.id === "linux:learn-this")!;
    const unit = record({ id: "ev-unit", cellId: linux.id, layer: "unit" });
    const mock = record({ id: "ev-mock", cellId: linux.id, layer: "mock-integration" });
    const real = record({ id: "ev-real", cellId: linux.id, layer: "desktop-real-provider" });
    expect(resolveCellState(linux, [unit, mock], CONTEXT)).toBe("pending");
    expect(resolveCellState(linux, [unit, mock, real], CONTEXT)).toBe("pass");
  });

  it("validates a whole manifest and catches duplicate ids", () => {
    const manifest = {
      schemaVersion: "ai-learning-evidence-v1" as const,
      releaseCommit: "abc123",
      capabilityRevision: "cap-1",
      records: [record(), record()],
    };
    const problems = validateEvidenceManifest(manifest);
    expect(problems.some((problem) => problem.includes("duplicate evidence id"))).toBe(true);
  });
});
