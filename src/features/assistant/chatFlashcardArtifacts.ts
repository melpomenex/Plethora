import type { FrozenAssistantSource } from "../../lib/ai/assistant/sourceEnvelope";
import type { SectionSourceReference } from "../../utils/sectionIndex";

export type ChatFlashcardStatus = "pending" | "saved" | "failed" | "preview";

export interface ChatToolCall {
  name: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "success" | "error";
}

export interface ChatFlashcardArtifact {
  id: string;
  callIndex: number;
  candidateIndex?: number;
  acceptanceId?: string;
  proposalId?: string;
  sourceEnvelope?: FrozenAssistantSource;
  type: "qa" | "cloze";
  front: string;
  back?: string;
  status: ChatFlashcardStatus;
  persistedCardId?: string;
  /** Normalized tool-call tags, used to connect the artifact to its smart deck. */
  tags: string[];
  /** False when retrying this row would duplicate successful siblings in a batch call. */
  retryable?: boolean;
  error?: string;
  source?: SectionSourceReference;
  createdAt: number;
}

export const FLASHCARD_TOOL_NAMES = new Set(["create_qa_card", "create_cloze_card", "batch_create_cards"]);

export function isFlashcardToolCall(call: Pick<ChatToolCall, "name">): boolean {
  return FLASHCARD_TOOL_NAMES.has(call.name);
}

export function normalizeParsedToolCall(value: unknown): ChatToolCall | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string") return null;
  const args = raw.arguments ?? raw.parameters;
  return {
    name: raw.name,
    parameters: args && typeof args === "object" && !Array.isArray(args)
      ? args as Record<string, unknown>
      : {},
    status: raw.status === "success" || raw.status === "error" ? raw.status : "pending",
    result: raw.result,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item))
    .filter((item, index, values) => Boolean(item) && values.indexOf(item) === index);
}

function mergeStringLists(...values: unknown[]): string[] {
  return values
    .flatMap((value) => stringList(value))
    .filter((item, index, items) => items.indexOf(item) === index);
}

export function getFlashcardArtifactDeckName(artifacts: ChatFlashcardArtifact[]): string | undefined {
  for (const artifact of artifacts) {
    const deckTag = artifact.tags.find((tag) => tag.toLowerCase().startsWith("deck:"));
    const name = deckTag?.slice(5).trim();
    if (name) return name;
  }
  return undefined;
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  const content = record.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item === "object" ? stringValue((item as Record<string, unknown>).text) : "")
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

