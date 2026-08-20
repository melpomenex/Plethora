//! Durable, profile-scoped lexical identity and occurrence storage.
//!
//! This repository deliberately has no dependency on learning-items or Queue
//! writes.  Encounter and lookup operations update only the language tables.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::language_lexicon::{
    clamp_context_text, normalize_lexical_form, stable_occurrence_key, EncounterBatchResult,
    EncounterInput, LanguageLexicalAnalysis, LanguageLexicalEntry, LanguageLexiconExport,
    LanguageLexiconSyncEnvelope, LanguageLookupEvent, LanguageOccurrence, LanguageSurfaceForm,
    LexicalEntryOverride, LexicalEntryUpsert, LexicalObjectKind, LexiconPage, LegacyLookupRecord,
    LookupInput, OrphanState, SourceAnchor, DEFAULT_OCCURRENCE_PAGE_SIZE,
    LANGUAGE_LEXICON_SCHEMA_VERSION, MAX_OCCURRENCE_PAGE_SIZE,
};
use chrono::Utc;
use sqlx::{sqlite::SqliteRow, Row, Sqlite};
use serde_json::Value;
use std::collections::HashSet;

fn json<T: serde::Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}

fn parsed<T: serde::de::DeserializeOwned>(value: Option<String>, default: T) -> T {
    value
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(default)
}

fn page_bounds(offset: i64, limit: i64) -> (i64, i64) {
    (offset.max(0), limit.clamp(1, MAX_OCCURRENCE_PAGE_SIZE))
}

