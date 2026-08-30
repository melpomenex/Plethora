import type { AlignedWord, PlethoraAlignmentMap } from "../ebookAudiobookAlignment/types";
import { ebookLocatorToTextLocator } from "./locators";
import type { TimedTextEntry, TimedTextMap } from "./types";
import { TIMED_TEXT_MAP_VERSION } from "./types";

/** Adapt a PlethoraAlignmentMap into the shared TimedTextMap shape. */
export function buildTimedTextMapFromAlignment(map: PlethoraAlignmentMap): TimedTextMap {
  const entries: TimedTextEntry[] = [];
  for (const chapter of map.chapters) {
    for (const word of chapter.words) {
      entries.push(alignedWordToEntry(word));
    }
  }
  return {
    version: TIMED_TEXT_MAP_VERSION,
    documentId: map.ebookDocId,
    sourceType: "audiobook_alignment",
    fingerprint: map.transcriptFingerprint,
    entries,
  };
}

function alignedWordToEntry(word: AlignedWord): TimedTextEntry {
  return {
    startMs: word.startMs,
    endMs: word.endMs,
    text: word.text,
    locator: ebookLocatorToTextLocator(word.locator),
    granularity: "word",
    confidence: word.confidence,
    interpolated: word.interpolated,
    timingSource: word.interpolated ? "synthesized" : "measured",
    sentenceId: word.sentenceId,
  };
}
