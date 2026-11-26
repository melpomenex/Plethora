//! Token-aware, sentence/paragraph-preserving passage chunking and
//! feed-conditioned dual (positive + negative/contradictory) passage retrieval.

use super::laya_budget::LayaTokenizer;
use super::models::ContentProvenance;
use super::normalize::{sha256_hex, ArticleSnapshot};
use super::retrieval::{extract_phrases, same_space_cosine, tokenize_stems, ArticleVectorRef, FeedQueryProfile};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const CHUNKER_VERSION: &str = "passage-v1";
pub const DEFAULT_PASSAGE_TARGET_TOKENS: usize = 420;
pub const DEFAULT_PASSAGE_OVERLAP_TOKENS: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticlePassage {
    pub id: String,
    pub article_id: String,
    pub content_hash: String,
    pub passage_index: usize,
    pub start_char: usize,
    pub end_char: usize,
    pub section_heading: Option<String>,
    pub token_count: usize,
    pub text: String,
    pub provenance: ContentProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PassageRole {
    Lead,
    Supporting,
    Contradictory,
}

#[derive(Debug, Clone)]
pub struct RetrievedPassage {
    pub passage: ArticlePassage,
    pub positive_score: f64,
    pub negative_score: f64,
    pub combined_score: f64,
    pub role: PassageRole,
}

/// Split an `ArticleSnapshot` into deterministic, Unicode-safe, token-bounded
/// passages preserving section headings, paragraph breaks, and sentence boundaries.
pub fn chunk_article_snapshot(
    snapshot: &ArticleSnapshot,
    tok: &LayaTokenizer,
    target_tokens: usize,
    overlap_tokens: usize,
) -> Vec<ArticlePassage> {
    let source_text = if !snapshot.structured_body_text.trim().is_empty() {
        snapshot.structured_body_text.as_str()
    } else if !snapshot.best_text.trim().is_empty() {
        snapshot.best_text.as_str()
    } else {
        snapshot.summary_text.as_str()
    };

    let trimmed = source_text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let target = target_tokens.clamp(120, 720);
    let overlap = overlap_tokens.min(target / 3);

    // Split into (section_heading, paragraph_text, start_char, end_char)
    let mut blocks: Vec<(Option<String>, String, usize, usize)> = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut cursor = 0usize;

    for raw_para in trimmed.split("\n\n") {
        let para = raw_para.trim();
        let para_len_chars = para.chars().count();
        let start_char = cursor;
        let end_char = cursor + para_len_chars;
        cursor = end_char + 2; // "\n\n"

        if para.is_empty() {
            continue;
        }
        if let Some(heading_body) = para.strip_prefix("## ") {
            let h = heading_body.trim();
            if !h.is_empty() {
                current_heading = Some(h.to_string());
            }
            continue;
        }
        blocks.push((current_heading.clone(), para.to_string(), start_char, end_char));
    }

    if blocks.is_empty() {
        // E.g. heading-only text
        let token_count = tok.count_tokens(trimmed);
        return vec![ArticlePassage {
            id: sha256_hex(&[&snapshot.article_id, &snapshot.content_hash, "0"]),
            article_id: snapshot.article_id.clone(),
            content_hash: snapshot.content_hash.clone(),
            passage_index: 0,
            start_char: 0,
            end_char: trimmed.chars().count(),
            section_heading: current_heading,
            token_count,
            text: trimmed.to_string(),
            provenance: snapshot.content_provenance,
        }];
    }

    // Expand any oversized paragraph (> target tokens) into sentence pieces
    let mut units: Vec<(Option<String>, String, usize, usize)> = Vec::new();
    for (heading, para, start_c, end_c) in blocks {
        if tok.count_tokens(&para) <= target {
            units.push((heading, para, start_c, end_c));
        } else {
            let sentences = split_sentences_with_offsets(&para, start_c);
            for (s_text, s_start, s_end) in sentences {
                if tok.count_tokens(&s_text) <= target {
                    units.push((heading.clone(), s_text, s_start, s_end));
                } else {
                    // Hard token-safe split for giant run-on text without punctuation
                    let mut rest = s_text.as_str();
                    let mut cur_c = s_start;
                    while !rest.is_empty() {
                        let piece = tok.truncate_to_tokens(rest, target);
                        let piece_len_bytes = piece.len().max(1);
                        let piece_chars = piece.chars().count();
                        let actual_piece = if piece.is_empty() {
                            let ch = rest.chars().next().unwrap();
                            let l = ch.len_utf8();
                            let s = &rest[..l];
                            rest = &rest[l..];
                            s.to_string()
                        } else {
                            let next_rest = rest[piece_len_bytes..].trim_start();
                            rest = next_rest;
                            piece
                        };
                        let piece_end = (cur_c + piece_chars).min(end_c);
                        units.push((heading.clone(), actual_piece, cur_c, piece_end));
                        cur_c = piece_end;
                    }
                }
            }
        }
    }

    // Group units into passages up to `target` tokens with sentence overlap
    let mut passages: Vec<ArticlePassage> = Vec::new();
    let mut cur_parts: Vec<String> = Vec::new();
    let mut cur_heading: Option<String> = None;
    let mut cur_start: usize = 0;
    let mut cur_end: usize = 0;
    let mut cur_tokens: usize = 0;

    for (u_heading, u_text, u_start, u_end) in units {
        let u_tokens = tok.count_tokens(&u_text);
        let heading_changed = !cur_parts.is_empty() && u_heading != cur_heading;
        let would_overflow = !cur_parts.is_empty() && (cur_tokens + u_tokens + 2 > target);

        if heading_changed || would_overflow {
            let text = cur_parts.join("\n\n");
            let idx = passages.len();
            let token_count = tok.count_tokens(&text);
            passages.push(ArticlePassage {
                id: sha256_hex(&[&snapshot.article_id, &snapshot.content_hash, &idx.to_string()]),
                article_id: snapshot.article_id.clone(),
                content_hash: snapshot.content_hash.clone(),
                passage_index: idx,
                start_char: cur_start,
                end_char: cur_end,
                section_heading: cur_heading.clone(),
                token_count,
                text,
                provenance: snapshot.content_provenance,
            });

            // Carry overlap from trailing sentence/unit if same heading
            let mut next_parts = Vec::new();
            let mut next_tokens = 0usize;
            let mut next_start = u_start;
            if !heading_changed && overlap > 0 {
                if let Some(last) = cur_parts.last() {
                    let tail = last_sentence_within_tokens(last, tok, overlap);
                    if !tail.is_empty() {
                        let t_tok = tok.count_tokens(&tail);
                        if t_tok + u_tokens <= target {
                            next_parts.push(tail);
                            next_tokens = t_tok;
                            next_start = cur_end.saturating_sub(overlap * 4).max(cur_start);
                        }
                    }
                }
            }
            cur_parts = next_parts;
            cur_tokens = next_tokens;
            cur_start = next_start;
            cur_heading = u_heading.clone();
            cur_end = u_end;
        }

        if cur_parts.is_empty() {
            cur_heading = u_heading;
            cur_start = u_start;
        }
        cur_parts.push(u_text);
        cur_tokens += u_tokens + 1;
        cur_end = u_end;
    }

    if !cur_parts.is_empty() {
        let text = cur_parts.join("\n\n");
        let idx = passages.len();
        let token_count = tok.count_tokens(&text);
        passages.push(ArticlePassage {
            id: sha256_hex(&[&snapshot.article_id, &snapshot.content_hash, &idx.to_string()]),
            article_id: snapshot.article_id.clone(),
            content_hash: snapshot.content_hash.clone(),
            passage_index: idx,
            start_char: cur_start,
            end_char: cur_end,
            section_heading: cur_heading,
            token_count,
            text,
            provenance: snapshot.content_provenance,
        });
    }

    passages
}

fn split_sentences_with_offsets(text: &str, base_char_offset: usize) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let mut start_byte = 0usize;
    let mut start_char = base_char_offset;
    let mut char_idx = 0usize;
    let mut prev_was_end = false;

    for (byte_idx, ch) in text.char_indices() {
        if prev_was_end && ch.is_whitespace() {
            let slice = text[start_byte..byte_idx].trim();
            if !slice.is_empty() {
                out.push((
                    slice.to_string(),
                    start_char,
                    base_char_offset + char_idx,
                ));
            }
            start_byte = byte_idx + ch.len_utf8();
            start_char = base_char_offset + char_idx + 1;
        }
        prev_was_end = matches!(ch, '.' | '!' | '?' | '。' | '！' | '？');
        char_idx += 1;
    }
    let tail = text[start_byte..].trim();
    if !tail.is_empty() {
        out.push((tail.to_string(), start_char, base_char_offset + char_idx));
    }
    out
}

