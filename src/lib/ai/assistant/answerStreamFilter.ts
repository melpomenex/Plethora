import { parseAssistantToolCalls, type ToolDefinitionLike } from "./toolCallParser";
import { parseAssistantThinking } from "../../../utils/assistantThinking";

/** Incremental visibility filter for raw assistant transport text. */
export class AssistantAnswerStreamFilter {
  private raw = "";

  constructor(private readonly tools: ReadonlyArray<ToolDefinitionLike | string> = []) {}

  push(chunk: string): string {
    this.raw += chunk;
    return this.visible(false);
  }

  /** Structured task previews arrive as an answer-only cumulative snapshot. */
  setSnapshot(snapshot: string): string {
    this.raw = snapshot;
    return this.visible(false);
  }

  finish(finalText = this.raw): string {
    this.raw = finalText;
    return this.visible(true);
  }

  private visible(final: boolean): string {
    const answer = parseAssistantThinking(this.raw).answer;
    const removedRanges: Array<[number, number]> = [];
    const fencePattern = /```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)(```|$)/g;
    for (const match of answer.matchAll(fencePattern)) {
      const start = match.index ?? 0;
      const label = match[1].toLowerCase();
      const body = match[2];
      const closed = match[3] === "```";
      if (label === "tool_calls") {
        removedRanges.push([start, start + match[0].length]);
        continue;
      }
      if (label === "json") {
        const parsed = parseAssistantToolCalls(body, this.tools);
        if (parsed.toolCalls.length > 0 || (!closed && isSuspiciousToolPayload(body, this.tools))) {
          removedRanges.push([start, start + match[0].length]);
        } else if (!closed && !final) {
          // Hold an unfinished JSON code block until it is either classified
          // as a control payload or completed as an ordinary code example.
          removedRanges.push([start, answer.length]);
        } else if (!closed && final && isSuspiciousToolPayload(body, this.tools)) {
          removedRanges.push([start, answer.length]);
        }
      }
    }

    // A split opening fence must not flash as literal protocol text.
    const fenceTail = answer.lastIndexOf("```");
    if (!final && fenceTail >= 0 && !answer.slice(fenceTail + 3).includes("```")) {
      const opening = answer.slice(fenceTail);
      if (/^```(?:tool_calls|json)?(?:\s|$|[{])/i.test(opening)) removedRanges.push([fenceTail, answer.length]);
    }

    let filtered = removeRanges(answer, removedRanges);
    const suspiciousJson = findBalancedJsonRanges(filtered)
      .filter(([start, end]) => isSuspiciousToolPayload(filtered.slice(start, end), this.tools));
    filtered = removeRanges(filtered, suspiciousJson);
    const partialJsonStart = findUnclosedJsonStart(filtered);
    if (partialJsonStart >= 0 && !final) filtered = filtered.slice(0, partialJsonStart);
    else if (partialJsonStart >= 0 && final && isSuspiciousToolPayload(filtered.slice(partialJsonStart), this.tools)) {
      filtered = filtered.slice(0, partialJsonStart);
    }

    // Parse only text outside fences so recognized bare tool payloads are
    // hidden while intentional code examples remain readable.
    const pieces = filtered.split(/(```[\s\S]*?(?:```|$))/g);
    filtered = pieces.map((piece, index) => {
      if (index % 2 === 1) return piece;
      return parseAssistantToolCalls(piece, this.tools).cleanedContent;
    }).join("");
    return filtered;
  }
}

function removeRanges(value: string, ranges: Array<[number, number]>): string {
  if (!ranges.length) return value;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let result = "";
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) continue;
    result += value.slice(cursor, start);
    cursor = end;
  }
  return result + value.slice(cursor);
}

function findUnclosedJsonStart(value: string): number {
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(index);
    else if (char === "}" || char === "]") stack.pop();
  }
  return stack[0] ?? -1;
}

function findBalancedJsonRanges(value: string): Array<[number, number]> {
  let start = -1;
  let depth = 0;
  const ranges: Array<[number, number]> = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push([start, index + 1]);
        start = -1;
      }
    }
  }
  return ranges;
}

function isSuspiciousToolPayload(value: string, tools: ReadonlyArray<ToolDefinitionLike | string>): boolean {
  const names = tools.map((tool) => typeof tool === "string" ? tool : tool.name).filter(Boolean);
  if (!names.length) return false;
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?:"name"\\s*:\\s*"(?:${escaped})"|"tool_calls"\\s*:)`, "i").test(value);
}
