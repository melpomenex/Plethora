import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeCommand = vi.hoisted(() => vi.fn());
vi.mock("../../lib/tauri", () => ({ invokeCommand }));

import {
  cleanupPassageScores,
  getPassageScore,
  getPassageScoreDismissals,
  putPassageScore,
  putPassageScoreDismissal,
  sanitizePassageScoreRecord,
  validatePutPassageScoreInput,
  PassageScoreApiError,
} from "../passage-scores";

const hash = "a".repeat(64);

const row = {
  chunkHash: hash,
  passageType: "definition",
  extractWorthiness: 0.91,
  suggestedAction: "extract",
  model: "provider\u0000model",
  reason: "Defines the term.",
  classifierVersion: "classifier-a",
  modelRevision: "provider\u0000model",
  normalizationVersion: "passage-normalization-v1",
  createdAt: "2026-10-20T00:00:00Z",
};

beforeEach(() => {
  invokeCommand.mockReset();
});

describe("passage score API wire shape", () => {
  it("returns a sanitized record and treats malformed rows as misses", async () => {
    invokeCommand.mockResolvedValueOnce(row);
    await expect(getPassageScore(hash)).resolves.toMatchObject({
      chunkHash: hash,
      passageType: "definition",
      extractWorthiness: 0.91,
      reason: "Defines the term.",
      classifierVersion: "classifier-a",
      modelRevision: "provider\u0000model",
    });
    expect(invokeCommand).toHaveBeenCalledWith("get_passage_score", {
      chunkHash: hash,
      chunk_hash: hash,
    });

    invokeCommand.mockResolvedValueOnce({ ...row, passageType: "invented" });
    await expect(getPassageScore(hash)).resolves.toBeNull();
    invokeCommand.mockResolvedValueOnce({ ...row, extractWorthiness: Number.NaN });
    await expect(getPassageScore(hash)).resolves.toBeNull();
    invokeCommand.mockResolvedValueOnce(null);
    await expect(getPassageScore(hash)).resolves.toBeNull();
  });

  it("validates put input before invoking and sends metadata without source text", async () => {
    invokeCommand.mockResolvedValueOnce(row);
    await putPassageScore({
      chunkHash: hash,
      passageType: "definition",
      extractWorthiness: 0.91,
      suggestedAction: "extract",
      modelRevision: "provider\u0000model",
      classifierVersion: "classifier-a",
      normalizationVersion: "passage-normalization-v1",
      reason: "Defines the term.",
    });
    const args = invokeCommand.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toMatchObject({
      chunkHash: hash,
      passageType: "definition",
      extractWorthiness: 0.91,
      modelRevision: "provider\u0000model",
      classifierVersion: "classifier-a",
      reason: "Defines the term.",
    });
    expect(JSON.stringify(args)).not.toContain("sourceText");

    await expect(
      putPassageScore({
        chunkHash: hash,
        passageType: "definition",
        extractWorthiness: Number.NaN,
      })
    ).rejects.toBeInstanceOf(PassageScoreApiError);
    await expect(
      putPassageScore({
        chunkHash: hash,
        passageType: "definition",
        extractWorthiness: 1.5,
      })
    ).rejects.toBeInstanceOf(PassageScoreApiError);
    await expect(
      putPassageScore({
        chunkHash: hash,
        passageType: "not-a-type" as never,
        extractWorthiness: 0.5,
      })
    ).rejects.toBeInstanceOf(PassageScoreApiError);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(() =>
      validatePutPassageScoreInput({
        chunkHash: hash,
        passageType: "definition",
        extractWorthiness: 0,
        reason: "x".repeat(1_001),
      })
    ).toThrow(PassageScoreApiError);
  });

  it("clamps the persistent cache budget and returns a bounded eviction count", async () => {
    invokeCommand.mockResolvedValueOnce(12);
    await expect(cleanupPassageScores(999_999)).resolves.toBe(12);
    expect(invokeCommand).toHaveBeenCalledWith("cleanup_passage_scores", {
      keepRows: 100_000,
      keep_rows: 100_000,
    });
    invokeCommand.mockResolvedValueOnce("bad");
    await expect(cleanupPassageScores(10_000)).resolves.toBe(0);
  });

  it("roundtrips dismissals and filters invalid rows", async () => {
    invokeCommand.mockResolvedValueOnce([
      {
        documentId: "doc-1",
        sourceRevision: "rev-1",
        passageId: "p1",
        classifierVersion: "c1",
        dismissedAt: "2026-01-01T00:00:00Z",
      },
      { documentId: "doc-1", passageId: "" },
    ]);
    const rows = await getPassageScoreDismissals("doc-1");
    expect(rows).toEqual([
      {
        documentId: "doc-1",
        sourceRevision: "rev-1",
        passageId: "p1",
        classifierVersion: "c1",
        dismissedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    invokeCommand.mockResolvedValueOnce(undefined);
    await putPassageScoreDismissal({
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageId: "p1",
      classifierVersion: "c1",
    });
    expect(invokeCommand).toHaveBeenCalledWith(
      "put_passage_score_dismissal",
      expect.objectContaining({
        documentId: "doc-1",
        sourceRevision: "rev-1",
        passageId: "p1",
        classifierVersion: "c1",
      })
    );
    await expect(
      putPassageScoreDismissal({
        documentId: "",
        sourceRevision: "rev-1",
        passageId: "p1",
        classifierVersion: "c1",
      })
    ).rejects.toBeInstanceOf(PassageScoreApiError);
  });

  it("rejects malformed records directly", () => {
    expect(sanitizePassageScoreRecord(null)).toBeNull();
    expect(sanitizePassageScoreRecord({ ...row, passageType: "x" })).toBeNull();
    expect(sanitizePassageScoreRecord({ ...row, extractWorthiness: 2 })).toBeNull();
    expect(sanitizePassageScoreRecord({ ...row, suggestedAction: "invent" })).toBeNull();
    expect(sanitizePassageScoreRecord(row)).not.toBeNull();
  });
});
