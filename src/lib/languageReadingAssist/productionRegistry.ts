import { hasCloudProvider } from "../ai/provider";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition } from "../ai/tasks/types";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import { ReadingAssistRegistry } from "./registry";
import type { ReadingAssistKind, ReadingAssistProvider } from "./types";

interface GlossPayload {
  spans: Array<{ start: number; end: number; annotation?: string; renderedText?: string }>;
}

const glossAssistTask: AITaskDefinition<{ text: string; languageTag: string; kind: ReadingAssistKind }, GlossPayload> = {
  id: "language-reading-assist-gloss",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nProvide short gloss annotations for difficult words or phrases in the passage. Return JSON only with spans using character offsets into the original text. Do not rewrite or omit source text.`,
  buildInput: ({ text, languageTag, kind }) => ({
    text: [
      `Language: ${languageTag}`,
      `Assist kind: ${kind}`,
      "Passage:",
      wrapUntrustedBlock("passage", text),
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: {
    name: "GlossPayload",
    nativeName: "GlossPayload",
    json: '{"spans":[{"start":0,"end":0,"annotation":"string","renderedText":"string"}]}',
  },
  maxOutputTokens: 384,
  timeoutMs: 45_000,
  budgetPolicy: "pre-budgeted",
};

function createAiGlossProvider(): ReadingAssistProvider {
  return {
    capabilities: {
      providerId: "plethora-ai-gloss",
      providerVersion: "1.0.0",
      kinds: ["gloss"],
      languages: ["*"],
      offline: false,
      maxCodeUnits: 4_000,
      preservesSource: true,
    },
    assist: async (request, signal) => {
      const result = await runTask(
        glossAssistTask,
        { text: request.text, languageTag: request.languageTag, kind: request.kind },
        { signal, targetId: `${request.sourceId}:${request.contentFingerprint}:${request.kind}` },
      );
      return {
        sourceId: request.sourceId,
        contentFingerprint: request.contentFingerprint,
        profileId: request.profileId,
        kind: request.kind,
        direction: request.direction ?? "ltr",
        status: "ready",
        providerId: "plethora-ai-gloss",
        providerVersion: "1.0.0",
        spans: result.output.spans.map((span, index) => ({
          id: `${request.sourceId}:${span.start}:${span.end}:${index}`,
          sourceStart: span.start,
          sourceEnd: span.end,
          sourceText: request.text.slice(span.start, span.end),
          annotation: span.annotation,
          renderedText: span.renderedText,
        })),
        createdAt: Date.now(),
      };
    },
  };
}

/** Production registry with only providers that can truthfully assist. */
export function createProductionReadingAssistRegistry(): ReadingAssistRegistry {
  const registry = new ReadingAssistRegistry();
  if (hasCloudProvider()) registry.register(createAiGlossProvider());
  return registry;
}

export function hasProductionReadingAssistProvider(): boolean {
  return hasCloudProvider();
}
