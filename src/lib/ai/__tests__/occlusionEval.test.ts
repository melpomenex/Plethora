/**
 * Occlusion selection eval replay (design D29, task 3.9).
 *
 * Every case from `__fixtures__/eval/occlusion/cases.ts` runs through the
 * real `runTask` + validator pipeline with a vision-capable `FakeAIProvider`
 * and asserts STRUCTURAL semantics only (verdicts, id references, grouping
 * counts, caps, fail-closed categories).
 */

import { describe, expect, it } from "vitest";
import { runTask } from "../tasks/runTask";
import { FakeAIProvider, fakeCapabilities } from "../__fixtures__/FakeAIProvider";
import {
  OCCLUSION_EVAL_CASES,
  type OcclusionEvalCase,
} from "../__fixtures__/eval/occlusion/cases";
import {
  filterOcclusionLabels,
  occlusionLabelSelectionTask,
} from "../tasks/definitions/occlusionTask";
import { occlusionSourceFromBytes } from "../tasks/definitions/occlusionSources";
import { toAIError } from "../errors";

const evalSource = () => occlusionSourceFromBytes(new Uint8Array([9, 9, 9, 9]), "image/png");

describe.each(OCCLUSION_EVAL_CASES)("occlusion eval: $label", (caseItem: OcclusionEvalCase) => {
  it(`replays through runTask with the expected structure (${caseItem.label})`, async () => {
    // Pre-model filtering mirrors production (task 3.7).
    const filtered = filterOcclusionLabels(caseItem.labels);
    const provider = new FakeAIProvider({
      capabilities: fakeCapabilities({ vision: true }),
      responses: caseItem.responseError
        ? [caseItem.responseError]
        : [{ requestId: "eval", text: caseItem.responseText ?? "" }],
    });

    const run = runTask(
      occlusionLabelSelectionTask,
      { source: evalSource(), labels: filtered.kept },
      { provider }
    );

    if (caseItem.expect.errorCategory) {
      await expect(run).rejects.toSatisfy((error: unknown) => {
        expect(toAIError(error).category).toBe(caseItem.expect.errorCategory);
        return true;
      });
      return;
    }

    const result = await run;
    const output = result.output;
    if (caseItem.expect.appropriate !== undefined) {
      expect(output.appropriate).toBe(caseItem.expect.appropriate);
    }
    if (caseItem.expect.selectionCount !== undefined) {
      expect(output.selections).toHaveLength(caseItem.expect.selectionCount);
    }
    if (caseItem.expect.rejectedCount !== undefined) {
      expect(output.rejected).toHaveLength(caseItem.expect.rejectedCount);
    }
    if (caseItem.expect.referencedLabelIds) {
      const referenced = new Set(output.selections.flatMap((s) => s.labelIds));
      for (const labelId of caseItem.expect.referencedLabelIds) {
        expect(referenced.has(labelId)).toBe(true);
      }
      // Every reference must resolve to a real OCR id (spec).
      const known = new Set(filtered.kept.map((label) => label.id));
      for (const labelId of referenced) {
        expect(known.has(labelId)).toBe(true);
      }
    }
  });
});

describe("occlusion eval: pre-model filtering", () => {
  it("caps the dense fixture before the model ever runs", () => {
    const denseCase = OCCLUSION_EVAL_CASES.find((c) => c.label === "dense-diagram");
    expect(denseCase).toBeDefined();
    const filtered = filterOcclusionLabels(denseCase!.labels, { maxLabels: 24 });
    expect(filtered.kept).toHaveLength(24);
    expect(filtered.droppedDense).toBe(denseCase!.labels.length - 24);
  });
});
