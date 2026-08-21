//! Canonical Product Documentation & Ask Plethora Tauri Commands

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static BUNDLED_HELP_JSON: &str = include_str!("../../../src/features/help/generated/helpIndex.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelpSearchResultItem {
    pub id: String,
    pub doc_id: String,
    pub title: String,
    pub domain: String,
    pub section: String,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelpIndexSummary {
    pub version: String,
    pub corpus_hash: String,
    pub total_docs: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Deserialize)]
struct BundledHelpIndexRaw {
    version: String,
    #[serde(rename = "corpusHash")]
    corpus_hash: String,
    #[serde(rename = "totalDocs")]
    total_docs: usize,
    #[serde(rename = "totalChunks")]
    total_chunks: usize,
    chunks: Vec<BundledChunkRaw>,
}

#[derive(Debug, Deserialize)]
struct BundledChunkRaw {
    id: String,
    #[serde(rename = "docId")]
    doc_id: String,
    title: String,
    domain: String,
    section: String,
    content: String,
    #[serde(default)]
    aliases: Vec<String>,
}

static PARSED_INDEX: OnceLock<BundledHelpIndexRaw> = OnceLock::new();

fn get_parsed_index() -> &'static BundledHelpIndexRaw {
    PARSED_INDEX.get_or_init(|| {
        serde_json::from_str(BUNDLED_HELP_JSON).unwrap_or_else(|e| {
            tracing::error!("[help] Failed to parse bundled help JSON: {}", e);
            BundledHelpIndexRaw {
                version: "1.0.0".to_string(),
                corpus_hash: "sha256:fallback".to_string(),
                total_docs: 0,
                total_chunks: 0,
                chunks: Vec::new(),
            }
        })
    })
}

/// Returns the embedded help index metadata and corpus SHA-256 hash.
#[tauri::command]
pub fn get_help_index_summary() -> HelpIndexSummary {
    let index = get_parsed_index();
    HelpIndexSummary {
        version: index.version.clone(),
        corpus_hash: index.corpus_hash.clone(),
        total_docs: index.total_docs,
        total_chunks: index.total_chunks,
    }
}

/// Returns the entire pre-indexed help JSON string for local client-side retrieval.
#[tauri::command]
pub fn get_bundled_help_index() -> &'static str {
    BUNDLED_HELP_JSON
}

/// Fast native Rust search across bundled help chunks.
#[tauri::command]
pub fn search_help_docs_native(query: String, max_results: Option<usize>) -> Vec<HelpSearchResultItem> {
    let index = get_parsed_index();
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }

    let terms: Vec<&str> = q.split_whitespace().collect();
    let limit = max_results.unwrap_or(20);
    let mut matches: Vec<(f64, &BundledChunkRaw)> = Vec::new();

    for chunk in &index.chunks {
        let title_lower = chunk.title.to_lowercase();
        let content_lower = chunk.content.to_lowercase();

        let mut score = 0.0;

        // Exact title match
        if title_lower == q {
            score += 10.0;
        } else if title_lower.contains(&q) {
            score += 5.0;
        }

        // Aliases match
        for alias in &chunk.aliases {
            let alias_lower = alias.to_lowercase();
            if alias_lower == q {
                score += 8.0;
            } else if alias_lower.contains(&q) {
                score += 4.0;
            }
        }

        // Term matching in content
        let mut term_matches = 0;
        for term in &terms {
            if content_lower.contains(term) {
                term_matches += 1;
                score += 1.0;
            }
        }

        if score > 0.0 && term_matches > 0 {
            matches.push((score, chunk));
        }
    }

    matches.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    matches
        .into_iter()
        .take(limit)
        .map(|(score, chunk)| {
            let snippet = if chunk.content.len() > 200 {
                format!("{}...", &chunk.content[..200])
            } else {
                chunk.content.clone()
            };

            HelpSearchResultItem {
                id: chunk.id.clone(),
                doc_id: chunk.doc_id.clone(),
                title: chunk.title.clone(),
                domain: chunk.domain.clone(),
                section: chunk.section.clone(),
                snippet,
                score,
            }
        })
        .collect()
}
