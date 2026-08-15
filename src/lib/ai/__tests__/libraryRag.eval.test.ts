/**
 * Semantic evaluation of the "Ask library" RAG task over labeled fixtures
 * (design D29, task 4.12): canned retrieval + structured outputs replayed
 * through the REAL `askLibrary` pipeline (retrieve-injection → dedup →
 * budget → `runTask` → validation) via `FakeAIProvider` — CI never needs
 * hardware or an indexed library. Assertions are structural (evidence level,
 * surviving citations, containment, provider provenance), never prose.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { askLibrary } from "../tasks/definitions/libraryTask";
import { findUntrustedLeaks } from "../tasks/containment";
import { isAIError } from "../errors";
import type { RetrievalResponse } from "../../../api/ai-learning";
import { ALL_LIBRARY_RAG_EVAL_CASES } from "../__fixtures__/eval/library-rag/cases";

function providerFor(responseText: string, structured = false): FakeAIProvider {
  return new FakeAIProvider({
    id: "fake-ondevice",
    kind: "ondevice",
    capabilities: { structuredGeneration: structured },
    responses: structured
      ? [{ requestId: "fake-structured", structured: JSON.parse(responseText), text: "" }]
      : [{ requestId: "fake-text", text: responseText }],
  });
}

function fakeRetrieve(response: RetrievalResponse) {
  return async () => response;
}

describe("library-rag eval fixtures through the real pipeline (design D29)", () => {
  it.each(ALL_LIBRARY_RAG_EVAL_CASES)(
    "$label: validates evidence level and surviving citations",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      const result = await askLibrary({
        query: fixture.query,
        retrieve: fakeRetrieve({ results: fixture.retrieved, mode: "semantic", candidatesScanned: 42 }),
        provider,
      });

      // Structural semantics: evidence level matches the label and exactly
      // the expected chunk refs survived validation.
      expect(result.answer.evidenceLevel).toBe(fixture.expectedEvidenceLevel);
      expect(result.sources.map((s) => s.chunkId)).toEqual(fixture.expectedCitedChunkIds);

      // The cited sources carry navigation metadata for the UI (task 4.10).
      for (const source of result.sources) {
        expect(source.documentId).toBeTruthy();
        expect(source.text.length).toBeGreaterThan(0);
      }

      if (fixture.expectedCitedDocumentIds) {
        expect(new Set(result.sources.map((s) => s.documentId))).toEqual(
          new Set(fixture.expectedCitedDocumentIds)
        );
      }

      // Provider identity + retrieval provenance survive for diagnostics.
      expect(result.run.providerId).toBe("fake-ondevice");
      expect(result.run.servedModelClass).toBe("full");
      expect(result.run.validationOutcome).toBe("strict-json");
      expect(result.mode).toBe("semantic");
    }
  );

  it.each(ALL_LIBRARY_RAG_EVAL_CASES)(
    "$label: chunks reach the provider only inside untrusted blocks",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      await askLibrary({
        query: fixture.query,
        retrieve: fakeRetrieve({ results: fixture.retrieved, mode: "semantic", candidatesScanned: 0 }),
        provider,
      });
      const request = provider.requests[0];
      expect(request.systemInstruction).toContain("untrusted_source");
      for (const result of fixture.retrieved) {
        // Only chunks that survived dedup/budget may appear — and always inside blocks.
        expect(findUntrustedLeaks(request.text, [result.text])).toEqual([]);
      }
      // The user's query stays outside the blocks and comes last.
      const maskedTail = request.text.replace(
        /<untrusted_source\b[^>]*>[\s\S]*?<\/untrusted_source>/gi,
        "\u0000BLOCK\u0000"
      );
      expect(maskedTail.includes(fixture.query)).toBe(true);
    }
  );

  it("citation-violation case: fabricated refs drop and downgrade the level", async () => {
    const fixture = ALL_LIBRARY_RAG_EVAL_CASES.find(
      (c) => c.label === "citation-violations-dropped"
    )!;
    const provider = providerFor(fixture.responseText);
    const result = await askLibrary({
      query: fixture.query,
      retrieve: fakeRetrieve({ results: fixture.retrieved, mode: "semantic", candidatesScanned: 1 }),
      provider,
    });
    expect(result.answer.sourceRefs).toEqual([]);
    expect(result.answer.evidenceLevel).toBe("none");
    expect(result.sources).toEqual([]);
  });

  it("duplicate chunks: dedup drops the near-identical copy before the model runs", async () => {
    const fixture = ALL_LIBRARY_RAG_EVAL_CASES.find(
      (c) => c.label === "near-duplicate-chunks-deduped"
    )!;
    const provider = providerFor(fixture.responseText);
    await askLibrary({
      query: fixture.query,
      retrieve: fakeRetrieve({ results: fixture.retrieved, mode: "semantic", candidatesScanned: 2 }),
      provider,
    });
    const request = provider.requests[0];
    expect(request.text).toContain('<untrusted_source id="chunk-osmo-1">');
    expect(request.text).not.toContain('<untrusted_source id="chunk-osmo-dup">');
  });

  it("native structured output is preferred when the capability is present", async () => {
    const fixture = ALL_LIBRARY_RAG_EVAL_CASES.find((c) => c.label === "relevant-retrieval")!;
    const provider = providerFor(fixture.responseText, true);
    const result = await askLibrary({
      query: fixture.query,
      retrieve: fakeRetrieve({ results: fixture.retrieved, mode: "semantic", candidatesScanned: 1 }),
      provider,
    });
    expect(result.run.validationOutcome).toBe("native-structured");
    expect(provider.requests[0].schemaName).toBe("libraryAnswer");
  });

  it("malformed output fails closed after the single repair retry", async () => {
    const garbage = JSON.stringify({ answer: "", sourceRefs: "nope", evidenceLevel: 3 });
    const provider = new FakeAIProvider({
      responses: [
        { requestId: "bad-1", text: garbage },
        { requestId: "bad-2", text: garbage },
      ],
    });
    const oneChunk = ALL_LIBRARY_RAG_EVAL_CASES[0].retrieved.slice(0, 1);
    await expect(
      askLibrary({
        query: "What is osmosis?",
        retrieve: fakeRetrieve({ results: oneChunk, mode: "semantic", candidatesScanned: 1 }),
        provider,
      })
    ).rejects.toSatisfy((err: unknown) => isAIError(err) && err.category === "InvalidStructuredOutput");
    expect(provider.callCount).toBe(2);
  });

  it("empty retrieval short-circuits to an honest none answer without invoking a model", async () => {
    const provider = providerFor(
      JSON.stringify({ answer: "fabricated", sourceRefs: [], evidenceLevel: "supported" })
    );
    const result = await askLibrary({
      query: "anything at all",
      retrieve: fakeRetrieve({ results: [], mode: "lexicalOnly", candidatesScanned: 0 }),
      provider,
    });
    expect(result.answer.evidenceLevel).toBe("none");
    expect(result.answer.sourceRefs).toEqual([]);
    // The model was never called — there was nothing to ground on.
    expect(provider.callCount).toBe(0);
  });

  it("retrieval failure propagates — never answers ungrounded", async () => {
    const provider = providerFor(
      JSON.stringify({ answer: "x", sourceRefs: [], evidenceLevel: "none" })
    );
    await expect(
      askLibrary({
        query: "anything",
        retrieve: async () => {
          throw new Error("index unavailable");
        },
        provider,
      })
    ).rejects.toThrow("index unavailable");
    expect(provider.callCount).toBe(0);
  });
});
