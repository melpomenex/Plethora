/**

 Whether a Document's `filePath` is portable content (safe to replicate
 as-is) rather than a device-local filesystem path (never safe to
 replicate — see documentReplication.ts's module doc comment and
 syncPrivacy.ts's path-like-key check).

 Pulled out of documentReplication.ts into its own dependency-free module:
 both documentReplication.ts (publishDocument) and seedReaders.ts
 (readDocumentSeedRows) need this exact same decision when deciding whether
 to include `filePath` on the outbox wire payload, but seedReaders.ts must
 not pull in documentReplication.ts's full module graph (stores, i18n,
 Yjs) just for this one pure check.

*/

const PORTABLE_FILEPATH_SCHEMES = [
  "http://",
  "https://",
  "browser-fetched://",
  "clipboard://",
  "screenshot://",
  "bundle://",
];

export function isPortableFilePath(
  filePath: string | undefined,
  fileType?: string,
): boolean {
  if (!filePath) return false;
  // The "youtube" / "video" fileTypes are URL-backed by construction
  // (importYouTubeVideo / import_twitter_video store the source URL in filePath).
  if (fileType === "youtube") return true;
  return PORTABLE_FILEPATH_SCHEMES.some((scheme) =>
    filePath.startsWith(scheme),
  );
}
