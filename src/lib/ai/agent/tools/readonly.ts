/**
 * Read-only agent tools (design D25, task 8.1).
 *
 * Eight tools over existing APIs — no writes anywhere:
 *   search_library, get_current_document, get_current_selection,
 *   get_recent_reading_context, get_related_material, get_existing_cards,
 *   get_review_history, get_due_cards.
 *
 * Contract notes:
 *  - ids the tools RETURN are real ids from real records; ids the model
 *    SENDS are never trusted (the only id-taking inputs resolve through a
 *    query first and verify existence via the API — see proposals.ts);
 *  - every result is a structured JSON payload + `displayDigest` + optional
 *    navigable `sources` — the loop wraps `result` in an untrusted block
 *    before it re-enters a prompt;
 *  - list parameters are clamped ≤ 20 (`MAX_TOOL_LIMIT`).
 */

import { valid, type ValidationOutcome } from "../../schemas/common";
import {
  MAX_TOOL_LIMIT,
  optionalLimit,
  rejectUnknownParams,
  requireString,
} from "./validation";
import {
  toolError,
  toolNotAvailable,
  toolOk,
  type AgentSourceRef,
  type AgentToolContext,
  type AgentToolDefinition,
} from "./types";

/** Max characters of chunk/extract text carried per result entry. */
const MAX_TEXT_SNIPPET_CHARS = 600;

function snippet(text: string): string {
  return text.length > MAX_TEXT_SNIPPET_CHARS
    ? `${text.slice(0, MAX_TEXT_SNIPPET_CHARS)}…`
    : text;
}

