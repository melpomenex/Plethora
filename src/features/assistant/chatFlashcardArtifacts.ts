import type { SectionSourceReference } from "../../utils/sectionIndex";

export type ChatFlashcardStatus = "pending" | "saved" | "failed";

export interface ChatToolCall {
  name: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "success" | "error";
}

export interface ChatFlashcardArtifact {
  id: string;
  callIndex: number;
  type: "qa" | "cloze";
  front: string;
  back?: string;
  status: ChatFlashcardStatus;
  persistedCardId?: string;
  error?: string;
  source?: SectionSourceReference;
  createdAt: number;
}

export const FLASHCARD_TOOL_NAMES = new Set(["create_qa_card", "create_cloze_card"]);

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
    const isQa = call.name === "create_qa_card";
    const front = stringValue(isQa ? call.parameters.question : call.parameters.text);
    const back = isQa ? stringValue(call.parameters.answer) : undefined;
    if (!front || (isQa && !back)) return;
    artifacts.push({
      id: `${messageId}:card:${callIndex}`,
      callIndex,
      type: isQa ? "qa" : "cloze",
      front,
      back,
      status: call.status === "success" ? "saved" : call.status === "error" ? "failed" : "pending",
      persistedCardId: extractPersistedCardId(call.result),
      error: call.status === "error" ? resultText(call.result) || "Card could not be saved." : undefined,
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

