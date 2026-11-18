use crate::ai_learning::embeddings_backend::{
    EmbeddingBackend, EmbeddingBackendKind, ON_DEVICE_MODEL,
};
use crate::ai_learning::models::{RetrievalFilters, RetrievalResponse};
use crate::ai_learning::retrieval as semantic_retrieval;
use crate::commands::ai_learning::{ensure_embedding_consent, AiLearningState};
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::database::{
    LearningEvidenceRepository, Repository, StudyPlanRepository, StudyTrailRepository,
};
use crate::models::study_plan::StudyPlanKnowledgeAuthority;
use crate::models::study_trail::{
    AssessmentEligibilityPolicy, AssessmentEligibilitySummary, FormativeCheckOutcome,
    FormativeCheckResult, FormativePromptFormat, SegmentReadinessStatus, StudyTrailItem,
    StudyTrailItemStatus, StudyTrailOverview,
};
use crate::models::StudyCommandError;
use crate::study_trail::content_classifier::ClassificationContext;
use crate::study_trail::eligibility::evaluate_assessment_eligibility;
use crate::study_trail::planner::plan_study_trail;
use crate::study_trail::retrieval_pipeline::{
    extract_keywords, DocumentSourceForTrail, ObjectiveQuery, PreparedTrailCorpus,
};
use crate::study_trail::structural_analyzer::{
    analyze_document_structure, StructuralSourceInput, StructuralUnit, TranscriptUnitInput,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateStudyTrailInput {
    pub plan_id: String,
    pub version_id: String,
    pub node_id: Option<String>,
    pub objective_index: Option<i64>,
    pub policy: Option<AssessmentEligibilityPolicy>,
    #[serde(default)]
    pub embedding_config: Option<EmbeddingConfigInput>,
    #[serde(default)]
    pub paid_embeddings_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrailProgressInput {
    pub item_id: String,
    pub status: StudyTrailItemStatus,
    pub reading_progress: f64,
    pub last_locator: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFormativeCheckInput {
    pub plan_id: String,
    pub version_id: String,
    pub trail_item_id: String,
    pub node_id: String,
    pub objective_index: i64,
    pub prompt_format: FormativePromptFormat,
    pub prompt_text: String,
    pub learner_response: String,
    #[serde(default)]
    pub is_correct_choice: Option<bool>,
    #[serde(default)]
    pub choice_explanation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateFormativeMcInput {
    pub plan_id: String,
    pub version_id: String,
    pub trail_item_id: String,
    pub node_id: String,
    pub objective_index: i64,
    pub prompt_format: FormativePromptFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormativeMultipleChoiceQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub explanation: String,
    pub source_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideTrailAssignmentInput {
    pub item_id: String,
    pub segment_id: Option<String>,
    pub is_required: Option<bool>,
    pub manual_order_override: Option<i64>,
    pub rejected_reason: Option<String>,
}

async fn load_document_source_for_trail(
    pool: &sqlx::SqlitePool,
    document_id: &str,
) -> Result<Option<(DocumentSourceForTrail, bool)>, StudyCommandError> {
    let row: Option<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        i64,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT id, title, file_type, file_path, content, html_content,
                COALESCE(NULLIF(trim(content_hash), ''), NULLIF(trim(content_updated_at), ''), NULLIF(trim(date_added), ''), 'unknown'),
                is_archived, is_ai_excluded, is_local_only
         FROM documents WHERE id = ?",
    )
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

    let Some((
        id,
        title,
        file_type,
        file_path,
        content,
        html_content,
        revision,
        is_archived,
        is_ai_excluded,
        is_local_only,
    )) = row
    else {
        return Ok(None);
    };
    let local_only = is_local_only != 0;

    if is_archived != 0 {
        return Ok(Some((
            DocumentSourceForTrail {
                document_id: id,
                document_title: title,
                document_revision: revision,
                format: file_type,
                is_ai_excluded: is_ai_excluded != 0,
                readiness: SegmentReadinessStatus::Unavailable,
                units: vec![],
                total_length_hint: 0,
            },
            local_only,
        )));
    }

    let format = match file_type.as_str() {
        "other" => "text".to_string(),
        other => other.to_string(),
    };

    let content_str = content.unwrap_or_default();
    let html_str = html_content.unwrap_or_default();

    // Check semantic_chunks for rich indexed units (especially useful for PDFs, Transcripts, or fallback EPUBs)
    let chunk_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT text, location_json FROM semantic_chunks
         WHERE document_id = ? AND source_type IN ('document', 'transcript')
         ORDER BY CAST(COALESCE(json_extract(location_json, '$.ordinal'), 0) AS INTEGER) ASC",
    )
    .bind(&id)
    .fetch_all(pool)
    .await
    .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

    let mut units: Vec<StructuralUnit> = Vec::new();
    let mut total_len = content_str.len().max(html_str.len());

    match format.as_str() {
        "html" if !html_str.trim().is_empty() => {
            units = analyze_document_structure(StructuralSourceInput::Html {
                document_id: &id,
                html: &html_str,
            });
        }
        "markdown" if !content_str.trim().is_empty() => {
            units = analyze_document_structure(StructuralSourceInput::Markdown {
                document_id: &id,
                text: &content_str,
            });
        }
        "pdf" => {
            let disk_pages = if !file_path.trim().is_empty()
                && std::path::Path::new(&file_path).exists()
            {
                crate::processor::pdf::extract_pdf_pages_text(&file_path)
                    .await
                    .ok()
                    .filter(|p| !p.is_empty())
            } else {
                None
            };

            if let Some(pages) = disk_pages {
                total_len = pages.iter().map(|p| p.len()).sum();
                units = analyze_document_structure(StructuralSourceInput::PdfPages {
                    document_id: &id,
                    pages: &pages,
                });
            } else if !chunk_rows.is_empty() {
                // Reconstruct per-page text from semantic_chunks when file isn't accessible
                let mut pages_map: std::collections::BTreeMap<u32, Vec<String>> =
                    std::collections::BTreeMap::new();
                for (text, loc_json) in &chunk_rows {
                    let page = serde_json::from_str::<serde_json::Value>(loc_json)
                        .ok()
                        .and_then(|v| v.get("pageNumber").and_then(|p| p.as_u64()))
                        .unwrap_or(1) as u32;
                    pages_map.entry(page).or_default().push(text.clone());
                }
                let pages: Vec<String> = pages_map.into_values().map(|v| v.join("\n")).collect();
                total_len = pages.iter().map(|p| p.len()).sum();
                units = analyze_document_structure(StructuralSourceInput::PdfPages {
                    document_id: &id,
                    pages: &pages,
                });
            } else if !content_str.trim().is_empty() {
                let pages: Vec<String> = content_str.split('\u{000C}').map(str::to_string).collect();
                units = analyze_document_structure(StructuralSourceInput::PdfPages {
                    document_id: &id,
                    pages: &pages,
                });
            }
        }
        "epub" => {
            let disk_spines = if !file_path.trim().is_empty()
                && std::path::Path::new(&file_path).exists()
            {
                crate::processor::epub::extract_epub_spines(&file_path)
                    .await
                    .ok()
                    .filter(|s| !s.is_empty())
            } else {
                None
            };

            if let Some(spines) = disk_spines {
                let titled_spines: Vec<(u32, Option<String>, String)> = spines
                    .into_iter()
                    .map(|s| (s.spine_index, s.toc_title, s.content))
                    .collect();
                total_len = titled_spines
                    .iter()
                    .map(|(_, _, c)| c.len())
                    .sum::<usize>()
                    .max(content_str.len());
                units = analyze_document_structure(StructuralSourceInput::EpubTitledSpines {
                    document_id: &id,
                    spines: &titled_spines,
                });
            } else if !chunk_rows.is_empty() {
                let mut max_end = 0usize;
                for (idx, (raw_text, loc_json)) in chunk_rows.iter().enumerate() {
                    let decoded = crate::threadreader::decode_html_entities(raw_text)
                        .replace('\u{00a0}', " ");
                    let trimmed = decoded.trim();
                    let cleaned = if let Some(rest) = trimmed.strip_prefix(&title) {
                        let rest = rest.trim_start();
                        if rest.is_empty() {
                            trimmed.to_string()
                        } else {
                            rest.to_string()
                        }
                    } else {
                        trimmed.to_string()
                    };
                    let v = serde_json::from_str::<serde_json::Value>(loc_json).ok();
                    let heading_path: Vec<String> = v
                        .as_ref()
                        .and_then(|x| x.get("headingPath").and_then(|h| h.as_array()))
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|s| s.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    let start_offset = v
                        .as_ref()
                        .and_then(|x| x.get("startOffset").and_then(|n| n.as_u64()))
                        .unwrap_or(max_end as u64) as usize;
                    let end_offset = v
                        .as_ref()
                        .and_then(|x| x.get("endOffset").and_then(|n| n.as_u64()))
                        .unwrap_or((start_offset + cleaned.len()) as u64)
                        as usize;
                    let spine_index = v
                        .as_ref()
                        .and_then(|x| x.get("spineIndex").and_then(|n| n.as_u64()))
                        .map(|n| n as u32);
                    max_end = max_end.max(end_offset);
                    let unit_title = heading_path
                        .last()
                        .cloned()
                        .unwrap_or_else(|| format!("Section {}", idx + 1));
                    let wc = cleaned.split_whitespace().count();
                    units.push(StructuralUnit {
                        unit_id: format!("{}:epub:chunk:{}", id, idx),
                        document_id: id.clone(),
                        format: "epub".to_string(),
                        heading_path,
                        title: unit_title,
                        text: cleaned,
                        start_offset,
                        end_offset,
                        page_number: None,
                        end_page_number: None,
                        spine_index,
                        timestamp_ms: None,
                        end_timestamp_ms: None,
                        segment_id: None,
                        word_count: wc,
                        is_heading_only: wc <= 8,
                        is_repeated_running_line: false,
                    });
                }
                total_len = max_end.max(content_str.len());
            } else if !html_str.trim().is_empty() {
                units = analyze_document_structure(StructuralSourceInput::EpubSpines {
                    document_id: &id,
                    spines: &[(0, html_str.clone())],
                });
            } else if !content_str.trim().is_empty() {
                units = analyze_document_structure(StructuralSourceInput::EpubSpines {
                    document_id: &id,
                    spines: &[(0, content_str.clone())],
                });
            }
        }
        "youtube" | "video" | "audio" => {
            if !chunk_rows.is_empty() {
                let segs: Vec<TranscriptUnitInput> = chunk_rows
                    .iter()
                    .enumerate()
                    .map(|(idx, (text, loc_json))| {
                        let v = serde_json::from_str::<serde_json::Value>(loc_json).ok();
                        let start_ms = v
                            .as_ref()
                            .and_then(|x| x.get("timestampMs").and_then(|m| m.as_i64()))
                            .unwrap_or((idx as i64) * 30_000);
                        let end_ms = v
                            .as_ref()
                            .and_then(|x| x.get("endTimestampMs").and_then(|m| m.as_i64()))
                            .unwrap_or(start_ms + 30_000);
                        let seg_id = v
                            .as_ref()
                            .and_then(|x| x.get("segmentId").and_then(|s| s.as_str()))
                            .map(str::to_string);
                        let chapter = v
                            .as_ref()
                            .and_then(|x| x.get("headingPath").and_then(|h| h.as_array()))
                            .and_then(|arr| arr.last().and_then(|s| s.as_str()))
                            .map(str::to_string);
                        TranscriptUnitInput {
                            segment_id: seg_id,
                            start_ms,
                            end_ms,
                            text: text.clone(),
                            chapter,
                        }
                    })
                    .collect();
                units = analyze_document_structure(StructuralSourceInput::Transcript {
                    document_id: &id,
                    format: &format,
                    segments: &segs,
                });
            }
        }
        _ => {
            if !content_str.trim().is_empty() {
                units = analyze_document_structure(StructuralSourceInput::Plain {
                    document_id: &id,
                    text: &content_str,
                });
            }
        }
    }

    let readiness = if units.is_empty() {
        match format.as_str() {
            "pdf" => SegmentReadinessStatus::NeedsOcr,
            "youtube" | "video" | "audio" => SegmentReadinessStatus::NeedsTranscript,
            _ => SegmentReadinessStatus::Unindexed,
        }
    } else {
        SegmentReadinessStatus::Ready
    };

    Ok(Some((
        DocumentSourceForTrail {
            document_id: id,
            document_title: title,
            document_revision: revision,
            format,
            is_ai_excluded: is_ai_excluded != 0,
            readiness,
            units,
            total_length_hint: total_len,
        },
        local_only,
    )))
}

fn shingles_for_matching(text: &str) -> HashSet<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| w.len() >= 3)
        .collect();
    words.windows(4).map(|w| w.join(" ")).collect()
}

fn precompute_unit_shingles(
    sources: &[DocumentSourceForTrail],
) -> HashMap<&str, Vec<HashSet<String>>> {
    sources
        .iter()
        .map(|s| {
            (
                s.document_id.as_str(),
                s.units
                    .iter()
                    .map(|u| shingles_for_matching(&u.text))
                    .collect(),
            )
        })
        .collect()
}

fn map_retrieval_hits_to_units(
    sources: &[DocumentSourceForTrail],
    unit_shingles: &HashMap<&str, Vec<HashSet<String>>>,
    response: &RetrievalResponse,
) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = HashMap::new();

    for hit in &response.results {
        let Some(src) = sources.iter().find(|s| s.document_id == hit.document_id) else {
            continue;
        };
        let Some(shingle_vec) = unit_shingles.get(hit.document_id.as_str()) else {
            continue;
        };
        let norm_score = if hit.mode == "semantic" {
            ((hit.score - 0.25) / 0.55).clamp(0.05, 1.0)
        } else {
            hit.score.clamp(0.05, 1.0)
        };
        let hit_shingles = shingles_for_matching(&hit.text);
        let hit_page = hit
            .location
            .get("pageNumber")
            .and_then(|v| v.as_u64())
            .map(|p| p as u32);
        let hit_spine = hit
            .location
            .get("spineIndex")
            .and_then(|v| v.as_u64())
            .map(|s| s as u32);
        let hit_start = hit
            .location
            .get("startOffset")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);
        let hit_end = hit
            .location
            .get("endOffset")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);

        for (idx, unit) in src.units.iter().enumerate() {
            if let (Some(hp), Some(up)) = (hit_page, unit.page_number) {
                if hp != up {
                    continue;
                }
            }
            if let (Some(hs), Some(us)) = (hit_spine, unit.spine_index) {
                if hs != us {
                    continue;
                }
            }

            let offset_overlap = if matches!(unit.format.as_str(), "markdown" | "html" | "text") {
                match (hit_start, hit_end) {
                    (Some(hs), Some(he)) => hs < unit.end_offset && he > unit.start_offset,
                    _ => false,
                }
            } else {
                false
            };

            let shingle_hits = if !hit_shingles.is_empty() && !shingle_vec[idx].is_empty() {
                hit_shingles
                    .iter()
                    .filter(|s| shingle_vec[idx].contains(*s))
                    .count()
            } else {
                0
            };

            if offset_overlap || shingle_hits >= 2 {
                let entry = scores.entry(unit.unit_id.clone()).or_insert(0.0);
                if norm_score > *entry {
                    *entry = norm_score;
                }
            }
        }
    }
    scores
}

