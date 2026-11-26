//! Repository operations for Language Learning ecosystem tables:
//! phrases, SRS drafts/evidence, audio alignments, lexical coverage,
//! recommendation candidates, analytics, generated docs, translation cache,
//! and processing jobs/chunks/tokens.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::language_ecosystem::{
    LanguageAnalyticsDailyRecord, LanguageAnalyticsEventInput, LanguageAudioAlignmentRecord,
    LanguageCoverageResultRecord, LanguageGeneratedDocumentRecord, LanguagePhraseRecord,
    LanguageProcessingChunkRecord, LanguageProcessingJobRecord, LanguageProcessingResultRecord,
    LanguageRecommendationCandidateRecord, LanguageSrsDraftRecord, LanguageTranslationCacheRecord,
};
use crate::models::language_lexicon::normalize_lexical_form;
use chrono::{TimeZone, Utc};
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};

fn parsed_json(value: Option<String>, fallback: Value) -> Value {
    value
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(fallback)
}

fn phrase_from_row(row: &SqliteRow) -> Result<LanguagePhraseRecord> {
    Ok(LanguagePhraseRecord {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        language_tag: row.try_get("language_tag")?,
        phrase_key: row.try_get("phrase_key")?,
        normalized_form: row.try_get("normalized_form")?,
        canonical_form: row.try_get("canonical_form")?,
        meaning: row.try_get("meaning")?,
        translation: row.try_get("translation")?,
        confidence: row.try_get("confidence")?,
        state: row.try_get("state")?,
        first_encountered_at: row.try_get("first_encountered_at")?,
        last_encountered_at: row.try_get("last_encountered_at")?,
        occurrence_count: row.try_get("occurrence_count")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

fn srs_draft_from_row(row: &SqliteRow) -> Result<LanguageSrsDraftRecord> {
    Ok(LanguageSrsDraftRecord {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        lexical_entry_id: row.try_get("lexical_entry_id")?,
        phrase_id: row.try_get("phrase_id")?,
        sentence_id: row.try_get("sentence_id")?,
        draft_key: row.try_get("draft_key")?,
        item_type: row.try_get("item_type")?,
        question: row.try_get("question")?,
        answer: row.try_get("answer")?,
        source_anchor: row
            .try_get::<Option<String>, _>("source_anchor_json")?
            .and_then(|s| serde_json::from_str(&s).ok()),
        provenance: parsed_json(row.try_get("provenance_json")?, Value::Object(Default::default())),
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn alignment_from_row(row: &SqliteRow) -> Result<LanguageAudioAlignmentRecord> {
    Ok(LanguageAudioAlignmentRecord {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        source_type: row.try_get("source_type")?,
        source_id: row.try_get("source_id")?,
        sentence_id: row.try_get("sentence_id")?,
        media_id: row.try_get("media_id")?,
        source_fingerprint: row.try_get("source_fingerprint")?,
        media_fingerprint: row.try_get("media_fingerprint")?,
        start_ms: row.try_get("start_ms")?,
        end_ms: row.try_get("end_ms")?,
        confidence: row.try_get("confidence")?,
        method: row.try_get("method")?,
        status: row.try_get("status")?,
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
        error: row.try_get("error")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn coverage_from_row(row: &SqliteRow) -> Result<LanguageCoverageResultRecord> {
    Ok(LanguageCoverageResultRecord {
        coverage_key: row.try_get("coverage_key")?,
        document_id: row.try_get("document_id")?,
        profile_id: row.try_get("profile_id")?,
        content_fingerprint: row.try_get("content_fingerprint")?,
        processor_version: row.try_get("processor_version")?,
        lexicon_state_version: row.try_get("lexicon_state_version")?,
        policy_version: row.try_get("policy_version")?,
        threshold_version: row.try_get("threshold_version")?,
        method: row.try_get("method")?,
        freshness: row.try_get("freshness")?,
        summary: row
            .try_get::<Option<String>, _>("summary_json")?
            .and_then(|s| serde_json::from_str(&s).ok()),
        unique_vocab: row
            .try_get::<Option<String>, _>("unique_vocab_json")?
            .and_then(|s| serde_json::from_str(&s).ok()),
        error: row.try_get("error")?,
        computed_at: row.try_get("computed_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn recommendation_from_row(row: &SqliteRow) -> Result<LanguageRecommendationCandidateRecord> {
    Ok(LanguageRecommendationCandidateRecord {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        source_type: row.try_get("source_type")?,
        source_id: row.try_get("source_id")?,
        source_fingerprint: row.try_get("source_fingerprint")?,
        title: row.try_get("title")?,
        url: row.try_get("url")?,
        explanation: parsed_json(row.try_get("explanation_json")?, Value::Object(Default::default())),
        ranking: parsed_json(row.try_get("ranking_json")?, Value::Object(Default::default())),
        coverage_status: row.try_get("coverage_status")?,
        lifecycle: row.try_get("lifecycle")?,
        snoozed_until: row.try_get("snoozed_until")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

impl Repository {
    // --- Phrases ---
    pub async fn upsert_language_phrase(
        &self,
        mut phrase: LanguagePhraseRecord,
    ) -> Result<LanguagePhraseRecord> {
        self.ensure_profile(&phrase.profile_id).await?;
        let now = Utc::now().timestamp();
        let norm = normalize_lexical_form(&if phrase.normalized_form.trim().is_empty() {
            phrase.canonical_form.clone()
        } else {
            phrase.normalized_form.clone()
        });
        if norm.is_empty() {
            return Err(PlethoraError::InvalidInput("Phrase text cannot be empty".to_string()));
        }
        phrase.normalized_form = norm.clone();
        if phrase.phrase_key.trim().is_empty() {
            phrase.phrase_key = format!("{}:{}", phrase.language_tag.to_lowercase(), norm);
        }
        if phrase.id.trim().is_empty() {
            phrase.id = uuid::Uuid::new_v4().to_string();
        }
        if phrase.created_at <= 0 {
            phrase.created_at = now;
        }
        phrase.updated_at = now;
        sqlx::query(
            "INSERT INTO language_phrases
             (id, profile_id, language_tag, phrase_key, normalized_form, canonical_form, meaning, translation,
              confidence, state, first_encountered_at, last_encountered_at, occurrence_count, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1)
             ON CONFLICT(profile_id, phrase_key) DO UPDATE SET
               canonical_form = COALESCE(NULLIF(excluded.canonical_form, ''), language_phrases.canonical_form),
               meaning = COALESCE(excluded.meaning, language_phrases.meaning),
               translation = COALESCE(excluded.translation, language_phrases.translation),
               confidence = COALESCE(excluded.confidence, language_phrases.confidence),
               state = excluded.state,
               last_encountered_at = COALESCE(excluded.last_encountered_at, language_phrases.last_encountered_at),
               occurrence_count = MAX(language_phrases.occurrence_count, excluded.occurrence_count),
               updated_at = excluded.updated_at,
               version = language_phrases.version + 1",
        )
        .bind(&phrase.id)
        .bind(&phrase.profile_id)
        .bind(&phrase.language_tag)
        .bind(&phrase.phrase_key)
        .bind(&phrase.normalized_form)
        .bind(&phrase.canonical_form)
        .bind(&phrase.meaning)
        .bind(&phrase.translation)
        .bind(phrase.confidence)
        .bind(&phrase.state)
        .bind(phrase.first_encountered_at)
        .bind(phrase.last_encountered_at)
        .bind(phrase.occurrence_count)
        .bind(phrase.created_at)
        .bind(phrase.updated_at)
        .execute(self.pool())
        .await?;
        let row = sqlx::query("SELECT * FROM language_phrases WHERE profile_id = ?1 AND phrase_key = ?2")
            .bind(&phrase.profile_id)
            .bind(&phrase.phrase_key)
            .fetch_one(self.pool())
            .await?;
        phrase_from_row(&row)
    }

    pub async fn list_language_phrases(
        &self,
        profile_id: &str,
        language_tag: Option<&str>,
        limit: i64,
    ) -> Result<Vec<LanguagePhraseRecord>> {
        self.ensure_profile(profile_id).await?;
        let rows = if let Some(lang) = language_tag.filter(|s| !s.trim().is_empty()) {
            sqlx::query(
                "SELECT * FROM language_phrases WHERE profile_id = ?1 AND language_tag = ?2 ORDER BY updated_at DESC LIMIT ?3",
            )
            .bind(profile_id)
            .bind(lang)
            .bind(limit.clamp(1, 500))
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM language_phrases WHERE profile_id = ?1 ORDER BY updated_at DESC LIMIT ?2",
            )
            .bind(profile_id)
            .bind(limit.clamp(1, 500))
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(phrase_from_row).collect()
    }

    pub async fn delete_language_phrase(&self, profile_id: &str, phrase_id: &str) -> Result<bool> {
        self.ensure_profile(profile_id).await?;
        let res = sqlx::query("DELETE FROM language_phrases WHERE profile_id = ?1 AND id = ?2")
            .bind(profile_id)
            .bind(phrase_id)
            .execute(self.pool())
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // --- SRS Drafts & Evidence ---
    pub async fn upsert_language_srs_draft(
        &self,
        mut draft: LanguageSrsDraftRecord,
    ) -> Result<LanguageSrsDraftRecord> {
        self.ensure_profile(&draft.profile_id).await?;
        let now = Utc::now().timestamp();
        if draft.id.trim().is_empty() {
            draft.id = uuid::Uuid::new_v4().to_string();
        }
        if draft.created_at <= 0 {
            draft.created_at = now;
        }
        draft.updated_at = now;
        sqlx::query(
            "INSERT INTO language_srs_drafts
             (id, profile_id, lexical_entry_id, phrase_id, sentence_id, draft_key, item_type,
              question, answer, source_anchor_json, provenance_json, provider_id, provider_version, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(profile_id, draft_key) DO UPDATE SET
               lexical_entry_id = COALESCE(excluded.lexical_entry_id, language_srs_drafts.lexical_entry_id),
               phrase_id = COALESCE(excluded.phrase_id, language_srs_drafts.phrase_id),
               question = excluded.question,
               answer = COALESCE(excluded.answer, language_srs_drafts.answer),
               provenance_json = excluded.provenance_json,
               status = excluded.status,
               updated_at = excluded.updated_at",
        )
        .bind(&draft.id)
        .bind(&draft.profile_id)
        .bind(&draft.lexical_entry_id)
        .bind(&draft.phrase_id)
        .bind(&draft.sentence_id)
        .bind(&draft.draft_key)
        .bind(&draft.item_type)
        .bind(&draft.question)
        .bind(&draft.answer)
        .bind(draft.source_anchor.as_ref().map(serde_json::to_string).transpose()?)
        .bind(serde_json::to_string(&draft.provenance)?)
        .bind(&draft.provider_id)
        .bind(&draft.provider_version)
        .bind(&draft.status)
        .bind(draft.created_at)
        .bind(draft.updated_at)
        .execute(self.pool())
        .await?;
        let row = sqlx::query("SELECT * FROM language_srs_drafts WHERE profile_id = ?1 AND draft_key = ?2")
            .bind(&draft.profile_id)
            .bind(&draft.draft_key)
            .fetch_one(self.pool())
            .await?;
        srs_draft_from_row(&row)
    }

    pub async fn find_language_srs_draft_by_key(
        &self,
        profile_id: &str,
        draft_key: &str,
    ) -> Result<Option<LanguageSrsDraftRecord>> {
        self.ensure_profile(profile_id).await?;
        let row = sqlx::query("SELECT * FROM language_srs_drafts WHERE profile_id = ?1 AND draft_key = ?2")
            .bind(profile_id)
            .bind(draft_key)
            .fetch_optional(self.pool())
            .await?;
        row.as_ref().map(srs_draft_from_row).transpose()
    }

    // --- Audio Alignments ---
    pub async fn upsert_language_audio_alignment(
        &self,
        mut alignment: LanguageAudioAlignmentRecord,
    ) -> Result<LanguageAudioAlignmentRecord> {
        if let Some(ref pid) = alignment.profile_id {
            self.ensure_profile(pid).await?;
        }
        let now = Utc::now().timestamp();
        if alignment.id.trim().is_empty() {
            alignment.id = uuid::Uuid::new_v4().to_string();
        }
        if alignment.created_at <= 0 {
            alignment.created_at = now;
        }
        alignment.updated_at = now;
        sqlx::query(
            "INSERT INTO language_audio_alignments
             (id, profile_id, source_type, source_id, sentence_id, media_id, source_fingerprint, media_fingerprint,
              start_ms, end_ms, confidence, method, status, provider_id, provider_version, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(profile_id, source_id, sentence_id, media_id, source_fingerprint, media_fingerprint) DO UPDATE SET
               start_ms = excluded.start_ms,
               end_ms = excluded.end_ms,
               confidence = excluded.confidence,
               method = excluded.method,
               status = excluded.status,
               error = excluded.error,
               updated_at = excluded.updated_at",
        )
        .bind(&alignment.id)
        .bind(&alignment.profile_id)
        .bind(&alignment.source_type)
        .bind(&alignment.source_id)
        .bind(&alignment.sentence_id)
        .bind(&alignment.media_id)
        .bind(&alignment.source_fingerprint)
        .bind(&alignment.media_fingerprint)
        .bind(alignment.start_ms)
        .bind(alignment.end_ms)
        .bind(alignment.confidence)
        .bind(&alignment.method)
        .bind(&alignment.status)
        .bind(&alignment.provider_id)
        .bind(&alignment.provider_version)
        .bind(&alignment.error)
        .bind(alignment.created_at)
        .bind(alignment.updated_at)
        .execute(self.pool())
        .await?;
        Ok(alignment)
    }

    pub async fn list_language_audio_alignments(
        &self,
        source_id: &str,
        profile_id: Option<&str>,
    ) -> Result<Vec<LanguageAudioAlignmentRecord>> {
        let rows = if let Some(pid) = profile_id {
            sqlx::query(
                "SELECT * FROM language_audio_alignments WHERE source_id = ?1 AND (profile_id = ?2 OR profile_id IS NULL) ORDER BY start_ms ASC",
            )
            .bind(source_id)
            .bind(pid)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM language_audio_alignments WHERE source_id = ?1 ORDER BY start_ms ASC",
            )
            .bind(source_id)
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(alignment_from_row).collect()
    }

    // --- Lexical Coverage ---
    pub async fn upsert_language_coverage_result(
        &self,
        mut record: LanguageCoverageResultRecord,
        referenced_entry_ids: Vec<String>,
    ) -> Result<LanguageCoverageResultRecord> {
        self.ensure_profile(&record.profile_id).await?;
        let now = Utc::now().timestamp();
        record.updated_at = now;
        let mut tx = self.pool().begin().await?;
        sqlx::query(
            "INSERT INTO language_lexical_coverage_results
             (coverage_key, document_id, profile_id, content_fingerprint, processor_version,
              lexicon_state_version, policy_version, threshold_version, method, freshness,
              summary_json, unique_vocab_json, error, computed_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(coverage_key) DO UPDATE SET
               freshness = excluded.freshness,
               summary_json = excluded.summary_json,
               unique_vocab_json = excluded.unique_vocab_json,
               error = excluded.error,
               computed_at = excluded.computed_at,
               updated_at = excluded.updated_at",
        )
        .bind(&record.coverage_key)
        .bind(&record.document_id)
        .bind(&record.profile_id)
        .bind(&record.content_fingerprint)
        .bind(&record.processor_version)
        .bind(&record.lexicon_state_version)
        .bind(&record.policy_version)
        .bind(&record.threshold_version)
        .bind(&record.method)
        .bind(&record.freshness)
        .bind(record.summary.as_ref().map(serde_json::to_string).transpose()?)
        .bind(record.unique_vocab.as_ref().map(serde_json::to_string).transpose()?)
        .bind(&record.error)
        .bind(record.computed_at)
        .bind(record.updated_at)
        .execute(&mut *tx)
        .await?;

        if !referenced_entry_ids.is_empty() {
            let chunk_id = "chunk_0";
            sqlx::query(
                "INSERT INTO language_lexical_coverage_chunks
                 (coverage_key, chunk_id, chunk_index, total_weight, counted_token_count, result_json, updated_at)
                 VALUES (?1, ?2, 0, 1.0, 0, '{}', ?3)
                 ON CONFLICT(coverage_key, chunk_id) DO UPDATE SET updated_at = excluded.updated_at",
            )
            .bind(&record.coverage_key)
            .bind(chunk_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            sqlx::query("DELETE FROM language_lexical_coverage_chunk_entries WHERE coverage_key = ?1")
                .bind(&record.coverage_key)
                .execute(&mut *tx)
                .await?;
            for entry_id in referenced_entry_ids {
                sqlx::query(
                    "INSERT OR IGNORE INTO language_lexical_coverage_chunk_entries
                     (coverage_key, chunk_id, profile_id, document_id, lexical_entry_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(&record.coverage_key)
                .bind(chunk_id)
                .bind(&record.profile_id)
                .bind(&record.document_id)
                .bind(&entry_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(record)
    }

    pub async fn get_language_coverage_results(
        &self,
        profile_id: &str,
        document_id: Option<&str>,
    ) -> Result<Vec<LanguageCoverageResultRecord>> {
        self.ensure_profile(profile_id).await?;
        let rows = if let Some(doc_id) = document_id {
            sqlx::query(
                "SELECT * FROM language_lexical_coverage_results WHERE profile_id = ?1 AND document_id = ?2 ORDER BY updated_at DESC",
            )
            .bind(profile_id)
            .bind(doc_id)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM language_lexical_coverage_results WHERE profile_id = ?1 ORDER BY updated_at DESC",
            )
            .bind(profile_id)
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(coverage_from_row).collect()
    }

    pub async fn invalidate_language_coverage_for_entry(
        &self,
        profile_id: &str,
        lexical_entry_id: &str,
    ) -> Result<i64> {
        self.ensure_profile(profile_id).await?;
        let now = Utc::now().timestamp();
        let res = sqlx::query(
            "UPDATE language_lexical_coverage_results
             SET freshness = 'stale', updated_at = ?1
             WHERE profile_id = ?2
               AND coverage_key IN (
                 SELECT DISTINCT coverage_key FROM language_lexical_coverage_chunk_entries
                 WHERE profile_id = ?2 AND lexical_entry_id = ?3
               )",
        )
        .bind(now)
        .bind(profile_id)
        .bind(lexical_entry_id)
        .execute(self.pool())
        .await?;
        Ok(res.rows_affected() as i64)
    }

    // --- Recommendations ---
    pub async fn upsert_language_recommendation_candidate(
        &self,
        mut candidate: LanguageRecommendationCandidateRecord,
    ) -> Result<LanguageRecommendationCandidateRecord> {
        self.ensure_profile(&candidate.profile_id).await?;
        let now = Utc::now().timestamp();
        if candidate.id.trim().is_empty() {
            candidate.id = uuid::Uuid::new_v4().to_string();
        }
        if candidate.created_at <= 0 {
            candidate.created_at = now;
        }
        candidate.updated_at = now;
        sqlx::query(
            "INSERT INTO language_recommendation_candidates
             (id, profile_id, source_type, source_id, source_fingerprint, title, url,
              explanation_json, ranking_json, coverage_status, lifecycle, snoozed_until, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(profile_id, source_type, source_id, source_fingerprint) DO UPDATE SET
               title = excluded.title,
               url = COALESCE(excluded.url, language_recommendation_candidates.url),
               explanation_json = excluded.explanation_json,
               ranking_json = excluded.ranking_json,
               coverage_status = excluded.coverage_status,
               lifecycle = excluded.lifecycle,
               snoozed_until = excluded.snoozed_until,
               updated_at = excluded.updated_at",
        )
        .bind(&candidate.id)
        .bind(&candidate.profile_id)
        .bind(&candidate.source_type)
        .bind(&candidate.source_id)
        .bind(&candidate.source_fingerprint)
        .bind(&candidate.title)
        .bind(&candidate.url)
        .bind(serde_json::to_string(&candidate.explanation)?)
        .bind(serde_json::to_string(&candidate.ranking)?)
        .bind(&candidate.coverage_status)
        .bind(&candidate.lifecycle)
        .bind(candidate.snoozed_until)
        .bind(candidate.created_at)
        .bind(candidate.updated_at)
        .execute(self.pool())
        .await?;
        let row = sqlx::query(
            "SELECT * FROM language_recommendation_candidates
             WHERE profile_id = ?1 AND source_type = ?2 AND source_id = ?3 AND source_fingerprint = ?4",
        )
        .bind(&candidate.profile_id)
        .bind(&candidate.source_type)
        .bind(&candidate.source_id)
        .bind(&candidate.source_fingerprint)
        .fetch_one(self.pool())
        .await?;
        recommendation_from_row(&row)
    }

    pub async fn list_language_recommendation_candidates(
        &self,
        profile_id: &str,
        lifecycle: Option<&str>,
    ) -> Result<Vec<LanguageRecommendationCandidateRecord>> {
        self.ensure_profile(profile_id).await?;
        let rows = if let Some(lc) = lifecycle {
            sqlx::query(
                "SELECT * FROM language_recommendation_candidates WHERE profile_id = ?1 AND lifecycle = ?2 ORDER BY updated_at DESC",
            )
            .bind(profile_id)
            .bind(lc)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM language_recommendation_candidates WHERE profile_id = ?1 ORDER BY updated_at DESC",
            )
            .bind(profile_id)
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(recommendation_from_row).collect()
    }

    // --- Analytics, Generated Documents & Translation Cache ---
    pub async fn record_language_analytics_event(
        &self,
        input: LanguageAnalyticsEventInput,
    ) -> Result<bool> {
        self.ensure_profile(&input.profile_id).await?;
        let now = input.occurred_at.unwrap_or_else(|| Utc::now().timestamp());
        let id = uuid::Uuid::new_v4().to_string();
        let res = sqlx::query(
            "INSERT OR IGNORE INTO language_analytics_events
             (id, idempotency_key, profile_id, event_kind, payload_json, occurred_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&id)
        .bind(&input.idempotency_key)
        .bind(&input.profile_id)
        .bind(&input.event_kind)
        .bind(serde_json::to_string(&input.payload)?)
        .bind(now)
        .execute(self.pool())
        .await?;
        let inserted = res.rows_affected() > 0;
        if inserted {
            let day_utc = Utc
                .timestamp_opt(now, 0)
                .single()
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
            let existing = sqlx::query_scalar::<_, String>(
                "SELECT metrics_json FROM language_analytics_daily WHERE profile_id = ?1 AND day_utc = ?2",
            )
            .bind(&input.profile_id)
            .bind(&day_utc)
            .fetch_optional(self.pool())
            .await?;
            let mut metrics: serde_json::Map<String, Value> = existing
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default();
            let prev = metrics
                .get(&input.event_kind)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            metrics.insert(input.event_kind.clone(), Value::from(prev + 1));
            sqlx::query(
                "INSERT INTO language_analytics_daily (profile_id, day_utc, metrics_json, event_cursor, updated_at)
                 VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT(profile_id, day_utc) DO UPDATE SET
                   metrics_json = excluded.metrics_json,
                   event_cursor = language_analytics_daily.event_cursor + 1,
                   updated_at = excluded.updated_at",
            )
            .bind(&input.profile_id)
            .bind(&day_utc)
            .bind(serde_json::to_string(&Value::Object(metrics))?)
            .bind(now)
            .execute(self.pool())
            .await?;
        }
        Ok(inserted)
    }

    pub async fn list_language_analytics_daily(
        &self,
        profile_id: &str,
        start_day: Option<&str>,
        end_day: Option<&str>,
    ) -> Result<Vec<LanguageAnalyticsDailyRecord>> {
        self.ensure_profile(profile_id).await?;
        let rows = sqlx::query(
            "SELECT * FROM language_analytics_daily
             WHERE profile_id = ?1
               AND (?2 IS NULL OR day_utc >= ?2)
               AND (?3 IS NULL OR day_utc <= ?3)
             ORDER BY day_utc ASC",
        )
        .bind(profile_id)
        .bind(start_day)
        .bind(end_day)
        .fetch_all(self.pool())
        .await?;
        rows.iter()
            .map(|row| {
                Ok(LanguageAnalyticsDailyRecord {
                    profile_id: row.try_get("profile_id")?,
                    day_utc: row.try_get("day_utc")?,
                    metrics: parsed_json(row.try_get("metrics_json")?, Value::Object(Default::default())),
                    event_cursor: row.try_get("event_cursor")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn record_language_generated_document(
        &self,
        mut record: LanguageGeneratedDocumentRecord,
    ) -> Result<LanguageGeneratedDocumentRecord> {
        self.ensure_profile(&record.profile_id).await?;
        if record.id.trim().is_empty() {
            record.id = uuid::Uuid::new_v4().to_string();
        }
        if record.created_at <= 0 {
            record.created_at = Utc::now().timestamp();
        }
        sqlx::query(
            "INSERT INTO language_generated_documents
             (id, profile_id, document_id, source_document_id, action_kind, target_coverage,
              measured_coverage, provider_id, model_id, prompt_summary, provenance_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(&record.id)
        .bind(&record.profile_id)
        .bind(&record.document_id)
        .bind(&record.source_document_id)
        .bind(&record.action_kind)
        .bind(record.target_coverage)
        .bind(record.measured_coverage)
        .bind(&record.provider_id)
        .bind(&record.model_id)
        .bind(&record.prompt_summary)
        .bind(serde_json::to_string(&record.provenance)?)
        .bind(record.created_at)
        .execute(self.pool())
        .await?;
        Ok(record)
    }

    pub async fn list_language_generated_documents(
        &self,
        profile_id: &str,
    ) -> Result<Vec<LanguageGeneratedDocumentRecord>> {
        self.ensure_profile(profile_id).await?;
        let rows = sqlx::query(
            "SELECT * FROM language_generated_documents WHERE profile_id = ?1 ORDER BY created_at DESC",
        )
        .bind(profile_id)
        .fetch_all(self.pool())
        .await?;
        rows.iter()
            .map(|row| {
                Ok(LanguageGeneratedDocumentRecord {
                    id: row.try_get("id")?,
                    profile_id: row.try_get("profile_id")?,
                    document_id: row.try_get("document_id")?,
                    source_document_id: row.try_get("source_document_id")?,
                    action_kind: row.try_get("action_kind")?,
                    target_coverage: row.try_get("target_coverage")?,
                    measured_coverage: row.try_get("measured_coverage")?,
                    provider_id: row.try_get("provider_id")?,
                    model_id: row.try_get("model_id")?,
                    prompt_summary: row.try_get("prompt_summary")?,
                    provenance: parsed_json(
                        row.try_get("provenance_json")?,
                        Value::Object(Default::default()),
                    ),
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect()
    }

    pub async fn put_language_translation_cache(
        &self,
        mut record: LanguageTranslationCacheRecord,
    ) -> Result<LanguageTranslationCacheRecord> {
        if record.created_at <= 0 {
            record.created_at = Utc::now().timestamp();
        }
        sqlx::query(
            "INSERT INTO language_translation_cache
             (cache_key, profile_id, source_lang, target_lang, source_hash, provider_id,
              provider_version, translation_text, confidence, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(cache_key) DO UPDATE SET
               translation_text = excluded.translation_text,
               confidence = excluded.confidence,
               expires_at = excluded.expires_at",
        )
        .bind(&record.cache_key)
        .bind(&record.profile_id)
        .bind(&record.source_lang)
        .bind(&record.target_lang)
        .bind(&record.source_hash)
        .bind(&record.provider_id)
        .bind(&record.provider_version)
        .bind(&record.translation_text)
        .bind(record.confidence)
        .bind(record.created_at)
        .bind(record.expires_at)
        .execute(self.pool())
        .await?;
        Ok(record)
    }

    pub async fn get_language_translation_cache(
        &self,
        cache_key: &str,
    ) -> Result<Option<LanguageTranslationCacheRecord>> {
        let now = Utc::now().timestamp();
        let row = sqlx::query(
            "SELECT * FROM language_translation_cache
             WHERE cache_key = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
        )
        .bind(cache_key)
        .bind(now)
        .fetch_optional(self.pool())
        .await?;
        Ok(row
            .map(|r| -> Result<LanguageTranslationCacheRecord> {
                Ok(LanguageTranslationCacheRecord {
                    cache_key: r.try_get("cache_key")?,
                    profile_id: r.try_get("profile_id")?,
                    source_lang: r.try_get("source_lang")?,
                    target_lang: r.try_get("target_lang")?,
                    source_hash: r.try_get("source_hash")?,
                    provider_id: r.try_get("provider_id")?,
                    provider_version: r.try_get("provider_version")?,
                    translation_text: r.try_get("translation_text")?,
                    confidence: r.try_get("confidence")?,
                    created_at: r.try_get("created_at")?,
                    expires_at: r.try_get("expires_at")?,
                })
            })
            .transpose()?)
    }

    // --- Processing Cache (092) ---
    pub async fn put_language_processing_job(
        &self,
        job: LanguageProcessingJobRecord,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO language_processing_jobs
             (job_id, processing_key, state, next_chunk_index, total_chunks, completed_chunks,
              retry_count, error_code, error_message, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(job_id) DO UPDATE SET
               state = excluded.state,
               next_chunk_index = excluded.next_chunk_index,
               total_chunks = excluded.total_chunks,
               completed_chunks = excluded.completed_chunks,
               retry_count = excluded.retry_count,
               error_code = excluded.error_code,
               error_message = excluded.error_message,
               updated_at = excluded.updated_at",
        )
        .bind(&job.job_id)
        .bind(&job.processing_key)
        .bind(&job.state)
        .bind(job.next_chunk_index)
        .bind(job.total_chunks)
        .bind(job.completed_chunks)
        .bind(job.retry_count)
        .bind(&job.error_code)
        .bind(&job.error_message)
        .bind(job.updated_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_language_processing_job(
        &self,
        job_id: &str,
    ) -> Result<Option<LanguageProcessingJobRecord>> {
        let row = sqlx::query("SELECT * FROM language_processing_jobs WHERE job_id = ?1")
            .bind(job_id)
            .fetch_optional(self.pool())
            .await?;
        Ok(row
            .map(|r| -> Result<LanguageProcessingJobRecord> {
                Ok(LanguageProcessingJobRecord {
                    job_id: r.try_get("job_id")?,
                    processing_key: r.try_get("processing_key")?,
                    state: r.try_get("state")?,
                    next_chunk_index: r.try_get("next_chunk_index")?,
                    total_chunks: r.try_get("total_chunks")?,
                    completed_chunks: r.try_get("completed_chunks")?,
                    retry_count: r.try_get("retry_count")?,
                    error_code: r.try_get("error_code")?,
                    error_message: r.try_get("error_message")?,
                    updated_at: r.try_get("updated_at")?,
                })
            })
            .transpose()?)
    }

    pub async fn put_language_processing_chunk(
        &self,
        chunk: LanguageProcessingChunkRecord,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO language_processing_chunks
             (processing_key, chunk_index, source_start, source_end, chunk_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(processing_key, chunk_index) DO UPDATE SET
               chunk_json = excluded.chunk_json,
               updated_at = excluded.updated_at",
        )
        .bind(&chunk.processing_key)
        .bind(chunk.chunk_index)
        .bind(chunk.source_start)
        .bind(chunk.source_end)
        .bind(serde_json::to_string(&chunk.chunk)?)
        .bind(chunk.updated_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_language_processing_chunks(
        &self,
        processing_key: &str,
    ) -> Result<Vec<LanguageProcessingChunkRecord>> {
        let rows = sqlx::query(
            "SELECT * FROM language_processing_chunks WHERE processing_key = ?1 ORDER BY chunk_index ASC",
        )
        .bind(processing_key)
        .fetch_all(self.pool())
        .await?;
        rows.iter()
            .map(|r| {
                Ok(LanguageProcessingChunkRecord {
                    processing_key: r.try_get("processing_key")?,
                    chunk_index: r.try_get("chunk_index")?,
                    source_start: r.try_get("source_start")?,
                    source_end: r.try_get("source_end")?,
                    chunk: parsed_json(r.try_get("chunk_json")?, Value::Object(Default::default())),
                    updated_at: r.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn put_language_processing_result(
        &self,
        record: LanguageProcessingResultRecord,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO language_processing_results
             (processing_key, version_json, summary_json, chunk_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(processing_key) DO UPDATE SET
               version_json = excluded.version_json,
               summary_json = excluded.summary_json,
               chunk_count = excluded.chunk_count,
               updated_at = excluded.updated_at",
        )
        .bind(&record.processing_key)
        .bind(serde_json::to_string(&record.version)?)
        .bind(serde_json::to_string(&record.summary)?)
        .bind(record.chunk_count)
        .bind(record.updated_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_language_processing_result(
        &self,
        processing_key: &str,
    ) -> Result<Option<LanguageProcessingResultRecord>> {
        let row = sqlx::query("SELECT * FROM language_processing_results WHERE processing_key = ?1")
            .bind(processing_key)
            .fetch_optional(self.pool())
            .await?;
        Ok(row
            .map(|r| -> Result<LanguageProcessingResultRecord> {
                Ok(LanguageProcessingResultRecord {
                    processing_key: r.try_get("processing_key")?,
                    version: parsed_json(r.try_get("version_json")?, Value::Object(Default::default())),
                    summary: parsed_json(r.try_get("summary_json")?, Value::Object(Default::default())),
                    chunk_count: r.try_get("chunk_count")?,
                    updated_at: r.try_get("updated_at")?,
                })
            })
            .transpose()?)
    }
}
