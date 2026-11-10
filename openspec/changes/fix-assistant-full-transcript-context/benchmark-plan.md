# Performance Benchmark Plan: Assistant Full-Transcript Context & Budgeting

## 1. Overview & Objectives

Expanding the AI Assistant's context coverage from a legacy 2,252-token head slice to full transcript and whole-source analysis (up to 50,000+ tokens and 12-hour videos) introduces potential performance hotspots:
1. **Transcript Parsing & Window Chunking**: Tokenizing, segmenting, and windowing 20,000+ transcript entries.
2. **Lexical Indexing (BM25/TF-IDF)**: Constructing and querying segment inverted indexes on user prompts.
3. **Map-Reduce Parallelism**: Orchestrating multi-window LLM calls without saturating UI event loops or network channels.
4. **Context Action Dispatch Latency**: Ensuring instant UI feedback when launching actions like *Key points* or *Summarize* on massive transcripts.

This benchmark plan establishes rigorous performance budgets, automated regression gates, and memory lifecycle invariants in compliance with Plethora's benchmark gate (`AGENTS.md`).

---

## 2. Benchmark Suite Specification

The performance suite resides in `src/lib/ai/assistant/videoContextPlanner.bench.ts` and executes via `npm run bench:check` (`vitest bench`).

### 2.1 Existing Baselines (in `scripts/perf-baselines.json`)
- `assistant-video/topical-2h-cached`: Baseline cost `0.2246` (ratio to `noise-anchor`).
  - Measures BM25 window ranking on a 3,600-segment (2-hour) cached lecture transcript.
- `assistant-video/playback-2h-cached`: Baseline cost `0.1207` (ratio to `noise-anchor`).
  - Measures temporal playback window centering around current playback position.

### 2.2 New Benchmark Scenarios to Add

| Benchmark ID | Input Profile | Target Operation | Maximum Allowed Cost Ratio |
| :--- | :--- | :--- | :--- |
| `assistant-video/index-12h-uncached` | 21,600 segments (~12h lecture, synthetic seeded corpus) | Cold lexical index construction (`indexTranscript`) | $\le 1.85 	imes 	ext{anchor}$ |
| `assistant-video/topical-12h-cached` | 21,600 segments, cached index | BM25 multi-keyword ranking + window expansion for 50k budget | $\le 0.45 	imes 	ext{anchor}$ |
| `assistant-video/chunking-12h-mapreduce` | 21,600 segments, 12h transcript | Deterministic window splitting for hierarchical map-reduce | $\le 0.08 	imes 	ext{anchor}$ |
| `assistant-video/envelope-action-dispatch`| 2h video document, unselected target | `resolveActionEnvelope` full metadata resolution without string truncation | $\le 0.03 	imes 	ext{anchor}$ |

---

## 3. Seeded PRNG & Determinism Protocol

In accordance with Plethora's benchmark guidelines:
1. **Strict Determinism**: Benchmark inputs must never be constructed using `Math.random()` or real-time clocks (`Date.now()`, `performance.now()`). All inputs are generated via `seededRandom(seed)` from `src/test/bench-support.ts`.
2. **Runtime Isolation**: No Tauri APIs, filesystem I/O, or network fetch requests in benchmark bodies. All mocks and transcripts are pre-allocated in memory before the `describe` block executes.
3. **Dead Code Elimination Prevention**: Bench results are accumulated into a top-level module `sink` (e.g. `sink ^= plan.content.length`) and exported via a consumer helper `export function consumeVideoPlannerBenchmark(): number`.
4. **Void Return**: All benchmark lambdas return `void`.