fn resolve_trail_embedding_backend(
    input: &GenerateStudyTrailInput,
    ai_state: &AiLearningState,
    any_local_only: bool,
) -> EmbeddingBackend {
    let candidate = if let Some(cfg) = input.embedding_config.as_ref() {
        if ensure_embedding_consent(Some(cfg), input.paid_embeddings_enabled).is_ok() {
            EmbeddingBackend::from_config(Some(cfg))
        } else {
            ai_state.backend()
        }
    } else {
        ai_state.backend()
    };

    match candidate.kind() {
        EmbeddingBackendKind::Cloud
            if any_local_only || input.paid_embeddings_enabled != Some(true) =>
        {
            EmbeddingBackend::OnDevice {
                model: ON_DEVICE_MODEL,
            }
        }
        _ => candidate,
    }
}

pub async fn generate_study_trail_segments_core(
    input: GenerateStudyTrailInput,
    repo: &Repository,
    embedding_backend: &EmbeddingBackend,
) -> Result<StudyTrailOverview, StudyCommandError> {
    let plan_repo = StudyPlanRepository::new(repo.pool().clone());
    let detail = plan_repo
        .get_study_plan(&input.plan_id, Some(&input.version_id))
        .await?;
    let policy = input.policy.unwrap_or_default();
    let trail_repo = StudyTrailRepository::new(repo.pool().clone());

    if matches!(
        detail.version.knowledge_authority,
        StudyPlanKnowledgeAuthority::ModelOnly
    ) {
        return trail_repo
            .get_overview(&input.plan_id, &input.version_id, policy)
            .await;
    }

    // Collect scoped document IDs from source_scope or existing source_refs
    let mut doc_ids: HashSet<String> = HashSet::new();
    if let Some(scope) = &detail.version.source_scope {
        if let Some(arr) = scope.pointer("/selected/documentIds").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(id) = item.as_str() {
                    doc_ids.insert(id.to_string());
                }
            }
        }
        if let Some(arr) = scope.get("resolvedDocuments").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(id) = item.get("documentId").and_then(|v| v.as_str()) {
                    doc_ids.insert(id.to_string());
                }
            }
        }
    }
    for res in detail.source_refs.values() {
        doc_ids.insert(res.ref_item.document_id.clone());
    }

    let mut sources = Vec::new();
    let mut any_local_only = false;
    for doc_id in doc_ids {
        if let Some((src, local_only)) = load_document_source_for_trail(repo.pool(), &doc_id).await? {
            if local_only {
                any_local_only = true;
            }
            sources.push(src);
        }
    }

    let safe_backend = if any_local_only
        && matches!(embedding_backend.kind(), EmbeddingBackendKind::Cloud)
    {
        EmbeddingBackend::OnDevice {
            model: ON_DEVICE_MODEL,
        }
    } else {
        embedding_backend.clone()
    };

    let eligible_doc_ids: Vec<String> = sources
        .iter()
        .filter(|s| !s.is_ai_excluded && s.readiness == SegmentReadinessStatus::Ready)
        .map(|s| s.document_id.clone())
        .collect();

    let now_iso = Utc::now().to_rfc3339();
    let mut all_segments = Vec::new();
    let mut all_links = Vec::new();

    struct ObjectiveTask<'a> {
        node: &'a crate::models::study_plan::StudyPlanVersionNode,
        obj_idx: usize,
        obj_text: String,
        cited_excerpts: Vec<String>,
        search_query: String,
    }

    let mut tasks: Vec<ObjectiveTask<'_>> = Vec::new();
    for node in detail.version.nodes.iter().filter(|n| n.included) {
        if let Some(ref filter_node) = input.node_id {
            if &node.node_id != filter_node {
                continue;
            }
        }
        let objectives: Vec<String> = if node.learning_objectives.is_empty() {
            vec![node.title.clone()]
        } else {
            node.learning_objectives.clone()
        };

        let cited_excerpts: Vec<String> = node
            .source_ref_ids
            .iter()
            .filter_map(|ref_id| detail.source_refs.get(ref_id))
            .filter(|res| {
                !res.ref_item.excerpt.trim().is_empty()
                    && eligible_doc_ids.contains(&res.ref_item.document_id)
            })
            .map(|res| res.ref_item.excerpt.clone())
            .collect();

        for (obj_idx, obj_text) in objectives.into_iter().enumerate() {
            let obj_i64 = obj_idx as i64;
            if let Some(filter_obj) = input.objective_index {
                if obj_i64 != filter_obj {
                    continue;
                }
            }
            let search_query = format!("{} {}", node.title, obj_text);
            tasks.push(ObjectiveTask {
                node,
                obj_idx,
                obj_text,
                cited_excerpts: cited_excerpts.clone(),
                search_query,
            });
        }
    }

    let retrieval_responses: Vec<Option<RetrievalResponse>> =
        if eligible_doc_ids.is_empty() || tasks.is_empty() {
            vec![None; tasks.len()]
        } else {
            let filters = RetrievalFilters {
                document_ids: Some(eligible_doc_ids.clone()),
                source_types: Some(vec![
                    "document".to_string(),
                    "transcript".to_string(),
                    "session".to_string(),
                ]),
            };
            let queries: Vec<String> = tasks.iter().map(|t| t.search_query.clone()).collect();
            match semantic_retrieval::retrieve_batch(repo, &safe_backend, &queries, 24, &filters)
                .await
            {
                Ok(resps) if resps.len() == tasks.len() => resps.into_iter().map(Some).collect(),
                _ => vec![None; tasks.len()],
            }
        };

    let has_any_retrieval_hits = retrieval_responses
        .iter()
        .any(|r| r.as_ref().is_some_and(|resp| !resp.results.is_empty()));
    let unit_shingles = if has_any_retrieval_hits {
        precompute_unit_shingles(&sources)
    } else {
        HashMap::new()
    };

    let mut corpus = PreparedTrailCorpus::new(&sources);
    let mut node_primary_units_map: HashMap<String, HashSet<String>> = HashMap::new();

    for (task, resp_opt) in tasks.into_iter().zip(retrieval_responses.into_iter()) {
        let unit_retrieval_scores = match resp_opt {
            Some(ref resp) if !resp.results.is_empty() => {
                map_retrieval_hits_to_units(&sources, &unit_shingles, resp)
            }
            _ => HashMap::new(),
        };

        let node_primary_units = node_primary_units_map
            .entry(task.node.node_id.clone())
            .or_default();

        let query = ObjectiveQuery {
            plan_id: input.plan_id.clone(),
            version_id: input.version_id.clone(),
            node_id: task.node.node_id.clone(),
            node_title: task.node.title.clone(),
            node_summary: task.node.summary.clone(),
            objective_index: task.obj_idx as i64,
            objective_text: task.obj_text.clone(),
            context: ClassificationContext::from_objective_text(&task.obj_text),
            cited_excerpts: task.cited_excerpts,
            unit_retrieval_scores,
            assigned_primary_units: node_primary_units.clone(),
        };
        let res = corpus.retrieve_for_objective(&query, &now_iso);
        if let Some(primary) = res.segments.first() {
            if let Some(ids) = primary.provenance.get("unitIds").and_then(|v| v.as_array()) {
                for uid in ids.iter().filter_map(|u| u.as_str()) {
                    node_primary_units.insert(uid.to_string());
                }
            }
        }
        all_segments.extend(res.segments);
        all_links.extend(res.links);
    }

    trail_repo
        .upsert_segments_and_links(
            &input.version_id,
            input.node_id.as_deref(),
            input.objective_index,
            &all_segments,
            &all_links,
        )
        .await?;

    // Recompute Study Trail order using full overview state
    let current = trail_repo
        .get_overview(&input.plan_id, &input.version_id, policy)
        .await?;
    let planned_items = plan_study_trail(
        &input.plan_id,
        &input.version_id,
        &detail.version.nodes,
        &detail.version.prerequisites,
        &current.objective_links,
        &current.segments,
        &current.trail_items,
        &now_iso,
    );
    trail_repo
        .replace_trail_items(&input.version_id, &planned_items)
        .await?;

    trail_repo
        .get_overview(&input.plan_id, &input.version_id, policy)
        .await
}

