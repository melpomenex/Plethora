export type {
  TextLocator,
  TimedTextEntry,
  TimedTextGranularity,
  TimedTextLookupResult,
  TimedTextMap,
  TimedTextSource,
  TimedTextTimingSource,
} from "./types";
export { TIMED_TEXT_MAP_VERSION } from "./types";

export { TimedTextPlaybackLookup } from "./playbackLookup";

export {
  startTimedTextWordTracking,
  type TimedTextWordTrackingHandle,
  type TimedTextWordTrackingOptions,
} from "./wordTrackingLoop";

export {
  buildTimedTextMapFromTtsChunk,
  buildTimedTextEntriesFromChunkTimings,
  type BuildChunkTimedTextOptions,
} from "./fromTtsChunk";

export {
  STICKY_TOLERANCE_MS,
  resolveActiveEntryIndex,
  type TimedTextPlaybackLookupOptions,
} from "./playbackLookup";

export { buildTimedTextMapFromAlignment } from "./fromAlignmentMap";

export {
  sourceAnchorToLocator,
  ebookLocatorToTextLocator,
  locatorToSourceAnchor,
} from "./locators";

export {
  assessPdfPageTextUsability,
  assessPdfPagesTextUsability,
  type PdfTextUsability,
  type PdfTextUsabilityResult,
} from "./pdfScannedDetection";
