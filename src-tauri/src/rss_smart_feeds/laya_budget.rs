//! Token-aware Laya Typed Decisions context budgeting and tokenizer wrapper.
//!
//! Mirrors the exact sequence encoding of `laya==0.5.2` (`laya/common.py`):
//! `[CLS] <type> question: <instructions> [SEP] [MASK] <opt0> ... [SEP] <state> [SEP]`
//! where `max_len = 1024`, `head_max_len = 256`, and each question's state room
//! is `max_len - head_len(q) - 1`.

use super::models::{CurationStrictness, SmartFeed};
use super::normalize::sanitize_untrusted_for_prompt;
use crate::models::hf::laya_catalog::{TYPED_DECISIONS_REPO, TYPED_DECISIONS_REVISION};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokenizers::Tokenizer;

pub const LAYA_DEFAULT_MODEL_NAME: &str = "typed-decisions";
pub const LAYA_DEFAULT_MAX_LEN: usize = 1024;
pub const LAYA_DEFAULT_HEAD_MAX_LEN: usize = 256;
pub const LAYA_SAFETY_MARGIN: usize = 8;
pub const LAYA_OPTION_MAX_TOKENS: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayaBudgetConfig {
    pub model_name: String,
    pub max_len: usize,
    pub head_max_len: usize,
    pub safety_margin: usize,
}

impl Default for LayaBudgetConfig {
    fn default() -> Self {
        Self {
            model_name: LAYA_DEFAULT_MODEL_NAME.to_string(),
            max_len: LAYA_DEFAULT_MAX_LEN,
            head_max_len: LAYA_DEFAULT_HEAD_MAX_LEN,
            safety_margin: LAYA_SAFETY_MARGIN,
        }
    }
}

/// Wrapper around HuggingFace `tokenizers::Tokenizer` loaded from the active
/// Laya checkpoint's `tokenizer/tokenizer.json`, with a deterministic fallback
/// estimator when no local checkpoint is installed.
#[derive(Clone)]
pub struct LayaTokenizer {
    inner: Option<Arc<Tokenizer>>,
}

static GLOBAL_LAYA_TOKENIZER: OnceLock<LayaTokenizer> = OnceLock::new();

impl LayaTokenizer {
    pub fn fallback() -> Self {
        Self { inner: None }
    }

    pub fn from_file(path: &Path) -> Result<Self, String> {
        let tok = Tokenizer::from_file(path)
            .map_err(|e| format!("Failed to load Laya tokenizer at {}: {e}", path.display()))?;
        Ok(Self {
            inner: Some(Arc::new(tok)),
        })
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let tok = Tokenizer::from_bytes(bytes)
            .map_err(|e| format!("Failed to parse Laya tokenizer bytes: {e}"))?;
        Ok(Self {
            inner: Some(Arc::new(tok)),
        })
    }

    /// Discover the local `tokenizer/tokenizer.json` from the standard Plethora
    /// Laya model directory, caching it process-wide.
    pub fn discover_global() -> Self {
        GLOBAL_LAYA_TOKENIZER
            .get_or_init(|| {
                if let Some(path) = find_local_laya_tokenizer_path() {
                    if let Ok(tok) = Self::from_file(&path) {
                        return tok;
                    }
                }
                Self::fallback()
            })
            .clone()
    }

    pub fn is_exact(&self) -> bool {
        self.inner.is_some()
    }

