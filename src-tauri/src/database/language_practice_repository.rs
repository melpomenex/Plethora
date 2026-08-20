//! Repository operations for compact, profile-scoped practice attempts.

use crate::database::Repository;
use crate::error::Result;
use crate::models::language_practice::LanguagePracticeAttempt;
use chrono::Utc;
use sqlx::{sqlite::SqliteRow, Row};

fn from_row(row: &SqliteRow) -> Result<LanguagePracticeAttempt> {
    Ok(LanguagePracticeAttempt {
        id: row.try_get("id")?,
        profile_id: row.try_get("profile_id")?,
        mode: row.try_get("mode")?,
        status: row.try_get("status")?,
        source_type: row.try_get("source_type")?,
        source_id: row.try_get("source_id")?,
        source_anchor: row.try_get::<Option<String>, _>("source_anchor_json")?.and_then(|value| serde_json::from_str(&value).ok()),
        source_fingerprint: row.try_get("source_fingerprint")?,
        prompt_text: row.try_get("prompt_text")?,
        raw_response: row.try_get("raw_response")?,
        normalized_response: row.try_get("normalized_response")?,
        comparison: row.try_get::<Option<String>, _>("comparison_json")?.and_then(|value| serde_json::from_str(&value).ok()),
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
        privacy_mode: row.try_get("privacy_mode")?,
        retention_expires_at: row.try_get("retention_expires_at")?,
        active_evidence_accepted: row.try_get::<i64, _>("active_evidence_accepted")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn json(value: &Option<serde_json::Value>) -> Result<Option<String>> {
    value.as_ref().map(serde_json::to_string).transpose().map_err(Into::into)
}

impl Repository {
    pub async fn upsert_language_practice_attempt(&self, mut attempt: LanguagePracticeAttempt) -> Result<LanguagePracticeAttempt> {
        let now = Utc::now().timestamp();
        if attempt.created_at <= 0 { attempt.created_at = now; }
        attempt.updated_at = now;
        sqlx::query(
            "INSERT INTO language_practice_attempts
             (id, profile_id, mode, status, source_type, source_id, source_anchor_json, source_fingerprint,
              prompt_text, raw_response, normalized_response, comparison_json, provider_id, provider_version,
              privacy_mode, retention_expires_at, active_evidence_accepted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(id) DO UPDATE SET raw_response = excluded.raw_response,
               status = excluded.status,
               normalized_response = excluded.normalized_response, comparison_json = excluded.comparison_json,
               provider_id = excluded.provider_id, provider_version = excluded.provider_version,
               privacy_mode = excluded.privacy_mode, retention_expires_at = excluded.retention_expires_at,
               active_evidence_accepted = excluded.active_evidence_accepted, updated_at = excluded.updated_at",
        )
        .bind(&attempt.id).bind(&attempt.profile_id).bind(&attempt.mode).bind(&attempt.status).bind(&attempt.source_type).bind(&attempt.source_id)
        .bind(json(&attempt.source_anchor)?).bind(&attempt.source_fingerprint).bind(&attempt.prompt_text)
        .bind(&attempt.raw_response).bind(&attempt.normalized_response).bind(json(&attempt.comparison)?)
        .bind(&attempt.provider_id).bind(&attempt.provider_version).bind(&attempt.privacy_mode)
        .bind(attempt.retention_expires_at).bind(if attempt.active_evidence_accepted { 1i64 } else { 0 })
        .bind(attempt.created_at).bind(attempt.updated_at).execute(self.pool()).await?;
        self.get_language_practice_attempt(&attempt.profile_id, &attempt.id).await
    }

    pub async fn get_language_practice_attempt(&self, profile_id: &str, id: &str) -> Result<LanguagePracticeAttempt> {
        let row = sqlx::query("SELECT * FROM language_practice_attempts WHERE profile_id = ?1 AND id = ?2")
            .bind(profile_id).bind(id).fetch_one(self.pool()).await?;
        from_row(&row)
    }

    pub async fn list_language_practice_attempts(&self, profile_id: &str, source_id: Option<&str>, limit: i64) -> Result<Vec<LanguagePracticeAttempt>> {
        let rows = if let Some(source_id) = source_id {
            sqlx::query("SELECT * FROM language_practice_attempts WHERE profile_id = ?1 AND source_id = ?2 ORDER BY created_at DESC LIMIT ?3")
                .bind(profile_id).bind(source_id).bind(limit.clamp(1, 200)).fetch_all(self.pool()).await?
        } else {
            sqlx::query("SELECT * FROM language_practice_attempts WHERE profile_id = ?1 ORDER BY created_at DESC LIMIT ?2")
                .bind(profile_id).bind(limit.clamp(1, 200)).fetch_all(self.pool()).await?
        };
        rows.iter().map(from_row).collect()
    }

    pub async fn delete_language_practice_attempt(&self, profile_id: &str, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM language_practice_attempts WHERE profile_id = ?1 AND id = ?2")
            .bind(profile_id).bind(id).execute(self.pool()).await?;
        Ok(result.rows_affected() > 0)
    }
}
