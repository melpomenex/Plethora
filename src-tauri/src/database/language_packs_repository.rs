//! Repository operations for Language Packs and offline dictionary entries.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::language_ecosystem::{LanguageDictionaryEntryRecord, LanguagePackRecord};
use crate::models::language_lexicon::normalize_lexical_form;
use chrono::Utc;
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};

fn pack_from_row(row: &SqliteRow) -> Result<LanguagePackRecord> {
    Ok(LanguagePackRecord {
        id: row.try_get("id")?,
        language_tag: row.try_get("language_tag")?,
        target_language: row.try_get("target_language")?,
        base_language: row.try_get("base_language")?,
        name: row.try_get("name")?,
        kind: row.try_get("kind")?,
        format: row.try_get("format")?,
        version: row.try_get("version")?,
        source_url: row.try_get("source_url")?,
        sha256: row.try_get("sha256")?,
        size_bytes: row.try_get("size_bytes")?,
        entry_count: row.try_get("entry_count")?,
        license: row.try_get("license")?,
        attribution: row.try_get("attribution")?,
        capabilities: row
            .try_get::<Option<String>, _>("capabilities_json")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Value::Object(Default::default())),
        install_path: row.try_get("install_path")?,
        status: row.try_get("status")?,
        error: row.try_get("error")?,
        installed_at: row.try_get("installed_at")?,
        updated_at: row.try_get("updated_at")?,
        last_verified_at: row.try_get("last_verified_at")?,
    })
}

fn dict_entry_from_row(row: &SqliteRow) -> Result<LanguageDictionaryEntryRecord> {
    Ok(LanguageDictionaryEntryRecord {
        id: row.try_get("id")?,
        pack_id: row.try_get("pack_id")?,
        language_tag: row.try_get("language_tag")?,
        headword: row.try_get("headword")?,
        normalized_headword: row.try_get("normalized_headword")?,
        reading: row.try_get("reading")?,
        lemma: row.try_get("lemma")?,
        part_of_speech: row.try_get("part_of_speech")?,
        morphology: row
            .try_get::<Option<String>, _>("morphology_json")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Value::Object(Default::default())),
        senses: row
            .try_get::<Option<String>, _>("senses_json")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Value::Array(Vec::new())),
        examples: row
            .try_get::<Option<String>, _>("examples_json")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Value::Array(Vec::new())),
        frequency_rank: row.try_get("frequency_rank")?,
    })
}

impl Repository {
    pub async fn list_language_packs(&self, language_tag: Option<&str>) -> Result<Vec<LanguagePackRecord>> {
        let rows = if let Some(lang) = language_tag.filter(|s| !s.trim().is_empty()) {
            sqlx::query(
                "SELECT * FROM language_packs WHERE (language_tag = ?1 OR target_language = ?1) AND status <> 'removed' ORDER BY updated_at DESC",
            )
            .bind(lang)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM language_packs WHERE status <> 'removed' ORDER BY updated_at DESC",
            )
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(pack_from_row).collect()
    }