    /// Count tokens without special tokens (`add_special_tokens=False`), matching
    /// `laya.common.encode_text(tok, text, add_special_tokens=False)`.
    pub fn count_tokens(&self, text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }
        if let Some(tok) = &self.inner {
            let cleaned = text.replace("[MASK]", " ");
            if let Ok(enc) = tok.encode(cleaned, false) {
                return enc.len();
            }
        }
        estimate_tokens_fallback(text)
    }

    /// Truncate `text` to at most `max_tokens` tokens cleanly on a valid UTF-8
    /// character boundary (preferring word/sentence boundaries when close).
    pub fn truncate_to_tokens(&self, text: &str, max_tokens: usize) -> String {
        if max_tokens == 0 || text.is_empty() {
            return String::new();
        }
        if self.count_tokens(text) <= max_tokens {
            return text.to_string();
        }
        if let Some(tok) = &self.inner {
            let cleaned = text.replace("[MASK]", " ");
            if let Ok(enc) = tok.encode(cleaned.as_str(), false) {
                let offsets = enc.get_offsets();
                if offsets.len() > max_tokens {
                    let byte_end = offsets[max_tokens - 1].1.min(cleaned.len());
                    let mut safe_end = byte_end;
                    while safe_end > 0 && !cleaned.is_char_boundary(safe_end) {
                        safe_end -= 1;
                    }
                    let slice = &cleaned[..safe_end];
                    if let Some(space_idx) = slice.rfind(' ') {
                        if space_idx > safe_end * 2 / 3 {
                            return slice[..space_idx].trim_end().to_string();
                        }
                    }
                    return slice.trim_end().to_string();
                }
            }
        }
        // Fallback binary search on char indices using estimator
        let chars: Vec<(usize, char)> = text.char_indices().collect();
        let mut lo = 0usize;
        let mut hi = chars.len();
        while lo < hi {
            let mid = (lo + hi + 1) / 2;
            let byte_end = if mid == chars.len() {
                text.len()
            } else {
                chars[mid].0
            };
            if self.count_tokens(&text[..byte_end]) <= max_tokens {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let end_byte = if lo == chars.len() {
            text.len()
        } else {
            chars[lo].0
        };
        text[..end_byte].trim_end().to_string()
    }
}

/// Conservative deterministic fallback estimator (~3.2 chars/token + punctuation/CJK
/// awareness) used only when `tokenizer.json` is not on disk.
fn estimate_tokens_fallback(text: &str) -> usize {
    let mut est = 0usize;
    let mut ascii_run = 0usize;
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_run += 1;
        } else {
            if ascii_run > 0 {
                est += (ascii_run + 3) / 4;
                ascii_run = 0;
            }
            if !ch.is_whitespace() {
                est += 1;
            }
        }
    }
    if ascii_run > 0 {
        est += (ascii_run + 3) / 4;
    }
    est.max(1)
}

