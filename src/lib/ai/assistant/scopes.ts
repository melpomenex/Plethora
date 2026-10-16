/**
 * Shared conversational scope definitions, grounding policies, and diagnostic
 * contracts for the Unified Conversational Assistant (`assistant-conversation-scopes`).
 */

export const ASSISTANT_SCOPES = ["chat", "document", "library"] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

export interface AssistantScopeMetadata {
  scope: AssistantScope;
  label: string;
  shortDescription: string;
  requiresSourceEvidence: boolean;
  allowsExternalKnowledge: boolean;
  supportsCrossDocumentRetrieval: boolean;
}

export const ASSISTANT_SCOPE_METADATA: Record<AssistantScope, AssistantScopeMetadata> = {
  chat: {
    scope: "chat",
    label: "Chat",
    shortDescription: "Uses current source as context + general knowledge",
    requiresSourceEvidence: false,
    allowsExternalKnowledge: true,
    supportsCrossDocumentRetrieval: false,
  },
  document: {
    scope: "document",
    label: "Document",
    shortDescription: "Strictly grounded in current source only",
    requiresSourceEvidence: true,
    allowsExternalKnowledge: false,
    supportsCrossDocumentRetrieval: false,
  },
  library: {
    scope: "library",
    label: "Library",
    shortDescription: "Searches and cites across your library",
    requiresSourceEvidence: true,
    allowsExternalKnowledge: false,
    supportsCrossDocumentRetrieval: true,
  },
};

export type TranscriptAvailabilityStatus =
  | "loading"
  | "ready-full"
  | "ready-indexed"
  | "partial"
  | "unavailable"
  | "failed";

export interface SourceProvenanceRef {
  documentId?: string;
  videoId?: string;
  title?: string;
  url?: string;
  timestampSeconds?: number;
  pageNumber?: number;
  sectionLabel?: string;
  coverage?: "full" | "window" | "chunks" | "hierarchical-full" | "none";
}

export interface AssistantRequestDiagnostics {
  scope: AssistantScope;
  provider: string;
  model?: string;
  policy: {
    configuredContextTokens: number;
    promptBudgetTokens: number;
    outputReserveTokens: number;
  };
  tokenBreakdown: {
    systemTokens: number;
    historyTokens: number;
    memoryTokens: number;
    sourceTokens: number;
    userTokens: number;
  };
  sourceStatus: {
    type: "document" | "video" | "web" | "general";
    status: "ready" | "loading" | "unavailable" | "failed" | "partial";
    coverage: "full" | "window" | "chunks" | "hierarchical-full" | "none";
    chunkCount: number;
    timeRangeCovered?: { startSeconds: number; endSeconds: number };
  };
  historyCount: {
    verbatimMessages: number;
    summarizedMessages: number;
  };
}

export function isAssistantScope(value: unknown): value is AssistantScope {
  return value === "chat" || value === "document" || value === "library";
}

export function resolveDefaultAssistantScope(options?: {
  explicitScope?: AssistantScope | null;
  legacyUseWholeLibraryScope?: boolean;
  entryPoint?: "general" | "reader" | "library-palette" | "strict-document-qa";
}): AssistantScope {
  if (options?.explicitScope && isAssistantScope(options.explicitScope)) {
    return options.explicitScope;
  }
  if (options?.legacyUseWholeLibraryScope) {
    return "library";
  }
  if (options?.entryPoint === "library-palette") {
    return "library";
  }
  if (options?.entryPoint === "strict-document-qa") {
    return "document";
  }
  return "chat";
}

export function buildScopePolicyInstruction(
  scope: AssistantScope,
  options?: {
    hasSourceContext?: boolean;
    sourceType?: "document" | "video" | "web" | "general";
    transcriptStatus?: TranscriptAvailabilityStatus;
  },
): string {
  const hasSource = Boolean(options?.hasSourceContext);
  const sourceType = options?.sourceType ?? "general";

  if (scope === "document") {
    if (!hasSource) {
      return [
        "ACTIVE SCOPE: Document (Strict Source Grounding).",
        "The active source context is currently unavailable or empty.",
        "State clearly that no readable source content or transcript is available to answer strictly from the document, and suggest switching to Chat scope if the user wants an answer from general knowledge.",
      ].join(" ");
    }
    return [
      "ACTIVE SCOPE: Document (Strict Source Grounding).",
      "Answer strictly using evidence supplied in the <untrusted_source> context blocks.",
      "Do NOT silently supplement answers with unsupported outside model knowledge.",
      "When citing passages or video timestamps, cite only actual supplied evidence.",
      "If the supplied source does not contain enough evidence to answer the question, state clearly what is missing from the source.",
    ].join(" ");
  }

  if (scope === "library") {
    return [
      "ACTIVE SCOPE: Library (Cross-Source Grounded Research).",
      "Synthesize your answer using ONLY the retrieved <untrusted_source> chunks and any supplied selection context.",
      "Cite supporting sources with [N] markers corresponding to the provided chunks, and never fabricate citations or quotes.",
      "Use conversation history to resolve follow-up references (such as 'the second paper', 'compare these', or 'that claim'), while grounding all factual claims in the supplied sources.",
      "If the retrieved library sources do not cover the question, state clearly that the library does not contain sufficient evidence.",
    ].join(" ");
  }

  // Default: Chat scope
  const sourceGuidance = hasSource
    ? sourceType === "video"
      ? "Use the supplied video transcript context as an asset when the user asks about the video, citing [MM:SS] timestamps for video-specific claims."
      : "Use the supplied document/selection context as an asset when the user's question relates to the source, citing the source when making source-specific claims."
    : options?.transcriptStatus === "unavailable" || options?.transcriptStatus === "failed"
      ? "Note: The active video's transcript is unavailable. If the user asks about specific spoken details in the video, disclose that the transcript is unavailable while offering helpful general background."
      : "No active source document excerpt is required for general questions.";

  return [
    "ACTIVE SCOPE: Chat (Context-Aware Learning Companion).",
    sourceGuidance,
    "You may freely draw on broader model knowledge, answer unrelated general questions on any turn, connect ideas across disciplines, and explore topics beyond the current source without restriction.",
    "Clearly distinguish source-derived facts from broader background knowledge, and NEVER fabricate quotations, source passages, timestamps, or citations.",
  ].join(" ");
}

export interface VideoViewerContext {
  videoId: string;
  title?: string;
  transcript?: string;
  currentTime?: number;
  duration?: number;
  transcriptStatus?: TranscriptAvailabilityStatus;
}