    pub async fn install_language_pack_with_entries(
        &self,
        mut pack: LanguagePackRecord,
        entries: Vec<LanguageDictionaryEntryRecord>,
    ) -> Result<LanguagePackRecord> {
        if pack.id.trim().is_empty() || pack.language_tag.trim().is_empty() {
            return Err(PlethoraError::InvalidInput("Pack id and languageTag are required".to_string()));
        }
        let now = Utc::now().timestamp();
        if pack.installed_at <= 0 {
            pack.installed_at = now;
        }
        pack.updated_at = now;
        pack.last_verified_at = Some(now);
        pack.entry_count = entries.len() as i64;
        pack.status = "installed".to_string();

        let mut tx = self.pool().begin().await?;
        sqlx::query(
            "INSERT INTO language_packs
             (id, language_tag, target_language, base_language, name, kind, format, version,
              source_url, sha256, size_bytes, entry_count, license, attribution, capabilities_json,
              install_path, status, error, installed_at, updated_at, last_verified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
             ON CONFLICT(id) DO UPDATE SET
              language_tag = excluded.language_tag,
              target_language = excluded.target_language,
              base_language = excluded.base_language,
              name = excluded.name,
              kind = excluded.kind,
              format = excluded.format,
              version = excluded.version,
              source_url = excluded.source_url,
              sha256 = excluded.sha256,
              size_bytes = excluded.size_bytes,
              entry_count = excluded.entry_count,
              license = excluded.license,
              attribution = excluded.attribution,
              capabilities_json = excluded.capabilities_json,
              install_path = excluded.install_path,
              status = excluded.status,
              error = excluded.error,
              updated_at = excluded.updated_at,
              last_verified_at = excluded.last_verified_at",
        )
        .bind(&pack.id)
        .bind(&pack.language_tag)
        .bind(&pack.target_language)
        .bind(&pack.base_language)
        .bind(&pack.name)
        .bind(&pack.kind)
        .bind(&pack.format)
        .bind(&pack.version)
        .bind(&pack.source_url)
        .bind(&pack.sha256)
        .bind(pack.size_bytes)
        .bind(pack.entry_count)
        .bind(&pack.license)
        .bind(&pack.attribution)
        .bind(serde_json::to_string(&pack.capabilities)?)
        .bind(&pack.install_path)
        .bind(&pack.status)
        .bind(&pack.error)
        .bind(pack.installed_at)
        .bind(pack.updated_at)
        .bind(pack.last_verified_at)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM language_dictionary_entries WHERE pack_id = ?1")
            .bind(&pack.id)
            .execute(&mut *tx)
            .await?;

        for entry in &entries {
            let norm = if entry.normalized_headword.trim().is_empty() {
                normalize_lexical_form(&entry.headword)
            } else {
                normalize_lexical_form(&entry.normalized_headword)
            };
            let entry_id = if entry.id.trim().is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                entry.id.clone()
            };
            let lang = if entry.language_tag.trim().is_empty() {
                &pack.language_tag
            } else {
                &entry.language_tag
            };
            sqlx::query(
                "INSERT INTO language_dictionary_entries
                 (id, pack_id, language_tag, headword, normalized_headword, reading, lemma,
                  part_of_speech, morphology_json, senses_json, examples_json, frequency_rank)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .bind(&entry_id)
            .bind(&pack.id)
            .bind(lang)
            .bind(&entry.headword)
            .bind(&norm)
            .bind(&entry.reading)
            .bind(&entry.lemma)
            .bind(&entry.part_of_speech)
            .bind(serde_json::to_string(&entry.morphology)?)
            .bind(serde_json::to_string(&entry.senses)?)
            .bind(serde_json::to_string(&entry.examples)?)
            .bind(entry.frequency_rank)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(pack)
    }

    pub async fn lookup_language_pack_dictionary(
        &self,
        language_tag: &str,
        query: &str,
        lemma: Option<&str>,
        limit: i64,
    ) -> Result<Vec<LanguageDictionaryEntryRecord>> {
        let normalized = normalize_lexical_form(query);
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        let primary = language_tag
            .split('-')
            .next()
            .unwrap_or(language_tag)
            .to_lowercase();
        let lemma_norm = lemma.map(normalize_lexical_form).filter(|s| !s.is_empty());
        let rows = if let Some(ref lnorm) = lemma_norm {
            sqlx::query(
                "SELECT d.* FROM language_dictionary_entries d
                 JOIN language_packs p ON p.id = d.pack_id
                 WHERE p.status = 'installed'
                   AND (LOWER(d.language_tag) = ?1 OR LOWER(d.language_tag) LIKE ?2)
                   AND (d.normalized_headword = ?3 OR LOWER(COALESCE(d.lemma, '')) = ?4 OR d.normalized_headword = ?4)
                 ORDER BY CASE WHEN d.normalized_headword = ?3 THEN 0 ELSE 1 END,
                          COALESCE(d.frequency_rank, 9999999) ASC
                 LIMIT ?5",
            )
            .bind(&primary)
            .bind(format!("{primary}-%"))
            .bind(&normalized)
            .bind(lnorm)
            .bind(limit.clamp(1, 50))
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT d.* FROM language_dictionary_entries d
                 JOIN language_packs p ON p.id = d.pack_id
                 WHERE p.status = 'installed'
                   AND (LOWER(d.language_tag) = ?1 OR LOWER(d.language_tag) LIKE ?2)
                   AND (d.normalized_headword = ?3 OR LOWER(COALESCE(d.lemma, '')) = ?3)
                 ORDER BY COALESCE(d.frequency_rank, 9999999) ASC
                 LIMIT ?4",
            )
            .bind(&primary)
            .bind(format!("{primary}-%"))
            .bind(&normalized)
            .bind(limit.clamp(1, 50))
            .fetch_all(self.pool())
            .await?
        };
        rows.iter().map(dict_entry_from_row).collect()
    }

    pub async fn verify_language_pack(&self, pack_id: &str) -> Result<LanguagePackRecord> {
        let row = sqlx::query("SELECT * FROM language_packs WHERE id = ?1")
            .bind(pack_id)
            .fetch_optional(self.pool())
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Language pack {pack_id}")))?;
        let mut pack = pack_from_row(&row)?;
        let actual_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM language_dictionary_entries WHERE pack_id = ?1",
        )
        .bind(pack_id)
        .fetch_one(self.pool())
        .await?;
        let now = Utc::now().timestamp();
        if actual_count != pack.entry_count && pack.entry_count > 0 {
            pack.status = "corrupt".to_string();
            pack.error = Some(format!(
                "Entry count mismatch: expected {}, found {}",
                pack.entry_count, actual_count
            ));
        } else {
            pack.status = "installed".to_string();
            pack.error = None;
        }
        pack.last_verified_at = Some(now);
        pack.updated_at = now;
        sqlx::query(
            "UPDATE language_packs SET status = ?1, error = ?2, last_verified_at = ?3, updated_at = ?4 WHERE id = ?5",
        )
        .bind(&pack.status)
        .bind(&pack.error)
        .bind(pack.last_verified_at)
        .bind(pack.updated_at)
        .bind(&pack.id)
        .execute(self.pool())
        .await?;
        Ok(pack)
    }

    pub async fn remove_language_pack(&self, pack_id: &str) -> Result<bool> {
        let res = sqlx::query("DELETE FROM language_packs WHERE id = ?1")
            .bind(pack_id)
            .execute(self.pool())
            .await?;
        Ok(res.rows_affected() > 0)
    }
}
