//! Repository operations for knowledge state, evidence, and explicit SRS links.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::language_knowledge::{
    KnowledgeEvidenceKind, KnowledgeStateSource, KnownWordImportPreview, KnownWordImportRecord,
    LanguageKnowledgeEvidenceEvent, LanguageKnowledgeEvidenceInput, LanguageKnowledgeExport,
    LanguageKnowledgeState, LanguageKnowledgeStateChange, LanguageKnowledgeStateHistory,
    LanguageKnowledgeStateSnapshot, LanguageMemorizationLink, LanguageMemorizationLinkInput,
    LANGUAGE_KNOWLEDGE_SCHEMA_VERSION,
};
use crate::models::language_lexicon::{normalize_lexical_form, LexicalEntryUpsert, LexiconPage};
use chrono::Utc;
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row, Sqlite};
use std::collections::HashSet;

fn json<T: serde::Serialize>(value: &T) -> Result<String> { Ok(serde_json::to_string(value)?) }

fn page_bounds(offset: i64, limit: i64) -> (i64, i64) { (offset.max(0), limit.clamp(1, 100)) }

fn snapshot_from_row(row: &SqliteRow) -> Result<LanguageKnowledgeStateSnapshot> {
    let source = row.try_get::<Option<String>, _>("override_source")?.map(|v| match v.as_str() {
        "encounter" => KnowledgeStateSource::Encounter,
        "import" => KnowledgeStateSource::Import,
        "undo" => KnowledgeStateSource::Undo,
        "system" => KnowledgeStateSource::System,
        _ => KnowledgeStateSource::Manual,
    });
    Ok(LanguageKnowledgeStateSnapshot {
        profile_id: row.try_get("profile_id")?, lexical_entry_id: row.try_get("lexical_entry_id")?,
        state: LanguageKnowledgeState::parse(&row.try_get::<String, _>("resolved_state")?),
        manual_override: row.try_get::<i64, _>("manual_override")? != 0,
        override_actor: row.try_get("override_actor")?, override_source: source,
        passive_evidence: row.try_get("passive_evidence")?, active_evidence: row.try_get("active_evidence")?,
        last_evidence_at: row.try_get("last_evidence_at")?, updated_at: row.try_get("updated_at")?, version: row.try_get("state_version")?,
    })
}

fn history_from_row(row: &SqliteRow) -> Result<LanguageKnowledgeStateHistory> {
    Ok(LanguageKnowledgeStateHistory {
        id: row.try_get("id")?, profile_id: row.try_get("profile_id")?, lexical_entry_id: row.try_get("lexical_entry_id")?,
        previous_state: LanguageKnowledgeState::parse(&row.try_get::<String, _>("previous_state")?),
        new_state: LanguageKnowledgeState::parse(&row.try_get::<String, _>("new_state")?),
        source: match row.try_get::<String, _>("source")?.as_str() {
            "encounter" => KnowledgeStateSource::Encounter, "import" => KnowledgeStateSource::Import,
            "undo" => KnowledgeStateSource::Undo, "system" => KnowledgeStateSource::System, _ => KnowledgeStateSource::Manual,
        },
        actor_id: row.try_get("actor_id")?, operation_id: row.try_get("operation_id")?,
        changed_at: row.try_get("changed_at")?, reverted_at: row.try_get("reverted_at")?,
    })
}

fn evidence_from_row(row: &SqliteRow) -> Result<LanguageKnowledgeEvidenceEvent> {
    Ok(LanguageKnowledgeEvidenceEvent {
        id: row.try_get("id")?, profile_id: row.try_get("profile_id")?, lexical_entry_id: row.try_get("lexical_entry_id")?,
        kind: match row.try_get::<String, _>("kind")?.as_str() {
            "lookup" => KnowledgeEvidenceKind::Lookup, "recognition" => KnowledgeEvidenceKind::Recognition,
            "production" => KnowledgeEvidenceKind::Production, "manual" => KnowledgeEvidenceKind::Manual,
            _ => KnowledgeEvidenceKind::Encounter,
        },
        confidence: row.try_get("confidence")?, source_id: row.try_get("source_id")?,
        metadata: row.try_get::<Option<String>, _>("metadata_json")?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or(Value::Object(Default::default())),
        occurred_at: row.try_get("occurred_at")?,
    })
}

