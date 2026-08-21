/**
 * `AskPlethoraTask` — canonical product documentation grounded Q&A.
 *
 * Grounding Pipeline:
 *  1. In-memory local hybrid retrieval via `defaultHelpRetrieval.search(query, { context })`
 *  2. Wrap retrieved chunks with `wrapUntrustedBlock(chunk.id, chunk.content)`
 *  3. AI generation with strict grounding instructions
 *  4. Verbatim citation verification against retrieved chunks
 *  5. Graceful offline zero-AI fallback
 */

import {
  LIBRARY_ANSWER_SCHEMA,
  validateLibraryAnswer,
  type LibraryAnswer,
  type LibrarySourceRef,
} from "../../schemas/libraryAnswer";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { runTask } from "../runTask";
import { registerTasks } from "../registry";
import type { AITaskDefinition, AITaskResult } from "../types";
import { defaultHelpRetrieval, type RetrievalOptions } from "../../../../features/help/helpRetrieval";
import type { HelpAppContext, HelpDocChunk, HelpSearchResult } from "../../../../features/help/helpTypes";
import type { AIProvider } from "../../providers/types";

export const ASK_PLETHORA_TASK_ID = "ask-plethora";
export const ASK_PLETHORA_TIMEOUT_MS = 30_000;
export const ASK_PLETHORA_MAX_OUTPUT_TOKENS = 1200;

const ASK_PLETHORA_SYSTEM_INSTRUCTION = [
  UNTRUSTED_CONTAINMENT_CLAUSE,
  "You are Ask Plethora, the official intelligent assistant for Plethora (the cognitive learning workstation).",
  "Answer questions about Plethora functionality, features, settings, algorithms, shortcuts, and troubleshooting using ONLY the provided numbered <untrusted_source> documentation chunks.",
  "Grounding & Citation Rules:",
  "1. Cite with [N] markers in the answer text corresponding to the numbered chunks.",
  "2. Every [N] marker used MUST appear in sourceRefs with matching refId and verbatim quote.",
  "3. If the documentation chunks do not contain enough information, state honestly that Plethora canonical documentation does not cover the topic and set evidenceLevel to \"none\" — NEVER hallucinate or invent features.",
  "4. If relevant, mention exact keyboard shortcuts (e.g. Cmd+K, Alt+P) and setting keys.",
  "5. Return ONLY the valid JSON object adhering to the schema.",
].join("\n");

export interface AskPlethoraSource {
  id: string;
  docId: string;
  title: string;
  text: string;
}

export interface AskPlethoraInput {
  query: string;
  sources: AskPlethoraSource[];
  appContext?: Partial<HelpAppContext>;
}

