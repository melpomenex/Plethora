import type { AlignedWord, PlethoraAlignmentMap } from "./types";
import { ebookLocatorToTextLocator } from "../timedText/locators";
import { TimedTextPlaybackLookup } from "../timedText/playbackLookup";
import type { TimedTextEntry } from "../timedText/types";
import { hrefMatchesChapter } from "../../utils/epubWordHighlight";

export interface PlaybackState {
  chapterIndex: number;
  wordIndex: number;
}

/**
 * Audiobook alignment playback lookup — thin wrapper over the shared
 * `TimedTextPlaybackLookup` so ebook+audiobook sync and document TTS share
 * the same sticky-gap + cursor-advance engine.
 */
export class PlaybackLookup {
  private readonly lookup: TimedTextPlaybackLookup;
  private readonly flatWords: AlignedWord[];
  private readonly chapterStarts: number[] = [];

  constructor(map: PlethoraAlignmentMap | null) {
    this.flatWords = [];
    if (!map) {
      this.lookup = new TimedTextPlaybackLookup([]);
      return;
    }
    const entries: TimedTextEntry[] = [];
    for (const ch of map.chapters) {
      this.chapterStarts.push(this.flatWords.length);
      for (const word of ch.words) {
        const index = this.flatWords.length;
        this.flatWords.push(word);
        entries.push({
          startMs: word.startMs,
          endMs: word.endMs,
          text: word.text,
          locator: ebookLocatorToTextLocator(word.locator),
          granularity: "word",
          confidence: word.confidence,
          interpolated: word.interpolated,
          timingSource: word.interpolated ? "synthesized" : "measured",
          sentenceId: word.sentenceId,
          wordIndex: index,
        });
      }
    }
    this.lookup = new TimedTextPlaybackLookup(entries, { presorted: true });
  }

  get wordCount(): number {
    return this.flatWords.length;
  }

  resetCursor(): void {
    this.lookup.resetCursor();
  }

  findWordAtTime(ms: number): { word: AlignedWord; index: number } | null {
    const result = this.lookup.findAtTime(ms);
    if (!result) return null;
    const word = this.flatWords[result.index];
    if (!word) return null;
    return { word, index: result.index };
  }

  advance(ms: number): { word: AlignedWord; index: number } | null {
    const result = this.lookup.advance(ms);
    if (!result) return null;
    const word = this.flatWords[result.index];
    if (!word) return null;
    return { word, index: result.index };
  }

  getWordAtIndex(index: number): AlignedWord | null {
    return this.flatWords[index] ?? null;
  }

  getAllWords(): readonly AlignedWord[] {
    return this.flatWords;
  }

  getChapterForWordIndex(index: number): number {
    let chapter = 0;
    for (let i = 1; i < this.chapterStarts.length; i++) {
      if (this.chapterStarts[i] <= index) chapter = i;
      else break;
    }
    return chapter;
  }

  /** Find the aligned word whose epub char offset contains `charOffset`. */
  findWordByCharOffset(chapterHref: string, charOffset: number): AlignedWord | null {
    let best: AlignedWord | null = null;
    for (const w of this.flatWords) {
      if (w.locator.kind !== "epub") continue;
      if (!hrefMatchesChapter(w.locator.chapterHref, chapterHref)) continue;
      if (w.locator.charOffset > charOffset) break;
      best = w;
    }
    return best;
  }
}

export function confidenceTier(confidence: number): "high" | "medium" | "low" | "unusable" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.5) return "medium";
  if (confidence >= 0.3) return "low";
  return "unusable";
}

export function shouldUseWordHighlight(chapterConfidence: number, word: AlignedWord): boolean {
  if (chapterConfidence < 0.3) return false;
  if (word.interpolated && word.confidence < 0.35) return false;
  return true;
}