fn link_from_row(row: &SqliteRow) -> Result<LanguageMemorizationLink> {
    Ok(LanguageMemorizationLink {
        id: row.try_get("id")?, profile_id: row.try_get("profile_id")?, lexical_entry_id: row.try_get("lexical_entry_id")?,
        learning_item_id: row.try_get("learning_item_id")?, relation: row.try_get("relation")?, actor_id: row.try_get("actor_id")?, created_at: row.try_get("created_at")?,
    })
}

impl Repository {
    async fn ensure_knowledge_entry(&self, profile_id: &str, entry_id: &str) -> Result<()> {
        let found = sqlx::query_scalar::<_, String>(
            "SELECT id FROM language_lexical_entries WHERE profile_id = ?1 AND id = ?2",
        ).bind(profile_id).bind(entry_id).fetch_optional(self.pool()).await?;
        found.ok_or_else(|| PlethoraError::NotFound(format!("Lexical entry {entry_id}"))).map(|_| ())
    }

    async fn snapshot_query(&self, profile_id: &str, entry_id: &str) -> Result<LanguageKnowledgeStateSnapshot> {
        let row = sqlx::query(
            "SELECT e.profile_id, e.id AS lexical_entry_id,
                    COALESCE(s.state, COALESCE(e.knowledge_state, 'new')) AS resolved_state,
                    COALESCE(s.manual_override, 0) AS manual_override, s.override_actor,
                    s.override_source, COALESCE(s.passive_evidence, e.passive_evidence_count, 0) AS passive_evidence,
                    COALESCE(s.active_evidence, e.active_evidence_count, 0) AS active_evidence,
                    s.last_evidence_at, COALESCE(s.updated_at, e.updated_at) AS updated_at,
                    COALESCE(s.version, 0) AS state_version
             FROM language_lexical_entries e
             LEFT JOIN language_knowledge_states s ON s.lexical_entry_id = e.id AND s.profile_id = e.profile_id
             WHERE e.profile_id = ?1 AND e.id = ?2",
        ).bind(profile_id).bind(entry_id).fetch_optional(self.pool()).await?;
        row.as_ref().map(snapshot_from_row).transpose()?.ok_or_else(|| PlethoraError::NotFound(format!("Lexical entry {entry_id}")))
    }

    pub async fn get_language_knowledge_state(&self, profile_id: &str, entry_id: &str) -> Result<LanguageKnowledgeStateSnapshot> {
        self.snapshot_query(profile_id, entry_id).await
    }

    /// Resolve exact-form manual overrides before a high-confidence lemma
    /// mapping, then fall back to the exact lexical entry.
    pub async fn resolve_language_knowledge_state(&self, profile_id: &str, surface: &str) -> Result<Option<LanguageKnowledgeStateSnapshot>> {
        let normalized = normalize_lexical_form(surface);
        let exact_override = sqlx::query_scalar::<_, String>(
            "SELECT e.id FROM language_lexical_entries e
             JOIN language_knowledge_states s ON s.profile_id = e.profile_id AND s.lexical_entry_id = e.id
             WHERE e.profile_id = ?1 AND e.normalized_form = ?2 AND s.manual_override = 1 LIMIT 1",
        ).bind(profile_id).bind(&normalized).fetch_optional(self.pool()).await?;
        if let Some(entry_id) = exact_override { return self.snapshot_query(profile_id, &entry_id).await.map(Some); }
        let lemma_entry = sqlx::query_scalar::<_, String>(
            "SELECT e.id FROM language_surface_forms sf
             JOIN language_lexical_entries e ON e.id = sf.lexical_entry_id AND e.profile_id = sf.profile_id
             WHERE sf.profile_id = ?1 AND sf.normalized = ?2 AND e.normalized_form <> sf.normalized
             ORDER BY e.identity_confidence DESC, e.updated_at DESC LIMIT 1",
        ).bind(profile_id).bind(&normalized).fetch_optional(self.pool()).await?;
        if let Some(entry_id) = lemma_entry { return self.snapshot_query(profile_id, &entry_id).await.map(Some); }
        let exact = sqlx::query_scalar::<_, String>(
            "SELECT id FROM language_lexical_entries WHERE profile_id = ?1 AND normalized_form = ?2 ORDER BY updated_at DESC LIMIT 1",
        ).bind(profile_id).bind(&normalized).fetch_optional(self.pool()).await?;
        if let Some(entry_id) = exact {
            self.snapshot_query(profile_id, &entry_id).await.map(Some)
        } else {
            Ok(None)
        }
    }

