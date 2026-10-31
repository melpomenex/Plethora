import type { FrozenAssistantSource } from "./sourceEnvelope";
import { isTwentyRulesCommand } from "../knowledgeFormulation";
import {
  isUsableCardCandidate,
  normalizeCardCandidate,
  normalizeCardToolParameters,
} from "./cardToolParameters";

/** Writes require the user's create intent; a model tool call is not consent. */
export function allowsChatCardCreation(prompt: string): boolean {
  if (/\b(preview|draft|suggest|show examples?)\b|\b(?:do not|don't|without|never)\s+(?:save|create|add|persist)\b/i.test(prompt)) return false;
  return isTwentyRulesCommand(prompt) || /\b(create|make|generate|save|add|turn)\b[\s\S]*\b(cards?|flashcards?|clozes?|deck)\b/i.test(prompt);
}
/**
 * Unified 4-stage resilient MCP tool-call parser and parameter normalizer
 * shared across AssistantPanel, DocumentQATab, and AssistantOrchestrator.
 */

export interface ParsedToolCall {
  name: string;
  parameters: Record<string, unknown>;
  status: "pending" | "success" | "error";
  result?: unknown;
}

export interface ToolDefinitionLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export const CARD_CREATION_TOOL_NAMES = new Set([
  "create_qa_card",
  "create_cloze_card",
  "batch_create_cards",
]);

export const ATTACHABLE_TOOL_NAMES = new Set([
  "create_qa_card",
  "create_cloze_card",
  "batch_create_cards",
  "create_extract",
]);

export function getDocumentDeckName(title?: string | null): string | undefined {
  if (!title) return undefined;
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  const stripped = trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped || trimmed;
}

function extractCalls(
  parsed: unknown,
): Array<{ name?: string; arguments?: Record<string, unknown>; parameters?: Record<string, unknown> }> {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.tool_calls === "string") {
      try {
        const toolCalls: unknown = JSON.parse(record.tool_calls);
        if (Array.isArray(toolCalls)) {
          return toolCalls as Array<{
            name?: string;
            arguments?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
          }>;
        }
        if (toolCalls && typeof toolCalls === "object" && Array.isArray((toolCalls as Record<string, unknown>).tool_calls)) {
          return (toolCalls as Record<string, unknown>).tool_calls as Array<{
            name?: string;
            arguments?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
          }>;
        }
      } catch {
        return [];
      }
    }
    if (Array.isArray(record.tool_calls)) {
      return record.tool_calls as Array<{
        name?: string;
        arguments?: Record<string, unknown>;
        parameters?: Record<string, unknown>;
      }>;
    }
    if (typeof record.name === "string") {
      return [
        record as {
          name?: string;
          arguments?: Record<string, unknown>;
          parameters?: Record<string, unknown>;
        },
      ];
    }
  }
  return [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function withUsableBatchCards(call: ParsedToolCall): ParsedToolCall {
  if (call.name !== "batch_create_cards" || !Array.isArray(call.parameters.cards)) return call;
  return {
    ...call,
    parameters: {
      ...call.parameters,
      cards: call.parameters.cards.filter((card) => isUsableCardCandidate(card)),
    },
  };
}

function bareCardCall(record: Record<string, unknown>): ParsedToolCall | undefined {
  const card = normalizeCardCandidate(record);
  if (!isUsableCardCandidate(card)) return undefined;
  const tags = Array.isArray(record.tags) ? record.tags : undefined;
  if (card.type === "cloze") {
    const text = typeof card.text === "string" ? card.text : card.question;
    return typeof text === "string"
      ? { name: "create_cloze_card", parameters: { text, tags }, status: "pending" }
      : undefined;
  }
  const question = typeof card.question === "string" ? card.question : undefined;
  const answer = typeof card.answer === "string" ? card.answer : undefined;
  return question && answer
    ? { name: "create_qa_card", parameters: { question, answer, tags }, status: "pending" }
    : undefined;
}

function balancedJsonFragments(text: string): string[] {
  const fragments: string[] = [];
  let start = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) { if (char !== "{" && char !== "[") continue; start = index; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (!depth) { fragments.push(text.slice(start, index + 1)); start = -1; }
    }
  }
  return fragments;
}

