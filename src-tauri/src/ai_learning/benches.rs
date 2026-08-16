//! Timed performance tests for the semantic index (task 4.11, design D28).
//!
//! The repo's Rust side has no criterion dependency, so per the task these
//! are plain timed `#[test]`s with generous assertions (safe for CI) that
//! print their measurements under `--nocapture` for manual inspection and
//! for recording numbers in change reports. The searchable TS-side surface
//! of this feature is data plumbing only (no algorithm to bench — noted in
//! the change report), so no `src/lib/ai/ai_learning.bench.ts` was added.
//!
//! Gates (design D28):
//! - chunker throughput: ≥ 0.2 MB/s on a ~100 KB markdown document
//!   (generous floor; measured numbers go in the report),
//! - cosine top-k @10k and @100k synthetic 768-dim f32 vectors: completes
//!   under a generous wall-clock bound with correct top-1.

use crate::ai_learning::chunker::{chunk_document, ChunkContext, ChunkInput, ChunkOptions};
use std::time::Instant;

/// Deterministic seeded vector generator (splitmix64, same chain as the mock
/// embedding backend) — no `Math.random`-style nondeterminism, mirroring the
/// TS bench protocol (`src/test/bench-support.ts`).
pub(crate) struct SeededVectors {
    state: u64,
}

impl SeededVectors {
    pub(crate) fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub(crate) fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        ((z >> 11) as f64 / (1u64 << 53) as f64 - 0.5) as f32
    }

    pub(crate) fn vector(&mut self, dim: usize) -> Vec<f32> {
        let mut v: Vec<f32> = (0..dim).map(|_| self.next_f32()).collect();
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
        v
    }
}

/// The cosine top-k kernel used by `semantic_topk`: full cosine (dot + two
/// norms + sqrt, matching `ai/embedding_config.rs`) with a bounded min-heap.
/// Kept in one place so the bench measures exactly the production math.
pub(crate) fn cosine_topk_inmemory<'a>(
    query: &[f32],
    candidates: impl Iterator<Item = &'a Vec<f32>>,
    k: usize,
) -> Vec<(usize, f32)> {
    use std::cmp::Reverse;
    /// (score, idx) ordered by total order on the score — `f32` needs
    /// `total_cmp` to satisfy `Ord` (same rationale as `vector_store.rs`).
    #[derive(PartialEq)]
    struct Entry(f32, usize);
    impl Eq for Entry {}
    impl PartialOrd for Entry {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(other))
        }
    }
    impl Ord for Entry {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            self.0.total_cmp(&other.0)
        }
    }

    let mut heap: BinaryHeap<Reverse<Entry>> = BinaryHeap::with_capacity(k);
    for (idx, candidate) in candidates.enumerate() {
        if candidate.len() != query.len() {
            continue;
        }
        let score = crate::ai::embedding_config::cosine_similarity(query, candidate);
        let entry = Entry(score, idx);
        if heap.len() < k {
            heap.push(Reverse(entry));
        } else if let Some(Reverse(peek)) = heap.peek() {
            if score > peek.0 {
                heap.pop();
                heap.push(Reverse(entry));
            }
        }
    }
    let mut out: Vec<(usize, f32)> = heap
        .into_iter()
        .map(|Reverse(Entry(score, idx))| (idx, score))
        .collect();
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

use std::collections::BinaryHeap;

/// ~100 KB of realistic markdown (headings + paragraphs + a few oversized
/// blocks) built deterministically.
fn synthetic_markdown_100kb() -> String {
    let mut text = String::with_capacity(110_000);
    let mut section = 0u64;
    while text.len() < 100_000 {
        text.push_str(&format!("# Section {section}\n\n"));
        text.push_str(&format!("## Subsection {section}.1\n\n"));
        for p in 0..6 {
            let mut para = String::new();
            for s in 0..10 {
                para.push_str(&format!(
                    "Sentence {section}-{p}-{s} explains incremental reading with spaced repetition and semantic indexing. "
                ));
            }
            text.push_str(&para.trim_end());
            text.push_str("\n\n");
        }
        // An oversized block to exercise sentence-level splitting.
        let mut huge = String::new();
        for s in 0..120 {
            huge.push_str(&format!("Oversized {section} sentence {s} must be split at sentence boundaries with one-sentence overlap. "));
        }
        text.push_str(huge.trim_end());
        text.push_str("\n\n");
        section += 1;
    }
    text
}

#[test]
fn bench_chunker_throughput_100kb_markdown() {
    let text = synthetic_markdown_100kb();
    assert!(text.len() >= 100_000, "fixture is {} bytes", text.len());

    let ctx = ChunkContext {
        document_id: "bench-doc",
        source_type: "document",
        source_id: None,
        location_source_type: "markdown",
        spine_index: None,
    };
    let start = Instant::now();
    let chunks = chunk_document(
        &ctx,
        ChunkInput::Markdown { text: &text },
        &ChunkOptions::default(),
    );
    let elapsed = start.elapsed();

    let throughput_mbps = text.len() as f64 / 1_048_576.0 / elapsed.as_secs_f64();
    eprintln!(
        "[bench] chunker: {} bytes → {} chunks in {:?} ({:.2} MB/s)",
        text.len(),
        chunks.len(),
        elapsed,
        throughput_mbps
    );

    // Generous CI floor (D28 references ≥ 20 chunks/min *embedding*; pure
    // chunking is orders of magnitude faster — this catches pathological
    // regressions only).
    assert!(!chunks.is_empty());
    assert!(
        throughput_mbps >= 0.2,
        "chunker throughput {throughput_mbps:.3} MB/s below floor"
    );
    // The output must actually be chunk-shaped.
    assert!(chunks.iter().all(|c| c.text.len() > 0));
}

#[test]
fn bench_cosine_topk_10k_and_100k_vectors() {
    let dim = 768; // EmbeddingGemma 300M output dimension (design D10)
    for (n, wall_clock_cap_secs) in [(10_000usize, 5u64), (100_000usize, 60u64)] {
        let mut rng = SeededVectors::new(0x5EED_0000 + n as u64);
        let query = rng.vector(dim);
        // The needle: an exact copy of the query placed at a known index.
        let needle_idx = n / 2;
        let vectors: Vec<Vec<f32>> = (0..n)
            .map(|i| {
                if i == needle_idx {
                    query.clone()
                } else {
                    rng.vector(dim)
                }
            })
            .collect();

        let start = Instant::now();
        let top = cosine_topk_inmemory(&query, vectors.iter(), 8);
        let elapsed = start.elapsed();
        eprintln!(
            "[bench] cosine top-8 @{} x {}d: {:?} ({:.1}k vecs/s), top1 idx={} score={:.4}",
            n,
            dim,
            elapsed,
            n as f64 / elapsed.as_secs_f64() / 1000.0,
            top[0].0,
            top[0].1
        );

        // Correctness needle + generous wall-clock gate. D28 targets
        // p95 ≤ 300 ms @100k for the full retrieval path on-device; this
        // pure-Rust kernel check is deliberately much looser for CI variance.
        assert_eq!(top.len(), 8);
        assert_eq!(top[0].0, needle_idx, "exact-match needle must rank first");
        assert!(
            (top[0].1 - 1.0).abs() < 1e-4,
            "needle score {} ≈ 1.0",
            top[0].1
        );
        assert!(
            elapsed.as_secs() < wall_clock_cap_secs,
            "cosine top-k @{n} took {elapsed:?} (cap {wall_clock_cap_secs}s)"
        );
    }
}
