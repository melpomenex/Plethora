/**
 * Returns whether an audio or video element in the current document is
 * actively playing with enough buffered data to continue playback.
 */
export function hasActiveMediaPlayback(): boolean {
  if (typeof document === "undefined") return false;

  const mediaElements = Array.from(
    document.querySelectorAll<HTMLMediaElement>("audio, video"),
  );
  return mediaElements.some(
    (element) => !element.paused && !element.ended && element.readyState > 2,
  );
}
