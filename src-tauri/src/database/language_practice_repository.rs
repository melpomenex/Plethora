//! Repository operations for compact, profile-scoped practice attempts.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
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
        source_anchor: row
            .try_get::<Option<String>, _>("source_anchor_json")?
            .and_then(|value| serde_json::from_str(&value).ok()),
        source_fingerprint: row.try_get("source_fingerprint")?,
        prompt_text: row.try_get("prompt_text")?,
        raw_response: row.try_get("raw_response")?,
        normalized_response: row.try_get("normalized_response")?,
        comparison: row
            .try_get::<Option<String>, _>("comparison_json")?
            .and_then(|value| serde_json::from_str(&value).ok()),
        provider_id: row.try_get("provider_id")?,
        provider_version: row.try_get("provider_version")?,
        privacy_mode: row.try_get("privacy_mode")?,
        retention_expires_at: row.try_get("retention_expires_at")?,
        active_evidence_accepted: row.try_get::<i64, _>("active_evidence_accepted")? != 0,
        revealed: row.try_get::<i64, _>("revealed")? != 0,
        media_id: row.try_get("media_id")?,
        start_ms: row.try_get("start_ms")?,
        end_ms: row.try_get("end_ms")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn json(value: &Option<serde_json::Value>) -> Result<Option<String>> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(Into::into)
}

impl Repository {
    async fn ensure_practice_profile(&self, profile_id: &str) -> Result<()> {
        let exists = sqlx::query_scalar::<_, String>(
            "SELECT id FROM language_profiles WHERE id = ?1 AND lifecycle <> 'deleted'",
        )
        .bind(profile_id)
        .fetch_optional(self.pool())
        .await?;
        if exists.is_none() {
            return Err(PlethoraError::NotFound(format!(
                "Language profile {profile_id}"
            )));
        }
        Ok(())
    }