fn find_local_laya_tokenizer_path() -> Option<PathBuf> {
    let sanitized_repo = TYPED_DECISIONS_REPO.replace('/', "_");
    let dir_name = format!("{sanitized_repo}@{TYPED_DECISIONS_REVISION}");
    let mut candidates = Vec::new();
    if let Some(data_dir) = dirs::data_local_dir() {
        candidates.push(
            data_dir
                .join("com.plethora.app")
                .join("models")
                .join("laya")
                .join(&dir_name)
                .join("tokenizer")
                .join("tokenizer.json"),
        );
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join(".local/share/com.plethora.app/models/laya")
                .join(&dir_name)
                .join("tokenizer")
                .join("tokenizer.json"),
        );
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Exact head length computation mirroring `laya.common.build_head`.
pub fn compute_question_head_tokens(
    tok: &LayaTokenizer,
    q_type: &str,
    instructions: &str,
    option_texts: &[String],
    head_max_len: usize,
) -> usize {
    let mut opt_lens: Vec<usize> = option_texts
        .iter()
        .map(|opt| 1 + tok.count_tokens(&format!(" {opt}")).min(LAYA_OPTION_MAX_TOKENS))
        .collect();

    let mut opt_budget = head_max_len as isize - opt_lens.iter().sum::<usize>() as isize;
    if opt_budget < 16 {
        let per = ((head_max_len.saturating_sub(16)) / opt_lens.len().max(1)).max(4);
        for l in &mut opt_lens {
            *l = (*l).min(per);
        }
        opt_budget = head_max_len as isize - opt_lens.iter().sum::<usize>() as isize;
    }

    let ins_raw_len = tok.count_tokens(&format!("{q_type} question: {instructions}"));
    let ins_capped = ins_raw_len.min((opt_budget.max(8)) as usize);
    // [CLS] + head_ids + [SEP] + sum(opt_ids) + [SEP]
    1 + ins_capped + 1 + opt_lens.iter().sum::<usize>() + 1
}

#[derive(Debug, Clone)]
pub struct CompactQuestionSet {
    pub questions_json: serde_json::Value,
    pub max_head_tokens: usize,
    pub state_room: usize,
    pub criteria_compacted: bool,
}

/// Build compact, non-redundant question heads for Laya that preserve
/// inclusion and exclusion criteria inside `head_max_len = 256` without
/// duplicating 1,600-character boilerplate across every question.
pub fn build_compact_question_heads(
    tok: &LayaTokenizer,
    feed: &SmartFeed,
    cfg: &LayaBudgetConfig,
    include_centrality: bool,
) -> CompactQuestionSet {
    let feed_name = sanitize_untrusted_for_prompt(&feed.name, 80);
    let strictness = feed.curation_strictness.as_str();
    let incl_raw = sanitize_untrusted_for_prompt(&feed.inclusion_criteria, 400);
    let excl_raw = sanitize_untrusted_for_prompt(&feed.exclusion_criteria, 400);
    let desc_raw = sanitize_untrusted_for_prompt(&feed.description, 400);

    let mut criteria_compacted = false;

    // Reserve tokens for exclusions first so they are never silently dropped.
    let excl = if !excl_raw.is_empty() {
        let t = tok.truncate_to_tokens(&excl_raw, 48);
        if t.len() < excl_raw.len() {
            criteria_compacted = true;
        }
        t
    } else {
        String::new()
    };

    let incl = if !incl_raw.is_empty() {
        let t = tok.truncate_to_tokens(&incl_raw, 48);
        if t.len() < incl_raw.len() {
            criteria_compacted = true;
        }
        t
    } else {
        String::new()
    };

    let desc_budget = match (incl.is_empty(), excl.is_empty()) {
        (true, true) => 96,
        (false, true) | (true, false) => 64,
        (false, false) => 44,
    };
    let desc = if !desc_raw.is_empty() {
        let t = tok.truncate_to_tokens(&desc_raw, desc_budget);
        if t.len() < desc_raw.len() {
            criteria_compacted = true;
        }
        t
    } else {
        String::new()
    };

    let mut parts = vec![format!("Feed: {feed_name} ({strictness})")];
    if !incl.is_empty() {
        parts.push(format!("Include: {incl}"));
    }
    if !excl.is_empty() {
        parts.push(format!("Exclude: {excl}"));
    }
    if !desc.is_empty() {
        parts.push(format!("Topic: {desc}"));
    }
    let compact_context = parts.join(". ");

    let decision_ins = format!(
        "Classify whether this RSS article belongs in '{feed_name}'. {compact_context}"
    );
    let relevance_ins = format!(
        "Rate topical relevance to '{feed_name}'. {compact_context}"
    );
    let noul_ins = if excl.is_empty() {
        format!("Does this article substantively match '{feed_name}'? {compact_context}")
    } else {
        format!(
            "Does this article match '{feed_name}' without triggering exclusions ({excl})?"
        )
    };

    let decision_criteria = serde_json::json!({
        "INCLUDE": "Matches topic and inclusion criteria without hitting exclusions.",
        "UNCERTAIN": "Borderline, ambiguous, or insufficient evidence.",
        "EXCLUDE": "Off-topic or matches exclusion criteria."
    });
    let relevance_criteria = serde_json::json!([
        "off-topic",
        "incidental mention",
        "related",
        "on topic",
        "primary focus"
    ]);
    let noul_criteria = serde_json::json!({
        "true": "Matches topic and inclusion criteria without exclusions.",
        "false": "Off-topic or matches exclusion criteria."
    });

    let dec_opts = vec![
        "INCLUDE: Matches topic and inclusion criteria without hitting exclusions.".to_string(),
        "UNCERTAIN: Borderline, ambiguous, or insufficient evidence.".to_string(),
        "EXCLUDE: Off-topic or matches exclusion criteria.".to_string(),
    ];
    let rel_opts = vec![
        "level 0: off-topic".to_string(),
        "level 1: incidental mention".to_string(),
        "level 2: related".to_string(),
        "level 3: on topic".to_string(),
        "level 4: primary focus".to_string(),
    ];
    let noul_opts = vec![
        "false: Off-topic or matches exclusion criteria.".to_string(),
        "true: Matches topic and inclusion criteria without exclusions.".to_string(),
    ];

    let mut head_lens = vec![
        compute_question_head_tokens(tok, "choice", &decision_ins, &dec_opts, cfg.head_max_len),
        compute_question_head_tokens(tok, "score", &relevance_ins, &rel_opts, cfg.head_max_len),
        compute_question_head_tokens(tok, "noul", &noul_ins, &noul_opts, cfg.head_max_len),
    ];

    let mut questions = serde_json::json!({
        "decision": {
            "type": "choice",
            "instructions": decision_ins,
            "criteria": decision_criteria,
        },
        "relevance": {
            "type": "score",
            "instructions": relevance_ins,
            "criteria": relevance_criteria,
        },
        "matches_criteria": {
            "type": "noul",
            "instructions": noul_ins,
            "criteria": noul_criteria,
        }
    });

    if include_centrality {
        let centrality_ins = format!(
            "Is '{feed_name}' the primary subject of this passage or an incidental mention? {compact_context}"
        );
        let cent_opts = vec![
            "PRIMARY: Substantive primary focus on the topic.".to_string(),
            "SECONDARY: Significant supporting section on the topic.".to_string(),
            "INCIDENTAL: Brief or passing mention only.".to_string(),
            "OFF_TOPIC: Unrelated to the topic.".to_string(),
        ];
        head_lens.push(compute_question_head_tokens(
            tok,
            "choice",
            &centrality_ins,
            &cent_opts,
            cfg.head_max_len,
        ));
        if let Some(obj) = questions.as_object_mut() {
            obj.insert(
                "centrality".to_string(),
                serde_json::json!({
                    "type": "choice",
                    "instructions": centrality_ins,
                    "criteria": {
                        "PRIMARY": "Substantive primary focus on the topic.",
                        "SECONDARY": "Significant supporting section on the topic.",
                        "INCIDENTAL": "Brief or passing mention only.",
                        "OFF_TOPIC": "Unrelated to the topic."
                    }
                }),
            );
        }
    }

    let max_head_tokens = head_lens.into_iter().max().unwrap_or(cfg.head_max_len);
    let raw_room = cfg.max_len.saturating_sub(max_head_tokens + 1);
    let state_room = raw_room.saturating_sub(cfg.safety_margin);

    CompactQuestionSet {
        questions_json: questions,
        max_head_tokens,
        state_room,
        criteria_compacted,
    }
}

#[derive(Debug, Clone)]
pub struct TokenBudgetedState {
    pub state_json: serde_json::Value,
    pub state_tokens: usize,
    pub state_room: usize,
    pub head_tokens_max: usize,
    pub criteria_compacted: bool,
    pub exact_tokenizer: bool,
}

/// Construct a token-safe `state` JSON object for Laya, prioritizing:
/// 1. Article title
/// 2. Primary content / passage evidence
/// 3. Summary (if distinct and room remains)
/// 4. Categories (if room remains)
/// 5. Source name (only if room remains)
pub fn build_token_safe_state(
    tok: &LayaTokenizer,
    qset: &CompactQuestionSet,
    title: &str,
    content: &str,
    summary: Option<&str>,
    categories: &[String],
    source: &str,
    passage_label: Option<&str>,
) -> TokenBudgetedState {
    let room = qset.state_room.max(64);
    let clean_title = sanitize_untrusted_for_prompt(title, 400);
    let clean_content = sanitize_untrusted_for_prompt(content, 8000);
    let clean_summary = summary
        .map(|s| sanitize_untrusted_for_prompt(s, 1500))
        .unwrap_or_default();
    let clean_cats = sanitize_untrusted_for_prompt(&categories.join(", "), 240);
    let clean_source = sanitize_untrusted_for_prompt(source, 120);

    // Reserve ~24 tokens for JSON keys/braces/quotes
    let title_budget = (room / 5).clamp(24, 96);
    let title_fit = tok.truncate_to_tokens(&clean_title, title_budget);

    let mut map = serde_json::Map::new();
    map.insert("title".to_string(), serde_json::Value::String(title_fit));
    if let Some(label) = passage_label {
        map.insert(
            "passage".to_string(),
            serde_json::Value::String(label.to_string()),
        );
    }

    let base_overhead = tok.count_tokens(&serde_json::Value::Object(map.clone()).to_string());
    let mut remaining = room.saturating_sub(base_overhead + 12);

    // Primary content gets the lion's share of remaining state tokens
    let content_fit = tok.truncate_to_tokens(&clean_content, remaining);
    let content_used = tok.count_tokens(&content_fit);
    if !content_fit.is_empty() {
        map.insert(
            "content".to_string(),
            serde_json::Value::String(content_fit),
        );
        remaining = remaining.saturating_sub(content_used + 6);
    }

    // Add summary if distinct and >= 32 tokens remain
    if !clean_summary.is_empty() && clean_summary != clean_content && remaining >= 32 {
        let sum_budget = remaining.min(140);
        let sum_fit = tok.truncate_to_tokens(&clean_summary, sum_budget);
        let sum_used = tok.count_tokens(&sum_fit);
        if !sum_fit.is_empty() {
            map.insert("summary".to_string(), serde_json::Value::String(sum_fit));
            remaining = remaining.saturating_sub(sum_used + 6);
        }
    }

    // Add categories if >= 16 tokens remain
    if !clean_cats.is_empty() && remaining >= 16 {
        let cat_fit = tok.truncate_to_tokens(&clean_cats, remaining.min(40));
        let cat_used = tok.count_tokens(&cat_fit);
        if !cat_fit.is_empty() {
            map.insert(
                "categories".to_string(),
                serde_json::Value::String(cat_fit),
            );
            remaining = remaining.saturating_sub(cat_used + 6);
        }
    }

    // Add source only if >= 12 tokens remain
    if !clean_source.is_empty() && remaining >= 12 {
        let src_fit = tok.truncate_to_tokens(&clean_source, remaining.min(24));
        if !src_fit.is_empty() {
            map.insert("source".to_string(), serde_json::Value::String(src_fit));
        }
    }

    let state_json = serde_json::Value::Object(map);
    let state_tokens = tok.count_tokens(&state_json.to_string());

    TokenBudgetedState {
        state_json,
        state_tokens,
        state_room: qset.state_room,
        head_tokens_max: qset.max_head_tokens,
        criteria_compacted: qset.criteria_compacted,
        exact_tokenizer: tok.is_exact(),
    }
}

/// Strictness-aware inclusion margin helper for adaptive routing.
pub fn strictness_label(strictness: CurationStrictness) -> &'static str {
    strictness.as_str()
}
