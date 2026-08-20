//! Tauri boundary for learner profiles and explicit content associations.

use crate::database::Repository;
use crate::models::language_profile::{
    AssociationMode, ContentType, DetectionEvidence, LanguageProfile, LanguageProfileAssociation,
    LanguageProfileAssociationInput, LanguageProfileCreate, LanguageProfileExport,
    LanguageProfileSyncEnvelope, LanguageProfileUpdate, ProfileDeleteReport,
    ResolvedLanguageProfileContext,
};
use tauri::State;

#[tauri::command]
pub async fn create_language_profile(
    input: LanguageProfileCreate,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfile, String> {
    repo.create_language_profile(input, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_language_profiles(
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageProfile>, String> {
    repo.get_language_profiles(account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_language_profile(
    id: String,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageProfile>, String> {
    repo.get_language_profile(&id, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_language_profile(
    id: String,
    input: LanguageProfileUpdate,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfile, String> {
    repo.update_language_profile(&id, input, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_language_profile(
    id: String,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfile, String> {
    repo.archive_language_profile(&id, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_language_profile(
    id: String,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<ProfileDeleteReport, String> {
    repo.delete_language_profile(&id, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_active_language_profile(
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageProfile>, String> {
    repo.get_active_language_profile(account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_active_language_profile(
    profile_id: Option<String>,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageProfile>, String> {
    repo.set_active_language_profile(
        profile_id.as_deref(),
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn associate_language_profile_content(
    input: LanguageProfileAssociationInput,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileAssociation, String> {
    repo.upsert_language_profile_association(input, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_language_profile_associations(
    content_type: Option<String>,
    content_id: Option<String>,
    profile_id: Option<String>,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageProfileAssociation>, String> {
    repo.get_language_profile_associations(
        content_type.as_deref(),
        content_id.as_deref(),
        profile_id.as_deref(),
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_language_profile_context(
    content_type: String,
    content_id: String,
    explicit_profile_id: Option<String>,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<ResolvedLanguageProfileContext>, String> {
    repo.resolve_language_profile_context(
        &content_type,
        &content_id,
        explicit_profile_id.as_deref(),
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_language_profile_suggestion(
    content_type: String,
    content_id: String,
    evidence: DetectionEvidence,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<crate::models::language_profile::LanguageProfileSuggestion>, String> {
    repo.get_language_profile_suggestion(
        &content_type,
        &content_id,
        evidence,
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn dismiss_language_profile_suggestion(
    profile_id: String,
    content_type: ContentType,
    content_id: String,
    evidence: Option<DetectionEvidence>,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileAssociation, String> {
    repo.dismiss_language_profile_suggestion(
        &profile_id,
        content_type,
        &content_id,
        evidence,
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_language_profiles(
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileExport, String> {
    repo.export_language_profiles(account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_language_profiles(
    payload: LanguageProfileExport,
    conflict: Option<String>,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileExport, String> {
    repo.import_language_profiles(
        payload,
        conflict.as_deref().unwrap_or("merge"),
        account_id.as_deref(),
        workspace_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn serialize_language_profiles_for_sync(
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileSyncEnvelope, String> {
    repo.serialize_language_profiles_for_sync(account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_language_profiles_sync(
    payload: LanguageProfileSyncEnvelope,
    account_id: Option<String>,
    workspace_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageProfileSyncEnvelope, String> {
    repo.apply_language_profiles_sync(payload, account_id.as_deref(), workspace_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

// Keep the enum imported at this boundary as part of the command contract;
// this also makes its accepted JSON values obvious to generated bindings.
#[allow(dead_code)]
fn _association_mode_contract(mode: AssociationMode) -> AssociationMode {
    mode
}
