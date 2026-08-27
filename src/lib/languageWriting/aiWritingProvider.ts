import { hasCloudProvider } from "../ai/provider";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition } from "../ai/tasks/types";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import type { WritingCorrection, WritingPrompt } from "./types";
import type { WritingCorrectionChunk, WritingProvider } from "./service";

interface WritingCorrectionPayload {
  corrections: Array<{
    id: string;
    sourceStart: number;
    sourceEnd: number;
    learnerText: string;
    correctedText: string;
    category: WritingCorrection["category"];
    explanation: string;
    confidence?: number;
  }>;
}

const writingCorrectionTask: AITaskDefinition<{ prompt: WritingPrompt; rawText: string }, WritingCorrectionPayload> = {
  id: "language-writing-correction",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nYou correct learner writing in the target language. Preserve the learner's original text in the response. Return JSON only with a corrections array. Each correction must include sourceStart/sourceEnd offsets into the learner text, learnerText, correctedText, category (grammar|spelling|vocabulary|naturalness), explanation, and optional confidence between 0 and 1.`,
  buildInput: ({ prompt, rawText }) => ({
    text: [
      `Target language: ${prompt.targetLanguage}`,
      `Mode: ${prompt.mode}`,
      "Writing prompt:",
      wrapUntrustedBlock("prompt", prompt.prompt),
      "Learner text:",
      wrapUntrustedBlock("learner", rawText),
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: {
    name: "WritingCorrectionPayload",
    nativeName: "WritingCorrectionPayload",
    json: '{"corrections":[{"id":"string","sourceStart":0,"sourceEnd":0,"learnerText":"string","correctedText":"string","category":"grammar","explanation":"string","confidence":0.9}]}',
  },
  maxOutputTokens: 512,
  timeoutMs: 60_000,
  budgetPolicy: "pre-budgeted",
};

function mapCorrections(payload: WritingCorrectionPayload): readonly WritingCorrection[] {
  return payload.corrections.map((correction) => ({
    ...correction,
    confidence: correction.confidence ?? 0.5,
    accepted: false,
  }));
}

/** Writing feedback through the shared AI task layer; never overwrites learner text. */
export function createAiWritingProvider(): WritingProvider | undefined {
  if (!hasCloudProvider()) return undefined;
  return {
    id: "plethora-ai-writing",
    version: "1.0.0",
    correct: async (prompt, rawText, signal) => {
      const result = await runTask(writingCorrectionTask, { prompt, rawText }, { signal, targetId: `${prompt.id}:${rawText}` });
      return mapCorrections(result.output);
    },
    streamCorrect: async (prompt, rawText, { signal, onChunk }) => {
      const result = await runTask(writingCorrectionTask, { prompt, rawText }, { signal, targetId: `${prompt.id}:${rawText}` });
      const corrections = mapCorrections(result.output);
      onChunk({ corrections, done: true });
      return corrections;
    },
  };
}

export type { WritingCorrectionChunk };
