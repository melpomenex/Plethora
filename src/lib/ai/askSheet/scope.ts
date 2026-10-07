/**
 * AskSheet scope resolution (OpenSpec `mobile-ask-sheet-library-qa`, tasks 1.2/1.3).
 *
 * Maps the sheet's Passage / Document / Library scope picker onto the
 * existing RAG machinery through the single `askLibrary` task:
 *
 * - passage:  no retrieval — the context chip text alone grounds the answer
 *              (passed as `contextPassage`; see the task's untrusted-context slot).
 * - document: semantic retrieval restricted to the current document
 *              (`RetrievalFilters.documentIds`), chunks become cited sources.
 * - library:  the standard library composition (`resolveLibraryRagComposition`),
 *              retrieval across the whole indexed library.
 *
 * Also exposes the "honest state" signals the sheet surfaces: how many
 * library documents are not yet indexed, and which answering mode
 * (on-device / cloud / retrieval-only) is active.
 */

import {
  askLibrary,
  type AskLibraryResult,
} from "../tasks/definitions/libraryTask";
import { resolveLibraryRagComposition } from "../resolveLibraryRag";
import { resolveEmbeddingConfigForRag } from "../../../components/assistant/ragConfig";
import type { SemanticRetriever } from "../capabilities/search";
import type { AIProvider } from "../providers/types";
import type { RagComposition } from "../ragComposition";
import {
  getAIIndexStatus,
  retrieveFromLibrary,
  type IndexStatusResponse,
  type RetrievalFilters,
  type RetrievalResponse,
} from "../../../api/ai-learning";

export type AskScope = "passage" | "document" | "library";

export interface AskInScopeOptions {
  scope: AskScope;
  query: string;
  /** The selected/edited passage (context chip). Grounded but never cited. */
  contextPassage?: string;
  /** Current document id — required for meaningful document scope. */
  documentId?: string;
  k?: number;
  signal?: AbortSignal;
  /** Explicit provider injection (tests). */
  provider?: AIProvider;
  kind?: "ondevice" | "cloud";
  /** Composition override (tests / pre-resolved). */
  composition?: RagComposition;
  /** Retriever override (tests / platform-specific). */
  retriever?: SemanticRetriever;
  /** Retrieval override (tests). */
  retrieve?: typeof retrieveFromLibrary;
}

const EMPTY_RETRIEVAL: RetrievalResponse = {
  results: [],
  mode: "semantic",
  candidatesScanned: 0,
};

/**
 * Ask a question under the given scope. Returns the standard
 * `AskLibraryResult` (validated answer + cited sources with deep-link
 * metadata + composition provenance) for all three scopes.
 */
export async function askInScope(options: AskInScopeOptions): Promise<AskLibraryResult> {
  const composition = options.composition ?? (await resolveLibraryRagComposition());
  const shared = {
    query: options.query,
    signal: options.signal,
    provider: options.provider,
    kind: options.kind,
    composition,
  };

  if (options.scope === "passage") {
    // Spec: passage scope performs no library retrieval — the chip text
    // alone grounds the answer via the task's contextPassage slot.
    return askLibrary({
      ...shared,
      contextPassage: options.contextPassage,
      retrieve: async () => EMPTY_RETRIEVAL,
    });
  }

  // Document scope narrows retrieval to the current document; library scope
  // searches the whole index. Embedding config resolution is best-effort:
  // without it the backend falls back to lexical-only retrieval.
  const config = await resolveEmbeddingConfigForRag().catch(() => undefined);
  const filters: RetrievalFilters | undefined =
    options.scope === "document" && options.documentId
      ? { documentIds: [options.documentId] }
      : undefined;

  return askLibrary({
    ...shared,
    k: options.k,
    filters,
    config,
    contextPassage: options.contextPassage,
    retriever: options.retriever,
    retrieve: options.retrieve,
  });
}

export interface AskSheetIndexState {
  /** Library documents not yet in the semantic index (honest disclosure). */
  unindexedCount: number;
  /** Active answering mode: on-device / cloud / retrieval-only ("none"). */
  generatorKind: RagComposition["generatorKind"];
}

/**
 * Read the honest-state signals for the sheet: index freshness and the
 * resolved answering mode. Index-status failures degrade to "unknown"
 * (count 0) rather than blocking the sheet.
 */
export async function getAskSheetIndexState(deps?: {
  getStatus?: () => Promise<IndexStatusResponse>;
  resolveComposition?: () => Promise<RagComposition>;
}): Promise<AskSheetIndexState> {
  const [status, composition] = await Promise.all([
    (deps?.getStatus ?? getAIIndexStatus)().catch(() => null),
    (deps?.resolveComposition ?? resolveLibraryRagComposition)(),
  ]);
  const unindexedCount =
    status?.documents.filter((d) => d.state === "unindexed").length ?? 0;
  return { unindexedCount, generatorKind: composition.generatorKind };
}