export const askPlethoraTask: AITaskDefinition<AskPlethoraInput, LibraryAnswer> = {
  id: ASK_PLETHORA_TASK_ID,
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: ASK_PLETHORA_SYSTEM_INSTRUCTION,
  buildInput: ({ query, sources, appContext }) => ({
    text: [
      "Answer the user's question about Plethora using ONLY these numbered product documentation chunks:",
      "",
      ...sources.map((source, index) =>
        [
          `[${index + 1}] (${source.title})`,
          wrapUntrustedBlock(source.id, source.text),
        ].join(" ")
      ),
      ...(appContext?.activeView
        ? [
            "",
            `[Current App Context: view=${appContext.activeView}, format=${appContext.documentFormat || "none"}, tts=${appContext.ttsActive ? "active" : "inactive"}]`,
          ]
        : []),
      "",
      "User Question:",
      query,
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: LIBRARY_ANSWER_SCHEMA,
  validate: (output, input) =>
    validateLibraryAnswer(output, {
      sources: new Map(input.sources.map((s) => [s.id, s.text])),
    }),
  maxOutputTokens: ASK_PLETHORA_MAX_OUTPUT_TOKENS,
  timeoutMs: ASK_PLETHORA_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
  budgetPolicy: "pre-budgeted",
};

registerTasks(askPlethoraTask);

export interface AskPlethoraOptions {
  query: string;
  context?: Partial<HelpAppContext>;
  retrievalOptions?: RetrievalOptions;
  signal?: AbortSignal;
  provider?: AIProvider;
  kind?: "ondevice" | "cloud";
}

export interface AskPlethoraResult {
  answer: LibraryAnswer;
  retrievedResults: HelpSearchResult[];
  usedChunks: HelpDocChunk[];
  mode: "ai" | "zero-ai-fallback";
  run?: AITaskResult<LibraryAnswer>;
}

/**
 * Executes grounded Ask Plethora RAG query.
 */
export async function askPlethora(options: AskPlethoraOptions): Promise<AskPlethoraResult> {
  const query = options.query.trim();

  // 1. Check direct zero-latency canonical lookup first
  const direct = defaultHelpRetrieval.resolveDirectLookup(query);
  if (direct && direct.confidence >= 0.95) {
    const directAnswer: LibraryAnswer = {
      answer: `**${direct.title}**\n\n${direct.summary}\n\n**How to use:** ${direct.how_to}\n\n**Rationale:** ${direct.why}`,
      sourceRefs: [
        {
          refId: `${direct.featureId}#summary`,
          quote: direct.summary.slice(0, 200),
        },
      ],
      evidenceLevel: "supported",
    };

    const doc = defaultHelpRetrieval.getDocument(direct.featureId);
    const chunk: HelpDocChunk = {
      id: `${direct.featureId}#summary`,
      docId: direct.featureId,
      title: direct.title,
      domain: doc?.domain || "concepts",
      section: "Summary",
      content: `${direct.summary}\n${direct.how_to}\n${direct.why}`,
      aliases: doc?.aliases || [],
      tags: doc?.related || [],
      platforms: doc?.platforms || ["all"],
      actions: doc?.actions || [],
      filePath: doc?.filePath || "",
    };

    return {
      answer: directAnswer,
      retrievedResults: [
        {
          chunk,
          score: 1.0,
          baseScore: 1.0,
          boostMultiplier: 1.0,
          matchReasons: ["Direct canonical match"],
        },
      ],
      usedChunks: [chunk],
      mode: "zero-ai-fallback",
    };
  }

  // 2. Hybrid retrieval across canonical documentation
  const searchResults = defaultHelpRetrieval.search(query, {
    limit: 5,
    maxTokens: 1500,
    context: options.context,
    ...options.retrievalOptions,
  });

  if (searchResults.length === 0) {
    return {
      answer: {
        answer: "Plethora product documentation does not contain information answering this question.",
        sourceRefs: [],
        evidenceLevel: "none",
      },
      retrievedResults: [],
      usedChunks: [],
      mode: "zero-ai-fallback",
    };
  }

  const sources: AskPlethoraSource[] = searchResults.map((r) => ({
    id: r.chunk.id,
    docId: r.chunk.docId,
    title: r.chunk.title,
    text: r.chunk.content,
  }));

  try {
    const run = await runTask(
      askPlethoraTask,
      { query, sources, appContext: options.context },
      {
        signal: options.signal,
        provider: options.provider,
        kind: options.kind,
        targetId: `help:${query}`,
        retrieval: {
          count: searchResults.length,
          chunkIds: searchResults.map((r) => r.chunk.id),
        },
      }
    );

    return {
      answer: run.output,
      retrievedResults: searchResults,
      usedChunks: searchResults.map((r) => r.chunk),
      mode: "ai",
      run,
    };
  } catch (error) {
    // Graceful offline fallback: construct structured answer from top retrieval chunk
    const topChunk = searchResults[0].chunk;
    const fallbackAnswer: LibraryAnswer = {
      answer: `Here is the relevant information from Plethora documentation regarding **${topChunk.title}**:\n\n${topChunk.content}`,
      sourceRefs: [
        {
          refId: topChunk.id,
          quote: topChunk.content.slice(0, 200),
        },
      ],
      evidenceLevel: "supported",
    };

    return {
      answer: fallbackAnswer,
      retrievedResults: searchResults,
      usedChunks: searchResults.map((r) => r.chunk),
      mode: "zero-ai-fallback",
    };
  }
}
