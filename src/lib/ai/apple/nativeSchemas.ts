/**
 * Structured schemas compiled into the Apple Foundation Models Swift bridge
 * (`FmGenerables.swift`). Any other `schemaName` uses strict-JSON text mode on
 * Apple FM — same as cloud/Ollama structured tasks.
 */
export const APPLE_FM_NATIVE_SCHEMAS = new Set([
  "smartTagging",
  "libraryAnswer",
  "generatedFlashcards",
  "learningMaterialProposal",
]);

export function appleFmSupportsNativeSchema(schemaName: string | undefined): boolean {
  return !!schemaName && APPLE_FM_NATIVE_SCHEMAS.has(schemaName);
}
