// @vitest-environment jsdom
/**
 * First-visible-word scan benchmark over a synthetic rendered document. The
 * scan runs only at Play/retarget time; this bounds its worst case (large
 * chapter where the visible word sits deep in document order).
 */
import { bench } from "vitest";
import "../test/bench-dom-setup";
import { seededRandom } from "../test/bench-support";
import { findFirstVisibleWord } from "./visibleText";

const VOCAB = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
];

function buildDocument(paragraphCount: number): HTMLElement {
  const rand = seededRandom(0x51b1e);
  const root = document.createElement("div");
  for (let p = 0; p < paragraphCount; p += 1) {
    const para = document.createElement("p");
    const words = 20 + Math.floor(rand() * 30);
    const sentence: string[] = [];
    for (let w = 0; w < words; w += 1) {
      sentence.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
    }
    para.textContent = `${sentence.join(" ")}.`;
    root.appendChild(para);
  }
  document.body.appendChild(root);
  return root;
}

const root = buildDocument(400);
let sink: string | null = null;

bench("visible-text/first-visible-scan", () => {
  const word = findFirstVisibleWord(root, {
    // All words "visible": rect source places every word inside the viewport.
    getRect: () => ({ top: 100, bottom: 120, left: 10, right: 50, width: 40, height: 20 } as DOMRect),
    getBlockRect: () => ({ top: 90, bottom: 130, left: 0, right: 800, width: 800, height: 40 } as DOMRect),
    viewport: { top: 0, bottom: 800 },
  });
  sink = word ? word.node.textContent?.slice(word.start, word.end) ?? null : null;
});
