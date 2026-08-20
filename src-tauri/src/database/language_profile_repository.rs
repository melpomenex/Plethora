//! Repository operations for language-learning profiles.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::language_profile::{
    normalize_scope, validate_bcp47, AssociationMode, ContentType, DetectionEvidence,
    LanguageProfile, LanguageProfileAssociation, LanguageProfileAssociationInput,
    LanguageProfileCreate, LanguageProfileExport, LanguageProfileScope, LanguageProfileSuggestion,
    LanguageProfileSyncEnvelope, LanguageProfileUpdate, ProcessingConfig, ProfileDeleteReport,
    ProfileLifecycle, ProfilePreferences, ResolvedLanguageProfileContext,
    LANGUAGE_PROFILE_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use sqlx::{Row, Sqlite};

fn scope_values(scope: &LanguageProfileScope) -> (&str, &str) {
    (&scope.account_id, &scope.workspace_id)
}

fn parse_time(value: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value)
        .map(|date| date.with_timezone(&Utc))
        .unwrap_or_else(|_| DateTime::<Utc>::UNIX_EPOCH)
}

fn mode_to_str(mode: &AssociationMode) -> &'static str {
    match mode {
        AssociationMode::Auto => "auto",
        AssociationMode::Enabled => "enabled",
        AssociationMode::Disabled => "disabled",
    }
}

fn mode_from_str(value: &str) -> Result<AssociationMode> {
    match value {
        "auto" => Ok(AssociationMode::Auto),
        "enabled" => Ok(AssociationMode::Enabled),
        "disabled" => Ok(AssociationMode::Disabled),
        _ => Err(PlethoraError::InvalidInput(format!(
            "Unknown language profile association mode: {value}"
        ))),
    }
}

fn lifecycle_to_str(lifecycle: &ProfileLifecycle) -> &'static str {
    match lifecycle {
        ProfileLifecycle::Active => "active",
        ProfileLifecycle::Archived => "archived",
        ProfileLifecycle::Deleted => "deleted",
    }
}

fn lifecycle_from_str(value: &str) -> Result<ProfileLifecycle> {
    match value {
        "active" => Ok(ProfileLifecycle::Active),
        "archived" => Ok(ProfileLifecycle::Archived),
        "deleted" => Ok(ProfileLifecycle::Deleted),
        _ => Err(PlethoraError::InvalidInput(format!(
            "Unknown language profile lifecycle: {value}"
        ))),
    }
}

fn content_type_from_str(value: &str) -> Result<ContentType> {
    ContentType::try_from(value).map_err(PlethoraError::InvalidInput)
}

fn profile_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<LanguageProfile> {
    let preferences: ProfilePreferences = serde_json::from_str(
        &row.try_get::<String, _>("preferences_json")?,
    )
    .unwrap_or_default();
    let processing_config: ProcessingConfig = serde_json::from_str(
        &row.try_get::<String, _>("processing_config_json")?,
    )
    .unwrap_or_default();
    Ok(LanguageProfile {
        id: row.try_get("id")?,
        account_id: row.try_get("account_id")?,
        workspace_id: row.try_get("workspace_id")?,
        name: row.try_get("name")?,
        target_language: row.try_get("target_language")?,
        base_language: row.try_get("base_language")?,
        proficiency: row.try_get("proficiency")?,
        preferences,
        processing_config,
        created_at: parse_time(row.try_get("created_at")?),
        updated_at: parse_time(row.try_get("updated_at")?),
        lifecycle: lifecycle_from_str(&row.try_get::<String, _>("lifecycle")?)?,
        version: row.try_get("version")?,
    })
}

fn association_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<LanguageProfileAssociation> {
    let evidence = row
        .try_get::<Option<String>, _>("detection_evidence_json")?
        .and_then(|json| serde_json::from_str::<DetectionEvidence>(&json).ok());
    Ok(LanguageProfileAssociation {
        id: row.try_get("id")?,
        account_id: row.try_get("account_id")?,
        workspace_id: row.try_get("workspace_id")?,
        profile_id: row.try_get("profile_id")?,
        content_type: content_type_from_str(&row.try_get::<String, _>("content_type")?)?,
        content_id: row.try_get("content_id")?,
        mode: mode_from_str(&row.try_get::<String, _>("mode")?)?,
        detection_evidence: evidence,
        suggestion_dismissed: row.try_get::<i64, _>("suggestion_dismissed")? != 0,
        created_at: parse_time(row.try_get("created_at")?),
        updated_at: parse_time(row.try_get("updated_at")?),
        version: row.try_get("version")?,
    })
}

