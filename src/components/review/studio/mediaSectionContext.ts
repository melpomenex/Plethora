import {
  type SectionNode,
} from "../../../utils/sectionIndex";

export function mediaTranscriptContextText(sections?: SectionNode[]): string {
  return (sections ?? [])
    .filter((section) => section.source === "media-transcript")
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function preferredStudioDocumentContextText(
  resolvedContent: string | undefined,
  storedContent: string | undefined,
  mediaSections?: SectionNode[],
): string | undefined {
  if (resolvedContent?.trim()) return resolvedContent;
  if (storedContent?.trim()) return storedContent;
  return mediaTranscriptContextText(mediaSections) || undefined;
}

export { resolveScopedSectionContext as resolveStudioSectionContext } from "../../../features/documentQa/sectionContextRequest";
