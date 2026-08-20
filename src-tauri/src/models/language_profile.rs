//! Durable learner profiles and content associations.
//!
//! This module deliberately does not reuse the application locale.  Profile
//! language tags are content-processing inputs and are validated independently
//! from the UI language setting.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const DEFAULT_ACCOUNT_SCOPE: &str = "local";
pub const DEFAULT_WORKSPACE_SCOPE: &str = "default";
pub const LANGUAGE_PROFILE_SCHEMA_VERSION: u32 = 1;

/// Validate the structural portions of a BCP-47 language tag.
///
/// A full registry lookup would make offline profile creation impossible and
/// would reject future/private-use tags.  This accepts the BCP-47 grammar's
/// language/script/region/variant/extension/private-use shapes and rejects
/// malformed separators and subtags.
pub fn validate_bcp47(value: &str) -> Result<String, String> {
    let value = value.trim().replace('_', "-");
    if value.is_empty() {
        return Err("Language tag cannot be empty".to_string());
    }

    let parts: Vec<&str> = value.split('-').collect();
    if parts.iter().any(|part| part.is_empty() || !part.is_ascii()) {
        return Err(format!("Invalid BCP-47 language tag: {value}"));
    }

    let language = parts[0];
    let is_language = (2..=8).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_alphabetic());
    if !is_language {
        return Err(format!("Invalid BCP-47 language subtag: {language}"));
    }

    let mut index = 1usize;
    let mut extension_mode = false;
    while index < parts.len() {
        let part = parts[index];
        if part.len() == 1 && part.chars().all(|c| c.is_ascii_alphanumeric()) {
            if part.eq_ignore_ascii_case("x") {
                if index + 1 >= parts.len() {
                    return Err(format!("Private-use language tag has no subtags: {value}"));
                }
                for private_part in &parts[index + 1..] {
                    if !(1..=8).contains(&private_part.len())
                        || !private_part.chars().all(|c| c.is_ascii_alphanumeric())
                    {
                        return Err(format!("Invalid private-use subtag: {private_part}"));
                    }
                }
                break;
            }
            extension_mode = true;
            if index + 1 >= parts.len() {
                return Err(format!("Language extension has no value: {value}"));
            }
            index += 1;
            let mut extension_values = 0usize;
            while index < parts.len()
                && parts[index].len() != 1
                && (2..=8).contains(&parts[index].len())
                && parts[index].chars().all(|c| c.is_ascii_alphanumeric())
            {
                extension_values += 1;
                index += 1;
            }
            if extension_values == 0 {
                return Err(format!("Language extension has no value: {value}"));
            }
            continue;
        }

        if extension_mode {
            // A one-character extension is handled above; all remaining
            // extension values must be 2–8 alphanumeric characters.
            if !(2..=8).contains(&part.len())
                || !part.chars().all(|c| c.is_ascii_alphanumeric())
            {
                return Err(format!("Invalid language extension subtag: {part}"));
            }
            index += 1;
            continue;
        }

        let valid_script = part.len() == 4 && part.chars().all(|c| c.is_ascii_alphabetic());
        let valid_region = (part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic()))
            || (part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()));
        let valid_variant = (5..=8).contains(&part.len())
            && part.chars().all(|c| c.is_ascii_alphanumeric())
            || (part.len() == 4
                && part.chars().next().is_some_and(|c| c.is_ascii_digit())
                && part.chars().all(|c| c.is_ascii_alphanumeric()));
        if !(valid_script || valid_region || valid_variant) {
            return Err(format!("Invalid BCP-47 subtag: {part}"));
        }
        index += 1;
    }

    let mut canonical = Vec::with_capacity(parts.len());
    for (index, part) in parts.iter().enumerate() {
        if index == 0 {
            canonical.push(part.to_ascii_lowercase());
        } else if part.len() == 4 && part.chars().all(|c| c.is_ascii_alphabetic()) {
            let mut chars = part.chars();
            let first = chars.next().unwrap().to_ascii_uppercase();
            canonical.push(std::iter::once(first).chain(chars.map(|c| c.to_ascii_lowercase())).collect());
        } else if (part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic()))
            || (part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()))
        {
            canonical.push(part.to_ascii_uppercase());
        } else {
            canonical.push(part.to_ascii_lowercase());
        }
    }
    Ok(canonical.join("-"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProfileLifecycle {
    Active,
    Archived,
    Deleted,
}

impl Default for ProfileLifecycle {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssociationMode {
    Auto,
    Enabled,
    Disabled,
}

impl Default for AssociationMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentType {
    Document,
    Media,
}

impl ContentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Media => "media",
        }
    }
}

