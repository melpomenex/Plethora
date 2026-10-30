/**
 * Read-only agent tools (design D25, task 8.1; source grounding 3.1).
 *
 * Nine tools over existing APIs — no writes anywhere:
 *   search_library, list_attached_sources, get_current_document,
 *   get_current_selection, get_section_context, get_recent_reading_context,
 *   get_related_material, get_existing_cards, get_review_history,
 *   get_due_cards.
 *
 * Contract notes:
 *  - ids the tools RETURN are real ids from real records; ids the model
 *    SENDS are never trusted (the only id-taking inputs resolve through a
 *    query first and verify existence via the API — see proposals.ts);
 *  - every record a tool returns is registered in the run's evidence map and
 *    handed back as an opaque `sourceHandle` the model may cite later;
 *  - every result is a structured JSON payload + `displayDigest` + optional
 *    navigable `sources` — the loop wraps `result` in an untrusted block
 *    before it re-enters a prompt;
 *  - list parameters are clamped ≤ 20 (`MAX_TOOL_LIMIT`), and card/extract
 *    reads are bounded server-side (task 1.3: never `getAllLearningItems`).
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
  type AgentSectionContext,
  type AgentSourceRef,
  type AgentToolContext,
  type AgentToolDefinition,
} from "./types";
import type { AgentEvidenceEntry, AgentEvidenceKind } from "../evidence";

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

/**
 * Register one evidence record and return the fields the model may cite.
 * Tools call this for every record they actually returned.
 */
function registerEvidence(
  ctx: AgentToolContext,
  entry: {
    kind: AgentEvidenceKind;
    recordId: string;
    text: string;
    documentId?: string;
    title?: string;
    locator?: string;
    sourceRevision?: string;
  }
): AgentEvidenceEntry {
  return ctx.session.evidence.register(entry);
}

