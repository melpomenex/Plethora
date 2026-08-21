/**
 * Performance benchmark for Tier 1 Smart Tagging baseline classifier.
 * Measures tokenization, BM25 TF-IDF salience scoring, domain signature
 * multi-term evaluation, and candidate ranking across a typical document payload.
 */

import { bench } from "vitest";
import { classifyDocumentBaseline } from "./smartTagging/baseline";
import { seededRandom } from "../test/bench-support";

const rng = seededRandom(0x7a69);

const VOCAB = [
  "operating", "system", "kernel", "scheduling", "process", "thread",
  "memory", "allocation", "virtual", "address", "translation", "paging",
  "cpu", "context", "switch", "interrupt", "handler", "concurrency",
  "mutex", "semaphore", "deadlock", "algorithm", "data", "structure",
  "queue", "stack", "tree", "graph", "search", "sorting", "complexity",
  "distributed", "network", "protocol", "socket", "packet", "latency",
  "throughput", "database", "storage", "index", "transaction", "acid",
];

function generateSeededDocument(wordCount: number) {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const idx = Math.floor(rng() * VOCAB.length);
    words.push(VOCAB[idx]);
  }
  return {
    title: "Operating Systems Principles and Kernel Architecture",
    headings: [
      "Process Management and Thread Scheduling",
      "Virtual Memory and Paging Systems",
      "Concurrency and Synchronization Primitives",
    ],
    body: words.join(" "),
    existingLibraryTags: [
      { name: "Operating Systems", itemCount: 12 },
      { name: "Computer Science", itemCount: 45 },
      { name: "Distributed Systems", itemCount: 8 },
      { name: "Algorithms", itemCount: 20 },
    ],
  };
}

const doc = generateSeededDocument(1000);

let sink = 0;

bench("smartTagging/classify-document-baseline", () => {
  const result = classifyDocumentBaseline(doc);
  let acc = 0;
  for (const tag of result) {
    acc = (acc ^ tag.tag.length ^ Math.floor(tag.confidence * 1e4)) | 0;
  }
  sink ^= acc;
});
