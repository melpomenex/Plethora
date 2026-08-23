/**
 * `AskLibraryTask` — whole-library grounded Q&A (design D15 / ai-library-rag
 * spec, tasks 4.9/4.10).
 *
 * Pipeline (run through `askLibrary()` below):
 *   1. `retrieveFromLibrary(query, k≈8, filters)` — semantic retrieval with
 *      the Rust-side FTS5 lexical fallback (`mode: "semantic"|"lexicalOnly"`);
 *   2. diversity-dedup: chunk-neighborhood dedup already happened in Rust, so
 *      TS only drops near-identical chunk texts (normalized whitespace);
 *   3. token budget: the chunk LIST is truncated (never a chunk itself) so the
 *      wrapped block text fits the on-device context estimate minus the
 *      instruction/query/output reserve;
 *   4. `runTask` on the task below — every chunk is wrapped via
 *      `wrapUntrustedBlock` with its `[N]` citation id, and the user's query
 *      comes LAST, outside the untrusted blocks;
 *   5. validation (`schemas/libraryAnswer.ts`): every `sourceRefs` entry must
 *      map to a chunk id we supplied and quote it verbatim (normalized
 *      whitespace); violators are dropped, never rendered.
 *
 * Honest-evidence rules (spec): no/weak evidence ⇒ say the library does not
 * appear to cover it instead of fabricating; conflicting sources ⇒ report the
 * conflict with citations. AI answers are NEVER auto-indexed (D15) — nothing
 * here writes to the index.
 */

import { estimateTokens } from "../../chunkTextByTokens";
import {
  LIBRARY_ANSWER_SCHEMA,
  validateLibraryAnswer,
  type LibraryAnswer,
} from "../../schemas/libraryAnswer";
import type { AIProvider } from "../../providers/types";
import {
  retrieveFromLibrary,
  DEFAULT_RETRIEVAL_K,
  type EmbeddingConfig,
  type RetrievalFilters,
  type RetrievalResult,
} from "../../../../api/ai-learning";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { runTask } from "../runTask";
import { registerTasks } from "../registry";
import type { AITaskDefinition, AITaskResult } from "../types";
import { DEFAULT_LIBRARY_RAG, type RagComposition } from "../../ragComposition";
import { RAG_NAMESPACE_HELP, type SemanticRetriever } from "../../capabilities/search";
import { AIError } from "../../errors";

export const ASK_LIBRARY_TASK_ID = "ask-library";

/** Library answering is a full-class task (design D3 policy table). */
export const ASK_LIBRARY_TIMEOUT_MS = 60_000;
export const ASK_LIBRARY_MAX_OUTPUT_TOKENS = 1200;

/** Default retrieval width for a library question (k≈8 per design D15). */
export const ASK_LIBRARY_K = DEFAULT_RETRIEVAL_K;

/**
 * Estimated context tokens available for the wrapped chunk text on the
 * smallest served provider (Gemini Nano ≈ 4k window) minus the instruction,
 * query, and output reserve. The chunk list is truncated to this budget;
 * individual chunks are never cut mid-thought.
 */
export const ASK_LIBRARY_CONTEXT_TOKEN_BUDGET = 2_400;

/** Reserved estimate for the static instruction + query + output tokens. */
const RESERVE_TOKENS = 1_200;

const ASK_LIBRARY_CORE_INSTRUCTION = [
  "You answer questions about the user's personal library using ONLY the numbered <untrusted_source> chunks provided.",
  "Cite with [N] markers in the answer text: every claim must carry the number(s) of the chunk(s) it comes from, and every number you use MUST appear in the sourceRefs list with the matching refId.",
  "The refId of source [N] is the id attribute of N's untrusted_source block; quote the supporting sentence verbatim in that ref's quote field.",
  "If the chunks do not contain enough relevant material, answer honestly that the library does not appear to cover the question and set evidenceLevel to \"none\" — never answer from outside knowledge.",
  "If the chunks disagree, present the conflict with citations from each side and set evidenceLevel to \"conflicting\" — do not silently pick a side.",
  "Use \"supported\" when the chunks directly answer the question, \"weak\" when they only partially or indirectly support an answer.",
  "Return ONLY the JSON object.",
].join("\n");

