import { expect, it } from "vitest";
import { askLibrary } from "../tasks/definitions/libraryTask";
import { PinnedCloudProvider } from "../providers/cloudProvider";
import { parseOpenAICompletion } from "../../../api/llm/response";
import { clearTaskDiagnostics, getTaskDiagnostics } from "../diagnostics";
import { AIError } from "../errors";
import type { RetrievalResult } from "../../../api/ai-learning";

/** Opt-in local-runtime acceptance check; ordinary tests never send network requests. */
it.skipIf(process.env.PLETHORA_QA_LIVE !== "1")(
  "returns cited themes or a specific terminal diagnosis through a local model",
  async () => {
    clearTaskDiagnostics();
    const model = process.env.PLETHORA_QA_LIVE_MODEL ?? "lfm3-x86:latest";
    const sources = [
      {
        id: "review",
        text: "Spaced repetition schedules reviews at expanding intervals to support lasting memory.",
      },
      {
        id: "recall",
        text: "Active recall strengthens learning by retrieving answers from memory instead of rereading.",
      },
    ];
    const evidence: RetrievalResult[] = sources.map((s, i) => ({
      chunkId: s.id,
      documentId: `fixture-${i}`,
      documentTitle: `Learning ${i}`,
      sourceType: "document",
      ordinal: 0,
      text: s.text,
      headingPath: [],
      location: {
        sourceType: "text",
        documentId: `fixture-${i}`,
        ordinal: 0,
        startOffset: 0,
        endOffset: s.text.length,
      },
      contentHash: s.id,
      tokenCount: 25,
      score: 1,
      mode: "semantic",
    }));
    let attempts = 0;
    const provider = new PinnedCloudProvider(
      {
        id: "local-live-check",
        name: "Local runtime check",
        provider: "openai",
        model,
        apiKey: "",
        enabled: true,
        temperature: 0.2,
        maxTokens: 4096,
        contextWindowTokens: 16384,
        baseUrl: "http://127.0.0.1:11434/v1",
      },
      {
        chat: async (request) => {
          attempts++;
          const res = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: request.messages,
              max_tokens: request.maxTokens,
              temperature: request.temperature,
              stream: false,
            }),
            signal: AbortSignal.timeout(55000),
          });
          if (!res.ok)
            throw new AIError("ProviderOffline", "Local runtime HTTP failure", {
              code: "provider_offline",
            });
          return parseOpenAICompletion(await res.json());
        },
      }
    );
    try {
      const result = await askLibrary({
        query: "What are the main themes in my library?",
        provider,
        loadDocumentMetadata: async () => ({}),
        retrieve: async () => ({ results: evidence, mode: "semantic", candidatesScanned: 2 }),
      });
      console.log(
        "LIVE_QA_SANITIZED",
        JSON.stringify({
          provider: "local-openai-compatible",
          model,
          retrievalCount: 2,
          maxOutputTokens: 4096,
          contextTokens: 16384,
          attempts,
          finishReason: getTaskDiagnostics().at(-1)?.finishReason,
          result: "validated",
          citationCount: result.sources.length,
          evidenceLevel: result.answer.evidenceLevel,
          evidence: "sanitized retrieved fixtures; original index unavailable",
        })
      );
      expect(result.sources.map((s) => s.documentId).sort()).toEqual(["fixture-0", "fixture-1"]);
    } catch (error) {
      const mapped =
        error instanceof AIError ? error : new AIError("GenerationFailed", "Live check failed");
      console.log(
        "LIVE_QA_SANITIZED",
        JSON.stringify({
          provider: "local-openai-compatible",
          model,
          retrievalCount: 2,
          maxOutputTokens: 4096,
          contextTokens: 16384,
          attempts,
          result: mapped.category,
          completion: mapped.completion,
          evidence: "sanitized retrieved fixtures; original index unavailable",
        })
      );
      expect(error).toBeInstanceOf(AIError);
      expect(mapped.completion?.attemptCount).toBeGreaterThan(0);
      expect(mapped.completion?.attemptCount).toBeLessThanOrEqual(2);
      expect(mapped.completion?.terminalFailureKind).toBeDefined();
    }
  },
  65000
);
