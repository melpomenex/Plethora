/**
 * Truncation-salvage integration through the REAL runTask structured
 * pipeline (device reports: learn-this cut at position 605, tutor-turn-full
 * cut at position 74). A response clipped mid-JSON at the token cap must be
 * salvaged programmatically — without burning the repair retry, which would
 * truncate again at the same cap.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runTask } from "../tasks/runTask";
import { registerTask } from "../tasks/registry";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { PREREQUISITE_ANALYSIS_SCHEMA } from "../schemas/prerequisite";
import { clearTaskDiagnostics, getTaskDiagnostics } from "../diagnostics";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../tasks/containment";
import type { AITaskDefinition, ValidationOutcome } from "../tasks/types";
import type { PrerequisiteAnalysis } from "../schemas/prerequisite";

const task: AITaskDefinition<{ src: string }, PrerequisiteAnalysis> = {
  id: "truncation-salvage-test",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nPropose prerequisites.`,
  buildInput: (input) => ({ text: `<untrusted_source id="src">\n${input.src}\n</untrusted_source>` }),
  outputKind: "structured",
  schema: PREREQUISITE_ANALYSIS_SCHEMA as AITaskDefinition<
    { src: string },
    PrerequisiteAnalysis
  >["schema"],
  validate: (output): ValidationOutcome<PrerequisiteAnalysis> => {
    if (
      typeof output === "object" &&
      output !== null &&
      Array.isArray((output as { prerequisites?: unknown }).prerequisites) &&
      (output as { prerequisites: unknown[] }).prerequisites.every(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { concept?: unknown }).concept === "string" &&
          typeof (e as { why?: unknown }).why === "string"
      )
    ) {
      return { ok: true, value: output as PrerequisiteAnalysis };
    }
    return { ok: false, errors: ["prerequisites: malformed entries"] };
  },
  maxOutputTokens: 900,
  timeoutMs: 5000,
};

beforeEach(() => {
  registerTask(task);
  clearTaskDiagnostics();
});

describe("truncated structured output is salvaged, not retried", () => {
  it("closes the cut JSON and succeeds without a repair retry", async () => {
    // Cut mid-string inside the second entry, exactly like the device
    // reports ("Unterminated string in JSON at position N").
    const truncated =
      '{"prerequisites":[{"concept":"pumping lemma","why":"needed first"},{"concept":"parse trees","wh';
    const provider = new FakeAIProvider({
      kind: "ondevice",
      responses: [{ requestId: "r1", text: truncated }],
    });

    const result = await runTask(task, { src: "source" }, { provider });

    expect(result.validationOutcome).toBe("truncated-json-salvaged");
    expect(result.output.prerequisites).toHaveLength(1);
    expect(result.output.prerequisites[0].concept).toBe("pumping lemma");
    // Single model call — the repair retry never ran.
    expect(provider.callCount).toBe(1);
    expect(getTaskDiagnostics().at(-1)?.validationOutcome).toBe(
      "truncated-json-salvaged"
    );
  });
});
