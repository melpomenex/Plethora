use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityId {
    CloudSync,
    CloudBackup,
    LibraryIntelligence,
    SemanticConnections,
    KnowledgeGraph,
    KnowledgeGapDetection,
    AdaptiveLearningPaths,
    AiTutoring,
    EnhancedCardGeneration,
    CardOptimizer,
    AdvancedAnalytics,
    CloudDocumentProcessing,
    PremiumTts,
    Transcription,
    WebCapture,
    Integrations,
    Automation,
    ApiAccess,
}

impl CapabilityId {
    pub const ALL: &'static [CapabilityId] = &[
        CapabilityId::CloudSync,
        CapabilityId::CloudBackup,
        CapabilityId::LibraryIntelligence,
        CapabilityId::SemanticConnections,
        CapabilityId::KnowledgeGraph,
        CapabilityId::KnowledgeGapDetection,
        CapabilityId::AdaptiveLearningPaths,
        CapabilityId::AiTutoring,
        CapabilityId::EnhancedCardGeneration,
        CapabilityId::CardOptimizer,
        CapabilityId::AdvancedAnalytics,
        CapabilityId::CloudDocumentProcessing,
        CapabilityId::PremiumTts,
        CapabilityId::Transcription,
        CapabilityId::WebCapture,
        CapabilityId::Integrations,
        CapabilityId::Automation,
        CapabilityId::ApiAccess,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            CapabilityId::CloudSync => "cloud_sync",
            CapabilityId::CloudBackup => "cloud_backup",
            CapabilityId::LibraryIntelligence => "library_intelligence",
            CapabilityId::SemanticConnections => "semantic_connections",
            CapabilityId::KnowledgeGraph => "knowledge_graph",
            CapabilityId::KnowledgeGapDetection => "knowledge_gap_detection",
            CapabilityId::AdaptiveLearningPaths => "adaptive_learning_paths",
            CapabilityId::AiTutoring => "ai_tutoring",
            CapabilityId::EnhancedCardGeneration => "enhanced_card_generation",
            CapabilityId::CardOptimizer => "card_optimizer",
            CapabilityId::AdvancedAnalytics => "advanced_analytics",
            CapabilityId::CloudDocumentProcessing => "cloud_document_processing",
            CapabilityId::PremiumTts => "premium_tts",
            CapabilityId::Transcription => "transcription",
            CapabilityId::WebCapture => "web_capture",
            CapabilityId::Integrations => "integrations",
            CapabilityId::Automation => "automation",
            CapabilityId::ApiAccess => "api_access",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "cloud_sync" => Some(CapabilityId::CloudSync),
            "cloud_backup" => Some(CapabilityId::CloudBackup),
            "library_intelligence" => Some(CapabilityId::LibraryIntelligence),
            "semantic_connections" => Some(CapabilityId::SemanticConnections),
            "knowledge_graph" => Some(CapabilityId::KnowledgeGraph),
            "knowledge_gap_detection" => Some(CapabilityId::KnowledgeGapDetection),
            "adaptive_learning_paths" => Some(CapabilityId::AdaptiveLearningPaths),
            "ai_tutoring" => Some(CapabilityId::AiTutoring),
            "enhanced_card_generation" => Some(CapabilityId::EnhancedCardGeneration),
            "card_optimizer" => Some(CapabilityId::CardOptimizer),
            "advanced_analytics" => Some(CapabilityId::AdvancedAnalytics),
            "cloud_document_processing" => Some(CapabilityId::CloudDocumentProcessing),
            "premium_tts" => Some(CapabilityId::PremiumTts),
            "transcription" => Some(CapabilityId::Transcription),
            "web_capture" => Some(CapabilityId::WebCapture),
            "integrations" => Some(CapabilityId::Integrations),
            "automation" => Some(CapabilityId::Automation),
            "api_access" => Some(CapabilityId::ApiAccess),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityReason {
    Plan,
    SignedOut,
    Offline,
    QuotaExhausted,
    Region,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaWindow {
    Daily,
    Monthly,
    Rolling30d,
    Lifetime,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuotaState {
    pub used: u64,
    pub limit: u64,
    pub window: QuotaWindow,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityState {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<CapabilityReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<QuotaState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotSource {
    LocalDefaults,
    Server,
    Cache,
    Grace,
    Override,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntitlementSnapshot {
    pub account_id: Option<String>,
    pub plan: String,
    pub capabilities: HashMap<CapabilityId, CapabilityState>,
    pub fetched_at: String,
    pub expires_at: Option<String>,
    pub source: SnapshotSource,
}

#[derive(Debug, Clone)]
pub struct CapabilityDescriptor {
    pub id: CapabilityId,
    pub default_plan: &'static str,
    pub requires_account: bool,
    pub has_quotas: bool,
    pub local_fallback: &'static str,
}

pub fn get_descriptor(id: CapabilityId) -> CapabilityDescriptor {
    match id {
        CapabilityId::CloudSync => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: false,
            local_fallback: "Local SQLite database and local device storage only.",
        },
        CapabilityId::CloudBackup => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Local automated and manual backup exports (.plethora).",
        },
        CapabilityId::LibraryIntelligence => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Local on-device EmbeddingGemma and SQLite FTS5 cosine search.",
        },
        CapabilityId::SemanticConnections => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Explicit tags, manual cross-links, and local search associations.",
        },
        CapabilityId::KnowledgeGraph => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: false,
            local_fallback: "Local concept tagging and manual note linking.",
        },
        CapabilityId::KnowledgeGapDetection => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Manual review performance metrics and standard retention graphs.",
        },
        CapabilityId::AdaptiveLearningPaths => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Standard category-based and priority-sorted queue navigation.",
        },
        CapabilityId::AiTutoring => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Direct BYO-key AI provider queries and local Ollama execution.",
        },
        CapabilityId::EnhancedCardGeneration => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Standard manual card creation and local BYO-key flashcard prompts.",
        },
        CapabilityId::CardOptimizer => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Manual card editing and FSRS/SM-20 parameter tuning.",
        },
        CapabilityId::AdvancedAnalytics => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: false,
            local_fallback: "Core daily study statistics, heatmaps, and retention summaries.",
        },
        CapabilityId::CloudDocumentProcessing => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Local PDF parsing, on-device OCR, and native format extraction.",
        },
        CapabilityId::PremiumTts => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "System native speech synthesizers and local Pocket/Sherpa TTS models.",
        },
        CapabilityId::Transcription => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Local Whisper.cpp and on-device whisper models (ungated).",
        },
        CapabilityId::WebCapture => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Local browser extension bridge and manual URL/HTML import.",
        },
        CapabilityId::Integrations => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: false,
            local_fallback: "Local Obsidian vault sync, Anki deck exports, and MCP stdio servers.",
        },
        CapabilityId::Automation => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: false,
            local_fallback: "Local scheduled tasks and desktop background processing.",
        },
        CapabilityId::ApiAccess => CapabilityDescriptor {
            id,
            default_plan: "pro",
            requires_account: true,
            has_quotas: true,
            local_fallback: "Localhost REST automation endpoints and MCP server tools.",
        },
    }
}

pub fn create_free_default_snapshot() -> EntitlementSnapshot {
    let mut capabilities = HashMap::new();
    for &id in CapabilityId::ALL {
        let desc = get_descriptor(id);
        capabilities.insert(
            id,
            CapabilityState {
                enabled: desc.default_plan == "free",
                reason: if desc.default_plan == "free" {
                    None
                } else {
                    Some(CapabilityReason::Plan)
                },
                quota: None,
            },
        );
    }

    EntitlementSnapshot {
        account_id: None,
        plan: "free".to_string(),
        capabilities,
        fetched_at: "1970-01-01T00:00:00Z".to_string(),
        expires_at: None,
        source: SnapshotSource::LocalDefaults,
    }
}