    async fn set_state_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        change: &LanguageKnowledgeStateChange,
        operation_id: &str,
    ) -> Result<LanguageKnowledgeStateSnapshot> {
        let row = sqlx::query(
            "SELECT e.profile_id, e.id AS lexical_entry_id,
                    COALESCE(s.state, COALESCE(e.knowledge_state, 'new')) AS resolved_state,
                    COALESCE(s.manual_override, 0) AS manual_override, s.override_actor,
                    s.override_source, COALESCE(s.passive_evidence, e.passive_evidence_count, 0) AS passive_evidence,
                    COALESCE(s.active_evidence, e.active_evidence_count, 0) AS active_evidence,
                    s.last_evidence_at, COALESCE(s.updated_at, e.updated_at) AS updated_at,
                    COALESCE(s.version, 0) AS state_version
             FROM language_lexical_entries e
             LEFT JOIN language_knowledge_states s ON s.lexical_entry_id = e.id AND s.profile_id = e.profile_id
             WHERE e.profile_id = ?1 AND e.id = ?2",
        ).bind(&change.profile_id).bind(&change.entry_id).fetch_optional(&mut **tx).await?;
        let row = row.ok_or_else(|| PlethoraError::NotFound(format!("Lexical entry {}", change.entry_id)))?;
        let current = snapshot_from_row(&row)?;
        if current.manual_override && matches!(change.source, KnowledgeStateSource::Encounter | KnowledgeStateSource::System) {
            return Ok(current);
        }
        let next_state = if matches!(change.source, KnowledgeStateSource::Encounter) && current.state != LanguageKnowledgeState::New {
            current.state.clone()
        } else { change.state.clone() };
        let changed = next_state != current.state || (matches!(change.source, KnowledgeStateSource::Manual | KnowledgeStateSource::Import) && !current.manual_override);
        let now = Utc::now().timestamp();
        if changed {
            let manual = matches!(change.source, KnowledgeStateSource::Manual | KnowledgeStateSource::Import);
            sqlx::query(
                "INSERT INTO language_knowledge_states
                 (id, profile_id, lexical_entry_id, state, manual_override, override_actor, override_source,
                  passive_evidence, active_evidence, last_evidence_at, created_at, updated_at, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, 1)
                 ON CONFLICT(profile_id, lexical_entry_id) DO UPDATE SET state = excluded.state,
                   manual_override = excluded.manual_override, override_actor = excluded.override_actor,
                   override_source = excluded.override_source, updated_at = excluded.updated_at,
                   version = language_knowledge_states.version + 1",
            ).bind(uuid::Uuid::new_v4().to_string()).bind(&change.profile_id).bind(&change.entry_id)
             .bind(next_state.as_str()).bind(if manual { 1i64 } else { 0 })
             .bind(&change.actor_id).bind(change.source.as_str()).bind(current.passive_evidence)
             .bind(current.active_evidence).bind(current.last_evidence_at).bind(now)
             .execute(&mut **tx).await?;
            sqlx::query("UPDATE language_lexical_entries SET knowledge_state = ?1, updated_at = ?2, version = version + 1 WHERE profile_id = ?3 AND id = ?4")
                .bind(next_state.as_str()).bind(now).bind(&change.profile_id).bind(&change.entry_id).execute(&mut **tx).await?;
            sqlx::query(
                "INSERT INTO language_knowledge_state_history
                 (id, profile_id, lexical_entry_id, previous_state, new_state, source, actor_id, operation_id, changed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            ).bind(uuid::Uuid::new_v4().to_string()).bind(&change.profile_id).bind(&change.entry_id)
             .bind(current.state.as_str()).bind(next_state.as_str()).bind(change.source.as_str())
             .bind(&change.actor_id).bind(operation_id).bind(now).execute(&mut **tx).await?;
        }
        let snapshot = sqlx::query(
            "SELECT e.profile_id, e.id AS lexical_entry_id,
                    COALESCE(s.state, COALESCE(e.knowledge_state, 'new')) AS resolved_state,
                    COALESCE(s.manual_override, 0) AS manual_override, s.override_actor,
                    s.override_source, COALESCE(s.passive_evidence, e.passive_evidence_count, 0) AS passive_evidence,
                    COALESCE(s.active_evidence, e.active_evidence_count, 0) AS active_evidence,
                    s.last_evidence_at, COALESCE(s.updated_at, e.updated_at) AS updated_at,
                    COALESCE(s.version, 0) AS state_version
             FROM language_lexical_entries e
             LEFT JOIN language_knowledge_states s ON s.lexical_entry_id = e.id AND s.profile_id = e.profile_id
             WHERE e.profile_id = ?1 AND e.id = ?2",
        ).bind(&change.profile_id).bind(&change.entry_id).fetch_one(&mut **tx).await?;
        snapshot_from_row(&snapshot)
    }

    pub async fn set_language_knowledge_state(&self, change: LanguageKnowledgeStateChange) -> Result<LanguageKnowledgeStateSnapshot> {
        self.ensure_knowledge_entry(&change.profile_id, &change.entry_id).await?;
        let mut tx = self.pool().begin().await?;
        let operation_id = change.operation_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let result = Self::set_state_tx(&mut tx, &change, &operation_id).await?;
        tx.commit().await?;
        Ok(result)
    }

    pub async fn set_language_knowledge_states_batch(&self, changes: Vec<LanguageKnowledgeStateChange>) -> Result<Vec<LanguageKnowledgeStateSnapshot>> {
        if changes.is_empty() { return Ok(Vec::new()); }
        for change in &changes { self.ensure_knowledge_entry(&change.profile_id, &change.entry_id).await?; }
        let mut tx = self.pool().begin().await?;
        let operation_id = uuid::Uuid::new_v4().to_string();
        let mut snapshots = Vec::new();
        for change in &changes { snapshots.push(Self::set_state_tx(&mut tx, change, &operation_id).await?); }
        tx.commit().await?;
        Ok(snapshots)
    }

    pub async fn record_language_knowledge_evidence(&self, input: LanguageKnowledgeEvidenceInput) -> Result<LanguageKnowledgeEvidenceEvent> {
        self.ensure_knowledge_entry(&input.profile_id, &input.entry_id).await?;
        let occurred_at = input.occurred_at.unwrap_or_else(|| Utc::now().timestamp());
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO language_knowledge_evidence_events
             (id, profile_id, lexical_entry_id, kind, confidence, source_id, metadata_json, occurred_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        ).bind(&id).bind(&input.profile_id).bind(&input.entry_id).bind(input.kind.as_str()).bind(input.confidence)
         .bind(&input.source_id).bind(json(&input.metadata)?).bind(occurred_at).execute(self.pool()).await?;
        let (passive, active) = if matches!(input.kind, KnowledgeEvidenceKind::Production) { (0, 1) } else { (1, 0) };
        sqlx::query(
            "INSERT INTO language_knowledge_states
             (id, profile_id, lexical_entry_id, state, passive_evidence, active_evidence, last_evidence_at, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, 'new', ?4, ?5, ?6, ?6, ?6, 1)
             ON CONFLICT(profile_id, lexical_entry_id) DO UPDATE SET
               passive_evidence = language_knowledge_states.passive_evidence + ?4,
               active_evidence = language_knowledge_states.active_evidence + ?5,
               last_evidence_at = ?6, updated_at = ?6, version = language_knowledge_states.version + 1",
        ).bind(uuid::Uuid::new_v4().to_string()).bind(&input.profile_id).bind(&input.entry_id).bind(passive).bind(active).bind(occurred_at).execute(self.pool()).await?;
        Ok(LanguageKnowledgeEvidenceEvent { id, profile_id: input.profile_id, lexical_entry_id: input.entry_id, kind: input.kind, confidence: input.confidence, source_id: input.source_id, metadata: input.metadata, occurred_at })
    }

    pub async fn undo_language_knowledge_change(&self, profile_id: &str, history_id: &str) -> Result<LanguageKnowledgeStateSnapshot> {
        let row = sqlx::query("SELECT * FROM language_knowledge_state_history WHERE profile_id = ?1 AND id = ?2 AND reverted_at IS NULL")
            .bind(profile_id).bind(history_id).fetch_optional(self.pool()).await?
            .ok_or_else(|| PlethoraError::NotFound(format!("State history {history_id}")))?;
        let entry_id: String = row.try_get("lexical_entry_id")?;
        let previous_state = LanguageKnowledgeState::parse(&row.try_get::<String, _>("previous_state")?);
        let result = self.set_language_knowledge_state(LanguageKnowledgeStateChange {
            profile_id: profile_id.to_string(), entry_id, state: previous_state,
            source: KnowledgeStateSource::Undo, actor_id: None, operation_id: None,
        }).await?;
        sqlx::query("UPDATE language_knowledge_state_history SET reverted_at = ?1 WHERE profile_id = ?2 AND id = ?3")
            .bind(Utc::now().timestamp()).bind(profile_id).bind(history_id).execute(self.pool()).await?;
        Ok(result)
    }

    pub async fn list_language_knowledge_history(&self, profile_id: &str, entry_id: Option<&str>, offset: i64, limit: i64) -> Result<LexiconPage<LanguageKnowledgeStateHistory>> {
        let (offset, limit) = page_bounds(offset, limit);
        let (where_sql, values) = if entry_id.is_some() { ("profile_id = ?1 AND lexical_entry_id = ?2", vec![profile_id, entry_id.unwrap()]) } else { ("profile_id = ?1", vec![profile_id]) };
        let total_sql = format!("SELECT COUNT(*) FROM language_knowledge_state_history WHERE {where_sql}");
        let rows_sql = format!("SELECT * FROM language_knowledge_state_history WHERE {where_sql} ORDER BY changed_at DESC, id LIMIT ?{} OFFSET ?{}", values.len() + 1, values.len() + 2);
        let mut total_query = sqlx::query_scalar::<_, i64>(&total_sql);
        let mut rows_query = sqlx::query(&rows_sql);
        for value in &values { total_query = total_query.bind(*value); rows_query = rows_query.bind(*value); }
        let total = total_query.fetch_one(self.pool()).await?;
        let rows = rows_query.bind(limit).bind(offset).fetch_all(self.pool()).await?;
        Ok(LexiconPage { items: rows.iter().map(history_from_row).collect::<Result<Vec<_>>>()?, offset, limit, total, has_more: offset + (rows.len() as i64) < total })
    }

    pub async fn create_language_memorization_link(&self, input: LanguageMemorizationLinkInput) -> Result<LanguageMemorizationLink> {
        self.ensure_knowledge_entry(&input.profile_id, &input.entry_id).await?;
        let learning_exists = sqlx::query_scalar::<_, String>("SELECT id FROM learning_items WHERE id = ?1").bind(&input.learning_item_id).fetch_optional(self.pool()).await?;
        if learning_exists.is_none() { return Err(PlethoraError::NotFound(format!("Learning item {}", input.learning_item_id))); }
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        sqlx::query(
            "INSERT INTO language_memorization_links (id, profile_id, lexical_entry_id, learning_item_id, relation, actor_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(profile_id, lexical_entry_id, learning_item_id) DO UPDATE SET relation = excluded.relation, actor_id = excluded.actor_id",
        ).bind(&id).bind(&input.profile_id).bind(&input.entry_id).bind(&input.learning_item_id).bind(&input.relation).bind(&input.actor_id).bind(now).execute(self.pool()).await?;
        let row = sqlx::query("SELECT * FROM language_memorization_links WHERE profile_id = ?1 AND lexical_entry_id = ?2 AND learning_item_id = ?3")
            .bind(&input.profile_id).bind(&input.entry_id).bind(&input.learning_item_id).fetch_one(self.pool()).await?;
        link_from_row(&row)
    }

    pub async fn preview_known_word_import(&self, profile_id: &str, records: &[KnownWordImportRecord]) -> Result<KnownWordImportPreview> {
        let mut matched_entry_ids = Vec::new(); let mut new_words = Vec::new(); let mut duplicates = Vec::new(); let mut seen = HashSet::new();
        for record in records {
            let normalized = normalize_lexical_form(&record.word);
            if !seen.insert(normalized.clone()) { duplicates.push(record.word.clone()); continue; }
            let mut query = "SELECT id FROM language_lexical_entries WHERE profile_id = ?1 AND normalized_form = ?2".to_string();
            if record.language_tag.is_some() { query.push_str(" AND language_tag = ?3"); }
            query.push_str(" LIMIT 1");
            let found = if let Some(language_tag) = record.language_tag.as_deref() { sqlx::query_scalar::<_, String>(&query).bind(profile_id).bind(&normalized).bind(language_tag).fetch_optional(self.pool()).await? } else { sqlx::query_scalar::<_, String>(&query).bind(profile_id).bind(&normalized).fetch_optional(self.pool()).await? };
            if let Some(id) = found { matched_entry_ids.push(id); } else { new_words.push(record.word.clone()); }
        }
        Ok(KnownWordImportPreview { matched_entry_ids, new_words, duplicates })
    }

    pub async fn import_known_words(&self, profile_id: &str, records: Vec<KnownWordImportRecord>) -> Result<LanguageKnowledgeExport> {
        for record in records {
            let normalized = normalize_lexical_form(&record.word);
            let entry_id = if let Some(language_tag) = record.language_tag.as_deref() {
                sqlx::query_scalar::<_, String>("SELECT id FROM language_lexical_entries WHERE profile_id = ?1 AND language_tag = ?2 AND normalized_form = ?3 LIMIT 1")
                    .bind(profile_id).bind(language_tag).bind(&normalized).fetch_optional(self.pool()).await?
            } else { sqlx::query_scalar::<_, String>("SELECT id FROM language_lexical_entries WHERE profile_id = ?1 AND normalized_form = ?2 LIMIT 1").bind(profile_id).bind(&normalized).fetch_optional(self.pool()).await? };
            let entry_id = match entry_id {
                Some(id) => id,
                None => self.upsert_language_lexical_entry(LexicalEntryUpsert { profile_id: profile_id.to_string(), language_tag: record.language_tag.unwrap_or_else(|| "und".to_string()), normalized_form: normalized.clone(), canonical_form: Some(record.word), ..Default::default() }).await?.id,
            };
            self.set_language_knowledge_state(LanguageKnowledgeStateChange { profile_id: profile_id.to_string(), entry_id, state: record.state, source: KnowledgeStateSource::Import, actor_id: None, operation_id: None }).await?;
        }
        self.export_language_knowledge(profile_id).await
    }

    pub async fn export_language_knowledge(&self, profile_id: &str) -> Result<LanguageKnowledgeExport> {
        let states = sqlx::query(
            "SELECT e.profile_id, e.id AS lexical_entry_id, COALESCE(s.state, COALESCE(e.knowledge_state, 'new')) AS resolved_state,
                    COALESCE(s.manual_override, 0) AS manual_override, s.override_actor, s.override_source,
                    COALESCE(s.passive_evidence, e.passive_evidence_count, 0) AS passive_evidence,
                    COALESCE(s.active_evidence, e.active_evidence_count, 0) AS active_evidence, s.last_evidence_at,
                    COALESCE(s.updated_at, e.updated_at) AS updated_at, COALESCE(s.version, 0) AS state_version
             FROM language_lexical_entries e LEFT JOIN language_knowledge_states s ON s.profile_id = e.profile_id AND s.lexical_entry_id = e.id
             WHERE e.profile_id = ?1 ORDER BY e.updated_at DESC",
        ).bind(profile_id).fetch_all(self.pool()).await?.iter().map(snapshot_from_row).collect::<Result<Vec<_>>>()?;
        let history = sqlx::query("SELECT * FROM language_knowledge_state_history WHERE profile_id = ?1 ORDER BY changed_at DESC LIMIT 10000").bind(profile_id).fetch_all(self.pool()).await?.iter().map(history_from_row).collect::<Result<Vec<_>>>()?;
        let evidence = sqlx::query("SELECT * FROM language_knowledge_evidence_events WHERE profile_id = ?1 ORDER BY occurred_at DESC LIMIT 10000").bind(profile_id).fetch_all(self.pool()).await?.iter().map(evidence_from_row).collect::<Result<Vec<_>>>()?;
        let memorization_links = sqlx::query("SELECT * FROM language_memorization_links WHERE profile_id = ?1 ORDER BY created_at DESC").bind(profile_id).fetch_all(self.pool()).await?.iter().map(link_from_row).collect::<Result<Vec<_>>>()?;
        Ok(LanguageKnowledgeExport { schema_version: LANGUAGE_KNOWLEDGE_SCHEMA_VERSION, profile_id: profile_id.to_string(), exported_at: Utc::now().timestamp(), states, history, evidence, memorization_links })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::language_lexicon::EncounterInput;
    use crate::models::language_profile::LanguageProfileCreate;
    use std::path::PathBuf;

    async fn repository() -> Repository {
        let database = Database::new(PathBuf::from(":memory:")).await.expect("database");
        database.migrate().await.expect("migrations");
        Repository::new(database.pool().clone())
    }

    async fn profile(repo: &Repository) -> String {
        repo.create_language_profile(LanguageProfileCreate { name: "Spanish".into(), target_language: "es".into(), base_language: "en".into(), ..Default::default() }, None, None).await.unwrap().id
    }

    async fn entry(repo: &Repository, profile_id: &str, surface: &str, token: &str, lemma: Option<&str>, confidence: f64) -> String {
        repo.record_language_encounter(EncounterInput {
            profile_id: profile_id.into(), language_tag: "es".into(), surface: surface.into(), lemma: lemma.map(str::to_string), confidence: Some(confidence), token_id: Some(token.into()), document_id: Some("doc-knowledge".into()), ..Default::default()
        }).await.unwrap().id
    }

    #[tokio::test]
    async fn automatic_encounter_is_conservative_and_manual_state_is_undoable() {
        let repo = repository().await;
        let profile_id = profile(&repo).await;
        let entry_id = entry(&repo, &profile_id, "hablando", "tok-1", Some("hablar"), 0.99).await;
        let initial = repo.get_language_knowledge_state(&profile_id, &entry_id).await.unwrap();
        assert_eq!(initial.state, LanguageKnowledgeState::Encountered);
        assert!(!initial.manual_override);
        let known = repo.set_language_knowledge_state(LanguageKnowledgeStateChange { profile_id: profile_id.clone(), entry_id: entry_id.clone(), state: LanguageKnowledgeState::Known, source: KnowledgeStateSource::Manual, ..Default::default() }).await.unwrap();
        assert_eq!(known.state, LanguageKnowledgeState::Known);
        assert!(known.manual_override);
        repo.record_language_encounter(EncounterInput { profile_id: profile_id.clone(), language_tag: "es".into(), surface: "habló".into(), lemma: Some("hablar".into()), confidence: Some(0.99), token_id: Some("tok-2".into()), ..Default::default() }).await.unwrap();
        assert_eq!(repo.get_language_knowledge_state(&profile_id, &entry_id).await.unwrap().state, LanguageKnowledgeState::Known);
        let history = repo.list_language_knowledge_history(&profile_id, Some(&entry_id), 0, 50).await.unwrap();
        let state_change = history.items.iter().find(|item| item.new_state == LanguageKnowledgeState::Known).unwrap();
        let undone = repo.undo_language_knowledge_change(&profile_id, &state_change.id).await.unwrap();
        assert_eq!(undone.state, LanguageKnowledgeState::Encountered);
        assert!(!undone.manual_override);
    }

    #[tokio::test]
    async fn exact_form_override_precedes_lemma_and_evidence_is_dimensioned() {
        let repo = repository().await;
        let profile_id = profile(&repo).await;
        let lemma_id = entry(&repo, &profile_id, "hablando", "tok-lemma", Some("hablar"), 0.99).await;
        repo.set_language_knowledge_state(LanguageKnowledgeStateChange { profile_id: profile_id.clone(), entry_id: lemma_id.clone(), state: LanguageKnowledgeState::Known, source: KnowledgeStateSource::Manual, ..Default::default() }).await.unwrap();
        let resolved = repo.resolve_language_knowledge_state(&profile_id, "hablando").await.unwrap().unwrap();
        assert_eq!(resolved.lexical_entry_id, lemma_id);
        let exact_id = entry(&repo, &profile_id, "hablando", "tok-exact", Some("hablar"), 0.2).await;
        repo.set_language_knowledge_state(LanguageKnowledgeStateChange { profile_id: profile_id.clone(), entry_id: exact_id.clone(), state: LanguageKnowledgeState::Learning, source: KnowledgeStateSource::Manual, ..Default::default() }).await.unwrap();
        let exact = repo.resolve_language_knowledge_state(&profile_id, "hablando").await.unwrap().unwrap();
        assert_eq!(exact.lexical_entry_id, exact_id);
        assert_eq!(exact.state, LanguageKnowledgeState::Learning);
        repo.record_language_knowledge_evidence(LanguageKnowledgeEvidenceInput { profile_id: profile_id.clone(), entry_id: exact_id.clone(), kind: KnowledgeEvidenceKind::Production, confidence: Some(0.9), ..Default::default() }).await.unwrap();
        let snapshot = repo.get_language_knowledge_state(&profile_id, &exact_id).await.unwrap();
        assert!(snapshot.active_evidence >= 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM learning_items").fetch_one(repo.pool()).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn batch_import_and_memorization_link_are_explicit() {
        let repo = repository().await;
        let profile_id = profile(&repo).await;
        let first = entry(&repo, &profile_id, "casa", "tok-casa", None, 1.0).await;
        let second = entry(&repo, &profile_id, "perro", "tok-perro", None, 1.0).await;
        let snapshots = repo.set_language_knowledge_states_batch(vec![
            LanguageKnowledgeStateChange { profile_id: profile_id.clone(), entry_id: first.clone(), state: LanguageKnowledgeState::Known, source: KnowledgeStateSource::Manual, ..Default::default() },
            LanguageKnowledgeStateChange { profile_id: profile_id.clone(), entry_id: second, state: LanguageKnowledgeState::Familiar, source: KnowledgeStateSource::Manual, ..Default::default() },
        ]).await.unwrap();
        assert_eq!(snapshots.len(), 2);
        let preview = repo.preview_known_word_import(&profile_id, &[KnownWordImportRecord { word: "casa".into(), language_tag: Some("es".into()), state: LanguageKnowledgeState::Known, source: None }, KnownWordImportRecord { word: "casa".into(), language_tag: Some("es".into()), state: LanguageKnowledgeState::Known, source: None }, KnownWordImportRecord { word: "nuevo".into(), language_tag: Some("es".into()), state: LanguageKnowledgeState::Known, source: None }]).await.unwrap();
        assert_eq!(preview.matched_entry_ids.len(), 1);
        assert_eq!(preview.duplicates, vec!["casa"]);
        sqlx::query("INSERT INTO learning_items (id, item_type, question, due_date, date_created, date_modified) VALUES ('item-knowledge', 'basic', 'q', '2026-01-01', '2026-01-01', '2026-01-01')").execute(repo.pool()).await.unwrap();
        let link = repo.create_language_memorization_link(LanguageMemorizationLinkInput { profile_id: profile_id.clone(), entry_id: first, learning_item_id: "item-knowledge".into(), ..Default::default() }).await.unwrap();
        assert_eq!(link.learning_item_id, "item-knowledge");
        assert_eq!(repo.export_language_knowledge(&profile_id).await.unwrap().schema_version, LANGUAGE_KNOWLEDGE_SCHEMA_VERSION);
    }
}
