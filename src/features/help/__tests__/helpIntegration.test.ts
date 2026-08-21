/**
 * End-to-End Integration Tests for Canonical Product Documentation & Ask Plethora
 */

import { describe, it, expect, vi } from "vitest";
import { classifyPaletteInput } from "../helpIntent";
import { defaultHelpRetrieval } from "../helpRetrieval";
import { getDirectLookupResult } from "../directLookup";
import { dispatchRegisteredHelpAction } from "../registeredHelpActions";
import { askPlethora } from "../../../lib/ai/tasks/definitions/askPlethoraTask";

describe("Help System End-to-End Integration", () => {
  it("integrates explicit ? prefix with hybrid search and Ask Plethora RAG", async () => {
    const rawInput = "? how do I enable E-ink mode";
    const intent = classifyPaletteInput(rawInput);

    expect(intent.kind).toBe("product_help");
    if (intent.kind === "product_help") {
      expect(intent.forcedPrefix).toBe(true);
      expect(intent.query).toBe("how do I enable E-ink mode");

      // Hybrid Retrieval
      const searchResults = defaultHelpRetrieval.search(intent.query, { limit: 3 });
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].chunk.docId).toBe("platform.eink");

      // Ask Plethora RAG Pipeline
      const ragRes = await askPlethora({ query: intent.query });
      expect(ragRes.answer.evidenceLevel).toBe("supported");
      expect(ragRes.answer.answer.length).toBeGreaterThan(20);
      expect(ragRes.usedChunks.length).toBeGreaterThan(0);
    }
  });

  it("integrates direct canonical alias lookup with zero-latency action dispatch", () => {
    const rawInput = "e-ink mode";
    const intent = classifyPaletteInput(rawInput);

    expect(intent.kind).toBe("direct_lookup");
    if (intent.kind === "direct_lookup") {
      expect(intent.directResult.featureId).toBe("platform.eink");
      expect(intent.directResult.primaryAction?.id).toBe("settings.appearance.eink");

      // Dispatch action
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      const dispatched = dispatchRegisteredHelpAction(intent.directResult.primaryAction!.id);
      expect(dispatched).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "navigate",
          detail: "/settings?tab=appearance&panel=eink",
        })
      );
      dispatchSpy.mockRestore();
    }
  });

  it("integrates section navigation commands seamlessly", () => {
    const rawInput = "Dashboard";
    const intent = classifyPaletteInput(rawInput);

    expect(intent.kind).toBe("navigation");
    if (intent.kind === "navigation") {
      expect(intent.targetPath).toBe("/dashboard");
    }
  });

  it("retrieves full document article metadata for in-depth reading", () => {
    const doc = defaultHelpRetrieval.getDocument("scheduler.fsrs");
    expect(doc).toBeDefined();
    expect(doc?.id).toBe("scheduler.fsrs");
    expect(doc?.title).toBe("FSRS-6 Spaced Repetition");
    expect(doc?.sections["Exact Behavioral Rules"]).toBeDefined();
    expect(doc?.actions?.length).toBeGreaterThan(0);
    expect(doc?.settings).toContain("scheduler.fsrs.requestRetention");
  });
});
