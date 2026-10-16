import { runAssistantTurn } from "../../lib/ai/assistant/orchestrator";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import type { Document } from "../../types/document";
import type { Message, RagHit } from "../../stores/documentQAStore";
import type { AskLibraryResult } from "../../lib/ai/tasks/definitions/libraryTask";

/** Resolve against current metadata at send time, never widen an empty filter. */
export function eligibleQaSources(documents: Document[], requestedIds: string[], collectionId: string, cloud: boolean): Document[] {
  const requested = new Set(requestedIds);
  return documents.filter((doc) => !doc.isAiExcluded && !(cloud && doc.isLocalOnly)
    && (!doc.collectionId || doc.collectionId === collectionId)
    && (requested.size === 0 || requested.has(doc.id)));
}

export function groundedQaMessage(result: AskLibraryResult, scope: NonNullable<Message["submittedScope"]>): Message {
  const cited = new Set(result.answer.sourceRefs.map((ref) => ref.refId));
  // Keep original numeric references even when uncited retrieval hits are omitted.
  const citations: RagHit[] = result.sources.flatMap((source, index) => cited.has(source.chunkId) ? [{
    documentId: source.documentId, documentTitle: source.documentTitle ?? source.documentId,
    chunkIndex: source.location.ordinal, chunkText: source.text, score: source.score, citationNumber: index + 1,
  }] : []);
  const documentIds = [...new Set(citations.map((source) => source.documentId))];
  return {
    id: `assistant-${crypto.randomUUID()}`, role: "assistant", timestamp: Date.now(),
    content: result.answer.answer, citations: citations.length ? citations : undefined,
    sourceDocuments: documentIds.length ? documentIds : undefined,
    submittedScope: scope,
    evidence: { level: result.answer.evidenceLevel, retrievalOnly: result.retrievalOnly, mode: result.mode, documentCount: documentIds.length },
  };
}

export async function askQaKnowledge(options: {
  history?: import("../../lib/ai/assistant/promptBuilder").ConversationHistoryTurn[];
  question: string; scope: NonNullable<Message["submittedScope"]>; collectionId: string; contextPassage?: string;
}): Promise<Message> {
  const [{ askLibrary }, { resolveLibraryRagComposition }, { resolveEmbeddingConfigForRag }, { useDocumentStore }, { useCollectionStore }] = await Promise.all([
    import("../../lib/ai/tasks/definitions/libraryTask"), import("../../lib/ai/resolveLibraryRag"),
    import("../../components/assistant/ragConfig"), import("../../stores/documentStore"), import("../../stores/collectionStore"),
  ]);
  const [composition, config] = await Promise.all([resolveLibraryRagComposition(), resolveEmbeddingConfigForRag().catch(() => undefined)]);
  if (useCollectionStore.getState().activeCollectionId !== options.collectionId) throw new Error("qaWorkspace.collectionChanged");
  const documents = eligibleQaSources(useDocumentStore.getState().documents, options.scope.documentIds,
    options.collectionId, composition.generatorKind === "cloud");
  if (!documents.length || options.scope.documentIds.some((id) => !documents.some((doc) => doc.id === id))) {
    throw new Error("qaWorkspace.sourceUnavailable");
  }
  const documentIds = documents.map((doc) => doc.id);
  let libraryResult: AskLibraryResult | undefined;
  const configured = useLLMProvidersStore.getState().providers.find((provider) => provider.enabled);
  const turn = await runAssistantTurn({
    scope: options.scope.conversationScope ?? (documentIds.length === 1 ? "document" : "library"),
    userQuestion: options.question, history: options.history, selectionExcerpt: options.contextPassage,
    provider: composition.generatorKind === "cloud" ? configured?.provider ?? "openai" : "ondevice",
    configuredContextTokens: configured?.contextWindowTokens,
    documentsForPrivacyCheck: documents,
    libraryExecutor: async ({ rewrittenQuery, history, contextBudgetTokens, k }) => {
      libraryResult = await askLibrary({ query: rewrittenQuery, history, contextBudgetTokens, k, config, composition,
        filters: { documentIds }, contextPassage: options.contextPassage });
      return libraryResult;
    },
  });
  if (!libraryResult) throw new Error("qaWorkspace.sourceUnavailable");
  return { ...groundedQaMessage(libraryResult, { ...options.scope, documentIds }), content: turn.answer };
}
