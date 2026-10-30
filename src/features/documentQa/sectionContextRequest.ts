import { resolveMixedSectionFocusedContext, type FocusedSectionContextResult, type SectionNode } from "../../utils/sectionIndex";

export interface DocumentQaRequestContent {
  userPromptContent: string;
  contextContent: string;
}

export async function loadDocumentQaText(
  documentId: string,
  loaders: {
    getDocument: (id: string) => Promise<{ content?: string | null; fileType?: string; filePath?: string; metadata?: any } | null | undefined>;
    extractDocumentText: (id: string) => Promise<{ content?: string | null } | null | undefined>;
  },
): Promise<string> {
  const document = await loaders.getDocument(documentId);
  if (document?.fileType === "youtube") {
    const videoId = document.filePath?.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1] ?? document.filePath;
    if (videoId) {
      try {
        const { invokeCommand } = await import("../../lib/tauri");
        const segments = await invokeCommand<Array<{ start: number; text: string }>>("get_youtube_transcript_by_id", { videoId, documentId });
        if (Array.isArray(segments) && segments.length > 0) {
          return segments.map((segment) => `[${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, "0")}] ${segment.text}`).join("\n");
        }
      } catch (err) {
        console.warn("Failed to load YouTube transcript for document:", documentId, err);
      }
    }
  }
  if (document?.metadata?.xThread) {
    const xThread = document.metadata.xThread;
    if (typeof xThread.structuredText === "string" && xThread.structuredText.trim()) {
      return xThread.structuredText.trim();
    }
    if (Array.isArray(xThread.posts) && xThread.posts.length > 0) {
      try {
        const { resolveTwitterThreadAssistantContext } = await import("../../utils/assistantContext");
        const resolved = resolveTwitterThreadAssistantContext(document as any);
        if (typeof resolved.content === "string" && resolved.content.trim()) {
          return resolved.content.trim();
        }
      } catch (err) {
        console.warn("Failed to resolve X thread context for document:", documentId, err);
      }
    }
  }
  if (typeof document?.content === "string" && document.content.trim()) return document.content.trim();
  const extracted = await loaders.extractDocumentText(documentId);
  return typeof extracted?.content === "string" && extracted.content.trim() ? extracted.content.trim() : "";
}

/**
 * Build the two LLM-facing fields from the same canonical document context.
 * Keeping this at the provider boundary prevents the prompt and structured
 * context from drifting to different section bodies.
 */
export function createDocumentQaRequestContent(options: {
  documentContext: string;
  userQuestion: string;
  focusLabel?: string;
  webSearchContext?: string;
}): DocumentQaRequestContent {
  const { documentContext, userQuestion, focusLabel, webSearchContext = "" } = options;
  const contextContent = `${documentContext}${webSearchContext}`;
  const focusPrefix = focusLabel ? `[Focusing on Section: ${focusLabel}]\n\n` : "";
  return {
    userPromptContent: `${focusPrefix}User question: ${userQuestion}`,
    contextContent,
  };
}

const DIRECT_SECTION_SOURCES = new Set<SectionNode["source"]>(["selection", "media-transcript"]);

interface ResolveScopedSectionContextOptions {
  selectedSections: SectionNode[];
  availableSections: SectionNode[];
  documentId: string;
  maxTokens: number;
  currentText?: string;
  loadCanonicalText: () => Promise<string>;
  rebuildAvailableSections?: (freshText: string) => SectionNode[];
}

/**
 * Resolve Studio section focus without forcing authoritative transcript
 * chapters through document character offsets. Structural headings still use
 * freshly loaded canonical text and retain the existing one-time rebuild.
 */
export async function resolveScopedSectionContext({
  selectedSections,
  availableSections,
  documentId,
  maxTokens,
  currentText = "",
  loadCanonicalText,
  rebuildAvailableSections,
}: ResolveScopedSectionContextOptions): Promise<FocusedSectionContextResult> {
  const requiresCanonicalText = selectedSections.some(
    (section) => !DIRECT_SECTION_SOURCES.has(section.source),
  );
  let fullContent = requiresCanonicalText ? await loadCanonicalText() : currentText;
  let focused = resolveMixedSectionFocusedContext(
    selectedSections,
    availableSections,
    fullContent,
    {
      documentId,
      maxTokens,
      includeNeighbors: false,
    },
  );

  if (!focused.ok && requiresCanonicalText && rebuildAvailableSections) {
    fullContent = await loadCanonicalText();
    focused = resolveMixedSectionFocusedContext(
      selectedSections,
      rebuildAvailableSections(fullContent),
      fullContent,
      {
        documentId,
        maxTokens,
        includeNeighbors: false,
      },
    );
  }

  return focused;
}
