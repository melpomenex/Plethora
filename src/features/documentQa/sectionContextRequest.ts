export interface DocumentQaRequestContent {
  userPromptContent: string;
  contextContent: string;
}

export async function loadDocumentQaText(
  documentId: string,
  loaders: {
    getDocument: (id: string) => Promise<{ content?: string | null; fileType?: string; filePath?: string } | null | undefined>;
    extractDocumentText: (id: string) => Promise<{ content?: string | null } | null | undefined>;
  },
): Promise<string> {
  const document = await loaders.getDocument(documentId);
  if (document?.fileType === "youtube") {
    const videoId = document.filePath?.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1] ?? document.filePath;
    if (videoId) {
      const { invokeCommand } = await import("../../lib/tauri");
      const segments = await invokeCommand<Array<{ start: number; text: string }>>("get_youtube_transcript_by_id", { videoId, documentId });
      return segments.map((segment) => `[${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, "0")}] ${segment.text}`).join("\n");
    }
  }
  if (document?.content?.trim()) return document.content;
  const extracted = await loaders.extractDocumentText(documentId);
  return extracted?.content?.trim() ? extracted.content : "";
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