/** One chunk prepared for the prompt (already retrieved + budgeted). */
export interface AskLibrarySource {
  /** Retrieval chunk id (`RetrievalResult.chunkId`) — becomes `refId`. */
  id: string;
  text: string;
}

export interface AskLibraryInput {
  /** The user's question (trusted — it is the user's own words). */
  query: string;
  /** Retrieved chunks, order = citation order ([1..N]). */
  sources: AskLibrarySource[];
  /**
   * Optional extra context (e.g. the current text selection that prompted the
   * question). Wrapped as an untrusted block like every other source; it gets
   * no citation number and cannot be cited (its id is absent from the chunk
   * map, so fabricated refs to it are dropped by validation).
   */
  contextPassage?: string;
}

export const askLibraryTask: AITaskDefinition<AskLibraryInput, LibraryAnswer> = {
  id: ASK_LIBRARY_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${ASK_LIBRARY_CORE_INSTRUCTION}`,
  buildInput: ({ query, sources, contextPassage }) => ({
    text: [
      "Answer the question at the end using only these numbered library chunks:",
      "",
      ...sources.map((source, index) =>
        [
          `[${index + 1}]`,
          wrapUntrustedBlock(source.id, source.text),
        ].join(" ")
      ),
      ...(contextPassage
        ? [
            "",
            "The user selected this passage while asking (context only — not a citable source):",
            wrapUntrustedBlock("selection-context", contextPassage),
          ]
        : []),
      "",
      "Question:",
      query,
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: LIBRARY_ANSWER_SCHEMA,
  validate: (output, input) =>
    validateLibraryAnswer(output, {
      sources: new Map(input.sources.map((s) => [s.id, s.text])),
    }),
  maxOutputTokens: ASK_LIBRARY_MAX_OUTPUT_TOKENS,
  timeoutMs: ASK_LIBRARY_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
  budgetPolicy: "pre-budgeted",
};

registerTasks(askLibraryTask);

// ──────────────────────────────────────────────────────────────────────────
// Context preparation (pure — unit-tested without a backend)
// ──────────────────────────────────────────────────────────────────────────

function normalizeChunkText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Drop near-identical chunk texts (same normalized text) and chunks whose
 * normalized text contains an earlier chunk's normalized text (extracts that
 * duplicate their document chunk). Rust already deduplicated adjacent
 * ordinals; this is the cross-document / cross-source pass.
 */
export function dedupeRetrievedChunks(results: RetrievalResult[]): RetrievalResult[] {
  const kept: RetrievalResult[] = [];
  const normalized: string[] = [];
  for (const result of results) {
    const text = normalizeChunkText(result.text);
    if (!text) continue;
    // Exact duplicate of an earlier chunk.
    if (normalized.includes(text)) continue;
    // This chunk adds nothing over an earlier, contained chunk.
    if (normalized.some((earlier) => text.includes(earlier))) continue;
    kept.push(result);
    normalized.push(text);
  }
  return kept;
}

/**
 * Truncate the chunk list so the wrapped block text fits
 * `ASK_LIBRARY_CONTEXT_TOKEN_BUDGET` (chunks are dropped whole from the tail —
 * retrieval rank order — never cut mid-chunk).
 */
export function fitChunksToContextBudget(
  results: RetrievalResult[],
  budget = ASK_LIBRARY_CONTEXT_TOKEN_BUDGET
): RetrievalResult[] {
  const kept: RetrievalResult[] = [];
  let used = 0;
  for (const result of results) {
    // Each block wraps the chunk with an id tag + [N] marker overhead.
    const cost = estimateTokens(result.text) + 8;
    if (used + cost > budget) break;
    used += cost;
    kept.push(result);
  }
  return kept;
}

/**
 * Total-context check including the reserve; exposed for tests and for the
 * UI to explain why chunks were dropped.
 */
export function askLibraryBudgetExplain(): {
  contextBudget: number;
  reserve: number;
} {
  return { contextBudget: ASK_LIBRARY_CONTEXT_TOKEN_BUDGET, reserve: RESERVE_TOKENS };
}

// ──────────────────────────────────────────────────────────────────────────
// End-to-end run: retrieve → dedup → budget → task → validated answer
// ──────────────────────────────────────────────────────────────────────────

/** A retrieval chunk the answer may cite, with UI navigation metadata. */
export interface AskLibraryCitedSource {
  chunkId: string;
  documentId: string;
  documentTitle?: string;
  sourceType: string;
  sourceId?: string;
  text: string;
  headingPath: string[];
  location: RetrievalResult["location"];
  score: number;
}

export interface AskLibraryResult {
  /** Validated `LibraryAnswer` (citations already verified/dropped). */
  answer: LibraryAnswer;
  /** The chunks that were supplied to the model, keyed for ref lookups. */
  sources: AskLibraryCitedSource[];
  /** Chunks retrieved but dropped by dedup/budgeting (diagnostics). */
  droppedChunks: number;
  mode: "semantic" | "lexicalOnly";
  candidatesScanned: number;
  /** The task-layer run (provider/modelClass provenance). */
  run: AITaskResult<LibraryAnswer>;
  composition: RagComposition;
  /** True when hits are shown without calling a generator. */
  retrievalOnly: boolean;
}

export interface AskLibraryOptions {
  query: string;
  /** Retrieval width (default `ASK_LIBRARY_K` ≈ 8, design D15). */
  k?: number;
  filters?: RetrievalFilters;
  /**
   * Embedding config for the retrieval step (Ollama/cloud backends). When
   * omitted the backend's on-device default applies and retrieval may fall
   * back to lexical-only mode.
   */
  config?: EmbeddingConfig;
  /** Extra untrusted context (e.g. the selection that prompted the ask). */
  contextPassage?: string;
  signal?: AbortSignal;
  /** Explicit provider injection (tests / FakeAIProvider eval runs). */
  provider?: AIProvider;
  /** Pins the provider kind when the caller already resolved availability. */
  kind?: "ondevice" | "cloud";
  /** Injectable retrieval for tests. */
  retrieve?: typeof retrieveFromLibrary;
  /** Retriever × generator pairing (OpenSpec D). Defaults to library + on-device. */
  composition?: RagComposition;
  /** Fake/native semantic retriever; used when composition.retrieverId is not ai_learning. */
  retriever?: SemanticRetriever;
}

/**
 * Ask the library a question. Throws the task layer's typed `AIError`s;
 * retrieval failures propagate before generation (never answer ungrounded).
 */
function citedFromBudgeted(budgeted: RetrievalResult[]): AskLibraryCitedSource[] {
  return budgeted.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    text: r.text,
    headingPath: r.headingPath,
    location: r.location,
    score: r.score,
  }));
}

export async function askLibrary(options: AskLibraryOptions): Promise<AskLibraryResult> {
  const composition = options.composition ?? DEFAULT_LIBRARY_RAG;
  if (composition.namespace === RAG_NAMESPACE_HELP && !options.retriever && !options.retrieve) {
    throw new AIError(
      "IndexUnavailable",
      "Ask Plethora help retrieval must not use the library corpus.",
      { code: "wrong_rag_namespace", taskId: ASK_LIBRARY_TASK_ID }
    );
  }

  const retrieve = options.retrieve ?? retrieveFromLibrary;
  const retrieval = options.retriever
    ? {
        results: await options.retriever.retrieve({
          query: options.query,
          k: options.k ?? ASK_LIBRARY_K,
          namespace: composition.namespace,
        }),
        mode: "semantic" as const,
        candidatesScanned: 0,
      }
    : await retrieve(options.query, {
        k: options.k ?? ASK_LIBRARY_K,
        filters: options.filters,
        config: options.config,
        includeSpotlight: options.retrieve == null,
      });

  const deduped = dedupeRetrievedChunks(retrieval.results);
  const budgeted = fitChunksToContextBudget(deduped);

  // Nothing survived retrieval: answer honestly without invoking a model —
  // there is nothing to ground on, and a zero-chunk prompt invites
  // fabrication (spec: "the library does not appear to cover it").
  if (budgeted.length === 0) {
    return {
      answer: {
        answer:
          "The library does not appear to contain material relevant to this question.",
        sourceRefs: [],
        evidenceLevel: "none",
      },
      sources: [],
      droppedChunks: 0,
      mode: retrieval.mode,
      candidatesScanned: retrieval.candidatesScanned,
      composition,
      retrievalOnly: true,
      run: {
        taskId: askLibraryTask.id,
        output: {
          answer:
            "The library does not appear to contain material relevant to this question.",
          sourceRefs: [],
          evidenceLevel: "none",
        },
        text: "",
        providerId: "retrieval-only",
        providerKind: options.kind ?? "ondevice",
        requestedModelClass: askLibraryTask.modelClass,
        servedModelClass: askLibraryTask.modelClass,
        fallbackPath: "none",
        validationOutcome: "text",
      },
    };
  }

  if (composition.generatorKind === "none") {
    const sources = citedFromBudgeted(budgeted);
    const answerText = sources
      .map((source, index) => `[${index + 1}] ${source.text}`)
      .join("\n\n");
    return {
      answer: {
        answer: answerText,
        sourceRefs: sources.map((source) => ({
          refId: source.chunkId,
          quote: source.text,
        })),
        evidenceLevel: "weak",
      },
      sources,
      droppedChunks: retrieval.results.length - budgeted.length,
      mode: retrieval.mode,
      candidatesScanned: retrieval.candidatesScanned,
      composition,
      retrievalOnly: true,
      run: {
        taskId: askLibraryTask.id,
        output: {
          answer: answerText,
          sourceRefs: sources.map((source) => ({
            refId: source.chunkId,
            quote: source.text,
          })),
          evidenceLevel: "weak",
        },
        text: answerText,
        providerId: "retrieval-only",
        providerKind: "ondevice",
        requestedModelClass: askLibraryTask.modelClass,
        servedModelClass: askLibraryTask.modelClass,
        fallbackPath: "none",
        validationOutcome: "text",
      },
    };
  }

  const sources: AskLibrarySource[] = budgeted.map((result) => ({
    id: result.chunkId,
    text: result.text,
  }));

  const run = await runTask(
    askLibraryTask,
    { query: options.query, sources, contextPassage: options.contextPassage },
    {
      signal: options.signal,
      provider: options.provider,
      kind: options.kind,
      targetId: `library:${options.query}`,
      retrieval: {
        count: retrieval.results.length,
        chunkIds: retrieval.results.map((r) => r.chunkId),
      },
    }
  );

  // The validator dropped fabricated refs; map the surviving ones back to
  // their retrieval results so the UI can render navigable source chips.
  const byId = new Map(budgeted.map((r) => [r.chunkId, r]));
  const cited: AskLibraryCitedSource[] = run.output.sourceRefs
    .map((ref) => byId.get(ref.refId))
    .filter((r): r is RetrievalResult => r !== undefined)
    .map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      text: r.text,
      headingPath: r.headingPath,
      location: r.location,
      score: r.score,
    }));

  return {
    answer: run.output,
    sources: cited,
    droppedChunks: retrieval.results.length - budgeted.length,
    mode: retrieval.mode,
    candidatesScanned: retrieval.candidatesScanned,
    composition,
    retrievalOnly: false,
    run,
  };
}