#[tauri::command]
pub async fn generate_study_trail_segments(
    input: GenerateStudyTrailInput,
    repo: State<'_, Repository>,
    ai_state: State<'_, AiLearningState>,
) -> Result<StudyTrailOverview, StudyCommandError> {
    let backend = resolve_trail_embedding_backend(&input, ai_state.inner(), false);
    generate_study_trail_segments_core(input, repo.inner(), &backend).await
}

#[tauri::command]
pub async fn get_study_trail_overview(
    plan_id: String,
    version_id: String,
    policy: Option<AssessmentEligibilityPolicy>,
    repo: State<'_, Repository>,
    ai_state: State<'_, AiLearningState>,
) -> Result<StudyTrailOverview, StudyCommandError> {
    let resolved_policy = policy.unwrap_or_default();
    let overview = StudyTrailRepository::new(repo.pool().clone())
        .get_overview(&plan_id, &version_id, resolved_policy)
        .await?;

    let has_stale_segments = !overview.segments.is_empty()
        && overview.segments.iter().any(|s| {
            s.generator_version != crate::study_trail::retrieval_pipeline::GENERATOR_VERSION
        });

    if has_stale_segments {
        let upgrade_input = GenerateStudyTrailInput {
            plan_id,
            version_id,
            node_id: None,
            objective_index: None,
            policy: Some(resolved_policy),
            embedding_config: None,
            paid_embeddings_enabled: None,
        };
        let backend = resolve_trail_embedding_backend(&upgrade_input, ai_state.inner(), false);
        if let Ok(upgraded) =
            generate_study_trail_segments_core(upgrade_input, repo.inner(), &backend).await
        {
            return Ok(upgraded);
        }
    }

    Ok(overview)
}

