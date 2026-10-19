import { runAssistantTurn, type AssistantTurnRequest } from "../../lib/ai/assistant/orchestrator";
import { trimToTokenWindow } from "../../utils/tokenizer";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import type { Document } from "../../types/document";
import type { Message, RagHit } from "../../stores/documentQAStore";
import type { AskLibraryResult } from "../../lib/ai/tasks/definitions/libraryTask";
import { citedSourcesToCitations, citationsToRagHits } from "../../lib/ai/assistant/citations";

/** Resolve against current metadata at send time, never widen an empty filter. */
export function eligibleQaSources(documents: Document[], requestedIds: string[], collectionId: string, cloud: boolean): Document[] {
  const requested = new Set(requestedIds);
  return documents.filter((doc) => !doc.isAiExcluded && !(cloud && doc.isLocalOnly)
    && (!doc.collectionId || doc.collectionId === collectionId)
    && (requested.size === 0 || requested.has(doc.id)));
}

export function groundedQaMessage(result: AskLibraryResult, scope: NonNullable<Message["submittedScope"]>): Message {
  // Shared citation adapter (task 3.2). The cited set is exactly the model's
  // validated refs; `referenceNumber` carries the original prompt ordinal so
  // filtering never renumbers survivors (defect A4). A legacy result without
  // those fields still renders, numbered by position.
  const citedRefs = new Set(result.answer.sourceRefs.map((ref) => ref.refId));
  // Numbering: the source's stored `referenceNumber` when present; otherwise
  // its position in the supplied array, which for legacy results is the
  // original prompt ordinal (uncited hits included).
  const numbered = result.sources
    .map((source, originalIndex) => ({ source, originalIndex }))
    .filter(({ source }) => citedRefs.has(source.chunkId));
  const citations: RagHit[] = citedSourcesToCitations(
    numbered.map(({ source, originalIndex }) => ({
      ...source,
      referenceNumber: source.referenceNumber ?? originalIndex + 1,
      quote: source.quote ?? source.text,
      origin: source.origin ?? "library",
    })),
  ).map((citation, index) => ({
    documentId: citation.documentId ?? numbered[index]?.source.documentId ?? "",
    documentTitle: citation.title ?? numbered[index]?.source.documentTitle ?? "",
    chunkIndex: numbered[index]?.source.location?.ordinal ?? 0,
    chunkText: citation.quote ?? "",
    score: numbered[index]?.source.score ?? 1,
    citationNumber: citation.displayNumber,
  }));
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
  /** Test/alternate seam for the canonical document text loader. */
  loadDocumentText?: (documentId: string) => Promise<string>;
  /** Test seam for provider execution (matches the orchestrator contract). */
  chatExecutor?: AssistantTurnRequest["chatExecutor"];
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
  const turnScope =
    options.scope.conversationScope ??
    (documentIds.length === 1 ? "document" : "library");

  // Document scope answers from the selected document's own text — evidence
  // the user can see — and falls back to document-restricted retrieval only
  // when that text cannot be resolved. This keeps the workspace honest when
  // the document is not (yet) in the semantic index.
  let sourceContent = "";
  let sourceCoverage: "full" | "window" | undefined;
  if (turnScope === "document" && documentIds.length === 1) {
    try {
      const load = options.loadDocumentText ?? (async (documentId: string) => {
        const [{ getDocument, extractDocumentText }, { loadDocumentQaText }] = await Promise.all([
          import("../../api/documents"), import("./sectionContextRequest"),
        ]);
        return loadDocumentQaText(documentId, { getDocument, extractDocumentText });
      });
      const loaded = (await load(documentIds[0])).trim();
      if (loaded) {
        const contextTokens =
          configured?.contextWindowTokens && configured.contextWindowTokens > 0
            ? configured.contextWindowTokens
            : 16384;
        const sourceBudget = Math.max(512, Math.floor(contextTokens * 0.6));
        const trimmed = await trimToTokenWindow(loaded, sourceBudget);
        sourceContent = trimmed;
        sourceCoverage = trimmed === loaded ? "full" : "window";
      }
    } catch {
      sourceContent = "";
    }
  }

  const turn = await runAssistantTurn({
    scope: turnScope,
    userQuestion: options.question, history: options.history, selectionExcerpt: options.contextPassage,
    sourceContent, sourceCoverage,
    provider: composition.generatorKind === "cloud" ? configured?.provider ?? "openai" : "ondevice",
    configuredContextTokens: configured?.contextWindowTokens,
    documentsForPrivacyCheck: documents,
    chatExecutor: options.chatExecutor,
    libraryExecutor: async ({ rewrittenQuery, history, contextBudgetTokens, k }) => {
      libraryResult = await askLibrary({ query: rewrittenQuery, history, contextBudgetTokens, k, config, composition,
        filters: { documentIds }, contextPassage: options.contextPassage,
        evidenceScope: turnScope === "document" ? "document" : "library" });
      return libraryResult;
    },
  });
  if (libraryResult) {
    return { ...groundedQaMessage(libraryResult, { ...options.scope, documentIds }), content: turn.answer };
  }
  if (!turn.answer.trim()) throw new Error("qaWorkspace.sourceUnavailable");
  // Answered from the document's own text (no retrieval ran). No fabricated
  // citations: the source is the selected document itself.
  return {
    id: `assistant-${crypto.randomUUID()}`, role: "assistant", timestamp: Date.now(),
    content: turn.answer,
    sourceDocuments: [documentIds[0]],
    submittedScope: { ...options.scope, documentIds },
    evidence: {
      level: turn.evidenceLevel ?? "supported",
      retrievalOnly: false,
      mode: "semantic",
      documentCount: 1,
    },
  };
}
