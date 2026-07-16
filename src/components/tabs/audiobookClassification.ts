import { Document } from "../../types/document";

/**
 * A document belongs on the Audiobooks Shelf when it looks like audio content
 * and isn't explicitly a podcast episode. Podcast episodes are also created
 * with fileType "audio" and an "audio" tag, so the podcast tag must win.
 */
export function isAudiobookDocument(doc: Pick<Document, "fileType" | "tags">): boolean {
  const isPodcast = doc.tags?.some((t) => t.toLowerCase() === "podcast");
  if (isPodcast) return false;

  const isAudio = doc.fileType === "audio";
  const hasAudioTag = doc.tags?.some(
    (t) => t.toLowerCase() === "audiobook" || t.toLowerCase() === "audio"
  );
  return isAudio || hasAudioTag;
}