#[tauri::command]
pub async fn update_study_trail_item_progress(
    input: UpdateTrailProgressInput,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    let now_iso = Utc::now().to_rfc3339();
    StudyTrailRepository::new(repo.pool().clone())
        .update_item_progress(
            &input.item_id,
            input.status,
            input.reading_progress,
            input.last_locator,
            &now_iso,
        )
        .await
}

#[tauri::command]
pub async fn submit_formative_check(
    input: SubmitFormativeCheckInput,
    repo: State<'_, Repository>,
) -> Result<FormativeCheckResult, StudyCommandError> {
    let now_iso = Utc::now().to_rfc3339();
    let trail_repo = StudyTrailRepository::new(repo.pool().clone());
    let overview = trail_repo
        .get_overview(&input.plan_id, &input.version_id, AssessmentEligibilityPolicy::default())
        .await?;

    let item = overview
        .trail_items
        .iter()
        .find(|i| i.id == input.trail_item_id);
    let segment = item
        .and_then(|i| i.segment_id.as_ref())
        .and_then(|sid| overview.segments.iter().find(|s| &s.id == sid));

    let (outcome, feedback, recommended_segment_id) = match input.is_correct_choice {
        Some(true) => (
            FormativeCheckOutcome::Understood,
            input
                .choice_explanation
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    "Correct — your selection aligns with the key reasoning in the assigned reading.".to_string()
                }),
            None,
        ),
        Some(false) => (
            FormativeCheckOutcome::NeedsReview,
            input
                .choice_explanation
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    "Not quite — revisit the assigned passage to see how the author frames this concept.".to_string()
                }),
            segment.map(|s| s.id.clone()),
        ),
        None => {
            // Deterministic source-grounded evaluation of written learner response (never touches exam_grades or FSRS)
            let response_words: Vec<String> = input
                .learner_response
                .split_whitespace()
                .map(|w| w.to_ascii_lowercase())
                .collect();
            let ref_keywords = segment
                .map(|s| extract_keywords(&format!("{} {}", s.title, s.excerpt_preview)))
                .unwrap_or_default();
            let overlap = ref_keywords
                .iter()
                .filter(|kw| response_words.iter().any(|w| w.contains(kw.as_str())))
                .count();

            if response_words.len() < 8 {
                (
                    FormativeCheckOutcome::NeedsReview,
                    "Your response is quite brief. Try explaining the core idea and reasoning in your own words, or review the assigned section.".to_string(),
                    segment.map(|s| s.id.clone()),
                )
            } else if !ref_keywords.is_empty() && overlap == 0 {
                (
                    FormativeCheckOutcome::Partial,
                    "You wrote a thoughtful response, though it doesn't yet connect to the key concepts in the assigned reading. Revisit the section to check how the author frames them.".to_string(),
                    segment.map(|s| s.id.clone()),
                )
            } else {
                (
                    FormativeCheckOutcome::Understood,
                    "Solid explanation grounded in the core concepts of this section. You are ready to advance.".to_string(),
                    None,
                )
            }
        }
    };

    let result = FormativeCheckResult {
        id: format!("fcr_{}", Uuid::new_v4().simple()),
        plan_id: input.plan_id,
        version_id: input.version_id,
        trail_item_id: input.trail_item_id,
        node_id: input.node_id,
        objective_index: input.objective_index,
        prompt_format: input.prompt_format,
        prompt_text: input.prompt_text,
        learner_response: input.learner_response,
        outcome,
        feedback,
        recommended_segment_id,
        created_at: now_iso.clone(),
    };

    trail_repo.record_formative_check(&result, &now_iso).await?;
    Ok(result)
}