export function extractPersistedCardId(result: unknown): string | undefined {
  const candidates: unknown[] = [result];
  const text = resultText(result);
  if (text) {
    try { candidates.push(JSON.parse(text)); } catch { /* non-JSON MCP result */ }
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    for (const key of ["id", "card_id", "cardId", "flashcard_id", "flashcardId"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return undefined;
}

function structuredResult(result: unknown): Record<string, unknown> | undefined {
  const candidates: unknown[] = [result];
  const text = resultText(result);
  if (text) {
    try { candidates.push(JSON.parse(text)); } catch { /* non-JSON MCP result */ }
  }
  const records = candidates.filter((candidate): candidate is Record<string, unknown> =>
    Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)),
  );
  return records.find((candidate) => Array.isArray(candidate.results)) ?? records[0];
}

function batchResults(result: unknown): Record<string, unknown>[] {
  const structured = structuredResult(result);
  if (!structured || !Array.isArray(structured.results)) return [];
  return structured.results.map((item) =>
    item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {},
  );
}

/** Count durable receipts, including missing results as failed candidates. */
export function summarizeBatchCardResults(result: unknown, attempted: number): { saved: number; failed: number } {
  const results = batchResults(result);
  const saved = results.slice(0, attempted).filter((entry) =>
    entry.success === true && Boolean(extractPersistedCardId(entry)),
  ).length;
  return { saved, failed: Math.max(0, attempted - saved) };
}

export function persistedCardDocumentId(result: unknown): string | undefined {
  const candidates: unknown[] = [result];
  const text = resultText(result);
  if (text) {
    try { candidates.push(JSON.parse(text)); } catch { /* Not a JSON receipt. */ }
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = (candidate as Record<string, unknown>).document_id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

export function safeCardCreationError(result: unknown): string {
  const structured = structuredResult(result);
  const nested = structured?.error;
  const message = typeof nested === "string" ? nested : nested && typeof nested === "object"
    ? stringValue((nested as Record<string, unknown>).message) : result instanceof Error ? result.message : resultText(result);
  if (!message || /^\s*[{[]/.test(message) || /SQLITE|FOREIGN KEY|constraint failed|database error|\bat \S+\(/i.test(message)) {
    return "The card was not saved. Reselect its source or retry.";
  }
  return message.slice(0, 300);
}

function resultError(result: unknown): string { return safeCardCreationError(result); }

/** App-assigned identities override model parameters and survive message reloads. */
export function withCardCandidateIdentities(namespace: string, callIndex: number, call: ChatToolCall): Record<string, unknown> {
  if (!isFlashcardToolCall(call)) return call.parameters;
  const acceptanceId = `chat:${namespace}:${callIndex}`;
  const parameters: Record<string, unknown> = { ...call.parameters, acceptance_id: acceptanceId, proposal_id: `${acceptanceId}:0` };
  if (call.name === "batch_create_cards" && Array.isArray(parameters.cards)) {
    parameters.cards = parameters.cards.map((candidate, index) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? { ...candidate as Record<string, unknown>, proposal_id: `${acceptanceId}:${index}` } : candidate);
  }
  return parameters;
}

/** Merge a retry of one candidate without resubmitting or clearing its siblings. */
export function mergeBatchCandidateResult(previous: unknown, count: number, index: number, retried: unknown, proposalId?: string): unknown {
  const prior = batchResults(previous);
  const receipt = batchResults(retried)[0] ?? { success: false, error: safeCardCreationError(retried) };
  const results = Array.from({ length: count }, (_, candidate) => candidate === index
    ? { ...receipt, proposal_id: proposalId } : prior[candidate] ?? {});
  const created = results.filter((row) => row.success === true && Boolean(extractPersistedCardId(row))).length;
  return { attempted: count, created, failed: count - created, results };
}

export function toolCallsToFlashcardArtifacts(
  messageId: string,
  toolCalls: unknown,
  options: { source?: SectionSourceReference; timestamp?: number } = {},
): ChatFlashcardArtifact[] {
  if (!Array.isArray(toolCalls)) return [];
  const createdAt = options.timestamp ?? Date.now();
  const artifacts: ChatFlashcardArtifact[] = [];
  toolCalls.forEach((raw, callIndex) => {
    const call = normalizeParsedToolCall(raw);
    if (!call || !isFlashcardToolCall(call)) return;
    if (call.name === "batch_create_cards") {
      const cards = Array.isArray(call.parameters.cards) ? call.parameters.cards : [];
      const persistedResults = batchResults(call.result);
      cards.forEach((rawCard, cardIndex) => {
        if (!rawCard || typeof rawCard !== "object" || Array.isArray(rawCard)) return;
        const card = rawCard as Record<string, unknown>;
        const cardType = stringValue(card.type).toLowerCase();
        const front = stringValue(card.question ?? card.text);
        const back = stringValue(card.answer);
        const isCloze = cardType === "cloze";
        const invalid = !front || (!isCloze && !back) || !["", "qa", "cloze", "basic", "flashcard"].includes(cardType);

        const proposalId = stringValue(card.proposal_id);
        const persistedResult = (proposalId ? persistedResults.find((row) => row.proposal_id === proposalId) : undefined) ?? persistedResults[cardIndex];
        const itemFailed = persistedResult?.success === false;
        const persistedCardId = extractPersistedCardId(persistedResult);
        const missingReceipt = call.status === "success" && (persistedResult?.success !== true || !persistedCardId);
        const committed = persistedResult?.success === true && Boolean(persistedCardId);
        const status: ChatFlashcardStatus = invalid ? "failed" : call.parameters.preview_only === true ? "preview" : call.parameters.retrying_candidate === cardIndex ? "pending" : committed ? "saved" : call.status === "pending" && !itemFailed ? "pending" : "failed";
        artifacts.push({
          id: `${messageId}:card:${callIndex}:${cardIndex}`,
          callIndex, candidateIndex: cardIndex,
          acceptanceId: stringValue(call.parameters.acceptance_id) || undefined,
          proposalId: proposalId || undefined,
          sourceEnvelope: call.parameters.source_envelope as FrozenAssistantSource | undefined,
          type: isCloze ? "cloze" : "qa",
          front: front || "Invalid card candidate",
          back: isCloze ? undefined : back,
          status,
          persistedCardId,
          tags: mergeStringLists(call.parameters.tags, card.tags),
          retryable: !invalid && !committed && (Boolean(call.parameters.acceptance_id) || itemFailed),
          error: invalid ? "The candidate is missing required content or has an unsupported card type." : status === "failed"
            ? (missingReceipt && !itemFailed
              ? "The card could not be confirmed as saved."
              : resultError(persistedResult ?? call.result) || "Card could not be saved.")
            : undefined,
          source: options.source,
          createdAt,
        });
      });
      return;
    }
    const isQa = call.name === "create_qa_card";
    const front = stringValue(isQa ? call.parameters.question : call.parameters.text);
    const back = isQa ? stringValue(call.parameters.answer) : undefined;
    const invalid = !front || (isQa && !back);
    const persistedCardId = extractPersistedCardId(call.result);
    const missingReceipt = call.status === "success" && !persistedCardId;
    artifacts.push({
      id: `${messageId}:card:${callIndex}`,
      callIndex,
      acceptanceId: stringValue(call.parameters.acceptance_id) || undefined,
      proposalId: stringValue(call.parameters.proposal_id) || undefined,
      sourceEnvelope: call.parameters.source_envelope as FrozenAssistantSource | undefined,
      retryable: !invalid && (Boolean(call.parameters.acceptance_id) || structuredResult(call.result)?.success === false),
      type: isQa ? "qa" : "cloze",
      front: front || "Invalid card candidate",
      back,
      status: invalid ? "failed" : call.parameters.preview_only === true ? "preview" : call.parameters.retrying_candidate === 0 ? "pending" : call.status === "success" && !missingReceipt ? "saved" : call.status === "error" || missingReceipt ? "failed" : "pending",
      persistedCardId,
      tags: stringList(call.parameters.tags),
      error: invalid ? "The candidate is missing required content." : missingReceipt ? "The card could not be confirmed as saved."
        : call.status === "error" ? resultError(call.result) || "Card could not be saved." : undefined,
      source: options.source,
      createdAt,
    });
  });
  return artifacts;
}

export function nonFlashcardToolCalls(toolCalls: unknown): ChatToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map(normalizeParsedToolCall)
    .filter((call): call is ChatToolCall => Boolean(call && !isFlashcardToolCall(call)));
}

export function buildFlashcardToolInstruction(toolNames: string[]): string {
  const cardTools = toolNames.filter((name) => FLASHCARD_TOOL_NAMES.has(name));
  if (cardTools.length === 0) return "";
  return `When the user explicitly asks to create, save, add, or make flashcards, use ${cardTools.join(" or ")} in one tool_calls block. When they ask only to preview, brainstorm, or discuss card ideas, do not save cards. Never duplicate created cards as raw JSON, a markdown table, or a prose card list.`;
}
