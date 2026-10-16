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
      return extractCalls(parsed).flatMap((call) => {
        if (!call || typeof call !== "object") return [];
        if (call.name && known.has(call.name)) {
          const args = call.arguments ?? call.parameters;
          return [{ name: call.name, parameters: args && typeof args === "object" && !Array.isArray(args) ? args : {}, status: "pending" as const }];
        }
        const record = call as Record<string, unknown>;
        const question = record.question ?? record.Q ?? record.q;
        const answer = record.answer ?? record.A ?? record.a;
        return known.has("create_qa_card") && typeof question === "string" && typeof answer === "string"
          ? [{ name: "create_qa_card", parameters: { question, answer }, status: "pending" as const }] : [];
      });
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
  },
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...parameters };
  const documentId = options?.documentId;
  const deckName = getDocumentDeckName(options?.documentTitle);

  if (documentId && ATTACHABLE_TOOL_NAMES.has(toolName)) {
    normalized.document_id = documentId;
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
