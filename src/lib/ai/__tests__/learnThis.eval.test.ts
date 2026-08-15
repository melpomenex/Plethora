/**
 * Semantic evaluation of the "Learn this" task over labeled fixtures
 * (design D29, task 2.8): canned structured outputs replayed through the REAL
 * `runTask` + validation pipeline via `FakeAIProvider` — CI never needs Nano
 * hardware. Assertions are structural (classification, card-type mapping,
 * caps, grounding verdicts), never exact prose.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import {
  runLearnThis,
  type LearnThisValidationDeps,
} from "../tasks/definitions/learnThisValidation";
import { learnThisTask } from "../tasks/definitions/learnThisTask";
import { findUntrustedLeaks } from "../tasks/containment";
import { isAIError } from "../errors";
import {
  ADVERSARIAL_OVER_CAP_CASE,
  ADVERSARIAL_UNGROUNDED_CASE,
  LEARN_THIS_EVAL_CASES,
} from "../__fixtures__/eval/learn-this/cases";

const noDuplicates: LearnThisValidationDeps["checkExistingDuplicates"] = async () => [];

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

describe("learn-this eval fixtures through the real pipeline (design D29)", () => {
  it.each(LEARN_THIS_EVAL_CASES)(
    "$label: classifies and maps card types with all candidates valid",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      const { validated, run } = await runLearnThis(
        { passage: fixture.passage },
        { provider },
        { checkExistingDuplicates: noDuplicates }
      );

      // Structural semantics: the classification equals the label, every card
      // type comes from the declared mapping, and every grounded candidate
      // passes validation.
      expect(validated.proposal.knowledgeType).toBe(fixture.expectedKnowledgeType);
      const types = validated.proposal.suggestedCards.map((c) => c.cardType);
      expect(types.length).toBeGreaterThan(0);
      expect(types.every((t) => fixture.expectedCardTypes.includes(t))).toBe(true);
      expect(validated.validCount).toBe(validated.candidates.length);

      // Provider identity survives for provenance.
      expect(run.providerId).toBe("fake-ondevice");
      expect(run.servedModelClass).toBe("full");
      expect(run.validationOutcome).toBe("strict-json");
    }
  );

  it.each(LEARN_THIS_EVAL_CASES)(
    "$label: passage reaches the provider only inside untrusted blocks",
    async (fixture) => {
      const provider = providerFor(fixture.responseText);
      await runLearnThis(
        { passage: fixture.passage },
        { provider },
        { checkExistingDuplicates: noDuplicates }
      );
      const request = provider.requests[0];
      expect(request.systemInstruction).toContain("untrusted_source");
      expect(findUntrustedLeaks(request.text, [fixture.passage])).toEqual([]);
      expect(request.text).toContain('<untrusted_source id="passage">');
    }
  );

  it("native structured output is preferred when the capability is present", async () => {
    const fixture = LEARN_THIS_EVAL_CASES[0];
    const provider = providerFor(fixture.responseText, true);
    const { run } = await runLearnThis(
      { passage: fixture.passage },
      { provider },
      { checkExistingDuplicates: noDuplicates }
    );
    expect(run.validationOutcome).toBe("native-structured");
    expect(provider.requests[0].structured).toBe(true);
    expect(provider.requests[0].schemaName).toBe("learningMaterialProposal");
  });

  it("adversarial over-cap: caps keep 8 cards max and 2 per concept", async () => {
    const provider = providerFor(ADVERSARIAL_OVER_CAP_CASE.responseText);
    const { validated } = await runLearnThis(
      { passage: ADVERSARIAL_OVER_CAP_CASE.passage },
      { provider },
      { checkExistingDuplicates: noDuplicates }
    );
    expect(validated.proposal.suggestedCards.length).toBeLessThanOrEqual(8);
    const perConcept = new Map<string, number>();
    for (const card of validated.proposal.suggestedCards) {
      const key = (card.concept ?? "").toLowerCase();
      perConcept.set(key, (perConcept.get(key) ?? 0) + 1);
    }
    for (const count of perConcept.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
    // Ranked by proposal order: the model's first cards survive the cap.
    expect(validated.proposal.suggestedCards.length).toBe(8);
  });

  it("adversarial ungrounded: every candidate is flagged, none dropped silently", async () => {
    const provider = providerFor(ADVERSARIAL_UNGROUNDED_CASE.responseText);
    const { validated } = await runLearnThis(
      { passage: ADVERSARIAL_UNGROUNDED_CASE.passage },
      { provider },
      { checkExistingDuplicates: noDuplicates }
    );
    expect(validated.candidates).toHaveLength(2);
    expect(validated.validCount).toBe(0);
    expect(validated.candidates.every((c) => c.status === "ungrounded")).toBe(true);
    for (const candidate of validated.candidates) {
      expect(candidate.issues.length).toBeGreaterThan(0);
    }
  });

  it("malformed output fails closed after the single repair retry", async () => {
    const garbage = JSON.stringify({ importance: 3, knowledgeType: "nope" });
    const provider = new FakeAIProvider({
      responses: [
        { requestId: "bad-1", text: garbage },
        { requestId: "bad-2", text: garbage },
      ],
    });
    await expect(
      runLearnThis(
        { passage: "Some passage about entropy and microstates." },
        { provider },
        { checkExistingDuplicates: noDuplicates }
      )
    ).rejects.toSatisfy((err: unknown) => isAIError(err) && err.category === "InvalidStructuredOutput");
    // Initial attempt + exactly one repair — never more.
    expect(provider.callCount).toBe(2);
  });
});

describe("learnThisTask registry integration", () => {
  it("uses the declared full-class route through runTask", async () => {
    const fixture = LEARN_THIS_EVAL_CASES[0];
    const provider = providerFor(fixture.responseText);
    const { run } = await runLearnThis(
      { passage: fixture.passage },
      { provider },
      { checkExistingDuplicates: noDuplicates }
    );
    expect(run.taskId).toBe(learnThisTask.id);
    expect(run.requestedModelClass).toBe("full");
  });
});
