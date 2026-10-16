import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { resolveAiPath } from "../provider";
import { runTask } from "../tasks/runTask";
import { runAssistantTurn, type AssistantTurnRequest } from "./orchestrator";
import { getDocument } from "../../../api/documents";
import { loadDocumentQaText } from "../../../features/documentQa/sectionContextRequest";
import { extractDocumentText } from "../../../api/documents";

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
  let sourceContent = options.sourceContent;
  if (!sourceContent && options.scope !== "library" && ids.length === 1) {
    try { sourceContent = await loadDocumentQaText(ids[0], { getDocument, extractDocumentText }); }
    catch { sourceContent = ""; }
  }
  return runAssistantTurn({
    ...options, sourceContent, provider, model: configured?.model, apiKey: configured?.apiKey,
    baseUrl: configured?.baseUrl, maxOutputTokens: configured?.maxTokens,
    configuredContextTokens: path === "ondevice" ? 4096 : configured?.contextWindowTokens,
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
        filters: ids.length ? { documentIds: ids } : undefined, signal: options.signal });
    } : undefined,
  });
}
