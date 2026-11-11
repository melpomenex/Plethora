//! Data models for podcast chapters, advertisement intervals, and processing policies.

use serde::{Deserialize, Serialize};

/// Source from which podcast chapters were extracted
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChapterSource {
    Podcast20Json,
    PodloveXml,
    Id3Chap,
    DescriptionTimestamp,
    Generated,
}

impl ChapterSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Podcast20Json => "podcast20_json",
            Self::PodloveXml => "podlove_xml",
            Self::Id3Chap => "id3_chap",
            Self::DescriptionTimestamp => "description_timestamp",
            Self::Generated => "generated",
        }
    }
}

/// Origin / detection method that discovered an ad interval
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdDetectionMethod {
    MetadataChapter,
    ClassifierLlm,
    ManualUser,
}

impl AdDetectionMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MetadataChapter => "metadata_chapter",
            Self::ClassifierLlm => "classifier_llm",
            Self::ManualUser => "manual_user",
        }
    }
}

/// Processing and detection lifecycle status for an episode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PodcastAdDetectionStatus {
    None,
    Queued,
    InspectingMetadata,
    Transcribing,
    Classifying,
    RefiningBoundaries,
    Ready,
    Failed,
    Cancelled,
    Deferred,
}

impl PodcastAdDetectionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Queued => "queued",
            Self::InspectingMetadata => "inspecting_metadata",
            Self::Transcribing => "transcribing",
            Self::Classifying => "classifying",
            Self::RefiningBoundaries => "refining_boundaries",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Deferred => "deferred",
        }
    }
}

/// A parsed or stored chapter of a podcast episode
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastChapter {
    pub id: String,
    pub episode_id: String,
    pub chapter_index: i32,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub image_url: Option<String>,
    pub link_url: Option<String>,
    pub source: String,
    pub is_advertisement: bool,
}

/// A detected or user-specified advertisement interval in an episode
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastAdInterval {
    pub id: String,
    pub episode_id: String,
    pub media_revision: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub category: String, // "external_ad" | "podcast_cross_promo" | "host_self_promo" | "bumper" | "uncertain"
    pub confidence: f32,
    pub origin: String, // "metadata_chapter" | "classifier_llm" | "manual_user"
    pub metadata_json: Option<String>,
}

/// Global or feed-level ad removal and processing settings
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastAdSettings {
    pub id: String,
    pub auto_detect_ads: bool,
    pub skip_external_ads: bool,
    pub skip_cross_promo: bool,
    pub skip_self_promo: bool,
    pub min_confidence: f32,
    pub min_ad_duration_seconds: i32,
    pub mobile_charging_only: bool,
    pub processing_mode: String, // "battery_saver" | "smart" | "always" | "manual"
}

impl Default for PodcastAdSettings {
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            auto_detect_ads: true,
            skip_external_ads: true,
            skip_cross_promo: true,
            skip_self_promo: false,
            min_confidence: 0.85,
            min_ad_duration_seconds: 10,
            mobile_charging_only: true,
            processing_mode: "smart".to_string(),
        }
    }
}

/// User correction or override on a detected interval
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastAdCorrection {
    pub id: String,
    pub episode_id: String,
    pub correction_type: String, // "restore_content" | "mark_ad" | "adjust_boundary"
    pub start_ms: i64,
    pub end_ms: i64,
    pub user_note: Option<String>,
    pub created_at: Option<String>,
}

/// Background preparation job tracking
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastProcessingJob {
    pub id: String,
    pub episode_id: String,
    pub status: String,
    pub stage_progress: i32,
    pub overall_progress: i32,
    pub error_message: Option<String>,
    pub deferral_reason: Option<String>,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_podcast_chapter_serialization_round_trip() {
        let chapter = PodcastChapter {
            id: "chap-1".to_string(),
            episode_id: "ep-1".to_string(),
            chapter_index: 0,
            title: "Intro & Sponsor".to_string(),
            start_ms: 0,
            end_ms: 120_000,
            image_url: Some("https://example.com/art.png".to_string()),
            link_url: Some("https://sponsor.com".to_string()),
            source: ChapterSource::Podcast20Json.as_str().to_string(),
            is_advertisement: true,
        };

        let json = serde_json::to_string(&chapter).expect("serialize chapter");
        assert!(json.contains("\"chapterIndex\":0"));
        assert!(json.contains("\"isAdvertisement\":true"));
        assert!(json.contains("\"startMs\":0"));
        assert!(json.contains("\"endMs\":120000"));

        let deserialized: PodcastChapter =
            serde_json::from_str(&json).expect("deserialize chapter");
        assert_eq!(chapter, deserialized);
    }

    #[test]
    fn test_podcast_ad_interval_serialization_round_trip() {
        let interval = PodcastAdInterval {
            id: "interval-1".to_string(),
            episode_id: "ep-1".to_string(),
            media_revision: "rev-hash".to_string(),
            start_ms: 30_000,
            end_ms: 90_000,
            category: "external_ad".to_string(),
            confidence: 0.95,
            origin: AdDetectionMethod::ClassifierLlm.as_str().to_string(),
            metadata_json: Some(r#"{"brand":"Acme"}"#.to_string()),
        };

        let json = serde_json::to_string(&interval).expect("serialize interval");
        assert!(json.contains("\"startMs\":30000"));
        assert!(json.contains("\"mediaRevision\":\"rev-hash\""));
        assert!(json.contains("\"category\":\"external_ad\""));

        let deserialized: PodcastAdInterval =
            serde_json::from_str(&json).expect("deserialize interval");
        assert_eq!(interval, deserialized);
    }

    #[test]
    fn test_podcast_ad_settings_serialization_round_trip() {
        let settings = PodcastAdSettings::default();
        let json = serde_json::to_string(&settings).expect("serialize settings");
        assert!(json.contains("\"autoDetectAds\":true"));
        assert!(json.contains("\"minAdDurationSeconds\":10"));
        assert!(json.contains("\"mobileChargingOnly\":true"));

        let deserialized: PodcastAdSettings =
            serde_json::from_str(&json).expect("deserialize settings");
        assert_eq!(settings, deserialized);
    }

    #[test]
    fn test_enums_as_str() {
        assert_eq!(ChapterSource::Podcast20Json.as_str(), "podcast20_json");
        assert_eq!(ChapterSource::PodloveXml.as_str(), "podlove_xml");
        assert_eq!(ChapterSource::Id3Chap.as_str(), "id3_chap");
        assert_eq!(
            ChapterSource::DescriptionTimestamp.as_str(),
            "description_timestamp"
        );
        assert_eq!(ChapterSource::Generated.as_str(), "generated");

        assert_eq!(
            AdDetectionMethod::MetadataChapter.as_str(),
            "metadata_chapter"
        );
        assert_eq!(AdDetectionMethod::ClassifierLlm.as_str(), "classifier_llm");
        assert_eq!(AdDetectionMethod::ManualUser.as_str(), "manual_user");

        assert_eq!(PodcastAdDetectionStatus::Queued.as_str(), "queued");
        assert_eq!(PodcastAdDetectionStatus::Ready.as_str(), "ready");
    }
}