fn language_matches(profile_language: &str, detected_language: &str) -> bool {
    let profile_primary = profile_language.split('-').next().unwrap_or(profile_language);
    let detected_primary = detected_language.split('-').next().unwrap_or(detected_language);
    profile_language.eq_ignore_ascii_case(detected_language)
        || profile_primary.eq_ignore_ascii_case(detected_primary)
}

fn ensure_nonempty(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(PlethoraError::InvalidInput(format!("{label} cannot be empty")));
    }
    Ok(())
}

impl Repository {
    pub async fn create_language_profile(
        &self,
        input: LanguageProfileCreate,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfile> {
        let scope = normalize_scope(
            input.account_id.as_deref().or(account_id),
            input.workspace_id.as_deref().or(workspace_id),
        );
        ensure_nonempty(&input.name, "Profile name")?;
        let target_language = validate_bcp47(&input.target_language)
            .map_err(PlethoraError::InvalidInput)?;
        let base_language = validate_bcp47(&input.base_language)
            .map_err(PlethoraError::InvalidInput)?;
        let id = input
            .id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let preferences = serde_json::to_string(&input.preferences)?;
        let processing_config = serde_json::to_string(&input.processing_config)?;
        let inserted = sqlx::query(
            "INSERT INTO language_profiles
             (id, account_id, workspace_id, name, target_language, base_language,
              proficiency, preferences_json, processing_config_json, created_at, updated_at, lifecycle, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 'active', 1)",
        )
        .bind(&id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .bind(input.name.trim())
        .bind(target_language)
        .bind(base_language)
        .bind(input.proficiency)
        .bind(preferences)
        .bind(processing_config)
        .bind(&now)
        .execute(self.pool())
        .await;
        inserted.map_err(|error| match error {
            sqlx::Error::Database(db) if db.message().contains("UNIQUE") => {
                PlethoraError::InvalidInput(format!("Language profile {id} already exists"))
            }
            other => PlethoraError::Database(other),
        })?;
        self.get_language_profile(&id, Some(&scope.account_id), Some(&scope.workspace_id))
            .await?
            .ok_or_else(|| PlethoraError::Internal("Created profile could not be loaded".to_string()))
    }

    pub async fn get_language_profiles(
        &self,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Vec<LanguageProfile>> {
        let scope = normalize_scope(account_id, workspace_id);
        let rows = sqlx::query(
            "SELECT * FROM language_profiles
             WHERE account_id = ?1 AND workspace_id = ?2 AND lifecycle <> 'deleted'
             ORDER BY updated_at DESC, created_at ASC",
        )
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .fetch_all(self.pool())
        .await?;
        rows.iter().map(profile_from_row).collect()
    }

    pub async fn get_language_profile(
        &self,
        id: &str,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Option<LanguageProfile>> {
        let scope = normalize_scope(account_id, workspace_id);
        let row = sqlx::query(
            "SELECT * FROM language_profiles
             WHERE id = ?1 AND account_id = ?2 AND workspace_id = ?3 AND lifecycle <> 'deleted'",
        )
        .bind(id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .fetch_optional(self.pool())
        .await?;
        row.as_ref().map(profile_from_row).transpose()
    }

    pub async fn update_language_profile(
        &self,
        id: &str,
        input: LanguageProfileUpdate,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfile> {
        let scope = normalize_scope(account_id, workspace_id);
        let current = self
            .get_language_profile(id, Some(&scope.account_id), Some(&scope.workspace_id))
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Language profile {id}")))?;
        let target_language = match input.target_language {
            Some(value) => validate_bcp47(&value).map_err(PlethoraError::InvalidInput)?,
            None => current.target_language.clone(),
        };
        let base_language = match input.base_language {
            Some(value) => validate_bcp47(&value).map_err(PlethoraError::InvalidInput)?,
            None => current.base_language.clone(),
        };
        if let Some(ref name) = input.name {
            ensure_nonempty(name, "Profile name")?;
        }
        let lifecycle = input.lifecycle.unwrap_or(current.lifecycle.clone());
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE language_profiles SET name = ?1, target_language = ?2, base_language = ?3,
             proficiency = ?4, preferences_json = ?5, processing_config_json = ?6,
             lifecycle = ?7, updated_at = ?8, version = version + 1
             WHERE id = ?9 AND account_id = ?10 AND workspace_id = ?11 AND lifecycle <> 'deleted'",
        )
        .bind(input.name.as_deref().unwrap_or(&current.name))
        .bind(target_language)
        .bind(base_language)
        .bind(input.proficiency.or(current.proficiency))
        .bind(serde_json::to_string(&input.preferences.unwrap_or(current.preferences))?)
        .bind(serde_json::to_string(
            &input.processing_config.unwrap_or(current.processing_config),
        )?)
        .bind(lifecycle_to_str(&lifecycle))
        .bind(now)
        .bind(id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .execute(self.pool())
        .await?;
        self.get_language_profile(id, Some(&scope.account_id), Some(&scope.workspace_id))
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Language profile {id}")))
    }

    pub async fn archive_language_profile(
        &self,
        id: &str,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfile> {
        self.update_language_profile(
            id,
            LanguageProfileUpdate {
                lifecycle: Some(ProfileLifecycle::Archived),
                ..Default::default()
            },
            account_id,
            workspace_id,
        )
        .await
    }

    pub async fn delete_language_profile(
        &self,
        id: &str,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<ProfileDeleteReport> {
        let scope = normalize_scope(account_id, workspace_id);
        let associations = sqlx::query(
            "SELECT content_type, content_id FROM language_profile_associations
             WHERE profile_id = ?1 AND account_id = ?2 AND workspace_id = ?3",
        )
        .bind(id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .fetch_all(self.pool())
        .await?;
        let document_ids: Vec<String> = associations
            .iter()
            .filter_map(|row| {
                (row.try_get::<String, _>("content_type").ok()? == "document")
                    .then(|| row.try_get::<String, _>("content_id").ok())
                    .flatten()
            })
            .collect();
        let retained_learning_items = if document_ids.is_empty() {
            0
        } else {
            let mut count = 0;
            for document_id in &document_ids {
                count += sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM learning_items WHERE document_id = ?1",
                )
                .bind(document_id)
                .fetch_one(self.pool())
                .await?;
            }
            count
        };
        let retained_documents = document_ids.len() as i64;
        let removed_profile_derived_data = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM language_lexical_entries WHERE profile_id = ?1",
        )
        .bind(id)
        .fetch_one(self.pool())
        .await?
            + sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM language_occurrences WHERE profile_id = ?1",
            )
            .bind(id)
            .fetch_one(self.pool())
            .await?;
        sqlx::query("DELETE FROM language_lookup_events WHERE profile_id = ?1")
            .bind(id)
            .execute(self.pool())
            .await?;
        sqlx::query("DELETE FROM language_legacy_lookup_history WHERE profile_id = ?1")
            .bind(id)
            .execute(self.pool())
            .await?;
        sqlx::query("DELETE FROM language_lexical_entries WHERE profile_id = ?1")
            .bind(id)
            .execute(self.pool())
            .await?;
        let removed_associations = sqlx::query(
            "DELETE FROM language_profile_associations
             WHERE profile_id = ?1 AND account_id = ?2 AND workspace_id = ?3",
        )
        .bind(id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .execute(self.pool())
        .await?
        .rows_affected() as i64;
        sqlx::query(
            "UPDATE language_profiles SET lifecycle = 'deleted', updated_at = ?1,
             version = version + 1 WHERE id = ?2 AND account_id = ?3 AND workspace_id = ?4",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .execute(self.pool())
        .await?;
        sqlx::query(
            "UPDATE language_profile_active_scopes SET profile_id = NULL, updated_at = ?1
             WHERE account_id = ?2 AND workspace_id = ?3 AND profile_id = ?4",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .bind(id)
        .execute(self.pool())
        .await?;
        Ok(ProfileDeleteReport {
            profile_id: id.to_string(),
            removed_associations,
            removed_profile_derived_data,
            retained_documents,
            retained_learning_items,
        })
    }

    pub async fn get_active_language_profile(
        &self,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Option<LanguageProfile>> {
        let scope = normalize_scope(account_id, workspace_id);
        let row = sqlx::query(
            "SELECT p.* FROM language_profile_active_scopes a
             JOIN language_profiles p ON p.id = a.profile_id
             WHERE a.account_id = ?1 AND a.workspace_id = ?2 AND p.lifecycle = 'active'",
        )
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .fetch_optional(self.pool())
        .await?;
        row.as_ref().map(profile_from_row).transpose()
    }

    pub async fn set_active_language_profile(
        &self,
        profile_id: Option<&str>,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Option<LanguageProfile>> {
        let scope = normalize_scope(account_id, workspace_id);
        if let Some(profile_id) = profile_id {
            let profile = self
                .get_language_profile(profile_id, Some(&scope.account_id), Some(&scope.workspace_id))
                .await?
                .ok_or_else(|| PlethoraError::NotFound(format!("Language profile {profile_id}")))?;
            if profile.lifecycle != ProfileLifecycle::Active {
                return Err(PlethoraError::InvalidInput(
                    "Only an active language profile can be selected".to_string(),
                ));
            }
        }
        sqlx::query(
            "INSERT INTO language_profile_active_scopes (account_id, workspace_id, profile_id, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, workspace_id) DO UPDATE SET profile_id = ?3, updated_at = ?4",
        )
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .bind(profile_id)
        .bind(Utc::now().to_rfc3339())
        .execute(self.pool())
        .await?;
        self.get_active_language_profile(Some(&scope.account_id), Some(&scope.workspace_id))
            .await
    }

    pub async fn get_language_profile_associations(
        &self,
        content_type: Option<&str>,
        content_id: Option<&str>,
        profile_id: Option<&str>,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Vec<LanguageProfileAssociation>> {
        let scope = normalize_scope(account_id, workspace_id);
        let mut query = String::from(
            "SELECT * FROM language_profile_associations WHERE account_id = ?1 AND workspace_id = ?2",
        );
        if content_type.is_some() {
            query.push_str(" AND content_type = ?3");
        }
        if content_id.is_some() {
            query.push_str(if content_type.is_some() { " AND content_id = ?4" } else { " AND content_id = ?3" });
        }
        if profile_id.is_some() {
            let index = 3 + content_type.is_some() as usize + content_id.is_some() as usize;
            query.push_str(&format!(" AND profile_id = ?{index}"));
        }
        query.push_str(" ORDER BY updated_at DESC");
        let mut request = sqlx::query(&query).bind(&scope.account_id).bind(&scope.workspace_id);
        if let Some(value) = content_type {
            ContentType::try_from(value).map_err(PlethoraError::InvalidInput)?;
            request = request.bind(value);
        }
        if let Some(value) = content_id {
            request = request.bind(value);
        }
        if let Some(value) = profile_id {
            request = request.bind(value);
        }
        let rows = request.fetch_all(self.pool()).await?;
        rows.iter().map(association_from_row).collect()
    }

    pub async fn upsert_language_profile_association(
        &self,
        input: LanguageProfileAssociationInput,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileAssociation> {
        let scope = normalize_scope(
            input.account_id.as_deref().or(account_id),
            input.workspace_id.as_deref().or(workspace_id),
        );
        ensure_nonempty(&input.profile_id, "Profile ID")?;
        ensure_nonempty(&input.content_id, "Content ID")?;
        let profile = self
            .get_language_profile(&input.profile_id, Some(&scope.account_id), Some(&scope.workspace_id))
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Language profile {}", input.profile_id)))?;
        if profile.lifecycle == ProfileLifecycle::Deleted {
            return Err(PlethoraError::InvalidInput("Deleted profile cannot be associated".to_string()));
        }
        let evidence = if let Some(mut evidence) = input.detection_evidence.clone() {
            evidence.language = validate_bcp47(&evidence.language).map_err(PlethoraError::InvalidInput)?;
            Some(evidence)
        } else {
            None
        };
        let existing = self
            .get_language_profile_associations(
                Some(input.content_type.as_str()),
                Some(&input.content_id),
                Some(&input.profile_id),
                Some(&scope.account_id),
                Some(&scope.workspace_id),
            )
            .await?
            .into_iter()
            .next();
        let mode = match existing.as_ref().map(|association| &association.mode) {
            Some(AssociationMode::Enabled | AssociationMode::Disabled)
                if matches!(input.mode, AssociationMode::Auto) => existing.as_ref().unwrap().mode.clone(),
            _ => input.mode.clone(),
        };
        let id = existing
            .as_ref()
            .map(|association| association.id.clone())
            .or(input.id)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = existing
            .as_ref()
            .map(|association| association.created_at.to_rfc3339())
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO language_profile_associations
             (id, account_id, workspace_id, profile_id, content_type, content_id, mode,
              detection_evidence_json, suggestion_dismissed, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)
             ON CONFLICT(account_id, workspace_id, profile_id, content_type, content_id)
             DO UPDATE SET mode = ?7, detection_evidence_json = ?8, suggestion_dismissed = ?9,
               updated_at = ?11, version = language_profile_associations.version + 1",
        )
        .bind(&id)
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .bind(&input.profile_id)
        .bind(input.content_type.as_str())
        .bind(&input.content_id)
        .bind(mode_to_str(&mode))
        .bind(evidence.as_ref().map(serde_json::to_string).transpose()?)
        .bind(if input.suggestion_dismissed || matches!(mode, AssociationMode::Disabled) { 1i64 } else { 0 })
        .bind(&created_at)
        .bind(&now)
        .execute(self.pool())
        .await?;
        self.get_language_profile_associations(
            Some(input.content_type.as_str()),
            Some(&input.content_id),
            Some(&input.profile_id),
            Some(&scope.account_id),
            Some(&scope.workspace_id),
        )
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| PlethoraError::Internal("Association could not be loaded".to_string()))
    }

    pub async fn get_language_profile_suggestion(
        &self,
        content_type: &str,
        content_id: &str,
        mut evidence: DetectionEvidence,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Option<LanguageProfileSuggestion>> {
        let content_type = ContentType::try_from(content_type).map_err(PlethoraError::InvalidInput)?;
        ensure_nonempty(content_id, "Content ID")?;
        evidence.language = validate_bcp47(&evidence.language).map_err(PlethoraError::InvalidInput)?;
        let scope = normalize_scope(account_id, workspace_id);
        let profiles = self
            .get_language_profiles(Some(&scope.account_id), Some(&scope.workspace_id))
            .await?;
        for profile in profiles {
            if profile.lifecycle != ProfileLifecycle::Active
                || !language_matches(&profile.target_language, &evidence.language)
            {
                continue;
            }
            let association = self
                .get_language_profile_associations(
                    Some(content_type.as_str()),
                    Some(content_id),
                    Some(&profile.id),
                    Some(&scope.account_id),
                    Some(&scope.workspace_id),
                )
                .await?
                .into_iter()
                .next();
            if association.is_some_and(|value| {
                matches!(value.mode, AssociationMode::Enabled | AssociationMode::Disabled)
                    || value.suggestion_dismissed
            }) {
                continue;
            }
            return Ok(Some(LanguageProfileSuggestion {
                profile,
                content_type,
                content_id: content_id.to_string(),
                evidence,
            }));
        }
        Ok(None)
    }

    pub async fn dismiss_language_profile_suggestion(
        &self,
        profile_id: &str,
        content_type: ContentType,
        content_id: &str,
        evidence: Option<DetectionEvidence>,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileAssociation> {
        self.upsert_language_profile_association(
            LanguageProfileAssociationInput {
                profile_id: profile_id.to_string(),
                content_type,
                content_id: content_id.to_string(),
                mode: AssociationMode::Auto,
                detection_evidence: evidence,
                suggestion_dismissed: true,
                ..Default::default()
            },
            account_id,
            workspace_id,
        )
        .await
    }

    pub async fn resolve_language_profile_context(
        &self,
        content_type: &str,
        content_id: &str,
        explicit_profile_id: Option<&str>,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<Option<ResolvedLanguageProfileContext>> {
        let content_type = ContentType::try_from(content_type).map_err(PlethoraError::InvalidInput)?;
        let scope = normalize_scope(account_id, workspace_id);
        if let Some(profile_id) = explicit_profile_id {
            let Some(profile) = self
                .get_language_profile(profile_id, Some(&scope.account_id), Some(&scope.workspace_id))
                .await?
            else {
                return Ok(None);
            };
            if profile.lifecycle != ProfileLifecycle::Active {
                return Ok(None);
            }
            let association = self
                .get_language_profile_associations(
                    Some(content_type.as_str()),
                    Some(content_id),
                    Some(profile_id),
                    Some(&scope.account_id),
                    Some(&scope.workspace_id),
                )
                .await?
                .into_iter()
                .find(|association| matches!(association.mode, AssociationMode::Enabled));
            let association = association.unwrap_or_else(|| LanguageProfileAssociation {
                id: format!("explicit-{profile_id}-{content_id}"),
                account_id: scope.account_id.clone(),
                workspace_id: scope.workspace_id.clone(),
                profile_id: profile_id.to_string(),
                content_type: content_type.clone(),
                content_id: content_id.to_string(),
                mode: AssociationMode::Enabled,
                detection_evidence: None,
                suggestion_dismissed: false,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                version: profile.version,
            });
            return Ok(Some(ResolvedLanguageProfileContext {
                context_version: profile.version.max(association.version),
                profile,
                association,
                source: "explicit_override".to_string(),
            }));
        }
        let associations = self
            .get_language_profile_associations(
                Some(content_type.as_str()),
                Some(content_id),
                None,
                Some(&scope.account_id),
                Some(&scope.workspace_id),
            )
            .await?;
        for association in associations {
            if !matches!(association.mode, AssociationMode::Enabled) {
                continue;
            }
            if let Some(profile) = self
                .get_language_profile(
                    &association.profile_id,
                    Some(&scope.account_id),
                    Some(&scope.workspace_id),
                )
                .await?
                .filter(|profile| profile.lifecycle == ProfileLifecycle::Active)
            {
                return Ok(Some(ResolvedLanguageProfileContext {
                    context_version: profile.version.max(association.version),
                    profile,
                    association,
                    source: "confirmed_association".to_string(),
                }));
            }
        }
        Ok(None)
    }

    pub async fn export_language_profiles(
        &self,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileExport> {
        let scope = normalize_scope(account_id, workspace_id);
        let profiles = sqlx::query("SELECT * FROM language_profiles WHERE account_id = ?1 AND workspace_id = ?2")
            .bind(&scope.account_id)
            .bind(&scope.workspace_id)
            .fetch_all(self.pool())
            .await?
            .iter()
            .map(profile_from_row)
            .collect::<Result<Vec<_>>>()?;
        let associations = self
            .get_language_profile_associations(
                None,
                None,
                None,
                Some(&scope.account_id),
                Some(&scope.workspace_id),
            )
            .await?;
        let active_profile_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT profile_id FROM language_profile_active_scopes WHERE account_id = ?1 AND workspace_id = ?2",
        )
        .bind(&scope.account_id)
        .bind(&scope.workspace_id)
        .fetch_optional(self.pool())
        .await?
        .flatten();
        Ok(LanguageProfileExport {
            schema_version: LANGUAGE_PROFILE_SCHEMA_VERSION,
            scope,
            exported_at: Utc::now(),
            active_profile_id,
            profiles,
            associations,
        })
    }

    pub async fn import_language_profiles(
        &self,
        export: LanguageProfileExport,
        conflict: &str,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileExport> {
        let scope = normalize_scope(account_id, workspace_id);
        if export.scope.account_id != scope.account_id || export.scope.workspace_id != scope.workspace_id {
            return Err(PlethoraError::InvalidInput(
                "Language profile import scope does not match the current account/workspace".to_string(),
            ));
        }
        if conflict == "replace" {
            sqlx::query("DELETE FROM language_profile_associations WHERE account_id = ?1 AND workspace_id = ?2")
                .bind(&scope.account_id).bind(&scope.workspace_id).execute(self.pool()).await?;
            sqlx::query("DELETE FROM language_profiles WHERE account_id = ?1 AND workspace_id = ?2")
                .bind(&scope.account_id).bind(&scope.workspace_id).execute(self.pool()).await?;
        } else if conflict != "merge" {
            return Err(PlethoraError::InvalidInput("Conflict must be merge or replace".to_string()));
        }
        for profile in export.profiles {
            validate_bcp47(&profile.target_language).map_err(PlethoraError::InvalidInput)?;
            validate_bcp47(&profile.base_language).map_err(PlethoraError::InvalidInput)?;
            let existing = self.get_language_profile(&profile.id, Some(&scope.account_id), Some(&scope.workspace_id)).await?;
            if existing.is_some_and(|value| value.updated_at > profile.updated_at) {
                continue;
            }
            sqlx::query(
                "INSERT INTO language_profiles (id, account_id, workspace_id, name, target_language, base_language,
                 proficiency, preferences_json, processing_config_json, created_at, updated_at, lifecycle, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET name = ?4, target_language = ?5, base_language = ?6,
                 proficiency = ?7, preferences_json = ?8, processing_config_json = ?9, updated_at = ?11,
                 lifecycle = ?12, version = ?13",
            )
            .bind(&profile.id).bind(&scope.account_id).bind(&scope.workspace_id).bind(&profile.name)
            .bind(&profile.target_language).bind(&profile.base_language).bind(&profile.proficiency)
            .bind(serde_json::to_string(&profile.preferences)?).bind(serde_json::to_string(&profile.processing_config)?)
            .bind(profile.created_at.to_rfc3339()).bind(profile.updated_at.to_rfc3339())
            .bind(lifecycle_to_str(&profile.lifecycle)).bind(profile.version)
            .execute(self.pool()).await?;
        }
        for association in export.associations {
            let existing = self.get_language_profile_associations(
                Some(association.content_type.as_str()), Some(&association.content_id), Some(&association.profile_id),
                Some(&scope.account_id), Some(&scope.workspace_id),
            ).await?.into_iter().next();
            if existing.as_ref().is_some_and(|value| value.updated_at > association.updated_at) {
                continue;
            }
            let mode = if existing.as_ref().is_some_and(|value| matches!(value.mode, AssociationMode::Enabled | AssociationMode::Disabled))
                && matches!(association.mode, AssociationMode::Auto) {
                existing.unwrap().mode
            } else { association.mode.clone() };
            sqlx::query(
                "INSERT INTO language_profile_associations (id, account_id, workspace_id, profile_id, content_type, content_id,
                 mode, detection_evidence_json, suggestion_dismissed, created_at, updated_at, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(account_id, workspace_id, profile_id, content_type, content_id)
                 DO UPDATE SET mode = ?7, detection_evidence_json = ?8, suggestion_dismissed = ?9,
                 updated_at = ?11, version = ?12",
            )
            .bind(&association.id).bind(&scope.account_id).bind(&scope.workspace_id).bind(&association.profile_id)
            .bind(association.content_type.as_str()).bind(&association.content_id).bind(mode_to_str(&mode))
            .bind(association.detection_evidence.as_ref().map(serde_json::to_string).transpose()?)
            .bind(if association.suggestion_dismissed || matches!(mode, AssociationMode::Disabled) { 1i64 } else { 0 })
            .bind(association.created_at.to_rfc3339()).bind(association.updated_at.to_rfc3339()).bind(association.version)
            .execute(self.pool()).await?;
        }
        if let Some(active_profile_id) = export.active_profile_id.as_deref() {
            if self.get_language_profile(active_profile_id, Some(&scope.account_id), Some(&scope.workspace_id)).await?.is_some() {
                self.set_active_language_profile(Some(active_profile_id), Some(&scope.account_id), Some(&scope.workspace_id)).await?;
            }
        } else if conflict == "replace" {
            self.set_active_language_profile(None, Some(&scope.account_id), Some(&scope.workspace_id)).await?;
        }
        self.export_language_profiles(Some(&scope.account_id), Some(&scope.workspace_id)).await
    }

    pub async fn serialize_language_profiles_for_sync(
        &self,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileSyncEnvelope> {
        let export = self.export_language_profiles(account_id, workspace_id).await?;
        Ok(LanguageProfileSyncEnvelope {
            schema_version: export.schema_version,
            scope: export.scope,
            changed_at: Utc::now(),
            profiles: export.profiles,
            associations: export.associations,
            active_profile_id: export.active_profile_id,
        })
    }

    pub async fn apply_language_profiles_sync(
        &self,
        envelope: LanguageProfileSyncEnvelope,
        account_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<LanguageProfileSyncEnvelope> {
        let scope = normalize_scope(account_id, workspace_id);
        let export = LanguageProfileExport {
            schema_version: envelope.schema_version,
            scope: envelope.scope,
            exported_at: envelope.changed_at,
            active_profile_id: envelope.active_profile_id,
            profiles: envelope.profiles,
            associations: envelope.associations,
        };
        let result = self.import_language_profiles(export, "merge", Some(&scope.account_id), Some(&scope.workspace_id)).await?;
        Ok(LanguageProfileSyncEnvelope {
            schema_version: result.schema_version,
            scope: result.scope,
            changed_at: Utc::now(),
            profiles: result.profiles,
            associations: result.associations,
            active_profile_id: result.active_profile_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::path::PathBuf;

    async fn repository() -> Repository {
        let database = Database::new(PathBuf::from(":memory:")).await.expect("database");
        Repository::new(database.pool().clone())
    }

    fn profile(name: &str, target: &str) -> LanguageProfileCreate {
        LanguageProfileCreate {
            name: name.to_string(),
            target_language: target.to_string(),
            base_language: "en".to_string(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn profile_and_association_round_trip_preserves_explicit_mode() {
        let repo = repository().await;
        let profile = repo.create_language_profile(profile("Spanish", "es"), None, None).await.unwrap();
        let association = repo.upsert_language_profile_association(LanguageProfileAssociationInput {
            profile_id: profile.id.clone(),
            content_type: ContentType::Document,
            content_id: "doc-1".to_string(),
            mode: AssociationMode::Enabled,
            ..Default::default()
        }, None, None).await.unwrap();
        assert_eq!(association.mode, AssociationMode::Enabled);
        assert!(repo.resolve_language_profile_context("document", "doc-1", None, None, None).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn deletion_clears_associations_but_not_documents_or_learning_items() {
        let repo = repository().await;
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('doc-1', 'Doc', '/tmp/doc', 'html', '2026-01-01', '2026-01-01')").execute(repo.pool()).await.unwrap();
        sqlx::query("INSERT INTO learning_items (id, document_id, item_type, question, due_date, date_created, date_modified) VALUES ('item-1', 'doc-1', 'basic', 'q', '2026-01-01', '2026-01-01', '2026-01-01')").execute(repo.pool()).await.unwrap();
        let profile = repo.create_language_profile(profile("Spanish", "es"), None, None).await.unwrap();
        repo.upsert_language_profile_association(LanguageProfileAssociationInput { profile_id: profile.id.clone(), content_type: ContentType::Document, content_id: "doc-1".into(), mode: AssociationMode::Enabled, ..Default::default() }, None, None).await.unwrap();
        let report = repo.delete_language_profile(&profile.id, None, None).await.unwrap();
        assert_eq!(report.removed_associations, 1);
        assert_eq!(report.retained_documents, 1);
        assert_eq!(report.retained_learning_items, 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = 'doc-1'").fetch_one(repo.pool()).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM language_profile_associations WHERE profile_id = ?1").bind(&profile.id).fetch_one(repo.pool()).await.unwrap(), 0);
    }
}
