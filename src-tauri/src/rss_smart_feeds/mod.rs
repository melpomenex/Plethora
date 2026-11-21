//! AI-Powered Smart Feeds for Plethora RSS.
//!
//! Provides natural-language, topic-specific virtual feeds populated through a
//! hybrid multi-stage curation pipeline:
//! - Stage A (`normalize`): HTML stripping, metadata normalization, content hash
//! - Stage B (`clustering`): Unicode-safe duplicate & same-story clustering
//! - Stages C–E (`retrieval`): Embedding reuse, separate positive/negative
//!   definitions, FTS5 + multi-field lexical/entity retrieval
//! - Stages F–G (`classifier`): Calibrated Fast Local scoring, optional
//!   prompt-injection-hardened local/cloud LLM adjudication, and ranking
//! - Background execution (`worker`): Cancellable progress, bounded concurrency,
//!   incremental ingestion updates, and deterministic feedback rebuilds

pub mod classifier;
pub mod clustering;
pub mod models;
pub mod normalize;
pub mod repository;
pub mod retrieval;
pub mod worker;

#[cfg(test)]
mod tests;
