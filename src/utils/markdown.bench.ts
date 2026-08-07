/**
 * Markdown rendering hot path — `renderMarkdown` runs on every reader render
 * (see src/utils/markdown.ts). Benchmarks one render of a fixed multi-thousand-
 * word document with mixed formatting: headings, paragraphs, lists, a table,
 * a code block, blockquotes, inline code/bold/italic/links, and LaTeX.
 *
 * The full-document cache would turn every iteration after the first into a
 * map hit, so the cache is cleared per iteration via the exported
 * `clearMarkdownCache()` — every iteration performs the real render.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { clearMarkdownCache, renderMarkdown } from "./markdown";

const rng = seededRandom(0xadd5eed);

const VOCAB = [
  "algorithm", "memory", "review", "schedule", "interval", "stability",
  "difficulty", "retrievability", "flashcard", "spaced", "repetition",
  "recall", "learning", "session", "queue", "priority", "lapse", "grade",
  "scheduler", "collection", "document", "render", "parser", "synthetic",
];

function pickWord(): string {
  return VOCAB[Math.floor(rng() * VOCAB.length)];
}

function sentence(): string {
  const n = 6 + Math.floor(rng() * 8);
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) words.push(pickWord());
  // Sprinkle inline formatting into roughly half the sentences.
  const joined = words.join(" ");
  const r = rng();
  if (r < 0.15) return `**${joined}**`;
  if (r < 0.3) return `*${joined}*`;
  if (r < 0.4) return `\`${joined}\``;
  if (r < 0.5) return `[${joined}](https://example.com/${pickWord()})`;
  return joined;
}

function paragraph(): string {
  const n = 3 + Math.floor(rng() * 3);
  const sentences: string[] = [];
  for (let i = 0; i < n; i += 1) sentences.push(sentence());
  return sentences.join(" ");
}

const chunks: string[] = [];
for (let i = 0; i < 3; i += 1) chunks.push(`# Heading ${i + 1}`);
for (let i = 0; i < 3; i += 1) chunks.push(`## Sub-heading ${i + 1}`);
for (let i = 0; i < 40; i += 1) chunks.push(paragraph());
chunks.push("- first list item\n- second list item\n- third list item");
chunks.push("1. ordered one\n2. ordered two\n3. ordered three");
chunks.push(
  "> A blockquote with **bold** and a $\\alpha$ inline expression.",
);
chunks.push(
  "| Term | Meaning |\n| --- | --- |\n" +
    "| stability | durability of memory |\n" +
    "| difficulty | item complexity |\n" +
    "| retrievability | recall probability |",
);
chunks.push("```ts\nfunction anchor(acc: number): number {\n  return Math.imul(acc, 0x9e3779b1) >>> 0;\n}\n```");
chunks.push("Inline math $\\sum_{i=1}^{n} i = n(n+1)/2$ and display math:\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$");

const DOCUMENT = chunks.join("\n\n");

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the render).
let sink = 0;

bench("markdown/render-document", () => {
  clearMarkdownCache();
  sink ^= renderMarkdown(DOCUMENT).length;
});