function handleOf(entry: AgentEvidenceEntry): string {
  return entry.handle;
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
    "Search the run's authorized sources (documents, extracts, cards) semantically with a lexical fallback. Returns snippets with chunk ids, document titles, heading paths and a sourceHandle you MUST cite when proposing an item from them. Use focused keyword queries.",
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
      const results = retrieval.results.map((r) => {
        const isExtract = r.sourceType === "extract" && Boolean(r.sourceId);
        const entry = registerEvidence(ctx, {
          kind: isExtract ? "extract" : "chunk",
          recordId: isExtract ? r.sourceId! : r.chunkId,
          documentId: r.documentId,
          title: r.documentTitle,
          locator: r.headingPath.join(" › "),
          sourceRevision: ctx.session.sourceRevision,
          text: r.text,
        });
        return {
          chunkId: r.chunkId,
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          headingPath: r.headingPath,
          text: snippet(r.text),
          score: Math.round(r.score * 1000) / 1000,
          sourceHandle: handleOf(entry),
        };
      });
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
// list_attached_sources
// ──────────────────────────────────────────────────────────────────────────

export const listAttachedSourcesTool: AgentToolDefinition<Record<string, never>> = {
  name: "list_attached_sources",
  description:
    "List the documents explicitly attached to this run, with sourceHandles. Use it to plan a multi-paper request and to name the actual paper behind each proposal. Never assume a document outside this list.",
  category: "read",
  validate: (input): ValidationOutcome<Record<string, never>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["list_attached_sources: expected object"] };
    }
    const errors = rejectUnknownParams(input as Record<string, unknown>, [], "list_attached_sources");
    if (errors.length > 0) return { ok: false, errors };
    return valid({});
  },
  execute: async (_input, ctx: AgentToolContext) => {
    const sources = ctx.env.listSources?.() ?? [];
    const registered = sources.map((source) => {
      const entry = registerEvidence(ctx, {
        kind: "document",
        recordId: source.documentId ?? source.attachmentId,
        documentId: source.documentId,
        title: source.title,
        sourceRevision: source.contentVersion ?? ctx.session.sourceRevision,
        text: "",
      });
      return {
        attachmentId: source.attachmentId,
        documentId: source.documentId,
        title: source.title,
        role: source.role ?? "optional",
        sourceHandle: entry.handle,
      };
    });
    return toolOk(
      { sources: registered },
      `attached sources: ${registered.length}`,
      registered.map((source) => ({
        refId: source.documentId ?? source.attachmentId,
        kind: "document" as const,
        documentId: source.documentId,
        title: source.title,
      }))
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_current_document
// ──────────────────────────────────────────────────────────────────────────

export const getCurrentDocumentTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_current_document",
  description:
    "Get the primary document frozen for this run (id, title, file type, reading position), plus a sourceHandle. Returns not-available when the run has no document source.",
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
      return toolNotAvailable("No document is attached to this run.");
    }
    const entry = registerEvidence(ctx, {
      kind: "document",
      recordId: doc.id,
      documentId: doc.id,
      title: doc.title,
      text: "",
      sourceRevision: ctx.session.sourceRevision,
    });
    return toolOk(
      {
        id: doc.id,
        title: doc.title,
        fileType: doc.fileType,
        currentPage: doc.currentPage,
        totalPages: doc.totalPages,
        progressPercent: doc.progressPercent,
        sourceHandle: entry.handle,
      },
      `primary document: ${doc.title}`,
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
    "Get the text frozen as the selection for this run (plus a sourceHandle). Returns not-available when the run has no selection.",
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
      return toolNotAvailable("No text was selected for this run.");
    }
    const entry = registerEvidence(ctx, {
      kind: "selection",
      recordId: `selection:${selection.documentId ?? "unknown"}`,
      documentId: selection.documentId,
      text: selection.text,
      sourceRevision: ctx.session.sourceRevision,
    });
    return toolOk(
      {
        text: snippet(selection.text),
        documentId: selection.documentId,
        sourceHandle: entry.handle,
      },
      `selection: ${selection.text.slice(0, 60)}${selection.text.length > 60 ? "…" : ""}`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// get_section_context
// ──────────────────────────────────────────────────────────────────────────

export const getSectionContextTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_section_context",
  description:
    "Get the bounded section/chapter text frozen for this run, with its document id, locator and sourceHandle. Returns not-available when the run did not resolve a section (ask the user to select one instead of guessing).",
  category: "read",
  validate: (input): ValidationOutcome<Record<string, never>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["get_section_context: expected object"] };
    }
    const errors = rejectUnknownParams(input as Record<string, unknown>, [], "get_section_context");
    if (errors.length > 0) return { ok: false, errors };
    return valid({});
  },
  execute: async (_input, ctx: AgentToolContext) => {
    const section: AgentSectionContext | null = (await ctx.env.getSectionContext?.()) ?? null;
    if (!section) {
      return toolNotAvailable(
        "No section was resolved for this run. Ask the user to select a section or passage before generating chapter cards."
      );
    }
    const entry = registerEvidence(ctx, {
      kind: "selection",
      recordId: `section:${section.locator ?? section.documentId}`,
      documentId: section.documentId,
      title: section.title,
      locator: section.locator,
      text: section.text,
      sourceRevision: section.sourceRevision ?? ctx.session.sourceRevision,
    });
    return toolOk(
      {
        documentId: section.documentId,
        title: section.title,
        locator: section.locator,
        text: section.text,
        truncated: section.text.includes("[Selected body truncated"),
        sourceHandle: entry.handle,
      },
      `section context: ${section.title ?? section.documentId} (${section.text.length} chars)`,
      section.documentId
        ? [{ refId: section.documentId, kind: "document", documentId: section.documentId, title: section.title, locator: section.locator }]
        : undefined
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
    "Get what the user read recently: the most recently touched extracts (saved passages), newest first. Use this before making cards 'from what I just read'. Every entry has a sourceHandle.",
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
      const results = extracts.map((e) => {
        const entry = registerEvidence(ctx, {
          kind: "extract",
          recordId: e.id,
          documentId: e.documentId,
          title: e.documentTitle,
          text: e.content,
          sourceRevision: ctx.session.sourceRevision,
        });
        return {
          extractId: e.id,
          documentId: e.documentId,
          documentTitle: e.documentTitle,
          text: snippet(e.content),
          dateModified: e.dateModified,
          sourceHandle: entry.handle,
        };
      });
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
    "Find authorized library material related to a topic (semantic neighbors across documents, extracts and cards). Returns snippets with sourceHandles you can cite when answering 'where did the author discuss X'.",
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
      const results = retrieval.results.map((r) => {
        const isExtract = r.sourceType === "extract" && Boolean(r.sourceId);
        const entry = registerEvidence(ctx, {
          kind: isExtract ? "extract" : "chunk",
          recordId: isExtract ? r.sourceId! : r.chunkId,
          documentId: r.documentId,
          title: r.documentTitle,
          locator: r.headingPath.join(" › "),
          text: r.text,
          sourceRevision: ctx.session.sourceRevision,
        });
        return {
          chunkId: r.chunkId,
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          headingPath: r.headingPath,
          text: snippet(r.text),
          sourceHandle: entry.handle,
        };
      });
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
    "List the user's existing flashcards, optionally filtered by a search term over question/answer/cloze text and tags. Reads are bounded and restricted to this run's authorized sources. Use it to check for existing cards before proposing new ones.",
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
      const bounded = await ctx.env.getCards({
        text: input.query,
        limit: input.limit,
      });
      const needle = input.query?.toLowerCase();
      const matched = needle
        ? bounded.filter((c) => matchesCard(c, needle))
        : bounded;
      const cards = matched.slice(0, input.limit).map((c) => {
        const entry = registerEvidence(ctx, {
          kind: "card",
          recordId: c.id,
          documentId: c.documentId,
          title: c.question,
          text: c.answer ?? c.clozeText ?? c.question,
          sourceRevision: ctx.session.sourceRevision,
        });
        return {
          id: c.id,
          itemType: c.itemType,
          question: snippet(c.question),
          answer: c.answer ? snippet(c.answer) : undefined,
          state: c.state,
          dueDate: c.dueDate,
          reviewCount: c.reviewCount,
          lapses: c.lapses,
          tags: c.tags.slice(0, 5),
          sourceHandle: entry.handle,
        };
      });
      return toolOk(
        { totalReturned: bounded.length, cards },
        `existing cards: ${cards.length} of ${bounded.length} returned`,
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
    "Get aggregate review statistics (total reviews, lapses, retention estimate, due counts) plus, optionally, per-card review summaries for authorized cards matching a search term.",
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
        const all = await ctx.env.getCards({ text: input.query, limit: input.limit });
        cards = all
          .filter((c) => matchesCard(c, needle))
          .slice(0, input.limit)
          .map((c) => {
            const entry = registerEvidence(ctx, {
              kind: "card",
              recordId: c.id,
              documentId: c.documentId,
              title: c.question,
              text: c.answer ?? c.clozeText ?? c.question,
              sourceRevision: ctx.session.sourceRevision,
            });
            return {
              id: c.id,
              question: snippet(c.question),
              reviewCount: c.reviewCount,
              lapses: c.lapses,
              state: c.state,
              lastReviewDate: c.lastReviewDate,
              sourceHandle: entry.handle,
            };
          });
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
    "List authorized learning items currently due for review (question side and due date), up to a limit. Use it for 'what should I review today' questions.",
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
      const due = await ctx.env.getDueCards(input.limit);
      const cards = due.slice(0, input.limit).map((c) => {
        const entry = registerEvidence(ctx, {
          kind: "card",
          recordId: c.id,
          documentId: c.documentId,
          title: c.question,
          text: c.question,
          sourceRevision: ctx.session.sourceRevision,
        });
        return {
          id: c.id,
          itemType: c.itemType,
          question: snippet(c.question),
          dueDate: c.dueDate,
          sourceHandle: entry.handle,
        };
      });
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
  listAttachedSourcesTool,
  getCurrentDocumentTool,
  getCurrentSelectionTool,
  getSectionContextTool,
  getRecentReadingContextTool,
  getRelatedMaterialTool,
  getExistingCardsTool,
  getReviewHistoryTool,
  getDueCardsTool,
] as const;

export { MAX_TOOL_LIMIT };
