import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { resolveAiPath } from "../provider";
import { runTask } from "../tasks/runTask";
import { runAssistantTurn, type AssistantTurnRequest } from "./orchestrator";
import { getDocument } from "../../../api/documents";
import { loadDocumentQaText } from "../../../features/documentQa/sectionContextRequest";
import { isVideoDocumentFileType } from "../../../features/documentQa/legacyContextWindow";
import { extractDocumentText } from "../../../api/documents";
import { trimToTokenWindow } from "../../../utils/tokenizer";

/** Shared configured adapter for surfaces that do not expose their own provider picker. */
export async function runConfiguredAssistantTurn(options: Omit<AssistantTurnRequest, "provider"> & {
  documentIds?: string[]; signal?: AbortSignal;
}) {
  const settings = useSettingsStore.getState().settings;
  const ids = options.documentIds ?? (options.sourceId ? [options.sourceId] : []);
  const documents = await Promise.all(ids.map((id) => getDocument(id)));
  const path = await resolveAiPath("prompt");
  const configured = useLLMProvidersStore.getState().providers.find((provider) => provider.enabled);
  const provider = path === "ondevice" ? "ondevice" : configured?.provider ?? "ondevice";
  const configuredContextTokens = path === "ondevice" ? 4096 : configured?.contextWindowTokens;
  let sourceContent = options.sourceContent;
  let sourceCoverage = options.sourceCoverage;
  let completeTranscriptSource = options.completeTranscriptSource;
  if (!sourceContent && options.scope !== "library" && ids.length === 1) {
    try {
      // Canonical full text for the selected document. Document scope answers
      // from this live evidence; retrieval remains the fallback when the text
      // cannot be resolved (orchestrator decides with the frozen ids).
      const loaded = (await loadDocumentQaText(ids[0], { getDocument, extractDocumentText })).trim()
        || "";
      if (loaded) {
        if (isVideoDocumentFileType(documents[0]?.fileType)) {
          // Complete-transcript turn: never head-slice a video transcript; the
          // video planner composes full or hierarchical coverage.
          sourceContent = loaded;
          completeTranscriptSource = true;
        } else {
          const sourceBudget = Math.max(512, Math.floor((configuredContextTokens ?? 16384) * 0.6));
          const trimmed = await trimToTokenWindow(loaded, sourceBudget);
          sourceContent = trimmed;
          sourceCoverage = trimmed === loaded ? "full" : "window";
        }
      }
    }
    catch { sourceContent = ""; }
  }
  return runAssistantTurn({
    ...options, sourceContent, sourceCoverage, completeTranscriptSource, provider, model: configured?.model, apiKey: configured?.apiKey,
    baseUrl: configured?.baseUrl, maxOutputTokens: configured?.maxTokens,
    configuredContextTokens,
    memoryEnabled: settings.ai.memoryEnabled, strictLocalOnly: settings.ai.strictLocalOnly,
    documentsForPrivacyCheck: documents,
    sourceType: documents[0]?.fileType === "youtube" || documents[0]?.fileType === "video" ? "video" : options.sourceType,
    chatExecutor: path === "ondevice" || path === "none" ? async ({ messages, context, maxTokens }) => {
      const systemInstruction = messages.filter((message) => message.role === "system").map((message) => String(message.content)).join("\n\n");
      const text = [context.content, ...messages.filter((message) => message.role !== "system").map((message) => `${message.role}: ${String(message.content)}`)].filter(Boolean).join("\n\n");
      const task = {
        id: "assistant-conversation", taskType: "prompt" as const, modelClass: "full" as const,
        systemInstruction, buildInput: (input: string) => ({ text: input }), outputKind: "text" as const,
        maxOutputTokens: maxTokens ?? 1200, timeoutMs: 60000, streaming: false, requirement: "prompt" as const,
      };
      const run = await runTask(task, text, { signal: options.signal, kind: "ondevice" });
      return { content: String(run.output ?? run.text) };
    } : undefined,
    libraryExecutor: options.scope === "library" || (options.scope === "document" && ids.length > 0) ? async ({ rewrittenQuery, history, contextPassage, contextBudgetTokens, k }) => {
      const [{ askLibrary }, { resolveLibraryRagComposition }, { resolveEmbeddingConfigForRag }] = await Promise.all([
        import("../tasks/definitions/libraryTask"), import("../resolveLibraryRag"), import("../../../components/assistant/ragConfig"),
      ]);
      const [composition, config] = await Promise.all([resolveLibraryRagComposition(), resolveEmbeddingConfigForRag().catch(() => undefined)]);
      return askLibrary({ query: rewrittenQuery, history, contextPassage, contextBudgetTokens, k, composition, config,
        filters: ids.length ? { documentIds: ids } : undefined, signal: options.signal,
        evidenceScope: options.scope === "document" ? "document" : "library" });
    } : undefined,
  });
}
