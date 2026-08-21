/**
 * Performance Benchmark for Help Retrieval Engine & Intent Classifier
 */

import { bench, describe } from "vitest";
import { defaultHelpRetrieval } from "./helpRetrieval";
import { classifyPaletteInput } from "./helpIntent";
import { getDirectLookupResult } from "./directLookup";

let sink: unknown = 0;

describe("Help Retrieval Performance Gate", () => {
  bench("help/intent-classification-50-queries", () => {
    const queries = [
      "eink mode",
      "? how do I enable word highlighting",
      "/help fsrs algorithm",
      "sm18",
      "reading queue",
      "tts speed",
      "newsblur sync",
      "anki import",
      "zen mode",
      "pdf reflow",
    ];

    let count = 0;
    for (let i = 0; i < 5; i++) {
      for (const q of queries) {
        const res = classifyPaletteInput(q);
        if (res.kind === "product_help" || res.kind === "direct_lookup") {
          count++;
        }
      }
    }
    sink = count;
  });

  bench("help/bm25-search-10-queries", () => {
    const queries = [
      "spaced repetition algorithm",
      "e-ink monochrome high contrast",
      "text to speech word highlighting",
      "extract lifecycle keep dismiss done",
      "reading queue priority scoring",
    ];

    let totalChunks = 0;
    for (let i = 0; i < 2; i++) {
      for (const q of queries) {
        const results = defaultHelpRetrieval.search(q, { limit: 5 });
        totalChunks += results.length;
      }
    }
    sink = totalChunks;
  });

  bench("help/direct-canonical-lookup", () => {
    const queries = [
      "eink",
      "fsrs",
      "sm18",
      "sm20",
      "reflow",
      "tts",
      "dictionary",
      "rss",
      "zen",
      "flashcards",
    ];

    let found = 0;
    for (const q of queries) {
      const res = getDirectLookupResult(q);
      if (res) found++;
    }
    sink = found;
  });
});
