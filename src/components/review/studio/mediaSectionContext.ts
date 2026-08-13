import {
  resolveMixedSectionFocusedContext,
  type FocusedSectionContextResult,
  type SectionNode,
} from "../../../utils/sectionIndex";

const DIRECT_SECTION_SOURCES = new Set<SectionNode["source"]>([
  "selection",
  "media-transcript",
]);

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

interface ResolveStudioSectionContextOptions {
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
export async function resolveStudioSectionContext({
  selectedSections,
  availableSections,
  documentId,
  maxTokens,
  currentText = "",
  loadCanonicalText,
  rebuildAvailableSections,
}: ResolveStudioSectionContextOptions): Promise<FocusedSectionContextResult> {
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
      includeNeighbors: true,
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
        includeNeighbors: true,
      },
    );
  }

  return focused;
}
