/**
 * Legacy Document Q&A context builders truncate long document text to
 * `maxTokens * 4` characters with a visible marker. Video documents are
 * exempt: the assistant's video planner evaluates the complete transcript and
 * composes hierarchical coverage when it exceeds the model budget, so a
 * head-only slice must never hide the end of a long transcript.
 */
export function truncateLegacyQaContext(
  content: string,
  maxTokens: number,
  isVideoDocument: boolean,
): string {
  if (isVideoDocument) return content;
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[Content truncated due to length...]`;
}

/** Whether a document's file type carries a video transcript. */
export function isVideoDocumentFileType(fileType: string | undefined | null): boolean {
  return fileType === "youtube" || fileType === "video";
}
