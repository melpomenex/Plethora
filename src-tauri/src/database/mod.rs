//! Database layer for Incrementum

pub mod ai_provenance_repository;
pub mod audio_edition_repository;
pub mod concept_repository;
pub mod connection;
pub mod element_tree_repository;
pub mod item_activity_repository;
pub mod item_stats_repository;
pub mod language_profile_repository;
pub mod migrations;
pub mod neural_queue_repository;
pub mod priority_rank;
pub mod repository;

pub use ai_provenance_repository::{AiProvenance, AiProvenanceRepository};
pub use audio_edition_repository::AudioEditionRepository;
pub use concept_repository::{
    normalize_concept_name, Concept, ConceptBacklink, ConceptLink, ConceptRepository,
    LinkProposalOutcome, CONCEPT_RELATION_TYPES, MAX_AI_LINKS_PER_DAY,
};
pub use connection::Database;
pub use element_tree_repository::{
    find_node_id_in_tx, find_node_id_pool, register_node_in_tx, unlink_node_in_tx, ElementKind,
    ElementTreeNode, ElementTreeRepository, ELEMENT_TYPE_ITEM, ELEMENT_TYPE_TOPIC,
};
pub use item_activity_repository::{ItemActivityRepository, ACTIVITY_COALESCE_WINDOW_SECONDS};
pub use item_stats_repository::ItemStatsRepository;
pub use neural_queue_repository::{
    NeuralQueueRepository, NeuralQueueRow, ResolvedNeuralQueueEntry,
};
pub use repository::DocumentQueueInfo;
pub use repository::Repository;

/// Stored embedding vector for a queue item
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueItemEmbedding {
    pub item_id: String,
    /// Raw embedding vector bytes (f32 little-endian)
    pub embedding: Vec<f32>,
    pub content_hash: String,
    pub provider: String,
    pub model: String,
    pub dimension: i32,
    pub created_at: i64,
}

/// Stored embedding for a document chunk (whole-library RAG).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentChunkEmbedding {
    pub id: String,
    pub document_id: String,
    pub chunk_index: i32,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
    pub content_hash: String,
    pub provider: String,
    pub model: String,
    pub dimension: i32,
    pub created_at: i64,
}