### Example Benchmark Definition:
```typescript
import { bench, describe } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { planVideoContext, indexTranscript, chunkTranscriptForMapReduce } from "./videoContextPlanner";

const random = seededRandom(9042);
const dictionary = ["consciousness", "perception", "mycology", "psychedelic", "serotonin", "evolution", "neuroscience", "history", "culture", "nature"];

// Generate 12-hour synthetic transcript (21,600 segments at 2s interval)
const segments12h = Array.from({ length: 21600 }, (_, index) => ({
  start: index * 2,
  duration: 2,
  text: `At timestamp ${index * 2}s the speaker discusses ${dictionary[Math.floor(random() * dictionary.length)]} with empirical evidence and methodological rigor.`
}));

let sink = 0;

describe("assistant video context scalability", () => {
  bench("assistant-video/index-12h-uncached", () => {
    // Uncached indexing
    const index = indexTranscript(segments12h, { forceReindex: true });
    sink ^= index.tokenCount;
  });

  bench("assistant-video/topical-12h-cached", () => {
    // Warm query ranking with 50,000 token budget
    const plan = planVideoContext({
      segments: segments12h,
      query: "empirical neuroscience and perception evidence",
      sourceBudgetTokens: 50000
    });
    sink ^= plan.content.length;
  });

  bench("assistant-video/chunking-12h-mapreduce", () => {
    const chunks = chunkTranscriptForMapReduce(segments12h, { maxWindowTokens: 20000 });
    sink ^= chunks.length;
  });
});

export function consumeVideoPlannerBenchmark(): number {
  return sink;
}
```

---

## 4. Performance Gates & CI Verification

1. **Benchmark Measurement**:
   ```bash
   npm run bench
   ```
   Generates `.bench/results.json` without gating.
2. **Performance Gate Enforcement**:
   ```bash
   npm run bench:check
   ```
   Executes:
   - Vitest bench suite.
   - Compares measured dimensionless costs ($Cost = rac{	ext{anchorHz}}{	ext{benchHz}}$) against `scripts/perf-baselines.json`.
   - Checks against the configured tolerance (default $1.25	imes$).
   - Exits with non-zero status if any regression is detected.
3. **Baseline Updates**:
   If index caching or chunking algorithms are intentionally modified and alter baseline costs, `scripts/perf-baselines.json` must be updated within the same commit, accompanied by an explicit architectural justification.

---

## 5. Memory Allocation & Retention Invariants

1. **WeakMap Index Caching**:
   - Inverted transcript search indexes must be cached using a `WeakMap<TranscriptSegment[], TranscriptIndex>()`.
   - When a video tab closes or navigates to a new URL, the segment array reference is dereferenced by the garbage collector, immediately reclaiming index memory without explicit cleanup handlers.
2. **No Duplicated Full-Transcript Strings**:
   - `resolveActionEnvelope` and `buildActionPrompt` must not create copies of the entire 12-hour transcript string in state stores or envelopes.
   - Envelopes store lightweight metadata references (`target: { kind: 'source', id: 'video-transcript' }`). Full content is streamed or slice-rendered only at execution boundaries.
3. **Token Estimation Fast-Path**:
   - Planning passes (window budgeting, segment candidate ranking) must use fast character-ratio estimation ($pprox 4	ext{ chars/token}$) rather than synchronous tiktoken BPE encodes across hundreds of candidate slices.
   - Formal token counting is only evaluated once on the final consolidated prompt payload.

---

## 6. Map-Reduce Concurrency & Network Throttling

To prevent resource exhaustion during multi-window video summarization:
1. **Parallel Worker Limit**:
   - Map phase concurrency is clamped to **maximum 2 concurrent requests** (`p-limit(2)`).
   - Prevents local Ollama instances from choking GPU VRAM and cloud providers from returning `429 Too Many Requests`.
2. **Intermediate Summary Compaction**:
   - Each intermediate map window produces a fixed budget summary (target 250–500 tokens).
   - Intermediate allocations are discarded immediately after aggregation into the reduce input buffer.
3. **Cancellation & Abort Signals**:
   - All map-reduce sub-requests bind to the caller's `AbortSignal`.
   - When the user presses "Stop" or enters a new question, active map calls abort immediately, preventing orphaned LLM compute.
