/**
 * Leaf-level audiobook format knowledge shared by the API layer and the
 * import planner. Lives outside `src/api/audiobooks.ts` so pure planning code
 * (and its tests) does not pull the whole API/store module graph.
 */

// Supported audiobook formats (kept in sync with src/api/audiobooks.ts).
export const AUDIOBOOK_FORMATS = [
  "mp3", "m4b", "m4a", "aac", "ogg", "flac", "opus", "wav", "wma"
] as const;

export function audioExtensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function isAudiobookFile(filePath: string): boolean {
  const ext = audioExtensionOf(filePath);
  return (AUDIOBOOK_FORMATS as readonly string[]).includes(ext);
}
