import { hasCloudProvider } from "../ai/provider";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition } from "../ai/tasks/types";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import type { TranslationProvider } from "./provider";

export interface LanguageTranslationTaskInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

const languageTranslationTask: AITaskDefinition<LanguageTranslationTaskInput, string> = {
  id: "language-sentence-translation",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nTranslate the sentence into the requested target language. Return only the translation with no preamble, quotes, or explanation.`,
  buildInput: ({ text, sourceLanguage, targetLanguage }) => ({
    text: [
      `Source language: ${sourceLanguage}`,
      `Target language: ${targetLanguage}`,
      "Sentence:",
      wrapUntrustedBlock("sentence", text),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 45_000,
  budgetPolicy: "pre-budgeted",
};

/** Cloud/on-device AI translation routed through the existing task layer. */
export function createAiTranslationProvider(): TranslationProvider {
  return {
    id: "plethora-ai-translate",
    kind: "ai",
    version: "1.0.0",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: false,
      sendsTextOffDevice: true,
      requiresCredentials: false,
      configured: hasCloudProvider(),
      supportsCancellation: true,
      privacyDisclosure: "Sentence text may be sent to your configured AI provider for translation.",
    },
    translate: async (request, options) => {
      const result = await runTask(
        languageTranslationTask,
        {
          text: request.text,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
        },
        { signal: options?.signal, targetId: request.cacheKey },
      );
      return { translatedText: result.output.trim() };
    },
  };
}
