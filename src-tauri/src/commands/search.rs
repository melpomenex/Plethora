//! Full-text search commands using FTS5

use crate::database::Repository;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{QueryBuilder, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::State;

/// Search result from FTS5
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsSearchResult {
    pub id: String,
    pub result_type: String,
    pub title: Option<String>,
    pub excerpt: Option<String>,
    pub score: f64,
    pub document_id: Option<String>,
    pub file_type: Option<String>,
}

/// Search query options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsSearchQuery {
    pub query: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub result_types: Option<Vec<String>>,
}

/// Unified Command Palette search query (Stage B indexed backend).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteSearchQuery {
    pub query: String,
    pub scope: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub collection_id: Option<String>,
    pub categories: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub file_types: Option<Vec<String>>,
    pub result_types: Option<Vec<String>>,
    pub min_rating: Option<i32>,
    pub include_archived: Option<bool>,
    pub has_extracts: Option<bool>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

/// Unified search item returned by `palette_search`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteSearchItem {
    pub id: String,
    pub result_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_kind: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    pub score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub article_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_modified: Option<String>,
    pub transcript_match: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_hit: Option<Value>,
    pub secondary_hits: Vec<Value>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteSearchResponse {
    pub items: Vec<PaletteSearchItem>,
    pub total_estimate: u64,
    pub elapsed_ms: u64,
    pub has_more: bool,
}

const SNIP_START: &str = "__PLMS_START__";
const SNIP_END: &str = "__PLMS_END__";

fn script_style_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?is)<(script|style|noscript)\b[^>]*>.*?</(script|style|noscript)>")
            .expect("valid script/style regex")
    })
}

fn tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<[^>]+>").expect("valid html tag regex"))
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn escape_html_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Strip script/style blocks and HTML markup cleanly into normalized plain text.
pub fn strip_html_blocks_and_tags(raw: &str) -> String {
    let without_blocks = script_style_regex().replace_all(raw, " ");
    let without_tags = tag_regex().replace_all(&without_blocks, " ");
    let decoded = decode_html_entities(&without_tags);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Clean an FTS5 snippet generated with `SNIP_START`/`SNIP_END` delimiters into
/// XSS-safe highlighted HTML containing only `<mark>...</mark>` markup.
pub fn clean_fts_snippet(raw: &str) -> String {
    let plain = strip_html_blocks_and_tags(raw);
    let escaped = escape_html_text(&plain);

    // Emit strictly balanced <mark>...</mark> pairs so truncation never leaks
    // orphan sentinels or unclosed tags.
    let mut out = String::with_capacity(escaped.len());
    let mut rest = escaped.as_str();
    while let Some(start_idx) = rest.find(SNIP_START) {
        let before = &rest[..start_idx];
        out.push_str(&before.replace(SNIP_END, ""));
        let after_start = &rest[start_idx + SNIP_START.len()..];
        if let Some(end_idx) = after_start.find(SNIP_END) {
            let inner = after_start[..end_idx].replace(SNIP_START, "");
            if !inner.is_empty() {
                out.push_str("<mark>");
                out.push_str(&inner);
                out.push_str("</mark>");
            }
            rest = &after_start[end_idx + SNIP_END.len()..];
        } else {
            let inner = after_start.replace(SNIP_START, "");
            if !inner.is_empty() {
                out.push_str("<mark>");
                out.push_str(&inner);
                out.push_str("</mark>");
            }
            rest = "";
        }
    }
    out.push_str(&rest.replace(SNIP_END, ""));
    out.trim().to_string()
}

/// Convert arbitrary user query text (including `C++`, quotes, URLs, colons,
/// hyphens, or FTS keywords like `AND`/`OR`/`NOT`) into a safe FTS5 MATCH string.
pub fn sanitize_palette_fts_query(raw: &str) -> Option<String> {
    let mut clauses: Vec<String> = Vec::new();
    for token in raw.split_whitespace() {
        let mut segments: Vec<String> = Vec::new();
        let mut current = String::new();
        for ch in token.chars() {
            if ch.is_alphanumeric() || ch == '_' {
                current.push(ch);
            } else if !current.is_empty() {
                segments.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            segments.push(current);
        }
        if segments.is_empty() {
            continue;
        }
        if segments.len() == 1 {
            clauses.push(format!("\"{}\"*", segments[0]));
        } else {
            clauses.push(format!("\"{}\"*", segments.join(" ")));
        }
        if clauses.len() >= 16 {
            break;
        }
    }
    if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" "))
    }
}

fn plain_quote_from_snippet(snippet_html: &str) -> Option<String> {
    let stripped = snippet_html
        .replace("<mark>", "")
        .replace("</mark>", "")
        .replace("...", " ");
    let clean = decode_html_entities(&stripped)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(120).collect())
    }
}

fn push_document_filters<'a>(
    qb: &mut QueryBuilder<'a, Sqlite>,
    alias: &str,
    query: &'a PaletteSearchQuery,
) {
    if !query.include_archived.unwrap_or(false) {
        qb.push(" AND ");
        qb.push(alias);
        qb.push(".is_archived = 0");
    }
    if let Some(ref cid) = query.collection_id {
        if !cid.trim().is_empty() {
            qb.push(" AND (");
            qb.push(alias);
            qb.push(".collection_id = ");
            qb.push_bind(cid.trim().to_string());
            qb.push(" OR ");
            qb.push(alias);
            qb.push(".collection_id IS NULL OR ");
            qb.push(alias);
            qb.push(".collection_id = '')");
        }
    }
    if let Some(ref cats) = query.categories {
        let clean: Vec<&String> = cats.iter().filter(|c| !c.trim().is_empty()).collect();
        if !clean.is_empty() {
            qb.push(" AND ");
            qb.push(alias);
            qb.push(".category IN (");
            let mut sep = qb.separated(", ");
            for cat in clean {
                sep.push_bind(cat.trim().to_string());
            }
            qb.push(")");
        }
    }
    if let Some(ref fts) = query.file_types {
        let clean: Vec<String> = fts
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        if !clean.is_empty() {
            qb.push(" AND lower(");
            qb.push(alias);
            qb.push(".file_type) IN (");
            let mut sep = qb.separated(", ");
            for ft in clean {
                sep.push_bind(ft);
            }
            qb.push(")");
        }
    }
    if let Some(ref tags) = query.tags {
        let clean: Vec<String> = tags
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        if !clean.is_empty() {
            qb.push(" AND EXISTS (SELECT 1 FROM json_each(COALESCE(");
            qb.push(alias);
            qb.push(".tags, '[]')) jt WHERE lower(jt.value) IN (");
            let mut sep = qb.separated(", ");
            for tag in clean {
                sep.push_bind(tag);
            }
            qb.push("))");
        }
    }
    if let Some(min_rating) = query.min_rating {
        qb.push(" AND ");
        qb.push(alias);
        qb.push(".priority_rating >= ");
        qb.push_bind(min_rating);
    }
    if let Some(has_ext) = query.has_extracts {
        if has_ext {
            qb.push(" AND ");
            qb.push(alias);
            qb.push(".extract_count > 0");
        } else {
            qb.push(" AND ");
            qb.push(alias);
            qb.push(".extract_count = 0");
        }
    }
    if let Some(ref from) = query.date_from {
        if !from.trim().is_empty() {
            qb.push(" AND ");
            qb.push(alias);
            qb.push(".date_added >= ");
            qb.push_bind(from.trim().to_string());
        }
    }
    if let Some(ref to) = query.date_to {
        if !to.trim().is_empty() {
            qb.push(" AND ");
            qb.push(alias);
            qb.push(".date_added <= ");
            qb.push_bind(to.trim().to_string());
        }
    }
}

