/**
 * `RecallQuestionTask` — active-recall question generation (design D19 /
 * ai-active-recall spec, task 5.1).
 *
 * Fast model class, structured output validated against the canonical
 * `RecallQuestionProposal` schema. The input is 1–3 chunks the user has
 * ALREADY READ in the current session (the viewer controller guarantees
 * this; the spec forbids testing upcoming content). Chunk texts and the
 * document title enter the user turn ONLY inside untrusted blocks (D9);
 * the chunk ID LIST is trusted app data (our own ids) and is stated outside
 * the blocks so the model can reference chunks by id.
 *
 * Validation requires every `chunkRefs` entry to exist among the input
 * chunk ids — a hallucinated chunk reference fails closed through the
 * strict-JSON repair path in `runTask`.
 */

import {
  RECALL_QUESTION_SCHEMA,
  validateRecallQuestionProposal,
  type RecallQuestionProposal,
} from "../../schemas/recallQuestion";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import type { AITaskDefinition, AITaskRunOptions } from "../types";

export const RECALL_QUESTION_TASK_ID = "recall-question";

/** Fast-class latency budget for a single-question generation. */
export const RECALL_QUESTION_TIMEOUT_MS = 20_000;
export const RECALL_QUESTION_MAX_OUTPUT_TOKENS = 150;

/** One already-read chunk (semantic-index chunk or a stable approximation). */
export interface RecallChunkInput {
  /** Chunk id from the semantic index, or `approx-<hash>` for DOM-derived text. */
  id: string;
  text: string;
}

export interface RecallQuestionInput {
  /** 1–3 chunks the user has already read past in this session. */
  chunks: RecallChunkInput[];
  /** Document title for context (untrusted document content). */
  documentTitle?: string;
}

const RECALL_CORE_INSTRUCTION = [
  'You generate a single active-recall question from passages inside <untrusted_source id="chunk-..."> blocks.',
  "The passages are material the reader has ALREADY read. Ask about one central, memorable fact or relationship stated in them — never trivia, never upcoming content.",
  "Write the question so it can be answered from memory without seeing the passages, in one sentence.",
  "expectedAnswer is the correct answer in 1-2 sentences, using only information stated in the passages.",
  "conceptKeys lists 1-4 short lower-case concept keys the question tests (used for duplicate detection).",
  "chunkRefs must list the chunk id(s) the question is grounded in, copying ids EXACTLY from the provided chunk id list; never invent ids.",
  "Return ONLY the JSON object.",
].join("\n");

function buildRecallQuestionInput(input: RecallQuestionInput) {
  const lines = [
    "Generate one active-recall question from the already-read passages below.",
    "",
    ...(input.documentTitle
      ? ["Document title:", wrapUntrustedBlock("document-title", input.documentTitle), ""]
      : []),
  ];

  for (const chunk of input.chunks) {
    lines.push(`Chunk ${chunk.id}:`, wrapUntrustedBlock(`chunk-${chunk.id}`, chunk.text), "");
  }

  lines.push(
    `Valid chunk ids you may reference in chunkRefs: ${input.chunks
      .map((chunk) => chunk.id)
      .join(", ")}.`,
    "",
    `Respond with ONLY a JSON object of this shape: ${RECALL_QUESTION_SCHEMA.json}`
  );

  return { text: lines.join("\n") };
}

export const recallQuestionTask: AITaskDefinition<RecallQuestionInput, RecallQuestionProposal> = {
  id: RECALL_QUESTION_TASK_ID,
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${RECALL_CORE_INSTRUCTION}`,
  buildInput: buildRecallQuestionInput,
  outputKind: "structured",
  schema: RECALL_QUESTION_SCHEMA,
  validate(output: unknown, input: RecallQuestionInput) {
    return validateRecallQuestionProposal(output, {
      knownChunkIds: input.chunks.map((chunk) => chunk.id),
    });
  },
  maxOutputTokens: RECALL_QUESTION_MAX_OUTPUT_TOKENS,
  timeoutMs: RECALL_QUESTION_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

/**
 * Run the recall-question task. Thin wrapper over `runTask` so callers get
 * the validated proposal + run metadata (provider/model class for
 * provenance) in one call.
 */
export async function runRecallQuestion(
  input: RecallQuestionInput,
  options: AITaskRunOptions = {}
) {
  const run = await runTask(recallQuestionTask, input, {
    // Coalesce per chunk set so a re-render cannot double-fire generation.
    targetId: input.chunks.map((chunk) => chunk.id).join("|").slice(0, 128),
    ...options,
  });
  return { proposal: run.output, run };
}

registerTasks(recallQuestionTask);