impl TryFrom<&str> for ContentType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "document" => Ok(Self::Document),
            "media" => Ok(Self::Media),
            _ => Err(format!("Unsupported content type: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfilePreferences {
    pub highlight_density: String,
    pub show_translation: bool,
    pub show_explanation: bool,
    pub translation_provider: String,
    pub explanation_provider: String,
}

impl Default for ProfilePreferences {
    fn default() -> Self {
        Self {
            highlight_density: "balanced".to_string(),
            show_translation: true,
            show_explanation: true,
            translation_provider: "local".to_string(),
            explanation_provider: "local".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProcessingConfig {
    pub provider: String,
    pub offline_capable: bool,
    pub dictionary_enabled: bool,
    pub tts_enabled: bool,
    pub transcription_enabled: bool,
}

impl Default for ProcessingConfig {
    fn default() -> Self {
        Self {
            provider: "local".to_string(),
            offline_capable: true,
            dictionary_enabled: true,
            tts_enabled: true,
            transcription_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DetectionEvidence {
    pub language: String,
    pub confidence: Option<f32>,
    pub detector: Option<String>,
    pub source: Option<String>,
    pub detected_at: Option<DateTime<Utc>>,
}

impl Default for DetectionEvidence {
    fn default() -> Self {
        Self {
            language: String::new(),
            confidence: None,
            detector: None,
            source: None,
            detected_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfile {
    pub id: String,
    pub account_id: String,
    pub workspace_id: String,
    pub name: String,
    pub target_language: String,
    pub base_language: String,
    pub proficiency: Option<String>,
    pub preferences: ProfilePreferences,
    pub processing_config: ProcessingConfig,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub lifecycle: ProfileLifecycle,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageProfileCreate {
    pub id: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub name: String,
    pub target_language: String,
    pub base_language: String,
    pub proficiency: Option<String>,
    pub preferences: ProfilePreferences,
    pub processing_config: ProcessingConfig,
}

impl Default for LanguageProfileCreate {
    fn default() -> Self {
        Self {
            id: None,
            account_id: None,
            workspace_id: None,
            name: String::new(),
            target_language: String::new(),
            base_language: String::new(),
            proficiency: None,
            preferences: ProfilePreferences::default(),
            processing_config: ProcessingConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageProfileUpdate {
    pub name: Option<String>,
    pub target_language: Option<String>,
    pub base_language: Option<String>,
    pub proficiency: Option<String>,
    pub preferences: Option<ProfilePreferences>,
    pub processing_config: Option<ProcessingConfig>,
    pub lifecycle: Option<ProfileLifecycle>,
}

impl Default for LanguageProfileUpdate {
    fn default() -> Self {
        Self {
            name: None,
            target_language: None,
            base_language: None,
            proficiency: None,
            preferences: None,
            processing_config: None,
            lifecycle: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfileAssociation {
    pub id: String,
    pub account_id: String,
    pub workspace_id: String,
    pub profile_id: String,
    pub content_type: ContentType,
    pub content_id: String,
    pub mode: AssociationMode,
    pub detection_evidence: Option<DetectionEvidence>,
    pub suggestion_dismissed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageProfileAssociationInput {
    pub id: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub profile_id: String,
    pub content_type: ContentType,
    pub content_id: String,
    pub mode: AssociationMode,
    pub detection_evidence: Option<DetectionEvidence>,
    pub suggestion_dismissed: bool,
}

impl Default for LanguageProfileAssociationInput {
    fn default() -> Self {
        Self {
            id: None,
            account_id: None,
            workspace_id: None,
            profile_id: String::new(),
            content_type: ContentType::Document,
            content_id: String::new(),
            mode: AssociationMode::Auto,
            detection_evidence: None,
            suggestion_dismissed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLanguageProfileContext {
    pub profile: LanguageProfile,
    pub association: LanguageProfileAssociation,
    pub source: String,
    pub context_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfileSuggestion {
    pub profile: LanguageProfile,
    pub content_type: ContentType,
    pub content_id: String,
    pub evidence: DetectionEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageProfileScope {
    pub account_id: String,
    pub workspace_id: String,
}

impl Default for LanguageProfileScope {
    fn default() -> Self {
        Self {
            account_id: DEFAULT_ACCOUNT_SCOPE.to_string(),
            workspace_id: DEFAULT_WORKSPACE_SCOPE.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfileExport {
    pub schema_version: u32,
    pub scope: LanguageProfileScope,
    pub exported_at: DateTime<Utc>,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<LanguageProfile>,
    pub associations: Vec<LanguageProfileAssociation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfileSyncEnvelope {
    pub schema_version: u32,
    pub scope: LanguageProfileScope,
    pub changed_at: DateTime<Utc>,
    pub profiles: Vec<LanguageProfile>,
    pub associations: Vec<LanguageProfileAssociation>,
    pub active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDeleteReport {
    pub profile_id: String,
    pub removed_associations: i64,
    pub removed_profile_derived_data: i64,
    pub retained_documents: i64,
    pub retained_learning_items: i64,
}

pub fn normalize_scope(account_id: Option<&str>, workspace_id: Option<&str>) -> LanguageProfileScope {
    LanguageProfileScope {
        account_id: account_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_ACCOUNT_SCOPE)
            .to_string(),
        workspace_id: workspace_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_WORKSPACE_SCOPE)
            .to_string(),
    }
}
