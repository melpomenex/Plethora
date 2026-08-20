import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { searchTokens } from "./languageProcessing/contracts";
import { baselineAdapter } from "./languageProcessing/baseline";
import { wordSegments } from "./languageProcessing/unicode";
import type { TokenSpan } from "./languageProcessing/types";

const random = seededRandom(0x1a7e);
const words = Array.from({ length: 4_000 }, (_, index) => {
  const suffix = Math.floor(random() * 10_000);
  return `token${index}_${suffix}`;
});
const text = words.join(" ");
const segments = wordSegments(text, "en");
const tokens = segments.map((segment, index): TokenSpan => ({
  id: `token-${index}`,
  start: segment.start,
  end: segment.end,
  surface: segment.segment,
  normalized: segment.segment.toLowerCase(),
  kind: "word",
  script: { script: "latin", direction: "ltr" },
  confidence: { score: 1, label: "high" },
  isLexical: true,
}));
let sink = 0;

bench("language-processing/tokenize-4000-words", () => {
  let fold = 0;
  for (const segment of wordSegments(text, "en")) fold ^= segment.end - segment.start;
  sink ^= fold;
});

bench("language-processing/index-lookup-4000-tokens", () => {
  const query = { processingKey: "bench", normalized: tokens[1_337].normalized, limit: 20 } as const;
  const matches = searchTokens(tokens, query);
  sink ^= matches.length;
});

// Keep the deterministic baseline adapter in the benchmark module's input
// graph so this suite also guards its provider-independent contract shape.
if (baselineAdapter.id.length === 0) sink += 1;