fn parse_formative_mc_json(raw: &str) -> Option<FormativeMultipleChoiceQuestion> {
    let trimmed = raw.trim();
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    let slice = &trimmed[start..=end];
    let v: serde_json::Value = serde_json::from_str(slice).ok()?;
    let question = v.get("question")?.as_str()?.trim().to_string();
    let options_arr = v.get("options")?.as_array()?;
    if options_arr.len() != 4 {
        return None;
    }
    let options: Vec<String> = options_arr
        .iter()
        .filter_map(|o| o.as_str().map(|s| s.trim().to_string()))
        .collect();
    if options.len() != 4 || options.iter().any(|o| o.is_empty()) {
        return None;
    }
    let correct_index = v.get("correctIndex").or_else(|| v.get("correct_index"))?.as_u64()? as usize;
    if correct_index >= 4 {
        return None;
    }
    let explanation = v
        .get("explanation")
        .and_then(|e| e.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Grounded in the assigned reading passage.".to_string());

    if question.is_empty() {
        return None;
    }

    Some(FormativeMultipleChoiceQuestion {
        question,
        options,
        correct_index,
        explanation,
        source_mode: "ai".to_string(),
    })
}

fn build_deterministic_formative_mc(
    node_title: &str,
    objective_text: &str,
    segment_title: Option<&str>,
    excerpt_preview: Option<&str>,
    prompt_format: FormativePromptFormat,
    seed_key: &str,
) -> FormativeMultipleChoiceQuestion {
    let excerpt_clean = excerpt_preview
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let first_sentence = excerpt_clean
        .split(['.', '!', '?'])
        .map(str::trim)
        .find(|s| s.split_whitespace().count() >= 6)
        .map(|s| {
            if s.len() > 180 {
                format!("{}…", &s[..177])
            } else {
                format!("{s}.")
            }
        });

    let section_label = segment_title.unwrap_or(node_title);
    let question = match prompt_format {
        FormativePromptFormat::ApplyExample => {
            format!("Which choice best applies {node_title} ({objective_text})?")
        }
        FormativePromptFormat::DistinguishConcepts => {
            format!("Which statement accurately distinguishes the core idea in {node_title}?")
        }
        FormativePromptFormat::ArgumentFromPremises => {
            format!("Based on \"{section_label}\", what reasoning supports {node_title}?")
        }
        FormativePromptFormat::IdentifyMisconception => {
            format!("Which statement avoids a common misconception about {node_title}?")
        }
        FormativePromptFormat::ExplainOwnWords | FormativePromptFormat::SourceGroundedShortAnswer => {
            format!("Based on \"{section_label}\", which statement best captures: {objective_text}?")
        }
    };

    let correct_option = if let Some(ref sentence) = first_sentence {
        format!("As presented in \"{section_label}\": {sentence}")
    } else {
        format!("It directly addresses {objective_text} within the context of {node_title}.")
    };

    let distractors = [
        format!(
            "It argues that {node_title} is unrelated to {objective_text} and should be ignored."
        ),
        format!(
            "It claims {node_title} works identically regardless of context, conditions, or mechanisms."
        ),
        format!(
            "It treats {node_title} as a purely superficial label with no underlying mechanism."
        ),
    ];

    let hash: usize = seed_key.bytes().fold(0usize, |acc, b| acc.wrapping_mul(31).wrapping_add(b as usize));
    let correct_index = hash % 4;
    let mut options = Vec::with_capacity(4);
    let mut d_idx = 0;
    for i in 0..4 {
        if i == correct_index {
            options.push(correct_option.clone());
        } else {
            options.push(distractors[d_idx].clone());
            d_idx += 1;
        }
    }

    FormativeMultipleChoiceQuestion {
        question,
        options,
        correct_index,
        explanation: format!(
            "Grounded in \"{section_label}\": this option aligns with the passage's explanation of {node_title}."
        ),
        source_mode: "deterministic".to_string(),
    }
}

#[tauri::command]
pub async fn generate_formative_multiple_choice(
    input: GenerateFormativeMcInput,
    repo: State<'_, Repository>,
    ai_state: State<'_, crate::commands::ai::AIState>,
) -> Result<FormativeMultipleChoiceQuestion, StudyCommandError> {
    let trail_repo = StudyTrailRepository::new(repo.pool().clone());
    let overview = trail_repo
        .get_overview(&input.plan_id, &input.version_id, AssessmentEligibilityPolicy::default())
        .await?;
    let plan_detail = StudyPlanRepository::new(repo.pool().clone())
        .get_study_plan(&input.plan_id, Some(&input.version_id))
        .await?;

    let node = plan_detail
        .version
        .nodes
        .iter()
        .find(|n| n.node_id == input.node_id);
    let node_title = node
        .map(|n| n.title.as_str())
        .unwrap_or("Current Concept");
    let objective_text = node
        .and_then(|n| n.learning_objectives.get(input.objective_index.max(0) as usize))
        .map(String::as_str)
        .unwrap_or(node_title);

    let item = overview
        .trail_items
        .iter()
        .find(|i| i.id == input.trail_item_id);
    let segment = item
        .and_then(|i| i.segment_id.as_ref())
        .and_then(|sid| overview.segments.iter().find(|s| &s.id == sid));

    let seed_key = format!("{}:{}", input.trail_item_id, input.prompt_format.as_str());
    let fallback = build_deterministic_formative_mc(
        node_title,
        objective_text,
        segment.map(|s| s.title.as_str()),
        segment.map(|s| s.excerpt_preview.as_str()),
        input.prompt_format,
        &seed_key,
    );

    // Check document privacy flags before sending passage text to a cloud LLM
    let (is_local_only, is_ai_excluded) = if let Some(seg) = segment {
        sqlx::query_as::<_, (i64, i64)>(
            "SELECT is_local_only, is_ai_excluded FROM documents WHERE id = ?",
        )
        .bind(&seg.document_id)
        .fetch_optional(repo.pool())
        .await
        .ok()
        .flatten()
        .map(|(l, e)| (l != 0, e != 0))
        .unwrap_or((false, false))
    } else {
        (false, false)
    };

    if is_ai_excluded {
        return Ok(fallback);
    }

    let ai_config = ai_state.config.lock().ok().and_then(|g| g.clone());
    if let Some(config) = ai_config {
        let is_cloud = !matches!(
            config.default_provider,
            crate::ai::providers::LLMProviderType::Ollama
        );
        if is_local_only && is_cloud {
            return Ok(fallback);
        }

        if let Ok(provider) = crate::ai::AIProvider::from_config(
            config.default_provider,
            &config.api_keys,
            &config.models,
            &config.local_settings,
        ) {
            if provider.is_available() {
                let passage_context = segment
                    .map(|s| format!("Section: {}\nExcerpt: {}", s.title, s.excerpt_preview))
                    .unwrap_or_else(|| format!("Topic: {}", node_title));
                let focus_hint = match input.prompt_format {
                    FormativePromptFormat::ExplainOwnWords => "core definition and main idea",
                    FormativePromptFormat::ApplyExample => "applying the concept to a concrete example",
                    FormativePromptFormat::DistinguishConcepts => "distinguishing this concept from a related idea",
                    FormativePromptFormat::ArgumentFromPremises => "how the conclusion follows from the passage's reasoning",
                    FormativePromptFormat::IdentifyMisconception => "spotting a common misconception",
                    FormativePromptFormat::SourceGroundedShortAnswer => "key reasoning from the passage",
                };

                let system_prompt = "You create concise, fair, single-question multiple-choice comprehension checks grounded in a reading passage. Respond ONLY with valid JSON: {\"question\": string, \"options\": [string, string, string, string], \"correctIndex\": number (0-3), \"explanation\": string (1 concise sentence)}.";
                let user_prompt = format!(
                    "Concept: {node_title}\nLearning Objective: {objective_text}\nQuestion Focus: {focus_hint}\n\nReading Context:\n{passage_context}\n\nWrite 1 clear multiple-choice question with 4 distinct options (one clearly correct, three plausible distractors)."
                );

                let req = crate::ai::providers::ChatCompletionRequest {
                    messages: vec![
                        crate::ai::providers::Message::system(system_prompt),
                        crate::ai::providers::Message::user(user_prompt),
                    ],
                    temperature: 0.3,
                    max_tokens: 512,
                    stream: false,
                };

                if let Ok(resp) = provider.chat_completion(&req).await {
                    if let Some(parsed) = parse_formative_mc_json(&resp.content) {
                        return Ok(parsed);
                    }
                }
            }
        }
    }

    Ok(fallback)
}

#[tauri::command]
pub async fn override_study_trail_assignment(
    input: OverrideTrailAssignmentInput,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    let now_iso = Utc::now().to_rfc3339();
    StudyTrailRepository::new(repo.pool().clone())
        .override_trail_item(
            &input.item_id,
            input.segment_id.as_deref(),
            input.is_required,
            input.manual_order_override,
            input.rejected_reason.as_deref(),
            &now_iso,
        )
        .await
}

#[tauri::command]
pub async fn check_assessment_eligibility(
    plan_id: String,
    version_id: String,
    policy: Option<AssessmentEligibilityPolicy>,
    repo: State<'_, Repository>,
) -> Result<AssessmentEligibilitySummary, StudyCommandError> {
    let overview = StudyTrailRepository::new(repo.pool().clone())
        .get_overview(&plan_id, &version_id, policy.unwrap_or_default())
        .await?;
    Ok(evaluate_assessment_eligibility(
        policy.unwrap_or_default(),
        &overview.trail_items,
    ))
}

#[tauri::command]
pub async fn get_remediation_trail_items(
    plan_id: String,
    version_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyTrailItem>, StudyCommandError> {
    let gaps = LearningEvidenceRepository::new(repo.pool().clone())
        .list_learning_gaps(Some(&plan_id), false)
        .await?;
    let trail_repo = StudyTrailRepository::new(repo.pool().clone());
    let overview = trail_repo
        .get_overview(&plan_id, &version_id, AssessmentEligibilityPolicy::default())
        .await?;
    let plan_detail = StudyPlanRepository::new(repo.pool().clone())
        .get_study_plan(&plan_id, Some(&version_id))
        .await?;
    let now_iso = Utc::now().to_rfc3339();

    let mut created = Vec::new();
    for gap in gaps {
        let Some(node_id) = gap.node_id.clone() else {
            continue;
        };
        // Check if an unmet prerequisite exists for this node
        let prereq_node = plan_detail
            .version
            .prerequisites
            .iter()
            .find(|p| p.dependent_node_id == node_id)
            .and_then(|p| {
                let done = overview
                    .trail_items
                    .iter()
                    .any(|i| i.node_id == p.prerequisite_node_id && i.status.is_completed());
                if !done {
                    Some(p.prerequisite_node_id.clone())
                } else {
                    None
                }
            });

        let target_node = prereq_node.clone().unwrap_or_else(|| node_id.clone());
        let target_link = overview
            .objective_links
            .iter()
            .find(|l| l.node_id == target_node && l.is_primary)
            .or_else(|| overview.objective_links.iter().find(|l| l.node_id == target_node));

        let Some(link) = target_link else {
            continue;
        };

        let rationale = if prereq_node.is_some() {
            format!(
                "Targeted remediation: review prerequisite concept before retrying {} ({})",
                gap.concept_name, gap.kind
            )
        } else {
            format!(
                "Targeted remediation for {}: {}",
                gap.concept_name, gap.kind
            )
        };

        let item = StudyTrailItem {
            id: format!("rem_{}", gap.id),
            plan_id: plan_id.clone(),
            version_id: version_id.clone(),
            node_id: target_node,
            objective_index: link.objective_index,
            segment_id: Some(link.segment_id.clone()),
            trail_order: 0,
            session_group_id: None,
            status: StudyTrailItemStatus::Pending,
            reading_progress: 0.0,
            last_locator: None,
            is_required: true,
            is_remediation: true,
            remediation_gap_id: Some(gap.id.clone()),
            manual_order_override: None,
            rejected_reason: None,
            planner_rationale: rationale,
            updated_at: now_iso.clone(),
        };
        trail_repo.upsert_remediation_item(&item).await?;
        created.push(item);
    }
    Ok(created)
}
