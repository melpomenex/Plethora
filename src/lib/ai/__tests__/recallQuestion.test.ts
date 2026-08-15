/**
 * Semantic evaluation of the recall-question task over labeled fixtures
 * (task 5.1): canned structured outputs replayed through the REAL `runTask`
 * + validation pipeline via `FakeAIProvider` — CI never needs Nano hardware.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { findUntrustedLeaks } from "../tasks/containment";
import { isAIError } from "../errors";
import {
  recallQuestionTask,
  runRecallQuestion,
} from "../tasks/definitions/recallTask";
import {
  RECALL_ADVERSARIAL_HALLUCINATED_REF,
  RECALL_EVAL_CASES,
  RECALL_MALFORMED_CASE,
} from "../__fixtures__/eval/recall/cases";

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

describe("recall-question eval fixtures through the real pipeline", () => {
  it.each(RECALL_EVAL_CASES)(
    "$label: produces a validated proposal grounded in real chunk refs",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      const { proposal, run } = await runRecallQuestion(
        { chunks: fixture.chunks, documentTitle: fixture.documentTitle },
        { provider }
      );

      const knownIds = fixture.chunks.map((chunk) => chunk.id);
      expect(proposal.chunkRefs.length).toBeGreaterThan(0);
      expect(proposal.chunkRefs.every((ref) => knownIds.includes(ref))).toBe(true);
      expect(proposal.question.length).toBeGreaterThan(0);
      expect(proposal.expectedAnswer.length).toBeGreaterThan(0);
      expect(proposal.conceptKeys.length).toBeGreaterThan(0);

      expect(run.taskId).toBe(recallQuestionTask.id);
      expect(run.servedModelClass).toBe("fast");
      expect(run.validationOutcome).toBe("strict-json");
      expect(run.providerId).toBe("fake-ondevice");
    }
  );

  it.each(RECALL_EVAL_CASES)(
    "$label: chunk text and title reach the provider only inside untrusted blocks",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      await runRecallQuestion(
        { chunks: fixture.chunks, documentTitle: fixture.documentTitle },
        { provider }
      );
      const request = provider.requests[0];
      expect(request.systemInstruction).toContain("untrusted_source");
      const samples = fixture.chunks.map((chunk) => chunk.text);
      if (fixture.documentTitle) samples.push(fixture.documentTitle);
      expect(findUntrustedLeaks(request.text, samples)).toEqual([]);
      for (const chunk of fixture.chunks) {
        expect(request.text).toContain(`<untrusted_source id="chunk-${chunk.id}">`);
      }
    }
  );

  it("native structured output is preferred when the capability is present", async () => {
    const fixture = RECALL_EVAL_CASES[0];
    const provider = providerFor(fixture.responseText, true);
    const { run } = await runRecallQuestion(
      { chunks: fixture.chunks, documentTitle: fixture.documentTitle },
      { provider }
    );
    expect(run.validationOutcome).toBe("native-structured");
    expect(provider.requests[0].schemaName).toBe("recallQuestionProposal");
  });

  it("adversarial: a hallucinated chunk ref fails closed after the single repair retry", async () => {
    const provider = new FakeAIProvider({
      responses: [
        { requestId: "bad-1", text: RECALL_ADVERSARIAL_HALLUCINATED_REF.responseText },
        { requestId: "bad-2", text: RECALL_ADVERSARIAL_HALLUCINATED_REF.responseText },
      ],
    });
    await expect(
      runRecallQuestion({ chunks: RECALL_ADVERSARIAL_HALLUCINATED_REF.chunks }, { provider })
    ).rejects.toSatisfy((err: unknown) => isAIError(err) && err.category === "InvalidStructuredOutput");
    // Initial attempt + exactly one repair — never more.
    expect(provider.callCount).toBe(2);
  });

  it("malformed envelope (missing expectedAnswer) fails closed", async () => {
    const provider = new FakeAIProvider({
      responses: [
        { requestId: "bad-1", text: RECALL_MALFORMED_CASE.responseText },
        { requestId: "bad-2", text: RECALL_MALFORMED_CASE.responseText },
      ],
    });
    await expect(
      runRecallQuestion({ chunks: RECALL_MALFORMED_CASE.chunks }, { provider })
    ).rejects.toSatisfy((err: unknown) => isAIError(err) && err.category === "InvalidStructuredOutput");
  });
});

describe("recallQuestionTask definition invariants", () => {
  it("declares the fast model class and a small output ceiling", () => {
    expect(recallQuestionTask.modelClass).toBe("fast");
    expect(recallQuestionTask.maxOutputTokens).toBeLessThanOrEqual(200);
    expect(recallQuestionTask.systemInstruction).toContain("untrusted_source");
  });
});
