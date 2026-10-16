import type { AssistantScope } from "../lib/ai/assistant/scopes";

export interface BraveSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const EXPANSION_PATTERNS: RegExp[] = [
  /what\s+else/i,
  /tell\s+me\s+more/i,
  /look\s*(it|this|that)?\s*up/i,
  /beyond\s+(this|the)\s+document/i,
  /find\s+more\s+about/i,
  /search\s+(the\s+)?web/i,
  /more\s+(context|background|about\s+this)/i,
  /explain\s+.*\s+in\s+more\s+depth/i,
];

const WEB_LOOKUP_PATTERNS: RegExp[] = [
  /look\s*(it|this|that)?\s*up/i,
  /search\s+(the\s+)?web/i,
  /find\s+more\s+about/i,
  /beyond\s+(this|the)\s+document/i,
  /what\s+else\s+can\s+you\s+tell\s+me/i,
];

export function shouldExpandBeyondDocument(
  question: string,
  lookupToggle?: boolean,
  scope?: AssistantScope,
): boolean {
  if (lookupToggle) return true;
  if (scope === "document" || scope === "library") return false;
  const normalized = question.trim();
  if (!normalized) return false;
  return EXPANSION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shouldTriggerWebLookup(
  question: string,
  lookupToggle?: boolean,
  scope?: AssistantScope,
): boolean {
  if (lookupToggle) return true;
  if (scope === "document") return false;
  const normalized = question.trim();
  if (!normalized) return false;
  return WEB_LOOKUP_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Construct a focused web search query from the user's actual question
 * rather than sending a raw multi-sentence selected passage verbatim.
 */
export function buildWebSearchQuery(
  question: string,
  selection?: string | null,
): string {
  const cleanedQuestion = question
    .replace(/\b(look\s*(?:it|this|that)?\s*up|search\s+(?:the\s+)?web(?:\s+for)?|what\s+else\s+can\s+you\s+tell\s+me\s+about)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const needsTopicDisambiguation =
    !cleanedQuestion ||
    cleanedQuestion.length < 12 ||
    /\b(this|it|that|these|those|the\s+selection|this\s+paragraph)\b/i.test(cleanedQuestion);

  if (needsTopicDisambiguation && selection?.trim()) {
    const topicSnippet = selection
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return cleanedQuestion
      ? `${cleanedQuestion} ${topicSnippet}`.slice(0, 300).trim()
      : topicSnippet;
  }

  return (cleanedQuestion || question.trim()).slice(0, 300);
}

export function buildDocFirstExpansionInstruction(): string {
  return [
    "Answer from the selection and document context first.",
    "Then expand beyond the fed text with broader background.",
    "Clearly separate what came from the document vs external knowledge.",
  ].join(" ");
}

export function formatBraveContext(results: BraveSearchResult[]): string {
  if (results.length === 0) return "";
  const lines = results.slice(0, 5).map(
    (r, i) => `[${i + 1}] **${r.title}** (${r.url})\n   ${r.snippet}`,
  );
  return `\n\n**Web Search Results (Brave Search)**:\n${lines.join("\n\n")}\n\nUse the web search results to supplement your answer when necessary, citing them as [1], [2], etc.`;
}

export function buildNoLiveLookupNote(): string {
  return "Note: live web lookup was unavailable (no Brave key / search failed), so the expansion below uses model knowledge only.";
}

export function formatSourceLabeledAnswer(options: {
  documentPart: string;
  knowledgePart?: string;
  webPart?: string;
  webResults?: BraveSearchResult[];
  liveLookupUnavailable?: boolean;
}): string {
  const sections: string[] = [];
  if (options.documentPart.trim()) {
    sections.push(`**From your document:**\n${options.documentPart.trim()}`);
  }
  if (options.knowledgePart?.trim()) {
    sections.push(`**Broader background:**\n${options.knowledgePart.trim()}`);
  }
  if (options.webPart?.trim()) {
    sections.push(`**From the web:**\n${options.webPart.trim()}`);
  } else if (options.webResults && options.webResults.length > 0) {
    const webLines = options.webResults.map((r, i) => `[${i + 1}] ${r.title} (${r.url}) — ${r.snippet}`);
    sections.push(`**From the web:**\n${webLines.join("\n")}`);
  }
  if (options.liveLookupUnavailable) {
    sections.push(`_${buildNoLiveLookupNote()}_`);
  }
  return sections.join("\n\n");
}

export async function fetchBraveSearchWithTimeout(
  query: string,
  invokeFn: (command: string, args?: Record<string, unknown>) => Promise<BraveSearchResult[]>,
  timeoutMs = 8000,
): Promise<{ results: BraveSearchResult[]; timedOut: boolean }> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], timedOut: false };
  const invokePromise = invokeFn("brave_web_search", { query: trimmed });
  const timeoutPromise = new Promise<{ results: BraveSearchResult[]; timedOut: boolean }>((resolve) => {
    setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      invokePromise.then((results) => ({
        results: Array.isArray(results) ? results : [],
        timedOut: false,
      })),
      timeoutPromise,
    ]);
    return raced;
  } catch {
    return { results: [], timedOut: false };
  }
}