fn location_from_chunk_json(
    file_type: &str,
    loc_raw: &str,
    quote: Option<&str>,
) -> (Value, Option<i32>, Option<i64>, Option<String>) {
    let val: Value = serde_json::from_str(loc_raw).unwrap_or(Value::Null);
    let ft = file_type.to_lowercase();
    let q = quote.map(|s| s.to_string());

    if ft == "pdf" {
        let page = val
            .get("pageNumber")
            .and_then(|v| v.as_i64())
            .filter(|&p| p >= 1)
            .unwrap_or(1) as i32;
        return (
            json!({
                "kind": "pdf",
                "pageNumber": page,
                "textQuote": q,
            }),
            Some(page),
            None,
            Some(format!("Page {page}")),
        );
    }
    if ft == "epub" {
        if let Some(cfi) = val
            .get("cfiRange")
            .or_else(|| val.get("cfi"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        {
            return (
                json!({
                    "kind": "epub",
                    "cfi": cfi,
                    "cfiRange": val.get("cfiRange").and_then(|v| v.as_str()).unwrap_or(cfi),
                    "textQuote": q,
                }),
                None,
                None,
                Some("Passage".to_string()),
            );
        }
    }
    if matches!(ft.as_str(), "youtube" | "audio" | "video") {
        let secs = val
            .get("timeSeconds")
            .or_else(|| val.get("startMs").map(|_| &Value::Null))
            .and_then(|v| v.as_f64())
            .or_else(|| {
                val.get("startMs")
                    .and_then(|v| v.as_i64())
                    .map(|ms| (ms.max(0) as f64) / 1000.0)
            })
            .unwrap_or(0.0);
        let seg_id = val
            .get("segmentId")
            .or_else(|| val.get("transcriptSegmentId"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let mins = (secs.floor() as i64) / 60;
        let rem = (secs.floor() as i64) % 60;
        return (
            json!({
                "kind": ft,
                "timeSeconds": secs,
                "segmentId": seg_id,
                "textQuote": q,
            }),
            None,
            Some((secs * 1000.0) as i64),
            Some(format!("{mins:02}:{rem:02}")),
        );
    }

    let kind = match ft.as_str() {
        "html" | "markdown" | "image" => ft.as_str(),
        _ => "text",
    };
    (
        json!({
            "kind": kind,
            "textQuote": q,
        }),
        None,
        None,
        None,
    )
}

fn format_mm_ss(ms: i64) -> String {
    let secs = ms.max(0) / 1000;
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

pub async fn run_palette_search(
    repo: &Repository,
    query: PaletteSearchQuery,
) -> Result<PaletteSearchResponse, String> {
    let started = Instant::now();
    let trimmed = query.query.trim();
    if trimmed.is_empty() {
        return Ok(PaletteSearchResponse {
            items: Vec::new(),
            total_estimate: 0,
            elapsed_ms: 0,
            has_more: false,
        });
    }

    let scope = query
        .scope
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_lowercase();
    if matches!(scope.as_str(), "actions" | "settings") {
        return Ok(PaletteSearchResponse {
            items: Vec::new(),
            total_estimate: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
            has_more: false,
        });
    }

    let Some(fts_query) = sanitize_palette_fts_query(trimmed) else {
        return Ok(PaletteSearchResponse {
            items: Vec::new(),
            total_estimate: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
            has_more: false,
        });
    };

    let limit = query.limit.unwrap_or(50).clamp(1, 200) as usize;
    let offset = query.offset.unwrap_or(0) as usize;
    let branch_limit = (offset + limit + 25).min(300) as i64;
    let query_lower = trimmed.to_lowercase();

    let allowed_types: Option<HashSet<String>> = query.result_types.as_ref().map(|types| {
        types
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect()
    });
    let allows_type = |t: &str| {
        allowed_types
            .as_ref()
            .is_none_or(|set| set.is_empty() || set.contains(t))
    };

    let include_docs = matches!(scope.as_str(), "all" | "documents") && allows_type("document");
    let include_transcripts = matches!(scope.as_str(), "all" | "documents" | "library")
        && (allows_type("document")
            || allows_type("transcript")
            || allows_type("media")
            || allows_type("podcast-episode"));
    let include_extracts = matches!(scope.as_str(), "all" | "documents") && allows_type("extract");
    let include_rss = matches!(scope.as_str(), "all" | "library")
        && (allows_type("rss-article") || allows_type("document"));
    let include_podcasts = matches!(scope.as_str(), "all" | "library")
        && (allows_type("podcast-episode") || allows_type("media"));
    let include_cards = matches!(scope.as_str(), "all" | "cards") && allows_type("flashcard");
    let include_visual = matches!(scope.as_str(), "all" | "images" | "visual")
        && (allows_type("visual") || allows_type("image"));

    let mut doc_groups: HashMap<String, PaletteSearchItem> = HashMap::new();
    let mut standalone_items: Vec<PaletteSearchItem> = Vec::new();

    // 1. Document title + body FTS
    if include_docs {
        let mut qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT d.id, d.title, d.file_type, d.category, d.tags, d.date_added, d.date_modified,
                    snippet(document_search, 2, '__PLMS_START__', '__PLMS_END__', '...', 24) AS body_snip,
                    snippet(document_search, 1, '__PLMS_START__', '__PLMS_END__', '...', 16) AS title_snip,
                    rank
             FROM document_search ds
             INNER JOIN documents d ON ds.document_id = d.id
             WHERE document_search MATCH ",
        );
        qb.push_bind(&fts_query);
        push_document_filters(&mut qb, "d", &query);
        qb.push(" ORDER BY rank LIMIT ");
        qb.push_bind(branch_limit);

        let rows = qb
            .build()
            .fetch_all(repo.pool())
            .await
            .map_err(|e| format!("Palette document search failed: {e}"))?;

        for row in rows {
            let doc_id: String = row.try_get("id").unwrap_or_default();
            let title: String = row.try_get("title").unwrap_or_default();
            let file_type: String = row.try_get("file_type").unwrap_or_default();
            let category: Option<String> = row.try_get("category").ok().flatten();
            let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
            let date_added: Option<String> = row.try_get("date_added").ok().flatten();
            let date_modified: Option<String> = row.try_get("date_modified").ok().flatten();
            let body_snip: Option<String> = row.try_get("body_snip").ok().flatten();
            let title_snip: Option<String> = row.try_get("title_snip").ok().flatten();
            let rank: f64 = row.try_get("rank").unwrap_or(0.0);

            let mut cleaned_excerpt = body_snip
                .as_deref()
                .map(clean_fts_snippet)
                .filter(|s| !s.is_empty());
            if cleaned_excerpt.is_none() {
                cleaned_excerpt = title_snip
                    .as_deref()
                    .map(clean_fts_snippet)
                    .filter(|s| !s.is_empty());
            }

            let mut score = 60.0 + (-rank).max(0.0);
            let title_lower = title.to_lowercase();
            if title_lower == query_lower {
                score += 60.0;
            } else if title_lower.starts_with(&query_lower) {
                score += 40.0;
            } else if title_lower.contains(&query_lower) {
                score += 25.0;
            }

            let quote = cleaned_excerpt
                .as_deref()
                .and_then(plain_quote_from_snippet);
            let (default_loc, _, _, _) =
                location_from_chunk_json(&file_type, "{}", quote.as_deref());
            let primary_hit = cleaned_excerpt.as_ref().map(|exc| {
                json!({
                    "id": format!("{doc_id}:doc"),
                    "location": default_loc,
                    "excerptHtml": exc,
                })
            });

            let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
            doc_groups.insert(
                doc_id.clone(),
                PaletteSearchItem {
                    id: doc_id.clone(),
                    result_type: "document".to_string(),
                    result_kind: None,
                    title,
                    excerpt: cleaned_excerpt,
                    score,
                    document_id: Some(doc_id),
                    article_id: None,
                    feed_id: None,
                    episode_id: None,
                    card_id: None,
                    category,
                    tags,
                    file_type: Some(file_type),
                    date_added,
                    date_modified,
                    transcript_match: false,
                    page_number: None,
                    timestamp_ms: None,
                    primary_hit,
                    secondary_hits: Vec::new(),
                    scopes: vec!["documents".to_string()],
                },
            );
        }

        // 2. Semantic chunks FTS (EPUB chapters, PDF pages, OCR, long documents)
        let mut chunk_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT sc.id AS chunk_id, sc.document_id, sc.source_type, sc.location_json,
                    d.title, d.file_type, d.category, d.tags, d.date_added, d.date_modified,
                    snippet(semantic_chunks_fts, 3, '__PLMS_START__', '__PLMS_END__', '...', 24) AS chunk_snip,
                    rank
             FROM semantic_chunks_fts scf
             INNER JOIN semantic_chunks sc ON sc.id = scf.chunk_id
             INNER JOIN documents d ON d.id = sc.document_id
             WHERE semantic_chunks_fts MATCH ",
        );
        chunk_qb.push_bind(&fts_query);
        push_document_filters(&mut chunk_qb, "d", &query);
        chunk_qb.push(" ORDER BY rank LIMIT ");
        chunk_qb.push_bind(branch_limit);

        if let Ok(chunk_rows) = chunk_qb.build().fetch_all(repo.pool()).await {
            for row in chunk_rows {
                let chunk_id: String = row.try_get("chunk_id").unwrap_or_default();
                let doc_id: String = row.try_get("document_id").unwrap_or_default();
                let chunk_source_type: String = row.try_get("source_type").unwrap_or_default();
                let loc_raw: String = row.try_get("location_json").unwrap_or_else(|_| "{}".into());
                let title: String = row.try_get("title").unwrap_or_default();
                let file_type: String = row.try_get("file_type").unwrap_or_default();
                let category: Option<String> = row.try_get("category").ok().flatten();
                let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
                let date_added: Option<String> = row.try_get("date_added").ok().flatten();
                let date_modified: Option<String> = row.try_get("date_modified").ok().flatten();
                let snip_raw: String = row.try_get("chunk_snip").unwrap_or_default();
                let rank: f64 = row.try_get("rank").unwrap_or(0.0);

                let clean_snip = clean_fts_snippet(&snip_raw);
                if clean_snip.is_empty() {
                    continue;
                }
                let quote = plain_quote_from_snippet(&clean_snip);
                let (loc, page_num, ts_ms, label) =
                    location_from_chunk_json(&file_type, &loc_raw, quote.as_deref());
                let is_transcript = matches!(chunk_source_type.as_str(), "transcript" | "session");
                let hit = json!({
                    "id": format!("chunk:{chunk_id}"),
                    "location": loc,
                    "excerptHtml": clean_snip,
                    "label": label,
                });
                let score = 55.0 + (-rank).max(0.0);

                if let Some(existing) = doc_groups.get_mut(&doc_id) {
                    if score > existing.score {
                        existing.score = score;
                    }
                    if existing.page_number.is_none() {
                        existing.page_number = page_num;
                    }
                    if existing.timestamp_ms.is_none() {
                        existing.timestamp_ms = ts_ms;
                    }
                    if is_transcript {
                        existing.transcript_match = true;
                    }
                    if existing.primary_hit.is_none() {
                        existing.primary_hit = Some(hit.clone());
                        existing.excerpt = Some(clean_snip);
                    }
                    if existing.secondary_hits.len() < 5
                        && existing
                            .primary_hit
                            .as_ref()
                            .is_none_or(|p| p.get("id") != hit.get("id"))
                    {
                        existing.secondary_hits.push(hit);
                    }
                } else {
                    let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                    doc_groups.insert(
                        doc_id.clone(),
                        PaletteSearchItem {
                            id: doc_id.clone(),
                            result_type: "document".to_string(),
                            result_kind: None,
                            title,
                            excerpt: Some(clean_snip),
                            score,
                            document_id: Some(doc_id),
                            article_id: None,
                            feed_id: None,
                            episode_id: None,
                            card_id: None,
                            category,
                            tags,
                            file_type: Some(file_type),
                            date_added,
                            date_modified,
                            transcript_match: is_transcript,
                            page_number: page_num,
                            timestamp_ms: ts_ms,
                            primary_hit: Some(hit),
                            secondary_hits: Vec::new(),
                            scopes: vec!["documents".to_string()],
                        },
                    );
                }
            }
        }
    }

    // 3. Dedicated transcript search (YouTube, local video, recording sessions, podcasts)
    if include_transcripts {
        let mut tr_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT tsf.row_key, tsf.source_kind, tsf.document_id, tsf.source_id,
                    tsf.segment_key, tsf.start_ms,
                    snippet(transcript_search_fts, 6, '__PLMS_START__', '__PLMS_END__', '...', 24) AS tr_snip,
                    rank,
                    d.id AS resolved_doc_id, d.title AS doc_title, d.file_type AS doc_file_type,
                    d.category AS doc_category, d.tags AS doc_tags, d.date_added AS doc_date_added,
                    d.date_modified AS doc_date_modified,
                    pe.id AS ep_id, pe.feed_id AS ep_feed_id, pe.title AS ep_title, pf.title AS feed_title
             FROM transcript_search_fts tsf
             LEFT JOIN documents d ON d.id = tsf.document_id
             LEFT JOIN podcast_episodes pe ON tsf.source_kind = 'podcast' AND pe.id = tsf.source_id
             LEFT JOIN podcast_feeds pf ON pf.id = pe.feed_id
             WHERE transcript_search_fts MATCH ",
        );
        tr_qb.push_bind(&fts_query);
        if !query.include_archived.unwrap_or(false) {
            tr_qb.push(" AND (d.id IS NULL OR d.is_archived = 0)");
        }
        if let Some(ref cid) = query.collection_id {
            if !cid.trim().is_empty() {
                tr_qb.push(" AND (d.id IS NULL OR d.collection_id = ");
                tr_qb.push_bind(cid.trim().to_string());
                tr_qb.push(")");
            }
        }
        if let Some(ref fts) = query.file_types {
            let clean: Vec<String> = fts
                .iter()
                .map(|t| t.trim().to_lowercase())
                .filter(|t| !t.is_empty())
                .collect();
            if !clean.is_empty() {
                tr_qb.push(" AND d.id IS NOT NULL AND lower(d.file_type) IN (");
                let mut sep = tr_qb.separated(", ");
                for ft in clean {
                    sep.push_bind(ft);
                }
                tr_qb.push(")");
            }
        }
        tr_qb.push(" ORDER BY rank LIMIT ");
        tr_qb.push_bind(branch_limit);

        if let Ok(tr_rows) = tr_qb.build().fetch_all(repo.pool()).await {
            let mut seen_podcasts: HashMap<String, usize> = HashMap::new();
            for row in tr_rows {
                let row_key: String = row.try_get("row_key").unwrap_or_default();
                let source_kind: String = row.try_get("source_kind").unwrap_or_default();
                let segment_key: String = row.try_get("segment_key").unwrap_or_default();
                let start_ms_str: String = row.try_get("start_ms").unwrap_or_default();
                let start_ms = start_ms_str.parse::<i64>().unwrap_or(0).max(0);
                let time_secs = (start_ms as f64) / 1000.0;
                let snip_raw: String = row.try_get("tr_snip").unwrap_or_default();
                let rank: f64 = row.try_get("rank").unwrap_or(0.0);
                let clean_snip = clean_fts_snippet(&snip_raw);
                if clean_snip.is_empty() {
                    continue;
                }
                let quote = plain_quote_from_snippet(&clean_snip);
                let label = if start_ms > 0 {
                    Some(format!("Transcript {}", format_mm_ss(start_ms)))
                } else {
                    Some("Transcript".to_string())
                };
                let score = 58.0 + (-rank).max(0.0);

                if source_kind == "podcast"
                    && matches!(scope.as_str(), "all" | "library")
                    && include_podcasts
                {
                    if let Ok(Some(ep_id)) = row.try_get::<Option<String>, _>("ep_id") {
                        let feed_id: Option<String> = row.try_get("ep_feed_id").ok().flatten();
                        let ep_title: String = row.try_get("ep_title").unwrap_or_default();
                        let feed_title: Option<String> = row.try_get("feed_title").ok().flatten();
                        let hit = json!({
                            "id": format!("tr:{row_key}"),
                            "location": {
                                "kind": "audio",
                                "timeSeconds": time_secs,
                                "segmentId": if segment_key.is_empty() { Value::Null } else { Value::String(segment_key.clone()) },
                                "textQuote": quote,
                            },
                            "excerptHtml": clean_snip,
                            "label": label,
                        });
                        if let Some(&idx) = seen_podcasts.get(&ep_id) {
                            if standalone_items[idx].secondary_hits.len() < 5 {
                                standalone_items[idx].secondary_hits.push(hit);
                            }
                        } else {
                            seen_podcasts.insert(ep_id.clone(), standalone_items.len());
                            standalone_items.push(PaletteSearchItem {
                                id: format!("podcast-{ep_id}"),
                                result_type: "media".to_string(),
                                result_kind: Some("podcast-episode".to_string()),
                                title: ep_title,
                                excerpt: Some(clean_snip),
                                score,
                                document_id: None,
                                article_id: None,
                                feed_id,
                                episode_id: Some(ep_id),
                                card_id: None,
                                category: feed_title
                                    .or_else(|| Some("Podcast Episode".to_string())),
                                tags: vec!["podcast".to_string()],
                                file_type: Some("audio".to_string()),
                                date_added: None,
                                date_modified: None,
                                transcript_match: true,
                                page_number: None,
                                timestamp_ms: Some(start_ms),
                                primary_hit: Some(hit),
                                secondary_hits: Vec::new(),
                                scopes: vec!["library".to_string()],
                            });
                        }
                        continue;
                    }
                }

                if matches!(scope.as_str(), "all" | "documents") {
                    if let Ok(Some(doc_id)) = row.try_get::<Option<String>, _>("resolved_doc_id") {
                        let title: String = row.try_get("doc_title").unwrap_or_default();
                        let file_type: String = row.try_get("doc_file_type").unwrap_or_default();
                        let category: Option<String> = row.try_get("doc_category").ok().flatten();
                        let tags_raw: String =
                            row.try_get("doc_tags").unwrap_or_else(|_| "[]".to_string());
                        let date_added: Option<String> =
                            row.try_get("doc_date_added").ok().flatten();
                        let date_modified: Option<String> =
                            row.try_get("doc_date_modified").ok().flatten();

                        let loc_kind = match file_type.to_lowercase().as_str() {
                            "youtube" => "youtube",
                            "video" => "video",
                            _ => "audio",
                        };
                        let hit = json!({
                            "id": format!("tr:{row_key}"),
                            "location": {
                                "kind": loc_kind,
                                "timeSeconds": time_secs,
                                "segmentId": if segment_key.is_empty() { Value::Null } else { Value::String(segment_key) },
                                "textQuote": quote,
                            },
                            "excerptHtml": clean_snip,
                            "label": label,
                        });

                        if let Some(existing) = doc_groups.get_mut(&doc_id) {
                            existing.transcript_match = true;
                            if score > existing.score {
                                existing.score = score;
                            }
                            if existing.timestamp_ms.is_none() {
                                existing.timestamp_ms = Some(start_ms);
                            }
                            if existing.primary_hit.is_none() {
                                existing.primary_hit = Some(hit.clone());
                                existing.excerpt = Some(clean_snip);
                            } else if existing.secondary_hits.len() < 5 {
                                existing.secondary_hits.push(hit);
                            }
                        } else {
                            let tags: Vec<String> =
                                serde_json::from_str(&tags_raw).unwrap_or_default();
                            doc_groups.insert(
                                doc_id.clone(),
                                PaletteSearchItem {
                                    id: doc_id.clone(),
                                    result_type: "document".to_string(),
                                    result_kind: None,
                                    title,
                                    excerpt: Some(clean_snip),
                                    score,
                                    document_id: Some(doc_id),
                                    article_id: None,
                                    feed_id: None,
                                    episode_id: None,
                                    card_id: None,
                                    category,
                                    tags,
                                    file_type: Some(file_type),
                                    date_added,
                                    date_modified,
                                    transcript_match: true,
                                    page_number: None,
                                    timestamp_ms: Some(start_ms),
                                    primary_hit: Some(hit),
                                    secondary_hits: Vec::new(),
                                    scopes: vec!["documents".to_string()],
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    // 4. Extracts FTS (+ page_title match fallback)
    if include_extracts {
        let mut seen_extract_ids: HashSet<String> = HashSet::new();
        let mut ext_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT e.id, e.document_id, e.page_title, e.page_number, e.category, e.tags,
                    e.date_created, e.date_modified, d.title AS doc_title,
                    snippet(extract_search, 2, '__PLMS_START__', '__PLMS_END__', '...', 24) AS ext_snip,
                    rank
             FROM extract_search es
             INNER JOIN extracts e ON e.id = es.extract_id
             INNER JOIN documents d ON d.id = e.document_id
             WHERE extract_search MATCH ",
        );
        ext_qb.push_bind(&fts_query);
        push_document_filters(&mut ext_qb, "d", &query);
        ext_qb.push(" ORDER BY rank LIMIT ");
        ext_qb.push_bind(branch_limit);

        if let Ok(rows) = ext_qb.build().fetch_all(repo.pool()).await {
            for row in rows {
                let ext_id: String = row.try_get("id").unwrap_or_default();
                if ext_id.is_empty() || !seen_extract_ids.insert(ext_id.clone()) {
                    continue;
                }
                let doc_id: String = row.try_get("document_id").unwrap_or_default();
                let page_title: Option<String> = row.try_get("page_title").ok().flatten();
                let page_number: Option<i32> = row.try_get("page_number").ok().flatten();
                let category: Option<String> = row.try_get("category").ok().flatten();
                let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
                let date_created: Option<String> = row.try_get("date_created").ok().flatten();
                let date_modified: Option<String> = row.try_get("date_modified").ok().flatten();
                let doc_title: String = row.try_get("doc_title").unwrap_or_default();
                let snip_raw: String = row.try_get("ext_snip").unwrap_or_default();
                let rank: f64 = row.try_get("rank").unwrap_or(0.0);

                let clean_snip = clean_fts_snippet(&snip_raw);
                let title = page_title
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(doc_title);
                let mut score = 65.0 + (-rank).max(0.0);
                if title.to_lowercase().contains(&query_lower) {
                    score += 17.0;
                }
                let quote = if clean_snip.is_empty() {
                    None
                } else {
                    plain_quote_from_snippet(&clean_snip)
                };
                let primary_hit = page_number.filter(|&p| p > 0).map(|p| {
                    json!({
                        "id": format!("extract-hit-{ext_id}"),
                        "location": {
                            "kind": "pdf",
                            "pageNumber": p,
                            "textQuote": quote,
                        },
                        "label": format!("Page {p}"),
                        "excerptHtml": clean_snip,
                    })
                });
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();

                standalone_items.push(PaletteSearchItem {
                    id: ext_id.clone(),
                    result_type: "extract".to_string(),
                    result_kind: Some("extract".to_string()),
                    title,
                    excerpt: if clean_snip.is_empty() {
                        None
                    } else {
                        Some(clean_snip)
                    },
                    score,
                    document_id: Some(doc_id),
                    article_id: None,
                    feed_id: None,
                    episode_id: None,
                    card_id: None,
                    category,
                    tags,
                    file_type: None,
                    date_added: date_created,
                    date_modified,
                    transcript_match: false,
                    page_number,
                    timestamp_ms: None,
                    primary_hit,
                    secondary_hits: Vec::new(),
                    scopes: vec!["documents".to_string()],
                });
            }
        }

        // Fallback LIKE search over page_title, content, and notes for substrings,
        // underscore tokens, HTML-split text, or unindexed extracts.
        let like_terms: Vec<String> = query_lower
            .split_whitespace()
            .filter(|t| !t.is_empty())
            .take(8)
            .map(|t| format!("%{t}%"))
            .collect();
        if !like_terms.is_empty() {
            let mut ext_like_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
                "SELECT e.id, e.document_id, e.page_title, e.page_number, e.category, e.tags,
                        e.content, e.notes, e.date_created, e.date_modified, d.title AS doc_title
                 FROM extracts e
                 INNER JOIN documents d ON d.id = e.document_id
                 WHERE 1=1",
            );
            for pat in &like_terms {
                ext_like_qb.push(
                    " AND (lower(COALESCE(e.page_title, '')) LIKE ",
                );
                ext_like_qb.push_bind(pat.clone());
                ext_like_qb.push(" OR lower(COALESCE(e.content, '')) LIKE ");
                ext_like_qb.push_bind(pat.clone());
                ext_like_qb.push(" OR lower(COALESCE(e.notes, '')) LIKE ");
                ext_like_qb.push_bind(pat.clone());
                ext_like_qb.push(")");
            }
            push_document_filters(&mut ext_like_qb, "d", &query);
            ext_like_qb.push(" LIMIT ");
            ext_like_qb.push_bind(branch_limit);

            if let Ok(rows) = ext_like_qb.build().fetch_all(repo.pool()).await {
                for row in rows {
                    let ext_id: String = row.try_get("id").unwrap_or_default();
                    if ext_id.is_empty() || !seen_extract_ids.insert(ext_id.clone()) {
                        continue;
                    }
                    let doc_id: String = row.try_get("document_id").unwrap_or_default();
                    let page_title: Option<String> = row.try_get("page_title").ok().flatten();
                    let page_number: Option<i32> = row.try_get("page_number").ok().flatten();
                    let category: Option<String> = row.try_get("category").ok().flatten();
                    let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
                    let content: String = row.try_get("content").unwrap_or_default();
                    let notes: String = row.try_get("notes").unwrap_or_default();
                    let doc_title: String = row.try_get("doc_title").unwrap_or_default();
                    let date_created: Option<String> = row.try_get("date_created").ok().flatten();
                    let date_modified: Option<String> = row.try_get("date_modified").ok().flatten();

                    let title = page_title
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or(doc_title);
                    let plain_content = strip_html_blocks_and_tags(&content);
                    let raw_excerpt = if !plain_content.trim().is_empty() {
                        plain_content
                    } else {
                        notes
                    };
                    let excerpt_text: String =
                        raw_excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
                    let excerpt = if excerpt_text.is_empty() {
                        None
                    } else {
                        Some(excerpt_text.chars().take(180).collect::<String>())
                    };
                    let primary_hit = page_number.filter(|&p| p > 0).map(|p| {
                        json!({
                            "id": format!("extract-hit-{ext_id}"),
                            "location": {
                                "kind": "pdf",
                                "pageNumber": p,
                            },
                            "label": format!("Page {p}"),
                            "excerptHtml": excerpt,
                        })
                    });
                    let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                    let score = if title.to_lowercase().contains(&query_lower) {
                        80.0
                    } else {
                        65.0
                    };

                    standalone_items.push(PaletteSearchItem {
                        id: ext_id,
                        result_type: "extract".to_string(),
                        result_kind: Some("extract".to_string()),
                        title,
                        excerpt,
                        score,
                        document_id: Some(doc_id),
                        article_id: None,
                        feed_id: None,
                        episode_id: None,
                        card_id: None,
                        category,
                        tags,
                        file_type: None,
                        date_added: date_created,
                        date_modified,
                        transcript_match: false,
                        page_number,
                        timestamp_ms: None,
                        primary_hit,
                        secondary_hits: Vec::new(),
                        scopes: vec!["documents".to_string()],
                    });
                }
            }
        }
    }

    // 5. RSS Articles FTS
    if include_rss {
        let mut rss_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT ra.id, ra.feed_id, ra.title, ra.categories, ra.date_added, ra.published_date,
                    rf.title AS feed_title,
                    snippet(rss_articles_fts, 1, '__PLMS_START__', '__PLMS_END__', '...', 24) AS rss_snip,
                    rank
             FROM rss_articles_fts raf
             INNER JOIN rss_articles ra ON ra.rowid = raf.rowid
             LEFT JOIN rss_feeds rf ON rf.id = ra.feed_id
             WHERE rss_articles_fts MATCH ",
        );
        rss_qb.push_bind(&fts_query);
        if let Some(ref cid) = query.collection_id {
            if !cid.trim().is_empty() {
                rss_qb.push(" AND rf.collection_id = ");
                rss_qb.push_bind(cid.trim().to_string());
            }
        }
        rss_qb.push(" ORDER BY rank LIMIT ");
        rss_qb.push_bind(branch_limit);

        if let Ok(rows) = rss_qb.build().fetch_all(repo.pool()).await {
            for row in rows {
                let article_id: String = row.try_get("id").unwrap_or_default();
                let feed_id: Option<String> = row.try_get("feed_id").ok().flatten();
                let title: String = row.try_get("title").unwrap_or_default();
                let cats_raw: String = row
                    .try_get("categories")
                    .unwrap_or_else(|_| "[]".to_string());
                let date_added: Option<String> = row.try_get("date_added").ok().flatten();
                let snip_raw: String = row.try_get("rss_snip").unwrap_or_default();
                let rank: f64 = row.try_get("rank").unwrap_or(0.0);

                let clean_snip = clean_fts_snippet(&snip_raw);
                let tags: Vec<String> = serde_json::from_str(&cats_raw).unwrap_or_default();

                standalone_items.push(PaletteSearchItem {
                    id: format!("rss-{article_id}"),
                    result_type: "document".to_string(),
                    result_kind: Some("rss-article".to_string()),
                    title,
                    excerpt: if clean_snip.is_empty() {
                        None
                    } else {
                        Some(clean_snip)
                    },
                    score: 50.0 + (-rank).max(0.0),
                    document_id: None,
                    article_id: Some(article_id),
                    feed_id,
                    episode_id: None,
                    card_id: None,
                    category: Some("RSS Article".to_string()),
                    tags,
                    file_type: Some("html".to_string()),
                    date_added,
                    date_modified: None,
                    transcript_match: false,
                    page_number: None,
                    timestamp_ms: None,
                    primary_hit: None,
                    secondary_hits: Vec::new(),
                    scopes: vec!["library".to_string()],
                });
            }
        }
    }

    // 6. Flashcards (learning_item_search FTS5)
    if include_cards {
        let mut card_qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
            "SELECT li.id, li.document_id, li.question, li.answer, li.cloze_text,
                    li.tags, li.date_created, li.date_modified,
                    snippet(learning_item_search, -1, '__PLMS_START__', '__PLMS_END__', '...', 20) AS card_snip,
                    rank
             FROM learning_item_search lis
             INNER JOIN learning_items li ON li.id = lis.item_id
             LEFT JOIN documents d ON d.id = li.document_id
             WHERE learning_item_search MATCH ",
        );
        card_qb.push_bind(&fts_query);
        if !query.include_archived.unwrap_or(false) {
            card_qb.push(" AND (d.id IS NULL OR d.is_archived = 0)");
        }
        if let Some(ref cid) = query.collection_id {
            if !cid.trim().is_empty() {
                card_qb.push(" AND li.collection_id = ");
                card_qb.push_bind(cid.trim().to_string());
            }
        }
        card_qb.push(" ORDER BY rank LIMIT ");
        card_qb.push_bind(branch_limit);

        if let Ok(rows) = card_qb.build().fetch_all(repo.pool()).await {
            for row in rows {
                let card_id: String = row.try_get("id").unwrap_or_default();
                let doc_id: Option<String> = row.try_get("document_id").ok().flatten();
                let question: String = row.try_get("question").unwrap_or_default();
                let cloze: Option<String> = row.try_get("cloze_text").ok().flatten();
                let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());
                let date_created: Option<String> = row.try_get("date_created").ok().flatten();
                let date_modified: Option<String> = row.try_get("date_modified").ok().flatten();
                let snip_raw: String = row.try_get("card_snip").unwrap_or_default();
                let rank: f64 = row.try_get("rank").unwrap_or(0.0);

                let clean_snip = clean_fts_snippet(&snip_raw);
                let title_source = if !question.trim().is_empty() {
                    question
                } else {
                    cloze.unwrap_or_default()
                };
                let title = strip_html_blocks_and_tags(&title_source);
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();

                standalone_items.push(PaletteSearchItem {
                    id: card_id.clone(),
                    result_type: "flashcard".to_string(),
                    result_kind: Some("learning-item".to_string()),
                    title,
                    excerpt: if clean_snip.is_empty() {
                        None
                    } else {
                        Some(clean_snip)
                    },
                    score: 54.0 + (-rank).max(0.0),
                    document_id: doc_id,
                    article_id: None,
                    feed_id: None,
                    episode_id: None,
                    card_id: Some(card_id),
                    category: None,
                    tags,
                    file_type: None,
                    date_added: date_created,
                    date_modified,
                    transcript_match: false,
                    page_number: None,
                    timestamp_ms: None,
                    primary_hit: None,
                    secondary_hits: Vec::new(),
                    scopes: vec!["cards".to_string()],
                });
            }
        }
    }

    // 7. Mirage Visual Semantic Search FTS5
    if include_visual {
        if let Ok(visual_rows) = sqlx::query(
            r#"
            SELECT
                fts.asset_id,
                m.scene_description,
                m.ocr_text,
                m.tags_json,
                m.indexed_at,
                a.file_name,
                a.mime_type,
                bm25(image_visual_search_fts, 2.0, 2.5, 1.2, 2.0) AS rank_score
            FROM image_visual_search_fts fts
            JOIN image_visual_metadata m ON m.asset_id = fts.asset_id
            LEFT JOIN image_assets a ON a.id = fts.asset_id
            WHERE image_visual_search_fts MATCH ?1
            ORDER BY rank_score ASC
            LIMIT ?2
            "#,
        )
        .bind(&fts_query)
        .bind(branch_limit)
        .fetch_all(repo.pool())
        .await
        {
            for row in visual_rows {
                let asset_id: String = row.try_get("asset_id").unwrap_or_default();
                if asset_id.is_empty() {
                    continue;
                }
                let scene: String = row.try_get("scene_description").unwrap_or_default();
                let ocr_text: String = row.try_get("ocr_text").unwrap_or_default();
                let tags_raw: String = row.try_get("tags_json").unwrap_or_else(|_| "[]".into());
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                let file_name: Option<String> = row.try_get("file_name").ok().flatten();
                let mime_type: Option<String> = row.try_get("mime_type").ok().flatten();
                let indexed_at: String = row.try_get("indexed_at").unwrap_or_default();
                let rank_score: f64 = row.try_get("rank_score").unwrap_or(0.0);

                let title = file_name
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| {
                        if !scene.trim().is_empty() {
                            scene.chars().take(80).collect()
                        } else {
                            format!("Visual Asset {}", &asset_id[..8.min(asset_id.len())])
                        }
                    });
                let excerpt = if !scene.trim().is_empty() {
                    Some(scene)
                } else if !ocr_text.trim().is_empty() {
                    Some(ocr_text.chars().take(160).collect())
                } else {
                    None
                };

                standalone_items.push(PaletteSearchItem {
                    id: asset_id.clone(),
                    result_type: "visual".to_string(),
                    result_kind: Some("image-asset".to_string()),
                    title,
                    excerpt,
                    score: 56.0 + (-rank_score).max(0.0),
                    document_id: None,
                    article_id: None,
                    feed_id: None,
                    episode_id: None,
                    card_id: None,
                    category: Some("Mirage Visual".to_string()),
                    tags,
                    file_type: mime_type,
                    date_added: Some(indexed_at.clone()),
                    date_modified: Some(indexed_at),
                    transcript_match: false,
                    page_number: None,
                    timestamp_ms: None,
                    primary_hit: None,
                    secondary_hits: Vec::new(),
                    scopes: vec!["images".to_string(), "visual".to_string()],
                });
            }
        }
    }

    let mut all_items: Vec<PaletteSearchItem> = doc_groups.into_values().collect();
    all_items.extend(standalone_items);
    all_items.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let total_estimate = all_items.len() as u64;
    let end = (offset + limit).min(all_items.len());
    let has_more = end < all_items.len();
    let paged = if offset >= all_items.len() {
        Vec::new()
    } else {
        all_items.drain(offset..end).collect()
    };

    Ok(PaletteSearchResponse {
        items: paged,
        total_estimate,
        elapsed_ms: started.elapsed().as_millis() as u64,
        has_more,
    })
}

#[tauri::command]
pub async fn palette_search(
    query: PaletteSearchQuery,
    repo: State<'_, Repository>,
) -> Result<PaletteSearchResponse, String> {
    run_palette_search(repo.inner(), query).await
}

/// Search statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsSearchStats {
    pub total_documents: u32,
    pub total_extracts: u32,
}

#[tauri::command]
pub async fn fts_search(
    query: FtsSearchQuery,
    repo: State<'_, Repository>,
) -> Result<Vec<FtsSearchResult>, String> {
    let limit = query.limit.unwrap_or(50).min(200);
    let offset = query.offset.unwrap_or(0);
    let fts_query = format!("{}*", query.query);
    let types = query
        .result_types
        .unwrap_or_else(|| vec!["document".into(), "extract".into()]);

    let mut results = Vec::new();

    if types.contains(&"document".to_string()) {
        let rows = sqlx::query_as::<_, (String, String, Option<String>, String, f64)>(
            "SELECT ds.document_id, d.title, snippet(document_search, 2, '<mark>', '</mark>', '...', 32), d.file_type, rank \
             FROM document_search ds \
             INNER JOIN documents d ON ds.document_id = d.id \
             WHERE document_search MATCH ? \
             ORDER BY rank LIMIT ? OFFSET ?"
        )
        .bind(&fts_query)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(repo.pool())
        .await
        .map_err(|e| format!("Document search failed: {}", e))?;

        for (id, title, excerpt, file_type, rank) in rows {
            results.push(FtsSearchResult {
                id: id.clone(),
                result_type: "document".to_string(),
                title: Some(title),
                excerpt,
                score: rank,
                document_id: Some(id),
                file_type: Some(file_type),
            });
        }
    }

    if types.contains(&"extract".to_string()) {
        let rows = sqlx::query_as::<_, (String, String, String, f64)>(
            "SELECT es.extract_id, es.document_id, snippet(extract_search, 0, '<mark>', '</mark>', '...', 32), rank \
             FROM extract_search es \
             WHERE extract_search MATCH ? \
             ORDER BY rank LIMIT ? OFFSET ?"
        )
        .bind(&fts_query)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(repo.pool())
        .await
        .map_err(|e| format!("Extract search failed: {}", e))?;

        for (id, doc_id, excerpt, rank) in rows {
            results.push(FtsSearchResult {
                id: id.clone(),
                result_type: "extract".to_string(),
                title: None,
                excerpt: Some(excerpt),
                score: rank,
                document_id: Some(doc_id),
                file_type: None,
            });
        }
    }

    results.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit as usize);
    Ok(results)
}

#[tauri::command]
pub async fn fts_search_suggestions(
    query: String,
    repo: State<'_, Repository>,
) -> Result<Vec<String>, String> {
    if query.len() < 2 {
        return Ok(vec![]);
    }
    let fts_query = format!("{}*", query);

    let rows = sqlx::query_as::<_, (String,)>(
        "SELECT d.title FROM document_search ds \
         INNER JOIN documents d ON ds.document_id = d.id \
         WHERE document_search MATCH ? \
         ORDER BY rank LIMIT 8",
    )
    .bind(&fts_query)
    .fetch_all(repo.pool())
    .await
    .map_err(|e| format!("Suggestions failed: {}", e))?;

    Ok(rows.into_iter().map(|(t,)| t).collect())
}

#[tauri::command]
pub async fn fts_get_stats(repo: State<'_, Repository>) -> Result<FtsSearchStats, String> {
    let doc_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM document_search")
        .fetch_one(repo.pool())
        .await
        .map_err(|e| format!("Stats failed: {}", e))?;

    let extract_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM extract_search")
        .fetch_one(repo.pool())
        .await
        .map_err(|e| format!("Stats failed: {}", e))?;

    Ok(FtsSearchStats {
        total_documents: doc_count.0 as u32,
        total_extracts: extract_count.0 as u32,
    })
}

#[tauri::command]
pub async fn fts_reindex(repo: State<'_, Repository>) -> Result<(), String> {
    sqlx::query("DELETE FROM document_search")
        .execute(repo.pool())
        .await
        .map_err(|e| format!("Reindex failed: {}", e))?;

    sqlx::query("INSERT INTO document_search(document_id, title, content, content_type) SELECT id, title, COALESCE(content, ''), file_type FROM documents")
        .execute(repo.pool())
        .await
        .map_err(|e| format!("Reindex failed: {}", e))?;

    sqlx::query("DELETE FROM extract_search")
        .execute(repo.pool())
        .await
        .map_err(|e| format!("Reindex failed: {}", e))?;

    sqlx::query("INSERT INTO extract_search(extract_id, document_id, content) SELECT id, document_id, COALESCE(content, '') FROM extracts")
        .execute(repo.pool())
        .await
        .map_err(|e| format!("Reindex failed: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use std::path::PathBuf;

    async fn setup_test_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("memory db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    #[test]
    fn sanitize_handles_punctuation_operators_and_unmatched_quotes() {
        assert!(sanitize_palette_fts_query("   ").is_none());
        assert!(sanitize_palette_fts_query("+++ --- ???").is_none());

        let cpp = sanitize_palette_fts_query("C++ vector").unwrap();
        assert_eq!(cpp, "\"C\"* \"vector\"*");

        let apostrophe = sanitize_palette_fts_query("don't stop").unwrap();
        assert_eq!(apostrophe, "\"don t\"* \"stop\"*");

        let url = sanitize_palette_fts_query("http://example").unwrap();
        assert_eq!(url, "\"http example\"*");

        let ops = sanitize_palette_fts_query("\"unmatched AND NOT OR NEAR").unwrap();
        assert_eq!(ops, "\"unmatched\"* \"AND\"* \"NOT\"* \"OR\"* \"NEAR\"*");
    }

    #[test]
    fn clean_fts_snippet_strips_scripts_and_escapes_unsafe_html() {
        let dirty = "<script>alert(1)</script><p>Hello <b>__PLMS_START__vector__PLMS_END__</b> &amp; 5 &lt; 6</p>";
        let cleaned = clean_fts_snippet(dirty);
        assert!(!cleaned.contains("<script"));
        assert!(!cleaned.contains("alert"));
        assert_eq!(cleaned, "Hello <mark>vector</mark> &amp; 5 &lt; 6");

        let unclosed = "prefix __PLMS_START__truncated";
        assert_eq!(clean_fts_snippet(unclosed), "prefix <mark>truncated</mark>");
    }

    #[tokio::test]
    async fn palette_search_finds_item_9950_in_10k_docs_and_transcripts_safely() {
        let repo = setup_test_repo().await;
        let pool = repo.pool();

        // Bulk insert 10,000 documents inside a single transaction to prove no 500-doc cutoff.
        let mut tx = pool.begin().await.expect("begin tx");
        for i in 0..10_000 {
            let id = format!("doc-{i:05}");
            let title = format!("Library Note {i}");
            let content = if i == 9950 {
                "<script>xss()</script><p>Needle phrase quintessence_9950 lives only in document 9950 C++ vector don't stop http://example.</p>".to_string()
            } else {
                format!("Ordinary filler content for entry {i}.")
            };
            sqlx::query(
                "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
                 VALUES (?1, ?2, ?3, 'html', ?4, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
            )
            .bind(&id)
            .bind(&title)
            .bind(format!("/notes/{i}.html"))
            .bind(&content)
            .execute(&mut *tx)
            .await
            .expect("insert doc");
        }
        tx.commit().await.expect("commit 10k docs");

        let t0 = Instant::now();
        let res = run_palette_search(
            &repo,
            PaletteSearchQuery {
                query: "quintessence_9950".to_string(),
                limit: Some(25),
                ..Default::default()
            },
        )
        .await
        .expect("palette_search succeeds");
        assert!(t0.elapsed().as_millis() < 2_000);
        assert_eq!(res.items.len(), 1);
        assert_eq!(res.items[0].id, "doc-09950");
        assert!(res.items[0]
            .excerpt
            .as_deref()
            .unwrap_or_default()
            .contains("<mark>quintessence_9950</mark>"));
        assert!(!res.items[0]
            .excerpt
            .as_deref()
            .unwrap_or_default()
            .contains("<script"));

        // Punctuated and boolean-keyword queries must not fail in FTS5
        for q in [
            "C++ vector",
            "don't stop",
            "http://example",
            "\"unmatched AND OR NOT NEAR",
        ] {
            let punct_res = run_palette_search(
                &repo,
                PaletteSearchQuery {
                    query: q.to_string(),
                    ..Default::default()
                },
            )
            .await
            .unwrap_or_else(|e| panic!("query `{q}` must not error: {e}"));
            if !q.contains("unmatched") {
                assert!(
                    punct_res.items.iter().any(|i| i.id == "doc-09950"),
                    "query `{q}` should match doc-09950"
                );
            }
        }

        // Transcript + Flashcard + RSS search parity
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified)
             VALUES ('doc-yt-srch', 'Lecture 4', 'https://youtu.be/xyz12345678', 'youtube', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO youtube_transcripts (id, document_id, video_id, transcript, segments_json, date_created, date_modified)
             VALUES ('yt-srch', 'doc-yt-srch', 'xyz12345678', 'Backpropagation computes parameter gradients cleanly.', '[]', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO learning_items (id, document_id, item_type, question, answer, due_date, date_created, date_modified)
             VALUES ('card-1', 'doc-yt-srch', 'qa', 'What does backpropagation compute?', 'Gradients via chain rule', '2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();

        let tr_res = run_palette_search(
            &repo,
            PaletteSearchQuery {
                query: "backpropagation".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("transcript + card search");
        assert!(tr_res
            .items
            .iter()
            .any(|i| i.id == "doc-yt-srch" && i.transcript_match));
        assert!(tr_res
            .items
            .iter()
            .any(|i| i.id == "card-1" && i.result_type == "flashcard"));

        // Extracts search parity: content, notes, and page_title appear among other results
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, notes, page_title, page_number, date_created, date_modified)
             VALUES ('ext-1', 'doc-yt-srch', '<p>Backpropagation through time unrolls recurrent layers.</p>', 'Key gradient note', 'BPTT Summary', 7, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();

        let ext_res = run_palette_search(
            &repo,
            PaletteSearchQuery {
                query: "backpropagation".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("extract search among other results");
        let ext_item = ext_res
            .items
            .iter()
            .find(|i| i.id == "ext-1" && i.result_type == "extract")
            .expect("extract ext-1 must be among palette search results");
        assert_eq!(ext_item.title, "BPTT Summary");
        assert_eq!(ext_item.page_number, Some(7));
        assert!(ext_item.primary_hit.is_some());
        assert!(ext_res.items.iter().any(|i| i.id == "card-1"));

        let title_ext_res = run_palette_search(
            &repo,
            PaletteSearchQuery {
                query: "BPTT Summary".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("extract page_title search");
        assert!(title_ext_res
            .items
            .iter()
            .any(|i| i.id == "ext-1" && i.result_type == "extract"));
    }
}
