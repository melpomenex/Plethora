import type { SourceAnchor } from "../../utils/readerSpeechIndex";
import type { EbookWordLocator } from "../ebookAudiobookAlignment/types";
import type { TextLocator } from "./types";

/** Convert TTS speech-index anchor to shared TextLocator. */
export function sourceAnchorToLocator(anchor: SourceAnchor | null): TextLocator | null {
  if (!anchor) return null;
  switch (anchor.kind) {
    case "epub":
      return { kind: "epub-spine", spineIndex: anchor.spineIndex, sectionOffset: anchor.sectionOffset };
    case "pdf-word":
      return { kind: "pdf-word", wordId: anchor.wordId };
    case "pdf-token":
      return { kind: "pdf-token", tokenId: anchor.tokenId };
    case "text":
      return { kind: "text", surface: anchor.surface, startOffset: anchor.startOffset };
    case "page":
      return { kind: "page", pageNumber: anchor.pageNumber, pageOffset: anchor.pageOffset };
    default:
      return null;
  }
}

/** Convert audiobook alignment locator to shared TextLocator. */
export function ebookLocatorToTextLocator(locator: EbookWordLocator): TextLocator {
  if (locator.kind === "epub") {
    return { kind: "epub-href", chapterHref: locator.chapterHref, charOffset: locator.charOffset };
  }
  return {
    kind: "html",
    documentId: locator.documentId,
    blockId: locator.blockId,
    charOffset: locator.charOffset,
  };
}

/** Convert shared TextLocator back to TTS SourceAnchor where possible. */
export function locatorToSourceAnchor(locator: TextLocator | null): SourceAnchor | null {
  if (!locator) return null;
  switch (locator.kind) {
    case "epub-spine":
      return { kind: "epub", spineIndex: locator.spineIndex, sectionOffset: locator.sectionOffset };
    case "pdf-word":
      return { kind: "pdf-word", wordId: locator.wordId };
    case "pdf-token":
      return { kind: "pdf-token", tokenId: locator.tokenId };
    case "text":
      return { kind: "text", surface: locator.surface, startOffset: locator.startOffset };
    case "page":
      return { kind: "page", pageNumber: locator.pageNumber, pageOffset: locator.pageOffset };
    default:
      return null;
  }
}