function chunkSources(
  results: Array<{
    chunkId: string;
    documentId: string;
    documentTitle?: string;
    headingPath: string[];
  }>
): AgentSourceRef[] {
  return results.map((r) => ({
    refId: r.chunkId,
    kind: "chunk" as const,
    documentId: r.documentId,
    title: r.documentTitle,
    locator: r.headingPath.join(" › "),
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// search_library
// ──────────────────────────────────────────────────────────────────────────

const SEARCH_SCOPES = ["all", "documents", "extracts", "cards"] as const;
type SearchScope = (typeof SEARCH_SCOPES)[number];

interface SearchLibraryInput {
  query: string;
  scope?: SearchScope;
}

export const searchLibraryTool: AgentToolDefinition<SearchLibraryInput> = {
  name: "search_library",
  description:
    "Search the user's whole library (documents, extracts, cards) semantically with a lexical fallback. Returns snippets with chunk ids, document titles and heading paths. Use focused keyword queries.",
  category: "retrieval",
  validate: (input): ValidationOutcome<SearchLibraryInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["search_library: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["query", "scope"], "search_library"),
    ];
    const query = requireString(raw, "query", errors, { maxLength: 400 });
    let scope: SearchScope | undefined;
    if (raw.scope !== undefined && raw.scope !== null) {
      if (typeof raw.scope !== "string" || !(SEARCH_SCOPES as readonly string[]).includes(raw.scope)) {
        errors.push(`search_library.scope: expected one of [${SEARCH_SCOPES.join("|")}]`);
      } else {
        scope = raw.scope as SearchScope;
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    const out: SearchLibraryInput = { query: query! };
    if (scope) out.scope = scope;
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const filters =
        input.scope === "documents"
          ? { sourceTypes: ["document"] }
          : input.scope === "extracts"
            ? { sourceTypes: ["extract"] }
            : input.scope === "cards"
              ? { sourceTypes: ["card"] }
              : undefined;
      const retrieval = await ctx.env.retrieve(input.query, { k: 6, filters });
      const results = retrieval.results.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        headingPath: r.headingPath,
        text: snippet(r.text),
        score: Math.round(r.score * 1000) / 1000,
      }));
      return toolOk(
        { mode: retrieval.mode, results },
        `search "${input.query}": ${results.length} result(s)`,
        chunkSources(retrieval.results)
      );
    } catch (error) {
      return toolError(`search_library failed: ${(error as Error).message}`);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_current_document
// ──────────────────────────────────────────────────────────────────────────

export const getCurrentDocumentTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_current_document",
  description:
    "Get the document the user currently has open (id, title, file type, reading position). Returns not-available when no document is open.",
  category: "read",
  validate: (input): ValidationOutcome<Record<string, never>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_current_document: expected object"] };
    }
    const errors = rejectUnknownParams(input as Record<string, unknown>, [], "get_current_document");
    if (errors.length > 0) return { ok: false, errors };
    return valid({});
  },
  execute: async (_input, ctx: AgentToolContext) => {
    const doc = ctx.env.getDocument();
    if (!doc) {
      return toolNotAvailable("No document is currently open.");
    }
    return toolOk(
      {
        id: doc.id,
        title: doc.title,
        fileType: doc.fileType,
        currentPage: doc.currentPage,
        totalPages: doc.totalPages,
        progressPercent: doc.progressPercent,
      },
      `current document: ${doc.title}`,
      [{ refId: doc.id, kind: "document", documentId: doc.id, title: doc.title }]
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_current_selection
// ──────────────────────────────────────────────────────────────────────────

export const getCurrentSelectionTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_current_selection",
  description:
    "Get the text the user currently has selected in the open document. Returns not-available when nothing is selected.",
  category: "read",
  validate: (input): ValidationOutcome<Record<string, never>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_current_selection: expected object"] };
    }
    const errors = rejectUnknownParams(input as Record<string, unknown>, [], "get_current_selection");
    if (errors.length > 0) return { ok: false, errors };
    return valid({});
  },
  execute: async (_input, ctx: AgentToolContext) => {
    const selection = ctx.env.getSelection();
    if (!selection) {
      return toolNotAvailable("No text is currently selected.");
    }
    return toolOk(
      { text: snippet(selection.text), documentId: selection.documentId },
      `selection: ${selection.text.slice(0, 60)}${selection.text.length > 60 ? "…" : ""}`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_recent_reading_context
// ──────────────────────────────────────────────────────────────────────────

interface RecentContextInput {
  limit: number;
}

export const getRecentReadingContextTool: AgentToolDefinition<RecentContextInput> = {
  name: "get_recent_reading_context",
  description:
    "Get what the user read recently: the most recently touched extracts (saved passages), newest first. Use this before making cards 'from what I just read'.",
  category: "read",
  validate: (input): ValidationOutcome<RecentContextInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_recent_reading_context: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["limit"], "get_recent_reading_context"),
    ];
    const limit = optionalLimit(raw, "limit", errors, 5);
    if (errors.length > 0) return { ok: false, errors };
    return valid({ limit });
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const extracts = await ctx.env.getRecentExtracts(input.limit);
      const results = extracts.map((e) => ({
        extractId: e.id,
        documentId: e.documentId,
        documentTitle: e.documentTitle,
        text: snippet(e.content),
        dateModified: e.dateModified,
      }));
      return toolOk(
        { results },
        `recent context: ${results.length} passage(s)`,
        results.map((r) => ({
          refId: r.extractId,
          kind: "extract" as const,
          documentId: r.documentId,
          title: r.documentTitle,
        }))
      );
    } catch (error) {
      return toolError(`get_recent_reading_context failed: ${(error as Error).message}`);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_related_material
// ──────────────────────────────────────────────────────────────────────────

interface RelatedMaterialInput {
  topic: string;
}

export const getRelatedMaterialTool: AgentToolDefinition<RelatedMaterialInput> = {
  name: "get_related_material",
  description:
    "Find library material related to a topic (semantic neighbors across documents, extracts and cards). Returns snippets you can cite when answering 'where did the author discuss X'.",
  category: "retrieval",
  validate: (input): ValidationOutcome<RelatedMaterialInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_related_material: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["topic"], "get_related_material"),
    ];
    const topic = requireString(raw, "topic", errors, { maxLength: 400 });
    if (errors.length > 0) return { ok: false, errors };
    return valid({ topic: topic! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const retrieval = await ctx.env.retrieve(input.topic, { k: 5 });
      const results = retrieval.results.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        headingPath: r.headingPath,
        text: snippet(r.text),
      }));
      return toolOk(
        { results },
        `related material: ${results.length} passage(s)`,
        chunkSources(retrieval.results)
      );
    } catch (error) {
      return toolError(`get_related_material failed: ${(error as Error).message}`);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_existing_cards
// ──────────────────────────────────────────────────────────────────────────

interface ExistingCardsInput {
  query?: string;
  limit: number;
}

function matchesCard(
  card: { question: string; answer?: string; clozeText?: string; tags: string[] },
  needle: string
): boolean {
  const haystacks = [card.question, card.answer ?? "", card.clozeText ?? "", ...card.tags];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export const getExistingCardsTool: AgentToolDefinition<ExistingCardsInput> = {
  name: "get_existing_cards",
  description:
    "List the user's existing flashcards, optionally filtered by a search term over question/answer/cloze text and tags. Use it to check for existing cards about a concept before proposing new ones.",
  category: "read",
  validate: (input): ValidationOutcome<ExistingCardsInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_existing_cards: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["query", "limit"], "get_existing_cards"),
    ];
    let query: string | undefined;
    if (raw.query !== undefined && raw.query !== null && raw.query !== "") {
      query = requireString(raw, "query", errors, { maxLength: 400 });
    }
    const limit = optionalLimit(raw, "limit", errors, 10);
    if (errors.length > 0) return { ok: false, errors };
    const out: ExistingCardsInput = { limit };
    if (query) out.query = query;
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const all = await ctx.env.getCards();
      const needle = input.query?.toLowerCase();
      const matched = needle
        ? all.filter((c) => matchesCard(c, needle))
        : all;
      const cards = matched.slice(0, input.limit).map((c) => ({
        id: c.id,
        itemType: c.itemType,
        question: snippet(c.question),
        answer: c.answer ? snippet(c.answer) : undefined,
        state: c.state,
        dueDate: c.dueDate,
        reviewCount: c.reviewCount,
        lapses: c.lapses,
        tags: c.tags.slice(0, 5),
      }));
      return toolOk(
        { totalMatched: matched.length, cards },
        `existing cards: ${cards.length} of ${matched.length} match`,
        cards.map((c) => ({ refId: c.id, kind: "card" as const, title: c.question }))
      );
    } catch (error) {
      return toolError(`get_existing_cards failed: ${(error as Error).message}`);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_review_history
// ──────────────────────────────────────────────────────────────────────────

interface ReviewHistoryInput {
  query?: string;
  limit: number;
}

export const getReviewHistoryTool: AgentToolDefinition<ReviewHistoryInput> = {
  name: "get_review_history",
  description:
    "Get aggregate review statistics (total reviews, lapses, retention estimate, due counts) plus, optionally, per-card review summaries for cards matching a search term.",
  category: "read",
  validate: (input): ValidationOutcome<ReviewHistoryInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_review_history: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["query", "limit"], "get_review_history"),
    ];
    let query: string | undefined;
    if (raw.query !== undefined && raw.query !== null && raw.query !== "") {
      query = requireString(raw, "query", errors, { maxLength: 400 });
    }
    const limit = optionalLimit(raw, "limit", errors, 5);
    if (errors.length > 0) return { ok: false, errors };
    const out: ReviewHistoryInput = { limit };
    if (query) out.query = query;
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const stats = await ctx.env.getReviewStats();
      let cards: Array<Record<string, unknown>> = [];
      if (input.query) {
        const needle = input.query.toLowerCase();
        const all = await ctx.env.getCards();
        cards = all
          .filter((c) => matchesCard(c, needle))
          .slice(0, input.limit)
          .map((c) => ({
            id: c.id,
            question: snippet(c.question),
            reviewCount: c.reviewCount,
            lapses: c.lapses,
            state: c.state,
            lastReviewDate: c.lastReviewDate,
          }));
      }
      return toolOk(
        { stats, cards },
        input.query
          ? `review history for "${input.query}": ${cards.length} card(s)`
          : "review history: aggregate stats",
        cards.map((c) => ({
          refId: String(c.id),
          kind: "card" as const,
          title: String(c.question),
        }))
      );
    } catch (error) {
      return toolError(`get_review_history failed: ${(error as Error).message}`);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_due_cards
// ──────────────────────────────────────────────────────────────────────────

interface DueCardsInput {
  limit: number;
}

export const getDueCardsTool: AgentToolDefinition<DueCardsInput> = {
  name: "get_due_cards",
  description:
    "List learning items currently due for review (question side and due date), up to a limit. Use it for 'what should I review today' questions.",
  category: "read",
  validate: (input): ValidationOutcome<DueCardsInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_due_cards: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [...rejectUnknownParams(raw, ["limit"], "get_due_cards")];
    const limit = optionalLimit(raw, "limit", errors, 10);
    if (errors.length > 0) return { ok: false, errors };
    return valid({ limit });
  },
  execute: async (input, ctx: AgentToolContext) => {
    try {
      const due = await ctx.env.getDueCards();
      const cards = due.slice(0, input.limit).map((c) => ({
        id: c.id,
        itemType: c.itemType,
        question: snippet(c.question),
        dueDate: c.dueDate,
      }));
      return toolOk(
        { totalDue: due.length, cards },
        `due cards: ${cards.length} of ${due.length}`,
        cards.map((c) => ({ refId: c.id, kind: "card" as const, title: c.question }))
      );
    } catch (error) {
      return toolError(`get_due_cards failed: ${(error as Error).message}`);
    }
  },
};

export const READ_ONLY_TOOLS = [
  searchLibraryTool,
  getCurrentDocumentTool,
  getCurrentSelectionTool,
  getRecentReadingContextTool,
  getRelatedMaterialTool,
  getExistingCardsTool,
  getReviewHistoryTool,
  getDueCardsTool,
] as const;

export { MAX_TOOL_LIMIT };