fn last_sentence_within_tokens(text: &str, tok: &LayaTokenizer, max_tokens: usize) -> String {
    let sentences = split_sentences_with_offsets(text, 0);
    if let Some((last, _, _)) = sentences.last() {
        if tok.count_tokens(last) <= max_tokens {
            return last.clone();
        }
        return tok.truncate_to_tokens(last, max_tokens);
    }
    String::new()
}

fn passage_jaccard(a: &str, b: &str) -> f64 {
    let sa: HashSet<String> = tokenize_stems(a).into_iter().collect();
    let sb: HashSet<String> = tokenize_stems(b).into_iter().collect();
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let inter = sa.intersection(&sb).count();
    let union = sa.union(&sb).count();
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

/// Feed-conditioned dual passage retrieval: selects diverse supporting passages,
/// contradictory/exclusion passages, and the lead passage.
pub fn retrieve_passages_for_feed(
    profile: &FeedQueryProfile,
    passages: &[ArticlePassage],
    passage_vectors: &[Option<ArticleVectorRef<'_>>],
    max_passages: usize,
) -> Vec<RetrievedPassage> {
    if passages.is_empty() || max_passages == 0 {
        return Vec::new();
    }

    let mut scored: Vec<RetrievedPassage> = passages
        .iter()
        .enumerate()
        .map(|(idx, passage)| {
            let p_stems: HashSet<String> = tokenize_stems(&passage.text).into_iter().collect();
            let p_phrases: HashSet<String> = extract_phrases(&passage.text).into_iter().collect();
            let heading_stems: HashSet<String> = passage
                .section_heading
                .as_deref()
                .map(|h| tokenize_stems(h).into_iter().collect())
                .unwrap_or_default();

            let mut pos_lex = 0.0f64;
            for (stem, &w) in &profile.positive_stems {
                if p_stems.contains(stem) {
                    pos_lex += w * 0.75;
                }
                if heading_stems.contains(stem) {
                    pos_lex += w * 0.55;
                }
            }
            for phrase in &profile.positive_phrases {
                if p_phrases.contains(phrase) {
                    pos_lex += 0.60;
                }
            }
            let pos_lex_norm = (1.0 - (-pos_lex / 2.6).exp()).clamp(0.0, 1.0);

            let mut neg_lex = 0.0f64;
            for stem in &profile.negative_stems {
                if p_stems.contains(stem) {
                    neg_lex += 0.75;
                }
                if heading_stems.contains(stem) {
                    neg_lex += 0.50;
                }
            }
            for phrase in &profile.negative_phrases {
                if p_phrases.contains(phrase) {
                    neg_lex += 0.90;
                }
            }
            let neg_lex_norm = (1.0 - (-neg_lex / 1.8).exp()).clamp(0.0, 1.0);

            let vec_ref = passage_vectors.get(idx).and_then(|v| v.as_ref());
            let pos_sem = same_space_cosine(vec_ref, profile.positive_embedding.as_ref())
                .map(|s| ((s - 0.16) / 0.58).clamp(0.0, 1.0));
            let neg_sem = same_space_cosine(vec_ref, profile.negative_embedding.as_ref())
                .map(|s| ((s - 0.20) / 0.52).clamp(0.0, 1.0));

            let lead_bonus = if passage.passage_index == 0 { 0.08 } else { 0.0 };
            let positive_score = match pos_sem {
                Some(sem) => (0.55 * sem + 0.45 * pos_lex_norm + lead_bonus).clamp(0.0, 1.0),
                None => (pos_lex_norm + lead_bonus).clamp(0.0, 1.0),
            };
            let negative_score = match neg_sem {
                Some(sem) => (0.50 * sem + 0.50 * neg_lex_norm).clamp(0.0, 1.0),
                None => neg_lex_norm,
            };

            let role = if negative_score > positive_score && negative_score >= 0.22 {
                PassageRole::Contradictory
            } else if passage.passage_index == 0 {
                PassageRole::Lead
            } else {
                PassageRole::Supporting
            };

            RetrievedPassage {
                passage: passage.clone(),
                positive_score,
                negative_score,
                combined_score: positive_score.max(negative_score),
                role,
            }
        })
        .collect();

    let mut selected: Vec<RetrievedPassage> = Vec::with_capacity(max_passages);
    let mut used_indices: HashSet<usize> = HashSet::new();

    let is_diverse = |candidate: &RetrievedPassage, chosen: &[RetrievedPassage]| -> bool {
        chosen
            .iter()
            .all(|c| passage_jaccard(&c.passage.text, &candidate.passage.text) < 0.72)
    };

    // 1. Always consider the strongest positive passage first
    scored.sort_by(|a, b| {
        b.positive_score
            .partial_cmp(&a.positive_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if let Some(best_pos) = scored.first().cloned() {
        used_indices.insert(best_pos.passage.passage_index);
        selected.push(best_pos);
    }

    // 2. Include strongest contradictory/exclusion passage if meaningful & diverse
    if selected.len() < max_passages {
        if let Some(best_neg) = scored
            .iter()
            .filter(|p| {
                !used_indices.contains(&p.passage.passage_index)
                    && p.negative_score >= 0.15
                    && is_diverse(p, &selected)
            })
            .max_by(|a, b| {
                a.negative_score
                    .partial_cmp(&b.negative_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned()
        {
            used_indices.insert(best_neg.passage.passage_index);
            selected.push(RetrievedPassage {
                role: PassageRole::Contradictory,
                ..best_neg
            });
        }
    }

    // 3. Include Lead passage (index 0) for global context if not yet included
    if selected.len() < max_passages && !used_indices.contains(&0) {
        if let Some(lead) = scored
            .iter()
            .find(|p| p.passage.passage_index == 0 && is_diverse(p, &selected))
            .cloned()
        {
            used_indices.insert(0);
            selected.push(RetrievedPassage {
                role: PassageRole::Lead,
                ..lead
            });
        }
    }

    // 4. Fill remaining slots with highest combined/positive diverse passages
    for cand in &scored {
        if selected.len() >= max_passages {
            break;
        }
        if !used_indices.contains(&cand.passage.passage_index) && is_diverse(cand, &selected) {
            used_indices.insert(cand.passage.passage_index);
            selected.push(cand.clone());
        }
    }

    // Sort selected back into document reading order for coherent aggregation/explanations
    selected.sort_by_key(|p| p.passage.passage_index);
    selected
}
