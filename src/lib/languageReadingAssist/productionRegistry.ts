import { hasCloudProvider, isAnyAiAvailable, resolveAiPath } from "../ai/provider";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition } from "../ai/tasks/types";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import { safeUtf16End, scriptMetadata } from "../languageProcessing/unicode";
import { createLocalReadingAssistProviders, hasLocalReadingAssistProvider } from "./localProviders";
import { ReadingAssistRegistry } from "./registry";
import type { AssistSpan, ReadingAssistKind, ReadingAssistProvider } from "./types";

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

function clampUtf16Span(text: string, rawStart: unknown, rawEnd: unknown): { start: number; end: number } | null {
  if (typeof rawStart !== "number" || typeof rawEnd !== "number") return null;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const len = text.length;
  let start = Math.max(0, Math.min(len, Math.floor(rawStart)));
  let end = Math.max(0, Math.min(len, Math.floor(rawEnd)));
  if (start > 0 && start < len) {
    const prev = text.charCodeAt(start - 1);
    const curr = text.charCodeAt(start);
    if (prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff) {
      start -= 1;
    }
  }
  end = safeUtf16End(text, end);
  if (end <= start) return null;
  return { start, end };
}

function normalizeAiGlossSpans(
  sourceId: string,
  text: string,
  rawSpans: unknown,
): AssistSpan[] {
  if (!Array.isArray(rawSpans)) return [];
  const valid: AssistSpan[] = [];
  for (const item of rawSpans) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { start?: unknown; end?: unknown; annotation?: unknown; renderedText?: unknown };
    const clamped = clampUtf16Span(text, candidate.start, candidate.end);
    if (!clamped) continue;
    const annotation = typeof candidate.annotation === "string" && candidate.annotation.trim()
      ? candidate.annotation.trim()
      : undefined;
    const renderedText = typeof candidate.renderedText === "string" && candidate.renderedText.trim()
      ? candidate.renderedText.trim()
      : undefined;
    if (!annotation && !renderedText) continue;
    valid.push({
      id: `${sourceId}:${clamped.start}:${clamped.end}:${valid.length}`,
      sourceStart: clamped.start,
      sourceEnd: clamped.end,
      sourceText: text.slice(clamped.start, clamped.end),
      annotation,
      renderedText,
    });
  }
  return valid;
}

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
      const detectedDirection = request.direction ?? (scriptMetadata(request.text).direction === "rtl" ? "rtl" : "ltr");
      const aiPath = await resolveAiPath("prompt");
      const hasAi = aiPath !== "none" || hasCloudProvider() || (await isAnyAiAvailable("prompt"));
      if (!hasAi) {
        return {
          sourceId: request.sourceId,
          contentFingerprint: request.contentFingerprint,
          profileId: request.profileId,
          kind: request.kind,
          direction: detectedDirection,
          status: "unsupported",
          providerId: "plethora-ai-gloss",
          providerVersion: "1.0.0",
          spans: [],
          createdAt: Date.now(),
          error: "unsupported-capability",
        };
      }
      if (signal?.aborted) {
        return {
          sourceId: request.sourceId,
          contentFingerprint: request.contentFingerprint,
          profileId: request.profileId,
          kind: request.kind,
          direction: detectedDirection,
          status: "failed",
          providerId: "plethora-ai-gloss",
          providerVersion: "1.0.0",
          spans: [],
          createdAt: Date.now(),
          error: "cancelled",
        };
      }

      try {
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
          direction: detectedDirection,
          status: "ready",
          providerId: "plethora-ai-gloss",
          providerVersion: "1.0.0",
          spans: normalizeAiGlossSpans(request.sourceId, request.text, result.output?.spans),
          createdAt: Date.now(),
        };
      } catch (error) {
        return {
          sourceId: request.sourceId,
          contentFingerprint: request.contentFingerprint,
          profileId: request.profileId,
          kind: request.kind,
          direction: detectedDirection,
          status: "failed",
          providerId: "plethora-ai-gloss",
          providerVersion: "1.0.0",
          spans: [],
          createdAt: Date.now(),
          error: error instanceof Error ? error.message : "ai-gloss-failed",
        };
      }
    },
  };
}

/** Production registry registering offline multilingual providers and AI gloss. */
export function createProductionReadingAssistRegistry(): ReadingAssistRegistry {
  const registry = new ReadingAssistRegistry();
  for (const provider of createLocalReadingAssistProviders()) {
    registry.register(provider);
  }
  registry.register(createAiGlossProvider());
  return registry;
}

export function hasProductionReadingAssistProvider(languageTag?: string): boolean {
  return hasLocalReadingAssistProvider(languageTag) || hasCloudProvider();
}

export async function isAnyProductionReadingAssistProviderAvailable(languageTag?: string): Promise<boolean> {
  if (hasLocalReadingAssistProvider(languageTag) || hasCloudProvider()) return true;
  return isAnyAiAvailable("prompt");
}
