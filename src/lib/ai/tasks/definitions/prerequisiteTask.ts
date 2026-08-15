/**
 * `PrerequisiteAnalysisTask` — prerequisite inference from selected content
 * (design D23 / ai-knowledge-relationships spec, tasks 6.2/6.3).
 *
 * Full model class, structured output validated against the canonical
 * `PrerequisiteAnalysis` schema (`schemas/prerequisite.ts`, task 1.5 — the
 * validator tolerates an EMPTY list: self-contained material legitimately
 * needs no prerequisites). The selection and any document context enter the
 * user turn ONLY inside untrusted blocks (D9).
 *
 * The model only PROPOSES concepts + rationale. Coverage evidence
 * (`coverageLevel`, `evidenceRefs`) is computed deterministically by the
 * coverage runner (`src/lib/ai/concepts/coverage.ts`) — never model output —
 * and every UI string about coverage stays hedged ("appears to be a gap"),
 * per the spec's prohibition on claims about what the user knows.
 */

import {
  PREREQUISITE_ANALYSIS_SCHEMA,
  validatePrerequisiteAnalysis,
  type PrerequisiteAnalysis,
} from "../../schemas/prerequisite";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import type { AITaskDefinition, AITaskRunOptions } from "../types";

export const PREREQUISITE_TASK_ID = "prerequisite-analysis";

/** Full-class latency budget (matches the prerequisite row of design D3). */
export const PREREQUISITE_TIMEOUT_MS = 60_000;
/** ≤ 12 concepts × short {concept, why} pairs fit comfortably in 400 tokens. */
export const PREREQUISITE_MAX_OUTPUT_TOKENS = 900;

export interface PrerequisiteInput {
  /** The selected (or otherwise targeted) passage — untrusted content. */
  passage: string;
  /** Optional document title for context — untrusted document content. */
  documentTitle?: string;
  /** Optional wider document excerpt around the passage — untrusted. */
  documentContext?: string;
}

const PREREQUISITE_CORE_INSTRUCTION = [
  'You analyze a passage from <untrusted_source> blocks and propose the prerequisite concepts a reader would plausibly need before this material clicks.',
  "Propose 1-8 prerequisites, most fundamental first. Each entry: concept (a short canonical concept name) and why (one sentence explaining how it underpins the passage).",
  "Include ONLY concepts the passage genuinely builds on — not every concept it mentions. If the passage is self-contained introductory material, return an empty prerequisites list.",
  "Never propose the passage's own main topic as a prerequisite of itself.",
  "Return ONLY the JSON object.",
].join("\n");

function buildPrerequisiteInput(input: PrerequisiteInput) {
  const lines: string[] = ["Propose prerequisite concepts for this passage:", ""];

  if (input.documentTitle) {
    lines.push("Document title:", wrapUntrustedBlock("document-title", input.documentTitle), "");
  }
  if (input.documentContext) {
    lines.push(
      "Surrounding document context (context only):",
      wrapUntrustedBlock("document-context", input.documentContext),
      ""
    );
  }

  lines.push("Passage:", wrapUntrustedBlock("passage", input.passage), "");
  lines.push(`Respond with ONLY a JSON object of this shape: ${PREREQUISITE_ANALYSIS_SCHEMA.json}`);

  return { text: lines.join("\n") };
}

export const prerequisiteTask: AITaskDefinition<PrerequisiteInput, PrerequisiteAnalysis> = {
  id: PREREQUISITE_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${PREREQUISITE_CORE_INSTRUCTION}`,
  buildInput: buildPrerequisiteInput,
  outputKind: "structured",
  schema: PREREQUISITE_ANALYSIS_SCHEMA,
  validate: (output) => validatePrerequisiteAnalysis(output),
  maxOutputTokens: PREREQUISITE_MAX_OUTPUT_TOKENS,
  timeoutMs: PREREQUISITE_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

/**
 * Run the prerequisite task. Thin wrapper over `runTask` returning the
 * validated analysis + run metadata (provider/model class feed the link
 * provenance recorded by the prerequisites flow).
 */
export async function runPrerequisiteAnalysis(
  input: PrerequisiteInput,
  options: AITaskRunOptions = {}
) {
  const run = await runTask(prerequisiteTask, input, {
    // Coalesce per passage so a re-render cannot double-fire analysis.
    targetId: `prereq:${input.passage.slice(0, 96)}`,
    ...options,
  });
  return { analysis: run.output, run };
}

registerTasks(prerequisiteTask);