/** Fenced tool calls, fenced JSON, bare arrays, then bare objects. */
export function parseAssistantToolCalls(content: string, availableTools: ReadonlyArray<ToolDefinitionLike | string>): { cleanedContent: string; toolCalls: ParsedToolCall[] } {
  const known = new Set(availableTools.map((tool) => typeof tool === "string" ? tool : tool.name));
  let cleanedContent = content;
  const toolCalls: ParsedToolCall[] = [];
  const decode = (raw: string): ParsedToolCall[] => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
      const bareBatch = record && typeof record.name !== "string" && known.has("batch_create_cards")
        && (Array.isArray(record.cards) || Array.isArray(record.items) || Array.isArray(record.flashcards))
        ? [withUsableBatchCards({ name: "batch_create_cards", parameters: normalizeCardToolParameters("batch_create_cards", record), status: "pending" as const })]
        : [];
      return [...bareBatch, ...extractCalls(parsed).flatMap((call) => {
        if (!call || typeof call !== "object") return [];
        if (call.name && known.has(call.name)) {
          const args = objectValue(call.arguments ?? call.parameters) ?? {};
          return [withUsableBatchCards({ name: call.name, parameters: normalizeCardToolParameters(call.name, args), status: "pending" as const })];
        }
        const bare = bareCardCall(call as Record<string, unknown>);
        return bare && known.has(bare.name) ? [bare] : [];
      })];
    } catch { return []; }
  };
  for (const pattern of [/```tool_calls\s*([\s\S]*?)```/g, /```(?:json)?\s*([\s\S]*?)```/g]) {
    for (const match of cleanedContent.matchAll(pattern)) {
      const calls = decode(match[1]);
      if (calls.length) { toolCalls.push(...calls); cleanedContent = cleanedContent.replace(match[0], "").trim(); }
    }
    if (toolCalls.length) return { cleanedContent, toolCalls };
  }
  for (const fragment of balancedJsonFragments(cleanedContent)) {
    const calls = decode(fragment);
    if (calls.length) { toolCalls.push(...calls); cleanedContent = cleanedContent.replace(fragment, "").trim(); }
  }
  return { cleanedContent, toolCalls };
}

export function normalizeAssistantToolParameters(
  toolName: string,
  parameters: Record<string, unknown>,
  options?: {
    documentId?: string;
    documentTitle?: string;
    sourceArg?: unknown;
    sourceEnvelope?: FrozenAssistantSource;
  },
): Record<string, unknown> {
  const normalized: Record<string, unknown> = normalizeCardToolParameters(toolName, parameters);
  const documentId = options?.sourceEnvelope?.documentId ?? options?.documentId;
  const deckName = getDocumentDeckName(options?.documentTitle);

  if (documentId && ATTACHABLE_TOOL_NAMES.has(toolName)) {
    normalized.document_id = documentId;
  }

  if (ATTACHABLE_TOOL_NAMES.has(toolName)) {
    if (documentId?.startsWith("extract:")) throw new Error("Resolve the extract source before creating cards.");
    if (options?.sourceEnvelope) {
      if (options.sourceEnvelope.extractId) normalized.extract_id = options.sourceEnvelope.extractId;
      else delete normalized.extract_id;
      normalized.source_revision = options.sourceEnvelope.contentRevision;
      normalized.extract_revision = options.sourceEnvelope.extractRevision;
      if (toolName === "batch_create_cards" && Array.isArray(normalized.cards)) {
        normalized.cards = normalized.cards.map((candidate: unknown) => {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
          const card: Record<string, unknown> = { ...candidate as Record<string, unknown>, document_id: documentId };
          if (options.sourceEnvelope.extractId) card.extract_id = options.sourceEnvelope.extractId;
          else delete card.extract_id;
          return card;
        });
      }
    }
  }

  if (deckName && ATTACHABLE_TOOL_NAMES.has(toolName)) {
    const deckTag = `deck:${deckName}`;
    const existingTags: string[] = Array.isArray(normalized.tags)
      ? normalized.tags
          .map((t: unknown) => String(t))
          .filter((tag) => !tag.toLowerCase().startsWith("deck:"))
      : [];
    normalized.tags = [...existingTags, deckTag];
  }

  if (
    options?.sourceArg &&
    CARD_CREATION_TOOL_NAMES.has(toolName) &&
    !normalized.source
  ) {
    normalized.source = options.sourceArg;
  }

  return normalized;
}
