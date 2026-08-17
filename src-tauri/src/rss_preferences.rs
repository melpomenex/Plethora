//! Semantic RSS preference learning (OpenSpec: rss-semantic-preference-learning).
//!
//! Thumbs-up/down on an article persists an article-level feedback event and
//! updates per-sentiment embedding clusters. Clusters are derived state: they
//! are incrementally maintained on feedback (assign-to-nearest above a
//! similarity threshold, else spawn; capped count) with exponential decay so
//! old interests fade, and they can be rebuilt deterministically from the
//! feedback table (`rebuild`).
//!
//! Vectors never leave this module except as scores/exemplar metadata; all
//! cosine math happens locally (mirrors `algorithms::relevance` conventions).

use crate::ai::embedding_config::cosine_similarity;
use crate::database::Repository;
use crate::error::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Feedback sentiment for a single article.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackSentiment {
    Like,
    Dislike,
}

impl FeedbackSentiment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Like => "like",
            Self::Dislike => "dislike",
        }
    }
}

/// A persisted preference cluster. `sum` is the weighted vector sum; the
/// centroid is `sum / weight` (unit-normalized on load for cosine).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferenceCluster {
    pub id: i64,
    pub sentiment: String,
    #[serde(with = "vec_f32_b64")]
    pub sum: Vec<f32>,
    pub weight: f64,
    pub last_updated: i64,
    pub exemplar_article_id: String,
    pub exemplar_title: String,
    pub dim: i32,
    pub model: String,
}

mod vec_f32_b64 {
    use base64::Engine as _;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &Vec<f32>, s: S) -> Result<S::Ok, S::Error> {
        let bytes: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
        s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<f32>, D::Error> {
        let s = String::deserialize(d)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s)
            .map_err(serde::de::Error::custom)?;
        Ok(bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect())
    }
}

/// Profile surfaced to the UI: cluster metadata (no raw vectors needed by TS)
/// plus the total weight used for cold-start gating.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferenceProfile {
    pub positive_weight: f64,
    pub negative_weight: f64,
    pub clusters: Vec<PreferenceCluster>,
    /// Minimum total feedback weight before semantic scoring activates.
    pub cold_start_threshold: f64,
}

/// Per-item semantic score result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticScore {
    pub item_id: String,
    /// 0..1 (0.5 neutral). `None` when the item has no usable embedding or
    /// the profile is below the cold-start threshold.
    pub score: Option<f64>,
    /// Exemplar title of the cluster that drove the score (explainability).
    pub driver_exemplar_title: Option<String>,
    pub driver_sentiment: Option<String>,
}

// ── Tunables ────────────────────────────────────────────────────────────────

/// Feedback older than this loses half its influence.
pub const DECAY_HALF_LIFE_DAYS: f64 = 45.0;
/// Cosine ≥ this merges the feedback into the nearest same-sentiment cluster.
pub const MERGE_SIMILARITY_THRESHOLD: f32 = 0.62;
/// Max clusters per sentiment; overflow merges the two weakest.
pub const MAX_CLUSTERS_PER_SENTIMENT: usize = 8;
/// Weight of a single explicit thumbs feedback event.
pub const FEEDBACK_EVENT_WEIGHT: f64 = 1.0;
/// Total profile weight below which semantic scoring stays off (cold start).
pub const COLD_START_THRESHOLD: f64 = 1.5;

pub fn decay_factor(days: f64) -> f64 {
    0.5f64.powf(days / DECAY_HALF_LIFE_DAYS)
}

fn centroid_of(cluster: &PreferenceCluster) -> Vec<f32> {
    if cluster.weight <= 0.0 {
        return Vec::new();
    }
    cluster
        .sum
        .iter()
        .map(|v| v / cluster.weight as f32)
        .collect()
}