    pub async fn upsert_language_practice_attempt(
        &self,
        mut attempt: LanguagePracticeAttempt,
    ) -> Result<LanguagePracticeAttempt> {
        self.ensure_practice_profile(&attempt.profile_id).await?;
        let existing_owner = sqlx::query_scalar::<_, String>(
            "SELECT profile_id FROM language_practice_attempts WHERE id = ?1",
        )
        .bind(&attempt.id)
        .fetch_optional(self.pool())
        .await?;
        if let Some(owner) = existing_owner {
            if owner != attempt.profile_id {
                return Err(PlethoraError::InvalidInput(format!(
                    "Practice attempt {} belongs to another language profile",
                    attempt.id
                )));
            }
        }
        let now = Utc::now().timestamp();
        if attempt.created_at <= 0 {
            attempt.created_at = now;
        }
        attempt.updated_at = now;
        sqlx::query(
            "INSERT INTO language_practice_attempts
             (id, profile_id, mode, status, source_type, source_id, source_anchor_json, source_fingerprint,
              prompt_text, raw_response, normalized_response, comparison_json, provider_id, provider_version,
              privacy_mode, retention_expires_at, active_evidence_accepted, revealed, media_id, start_ms, end_ms, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
             ON CONFLICT(id) DO UPDATE SET raw_response = excluded.raw_response,
               status = excluded.status,
               normalized_response = excluded.normalized_response, comparison_json = excluded.comparison_json,
               provider_id = excluded.provider_id, provider_version = excluded.provider_version,
               privacy_mode = excluded.privacy_mode, retention_expires_at = excluded.retention_expires_at,
               active_evidence_accepted = excluded.active_evidence_accepted, revealed = excluded.revealed,
               media_id = excluded.media_id, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
               updated_at = excluded.updated_at
             WHERE language_practice_attempts.profile_id = excluded.profile_id",
        )
        .bind(&attempt.id).bind(&attempt.profile_id).bind(&attempt.mode).bind(&attempt.status).bind(&attempt.source_type).bind(&attempt.source_id)
        .bind(json(&attempt.source_anchor)?).bind(&attempt.source_fingerprint).bind(&attempt.prompt_text)
        .bind(&attempt.raw_response).bind(&attempt.normalized_response).bind(json(&attempt.comparison)?)
        .bind(&attempt.provider_id).bind(&attempt.provider_version).bind(&attempt.privacy_mode)
        .bind(attempt.retention_expires_at).bind(if attempt.active_evidence_accepted { 1i64 } else { 0 })
        .bind(if attempt.revealed { 1i64 } else { 0 }).bind(&attempt.media_id).bind(attempt.start_ms).bind(attempt.end_ms)
        .bind(attempt.created_at).bind(attempt.updated_at).execute(self.pool()).await?;
        self.get_language_practice_attempt(&attempt.profile_id, &attempt.id)
            .await
    }

    pub async fn get_language_practice_attempt(
        &self,
        profile_id: &str,
        id: &str,
    ) -> Result<LanguagePracticeAttempt> {
        self.ensure_practice_profile(profile_id).await?;
        let row = sqlx::query(
            "SELECT * FROM language_practice_attempts WHERE profile_id = ?1 AND id = ?2",
        )
        .bind(profile_id)
        .bind(id)
        .fetch_one(self.pool())
        .await?;
        from_row(&row)
    }

    pub async fn list_language_practice_attempts(
        &self,
        profile_id: &str,
        source_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<LanguagePracticeAttempt>> {
        self.list_language_practice_attempts_filtered(profile_id, source_id, None, None, 0, limit)
            .await
    }

    pub async fn list_language_practice_attempts_filtered(
        &self,
        profile_id: &str,
        source_id: Option<&str>,
        mode: Option<&str>,
        status: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<LanguagePracticeAttempt>> {
        self.ensure_practice_profile(profile_id).await?;
        let mut predicates = vec!["profile_id = ?1".to_string()];
        let mut binds: Vec<&str> = Vec::new();
        if let Some(value) = source_id {
            predicates.push(format!("source_id = ?{}", binds.len() + 2));
            binds.push(value);
        }
        if let Some(value) = mode {
            predicates.push(format!("mode = ?{}", binds.len() + 2));
            binds.push(value);
        }
        if let Some(value) = status {
            predicates.push(format!("status = ?{}", binds.len() + 2));
            binds.push(value);
        }
        let sql = format!(
            "SELECT * FROM language_practice_attempts WHERE {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
            predicates.join(" AND "),
            binds.len() + 2,
            binds.len() + 3
        );
        let mut query = sqlx::query(&sql).bind(profile_id);
        for value in binds {
            query = query.bind(value);
        }
        let rows = query
            .bind(limit.clamp(1, 200))
            .bind(offset.max(0))
            .fetch_all(self.pool())
            .await?;
        rows.iter().map(from_row).collect()
    }

    pub async fn delete_language_practice_attempt(
        &self,
        profile_id: &str,
        id: &str,
    ) -> Result<bool> {
        self.ensure_practice_profile(profile_id).await?;
        let result =
            sqlx::query("DELETE FROM language_practice_attempts WHERE profile_id = ?1 AND id = ?2")
                .bind(profile_id)
                .bind(id)
                .execute(self.pool())
                .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn purge_expired_language_practice_attempts(
        &self,
        profile_id: &str,
        now: i64,
    ) -> Result<i64> {
        self.ensure_practice_profile(profile_id).await?;
        let normalized_now = if now > 10_000_000_000 { now / 1000 } else { now };
        let result = sqlx::query("DELETE FROM language_practice_attempts WHERE profile_id = ?1 AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?2")
            .bind(profile_id).bind(normalized_now).execute(self.pool()).await?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn export_language_practice_attempts(
        &self,
        profile_id: &str,
    ) -> Result<Vec<LanguagePracticeAttempt>> {
        self.ensure_practice_profile(profile_id).await?;
        let rows = sqlx::query("SELECT * FROM language_practice_attempts WHERE profile_id = ?1 ORDER BY created_at ASC")
            .bind(profile_id).fetch_all(self.pool()).await?;
        rows.iter().map(from_row).collect()
    }

    pub async fn import_language_practice_attempts(
        &self,
        profile_id: &str,
        attempts: Vec<LanguagePracticeAttempt>,
    ) -> Result<i64> {
        self.ensure_practice_profile(profile_id).await?;
        let mut imported = 0i64;
        for mut attempt in attempts {
            attempt.profile_id = profile_id.to_string();
            self.upsert_language_practice_attempt(attempt).await?;
            imported += 1;
        }
        Ok(imported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::language_profile::LanguageProfileCreate;
    use std::path::PathBuf;

    async fn repository() -> Repository {
        let database = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("database");
        database.migrate().await.expect("migrations");
        Repository::new(database.pool().clone())
    }

    async fn create_profile_id(repo: &Repository) -> String {
        let profile = repo
            .create_language_profile(
                LanguageProfileCreate {
                    name: "Spanish".to_string(),
                    target_language: "es".to_string(),
                    base_language: "en".to_string(),
                    ..Default::default()
                },
                None,
                None,
            )
            .await
            .expect("profile");
        profile.id
    }

    fn sample_attempt(profile_id: &str, id: &str, source_id: &str) -> LanguagePracticeAttempt {
        LanguagePracticeAttempt {
            id: id.to_string(),
            profile_id: profile_id.to_string(),
            mode: "dictation".to_string(),
            status: "submitted".to_string(),
            source_type: Some("document".to_string()),
            source_id: Some(source_id.to_string()),
            source_fingerprint: Some("fp-1".to_string()),
            prompt_text: "Hola".to_string(),
            raw_response: Some("hola".to_string()),
            normalized_response: Some("hola".to_string()),
            comparison: Some(serde_json::json!({ "exact": true, "score": 1.0, "errors": [] })),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn upsert_and_get_round_trip() {
        let repo = repository().await;
        let profile_id = create_profile_id(&repo).await;
        let attempt = sample_attempt(&profile_id, "attempt-1", "doc-1");
        let saved = repo
            .upsert_language_practice_attempt(attempt)
            .await
            .unwrap();
        assert_eq!(saved.id, "attempt-1");
        assert_eq!(saved.raw_response.as_deref(), Some("hola"));
        let loaded = repo
            .get_language_practice_attempt(&profile_id, "attempt-1")
            .await
            .unwrap();
        assert_eq!(loaded.prompt_text, "Hola");
        assert_eq!(
            loaded
                .comparison
                .as_ref()
                .and_then(|value| value.get("exact"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[tokio::test]
    async fn list_filters_by_source_and_delete_removes_attempt() {
        let repo = repository().await;
        let profile_id = create_profile_id(&repo).await;
        repo.upsert_language_practice_attempt(sample_attempt(&profile_id, "attempt-1", "doc-1"))
            .await
            .unwrap();
        repo.upsert_language_practice_attempt(sample_attempt(&profile_id, "attempt-2", "doc-2"))
            .await
            .unwrap();

        let filtered = repo
            .list_language_practice_attempts(&profile_id, Some("doc-1"), 10)
            .await
            .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "attempt-1");

        assert!(repo
            .delete_language_practice_attempt(&profile_id, "attempt-1")
            .await
            .unwrap());
        let remaining = repo
            .list_language_practice_attempts(&profile_id, None, 10)
            .await
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "attempt-2");
    }

    #[tokio::test]
    async fn purge_expired_and_export_ordered() {
        let repo = repository().await;
        let profile_id = create_profile_id(&repo).await;
        let mut expired = sample_attempt(&profile_id, "expired", "doc-1");
        expired.retention_expires_at = Some(100);
        let mut fresh = sample_attempt(&profile_id, "fresh", "doc-1");
        fresh.retention_expires_at = Some(9_999);
        repo.upsert_language_practice_attempt(expired)
            .await
            .unwrap();
        repo.upsert_language_practice_attempt(fresh).await.unwrap();

        let removed = repo
            .purge_expired_language_practice_attempts(&profile_id, 500)
            .await
            .unwrap();
        assert_eq!(removed, 1);
        let exported = repo
            .export_language_practice_attempts(&profile_id)
            .await
            .unwrap();
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].id, "fresh");
    }
}