fn entry_from_row(row: &SqliteRow) -> Result<LanguageLexicalEntry> {
    let object_kind = match row.try_get::<String, _>("object_kind")?.as_str() {
        "phrase" => LexicalObjectKind::Phrase,
        _ => LexicalObjectKind::Token,
    };
    Ok(LanguageLexicalEntry {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        language_tag: row.try_get("language_tag")?,
        object_kind,
        lexical_key: row.try_get("lexical_key")?,
        normalized_form: row.try_get("normalized_form")?,
        canonical_form: row.try_get("canonical_form")?,
        lemma: row.try_get("lemma")?,
        meanings: parsed(row.try_get("meanings_json")?, Vec::new()),
        translations: parsed(row.try_get("translations_json")?, Vec::new()),
        part_of_speech: row.try_get("part_of_speech")?,
        pronunciation: row.try_get("pronunciation")?,
        frequency: row.try_get("frequency")?,
        cefr_level: row.try_get("cefr_level")?,
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
        processor_id: row.try_get("processor_id")?,
        processor_version: row.try_get("processor_version")?,
        identity_confidence: row.try_get("identity_confidence")?,
        first_encountered_at: row.try_get("first_encountered_at")?,
        last_encountered_at: row.try_get("last_encountered_at")?,
        encounter_count: row.try_get("encounter_count")?,
        document_count: row.try_get("document_count")?,
        lookup_count: row.try_get("lookup_count")?,
        active_evidence_count: row.try_get("active_evidence_count")?,
        passive_evidence_count: row.try_get("passive_evidence_count")?,
        knowledge_state: row.try_get("knowledge_state")?,
        review_relationships: parsed(row.try_get("review_relationships_json")?, Value::Object(Default::default())),
        user_notes: row.try_get("user_notes")?,
        ignored: row.try_get::<i64, _>("ignored")? != 0,
        proper_noun: row.try_get::<i64, _>("proper_noun")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

fn surface_from_row(row: &SqliteRow) -> Result<LanguageSurfaceForm> {
    Ok(LanguageSurfaceForm {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        lexical_entry_id: row.try_get("lexical_entry_id")?,
        language_tag: row.try_get("language_tag")?,
        surface: row.try_get("surface")?,
        normalized: row.try_get("normalized")?,
        first_seen_at: row.try_get("first_seen_at")?,
        last_seen_at: row.try_get("last_seen_at")?,
        occurrence_count: row.try_get("occurrence_count")?,
    })
}

fn analysis_from_row(row: &SqliteRow) -> Result<LanguageLexicalAnalysis> {
    Ok(LanguageLexicalAnalysis {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        lexical_entry_id: row.try_get("lexical_entry_id")?,
        surface_form_id: row.try_get("surface_form_id")?,
        token_id: row.try_get("token_id")?,
        sentence_id: row.try_get("sentence_id")?,
        processing_key: row.try_get("processing_key")?,
        processor_id: row.try_get("processor_id")?,
        processor_version: row.try_get("processor_version")?,
        lemma: row.try_get("lemma")?,
        part_of_speech: row.try_get("part_of_speech")?,
        morphology: parsed(row.try_get("morphology_json")?, Value::Object(Default::default())),
        confidence: row.try_get("confidence")?,
        authoritative: row.try_get::<i64, _>("authoritative")? != 0,
        created_at: row.try_get("created_at")?,
    })
}

fn occurrence_from_row(row: &SqliteRow) -> Result<LanguageOccurrence> {
    let orphan_state = match row.try_get::<String, _>("orphan_state")?.as_str() {
        "orphaned" => OrphanState::Orphaned,
        "retained" => OrphanState::Retained,
        _ => OrphanState::Live,
    };
    Ok(LanguageOccurrence {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        lexical_entry_id: row.try_get("lexical_entry_id")?,
        surface_form_id: row.try_get("surface_form_id")?,
        language_tag: row.try_get("language_tag")?,
        surface: row.try_get("surface")?,
        normalized: row.try_get("normalized")?,
        source_type: row.try_get("source_type")?,
        document_id: row.try_get("document_id")?,
        media_id: row.try_get("media_id")?,
        source_id: row.try_get("source_id")?,
        sentence_id: row.try_get("sentence_id")?,
        token_id: row.try_get("token_id")?,
        content_fingerprint: row.try_get("content_fingerprint")?,
        source_anchor: parsed(row.try_get("source_anchor_json")?, None),
        context_reference: row.try_get("context_reference")?,
        context_hash: row.try_get("context_hash")?,
        context_text: row.try_get("context_text")?,
        encountered_at: row.try_get("encountered_at")?,
        last_encountered_at: row.try_get("last_encountered_at")?,
        repeat_count: row.try_get("repeat_count")?,
        audio_start_ms: row.try_get("audio_start_ms")?,
        audio_end_ms: row.try_get("audio_end_ms")?,
        was_lookup: row.try_get::<i64, _>("was_lookup")? != 0,
        was_interacted: row.try_get::<i64, _>("was_interacted")? != 0,
        processing_key: row.try_get("processing_key")?,
        confidence: row.try_get("confidence")?,
        orphan_state,
        orphaned_at: row.try_get("orphaned_at")?,
        retention_expires_at: row.try_get("retention_expires_at")?,
        occurrence_key: row.try_get("occurrence_key")?,
    })
}

fn lookup_from_row(row: &SqliteRow) -> Result<LanguageLookupEvent> {
    Ok(LanguageLookupEvent {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        lexical_entry_id: row.try_get("lexical_entry_id")?,
        surface: row.try_get("surface")?,
        normalized: row.try_get("normalized")?,
        document_id: row.try_get("document_id")?,
        media_id: row.try_get("media_id")?,
        source_anchor: parsed(row.try_get("source_anchor_json")?, None),
        looked_up_at: row.try_get("looked_up_at")?,
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
    })
}

fn check_page<T>(items: Vec<T>, offset: i64, limit: i64, total: i64) -> LexiconPage<T> {
    LexiconPage {
        has_more: offset + (items.len() as i64) < total,
        items,
        offset,
        limit,
        total,
    }
}

impl Repository {
    async fn ensure_profile(&self, profile_id: &str) -> Result<()> {
        let exists = sqlx::query_scalar::<_, String>(
            "SELECT id FROM language_profiles WHERE id = ?1 AND lifecycle <> 'deleted'",
        )
        .bind(profile_id)
        .fetch_optional(self.pool())
        .await?;
        if exists.is_none() {
            return Err(PlethoraError::NotFound(format!("Language profile {profile_id}")));
        }
        Ok(())
    }

    async fn upsert_entry_in_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        input: &LexicalEntryUpsert,
    ) -> Result<String> {
        let normalized = normalize_lexical_form(&input.normalized_form);
        if input.profile_id.trim().is_empty() || normalized.is_empty() {
            return Err(PlethoraError::InvalidInput(
                "Profile ID and normalized lexical form are required".to_string(),
            ));
        }
        let lexical_key = normalize_lexical_form(
            input
                .lemma
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&normalized),
        );
        let canonical = input
            .canonical_form
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or(input.lemma.as_deref())
            .unwrap_or(&normalized)
            .trim()
            .to_string();
        let id = input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        sqlx::query(
            "INSERT INTO language_lexical_entries
             (id, profile_id, language_tag, object_kind, lexical_key, normalized_form,
              canonical_form, lemma, meanings_json, translations_json, part_of_speech,
              pronunciation, frequency, cefr_level, provider_id, provider_version,
              processor_id, processor_version, identity_confidence, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                     ?15, ?16, ?17, ?18, ?19, ?20, ?20, 1)
             ON CONFLICT(profile_id, language_tag, object_kind, lexical_key)
             DO UPDATE SET normalized_form = excluded.normalized_form,
                canonical_form = CASE WHEN excluded.canonical_form <> '' THEN excluded.canonical_form ELSE language_lexical_entries.canonical_form END,
                lemma = COALESCE(excluded.lemma, language_lexical_entries.lemma),
                meanings_json = CASE WHEN excluded.meanings_json <> '[]' THEN excluded.meanings_json ELSE language_lexical_entries.meanings_json END,
                translations_json = CASE WHEN excluded.translations_json <> '[]' THEN excluded.translations_json ELSE language_lexical_entries.translations_json END,
                part_of_speech = COALESCE(excluded.part_of_speech, language_lexical_entries.part_of_speech),
                pronunciation = COALESCE(excluded.pronunciation, language_lexical_entries.pronunciation),
                frequency = COALESCE(excluded.frequency, language_lexical_entries.frequency),
                cefr_level = COALESCE(excluded.cefr_level, language_lexical_entries.cefr_level),
                provider_id = COALESCE(excluded.provider_id, language_lexical_entries.provider_id),
                provider_version = COALESCE(excluded.provider_version, language_lexical_entries.provider_version),
                processor_id = COALESCE(excluded.processor_id, language_lexical_entries.processor_id),
                processor_version = COALESCE(excluded.processor_version, language_lexical_entries.processor_version),
                identity_confidence = COALESCE(excluded.identity_confidence, language_lexical_entries.identity_confidence),
                updated_at = excluded.updated_at, version = language_lexical_entries.version + 1",
        )
        .bind(&id)
        .bind(&input.profile_id)
        .bind(&input.language_tag)
        .bind(input.object_kind.as_str())
        .bind(&lexical_key)
        .bind(&normalized)
        .bind(&canonical)
        .bind(&input.lemma)
        .bind(json(&input.meanings)?)
        .bind(json(&input.translations)?)
        .bind(&input.part_of_speech)
        .bind(&input.pronunciation)
        .bind(input.frequency)
        .bind(&input.cefr_level)
        .bind(&input.provider_id)
        .bind(&input.provider_version)
        .bind(&input.processor_id)
        .bind(&input.processor_version)
        .bind(input.identity_confidence)
        .bind(Utc::now().timestamp())
        .execute(&mut **tx)
        .await?;
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM language_lexical_entries
             WHERE profile_id = ?1 AND language_tag = ?2 AND object_kind = ?3 AND lexical_key = ?4",
        )
        .bind(&input.profile_id)
        .bind(&input.language_tag)
        .bind(input.object_kind.as_str())
        .bind(&lexical_key)
        .fetch_one(&mut **tx)
        .await
        .map_err(Into::into)
    }

    pub async fn upsert_language_lexical_entry(
        &self,
        input: LexicalEntryUpsert,
    ) -> Result<LanguageLexicalEntry> {
        self.ensure_profile(&input.profile_id).await?;
        let mut tx = self.pool().begin().await?;
        let id = Self::upsert_entry_in_tx(&mut tx, &input).await?;
        tx.commit().await?;
        self.get_language_lexical_entry(&input.profile_id, &id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Lexical entry disappeared after upsert".to_string()))
    }

    pub async fn get_language_lexical_entry(
        &self,
        profile_id: &str,
        entry_id: &str,
    ) -> Result<Option<LanguageLexicalEntry>> {
        let row = sqlx::query(
            "SELECT * FROM language_lexical_entries WHERE profile_id = ?1 AND id = ?2",
        )
        .bind(profile_id)
        .bind(entry_id)
        .fetch_optional(self.pool())
        .await?;
        row.as_ref().map(entry_from_row).transpose()
    }

    pub async fn list_language_lexical_entries(
        &self,
        profile_id: &str,
        language_tag: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<LexiconPage<LanguageLexicalEntry>> {
        self.ensure_profile(profile_id).await?;
        let (offset, limit) = page_bounds(offset, limit);
        let (sql, total_sql) = if language_tag.is_some() {
            (
                "SELECT * FROM language_lexical_entries WHERE profile_id = ?1 AND language_tag = ?2 ORDER BY updated_at DESC, id LIMIT ?3 OFFSET ?4",
                "SELECT COUNT(*) FROM language_lexical_entries WHERE profile_id = ?1 AND language_tag = ?2",
            )
        } else {
            (
                "SELECT * FROM language_lexical_entries WHERE profile_id = ?1 ORDER BY updated_at DESC, id LIMIT ?2 OFFSET ?3",
                "SELECT COUNT(*) FROM language_lexical_entries WHERE profile_id = ?1",
            )
        };
        let total = if let Some(language_tag) = language_tag {
            sqlx::query_scalar::<_, i64>(total_sql)
                .bind(profile_id)
                .bind(language_tag)
                .fetch_one(self.pool())
                .await?
        } else {
            sqlx::query_scalar::<_, i64>(total_sql)
                .bind(profile_id)
                .fetch_one(self.pool())
                .await?
        };
        let rows = if let Some(language_tag) = language_tag {
            sqlx::query(sql)
                .bind(profile_id)
                .bind(language_tag)
                .bind(limit)
                .bind(offset)
                .fetch_all(self.pool())
                .await?
        } else {
            sqlx::query(sql)
                .bind(profile_id)
                .bind(limit)
                .bind(offset)
                .fetch_all(self.pool())
                .await?
        };
        check_page(rows.iter().map(entry_from_row).collect::<Result<Vec<_>>>()?, offset, limit, total)
            .pipe(Ok)
    }

    pub async fn record_language_encounter(
        &self,
        input: EncounterInput,
    ) -> Result<LanguageLexicalEntry> {
        let result = self.record_language_encounter_batch(vec![input]).await?;
        result
            .entries
            .into_iter()
            .next()
            .ok_or_else(|| PlethoraError::Internal("Encounter did not produce an entry".to_string()))
    }

    pub async fn record_language_encounter_batch(
        &self,
        inputs: Vec<EncounterInput>,
    ) -> Result<EncounterBatchResult> {
        if inputs.is_empty() {
            return Ok(EncounterBatchResult { accepted: 0, coalesced: 0, entries: Vec::new() });
        }
        let profile_ids: HashSet<&str> = inputs.iter().map(|input| input.profile_id.as_str()).collect();
        for profile_id in profile_ids {
            self.ensure_profile(profile_id).await?;
        }
        let mut tx = self.pool().begin().await?;
        let now = Utc::now().timestamp();
        let mut entry_ids = Vec::with_capacity(inputs.len());
        let mut accepted = 0;
        let mut coalesced = 0;
        for input in &inputs {
            let surface = input.surface.trim();
            let normalized = normalize_lexical_form(input.normalized.as_deref().unwrap_or(surface));
            if normalized.is_empty() {
                return Err(PlethoraError::InvalidInput("Encounter surface cannot be empty".to_string()));
            }
            let confident_lemma = input
                .lemma
                .as_deref()
                .filter(|lemma| !lemma.trim().is_empty())
                .filter(|_| input.confidence.unwrap_or(1.0) >= 0.8)
                .map(normalize_lexical_form);
            let entry_input = LexicalEntryUpsert {
                id: None,
                profile_id: input.profile_id.clone(),
                language_tag: input.language_tag.clone(),
                normalized_form: confident_lemma.clone().unwrap_or_else(|| normalized.clone()),
                canonical_form: input.canonical_form.clone(),
                lemma: confident_lemma.clone(),
                object_kind: input.object_kind.clone(),
                meanings: Vec::new(),
                translations: Vec::new(),
                part_of_speech: input.part_of_speech.clone(),
                pronunciation: None,
                frequency: None,
                cefr_level: None,
                provider_id: None,
                provider_version: None,
                processor_id: input.processor_id.clone(),
                processor_version: input.processor_version.clone(),
                identity_confidence: input.confidence,
            };
            let entry_id = Self::upsert_entry_in_tx(&mut tx, &entry_input).await?;
            entry_ids.push(entry_id.clone());
            let anchor = input.source_anchor.clone();
            let source_type = input
                .source_type
                .clone()
                .or_else(|| anchor.as_ref().map(|value| value.source_type.clone()))
                .unwrap_or_else(|| "text".to_string());
            let document_id = input.document_id.clone().or_else(|| anchor.as_ref().and_then(|v| v.document_id.clone()));
            let media_id = input.media_id.clone().or_else(|| anchor.as_ref().and_then(|v| v.media_id.clone()));
            let source_id = input.source_id.clone().or_else(|| anchor.as_ref().and_then(|v| v.source_id.clone()));
            let occurrence_key = stable_occurrence_key(input, &normalized);
            let existing = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM language_occurrences WHERE profile_id = ?1 AND occurrence_key = ?2",
            )
            .bind(&input.profile_id)
            .bind(&occurrence_key)
            .fetch_one(&mut *tx)
            .await? > 0;
            if existing { coalesced += 1; } else { accepted += 1; }
            let document_is_new = if let Some(document_id) = document_id.as_ref() {
                let count = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM language_occurrences WHERE profile_id = ?1 AND lexical_entry_id = ?2 AND document_id = ?3",
                )
                .bind(&input.profile_id)
                .bind(&entry_id)
                .bind(document_id)
                .fetch_one(&mut *tx)
                .await?;
                count == 0
            } else {
                false
            };
            let surface_id = uuid::Uuid::new_v4().to_string();
            let first_seen = input.encountered_at.unwrap_or(now);
            sqlx::query(
                "INSERT INTO language_surface_forms
                 (id, profile_id, lexical_entry_id, language_tag, surface, normalized, first_seen_at, last_seen_at, occurrence_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)
                 ON CONFLICT(profile_id, language_tag, normalized)
                 DO UPDATE SET surface = excluded.surface, last_seen_at = excluded.last_seen_at,
                   occurrence_count = language_surface_forms.occurrence_count + 1",
            )
            .bind(&surface_id).bind(&input.profile_id).bind(&entry_id).bind(&input.language_tag)
            .bind(surface).bind(&normalized).bind(first_seen)
            .execute(&mut *tx).await?;
            let surface_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM language_surface_forms WHERE profile_id = ?1 AND language_tag = ?2 AND normalized = ?3",
            ).bind(&input.profile_id).bind(&input.language_tag).bind(&normalized).fetch_one(&mut *tx).await?;
            let context_text = clamp_context_text(input.context_text.as_deref());
            let anchor_json = anchor.as_ref().map(json).transpose()?;
            sqlx::query(
                "INSERT INTO language_occurrences
                 (id, profile_id, lexical_entry_id, surface_form_id, language_tag, surface, normalized,
                  source_type, document_id, media_id, source_id, sentence_id, token_id, content_fingerprint,
                  source_anchor_json, context_reference, context_hash, context_text, encountered_at,
                  last_encountered_at, repeat_count, audio_start_ms, audio_end_ms, was_lookup,
                  was_interacted, processing_key, confidence, orphan_state, retention_expires_at, occurrence_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                         ?18, ?19, ?19, 1, ?20, ?21, ?22, ?23, ?24, ?25, 'live', ?26, ?27)
                 ON CONFLICT(profile_id, occurrence_key)
                 DO UPDATE SET lexical_entry_id = excluded.lexical_entry_id,
                   surface_form_id = excluded.surface_form_id, last_encountered_at = excluded.last_encountered_at,
                   repeat_count = language_occurrences.repeat_count + 1,
                   was_lookup = language_occurrences.was_lookup OR excluded.was_lookup,
                   was_interacted = language_occurrences.was_interacted OR excluded.was_interacted,
                   context_text = COALESCE(language_occurrences.context_text, excluded.context_text),
                   context_reference = COALESCE(language_occurrences.context_reference, excluded.context_reference),
                   orphan_state = 'live', orphaned_at = NULL,
                   retention_expires_at = COALESCE(excluded.retention_expires_at, language_occurrences.retention_expires_at)",
            )
            .bind(input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            .bind(&input.profile_id).bind(&entry_id).bind(&surface_id).bind(&input.language_tag)
            .bind(surface).bind(&normalized).bind(&source_type).bind(&document_id).bind(&media_id)
            .bind(&source_id).bind(&input.sentence_id).bind(&input.token_id).bind(&input.content_fingerprint)
            .bind(anchor_json).bind(&input.context_reference).bind(&input.context_hash).bind(&context_text)
            .bind(first_seen).bind(input.audio_start_ms).bind(input.audio_end_ms)
            .bind(if input.was_lookup { 1i64 } else { 0 })
            .bind(if input.was_interacted { 1i64 } else { 0 })
            .bind(&input.processing_key).bind(input.confidence).bind(input.retention_expires_at)
            .bind(&occurrence_key).execute(&mut *tx).await?;
            if let Some(processing_key) = input.processing_key.as_deref() {
                sqlx::query(
                    "INSERT INTO language_lexical_analyses
                     (id, profile_id, lexical_entry_id, surface_form_id, token_id, sentence_id,
                      processing_key, processor_id, processor_version, lemma, part_of_speech,
                      morphology_json, confidence, authoritative, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                     ON CONFLICT DO UPDATE SET lexical_entry_id = excluded.lexical_entry_id,
                       surface_form_id = excluded.surface_form_id, lemma = excluded.lemma,
                       part_of_speech = excluded.part_of_speech, morphology_json = excluded.morphology_json,
                       confidence = excluded.confidence, authoritative = excluded.authoritative",
                )
                .bind(uuid::Uuid::new_v4().to_string()).bind(&input.profile_id).bind(&entry_id)
                .bind(&surface_id).bind(&input.token_id).bind(&input.sentence_id).bind(processing_key)
                .bind(&input.processor_id).bind(&input.processor_version).bind(&input.lemma)
                .bind(&input.part_of_speech).bind(json(&input.morphology)?).bind(input.confidence)
                .bind(if input.confidence.unwrap_or(0.0) >= 0.8 { 1i64 } else { 0 })
                .bind(first_seen).execute(&mut *tx).await?;
            }
            sqlx::query(
                "UPDATE language_lexical_entries SET
                    first_encountered_at = COALESCE(first_encountered_at, ?1),
                    last_encountered_at = ?1, encounter_count = encounter_count + 1,
                    document_count = document_count + ?2,
                    lookup_count = lookup_count + ?3,
                    active_evidence_count = active_evidence_count + ?4,
                    passive_evidence_count = passive_evidence_count + ?5,
                    updated_at = ?1, version = version + 1
                 WHERE profile_id = ?6 AND id = ?7",
            )
            .bind(first_seen)
            .bind(if document_is_new { 1i64 } else { 0 })
            .bind(if input.was_lookup { 1i64 } else { 0 })
            .bind(if input.was_interacted { 1i64 } else { 0 })
            .bind(if input.was_interacted { 0i64 } else { 1i64 })
            .bind(&input.profile_id).bind(&entry_id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        let mut entries = Vec::new();
        let mut seen = HashSet::new();
        for id in entry_ids {
            if seen.insert(id.clone()) {
                if let Some(entry) = self.get_language_lexical_entry(&inputs[0].profile_id, &id).await? {
                    entries.push(entry);
                } else {
                    // A batch may contain multiple profiles; resolve by querying
                    // the profile carried by the input at the same position below.
                    for input in &inputs {
                        if let Some(entry) = self.get_language_lexical_entry(&input.profile_id, &id).await? {
                            entries.push(entry);
                            break;
                        }
                    }
                }
            }
        }
        Ok(EncounterBatchResult { accepted, coalesced, entries })
    }

    pub async fn list_language_occurrences(
        &self,
        profile_id: &str,
        entry_id: Option<&str>,
        document_id: Option<&str>,
        media_id: Option<&str>,
        language_tag: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<LexiconPage<LanguageOccurrence>> {
        self.ensure_profile(profile_id).await?;
        let (offset, limit) = page_bounds(offset, limit);
        let mut predicates = vec!["profile_id = ?1".to_string()];
        let mut values = Vec::<&str>::new();
        if let Some(value) = entry_id { predicates.push(format!("lexical_entry_id = ?{}", values.len() + 2)); values.push(value); }
        if let Some(value) = document_id { predicates.push(format!("document_id = ?{}", values.len() + 2)); values.push(value); }
        if let Some(value) = media_id { predicates.push(format!("media_id = ?{}", values.len() + 2)); values.push(value); }
        if let Some(value) = language_tag { predicates.push(format!("language_tag = ?{}", values.len() + 2)); values.push(value); }
        let where_sql = predicates.join(" AND ");
        let total_sql = format!("SELECT COUNT(*) FROM language_occurrences WHERE {where_sql}");
        let rows_sql = format!("SELECT * FROM language_occurrences WHERE {where_sql} ORDER BY encountered_at DESC, id LIMIT ?{} OFFSET ?{}", values.len() + 2, values.len() + 3);
        let mut total_query = sqlx::query_scalar::<_, i64>(&total_sql).bind(profile_id);
        let mut rows_query = sqlx::query(&rows_sql).bind(profile_id);
        for value in values { total_query = total_query.bind(value); rows_query = rows_query.bind(value); }
        let total = total_query.fetch_one(self.pool()).await?;
        let rows = rows_query.bind(limit).bind(offset).fetch_all(self.pool()).await?;
        check_page(rows.iter().map(occurrence_from_row).collect::<Result<Vec<_>>>()?, offset, limit, total).pipe(Ok)
    }

    pub async fn record_language_lookup(&self, input: LookupInput) -> Result<LanguageLookupEvent> {
        let surface = input.surface.trim();
        let normalized = normalize_lexical_form(surface);
        if normalized.is_empty() { return Err(PlethoraError::InvalidInput("Lookup surface cannot be empty".to_string())); }
        let now = input.looked_up_at.unwrap_or_else(|| Utc::now().timestamp());
        if let Some(profile_id) = input.profile_id.as_deref() {
            self.ensure_profile(profile_id).await?;
            let language_tag = input.language_tag.clone().unwrap_or_else(|| "und".to_string());
            let entry = self.upsert_language_lexical_entry(LexicalEntryUpsert {
                id: None, profile_id: profile_id.to_string(), language_tag, normalized_form: normalized.clone(),
                canonical_form: Some(surface.to_string()), lemma: None, object_kind: LexicalObjectKind::Token,
                meanings: input.meanings.clone(), translations: input.translations.clone(), part_of_speech: input.part_of_speech.clone(),
                pronunciation: input.pronunciation.clone(), frequency: None, cefr_level: None,
                provider_id: input.provider_id.clone(), provider_version: input.provider_version.clone(),
                processor_id: None, processor_version: None, identity_confidence: None,
            }).await?;
            let event_id = uuid::Uuid::new_v4().to_string();
            let anchor_json = input.source_anchor.as_ref().map(json).transpose()?;
            sqlx::query(
                "INSERT INTO language_lookup_events
                 (id, profile_id, lexical_entry_id, surface, normalized, document_id, media_id,
                  source_anchor_json, looked_up_at, provider_id, provider_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            ).bind(&event_id).bind(profile_id).bind(&entry.id).bind(surface).bind(&normalized)
             .bind(&input.document_id).bind(&input.media_id).bind(anchor_json).bind(now)
             .bind(&input.provider_id).bind(&input.provider_version).execute(self.pool()).await?;
            sqlx::query("UPDATE language_lexical_entries SET lookup_count = lookup_count + 1, updated_at = ?1, version = version + 1 WHERE id = ?2 AND profile_id = ?3")
                .bind(now).bind(&entry.id).bind(profile_id).execute(self.pool()).await?;
            let row = sqlx::query("SELECT * FROM language_lookup_events WHERE id = ?1").bind(&event_id).fetch_one(self.pool()).await?;
            return lookup_from_row(&row);
        }
        let event_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO language_legacy_lookup_history
             (id, account_id, workspace_id, profile_id, word, normalized, lookup_count,
              first_seen_at, last_seen_at, last_document_id)
             VALUES (?1, 'local', 'default', NULL, ?2, ?3, 1, ?4, ?4, ?5)
             ON CONFLICT(account_id, workspace_id, profile_id, normalized)
             DO UPDATE SET word = excluded.word, lookup_count = language_legacy_lookup_history.lookup_count + 1,
               last_seen_at = excluded.last_seen_at, last_document_id = COALESCE(excluded.last_document_id, language_legacy_lookup_history.last_document_id)",
        ).bind(&event_id).bind(surface).bind(&normalized).bind(now).bind(&input.document_id).execute(self.pool()).await?;
        Ok(LanguageLookupEvent {
            id: event_id, profile_id: None, lexical_entry_id: None, surface: surface.to_string(), normalized,
            document_id: input.document_id, media_id: input.media_id, source_anchor: input.source_anchor,
            looked_up_at: now, provider_id: input.provider_id, provider_version: input.provider_version,
        })
    }

    pub async fn migrate_language_lookup_history(
        &self,
        profile_id: &str,
        records: Vec<LegacyLookupRecord>,
    ) -> Result<i64> {
        self.ensure_profile(profile_id).await?;
        let mut migrated = 0;
        for record in records {
            let entry = self.upsert_language_lexical_entry(LexicalEntryUpsert {
                id: None, profile_id: profile_id.to_string(), language_tag: "und".to_string(),
                normalized_form: normalize_lexical_form(&record.word), canonical_form: Some(record.word.clone()),
                lemma: None, object_kind: LexicalObjectKind::Token, ..Default::default()
            }).await?;
            sqlx::query(
                "UPDATE language_lexical_entries SET lookup_count = MAX(lookup_count, ?1),
                   first_encountered_at = COALESCE(first_encountered_at, ?2),
                   last_encountered_at = MAX(COALESCE(last_encountered_at, 0), ?3),
                   updated_at = ?3, version = version + 1 WHERE id = ?4 AND profile_id = ?5",
            ).bind(record.lookup_count).bind(record.first_seen_at).bind(record.last_seen_at).bind(&entry.id).bind(profile_id).execute(self.pool()).await?;
            let normalized = normalize_lexical_form(&record.word);
            sqlx::query("UPDATE language_legacy_lookup_history SET profile_id = ?1, migrated_at = ?2 WHERE normalized = ?3 AND account_id = 'local' AND workspace_id = 'default'")
                .bind(profile_id).bind(Utc::now().timestamp()).bind(&normalized).execute(self.pool()).await?;
            if let Some(document_id) = record.last_document_id {
                sqlx::query(
                    "INSERT INTO language_lookup_events
                     (id, profile_id, lexical_entry_id, surface, normalized, document_id, looked_up_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .bind(uuid::Uuid::new_v4().to_string()).bind(profile_id).bind(&entry.id)
                .bind(&record.word).bind(&normalized).bind(document_id).bind(record.last_seen_at)
                .execute(self.pool()).await?;
            }
            migrated += 1;
        }
        Ok(migrated)
    }

    pub async fn apply_language_lexical_override(
        &self,
        input: LexicalEntryOverride,
    ) -> Result<LanguageLexicalEntry> {
        self.ensure_profile(&input.profile_id).await?;
        sqlx::query(
            "UPDATE language_lexical_entries SET lemma = COALESCE(?1, lemma), canonical_form = COALESCE(?2, canonical_form),
             knowledge_state = COALESCE(?3, knowledge_state), user_notes = COALESCE(?4, user_notes),
             ignored = COALESCE(?5, ignored), proper_noun = COALESCE(?6, proper_noun),
             updated_at = ?7, version = version + 1 WHERE profile_id = ?8 AND id = ?9",
        ).bind(&input.lemma).bind(&input.canonical_form).bind(&input.knowledge_state).bind(&input.user_notes)
         .bind(input.ignored.map(|v| if v { 1i64 } else { 0 })).bind(input.proper_noun.map(|v| if v { 1i64 } else { 0 }))
         .bind(Utc::now().timestamp()).bind(&input.profile_id).bind(&input.entry_id).execute(self.pool()).await?;
        self.get_language_lexical_entry(&input.profile_id, &input.entry_id).await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Lexical entry {}", input.entry_id)))
    }

    pub async fn export_language_lexicon(
        &self,
        profile_id: &str,
        include_occurrences: bool,
        occurrence_offset: i64,
        occurrence_limit: i64,
    ) -> Result<LanguageLexiconExport> {
        self.ensure_profile(profile_id).await?;
        let entries = self.list_language_lexical_entries(profile_id, None, 0, 10_000).await?.items;
        let surfaces = sqlx::query("SELECT * FROM language_surface_forms WHERE profile_id = ?1 ORDER BY last_seen_at DESC, id LIMIT 10000")
            .bind(profile_id).fetch_all(self.pool()).await?.iter().map(surface_from_row).collect::<Result<Vec<_>>>()?;
        let analyses = sqlx::query("SELECT * FROM language_lexical_analyses WHERE profile_id = ?1 ORDER BY created_at DESC LIMIT 10000")
            .bind(profile_id).fetch_all(self.pool()).await?.iter().map(analysis_from_row).collect::<Result<Vec<_>>>()?;
        let lookup_events = sqlx::query("SELECT * FROM language_lookup_events WHERE profile_id = ?1 ORDER BY looked_up_at DESC, id LIMIT 10000")
            .bind(profile_id).fetch_all(self.pool()).await?.iter().map(lookup_from_row).collect::<Result<Vec<_>>>()?;
        let occurrence_total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM language_occurrences WHERE profile_id = ?1").bind(profile_id).fetch_one(self.pool()).await?;
        let occurrences = if include_occurrences {
            self.list_language_occurrences(profile_id, None, None, None, None, occurrence_offset, occurrence_limit).await?.items
        } else { Vec::new() };
        Ok(LanguageLexiconExport {
            schema_version: LANGUAGE_LEXICON_SCHEMA_VERSION, profile_id: profile_id.to_string(), exported_at: Utc::now().timestamp(),
            entries, surfaces, analyses, occurrences, lookup_events, occurrences_included: include_occurrences,
            occurrence_offset, occurrence_limit: occurrence_limit.clamp(1, MAX_OCCURRENCE_PAGE_SIZE), occurrence_total,
        })
    }

    pub async fn serialize_language_lexicon_for_sync(&self, profile_id: &str) -> Result<LanguageLexiconSyncEnvelope> {
        let export = self.export_language_lexicon(profile_id, false, 0, DEFAULT_OCCURRENCE_PAGE_SIZE).await?;
        Ok(LanguageLexiconSyncEnvelope {
            schema_version: export.schema_version, profile_id: export.profile_id, changed_at: export.exported_at,
            entries: export.entries, surfaces: export.surfaces, analyses: export.analyses, occurrences: Vec::new(),
            lookup_events: export.lookup_events, occurrences_included: false,
        })
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, function: impl FnOnce(Self) -> T) -> T { function(self) }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::language_profile::LanguageProfileCreate;
    use std::path::PathBuf;

    async fn repository() -> Repository {
        let database = Database::new(PathBuf::from(":memory:")).await.expect("database");
        database.migrate().await.expect("migrations");
        Repository::new(database.pool().clone())
    }

    async fn profile(repo: &Repository, name: &str) -> LanguageLexicalEntry {
        let profile = repo
            .create_language_profile(
                LanguageProfileCreate {
                    name: name.to_string(),
                    target_language: "es".to_string(),
                    base_language: "en".to_string(),
                    ..Default::default()
                },
                None,
                None,
            )
            .await
            .expect("profile");
        LanguageLexicalEntry {
            id: profile.id,
            profile_id: String::new(),
            language_tag: String::new(),
            object_kind: LexicalObjectKind::Token,
            lexical_key: String::new(),
            normalized_form: String::new(),
            canonical_form: String::new(),
            lemma: None,
            meanings: Vec::new(),
            translations: Vec::new(),
            part_of_speech: None,
            pronunciation: None,
            frequency: None,
            cefr_level: None,
            provider_id: None,
            provider_version: None,
            processor_id: None,
            processor_version: None,
            identity_confidence: None,
            first_encountered_at: None,
            last_encountered_at: None,
            encounter_count: 0,
            document_count: 0,
            lookup_count: 0,
            active_evidence_count: 0,
            passive_evidence_count: 0,
            knowledge_state: None,
            review_relationships: Value::Object(Default::default()),
            user_notes: None,
            ignored: false,
            proper_noun: false,
            created_at: 0,
            updated_at: 0,
            version: 0,
        }
    }

    fn encounter(profile_id: &str, surface: &str, token_id: &str, confidence: f64) -> EncounterInput {
        EncounterInput {
            profile_id: profile_id.to_string(),
            language_tag: "es".to_string(),
            surface: surface.to_string(),
            lemma: Some("hablar".to_string()),
            confidence: Some(confidence),
            document_id: Some("doc-1".to_string()),
            sentence_id: Some("sentence-1".to_string()),
            token_id: Some(token_id.to_string()),
            source_anchor: Some(SourceAnchor {
                source_type: "epub".to_string(),
                document_id: Some("doc-1".to_string()),
                locator: Some(serde_json::json!({ "cfi": token_id })),
                ..Default::default()
            }),
            context_text: Some("Una frase breve para recuperar el contexto.".to_string()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn preserves_surface_forms_and_rejects_low_confidence_merges() {
        let repo = repository().await;
        let profile = profile(&repo, "Spanish").await;
        let first = repo.record_language_encounter(encounter(&profile.id, "hablando", "tok-1", 0.99)).await.unwrap();
        let second = repo.record_language_encounter(encounter(&profile.id, "habló", "tok-2", 0.99)).await.unwrap();
        let low = repo.record_language_encounter(encounter(&profile.id, "hablaste", "tok-3", 0.2)).await.unwrap();
        assert_eq!(first.id, second.id);
        assert_ne!(first.id, low.id);
        assert_eq!(first.lemma.as_deref(), Some("hablar"));
        assert_eq!(low.lemma, None);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM language_surface_forms WHERE profile_id = ?1").bind(&profile.id).fetch_one(repo.pool()).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn duplicate_encounters_coalesce_and_page_without_queue_side_effects() {
        let repo = repository().await;
        let profile = profile(&repo, "Spanish").await;
        let mut input = encounter(&profile.id, "hola", "tok-1", 1.0);
        input.id = Some("occurrence-1".to_string());
        let result = repo.record_language_encounter_batch(vec![input.clone(), input]).await.unwrap();
        assert_eq!(result.accepted, 1);
        assert_eq!(result.coalesced, 1);
        let entry = result.entries.first().unwrap();
        assert_eq!(entry.encounter_count, 2);
        let page = repo.list_language_occurrences(&profile.id, Some(&entry.id), None, None, None, 0, 0).await.unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].repeat_count, 2);
        assert!(page.limit >= 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM learning_items").fetch_one(repo.pool()).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn profile_scope_and_lookup_do_not_cross_or_create_cards() {
        let repo = repository().await;
        let first_profile = profile(&repo, "Spanish").await;
        let second_profile = profile(&repo, "French").await;
        let first = repo.record_language_lookup(LookupInput {
            profile_id: Some(first_profile.id.clone()), language_tag: Some("es".to_string()), surface: "casa".to_string(), ..Default::default()
        }).await.unwrap();
        assert_eq!(first.profile_id.as_deref(), Some(first_profile.id.as_str()));
        assert!(repo.list_language_lexical_entries(&second_profile.id, None, 0, 50).await.unwrap().items.is_empty());
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM learning_items").fetch_one(repo.pool()).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn profile_deletion_removes_lexicon_but_keeps_document_rows() {
        let repo = repository().await;
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('doc-a2', 'Doc', '/tmp/doc', 'html', '2026-01-01', '2026-01-01')").execute(repo.pool()).await.unwrap();
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('doc-keep', 'Keep', '/tmp/keep', 'html', '2026-01-01', '2026-01-01')").execute(repo.pool()).await.unwrap();
        let profile = profile(&repo, "Spanish").await;
        let mut source_encounter = encounter(&profile.id, "casa", "tok-a2", 1.0);
        source_encounter.document_id = Some("doc-a2".to_string());
        let entry = repo.record_language_encounter(source_encounter).await.unwrap();
        repo.delete_document("doc-a2").await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT orphan_state FROM language_occurrences WHERE profile_id = ?1 LIMIT 1").bind(&profile.id).fetch_one(repo.pool()).await.unwrap(), "orphaned");
        let report = repo.delete_language_profile(&profile.id, None, None).await.unwrap();
        assert!(report.removed_profile_derived_data >= 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM language_lexical_entries WHERE profile_id = ?1").bind(&profile.id).fetch_one(repo.pool()).await.unwrap(), 0);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = 'doc-keep'").fetch_one(repo.pool()).await.unwrap(), 1);
        let _ = entry;
    }

    /// Large-fixture coverage is opt-in because inserting one million rows is
    /// intentionally expensive. The query itself exercises the production
    /// profile/time index and proves the API returns a bounded page.
    #[tokio::test]
    #[ignore]
    async fn million_occurrence_fixture_returns_bounded_page() {
        let repo = repository().await;
        let profile = profile(&repo, "Spanish").await;
        let entry = repo.upsert_language_lexical_entry(LexicalEntryUpsert {
            profile_id: profile.id.clone(), language_tag: "es".to_string(), normalized_form: "hola".to_string(),
            canonical_form: Some("hola".to_string()), ..Default::default()
        }).await.unwrap();
        sqlx::query(
            "WITH RECURSIVE sequence(n) AS (
                 SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1000000
             )
             INSERT INTO language_occurrences
             (id, profile_id, lexical_entry_id, language_tag, surface, normalized, source_type,
              encountered_at, last_encountered_at, occurrence_key)
             SELECT 'fixture-' || n, ?1, ?2, 'es', 'hola', 'hola', 'fixture', n, n, 'fixture-key-' || n
             FROM sequence",
        ).bind(&profile.id).bind(&entry.id).execute(repo.pool()).await.unwrap();
        let page = repo.list_language_occurrences(&profile.id, Some(&entry.id), None, None, None, 999_990, 50).await.unwrap();
        assert_eq!(page.items.len(), 10);
        assert_eq!(page.total, 1_000_000);
        assert!(!page.has_more);
    }
}