/// Pure cluster-set update for one feedback vector. Existing clusters are
/// decayed to `now` first (lazy decay), then the vector merges into the
/// nearest same-sentiment cluster above the threshold or spawns a new one.
pub fn update_clusters(
    mut clusters: Vec<PreferenceCluster>,
    sentiment: FeedbackSentiment,
    vector: &[f32],
    exemplar_article_id: &str,
    exemplar_title: &str,
    model: &str,
    now: DateTime<Utc>,
) -> Vec<PreferenceCluster> {
    if vector.is_empty() {
        return clusters;
    }
    let now_ms = now.timestamp_millis();
    let dim = vector.len() as i32;
    let sentiment_str = sentiment.as_str();

    // Lazy-decay this sentiment's clusters to `now`.
    for cluster in clusters.iter_mut().filter(|c| c.sentiment == sentiment_str) {
        let age_days =
            (now_ms - cluster.last_updated).max(0) as f64 / (86_400_000.0);
        let factor = decay_factor(age_days);
        cluster.weight *= factor;
        for v in cluster.sum.iter_mut() {
            *v *= factor as f32;
        }
        cluster.last_updated = now_ms;
    }

    let same: Vec<usize> = clusters
        .iter()
        .enumerate()
        .filter(|(_, c)| c.sentiment == sentiment_str && c.dim == dim)
        .map(|(i, _)| i)
        .collect();

    // Find nearest surviving cluster by cosine to its centroid.
    let mut best: Option<(usize, f32)> = None;
    for &i in &same {
        let centroid = centroid_of(&clusters[i]);
        if centroid.is_empty() {
            continue;
        }
        let sim = cosine_similarity(vector, &centroid);
        if sim.is_finite() && sim >= MERGE_SIMILARITY_THRESHOLD {
            if best.map(|(_, s)| sim > s).unwrap_or(true) {
                best = Some((i, sim));
            }
        }
    }

    match best {
        Some((index, _)) => {
            for (i, v) in vector.iter().enumerate() {
                clusters[index].sum[i] += v * FEEDBACK_EVENT_WEIGHT as f32;
            }
            clusters[index].weight += FEEDBACK_EVENT_WEIGHT;
            // Keep the exemplar fresh: the most recent driving article.
            clusters[index].exemplar_article_id = exemplar_article_id.to_string();
            clusters[index].exemplar_title = exemplar_title.to_string();
        }
        None => {
            clusters.push(PreferenceCluster {
                id: 0,
                sentiment: sentiment_str.to_string(),
                sum: vector.iter().map(|v| v * FEEDBACK_EVENT_WEIGHT as f32).collect(),
                weight: FEEDBACK_EVENT_WEIGHT,
                last_updated: now_ms,
                exemplar_article_id: exemplar_article_id.to_string(),
                exemplar_title: exemplar_title.to_string(),
                dim,
                model: model.to_string(),
            });
        }
    }

    // Drop fully-decayed husks and enforce the cap by merging the weakest.
    clusters.retain(|c| !(c.sentiment == sentiment_str && c.weight < 0.05));
    let survivors: Vec<usize> = clusters
        .iter()
        .enumerate()
        .filter(|(_, c)| c.sentiment == sentiment_str)
        .map(|(i, _)| i)
        .collect();
    if survivors.len() > MAX_CLUSTERS_PER_SENTIMENT {
        // Merge the two weakest into the stronger of the pair.
        let mut by_weight: Vec<usize> = survivors;
        by_weight.sort_by(|&a, &b| {
            clusters[a]
                .weight
                .partial_cmp(&clusters[b].weight)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let (weak_a, weak_b) = (by_weight[0], by_weight[1]);
        let (target, source) = if clusters[weak_a].weight >= clusters[weak_b].weight {
            (weak_a, weak_b)
        } else {
            (weak_b, weak_a)
        };
        let source_sum = clusters[source].sum.clone();
        let source_weight = clusters[source].weight;
        for (i, v) in source_sum.iter().enumerate() {
            if i < clusters[target].sum.len() {
                clusters[target].sum[i] += v;
            }
        }
        clusters[target].weight += source_weight;
        clusters.swap_remove(source);
    }

    clusters
}

/// Semantic score for one item against both sentiment cluster sets.
/// Returns `(score, driver)` where driver is the strongest contributing
/// cluster's exemplar title + sentiment.
pub fn score_vector(
    vector: &[f32],
    clusters: &[PreferenceCluster],
    now: DateTime<Utc>,
) -> (Option<f64>, Option<(String, String)>) {
    let total_weight: f64 = clusters.iter().map(|c| c.weight).sum();
    if total_weight < COLD_START_THRESHOLD || vector.is_empty() {
        return (None, None);
    }

    let now_ms = now.timestamp_millis();
    let mut positive = 0.0f64;
    let mut negative = 0.0f64;
    let mut driver: Option<(f64, String, String)> = None;

    for cluster in clusters {
        if cluster.dim as usize != vector.len() {
            continue;
        }
        let centroid = centroid_of(cluster);
        if centroid.is_empty() {
            continue;
        }
        // Weight already decays lazily on write; read-side decay is a cheap
        // approximation for clusters untouched since their last update.
        let age_days = (now_ms - cluster.last_updated).max(0) as f64 / 86_400_000.0;
        let effective_weight = cluster.weight * decay_factor(age_days);
        // Only POSITIVE similarity carries meaning for either sentiment:
        // like-cluster similarity boosts, dislike-cluster similarity
        // penalizes, and anti-similarity (opposite of a disliked topic) is
        // neutral — treating it as a penalty would invert the signal.
        let sim = cosine_similarity(vector, &centroid).clamp(0.0, 1.0) as f64;
        let contribution = effective_weight * sim;
        if cluster.sentiment == "like" {
            positive += contribution;
        } else {
            negative += contribution;
        }
        if driver
            .as_ref()
            .map(|(m, _, _)| contribution > *m)
            .unwrap_or(contribution > 0.0)
        {
            driver = Some((
                contribution,
                cluster.exemplar_title.clone(),
                cluster.sentiment.clone(),
            ));
        }
    }

    let denom = total_weight.max(1.0);
    let score = 0.5 + 0.5 * ((positive - negative) / denom).clamp(-1.0, 1.0);
    let driver = driver.filter(|(m, _, _)| *m > 0.0).map(|(_, t, s)| (t, s));
    (Some(score), driver)
}

// ── Persistence ─────────────────────────────────────────────────────────────

fn bytes_to_sum(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn sum_to_bytes(sum: &[f32]) -> Vec<u8> {
    sum.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Apply one feedback event: upsert the article row, then update clusters with
/// the article's embedding (from `queue_item_embeddings`, already ensured by
/// the caller). `sentiment = None` removes the feedback (undo) and rebuilds.
pub async fn apply_feedback(
    repo: &Repository,
    article_id: &str,
    sentiment: Option<FeedbackSentiment>,
    embedding: Option<&Vec<f32>>,
    model: &str,
) -> Result<()> {
    let now = Utc::now();
    match sentiment {
        Some(s) => {
            let title = repo
                .get_rss_article_title(article_id)
                .await
                .unwrap_or_default();
            repo.upsert_rss_article_feedback(article_id, s.as_str(), now).await?;
            if let Some(vector) = embedding.filter(|v| !v.is_empty()) {
                let clusters = repo.get_rss_preference_clusters(Some(s.as_str())).await?;
                let updated = update_clusters(
                    clusters,
                    s,
                    vector,
                    article_id,
                    &title,
                    model,
                    now,
                );
                repo.replace_rss_preference_clusters(s.as_str(), &updated).await?;
            }
        }
        None => {
            repo.delete_rss_article_feedback(article_id).await?;
            rebuild(repo).await?;
        }
    }
    Ok(())
}

/// Deterministically rebuild both cluster sets from the feedback table.
pub async fn rebuild(repo: &Repository) -> Result<()> {
    let feedback = repo.get_all_rss_article_feedback().await?;
    let item_ids: Vec<String> = feedback.iter().map(|f| f.0.clone()).collect();
    let embeddings = repo.get_embeddings_for_items(&item_ids).await?;
    let by_id: std::collections::HashMap<String, Vec<f32>> = embeddings
        .into_iter()
        .map(|e| (e.item_id, e.embedding))
        .collect();

    let mut clusters: Vec<PreferenceCluster> = Vec::new();
    let start = Utc::now() - chrono::Duration::days(3650);
    let mut cursor = start;
    for (article_id, sentiment_str, created_at, title) in feedback {
        let sentiment = match sentiment_str.as_str() {
            "like" => FeedbackSentiment::Like,
            _ => FeedbackSentiment::Dislike,
        };
        // Replay in chronological order with a synthetic clock so decay
        // between events is honored deterministically.
        let event_time = DateTime::from_timestamp_millis(created_at).unwrap_or(cursor);
        let replay_time = if event_time > cursor { event_time } else { cursor };
        cursor = replay_time;
        if let Some(vector) = by_id.get(&article_id) {
            clusters = update_clusters(
                clusters,
                sentiment,
                vector,
                &article_id,
                &title,
                "rebuild",
                replay_time,
            );
        }
    }
    repo.replace_rss_preference_clusters("like", &clusters.iter().filter(|c| c.sentiment == "like").cloned().collect::<Vec<_>>()).await?;
    repo.replace_rss_preference_clusters("dislike", &clusters.iter().filter(|c| c.sentiment == "dislike").cloned().collect::<Vec<_>>()).await?;
    Ok(())
}

/// Current profile for UI gating/explainability.
pub async fn profile(repo: &Repository) -> Result<PreferenceProfile> {
    let clusters = repo
        .get_rss_preference_clusters(None::<&str>)
        .await?;
    let positive_weight = clusters.iter().filter(|c| c.sentiment == "like").map(|c| c.weight).sum();
    let negative_weight = clusters.iter().filter(|c| c.sentiment == "dislike").map(|c| c.weight).sum();
    Ok(PreferenceProfile {
        positive_weight,
        negative_weight,
        clusters,
        cold_start_threshold: COLD_START_THRESHOLD,
    })
}

/// Score a batch of queue items against the current profile (Rust-side cosine;
/// vectors stay local).
pub async fn score_items(repo: &Repository, item_ids: &[String]) -> Result<Vec<SemanticScore>> {
    let clusters = repo
        .get_rss_preference_clusters(None::<&str>)
        .await?;
    let embeddings = repo.get_embeddings_for_items(item_ids).await?;
    let by_id: std::collections::HashMap<String, Vec<f32>> = embeddings
        .into_iter()
        .map(|e| (e.item_id, e.embedding))
        .collect();
    let now = Utc::now();
    Ok(item_ids
        .iter()
        .map(|id| {
            match by_id.get(id) {
                Some(vector) => {
                    let (score, driver) = score_vector(vector, &clusters, now);
                    SemanticScore {
                        item_id: id.clone(),
                        score,
                        driver_exemplar_title: driver.as_ref().map(|(t, _)| t.clone()),
                        driver_sentiment: driver.map(|(_, s)| s),
                    }
                }
                None => SemanticScore {
                    item_id: id.clone(),
                    score: None,
                    driver_exemplar_title: None,
                    driver_sentiment: None,
                },
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(dim: usize, angle_seed: f32) -> Vec<f32> {
        // Deterministic pseudo-random unit vector: rotate a fixed basis.
        let mut v = vec![0.0f32; dim];
        for i in 0..dim {
            v[i] = ((i as f32 * 0.37 + angle_seed).sin() * 0.5
                + (i as f32 * 0.11 + angle_seed).cos() * 0.5) as f32;
        }
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
        v.iter().map(|x| x / norm).collect()
    }

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    #[test]
    fn feedback_merges_into_nearest_cluster_and_grows_weight() {
        let a = unit(8, 0.0);
        let b = unit(8, 0.0); // identical direction → same cluster
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &a, "r1", "T1", "m", now());
        let clusters = update_clusters(clusters, FeedbackSentiment::Like, &b, "r2", "T2", "m", now());
        assert_eq!(clusters.len(), 1);
        assert!((clusters[0].weight - 2.0 * FEEDBACK_EVENT_WEIGHT).abs() < 1e-6);
        assert_eq!(clusters[0].exemplar_article_id, "r2");
    }

    #[test]
    fn dissimilar_feedback_spawns_new_cluster() {
        let a = unit(8, 0.0);
        let b = unit(8, 3.1); // near-orthogonal
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &a, "r1", "T1", "m", now());
        let clusters = update_clusters(clusters, FeedbackSentiment::Like, &b, "r2", "T2", "m", now());
        assert_eq!(clusters.len(), 2);
    }

    #[test]
    fn sentiments_do_not_share_clusters() {
        let a = unit(8, 0.0);
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &a, "r1", "T1", "m", now());
        let clusters = update_clusters(clusters, FeedbackSentiment::Dislike, &a, "r2", "T2", "m", now());
        assert_eq!(clusters.len(), 2);
        assert!(clusters.iter().any(|c| c.sentiment == "dislike"));
    }

    #[test]
    fn cluster_count_is_capped() {
        let mut clusters = Vec::new();
        for i in 0..(MAX_CLUSTERS_PER_SENTIMENT + 4) {
            let v = unit(8, i as f32 * 0.9);
            clusters = update_clusters(clusters, FeedbackSentiment::Like, &v, &format!("r{i}"), "T", "m", now());
        }
        let count = clusters.iter().filter(|c| c.sentiment == "like").count();
        assert!(count <= MAX_CLUSTERS_PER_SENTIMENT, "got {count}");
    }

    #[test]
    fn decay_reduces_old_influence() {
        let a = unit(8, 0.0);
        let old = now() - chrono::Duration::days(DECAY_HALF_LIFE_DAYS as i64);
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &a, "r1", "T1", "m", old);
        // One half-life later the weight should be halved (± fresh-event math).
        let clusters = update_clusters(clusters, FeedbackSentiment::Like, &a, "r2", "T2", "m", now());
        let expected = decay_factor(DECAY_HALF_LIFE_DAYS) * FEEDBACK_EVENT_WEIGHT + FEEDBACK_EVENT_WEIGHT;
        assert!((clusters[0].weight - expected).abs() < 1e-6);
    }

    #[test]
    fn scoring_is_cold_start_gated() {
        let v = unit(8, 0.0);
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &v, "r1", "T1", "m", now());
        let (score, _) = score_vector(&v, &clusters, now());
        assert!(score.is_none(), "single event must stay below cold start");
    }

    #[test]
    fn liked_topic_scores_high_disliked_low() {
        let topic = unit(8, 0.0);
        let other = unit(8, 3.1);
        let mut clusters = Vec::new();
        for i in 0..3 {
            clusters = update_clusters(clusters, FeedbackSentiment::Like, &topic, &format!("l{i}"), "Liked", "m", now());
            clusters = update_clusters(clusters, FeedbackSentiment::Dislike, &other, &format!("d{i}"), "Disliked", "m", now());
        }
        let (liked, driver) = score_vector(&topic, &clusters, now());
        let (disliked, _) = score_vector(&other, &clusters, now());
        let liked = liked.expect("above cold start");
        let disliked = disliked.expect("above cold start");
        assert!(liked > 0.6, "liked topic should score high, got {liked}");
        assert!(disliked < 0.4, "disliked topic should score low, got {disliked}");
        assert_eq!(driver.map(|(t, _)| t), Some("Liked".to_string()));
    }

    #[test]
    fn empty_vector_and_mismatched_dims_are_ignored() {
        let v = unit(8, 0.0);
        let clusters = update_clusters(Vec::new(), FeedbackSentiment::Like, &v, "r1", "T1", "m", now());
        let (score, _) = score_vector(&[], &clusters, now());
        assert!(score.is_none());
        let (score, _) = score_vector(&unit(16, 0.0), &clusters, now());
        assert!(score.is_none());
    }
}
