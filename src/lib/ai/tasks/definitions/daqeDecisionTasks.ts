/**
 * `DaqeDecisionTask` — the single task that answers all three decision-model
 * primitives for one item (`queue-decision-model`).
 *
 * Runs through the existing task layer (`runTask` → `resolveTaskRoute`), so it
 * inherits provider routing, native structured output where available, the
 * strict-JSON fallback, and the one-repair-retry rule. There is deliberately no
 * second router (design D4, and the `unified-native-on-device-ai` decision).
 *
 * Only a **structural outline** of the item is sent — heading skeleton, type,
 * length. Never the body, never the verbatim title, never tags. That constraint
 * is what makes the same prompt shape safe for a remote provider, and it is
 * enforced by `buildDaqeDecisionPrompt` rather than by convention.
 */

import {
  DAQE_DECISION_SCHEMA,
  validateDaqeDecision,
  type DaqeDecision,
  type DecisionTier,
} from "../../schemas/daqeDecision";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import type { AITaskDefinition, AITaskRunOptions } from "../types";

export const DAQE_DECISION_TASK_ID = "daqe-decision";

/**
 * Fast-class budget.
 *
 * Tighter than passage classification's 45 s: ranking is on the critical path to
 * showing the next item, and the ranker treats a timeout as a fallback rather
 * than a stall. A decision that arrives late is worthless — the queue has moved
 * on — so there is no reason to wait long for one.
 */
export const DAQE_DECISION_TIMEOUT_MS = 12_000;

/** One envelope: two scores, one tier, two booleans, one short reason. */
export const DAQE_DECISION_MAX_OUTPUT_TOKENS = 300;

export interface DaqeDecisionInput {
  /** Stable id, used for cache keying and the task target id. */
  itemId: string;
  /** `document` | `extract` | `learning-item` | … */
  itemType: string;
  /** Length in characters. A size signal, not content. */
  lengthChars: number;
  /**
   * A structural outline: heading levels and their text, and nothing else.
   *
   * Sent inside an untrusted block because headings are still author-controlled
   * text that could contain instructions.
   */
  outline?: string[];
  /** The user's stated goal. Session-dependent, therefore never cached. */
  goal?: string;
  /** Bumped whenever the rubric changes, so cached judgements invalidate. */
  rubricVersion?: number;
}

/**
 * The only prompt builder that may ship item content to a provider.
 *
 * Kept as a separate exported function rather than inlined into `buildInput` so
 * the containment and the no-body-text properties are directly testable, and so
 * the remote-gate test can assert on the exact bytes that would be sent.
 */
export function buildDaqeDecisionPrompt(input: DaqeDecisionInput): string {
  const lines = [
    "Rank one item from a learner's reading queue.",
    "",
    `Item type: ${input.itemType}`,
    `Length: ${input.lengthChars} characters`,
  ];

  if (input.outline && input.outline.length > 0) {
    lines.push(
      "Structure:",
      wrapUntrustedBlock("item-outline", input.outline.join("\n"))
    );
  }

  if (input.goal) {
    lines.push("", "The learner's goal for this session:", wrapUntrustedBlock("goal", input.goal));
  }

  lines.push(
    "",
    "Return ONLY a JSON object of this shape:",
    DAQE_DECISION_SCHEMA.json,
    "",
    "goalAlignment is 0.0-1.0: how well this item serves the stated goal.",
    "atomicExtractability is 0.0-1.0: how cleanly it decomposes into atomic study material.",
    "tier is surface-skim (light read), medium-analysis (one considered section), or deep-foundational (sustained close reading of a primary source).",
    "prerequisitesMet and staleForPruning are booleans.",
    "reason is one short sentence."
  );

  return lines.join("\n");
}

const DAQE_DECISION_CORE_INSTRUCTION = [
  "You judge one reading item for a spaced-repetition queue. You are given its structure, its length, and the learner's goal — never its body text.",
  "Be honest about uncertainty: an item whose structure tells you little should score low on both continuous axes rather than guessing from the type name.",
  "Return ONLY the JSON object.",
].join("\n");

export const daqeDecisionTask: AITaskDefinition<DaqeDecisionInput, DaqeDecision> = {
  id: DAQE_DECISION_TASK_ID,
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${DAQE_DECISION_CORE_INSTRUCTION}`,
  buildInput: (input) => ({ text: buildDaqeDecisionPrompt(input) }),
  outputKind: "structured",
  schema: DAQE_DECISION_SCHEMA,
  validate: (output) => validateDaqeDecision(output),
  maxOutputTokens: DAQE_DECISION_MAX_OUTPUT_TOKENS,
  timeoutMs: DAQE_DECISION_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

export interface DaqeDecisionResult {
  /** `evaluateScore`'s continuous judgement, 0–1. */
  score: number;
  /** `evaluateChoice`'s load tier. */
  tier: DecisionTier;
  /** The tier's point on the shared 1–5 complexity scale. */
  complexity: number;
  /** `evaluateNoul`'s prerequisites gate. */
  prerequisitesMet: boolean;
  /** `evaluateNoul`'s stale-pruning gate. */
  staleForPruning: boolean;
  /** Present only when the run succeeded. */
  decision?: DaqeDecision;
}

/**
 * Run the decision task and shape the answer as the ranker's three primitives.
 *
 * A thrown error here is expected and handled upstream: the ranker treats a
 * failure as "this term is unavailable" and takes its local fallback, so nothing
 * about a bad or unavailable model reaches the queue.
 */
export async function runDaqeDecision(
  input: DaqeDecisionInput,
  options: AITaskRunOptions = {}
): Promise<DaqeDecisionResult> {
  const run = await runTask(daqeDecisionTask, input, {
    targetId: `daqe:${input.itemId}:${input.rubricVersion ?? 1}`,
    ...options,
  });
  const decision = run.output;
  return {
    score: (decision.goalAlignment + decision.atomicExtractability) / 2,
    tier: decision.tier,
    complexity: decision.tier === "surface-skim" ? 1 : decision.tier === "medium-analysis" ? 3 : 5,
    prerequisitesMet: decision.prerequisitesMet,
    staleForPruning: decision.staleForPruning,
    decision,
  };
}

registerTasks(daqeDecisionTask);