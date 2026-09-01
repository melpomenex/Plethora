//! Browser Sync Server
//!
//! HTTP server for receiving data from the browser extension.
//! The extension sends POST requests with page/extract/video data.
//! Also provides AI endpoints for summarization and content analysis.

use crate::ai::flashcard_generator::{FlashcardGenerationOptions, FlashcardGenerator};
use crate::ai::qa::QuestionAnswerer;
use crate::ai::summarizer::Summarizer;
use crate::ai::{AIConfig, AIProvider, LLMProviderType};
use crate::commands::review::apply_review;
use crate::commands::rss::{
    create_rss_feed_http, delete_rss_feed_http, fetch_rss_feed_url, get_rss_articles_http,
    get_rss_feed_http, get_rss_feeds_http, mark_rss_article_read_http,
    toggle_rss_article_queued_http, update_rss_feed_http, RssFeed, RssUserPreference,
    RssUserPreferenceUpdate,
};
use crate::commands::rss_features::{
    add_rss_classifier_http, add_tag_http, compute_story_clusters_http, create_annotation_http,
    create_rss_folder_http, create_rss_reading_list_http, delete_annotation_http,
    delete_discovered_site_http, delete_rss_folder_http, delete_rss_reading_list_http,
    duplicate_rss_reading_list_http, get_all_tags_http, get_article_annotations_http,
    get_article_tags_http, get_articles_by_tag_http, get_discovered_sites_http,
    get_feed_statistics_http, get_read_rss_articles_http, get_river_of_news_http,
    get_rss_article_clusters_http, get_rss_articles_with_intelligence_http,
    get_rss_classifiers_http, get_rss_folders_http, get_rss_reading_list_by_id_http,
    get_rss_reading_lists_http, invalidate_clusters_for_feed_http, mark_rss_article_unread_http,
    mark_rss_articles_after_date_read_http, mark_rss_articles_before_date_read_http,
    merge_tags_http, migrate_folders_from_localstorage_http, move_feed_to_folder_http,
    recompute_all_intelligence_scores_http, refresh_discoveries, remove_rss_classifier_http,
    remove_tag_http, rename_tag_http, reorder_folders_http, search_rss_articles_http,
    set_feed_view_preferences_http, tag_article_http, toggle_feed_active_http, untag_article_http,
    update_annotation_http, update_rss_classifiers_batch_http, ClassifierUpdate, RssReadingList,
};
use crate::database::Repository;
use crate::error::AppError;
use crate::models::podcast::{
    PodcastEpisode, PodcastFeed, PodcastFeedResponse, PodcastSearchResponse, PodcastSearchResult,
};
use crate::models::{Document, DocumentImageAsset, Extract, FileType, ItemType, LearningItem};
use crate::podcast::parser::parse_podcast_feed;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
    Router,
};
use base64::{engine::general_purpose, Engine as _};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
};
use tracing::{error, info, warn};
use url::Url;

/// Maximum payload size (10MB).
///
/// Mirrored in `browser_extension/shared.js` as
/// `TRANSPORT_LIMITS.SERVER_MAX_REQUEST_BYTES`. The extension's own request
/// budget (8 MB, `TRANSPORT_LIMITS.EXTENSION_REQUEST_BUDGET_BYTES`) stays
/// strictly below this so its own shedding should always kick in first; this
/// limit is a backstop, not the mechanism users are expected to hit.
/// `browser_extension/tests/shared.test.cjs` asserts the two stay ordered.
const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024;

/// Server state shared across handlers
#[derive(Clone)]
pub struct ServerState {
    pub repo: Arc<Repository>,
    pub app_handle: AppHandle,
    pub running: Arc<Mutex<bool>>,
    pub ai_config: Arc<Mutex<Option<AIConfig>>>,
    pub automation_api_key: Arc<Mutex<Option<String>>>,
}

/// Server status for Tauri commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub connections: usize,
}

/// Payload emitted when a document is saved via browser extension
#[derive(Clone, Serialize)]
struct DocumentSavedEvent {
    document_id: String,
    title: String,
    url: String,
}

/// Payload emitted when an extract is saved via browser extension
#[derive(Clone, Serialize)]
struct ExtractSavedEvent {
    extract_id: String,
    document_id: String,
    url: String,
    target_type: String,
    target_id: String,
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSyncConfig {
    pub host: String,
    pub port: u16,
    #[serde(default, alias = "auto_start")]
    pub auto_start: bool,
    #[serde(default, alias = "apiKey")]
    pub api_key: Option<String>,
}

impl Default for BrowserSyncConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8766,
            auto_start: false,
            api_key: None,
        }
    }
}

/// Extension request payload from browser
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionImagePayload {
    pub src: String,
    #[serde(default)]
    pub alt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExtensionRequest {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub text: String,
    /// Rich HTML content with inline styles for 1:1 visual fidelity
    #[serde(default)]
    pub html_content: Option<String>,
    #[serde(default)]
    pub extracted_images: Option<Vec<ExtensionImagePayload>>,
    #[serde(default)]
    pub r#type: String, // "page", "extract", "video"
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
    /// Versioned, optional browser evidence. Legacy `context` remains valid.
    #[serde(default, alias = "captureContext")]
    pub capture_context: Option<serde_json::Value>,
    #[serde(default, alias = "extensionVersion")]
    pub extension_version: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub analysis: Option<serde_json::Value>,
    #[serde(default)]
    pub fsrs_data: Option<serde_json::Value>,
    #[serde(default)]
    pub test: Option<bool>,
}

/// Response to browser extension
#[derive(Debug, Serialize)]
pub struct ExtensionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// AI request from browser extension
#[derive(Debug, Deserialize)]
pub struct AIRequest {
    /// Content to process
    pub content: String,
    /// Type of AI operation: "summarize", "key-points", "flashcards", "questions"
    #[serde(default = "default_ai_operation")]
    pub operation: String,
    /// Max words for summary (default: 150)
    #[serde(default = "default_max_words")]
    pub max_words: usize,
    /// Count for key points/questions/flashcards (default: 5)
    #[serde(default = "default_count")]
    pub count: usize,
    /// Persist generated flashcards directly into the active Incrementum collection.
    #[serde(default)]
    pub save_flashcards: bool,
    /// Text flashcard formats requested by the extension (`qa`, `cloze`).
    #[serde(default)]
    pub card_types: Vec<String>,
    /// Page URL for context
    #[serde(default)]
    pub url: Option<String>,
    /// Page title for context
    #[serde(default)]
    pub title: Option<String>,
    /// Optional bounded browser evidence for generated learning items.
    #[serde(default, alias = "captureContext")]
    pub capture_context: Option<serde_json::Value>,
}

fn default_ai_operation() -> String {
    "summarize".to_string()
}
fn default_max_words() -> usize {
    150
}
fn default_count() -> usize {
    5
}

/// Generated flashcard for browser extension
#[derive(Debug, Clone, Serialize)]
pub struct GeneratedFlashcard {
    pub question: String,
    pub answer: String,
    pub card_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_id: Option<String>,
}

/// AI response to browser extension
#[derive(Debug, Serialize)]
pub struct AIResponse {
    pub success: bool,
    /// Summary of the content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Key points extracted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_points: Option<Vec<String>>,
    /// Generated flashcards
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flashcards: Option<Vec<GeneratedFlashcard>>,
    /// Generated questions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<String>>,
    /// Reading time estimate in minutes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_time_minutes: Option<u32>,
    /// Word count
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_count: Option<u32>,
    /// Complexity score (1-10)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complexity_score: Option<u8>,
    /// Error message if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// AI status response
#[derive(Debug, Serialize)]
pub struct AIStatusResponse {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageOcclusionRegion {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageOcclusionRequest {
    pub image_base64: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    pub question: String,
    #[serde(default)]
    pub answer: String,
    pub regions: Vec<ImageOcclusionRegion>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, alias = "captureContext")]
    pub capture_context: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ImageRegistryIngestRequest {
    #[serde(alias = "imageBase64")]
    pub image_base64: String,
    #[serde(default, alias = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(default, alias = "fileName")]
    pub file_name: Option<String>,
    #[serde(default, alias = "sourceUrl")]
    pub source_url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub alt: Option<String>,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default, alias = "captureContext")]
    pub capture_context: Option<serde_json::Value>,
    #[serde(default = "default_open_composer")]
    pub open_composer: bool,
}

/// Normalized payload used by both the legacy extension image route and the
/// dedicated image-registry/occlusion handoff route.
#[derive(Debug, Clone)]
struct ImageRegistryIngestPayload {
    image_base64: Option<String>,
    data_url: Option<String>,
    image_url: Option<String>,
    mime_type: Option<String>,
    file_name: Option<String>,
    source_url: Option<String>,
    title: Option<String>,
    alt: Option<String>,
    caption: Option<String>,
    domain: Option<String>,
    tags: Option<Vec<String>>,
    capture_context: Option<serde_json::Value>,
    extension_version: Option<String>,
    open_composer: bool,
}

fn default_open_composer() -> bool {
    // Plain "Save Image to Plethora" captures must land in the Image Registry
    // without hijacking the desktop composer; the occlusion handoff flow
    // explicitly passes `open_composer: true`.
    false
}

/// RSS feed creation request
#[derive(Debug, Deserialize)]
pub struct CreateFeedRequest {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub update_interval: Option<i32>,
    #[serde(default)]
    pub auto_queue: Option<bool>,
}

/// RSS feed update request
#[derive(Debug, Deserialize)]
pub struct UpdateFeedRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub update_interval: Option<i32>,
    #[serde(default)]
    pub auto_queue: Option<bool>,
    #[serde(default)]
    pub is_active: Option<bool>,
}

/// RSS feed response with unread count
#[derive(Debug, Clone, Serialize)]
pub struct FeedResponse {
    #[serde(flatten)]
    pub feed: RssFeed,
    pub unread_count: i32,
}

/// OPML import request
#[derive(Debug, Deserialize)]
pub struct OpmlImportRequest {
    pub opml_content: String,
}

/// OPML export response
#[derive(Debug, Serialize)]
pub struct OpmlExportResponse {
    pub opml_content: String,
}

/// Document progress update request
#[derive(Debug, Deserialize)]
pub struct UpdateProgressRequest {
    pub current_page: Option<i32>,
    pub current_scroll_percent: Option<f64>,
    pub current_cfi: Option<String>,
    pub current_view_state: Option<String>,
}

/// Document response
#[derive(Debug, Serialize)]
pub struct DocumentResponse {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub file_type: String,
    pub current_page: Option<i32>,
    pub current_scroll_percent: Option<f64>,
    pub current_cfi: Option<String>,
    pub current_view_state: Option<String>,
    pub total_pages: Option<i32>,
    pub content: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub date_added: String,
    pub date_modified: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationCreateCardRequest {
    pub question: String,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub item_type: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationCreateCardResponse {
    pub id: String,
    pub due_date: String,
    pub interval: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDueCountResponse {
    pub due_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSubmitReviewRequest {
    pub item_id: String,
    pub rating: i32,
    #[serde(default)]
    pub time_taken: Option<i32>,
}

/// Global server handle for shutdown
static SERVER_HANDLE: Mutex<Option<tokio::task::JoinHandle<()>>> = Mutex::const_new(None);

pub static ACTIVE_THEME: once_cell::sync::Lazy<
    std::sync::Mutex<(String, Option<serde_json::Value>)>,
> = once_cell::sync::Lazy::new(|| std::sync::Mutex::new(("super-game-bro".to_string(), None)));

pub fn set_active_theme(theme_id: String, colors: Option<serde_json::Value>) {
    if let Ok(mut theme) = ACTIVE_THEME.lock() {
        *theme = (theme_id, colors);
    }
}

pub fn get_active_theme() -> (String, Option<serde_json::Value>) {
    if let Ok(theme) = ACTIVE_THEME.lock() {
        theme.clone()
    } else {
        ("super-game-bro".to_string(), None)
    }
}

/// Start the HTTP server for browser extension
pub async fn start_server(
    config: BrowserSyncConfig,
    repo: Arc<Repository>,
    app_handle: AppHandle,
    ai_config: Option<AIConfig>,
) -> Result<(), AppError> {
    let mut handle = SERVER_HANDLE.lock().await;
    if handle.is_some() {
        return Err(AppError::IntegrationError(
            "Browser extension server is already running".to_string(),
        ));
    }

    let addr = format!("{}:{}", config.host, config.port);
    let addr: SocketAddr = addr
        .parse()
        .map_err(|e| AppError::IntegrationError(format!("Invalid address: {}", e)))?;

    let running = Arc::new(Mutex::new(true));
    let state = ServerState {
        repo: repo.clone(),
        app_handle: app_handle.clone(),
        running: running.clone(),
        ai_config: Arc::new(Mutex::new(ai_config)),
        automation_api_key: Arc::new(Mutex::new(config.api_key.clone())),
    };

    let app = Router::new()
        // Extension/AI endpoints
        .route("/", post(handle_extension_request))
        .route("/ai/process", post(handle_ai_request))
        .route("/ai/status", get(handle_ai_status))
        .route("/ai/image-occlusion", post(handle_image_occlusion_request))
        .route(
            "/api/image-registry/ingest",
            post(handle_image_registry_ingest),
        )
        .route("/api/theme", get(handle_get_theme))
        .route(
            "/api/rss/feeds",
            post(handle_create_feed).get(handle_list_feeds),
        )
        .route(
            "/api/rss/feeds/:id",
            get(handle_get_feed)
                .put(handle_update_feed)
                .delete(handle_delete_feed),
        )
        .route("/api/rss/feeds/:id/articles", get(handle_get_feed_articles))
        .route("/api/rss/articles/:id", post(handle_mark_article))
        .route(
            "/api/rss/articles/:id/queued",
            post(handle_toggle_article_queued),
        )
        .route("/api/rss/fetch", get(handle_fetch_feed_url))
        .route("/api/rss/opml/import", post(handle_opml_import))
        .route("/api/rss/opml/export", get(handle_opml_export))
        .route(
            "/api/rss/preferences",
            get(handle_get_preferences).put(handle_set_preferences),
        )
        // RSS NewsBlur features API
        .route(
            "/api/rss/classifiers",
            post(handle_add_classifier).get(handle_list_classifiers),
        )
        .route("/api/rss/classifiers/:id", delete(handle_remove_classifier))
        .route(
            "/api/rss/classifiers/batch",
            put(handle_batch_update_classifiers),
        )
        .route(
            "/api/rss/articles/:id/unread",
            post(handle_mark_article_unread),
        )
        .route(
            "/api/rss/articles/mark-before",
            post(handle_mark_before_date),
        )
        .route("/api/rss/articles/mark-after", post(handle_mark_after_date))
        .route("/api/rss/articles/read", get(handle_get_read_articles))
        .route("/api/rss/articles/river", get(handle_river_of_news))
        .route(
            "/api/rss/articles/intelligence",
            get(handle_articles_with_intelligence),
        )
        .route(
            "/api/rss/articles/recompute-scores",
            post(handle_recompute_scores),
        )
        .route("/api/rss/search", get(handle_search_articles))
        .route(
            "/api/rss/clusters",
            post(handle_compute_clusters).get(handle_get_clusters),
        )
        .route(
            "/api/rss/clusters/invalidate/:feed_id",
            post(handle_invalidate_clusters),
        )
        .route("/api/rss/tags", post(handle_add_tag).get(handle_list_tags))
        .route("/api/rss/tags/:id", delete(handle_remove_tag))
        .route("/api/rss/tags/:id/rename", put(handle_rename_tag))
        .route("/api/rss/tags/merge", post(handle_merge_tags))
        .route(
            "/api/rss/articles/:article_id/tags",
            get(handle_get_article_tags),
        )
        .route(
            "/api/rss/articles/:article_id/tags/:tag_id",
            post(handle_tag_article).delete(handle_untag_article),
        )
        .route(
            "/api/rss/tags/:tag_id/articles",
            get(handle_get_articles_by_tag),
        )
        .route("/api/rss/annotations", post(handle_create_annotation))
        .route(
            "/api/rss/annotations/:id",
            put(handle_update_annotation).delete(handle_delete_annotation),
        )
        .route(
            "/api/rss/articles/:article_id/annotations",
            get(handle_get_article_annotations),
        )
        .route(
            "/api/rss/discover",
            get(handle_get_discovered_sites).post(handle_refresh_discoveries),
        )
        .route(
            "/api/rss/discover/:id",
            delete(handle_delete_discovered_site),
        )
        .route(
            "/api/rss/folders",
            post(handle_create_folder).get(handle_list_folders),
        )
        .route(
            "/api/rss/folders/:id",
            put(handle_update_folder).delete(handle_delete_folder),
        )
        .route(
            "/api/rss/folders/reorder",
            post(handle_reorder_folders_http),
        )
        .route(
            "/api/rss/feeds/:feed_id/folder",
            post(handle_move_feed_to_folder),
        )
        .route(
            "/api/rss/feeds/:feed_id/toggle-active",
            post(handle_toggle_feed_active),
        )
        .route(
            "/api/rss/feeds/:feed_id/statistics",
            get(handle_get_feed_statistics),
        )
        .route(
            "/api/rss/feeds/:feed_id/view-prefs",
            put(handle_set_feed_view_prefs),
        )
        .route("/api/rss/folders/migrate", post(handle_migrate_folders))
        .route(
            "/api/rss/reading-lists",
            post(handle_create_reading_list).get(handle_list_reading_lists),
        )
        .route(
            "/api/rss/reading-lists/:id",
            put(handle_update_reading_list).delete(handle_delete_reading_list),
        )
        .route(
            "/api/rss/reading-lists/:id/duplicate",
            post(handle_duplicate_reading_list),
        )
        .route("/api/documents/:id", get(handle_get_document))
        .route("/api/documents/:id/progress", post(handle_update_progress))
        .route("/api/podcast/search", get(handle_podcast_search))
        .route("/api/podcast/subscribe", post(handle_podcast_subscribe))
        .route("/api/podcast/feeds", get(handle_podcast_list_feeds))
        .route(
            "/api/podcast/feeds/:feed_id",
            delete(handle_podcast_unsubscribe),
        )
        .route(
            "/api/podcast/feeds/:feed_id/refresh",
            post(handle_podcast_refresh_feed),
        )
        .route(
            "/api/podcast/feeds/:feed_id/rename",
            post(handle_podcast_rename_feed),
        )
        .route(
            "/api/podcast/feeds/:feed_id/episodes",
            get(handle_podcast_get_episodes),
        )
        .route(
            "/api/podcast/feeds/episodes",
            get(handle_podcast_get_episode_queue),
        )
        .route(
            "/api/podcast/episodes/:episode_id/played",
            post(handle_podcast_mark_played),
        )
        .route(
            "/api/podcast/episodes/:episode_id/position",
            post(handle_podcast_update_position).get(handle_podcast_get_position),
        )
        .route(
            "/api/podcast/episodes/:episode_id/transcribe",
            post(handle_podcast_transcribe),
        )
        .route(
            "/api/podcast/episodes/:episode_id/transcript",
            get(handle_podcast_get_transcript),
        )
        .route(
            "/api/podcast/episodes/:episode_id/cancel-transcription",
            post(handle_podcast_cancel_transcription),
        )
        .route(
            "/api/podcast/feeds/:feed_id/auto-transcribe",
            post(handle_podcast_set_auto_transcribe),
        )
        .route("/api/automation/cards", post(handle_automation_create_card))
        .route(
            "/api/automation/reviews/due-count",
            get(handle_automation_due_count),
        )
        .route(
            "/api/automation/reviews/submit",
            post(handle_automation_submit_review),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_api_key,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|origin, _| {
                    let Ok(s) = origin.to_str() else { return false };
                    s.starts_with("http://127.0.0.1:")
                        || s.starts_with("http://localhost:")
                        || s.starts_with("chrome-extension://")
                        || s.starts_with("moz-extension://")
                        || s.starts_with("safari-web-extension://")
                        || s == "tauri://localhost"
                        || s == "https://tauri.localhost"
                        || s == "null"
                }))
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers(tower_http::cors::Any),
        )
        .layer(RequestBodyLimitLayer::new(MAX_PAYLOAD_SIZE))
        // Added after RequestBodyLimitLayer so it becomes the OUTER layer and
        // runs first, ahead of that layer's own bare-413 rejection.
        .layer(middleware::from_fn(annotate_oversized_request))
        .with_state(state);

    info!("Starting browser extension server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            AppError::IntegrationError(format!(
                "Browser extension server port {} is already in use",
                config.port
            ))
        } else {
            AppError::IntegrationError(format!("Failed to bind to {}: {}", addr, e))
        }
    })?;

    info!("Browser extension server listening on {}", addr);

    // Spawn server task
    let task = tokio::spawn(async move {
        // Serve with graceful shutdown
        if let Err(e) = axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal(running.clone()))
            .await
        {
            error!("Server error: {}", e);
        }

        info!("Browser extension server stopped");
    });

    *handle = Some(task);
    drop(handle);

    Ok(())
}

/// Signal handler for graceful shutdown
async fn shutdown_signal(running: Arc<Mutex<bool>>) {
    // Wait until running is set to false
    loop {
        let r = *running.lock().await;
        if !r {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

/// Stop the HTTP server
pub async fn stop_server() -> Result<(), AppError> {
    let mut handle = SERVER_HANDLE.lock().await;
    if handle.is_none() {
        return Err(AppError::IntegrationError(
            "Browser extension server is not running".to_string(),
        ));
    }

    // Signal shutdown by setting running to false
    // Note: The running flag is managed by the ServerState, which we don't have direct access to here
    // The server task will exit when the handle is aborted
    if let Some(task) = handle.take() {
        task.abort();
    }

    Ok(())
}

/// Get current server status
pub async fn get_status(config: BrowserSyncConfig) -> ServerStatus {
    let handle = SERVER_HANDLE.lock().await;
    let running = handle.is_some();

    ServerStatus {
        running,
        port: config.port,
        connections: 0, // Could be tracked with an atomic counter if needed
    }
}

/// Handle incoming POST request from browser extension
async fn handle_extension_request(
    State(state): State<ServerState>,
    Json(payload): Json<ExtensionRequest>,
) -> Response {
    info!(
        "Received extension request: type={}, url={}",
        payload.r#type, payload.url
    );

    if payload.test.unwrap_or(false) {
        return (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "message": "Server is running"
            })),
        )
            .into_response();
    }

    if payload.url.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "Missing required field: url");
    }

    // Route to appropriate handler based on type field.
    // Browser extension "page"/link saves should be treated as HTML, not "other",
    // so they remain directly viewable in-app.
    let request_kind = classify_extension_request(&payload);
    if matches!(request_kind, ExtensionRequestKind::XThread) {
        // X captures resolve + enrich server-side (seconds, not milliseconds),
        // and retrieval failures are typed — so this arm owns its response
        // mapping instead of folding into the generic 500 handler below.
        return match handle_x_thread_request(&state, &payload).await {
            Ok(response) => (StatusCode::OK, Json(response)).into_response(),
            Err(XThreadCaptureError::Retrieval(e)) => x_thread_error_response(&e),
            Err(XThreadCaptureError::Persist(e)) => {
                error!("Error handling x-thread request: {}", e);
                error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
            }
        };
    }
    let result = match request_kind {
        ExtensionRequestKind::Extract => handle_extract_request(&state, &payload).await,
        ExtensionRequestKind::Video => {
            handle_import_request(&state, &payload, FileType::Youtube).await
        }
        ExtensionRequestKind::Page => {
            let file_type = if is_youtube_url(&payload.url) {
                FileType::Youtube
            } else {
                FileType::Html
            };
            handle_import_request(&state, &payload, file_type).await
        }
        ExtensionRequestKind::Image => {
            let img_payload = ImageRegistryIngestPayload {
                image_base64: None,
                data_url: None,
                image_url: Some(payload.url.clone()),
                mime_type: None,
                file_name: None,
                source_url: Some(payload.url.clone()),
                title: Some(payload.title.clone()),
                alt: None,
                caption: None,
                domain: Url::parse(&payload.url).ok().and_then(|u| u.host_str().map(str::to_string)),
                tags: payload.tags.clone(),
                capture_context: payload.capture_context.clone(),
                extension_version: payload.extension_version.clone(),
                open_composer: false,
            };
            return handle_image_registry_ingest_internal(&state, img_payload).await;
        }
        ExtensionRequestKind::Import => {
            let file_type = infer_extension_file_type(&payload);
            handle_import_request(&state, &payload, file_type).await
        }
        // Handled by the early-return branch above; this arm exists only to
        // keep the match exhaustive.
        ExtensionRequestKind::XThread => unreachable!("XThread handled before match"),
    };

    match result {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(e) => {
            error!("Error handling extension request: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExtensionRequestKind {
    Page,
    Extract,
    Video,
    Image,
    Import,
    /// X post/thread status URL — routed to the ThreadReaderApp-first
    /// pipeline regardless of the declared `type`.
    XThread,
}

/// True when `raw` is an x.com/twitter.com status URL
/// (`https://(www.|mobile.)?(x|twitter).com/<user>/status/<id>`), tolerating
/// query params and `/photo/n`-style suffixes. Extension captures for these
/// URLs route into the X thread pipeline regardless of their declared `type`
/// (an older extension sends `type: "page"` for x.com saves); non-status X
/// URLs (profiles, search, home) stay on the generic page path. Mirrors
/// `isXStatusURL` in browser_extension/shared.js — keep both sides in sync
/// by hand.
fn is_x_status_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw.trim()) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let host = host
        .strip_prefix("www.")
        .or_else(|| host.strip_prefix("mobile."))
        .unwrap_or(host.as_str());
    if host != "x.com" && host != "twitter.com" {
        return false;
    }
    let segments: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 3 {
        return false;
    }
    let user = segments[0];
    let is_handle = !user.is_empty()
        && user.len() <= 64
        && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        // The generic `/i/status/<id>` redirect format carries no real user.
        && !user.eq_ignore_ascii_case("i");
    is_handle
        && segments[1].eq_ignore_ascii_case("status")
        && !segments[2].is_empty()
        && segments[2].chars().all(|c| c.is_ascii_digit())
}

fn classify_extension_request(payload: &ExtensionRequest) -> ExtensionRequestKind {
    // URL wins over `type`: any X status URL goes to the thread pipeline.
    if is_x_status_url(&payload.url) {
        return ExtensionRequestKind::XThread;
    }
    match payload.r#type.trim().to_ascii_lowercase().as_str() {
        "extract" => ExtensionRequestKind::Extract,
        "video" => ExtensionRequestKind::Video,
        "image" | "image-registry" | "image_asset" => ExtensionRequestKind::Image,
        "page" | "link" | "" => ExtensionRequestKind::Page,
        _ => ExtensionRequestKind::Import,
    }
}

fn is_youtube_url(url: &str) -> bool {
    let lowered = url.to_ascii_lowercase();
    lowered.contains("youtube.com") || lowered.contains("youtu.be")
}

fn infer_extension_file_type(payload: &ExtensionRequest) -> FileType {
    if is_youtube_url(&payload.url) {
        return FileType::Youtube;
    }
    if payload.url.to_ascii_lowercase().ends_with(".pdf") {
        return FileType::Pdf;
    }
    FileType::Html
}

fn normalize_browser_source_url(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw.trim()) else {
        return raw.trim().to_string();
    };
    url.set_fragment(None);
    url.to_string()
}

/// Resolve the collection id that browser-extension imports should land in.
///
/// The extension saves into whatever collection the user currently has active
/// in the desktop app (tracked in the `active_collection_id` setting), so the
/// imported document is immediately visible in the library they're looking at.
/// Falls back to the default collection when the setting is missing or points
/// at a collection that no longer exists.
async fn resolve_browser_import_collection_id(repo: &Repository) -> String {
    if let Ok(Some(id)) = repo.get_setting("active_collection_id").await {
        let trimmed = id.trim();
        if !trimmed.is_empty() && trimmed != crate::models::collection::DEFAULT_COLLECTION_ID {
            // Validate the stored id still refers to an existing collection,
            // otherwise the document would be orphaned and never displayed.
            if let Ok(collections) = repo.get_collections().await {
                if collections.iter().any(|c| c.id == trimmed) {
                    return trimmed.to_string();
                }
            }
        }
    }
    crate::models::collection::DEFAULT_COLLECTION_ID.to_string()
}

/// Preserve explicit semantic tags supplied by the user or extension payload.
/// Operational import provenance is stored in structured metadata instead of
/// being mixed into the semantic tag array.
fn browser_import_tags(explicit_tags: Option<&Vec<String>>) -> Vec<String> {
    // Operational labels such as `browser-extension` and `ai-generated` used
    // to be mixed into semantic tags. New writes preserve only explicit user
    // tags; compatibility readers continue to display historical labels.
    explicit_tags.cloned().unwrap_or_default()
}

const BROWSER_CONTEXT_VERSION: u64 = 1;
const BROWSER_CONTEXT_TOTAL_BYTES: usize = 8 * 1024;

fn bounded_context_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
    max: usize,
) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(|value| value.as_str()))
        .map(|value| {
            value
                .chars()
                .filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t')
                .take(max)
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|value| !value.is_empty())
}

fn bounded_context_list(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
    max_items: usize,
    max: usize,
) -> Option<Vec<String>> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(|value| value.as_array()))
        .map(|values| {
            let mut output = Vec::new();
            for value in values {
                let Some(text) = value.as_str() else { continue };
                let bounded = text
                    .chars()
                    .filter(|ch| !ch.is_control())
                    .take(max)
                    .collect::<String>()
                    .trim()
                    .to_string();
                if !bounded.is_empty() && !output.contains(&bounded) {
                    output.push(bounded);
                }
                if output.len() >= max_items {
                    break;
                }
            }
            output
        })
        .filter(|values| !values.is_empty())
}

/// Normalize optional extension evidence at the native boundary. Unknown,
/// malformed, and over-budget fields are dropped/truncated; the enclosing
/// save remains valid and legacy `context` is still useful as nearby text.
fn normalize_browser_capture_context(payload: &ExtensionRequest) -> Option<serde_json::Value> {
    let object = payload
        .capture_context
        .as_ref()
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let source_url = bounded_context_string(&object, &["sourceUrl", "source_url"], 2048)
        .or_else(|| (!payload.url.trim().is_empty()).then(|| payload.url.trim().chars().take(2048).collect()));
    let mut context = serde_json::Map::new();
    context.insert("version".to_string(), json!(BROWSER_CONTEXT_VERSION));
    if let Some(value) = source_url.clone() {
        context.insert("sourceUrl".to_string(), json!(value));
        if let Ok(url) = Url::parse(&value) {
            if let Some(host) = url.host_str() {
                context.insert("domain".to_string(), json!(host.trim_start_matches("www.").chars().take(160).collect::<String>()));
            }
        }
    }
    if let Some(value) = bounded_context_string(&object, &["domain"], 160) { context.insert("domain".to_string(), json!(value)); }
    if let Some(value) = bounded_context_string(&object, &["pageTitle", "page_title"], 240)
        .or_else(|| (!payload.title.trim().is_empty()).then(|| payload.title.trim().chars().take(240).collect()))
    { context.insert("pageTitle".to_string(), json!(value)); }
    for (name, keys, max) in [
        ("author", &["author"][..], 180),
        ("nearbyText", &["nearbyText", "nearby_text", "context"][..], 1800),
        ("captionAltText", &["captionAltText", "caption_alt_text", "caption", "alt"][..], 1200),
        ("contentKind", &["contentKind", "content_kind"][..], 80),
        ("sourceDocumentId", &["sourceDocumentId", "source_document_id"][..], 120),
        ("selector", &["selector"][..], 240),
        ("extensionVersion", &["extensionVersion", "extension_version"][..], 80),
    ] {
        if let Some(value) = bounded_context_string(&object, keys, max) { context.insert(name.to_string(), json!(value)); }
    }
    if context.get("nearbyText").is_none() {
        if let Some(value) = payload.context.as_deref().map(|value| value.trim().chars().take(1800).collect::<String>()).filter(|value| !value.is_empty()) {
            context.insert("nearbyText".to_string(), json!(value));
        }
    }
    if let Some(values) = bounded_context_list(&object, &["headingPath", "heading_path", "headings"], 12, 180) { context.insert("headingPath".to_string(), json!(values)); }
    if let Some(values) = bounded_context_list(&object, &["sourceTags", "source_tags"], 24, 80) { context.insert("sourceTags".to_string(), json!(values)); }
    if object.get("reduced").and_then(|value| value.as_bool()).unwrap_or(false) { context.insert("reduced".to_string(), json!(true)); }

    let mut value = serde_json::Value::Object(context);
    while serde_json::to_vec(&value).map(|bytes| bytes.len()).unwrap_or(usize::MAX) > BROWSER_CONTEXT_TOTAL_BYTES {
        let Some(map) = value.as_object_mut() else { break };
        if let Some(text) = map.get("captionAltText").and_then(|value| value.as_str()).map(str::to_string) {
            map.insert("captionAltText".to_string(), json!(text.chars().take(text.len().saturating_sub(200)).collect::<String>()));
        } else if let Some(text) = map.get("nearbyText").and_then(|value| value.as_str()).map(str::to_string) {
            map.insert("nearbyText".to_string(), json!(text.chars().take(text.len().saturating_sub(300)).collect::<String>()));
        } else if let Some(values) = map.get_mut("sourceTags").and_then(|value| value.as_array_mut()) {
            values.pop();
        } else if let Some(values) = map.get_mut("headingPath").and_then(|value| value.as_array_mut()) {
            values.pop();
        } else { break; }
        map.insert("reduced".to_string(), json!(true));
    }
    Some(value)
}

fn browser_capture_fingerprint(item_type: &str, content: &str, context: &Option<serde_json::Value>, tags: &[String]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(item_type.as_bytes());
    hasher.update(content.as_bytes());
    if let Some(context) = context { hasher.update(serde_json::to_vec(context).unwrap_or_default()); }
    hasher.update(serde_json::to_vec(tags).unwrap_or_default());
    format!("browser-org-v{}-{:x}", BROWSER_CONTEXT_VERSION, hasher.finalize())
}

fn queued_browser_organization(
    item_type: &str,
    content: &str,
    context: &Option<serde_json::Value>,
    tags: &[String],
    source_document_id: Option<&str>,
) -> (Option<serde_json::Value>, Option<serde_json::Value>) {
    if context.is_none() && source_document_id.is_none() { return (None, None); }
    let captured_at = chrono::Utc::now().to_rfc3339();
    let fingerprint = browser_capture_fingerprint(item_type, content, context, tags);
    let provenance = json!({
        "source": "browser_extension",
        "itemType": item_type,
        "sourceUrl": context.as_ref().and_then(|value| value.get("sourceUrl")).cloned(),
        "capturedAt": captured_at,
        "sourceDocumentId": source_document_id.or_else(|| context.as_ref().and_then(|value| value.get("sourceDocumentId")).and_then(|value| value.as_str())),
        "extensionVersion": context.as_ref().and_then(|value| value.get("extensionVersion")).cloned(),
        "schemaVersion": BROWSER_CONTEXT_VERSION,
    });
    let organization = json!({
        "schemaVersion": BROWSER_CONTEXT_VERSION,
        "status": "queued",
        "confidenceBand": "none",
        "fingerprint": fingerprint,
        "queuedAt": captured_at,
        "contextReduced": context.as_ref().and_then(|value| value.get("reduced")).and_then(|value| value.as_bool()).unwrap_or(false),
    });
    (Some(provenance), Some(organization))
}

fn normalize_browser_capture_input(
    raw: Option<serde_json::Value>,
    url: Option<&str>,
    title: Option<&str>,
    legacy_context: Option<&str>,
) -> Option<serde_json::Value> {
    let payload = ExtensionRequest {
        url: url.unwrap_or_default().to_string(),
        title: title.unwrap_or_default().to_string(),
        text: String::new(),
        html_content: None,
        extracted_images: None,
        r#type: "page".to_string(),
        source: "browser_extension".to_string(),
        timestamp: None,
        context: legacy_context.map(str::to_string),
        capture_context: raw,
        extension_version: None,
        tags: None,
        priority: None,
        analysis: None,
        fsrs_data: None,
        test: None,
    };
    normalize_browser_capture_context(&payload)
}

fn select_extension_document_text(payload: &ExtensionRequest) -> String {
    if !payload.text.trim().is_empty() {
        payload.text.trim().to_string()
    } else {
        payload
            .html_content
            .as_deref()
            .map(crate::processor::html::extract_text_from_html_fragment)
            .unwrap_or_default()
    }
}

/// Detect the navigation/index dump produced when a whole page shell is
/// converted to text instead of an article. Real prose can contain brackets,
/// but a dense run of numbered/link markers plus navigation copy is a strong
/// signal that the payload should go through the readable extractor.
fn looks_like_navigation_heavy_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() < 500 {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    let bracket_markers = trimmed.matches('[').count();
    let word_count = trimmed.split_whitespace().count().max(1);
    let marker_density = bracket_markers * 8 >= word_count;
    let navigation_copy = lower.contains("skip to")
        || lower.contains("sign in")
        || lower.contains("search input")
        || lower.contains("show more")
        || lower.contains("view all");

    bracket_markers >= 12 && (marker_density || navigation_copy)
}

#[derive(Debug)]
struct BrowserImportContent {
    text: String,
    article_html: Option<String>,
    images: Option<Vec<DocumentImageAsset>>,
    mode: &'static str,
}

fn extension_image_assets(payload: &ExtensionRequest) -> Option<Vec<DocumentImageAsset>> {
    payload.extracted_images.as_ref().map(|images| {
        images
            .iter()
            .map(|image| DocumentImageAsset {
                src: image.src.clone(),
                alt: image.alt.clone(),
            })
            .collect::<Vec<_>>()
    })
}

/// Resolve the document body before persistence. Explicit extension text is
/// trusted when it looks like an article; empty or navigation-heavy captures
/// use Readability first so a large page shell cannot masquerade as a good
/// import. The generic extractor remains the final, explicitly marked fallback.
async fn resolve_browser_import_content(payload: &ExtensionRequest) -> BrowserImportContent {
    let supplied_text = select_extension_document_text(payload);
    let supplied_text_was_explicit = !payload.text.trim().is_empty();
    let supplied_html = payload
        .html_content
        .as_ref()
        .filter(|html| !html.trim().is_empty())
        .cloned();
    let supplied_images = extension_image_assets(payload);
    let supplied_is_navigation_heavy = looks_like_navigation_heavy_text(&supplied_text);
    let needs_readability = !supplied_text_was_explicit || supplied_is_navigation_heavy;

    if needs_readability {
        match fetch_readable_content(&payload.url).await {
            Ok(readable) if !readable.text.trim().is_empty() => {
                return BrowserImportContent {
                    text: readable.text,
                    article_html: Some(readable.html),
                    images: if readable.images.is_empty() {
                        supplied_images
                    } else {
                        Some(readable.images)
                    },
                    mode: "rich-preview",
                };
            }
            Ok(_) => {}
            Err(error) => {
                warn!(
                    "Readable browser import failed for {}: {}",
                    payload.url, error
                );
            }
        }
    }

    if !supplied_text.trim().is_empty() {
        return BrowserImportContent {
            text: supplied_text,
            article_html: supplied_html,
            images: supplied_images,
            mode: if supplied_is_navigation_heavy {
                "low-confidence"
            } else if payload.html_content.as_ref().is_some_and(|html| !html.trim().is_empty()) {
                "rich-preview"
            } else {
                "text-editor"
            },
        };
    }

    match fetch_page_content(&payload.url).await {
        Ok(text) => BrowserImportContent {
            text,
            article_html: None,
            images: supplied_images,
            mode: "raw-fallback",
        },
        Err(error) => {
            warn!("Failed to fetch browser import {}: {}", payload.url, error);
            BrowserImportContent {
                text: String::new(),
                article_html: None,
                images: supplied_images,
                mode: "raw-fallback",
            }
        }
    }
}

fn build_browser_import_metadata(payload: &ExtensionRequest) -> crate::models::DocumentMetadata {
    let browser_import_mode = if payload
        .html_content
        .as_ref()
        .map(|html| !html.trim().is_empty())
        .unwrap_or(false)
    {
        "rich-preview".to_string()
    } else {
        "text-editor".to_string()
    };
    let site_name = Url::parse(&payload.url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string));
    let capture_context = normalize_browser_capture_context(payload);
    let (capture_provenance, organization) = queued_browser_organization(
        "page",
        &select_extension_document_text(payload),
        &capture_context,
        payload.tags.as_deref().unwrap_or(&[]),
        None,
    );

    crate::models::DocumentMetadata {
        author: None,
        subject: None,
        keywords: None,
        created_at: None,
        modified_at: None,
        file_size: None,
        language: None,
        page_count: None,
        word_count: None,
        source: Some("browser_extension".to_string()),
        fetched_at: Some(chrono::Utc::now()),
        site_name,
        browser_import_mode: Some(browser_import_mode),
        article_html: payload.html_content.clone(),
        extracted_images: payload.extracted_images.as_ref().map(|images| {
            images
                .iter()
                .map(|image| DocumentImageAsset {
                    src: image.src.clone(),
                    alt: image.alt.clone(),
                })
            .collect()
        }),
        browser_capture_context: capture_context,
        capture_provenance,
        organization,
        ..Default::default()
    }
}

fn build_browser_import_metadata_with_article(
    payload: &ExtensionRequest,
    article_html: Option<String>,
    extracted_images: Option<Vec<DocumentImageAsset>>,
) -> crate::models::DocumentMetadata {
    let mut metadata = build_browser_import_metadata(payload);
    metadata.article_html = article_html;
    metadata.extracted_images = extracted_images;
    metadata.browser_import_mode = Some(
        if metadata
            .article_html
            .as_ref()
            .map(|html| !html.trim().is_empty())
            .unwrap_or(false)
        {
            "rich-preview".to_string()
        } else {
            "text-editor".to_string()
        },
    );
    metadata
}

fn build_browser_extract_parent_metadata(
    payload: &ExtensionRequest,
) -> crate::models::DocumentMetadata {
    let mut metadata = build_browser_import_metadata(payload);
    // Selection markup belongs to the extract, never to the parent page. In
    // particular, do not let legacy recovery promote it into document text.
    metadata.article_html = None;
    metadata.extracted_images = None;
    metadata.browser_import_mode = None;
    // The parent document is still a browser capture, but the selected text
    // belongs to the child extract and must not be promoted to page content.
    metadata
}

fn extract_images_from_html_fragment(html: &str, base_url: &str) -> Vec<DocumentImageAsset> {
    let src_regex = regex::Regex::new(r#"(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>"#)
        .expect("valid image src regex");
    let alt_regex =
        regex::Regex::new(r#"(?is)\balt\s*=\s*["']([^"']*)["']"#).expect("valid image alt regex");
    let tag_regex = regex::Regex::new(r#"(?is)<img\b[^>]*>"#).expect("valid img tag regex");
    let base = Url::parse(base_url).ok();
    let mut seen = std::collections::HashSet::new();
    let mut images = Vec::new();

    for tag in tag_regex.find_iter(html) {
        let fragment = tag.as_str();
        let Some(src_capture) = src_regex.captures(fragment) else {
            continue;
        };
        let raw_src = src_capture.get(1).map(|m| m.as_str()).unwrap_or("").trim();
        if raw_src.is_empty() || raw_src.starts_with("data:") {
            continue;
        }

        let src = base
            .as_ref()
            .and_then(|base| base.join(raw_src).ok())
            .map(|url| url.to_string())
            .unwrap_or_else(|| raw_src.to_string());
        if !seen.insert(src.clone()) {
            continue;
        }

        let alt = alt_regex
            .captures(fragment)
            .and_then(|capture| capture.get(1))
            .map(|m| m.as_str().trim().to_string())
            .filter(|alt| !alt.is_empty());

        images.push(DocumentImageAsset { src, alt });
        if images.len() >= 24 {
            break;
        }
    }

    images
}

fn spawn_browser_document_enrichment(
    repo: Arc<Repository>,
    document_id: String,
    expected_date_modified: chrono::DateTime<chrono::Utc>,
    url: String,
    baseline_len: usize,
) {
    tokio::spawn(async move {
        match fetch_readable_content(&url).await {
            Ok(readable) => {
                info!(
                    "Readability extracted {} chars (vs {} supplied) for: {}",
                    readable.text.len(),
                    baseline_len,
                    url
                );
                let metadata = build_browser_import_metadata_with_article(
                    &ExtensionRequest {
                        url: url.clone(),
                        title: String::new(),
                        text: readable.text.clone(),
                        html_content: Some(readable.html.clone()),
                        extracted_images: Some(
                            readable
                                .images
                                .iter()
                                .map(|image| ExtensionImagePayload {
                                    src: image.src.clone(),
                                    alt: image.alt.clone(),
                                })
                                .collect(),
                        ),
                        r#type: "page".to_string(),
                        source: "browser_extension".to_string(),
                        timestamp: None,
                        context: None,
                        capture_context: None,
                        extension_version: None,
                        tags: None,
                        priority: None,
                        analysis: None,
                        fsrs_data: None,
                        test: None,
                    },
                    Some(readable.html.clone()),
                    Some(readable.images.clone()),
                );
                match repo
                    .guarded_enrich_browser_document(
                        &document_id,
                        expected_date_modified,
                        &readable.text,
                        metadata,
                    )
                    .await
                {
                    Ok(true) => {}
                    Ok(false) => info!(
                        "Discarded empty, poorer, or stale readability result for: {}",
                        url
                    ),
                    Err(error) => warn!(
                        "Failed to update document {} with readable content: {}",
                        document_id, error
                    ),
                }
            }
            Err(error) => warn!(
                "Background readability extraction failed for {}: {}",
                url, error
            ),
        }
    });
}

/// Handle general document import request (page or video)
async fn handle_import_request(
    state: &ServerState,
    payload: &ExtensionRequest,
    file_type: FileType,
) -> Result<ExtensionResponse, AppError> {
    let collection_id = resolve_browser_import_collection_id(&state.repo).await;
    let initial_payload_content = select_extension_document_text(payload);
    let mut payload_content = initial_payload_content.clone();
    let mut import_article_html = payload
        .html_content
        .as_ref()
        .filter(|html| !html.trim().is_empty())
        .cloned();
    let mut payload_images = extension_image_assets(payload);
    let mut import_mode = if import_article_html.is_some() {
        "rich-preview"
    } else if initial_payload_content.trim().is_empty() {
        "raw-fallback"
    } else if looks_like_navigation_heavy_text(&initial_payload_content) {
        "low-confidence"
    } else {
        "text-editor"
    };

    if matches!(file_type, FileType::Html)
        && (payload.text.trim().is_empty()
            || looks_like_navigation_heavy_text(&initial_payload_content))
    {
        let resolved = resolve_browser_import_content(payload).await;
        payload_content = resolved.text;
        import_article_html = resolved.article_html;
        payload_images = resolved.images;
        import_mode = resolved.mode;
    }

    let payload_has_article_html = import_article_html.is_some();

    let normalized_url = normalize_browser_source_url(&payload.url);
    let existing = match state.repo.find_document_by_url(&normalized_url).await {
        Ok(Some(doc)) => Some(doc),
        _ if normalized_url != payload.url => state
            .repo
            .find_document_by_url(&payload.url)
            .await
            .ok()
            .flatten(),
        _ => None,
    };

    if let Some(doc) = existing {
        let existing_missing_text = doc
            .content
            .as_deref()
            .map(|content| content.trim().is_empty())
            .unwrap_or(true);
        let existing_missing_html = doc
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.article_html.as_deref())
            .map(|html| html.trim().is_empty())
            .unwrap_or(true);

        if matches!(file_type, FileType::Html)
            && ((!payload_content.is_empty() && existing_missing_text)
                || (payload_has_article_html && existing_missing_html))
        {
            let mut metadata = build_browser_import_metadata_with_article(
                payload,
                import_article_html.clone(),
                payload_images.clone(),
            );
            metadata.browser_import_mode = Some(import_mode.to_string());
            let next_content = if payload_content.is_empty() {
                doc.content.unwrap_or_default()
            } else {
                payload_content.clone()
            };
            if let Err(error) = state
                .repo
                .update_document_content(&doc.id, &next_content, None, None, Some(metadata))
                .await
            {
                warn!(
                    "Failed to enrich existing browser-imported document {}: {}",
                    doc.id, error
                );
            }
        }

        info!(
            "Document already exists for URL: {}, returning existing doc",
            payload.url
        );
        let _ = state.app_handle.emit(
            "browser-sync://document-saved",
            DocumentSavedEvent {
                document_id: doc.id.clone(),
                title: doc.title.clone(),
                url: payload.url.clone(),
            },
        );
        return Ok(ExtensionResponse {
            success: true,
            document_id: Some(doc.id),
            extract_id: None,
            error: None,
        });
    }

    let mut title = payload.title.clone();
    let mut cover_image_url = None;
    let mut cover_image_source = None;
    let mut author = None;

    if matches!(file_type, FileType::Youtube) {
        let collection_id = resolve_browser_import_collection_id(&state.repo).await;
        info!("Importing YouTube video from URL: {}", payload.url);
        match crate::youtube::import_youtube_video_internal(
            &payload.url,
            Some(collection_id),
            &state.repo,
        )
        .await
        {
            Ok(created) => {
                let _ = state.app_handle.emit(
                    "browser-sync://document-saved",
                    DocumentSavedEvent {
                        document_id: created.id.clone(),
                        title: created.title.clone(),
                        url: payload.url.clone(),
                    },
                );
                return Ok(ExtensionResponse {
                    success: true,
                    document_id: Some(created.id),
                    extract_id: None,
                    error: None,
                });
            }
            Err(e) => {
                warn!("Failed to import YouTube video via yt-dlp internal importer: {}. Falling back to noembed metadata fetch.", e);
                if let Some(video_id) = crate::youtube::extract_video_id(&payload.url) {
                    let noembed_url = format!(
                        "https://noembed.com/embed?url=https://www.youtube.com/watch?v={}",
                        video_id
                    );
                    let client = reqwest::Client::new();
                    if let Ok(resp) = client.get(&noembed_url).send().await {
                        if resp.status().is_success() {
                            if let Ok(json) = resp.json::<serde_json::Value>().await {
                                if let Some(t) = json.get("title").and_then(|v| v.as_str()) {
                                    if !t.trim().is_empty() {
                                        title = t.to_string();
                                    }
                                }
                                if let Some(thumb) =
                                    json.get("thumbnail_url").and_then(|v| v.as_str())
                                {
                                    if !thumb.trim().is_empty() {
                                        cover_image_url = Some(thumb.to_string());
                                        cover_image_source = Some("youtube".to_string());
                                    }
                                }
                                if let Some(auth) = json.get("author_name").and_then(|v| v.as_str())
                                {
                                    if !auth.trim().is_empty() {
                                        author = Some(auth.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        if let Some(image) = payload_images
            .as_ref()
            .and_then(|images| images.first())
            .filter(|image| !image.src.trim().is_empty())
        {
            cover_image_url = Some(image.src.clone());
            cover_image_source = Some("browser_extension".to_string());
        }

        let is_title_url = title.trim().is_empty()
            || title.starts_with("http://")
            || title.starts_with("https://")
            || title == payload.url
            || (title.contains('.')
                && !title.contains(' ')
                && (title.contains('/')
                    || title.contains("youtu.be")
                    || title.contains("youtube.com")));

        // When the extension already supplied article text, do not block the
        // import on a second network request just to discover preview metadata.
        // This was a major source of "Failed to fetch"/"Network failed" reports
        // on long Wikipedia imports.
        if is_title_url && payload_content.is_empty() {
            if let Ok(preview) =
                crate::commands::document::fetch_web_page_preview(payload.url.clone()).await
            {
                if let Some(fetched_title) = preview.get("title").and_then(|t| t.as_str()) {
                    if !fetched_title.trim().is_empty() {
                        title = fetched_title.to_string();
                    }
                }
                if let Some(image_url) = preview.get("image").and_then(|i| i.as_str()) {
                    if !image_url.trim().is_empty() {
                        cover_image_url = Some(image_url.to_string());
                        cover_image_source = Some("web".to_string());
                    }
                }
            }
        } else if payload_content.is_empty() && cover_image_url.is_none() {
            if let Ok(preview) =
                crate::commands::document::fetch_web_page_preview(payload.url.clone()).await
            {
                if let Some(image_url) = preview.get("image").and_then(|i| i.as_str()) {
                    if !image_url.trim().is_empty() {
                        cover_image_url = Some(image_url.to_string());
                        cover_image_source = Some("web".to_string());
                    }
                }
            }
        }
    }

    // For YouTube, we skip fetching raw HTML content as it's not useful for reading
    let content = if payload_content.is_empty() {
        if matches!(file_type, FileType::Youtube) {
            String::new()
        } else {
            // HTML imports are resolved above. This branch remains for
            // non-HTML import types and intentionally leaves them empty when
            // no content was supplied.
            String::new()
        }
    } else {
        payload_content.clone()
    };

    let category = if matches!(file_type, FileType::Youtube) {
        Some("YouTube Videos".to_string())
    } else {
        None
    };
    let is_html = matches!(file_type, FileType::Html);
    let content_len = content.len();
    let mut metadata = if is_html {
        let mut metadata = build_browser_import_metadata_with_article(
            payload,
            import_article_html.clone(),
            payload_images.clone(),
        );
        metadata.browser_import_mode = Some(import_mode.to_string());
        Some(metadata)
    } else if matches!(file_type, FileType::Youtube) {
        Some(crate::models::DocumentMetadata {
            author: author.clone(),
            source: Some("youtube".to_string()),
            fetched_at: Some(chrono::Utc::now()),
            site_name: Some("YouTube".to_string()),
            ..Default::default()
        })
    } else {
        None
    };

    if is_html {
        if let Some(ref mut meta) = metadata {
            if meta.author.is_none() && author.is_some() {
                meta.author = author;
            }
        }
    }

    let document = Document {
        id: uuid::Uuid::new_v4().to_string(),
        collection_id: collection_id.clone(),
        title,
        file_path: normalized_url,
        file_type,
        content: Some(content),
        content_hash: None,
        total_pages: None,
        current_page: None,
        current_scroll_percent: None,
        current_cfi: None,
        current_view_state: None,
        position_json: None,
        progress_percent: Some(0.0),
        category,
        tags: payload.tags.clone().unwrap_or_default(),
        date_added: chrono::Utc::now(),
        date_modified: chrono::Utc::now(),
        date_last_reviewed: None,
        extract_count: 0,
        learning_item_count: 0,
        priority_rating: payload.priority.unwrap_or(0),
        priority_slider: payload.priority.unwrap_or(0),
        priority_score: payload.priority.unwrap_or(0) as f64,
        priority_explicitly_set: payload.priority.is_some(),
        is_archived: false,
        is_favorite: false,
        is_dismissed: false,
        metadata,
        cover_image_url,
        cover_image_source,
        next_reading_date: None,
        reading_count: 0,
        stability: None,
        difficulty: None,
        reps: None,
        total_time_spent: None,
        consecutive_count: None,
        interval_modifier: 1.0,
        first_reviewed_at: None,
    };

    let created = state.repo.create_document(&document).await?;
    info!(
        "Created document for URL: {} with id: {}",
        payload.url, created.id
    );

    let _ = state.app_handle.emit(
        "browser-sync://document-saved",
        DocumentSavedEvent {
            document_id: created.id.clone(),
            title: created.title.clone(),
            url: payload.url.clone(),
        },
    );

    // Background: attempt readability extraction for richer content.
    // This does not block the response to the extension.
    // A strong extension capture is already the page the user was viewing.
    // Refetching it can produce a longer but much noisier Readability result
    // (notably Wikipedia navigation/link dumps), so only enrich genuinely
    // sparse imports such as bare link saves.
    if is_html && content_len < 500 && import_mode == "raw-fallback" {
        spawn_browser_document_enrichment(
            state.repo.clone(),
            created.id.clone(),
            created.date_modified,
            payload.url.clone(),
            content_len,
        );
    }

    Ok(ExtensionResponse {
        success: true,
        document_id: Some(created.id),
        extract_id: None,
        error: None,
    })
}

/// Failure modes of an extension X-thread capture. `Retrieval` carries the
/// typed [`ThreadError`] so the extension can surface the reason (post
/// unavailable, rate limited, network) instead of a generic 500.
#[derive(Debug)]
enum XThreadCaptureError {
    Retrieval(crate::threadreader::ThreadError),
    Persist(AppError),
}

impl From<AppError> for XThreadCaptureError {
    fn from(e: AppError) -> Self {
        Self::Persist(e)
    }
}

/// Resolve, enrich, and persist an extension X-thread capture — the inner
/// path of [`handle_x_thread_request`], with the retrieval pipeline injected
/// so tests run against a mock source. Dedupes by canonical status URL (the
/// resolved thread's `root_url`, then the normalized/raw payload URL) so
/// repeat captures and in-app imports of the same thread land on one
/// document.
async fn capture_x_thread_document<F, Fut>(
    repo: &Repository,
    url: &str,
    resolve: F,
) -> Result<Document, XThreadCaptureError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<crate::twitter::TwitterThread, crate::threadreader::ThreadError>>,
{
    let thread = resolve(url.to_string())
        .await
        .map_err(XThreadCaptureError::Retrieval)?;

    let canonical_url = thread.root_url.clone();
    let normalized = normalize_browser_source_url(url);
    let existing = match repo.find_document_by_url(&canonical_url).await {
        Ok(Some(doc)) => Some(doc),
        _ => match repo.find_document_by_url(&normalized).await {
            Ok(Some(doc)) => Some(doc),
            _ if normalized != url => repo.find_document_by_url(url).await.ok().flatten(),
            _ => None,
        },
    };
    if let Some(doc) = existing {
        info!(
            "X thread already saved for URL: {}, returning existing doc",
            url
        );
        return Ok(doc);
    }

    let collection_id = resolve_browser_import_collection_id(repo).await;
    let document = crate::twitter::build_twitter_thread_document(&thread, Some(collection_id));
    let created = repo
        .create_document(&document)
        .await
        .map_err(XThreadCaptureError::Persist)?;
    info!(
        "Created X thread document for URL: {} with id: {}",
        url, created.id
    );
    Ok(created)
}

/// Handle an X post/thread capture: URL-only requests routed here by
/// `classify_extension_request` for any X status URL. The server performs the
/// full retrieval (ThreadReaderApp-first, same path as `get_twitter_thread`)
/// plus enrichment inline — extension captures have no open viewer to run the
/// background enrichment step, so one capture ack = one complete document —
/// then persists exactly like an in-app `import_twitter_thread` and notifies
/// the library like every other capture.
async fn handle_x_thread_request(
    state: &ServerState,
    payload: &ExtensionRequest,
) -> Result<ExtensionResponse, XThreadCaptureError> {
    let document = capture_x_thread_document(&state.repo, &payload.url, |url| async move {
        crate::twitter::resolve_and_enrich_twitter_thread(&url).await
    })
    .await?;

    let _ = state.app_handle.emit(
        "browser-sync://document-saved",
        DocumentSavedEvent {
            document_id: document.id.clone(),
            title: document.title.clone(),
            url: payload.url.clone(),
        },
    );

    Ok(ExtensionResponse {
        success: true,
        document_id: Some(document.id),
        extract_id: None,
        error: None,
    })
}

/// Typed error response for a failed X-thread retrieval: the HTTP status
/// names the failure class, and the body carries a typed `errorType` plus a
/// human-readable `error` naming the reason, so the extension's failure
/// notification can say why the capture failed.
fn x_thread_error_response(e: &crate::threadreader::ThreadError) -> Response {
    use crate::threadreader::ThreadError;
    let (status, reason, message, kind) = match e {
        ThreadError::InvalidUrl(m) => (
            StatusCode::BAD_REQUEST,
            "Invalid X post URL",
            m,
            "invalid_url",
        ),
        ThreadError::RateLimited(m) => (
            StatusCode::TOO_MANY_REQUESTS,
            "Rate limited while loading this X thread",
            m,
            "rate_limited",
        ),
        ThreadError::ThreadUnavailable(m) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "This X post is unavailable",
            m,
            "thread_unavailable",
        ),
        ThreadError::NetworkError(m) => (
            StatusCode::BAD_GATEWAY,
            "Network error while loading this X thread",
            m,
            "network_error",
        ),
        ThreadError::ThreadReaderUnavailable(m) => (
            StatusCode::BAD_GATEWAY,
            "Could not load this X thread",
            m,
            "thread_reader_unavailable",
        ),
        ThreadError::Auth(m) => (
            StatusCode::FORBIDDEN,
            "X rejected anonymous access to this X thread",
            m,
            "auth",
        ),
    };
    (
        status,
        Json(serde_json::json!({
            "success": false,
            "error": format!("{}: {}", reason, message),
            "errorType": kind,
        })),
    )
        .into_response()
}

/// Handle extract save request
async fn handle_extract_request(
    state: &ServerState,
    payload: &ExtensionRequest,
) -> Result<ExtensionResponse, AppError> {
    // Extracts attach to a document; land both in the user's active collection
    // so they're visible in the library they're looking at.
    let collection_id = resolve_browser_import_collection_id(&state.repo).await;
    // Find or create document for this URL
    let normalized_url = normalize_browser_source_url(&payload.url);
    let existing = match state.repo.find_document_by_url(&normalized_url).await {
        Ok(Some(doc)) => Some(doc),
        _ if normalized_url != payload.url => state
            .repo
            .find_document_by_url(&payload.url)
            .await
            .ok()
            .flatten(),
        _ => None,
    };
    let document_id = if let Some(doc) = existing {
        let document_id = doc.id.clone();
        let missing_content = doc
            .content
            .as_deref()
            .map(str::trim)
            .map(str::is_empty)
            .unwrap_or(true);
        if missing_content && matches!(doc.file_type, FileType::Html) {
            // An extract is a selection, not a page capture. Leave the parent
            // body untouched and let the safe page-level enrichment path
            // obtain document content from the source URL.
            spawn_browser_document_enrichment(
                state.repo.clone(),
                document_id.clone(),
                doc.date_modified,
                payload.url.clone(),
                0,
            );
        }
        document_id
    } else {
        let inferred_file_type = infer_extension_file_type(payload);
        let metadata = if matches!(inferred_file_type, FileType::Html) {
            Some(build_browser_extract_parent_metadata(payload))
        } else {
            None
        };
        let document = Document {
            id: uuid::Uuid::new_v4().to_string(),
            collection_id: collection_id.clone(),
            title: payload.title.clone(),
            file_path: normalized_url,
            file_type: inferred_file_type,
            // The selection is persisted below as an extract. Never promote
            // it into the parent page body; background enrichment may fill
            // the parent with a page-level readable capture.
            content: Some(String::new()),
            content_hash: None,
            total_pages: None,
            current_page: None,
            current_scroll_percent: None,
            current_cfi: None,
            current_view_state: None,
            position_json: None,
            progress_percent: Some(0.0),
            category: None,
            tags: payload.tags.clone().unwrap_or_default(),
            date_added: chrono::Utc::now(),
            date_modified: chrono::Utc::now(),
            date_last_reviewed: None,
            extract_count: 0,
            learning_item_count: 0,
            priority_rating: payload.priority.unwrap_or(0),
            priority_slider: payload.priority.unwrap_or(0),
            priority_score: payload.priority.unwrap_or(0) as f64,
            priority_explicitly_set: payload.priority.is_some(),
            is_archived: false,
            is_favorite: false,
            is_dismissed: false,
            metadata,
            cover_image_url: None,
            cover_image_source: None,
            next_reading_date: None,
            reading_count: 0,
            stability: None,
            difficulty: None,
            reps: None,
            total_time_spent: None,
            consecutive_count: None,
            interval_modifier: 1.0,
            first_reviewed_at: None,
        };

        let created = state.repo.create_document(&document).await?;
        info!(
            "Created document for extract URL: {} with id: {}",
            payload.url, created.id
        );
        if matches!(created.file_type, FileType::Html) {
            spawn_browser_document_enrichment(
                state.repo.clone(),
                created.id.clone(),
                created.date_modified,
                payload.url.clone(),
                created.content.as_deref().map(str::len).unwrap_or(0),
            );
        }
        created.id
    };

    let selection_context = build_extension_selection_context(payload, &document_id);
    let notes = build_extension_extract_notes(payload);
    let memory_state = extract_memory_state_from_fsrs(payload.fsrs_data.as_ref());

    let extract = Extract {
        id: uuid::Uuid::new_v4().to_string(),
        collection_id: collection_id.clone(),
        document_id: document_id.clone(),
        content: payload.text.clone(),
        html_content: payload.html_content.clone(),
        source_url: Some(payload.url.clone()),
        page_title: Some(payload.title.clone()),
        page_number: None,
        selection_context,
        highlight_color: None,
        notes,
        progressive_disclosure_level: 0,
        max_disclosure_level: 3,
        progressive_summaries: None,
        date_created: chrono::Utc::now(),
        date_modified: chrono::Utc::now(),
        tags: payload.tags.clone().unwrap_or_default(),
        category: None,
        memory_state,
        next_review_date: None,
        last_review_date: None,
        review_count: 0,
        reps: 0,
        source_hash: None,
        priority_score: 0.0,
        is_dismissed: false,
        total_time_spent: None,
    };

    let created = state.repo.create_extract(&extract).await?;
    info!(
        "Created extract for document: {} with extract id: {}",
        document_id, created.id
    );

    let _ = state.app_handle.emit(
        "browser-sync://extract-saved",
        ExtractSavedEvent {
            extract_id: created.id.clone(),
            document_id: document_id.clone(),
            url: payload.url.clone(),
            target_type: "extract".to_string(),
            target_id: created.id.clone(),
        },
    );

    Ok(ExtensionResponse {
        success: true,
        document_id: Some(document_id),
        extract_id: Some(created.id),
        error: None,
    })
}

fn build_extension_selection_context(payload: &ExtensionRequest, document_id: &str) -> Option<serde_json::Value> {
    let mut map = serde_json::Map::new();

    if let Some(context) = payload.context.as_ref() {
        map.insert("context".to_string(), json!(context));
    }
    if let Some(analysis) = payload.analysis.as_ref() {
        map.insert("analysis".to_string(), analysis.clone());
    }
    if let Some(fsrs_data) = payload.fsrs_data.as_ref() {
        map.insert("fsrs_data".to_string(), fsrs_data.clone());
    }

    let capture_context = normalize_browser_capture_context(payload);
    let (capture_provenance, organization) = queued_browser_organization(
        "extract",
        &payload.text,
        &capture_context,
        payload.tags.as_deref().unwrap_or(&[]),
        Some(document_id),
    );
    if let Some(value) = capture_context {
        map.insert("browserCaptureContext".to_string(), value);
    }
    if let Some(value) = capture_provenance {
        map.insert("captureProvenance".to_string(), value);
    }
    if let Some(value) = organization {
        map.insert("organization".to_string(), value);
    }

    if map.is_empty() {
        None
    } else {
        map.insert("source".to_string(), json!("browser_extension"));
        map.insert(
            "saved_at".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
        Some(serde_json::Value::Object(map))
    }
}

fn build_extension_extract_notes(payload: &ExtensionRequest) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();

    if let Some(context) = payload.context.as_ref() {
        let trimmed = context.trim();
        if !trimmed.is_empty() {
            sections.push(format!("Context:\n{}", trimmed));
        }
    }

    if let Some(analysis) = payload.analysis.as_ref() {
        if let Some(summary) = analysis.get("summary").and_then(|v| v.as_str()) {
            let trimmed = summary.trim();
            if !trimmed.is_empty() {
                sections.push(format!("Summary:\n{}", trimmed));
            }
        }

        if let Some(responses) = analysis.get("responses") {
            let rendered = render_analysis_block(responses);
            if !rendered.is_empty() {
                sections.push(format!("Responses:\n{}", rendered));
            }
        }

        if let Some(threads) = analysis.get("threads") {
            let rendered = render_analysis_block(threads);
            if !rendered.is_empty() {
                sections.push(format!("Threads:\n{}", rendered));
            }
        }
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

fn render_analysis_block(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Array(items) => {
            let lines: Vec<String> = items
                .iter()
                .filter_map(|item| match item {
                    serde_json::Value::String(s) => {
                        let trimmed = s.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(format!("- {}", trimmed))
                        }
                    }
                    other => serde_json::to_string_pretty(other)
                        .ok()
                        .map(|s| format!("- {}", s)),
                })
                .collect();
            lines.join("\n")
        }
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

fn extract_memory_state_from_fsrs(
    fsrs_data: Option<&serde_json::Value>,
) -> Option<crate::models::MemoryState> {
    let fsrs = fsrs_data?;
    let stability = fsrs.get("initial_stability").and_then(|v| v.as_f64())?;
    let difficulty = fsrs.get("initial_difficulty").and_then(|v| v.as_f64())?;
    Some(crate::models::MemoryState {
        stability,
        difficulty,
        stability_fast: None,
    })
}

/// Fetch page content from URL
async fn fetch_page_content(url: &str) -> Result<String, AppError> {
    crate::security::validate_url_not_private(url)
        .map_err(|e| AppError::IntegrationError(format!("URL not allowed: {}", e)))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| AppError::IntegrationError(format!("Failed to create HTTP client: {}", e)))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::IntegrationError(format!("Failed to fetch URL: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::IntegrationError(format!(
            "HTTP error: {}",
            response.status()
        )));
    }

    let html = response
        .text()
        .await
        .map_err(|e| AppError::IntegrationError(format!("Failed to read response: {}", e)))?;

    Ok(extract_text_from_html(&html))
}

/// Extract readable text from HTML
fn extract_text_from_html(html: &str) -> String {
    crate::processor::html::extract_text_from_html_fragment(html)
}

/// Fetch URL and extract readable article content using the readability algorithm.
/// Returns structured readable content, or an error if extraction fails.
#[derive(Debug)]
struct ReadableArticle {
    html: String,
    text: String,
    images: Vec<DocumentImageAsset>,
}

async fn fetch_readable_content(url: &str) -> Result<ReadableArticle, AppError> {
    use readable_readability::Readability;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| AppError::IntegrationError(format!("Failed to create HTTP client: {}", e)))?;

    let response = client.get(url).send().await.map_err(|e| {
        AppError::IntegrationError(format!("Failed to fetch URL for readability: {}", e))
    })?;

    if !response.status().is_success() {
        return Err(AppError::IntegrationError(format!(
            "HTTP error fetching {}: {}",
            url,
            response.status()
        )));
    }

    let html = response
        .text()
        .await
        .map_err(|e| AppError::IntegrationError(format!("Failed to read response body: {}", e)))?;

    // Readability internals are not Send, so we must complete parsing
    // before any .await point. Run synchronously and extract owned data.
    let content = tokio::task::block_in_place(|| {
        let mut readability = Readability::new();
        let (content_node, _metadata) = readability.parse(&html);
        content_node.to_string()
    });

    if content.trim().is_empty() {
        return Err(AppError::IntegrationError(
            "Readability extracted empty content".to_string(),
        ));
    }

    Ok(ReadableArticle {
        text: crate::processor::html::extract_text_from_html_fragment(&content),
        images: extract_images_from_html_fragment(&content, url),
        html: content,
    })
}

async fn is_automation_authorized(state: &ServerState, headers: &HeaderMap) -> bool {
    let maybe_key = state.automation_api_key.lock().await.clone();
    let Some(expected_key) = maybe_key else {
        return false;
    };
    if expected_key.trim().is_empty() {
        return false;
    }

    let provided = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(|value| value.trim().to_string())
        });

    provided
        .map(|provided_key| provided_key == expected_key)
        .unwrap_or(false)
}

fn is_public_browser_extension_endpoint(path: &str, method: &axum::http::Method) -> bool {
    (path == "/" && method == axum::http::Method::POST)
        || (path == "/ai/process" && method == axum::http::Method::POST)
        || (path == "/ai/status" && method == axum::http::Method::GET)
        || (path == "/ai/image-occlusion" && method == axum::http::Method::POST)
        || (path == "/api/image-registry/ingest" && method == axum::http::Method::POST)
        || (path == "/api/theme" && method == axum::http::Method::GET)
}

/// Bounds the *decoded* image. Mirrored in `browser_extension/shared.js` as
/// `TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES`. Base64 encoding plus
/// the surrounding JSON (question, answer, regions, ...) inflates the actual
/// request by roughly a third, so the extension checks the SERIALIZED request
/// against its general transport budget before sending, rather than trusting
/// this decoded-bytes number alone.
const IMAGE_OCCLUSION_DECODED_MAX_BYTES: usize = 7 * 1024 * 1024;

/// Approximate decoded byte size of a base64 payload (`3/4` of encoded length).
fn decoded_base64_size(base64_data: &str) -> usize {
    base64_data.len().saturating_mul(3) / 4
}

async fn handle_image_occlusion_request(
    State(state): State<ServerState>,
    Json(payload): Json<ImageOcclusionRequest>,
) -> Response {
    let bytes = match general_purpose::STANDARD.decode(payload.image_base64.as_bytes()) {
        Ok(bytes) if !bytes.is_empty() && bytes.len() <= IMAGE_OCCLUSION_DECODED_MAX_BYTES => bytes,
        Ok(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Image must be between 1 byte and 7 MB",
            )
        }
        Err(error) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid image payload: {}", error),
            )
        }
    };

    let image_format = match image::guess_format(&bytes) {
        Ok(format) => format,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "Unsupported image format"),
    };
    let decoded = match image::load_from_memory(&bytes) {
        Ok(image) => image,
        Err(error) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Unable to decode image: {}", error),
            )
        }
    };
    let (width, height) = decoded.dimensions();
    let mime_type = payload
        .mime_type
        .filter(|mime| mime.starts_with("image/"))
        .unwrap_or_else(|| match image_format {
            image::ImageFormat::Png => "image/png".to_string(),
            image::ImageFormat::Gif => "image/gif".to_string(),
            image::ImageFormat::WebP => "image/webp".to_string(),
            _ => "image/jpeg".to_string(),
        });

    let regions: Vec<serde_json::Value> = payload
        .regions
        .iter()
        .filter(|region| {
            region.x.is_finite()
                && region.y.is_finite()
                && region.width.is_finite()
                && region.height.is_finite()
                && region.x >= 0.0
                && region.y >= 0.0
                && region.width > 0.0
                && region.height > 0.0
                && region.x + region.width <= 100.0
                && region.y + region.height <= 100.0
        })
        .map(|region| {
            json!({
                "id": region.id,
                "x": region.x,
                "y": region.y,
                "width": region.width,
                "height": region.height,
                "label": region.label,
            })
        })
        .collect();
    if regions.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Draw at least one valid occlusion region",
        );
    }

    let question = payload.question.trim();
    if question.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "A card prompt is required");
    }

    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let asset = match state
        .repo
        .create_or_get_image_asset(
            &mime_type,
            payload.file_name.as_deref(),
            &bytes,
            &sha256,
            i32::try_from(width).ok(),
            i32::try_from(height).ok(),
        )
        .await
    {
        Ok(asset) => asset,
        Err(error) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to save image: {}", error),
            )
        }
    };

    let mut item = LearningItem::new(ItemType::Qa, question.to_string());
    item.collection_id = resolve_browser_import_collection_id(&state.repo).await;
    item.answer = Some(payload.answer.trim().to_string());
    item.image_asset_ids = vec![asset.id.clone()];
    item.tags = browser_import_tags(payload.tags.as_ref());
    let capture_context = normalize_browser_capture_input(
        payload.capture_context.clone(),
        payload.source_url.as_deref(),
        payload.title.as_deref(),
        None,
    );
    let (capture_provenance, organization) = queued_browser_organization(
        "image-occlusion",
        question,
        &capture_context,
        &item.tags,
        None,
    );
    item.interaction_metadata = Some(json!({
        "interactionType": "image-occlusion",
        "imageOcclusionAssetId": asset.id,
        "imageOcclusionRegions": regions,
        "imageOcclusionPrompt": question,
        "sourceUrl": payload.source_url,
        "browserCaptureContext": capture_context,
        "captureProvenance": capture_provenance,
        "organization": organization,
    }));

    match state.repo.create_learning_item(&item).await {
        Ok(saved) => {
            let _ = state.app_handle.emit(
                "browser-sync://learning-item-saved",
                json!({
                    "target_type": "learning-item",
                    "target_id": saved.id,
                    "item_type": "image-occlusion",
                }),
            );
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "saved_id": saved.id,
                    "asset_id": asset.id,
                    "regions": payload.regions.len(),
                })),
            )
                .into_response()
        }
        Err(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to save image occlusion card: {}", error),
        ),
    }
}

/// Ingest an image captured by the browser extension, then hand the asset to
/// the global desktop composer. Keeping this endpoint separate from the old
/// `/ai/image-occlusion` route means browser capture never creates a partial
/// learning item before the author reviews the proposed masks.
async fn handle_image_registry_ingest(
    State(state): State<ServerState>,
    Json(payload): Json<ImageRegistryIngestRequest>,
) -> Response {
    handle_image_registry_ingest_internal(
        &state,
        ImageRegistryIngestPayload {
            image_base64: Some(payload.image_base64),
            data_url: None,
            image_url: None,
            mime_type: payload.mime_type,
            file_name: payload.file_name,
            source_url: payload.source_url,
            title: payload.title,
            alt: payload.alt,
            caption: payload.caption,
            domain: payload.domain,
            tags: None,
            capture_context: payload.capture_context,
            extension_version: None,
            open_composer: payload.open_composer,
        },
    )
    .await
}

fn decode_image_data_url(data_url: &str) -> crate::error::Result<(String, Vec<u8>)> {
    let (metadata, encoded) = data_url.split_once(',').ok_or_else(|| {
        crate::error::PlethoraError::InvalidInput("Invalid image data URL".to_string())
    })?;
    let metadata = metadata.strip_prefix("data:").ok_or_else(|| {
        crate::error::PlethoraError::InvalidInput("Invalid image data URL".to_string())
    })?;
    if !metadata.split(';').any(|part| part.eq_ignore_ascii_case("base64")) {
        return Err(crate::error::PlethoraError::InvalidInput(
            "Image data URL must use base64 encoding".to_string(),
        ));
    }
    let mime_type = metadata
        .split(';')
        .next()
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_string();
    let bytes = general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|error| {
            crate::error::PlethoraError::InvalidInput(format!("Invalid image payload: {error}"))
        })?;
    Ok((mime_type, bytes))
}

fn image_capture_context(payload: &ImageRegistryIngestPayload) -> Option<serde_json::Value> {
    let mut object = payload
        .capture_context
        .as_ref()
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(value) = payload.source_url.as_deref().filter(|value| !value.trim().is_empty()) {
        object.insert("sourceUrl".to_string(), json!(value));
    }
    if let Some(value) = payload.title.as_deref().filter(|value| !value.trim().is_empty()) {
        object.insert("pageTitle".to_string(), json!(value));
    }
    if let Some(value) = payload.domain.as_deref().filter(|value| !value.trim().is_empty()) {
        object.insert("domain".to_string(), json!(value));
    }
    if let Some(value) = payload.alt.as_deref().filter(|value| !value.trim().is_empty()) {
        object.insert("alt".to_string(), json!(value));
    }
    if let Some(value) = payload.caption.as_deref().filter(|value| !value.trim().is_empty()) {
        object.insert("caption".to_string(), json!(value));
    }
    if let Some(value) = payload
        .extension_version
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        object.insert("extensionVersion".to_string(), json!(value));
    }
    let url = payload.source_url.as_deref().unwrap_or_default().to_string();
    let synthetic = ExtensionRequest {
        url,
        title: payload.title.clone().unwrap_or_default(),
        text: String::new(),
        html_content: None,
        extracted_images: None,
        r#type: "image".to_string(),
        source: "browser_extension".to_string(),
        timestamp: None,
        context: None,
        capture_context: Some(serde_json::Value::Object(object)),
        extension_version: payload.extension_version.clone(),
        tags: payload.tags.clone(),
        priority: None,
        analysis: None,
        fsrs_data: None,
        test: None,
    };
    normalize_browser_capture_context(&synthetic)
}

async fn handle_image_registry_ingest_internal(
    state: &ServerState,
    payload: ImageRegistryIngestPayload,
) -> Response {
    let (asset_result, effective_mime) = if let Some(base64_data) = payload.image_base64.as_deref() {
        let decoded_size = decoded_base64_size(base64_data);
        if decoded_size == 0 || decoded_size > IMAGE_OCCLUSION_DECODED_MAX_BYTES {
            return error_response(StatusCode::PAYLOAD_TOO_LARGE, "Image must be between 1 byte and 7 MB");
        }
        (
            crate::commands::image_registry::ingest_image_asset_from_base64_with_status(
                base64_data,
                payload.mime_type.clone(),
                payload.file_name.clone(),
                &state.repo,
            )
            .await,
            payload.mime_type.clone(),
        )
    } else if let Some(data_url) = payload.data_url.as_deref() {
        let (mime_type, bytes) = match decode_image_data_url(data_url) {
            Ok(value) => value,
            Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
        };
        if bytes.is_empty() || bytes.len() > IMAGE_OCCLUSION_DECODED_MAX_BYTES {
            return error_response(StatusCode::PAYLOAD_TOO_LARGE, "Image must be between 1 byte and 7 MB");
        }
        let encoded = general_purpose::STANDARD.encode(bytes);
        (
            crate::commands::image_registry::ingest_image_asset_from_base64_with_status(
                &encoded,
                payload.mime_type.clone().or(Some(mime_type.clone())),
                payload.file_name.clone(),
                &state.repo,
            )
            .await,
            Some(mime_type),
        )
    } else if let Some(image_url) = payload.image_url.as_deref() {
        if image_url.starts_with("data:") {
            let (mime_type, bytes) = match decode_image_data_url(image_url) {
                Ok(value) => value,
                Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
            };
            if bytes.is_empty() || bytes.len() > IMAGE_OCCLUSION_DECODED_MAX_BYTES {
                return error_response(StatusCode::PAYLOAD_TOO_LARGE, "Image must be between 1 byte and 7 MB");
            }
            let encoded = general_purpose::STANDARD.encode(bytes);
            (
                crate::commands::image_registry::ingest_image_asset_from_base64_with_status(
                    &encoded,
                    payload.mime_type.clone().or(Some(mime_type.clone())),
                    payload.file_name.clone(),
                    &state.repo,
                )
                .await,
                Some(mime_type),
            )
        } else {
            (
                crate::commands::image_registry::ingest_remote_image_asset_inner(
                    image_url,
                    payload.file_name.clone(),
                    payload.source_url.clone(),
                    &state.repo,
                )
                .await
                .map(|asset| (asset, false)),
                payload.mime_type.clone(),
            )
        }
    } else {
        return error_response(StatusCode::BAD_REQUEST, "Missing image payload");
    };

    let (asset, is_duplicate) = match asset_result {
        Ok((asset, is_duplicate)) => (asset, is_duplicate),
        Err(error) => {
            let status = match error {
                crate::error::PlethoraError::InvalidInput(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return error_response(status, &error.to_string());
        }
    };

    let capture_context = image_capture_context(&payload);
    let tags = browser_import_tags(payload.tags.as_ref());
    let content = [
        payload.title.as_deref(),
        payload.alt.as_deref(),
        payload.caption.as_deref(),
        payload.file_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" — ");
    let content = if content.trim().is_empty() {
        "browser image".to_string()
    } else {
        content
    };
    let (capture_provenance, organization) = queued_browser_organization(
        "image-registry",
        &content,
        &capture_context,
        &tags,
        None,
    );

    // Persist bounded capture evidence + smart-organization state on the asset
    // so the desktop app's tagging queue can pick it up later.
    let metadata = json!({
        "browserCaptureContext": capture_context,
        "captureProvenance": capture_provenance,
        "organization": organization,
    });
    if let Ok(serialized) = serde_json::to_string(&metadata) {
        let _ = state.repo.update_image_asset_metadata(&asset.id, &serialized).await;
    }

    let deep_link = format!(
        "plethora://occlusion/create?assetId={}",
        urlencoding::encode(&asset.id)
    );

    let _ = state.app_handle.emit(
        "browser-sync://image-asset-saved",
        json!({
            "assetId": asset.id,
            "asset_id": asset.id,
            "sourceUrl": payload.source_url,
            "title": payload.title,
            "mimeType": effective_mime.unwrap_or(asset.mime_type.clone()),
            "isDuplicate": is_duplicate,
            "captureContext": capture_context,
            "captureProvenance": capture_provenance,
            "organization": organization,
        }),
    );

    if payload.open_composer {
        if let Some(window) = state.app_handle.get_webview_window("main") {
            #[cfg(desktop)]
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = state.app_handle.emit(
            "plethora:create-image-occlusion",
            json!({
                "assetId": asset.id,
                "sourceUrl": payload.source_url,
                "title": payload.title,
                "captureContext": payload.capture_context,
                "deepLink": deep_link,
            }),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "assetId": asset.id,
            "deepLink": deep_link,
            "composerOpened": payload.open_composer,
            "isDuplicate": is_duplicate,
            "organization": organization,
        })),
    )
        .into_response()
}

/// Middleware that keeps browser-extension routes local and credential-free
/// while requiring the configured API key for automation and data APIs.
async fn require_api_key(
    State(state): State<ServerState>,
    headers: HeaderMap,
    request: Request<Body>,
    next: Next,
) -> Response {
    // Public proxy endpoints — no API key needed
    if request.uri().path() == "/api/podcast/search" {
        return next.run(request).await;
    }

    // The server only binds to the configured loopback host. These are the
    // routes called by the bundled browser extension, which does not have
    // access to the desktop app's automation credential.
    if is_public_browser_extension_endpoint(request.uri().path(), request.method()) {
        return next.run(request).await;
    }

    if !is_automation_authorized(&state, &headers).await {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized — API key required" })),
        )
            .into_response();
    }

    next.run(request).await
}

fn map_item_type(value: Option<&str>) -> ItemType {
    match value.unwrap_or("flashcard").to_ascii_lowercase().as_str() {
        "cloze" => ItemType::Cloze,
        "qa" => ItemType::Qa,
        "basic" => ItemType::Basic,
        _ => ItemType::Flashcard,
    }
}

async fn handle_automation_create_card(
    State(state): State<ServerState>,
    Json(payload): Json<AutomationCreateCardRequest>,
) -> Response {
    if payload.question.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "question is required" })),
        )
            .into_response();
    }

    let mut item = LearningItem::new(
        map_item_type(payload.item_type.as_deref()),
        payload.question,
    );
    item.answer = payload.answer;
    item.tags = payload.tags.unwrap_or_default();

    match state.repo.create_learning_item(&item).await {
        Ok(created) => (
            StatusCode::OK,
            Json(AutomationCreateCardResponse {
                id: created.id,
                due_date: created.due_date.to_rfc3339(),
                interval: created.interval,
            }),
        )
            .into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

async fn handle_automation_due_count(State(state): State<ServerState>) -> Response {
    let now = chrono::Utc::now();
    match state.repo.get_due_learning_items(&now, None).await {
        Ok(items) => (
            StatusCode::OK,
            Json(AutomationDueCountResponse {
                due_count: items.len(),
            }),
        )
            .into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

async fn handle_automation_submit_review(
    State(state): State<ServerState>,
    Json(payload): Json<AutomationSubmitReviewRequest>,
) -> Response {
    if payload.rating < 1 || payload.rating > 4 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "rating must be between 1 and 4" })),
        )
            .into_response();
    }

    match apply_review(
        &state.repo,
        &payload.item_id,
        payload.rating,
        payload.time_taken.unwrap_or(0),
        None,
        0.9,
        None,
        false,
        None,
        None,
        false,
        None,
    )
    .await
    {
        Ok(item) => (
            StatusCode::OK,
            Json(json!({
                "id": item.id,
                "dueDate": item.due_date.to_rfc3339(),
                "interval": item.interval,
                "reviewCount": item.review_count
            })),
        )
            .into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

/// Create error response
/// Give a diagnosable JSON body to a request-body-too-large rejection,
/// whichever layer produced it.
///
/// `RequestBodyLimitLayer` rejects an oversized request in one of two ways,
/// and both previously returned an EMPTY body:
///   - immediately, from the `Content-Length` header, before the body is read
///     (the path a browser `fetch()` call always takes, since it sets
///     `Content-Length` for a string/Blob body) — this is what produced the
///     bare `Server error: 413` reported in issue #40;
///   - mid-read, if the header was absent or understated, surfaced through
///     axum's body extractors once the streamed limit is hit.
/// This wraps both: it answers the `Content-Length` case itself before
/// `RequestBodyLimitLayer` gets a chance to (it must be registered as the
/// OUTER layer — added to the router after `RequestBodyLimitLayer`, since
/// axum applies `.layer()` calls outermost-last), and rewrites the inner
/// layer's own bare-413 response for the read-time case, where the exact
/// size is not available and the message says so.
async fn annotate_oversized_request(req: Request<Body>, next: Next) -> Response {
    let endpoint = req.uri().path().to_string();
    let declared_len = req
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    if let Some(len) = declared_len {
        if len > MAX_PAYLOAD_SIZE as u64 {
            return payload_too_large_response(Some(len), &endpoint);
        }
    }

    let response = next.run(req).await;
    if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
        return payload_too_large_response(None, &endpoint);
    }
    response
}

fn payload_too_large_response(received_bytes: Option<u64>, endpoint: &str) -> Response {
    let message = match received_bytes {
        Some(received) => format!(
            "Request body is {} bytes, over the {} byte limit for {}.",
            received, MAX_PAYLOAD_SIZE, endpoint
        ),
        None => format!(
            "Request body exceeds the {} byte limit for {}.",
            MAX_PAYLOAD_SIZE, endpoint
        ),
    };
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        Json(json!({
            "success": false,
            "error": message,
            "received_bytes": received_bytes,
            "limit_bytes": MAX_PAYLOAD_SIZE,
            "endpoint": endpoint,
        })),
    )
        .into_response()
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(ExtensionResponse {
            success: false,
            document_id: None,
            extract_id: None,
            error: Some(message.to_string()),
        }),
    )
        .into_response()
}

/// Calculate reading time in minutes (average 200 words per minute)
fn calculate_reading_time(content: &str) -> u32 {
    let word_count = content.split_whitespace().count();
    ((word_count as f64 / 200.0).ceil() as u32).max(1)
}

/// Calculate word count
fn calculate_word_count(content: &str) -> u32 {
    content.split_whitespace().count() as u32
}

/// Estimate complexity score (1-10) based on simple heuristics
fn estimate_complexity(content: &str) -> u8 {
    let words: Vec<&str> = content.split_whitespace().collect();
    let word_count = words.len();

    if word_count == 0 {
        return 1;
    }

    // Average word length as a simple proxy for complexity
    let avg_word_len: f64 = words.iter().map(|w| w.len()).sum::<usize>() as f64 / word_count as f64;

    // Sentence count (rough estimate)
    let sentence_count =
        content.matches('.').count() + content.matches('!').count() + content.matches('?').count();
    let avg_sentence_len = if sentence_count > 0 {
        word_count / sentence_count
    } else {
        word_count
    };

    // Score based on word length and sentence length
    let complexity =
        ((avg_word_len - 3.0) * 1.5 + (avg_sentence_len as f64 - 10.0) * 0.2).clamp(1.0, 10.0);
    complexity as u8
}

/// Handle AI request from browser extension
async fn handle_ai_request(
    State(state): State<ServerState>,
    Json(payload): Json<AIRequest>,
) -> Response {
    info!(
        "Received AI request: operation={}, content_length={}",
        payload.operation,
        payload.content.len()
    );

    // Always read the managed AI state. The browser server may start before
    // keychain loading finishes, and users can change providers while it is
    // already running. Its startup snapshot is therefore only a fallback.
    let ai_config = {
        let ai_state = state.app_handle.state::<crate::commands::ai::AIState>();
        let config = ai_state
            .config
            .lock()
            .expect("AI config mutex poisoned")
            .clone();
        drop(ai_state);

        match config {
            Some(config) => Some(config),
            None => {
                let config_guard = state.ai_config.lock().await;
                config_guard.clone()
            }
        }
    };

    let config = match ai_config {
        Some(c) => c,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(AIResponse {
                    success: false,
                    summary: None,
                    key_points: None,
                    flashcards: None,
                    questions: None,
                    reading_time_minutes: None,
                    word_count: None,
                    complexity_score: None,
                    error: Some("AI is not configured. Please configure an AI provider in the desktop app settings.".to_string()),
                }),
            ).into_response();
        }
    };

    let provider = match AIProvider::from_config(
        config.default_provider,
        &config.api_keys,
        &config.models,
        &config.local_settings,
    ) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AIResponse {
                    success: false,
                    summary: None,
                    key_points: None,
                    flashcards: None,
                    questions: None,
                    reading_time_minutes: None,
                    word_count: None,
                    complexity_score: None,
                    error: Some(format!("Failed to create AI provider: {}", e)),
                }),
            )
                .into_response();
        }
    };

    // Calculate content stats
    let reading_time = calculate_reading_time(&payload.content);
    let word_count = calculate_word_count(&payload.content);
    let complexity = estimate_complexity(&payload.content);

    let mut response = AIResponse {
        success: true,
        summary: None,
        key_points: None,
        flashcards: None,
        questions: None,
        reading_time_minutes: Some(reading_time),
        word_count: Some(word_count),
        complexity_score: Some(complexity),
        error: None,
    };
    let capture_context = normalize_browser_capture_input(
        payload.capture_context.clone(),
        payload.url.as_deref(),
        payload.title.as_deref(),
        None,
    );

    match payload.operation.as_str() {
        "summarize" => {
            let summarizer = Summarizer::new(provider);
            match summarizer
                .summarize(&payload.content, payload.max_words)
                .await
            {
                Ok(summary) => {
                    response.summary = Some(summary);
                }
                Err(e) => {
                    response.success = false;
                    response.error = Some(format!("Summarization failed: {}", e));
                }
            }
        }
        "key-points" => {
            let summarizer = Summarizer::new(provider);
            match summarizer
                .extract_key_points(&payload.content, payload.count)
                .await
            {
                Ok(points) => {
                    response.key_points = Some(points);
                }
                Err(e) => {
                    response.success = false;
                    response.error = Some(format!("Key points extraction failed: {}", e));
                }
            }
        }
        "flashcards" => {
            let generator = FlashcardGenerator::new(provider);
            let include_qa =
                payload.card_types.is_empty() || payload.card_types.iter().any(|kind| kind == "qa");
            let include_cloze = payload.card_types.is_empty()
                || payload.card_types.iter().any(|kind| kind == "cloze");
            let options = FlashcardGenerationOptions {
                count: payload.count,
                include_cloze,
                include_qa,
                ..Default::default()
            };
            match generator
                .generate_from_content(&payload.content, &options)
                .await
            {
                Ok(cards) => {
                    let mut generated: Vec<GeneratedFlashcard> = cards
                        .into_iter()
                        .map(|c| GeneratedFlashcard {
                            question: c.question,
                            answer: c.answer,
                            card_type: format!("{:?}", c.card_type),
                            saved_id: None,
                        })
                        .collect();

                    if payload.save_flashcards {
                        let collection_id = resolve_browser_import_collection_id(&state.repo).await;
                        for card in &mut generated {
                            let item_type = match card.card_type.as_str() {
                                "Cloze" => ItemType::Cloze,
                                "Qa" => ItemType::Qa,
                                _ => ItemType::Basic,
                            };
                            let mut item =
                                LearningItem::new(item_type.clone(), card.question.clone());
                            item.collection_id = collection_id.clone();
                            item.answer = Some(card.answer.clone());
                            if item_type == ItemType::Cloze {
                                item.cloze_text = Some(card.question.clone());
                            }
                            item.tags = Vec::new();
                            let browser_item_type = if item_type == ItemType::Cloze { "cloze" } else { "qa" };
                            let (capture_provenance, organization) = queued_browser_organization(
                                browser_item_type,
                                &format!("{}\n{}", card.question, card.answer),
                                &capture_context,
                                &item.tags,
                                None,
                            );
                            item.interaction_metadata = Some(json!({
                                "browserCaptureContext": capture_context.clone(),
                                "captureProvenance": capture_provenance,
                                "organization": organization,
                                "sourceUrl": payload.url.clone(),
                            }));
                            match state.repo.create_learning_item(&item).await {
                                Ok(saved) => {
                                    let _ = state.app_handle.emit(
                                        "browser-sync://learning-item-saved",
                                        json!({
                                            "target_type": "learning-item",
                                            "target_id": saved.id,
                                            "item_type": browser_item_type,
                                        }),
                                    );
                                    card.saved_id = Some(saved.id);
                                }
                                Err(error) => {
                                    response.success = false;
                                    response.error = Some(format!(
                                        "Generated flashcards but failed to save one: {}",
                                        error
                                    ));
                                    break;
                                }
                            }
                        }
                    }

                    response.flashcards = Some(generated);
                }
                Err(e) => {
                    response.success = false;
                    response.error = Some(format!("Flashcard generation failed: {}", e));
                }
            }
        }
        "questions" => {
            let qa = QuestionAnswerer::new(provider);
            match qa.generate_questions(&payload.content, payload.count).await {
                Ok(questions) => {
                    response.questions = Some(questions);
                }
                Err(e) => {
                    response.success = false;
                    response.error = Some(format!("Question generation failed: {}", e));
                }
            }
        }
        "all" => {
            // Get all AI features at once - create separate providers for each operation
            let summarizer = Summarizer::new(provider);

            if let Ok(summary) = summarizer
                .summarize(&payload.content, payload.max_words)
                .await
            {
                response.summary = Some(summary);
            }

            if let Ok(points) = summarizer
                .extract_key_points(&payload.content, payload.count)
                .await
            {
                response.key_points = Some(points);
            }

            if let Ok(qa_provider) = AIProvider::from_config(
                config.default_provider,
                &config.api_keys,
                &config.models,
                &config.local_settings,
            ) {
                let qa = QuestionAnswerer::new(qa_provider);
                if let Ok(questions) = qa.generate_questions(&payload.content, 3).await {
                    response.questions = Some(questions);
                }
            }
        }
        _ => {
            response.success = false;
            response.error = Some(format!("Unknown operation: {}", payload.operation));
        }
    }

    info!(
        "Completed AI request: operation={}, success={}, summary={}, flashcards={}, error={}",
        payload.operation,
        response.success,
        response.summary.is_some(),
        response
            .flashcards
            .as_ref()
            .map(|cards| cards.len())
            .unwrap_or(0),
        response.error.as_deref().unwrap_or("none")
    );

    (StatusCode::OK, Json(response)).into_response()
}

/// Handle AI status check from browser extension
async fn handle_ai_status(State(state): State<ServerState>) -> Response {
    let ai_config = {
        let ai_state = state.app_handle.state::<crate::commands::ai::AIState>();
        let config = ai_state
            .config
            .lock()
            .expect("AI config mutex poisoned")
            .clone();
        drop(ai_state);

        match config {
            Some(config) => Some(config),
            None => {
                let config_guard = state.ai_config.lock().await;
                config_guard.clone()
            }
        }
    };

    let response = match ai_config {
        Some(config) => {
            let provider_name = format!("{:?}", config.default_provider);
            let model = match config.default_provider {
                LLMProviderType::OpenAI => Some(config.models.openai_model.clone()),
                LLMProviderType::Anthropic => Some(config.models.anthropic_model.clone()),
                LLMProviderType::OpenRouter => Some(config.models.openrouter_model.clone()),
                LLMProviderType::Ollama => Some(config.models.ollama_model.clone()),
                LLMProviderType::DeepSeek => Some(config.models.deepseek_model.clone()),
            };

            AIStatusResponse {
                configured: true,
                provider: Some(provider_name),
                model,
            }
        }
        None => AIStatusResponse {
            configured: false,
            provider: None,
            model: None,
        },
    };

    (StatusCode::OK, Json(response)).into_response()
}

/// Handle active theme query from browser extension
async fn handle_get_theme() -> Response {
    let (theme_id, colors) = get_active_theme();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "themeId": theme_id,
            "colors": colors
        })),
    )
        .into_response()
}

/// ============================================================================
/// RSS API Handlers
/// ============================================================================
/// Handle RSS feed creation
async fn handle_create_feed(
    State(state): State<ServerState>,
    Json(payload): Json<CreateFeedRequest>,
) -> Response {
    match create_rss_feed_http(
        payload.url,
        payload.title,
        payload.description,
        payload.category,
        payload.update_interval,
        payload.auto_queue,
        &state.repo,
    )
    .await
    {
        Ok(feed) => {
            let unread_count = state
                .repo
                .get_rss_feed_unread_count(&feed.id)
                .await
                .unwrap_or(0);
            let response = FeedResponse { feed, unread_count };
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            error!("Failed to create RSS feed: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle listing all RSS feeds
async fn handle_list_feeds(State(state): State<ServerState>) -> Response {
    match get_rss_feeds_http(&state.repo).await {
        Ok(feeds) => {
            let mut responses = Vec::new();
            for feed in feeds {
                let unread_count = state
                    .repo
                    .get_rss_feed_unread_count(&feed.id)
                    .await
                    .unwrap_or(0);
                responses.push(FeedResponse { feed, unread_count });
            }
            (StatusCode::OK, Json(responses)).into_response()
        }
        Err(e) => {
            error!("Failed to list RSS feeds: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle getting a specific RSS feed
async fn handle_get_feed(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match get_rss_feed_http(&id, &state.repo).await {
        Ok(Some(feed)) => {
            let unread_count = state
                .repo
                .get_rss_feed_unread_count(&feed.id)
                .await
                .unwrap_or(0);
            let response = FeedResponse { feed, unread_count };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(None) => error_response(StatusCode::NOT_FOUND, "Feed not found"),
        Err(e) => {
            error!("Failed to get RSS feed: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle updating an RSS feed
async fn handle_update_feed(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<UpdateFeedRequest>,
) -> Response {
    match update_rss_feed_http(
        &id,
        payload.title,
        payload.description,
        payload.category,
        payload.update_interval,
        payload.auto_queue,
        payload.is_active,
        &state.repo,
    )
    .await
    {
        Ok(feed) => {
            let unread_count = state
                .repo
                .get_rss_feed_unread_count(&feed.id)
                .await
                .unwrap_or(0);
            let response = FeedResponse { feed, unread_count };
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            error!("Failed to update RSS feed: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle deleting an RSS feed
async fn handle_delete_feed(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match delete_rss_feed_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to delete RSS feed: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle getting articles for a feed
async fn handle_get_feed_articles(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    let feed_id = if id == "all" { None } else { Some(id.clone()) };

    match get_rss_articles_http(feed_id.as_deref(), limit, &state.repo).await {
        Ok(articles) => (StatusCode::OK, Json(articles)).into_response(),
        Err(e) => {
            error!("Failed to get RSS articles: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle marking an article as read/unread
async fn handle_mark_article(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let is_read = params
        .get("read")
        .and_then(|r| r.parse::<bool>().ok())
        .unwrap_or(true);

    match mark_rss_article_read_http(&id, is_read, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to mark article: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle toggling article queued status
async fn handle_toggle_article_queued(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match toggle_rss_article_queued_http(&id, &state.repo).await {
        Ok(queued) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "queued": queued})),
        )
            .into_response(),
        Err(e) => {
            error!("Failed to toggle article queued: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle fetching and parsing a feed URL (without subscribing)
async fn handle_fetch_feed_url(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let url = match params.get("url") {
        Some(u) => u.clone(),
        None => return error_response(StatusCode::BAD_REQUEST, "Missing url parameter"),
    };

    if let Err(e) = crate::security::validate_url_not_private(&url) {
        return error_response(StatusCode::BAD_REQUEST, &format!("URL not allowed: {}", e));
    }

    match fetch_rss_feed_url(url).await {
        Ok(parsed_feed) => (StatusCode::OK, Json(parsed_feed)).into_response(),
        Err(e) => {
            error!("Failed to fetch feed URL: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle OPML import
async fn handle_opml_import(
    State(state): State<ServerState>,
    Json(payload): Json<OpmlImportRequest>,
) -> Response {
    let parsed_feeds = match parse_opml_content(&payload.opml_content) {
        Ok(feeds) => feeds,
        Err(e) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Failed to parse OPML: {}", e),
            );
        }
    };

    let mut imported_count = 0;
    let mut errors = Vec::new();

    for feed_data in parsed_feeds {
        let title = feed_data.title.clone();
        match create_rss_feed_http(
            feed_data.url,
            feed_data.title,
            feed_data.description,
            feed_data.category,
            feed_data.update_interval,
            feed_data.auto_queue,
            &state.repo,
        )
        .await
        {
            Ok(_) => imported_count += 1,
            Err(e) => errors.push(format!("Failed to import {}: {}", title, e)),
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "imported": imported_count,
            "errors": errors
        })),
    )
        .into_response()
}

/// Handle OPML export
async fn handle_opml_export(State(state): State<ServerState>) -> Response {
    match get_rss_feeds_http(&state.repo).await {
        Ok(feeds) => {
            let opml_content = generate_opml_content(&feeds);
            let response = OpmlExportResponse { opml_content };
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            error!("Failed to export feeds: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Parsed feed data from OPML
#[derive(Debug)]
struct OpmlFeedData {
    url: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    update_interval: Option<i32>,
    auto_queue: Option<bool>,
}

/// Parse OPML content and extract feed data
fn parse_opml_content(content: &str) -> Result<Vec<OpmlFeedData>, String> {
    use roxmltree::Document;
    use std::collections::HashSet;

    let doc = Document::parse(content).map_err(|e| format!("Failed to parse OPML XML: {}", e))?;

    let mut feeds = Vec::new();
    let mut seen_urls = HashSet::new();

    // Find all outline elements (RSS feeds in OPML)
    for node in doc.descendants() {
        if node.tag_name().name() == "outline" {
            if let Some(url) = node.attribute("xmlUrl") {
                let url = url.trim();
                let normalized_url = if url.starts_with("feed://") {
                    url.strip_prefix("feed://")
                        .map(|rest| format!("https://{}", rest))
                        .unwrap_or_else(|| url.to_string())
                } else if let Some(rest) = url.strip_prefix("feed:") {
                    rest.to_string()
                } else {
                    url.to_string()
                };

                if !(normalized_url.starts_with("http://")
                    || normalized_url.starts_with("https://"))
                {
                    continue;
                }

                if !seen_urls.insert(normalized_url.clone()) {
                    continue;
                }

                let title = node
                    .attribute("title")
                    .or_else(|| node.attribute("text"))
                    .unwrap_or("Unknown Feed")
                    .to_string();

                let mut category = None;
                let mut parent = node.parent();
                while let Some(ancestor) = parent {
                    if ancestor.tag_name().name() == "outline"
                        && ancestor.attribute("xmlUrl").is_none()
                    {
                        category = ancestor
                            .attribute("title")
                            .or_else(|| ancestor.attribute("text"))
                            .map(|value| value.to_string());
                        if category.is_some() {
                            break;
                        }
                    }
                    parent = ancestor.parent();
                }

                feeds.push(OpmlFeedData {
                    url: normalized_url,
                    title,
                    description: node.attribute("description").map(|s| s.to_string()),
                    category,
                    update_interval: None,
                    auto_queue: None,
                });
            }
        }
    }

    Ok(feeds)
}

/// Generate OPML content from feeds
fn generate_opml_content(feeds: &[RssFeed]) -> String {
    let mut opml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Plethora RSS Feeds</title>
    <dateCreated>"#,
    );

    opml.push_str(&chrono::Utc::now().to_rfc3339());
    opml.push_str(
        r#"</dateCreated>
  </head>
  <body>
"#,
    );

    for feed in feeds {
        opml.push_str(r#"    <outline type="rss""#);
        opml.push_str(&format!(" xmlUrl=\"{}\"", feed.url));
        opml.push_str(&format!(" title=\"{}\"", escape_xml(&feed.title)));
        opml.push_str(&format!(" text=\"{}\"", escape_xml(&feed.title)));
        if let Some(desc) = &feed.description {
            opml.push_str(&format!(" description=\"{}\"", escape_xml(desc)));
        }
        if let Some(category) = &feed.category {
            opml.push_str(&format!(" category=\"{}\"", escape_xml(category)));
        }
        opml.push_str("/>\n");
    }

    opml.push_str(
        r#"  </body>
</opml>"#,
    );

    opml
}

/// Escape XML special characters
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Request to get RSS user preferences
#[derive(Debug, Deserialize)]
pub struct GetPreferencesRequest {
    pub feed_id: Option<String>,
    pub user_id: Option<String>,
}

/// Handle getting RSS user preferences
async fn handle_get_preferences(
    State(state): State<ServerState>,
    Query(params): Query<GetPreferencesRequest>,
) -> Response {
    let feed_id = params.feed_id.as_deref();
    let user_id = params.user_id.as_deref();

    match state.repo.get_rss_user_preferences(feed_id, user_id).await {
        Ok(Some(prefs)) => (StatusCode::OK, Json(prefs)).into_response(),
        Ok(None) => {
            let defaults = RssUserPreference {
                id: uuid::Uuid::new_v4().to_string(),
                user_id: user_id.map(|s| s.to_string()),
                feed_id: feed_id.map(|s| s.to_string()),
                keyword_include: None,
                keyword_exclude: None,
                author_whitelist: None,
                author_blacklist: None,
                category_filter: None,
                view_mode: Some("card".to_string()),
                theme_mode: Some("system".to_string()),
                density: Some("normal".to_string()),
                column_count: Some(2),
                show_thumbnails: Some(true),
                excerpt_length: Some(150),
                show_author: Some(true),
                show_date: Some(true),
                show_feed_icon: Some(true),
                sort_by: Some("date".to_string()),
                sort_order: Some("desc".to_string()),
                date_created: chrono::Utc::now().to_rfc3339(),
                date_modified: chrono::Utc::now().to_rfc3339(),
            };
            (StatusCode::OK, Json(defaults)).into_response()
        }
        Err(e) => {
            error!("Failed to get RSS preferences: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle setting RSS user preferences
async fn handle_set_preferences(
    State(state): State<ServerState>,
    Query(params): Query<GetPreferencesRequest>,
    Json(prefs): Json<RssUserPreferenceUpdate>,
) -> Response {
    let feed_id = params.feed_id.as_deref();
    let user_id = params.user_id.as_deref();

    match state
        .repo
        .set_rss_user_preferences(feed_id, user_id, prefs)
        .await
    {
        Ok(updated_prefs) => (StatusCode::OK, Json(updated_prefs)).into_response(),
        Err(e) => {
            error!("Failed to set RSS preferences: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle adding a classifier
async fn handle_add_classifier(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let feed_id = payload
        .get("feed_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let classifier_type = payload
        .get("classifier_type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let value = payload
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sentiment = payload
        .get("sentiment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match add_rss_classifier_http(&feed_id, &classifier_type, &value, &sentiment, &state.repo).await
    {
        Ok(classifier) => (StatusCode::OK, Json(classifier)).into_response(),
        Err(e) => {
            error!("Failed to add classifier: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle listing classifiers
async fn handle_list_classifiers(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let feed_id = params.get("feed_id").map(|s| s.as_str());
    match get_rss_classifiers_http(feed_id, &state.repo).await {
        Ok(classifiers) => (StatusCode::OK, Json(classifiers)).into_response(),
        Err(e) => {
            error!("Failed to list classifiers: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle removing a classifier
async fn handle_remove_classifier(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match remove_rss_classifier_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to remove classifier: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle batch classifier update
async fn handle_batch_update_classifiers(
    State(state): State<ServerState>,
    Json(updates): Json<Vec<crate::commands::rss_features::ClassifierUpdate>>,
) -> Response {
    match update_rss_classifiers_batch_http(updates, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to batch update classifiers: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle marking article as unread
async fn handle_mark_article_unread(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match mark_rss_article_unread_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle marking articles before a date as read
async fn handle_mark_before_date(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let before_date = payload
        .get("before_date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let feed_id = payload.get("feed_id").and_then(|v| v.as_str());
    match mark_rss_articles_before_date_read_http(feed_id, &before_date, &state.repo).await {
        Ok(count) => (StatusCode::OK, Json(serde_json::json!({"marked": count}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle marking articles after a date as read
async fn handle_mark_after_date(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let after_date = payload
        .get("after_date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let feed_id = payload.get("feed_id").and_then(|v| v.as_str());
    match mark_rss_articles_after_date_read_http(feed_id, &after_date, &state.repo).await {
        Ok(count) => (StatusCode::OK, Json(serde_json::json!({"marked": count}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle getting read articles
async fn handle_get_read_articles(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    let offset = params.get("offset").and_then(|o| o.parse::<i32>().ok());
    match get_read_rss_articles_http(limit, offset, &state.repo).await {
        Ok(articles) => (StatusCode::OK, Json(articles)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle river of news
async fn handle_river_of_news(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let folder_id = params.get("folder_id").cloned().unwrap_or_default();
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    match get_river_of_news_http(&folder_id, limit, &state.repo).await {
        Ok(articles) => (StatusCode::OK, Json(articles)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle articles with intelligence filter
async fn handle_articles_with_intelligence(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let feed_id = params.get("feed_id").map(|s| s.as_str());
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    let include_hidden = params
        .get("include_hidden")
        .and_then(|h| h.parse::<bool>().ok())
        .unwrap_or(false);
    match get_rss_articles_with_intelligence_http(feed_id, limit, include_hidden, &state.repo).await
    {
        Ok(articles) => (StatusCode::OK, Json(articles)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle recompute intelligence scores
async fn handle_recompute_scores(State(state): State<ServerState>) -> Response {
    match recompute_all_intelligence_scores_http(&state.repo).await {
        Ok(count) => (
            StatusCode::OK,
            Json(serde_json::json!({"recomputed": count})),
        )
            .into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle search articles
async fn handle_search_articles(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let query = params.get("q").cloned().unwrap_or_default();
    let feed_id = params.get("feed_id").cloned();
    let folder_id = params.get("folder_id").cloned();
    let scope = params.get("scope").cloned();
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    match search_rss_articles_http(
        query,
        feed_id.as_deref(),
        folder_id.as_deref(),
        scope.as_deref(),
        limit,
        &state.repo,
    )
    .await
    {
        Ok(results) => (StatusCode::OK, Json(results)).into_response(),
        Err(e) => {
            error!("Search failed: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle compute clusters
async fn handle_compute_clusters(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let feed_id = payload.get("feed_id").and_then(|v| v.as_str());
    match compute_story_clusters_http(feed_id, &state.repo).await {
        Ok(clusters) => (StatusCode::OK, Json(clusters)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get clusters
async fn handle_get_clusters(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let feed_id = params.get("feed_id").map(|s| s.as_str());
    match get_rss_article_clusters_http(feed_id, &state.repo).await {
        Ok(clusters) => (StatusCode::OK, Json(clusters)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle invalidate clusters
async fn handle_invalidate_clusters(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
) -> Response {
    match invalidate_clusters_for_feed_http(&feed_id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle add tag
async fn handle_add_tag(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match add_tag_http(&name, &state.repo).await {
        Ok(tag) => (StatusCode::OK, Json(tag)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle list tags
async fn handle_list_tags(State(state): State<ServerState>) -> Response {
    match get_all_tags_http(&state.repo).await {
        Ok(tags) => (StatusCode::OK, Json(tags)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle remove tag
async fn handle_remove_tag(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match remove_tag_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle rename tag
async fn handle_rename_tag(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let new_name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match rename_tag_http(&id, &new_name, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle merge tags
async fn handle_merge_tags(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let source = payload
        .get("source_tag_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let target = payload
        .get("target_tag_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match merge_tags_http(&source, &target, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get article tags
async fn handle_get_article_tags(
    State(state): State<ServerState>,
    axum::extract::Path(article_id): axum::extract::Path<String>,
) -> Response {
    match get_article_tags_http(&article_id, &state.repo).await {
        Ok(tags) => (StatusCode::OK, Json(tags)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle tag article
async fn handle_tag_article(
    State(state): State<ServerState>,
    axum::extract::Path((article_id, tag_id)): axum::extract::Path<(String, String)>,
) -> Response {
    match tag_article_http(&article_id, &tag_id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle untag article
async fn handle_untag_article(
    State(state): State<ServerState>,
    axum::extract::Path((article_id, tag_id)): axum::extract::Path<(String, String)>,
) -> Response {
    match untag_article_http(&article_id, &tag_id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get articles by tag
async fn handle_get_articles_by_tag(
    State(state): State<ServerState>,
    axum::extract::Path(tag_id): axum::extract::Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    match get_articles_by_tag_http(&tag_id, limit, &state.repo).await {
        Ok(articles) => (StatusCode::OK, Json(articles)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle create annotation
async fn handle_create_annotation(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let article_id = payload
        .get("article_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let annotation_type = payload
        .get("annotation_type")
        .and_then(|v| v.as_str())
        .unwrap_or("highlight")
        .to_string();
    let content = payload
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let start_offset = payload
        .get("start_offset")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let end_offset = payload
        .get("end_offset")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let color = payload
        .get("color")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    match create_annotation_http(
        &article_id,
        &annotation_type,
        &content,
        start_offset,
        end_offset,
        color.as_deref(),
        &state.repo,
    )
    .await
    {
        Ok(ann) => (StatusCode::OK, Json(ann)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get article annotations
async fn handle_get_article_annotations(
    State(state): State<ServerState>,
    axum::extract::Path(article_id): axum::extract::Path<String>,
) -> Response {
    match get_article_annotations_http(&article_id, &state.repo).await {
        Ok(annotations) => (StatusCode::OK, Json(annotations)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle update annotation
async fn handle_update_annotation(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let content = payload
        .get("content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let color = payload
        .get("color")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    match update_annotation_http(&id, content.as_deref(), color.as_deref(), &state.repo).await {
        Ok(ann) => (StatusCode::OK, Json(ann)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle delete annotation
async fn handle_delete_annotation(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match delete_annotation_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get discovered sites
async fn handle_get_discovered_sites(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let limit = params.get("limit").and_then(|l| l.parse::<i32>().ok());
    let offset = params.get("offset").and_then(|o| o.parse::<i32>().ok());
    match get_discovered_sites_http(limit, offset, &state.repo).await {
        Ok(sites) => (StatusCode::OK, Json(sites)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle refresh discoveries
async fn handle_refresh_discoveries(State(state): State<ServerState>) -> Response {
    (StatusCode::OK, Json(serde_json::json!({"discovered": 0}))).into_response()
}

/// Handle delete discovered site
async fn handle_delete_discovered_site(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match delete_discovered_site_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle create folder
async fn handle_create_folder(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let parent_id = payload.get("parent_id").and_then(|v| v.as_str());
    let icon = payload.get("icon").and_then(|v| v.as_str());
    let auto_mark_after_days = payload
        .get("auto_mark_after_days")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    match create_rss_folder_http(&name, parent_id, icon, auto_mark_after_days, &state.repo).await {
        Ok(folder) => (StatusCode::OK, Json(folder)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle list folders
async fn handle_list_folders(State(state): State<ServerState>) -> Response {
    match get_rss_folders_http(&state.repo).await {
        Ok(folders) => (StatusCode::OK, Json(folders)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle update folder
async fn handle_update_folder(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let parent_id = payload
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let parent_id_null = payload
        .get("parent_id")
        .and_then(|v| v.as_null())
        .map(|_| ());
    let icon = payload
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let icon_null = payload.get("icon").and_then(|v| v.as_null()).map(|_| ());
    let sort_order = payload
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let auto_mark_after_days_val = payload
        .get("auto_mark_after_days")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let auto_mark_after_days_null = payload
        .get("auto_mark_after_days")
        .and_then(|v| v.as_null())
        .map(|_| ());

    if name.is_none()
        && parent_id.is_none()
        && parent_id_null.is_none()
        && icon.is_none()
        && icon_null.is_none()
        && sort_order.is_none()
        && auto_mark_after_days_val.is_none()
        && auto_mark_after_days_null.is_none()
    {
        return match get_rss_folders_http(&state.repo).await {
            Ok(folders) => folders.into_iter().find(|f| f.id == id).map_or_else(
                || error_response(StatusCode::NOT_FOUND, "Folder not found"),
                |f| (StatusCode::OK, Json(f)).into_response(),
            ),
            Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
    }

    if let Some(ref n) = name {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET name = ? WHERE id = ?")
            .bind(n)
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(ref pid) = parent_id {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET parent_id = ? WHERE id = ?")
            .bind(pid)
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if parent_id_null.is_some() {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET parent_id = NULL WHERE id = ?")
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(ref ic) = icon {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET icon = ? WHERE id = ?")
            .bind(ic)
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if icon_null.is_some() {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET icon = NULL WHERE id = ?")
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(so) = sort_order {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET sort_order = ? WHERE id = ?")
            .bind(so)
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(v) = auto_mark_after_days_val {
        if let Err(e) = sqlx::query("UPDATE rss_folders SET auto_mark_after_days = ? WHERE id = ?")
            .bind(v)
            .bind(&id)
            .execute(state.repo.pool())
            .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if auto_mark_after_days_null.is_some() {
        if let Err(e) =
            sqlx::query("UPDATE rss_folders SET auto_mark_after_days = NULL WHERE id = ?")
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }

    match get_rss_folders_http(&state.repo).await {
        Ok(folders) => folders.into_iter().find(|f| f.id == id).map_or_else(
            || error_response(StatusCode::NOT_FOUND, "Folder not found"),
            |f| (StatusCode::OK, Json(f)).into_response(),
        ),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle delete folder
async fn handle_delete_folder(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let move_to = params.get("move_feeds_to").cloned();
    match delete_rss_folder_http(&id, move_to.as_deref(), &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle create reading list
async fn handle_create_reading_list(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let icon = payload.get("icon").and_then(|v| v.as_str());
    let sort_order = payload
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let feed_ids: Vec<String> = payload
        .get("feed_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    match create_rss_reading_list_http(&name, feed_ids, icon, sort_order, &state.repo).await {
        Ok(list) => (StatusCode::OK, Json(list)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle list reading lists
async fn handle_list_reading_lists(State(state): State<ServerState>) -> Response {
    match get_rss_reading_lists_http(&state.repo).await {
        Ok(lists) => (StatusCode::OK, Json(lists)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle update reading list
async fn handle_update_reading_list(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let feed_ids = payload
        .get("feed_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<String>>()
        });
    let icon_val = payload
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let icon_null = payload.get("icon").and_then(|v| v.as_null()).map(|_| ());
    let sort_order = payload
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    if name.is_none()
        && feed_ids.is_none()
        && icon_val.is_none()
        && icon_null.is_none()
        && sort_order.is_none()
    {
        return match get_rss_reading_list_by_id_http(&id, &state.repo).await {
            Ok(list) => (StatusCode::OK, Json(list)).into_response(),
            Err(e) => error_response(StatusCode::NOT_FOUND, &e.to_string()),
        };
    }

    let now = chrono::Utc::now().to_rfc3339();
    if let Some(ref n) = name {
        if let Err(e) =
            sqlx::query("UPDATE rss_reading_lists SET name = ?, updated_at = ? WHERE id = ?")
                .bind(n)
                .bind(&now)
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(ref f) = feed_ids {
        let json = serde_json::to_string(f).unwrap_or_else(|_| "[]".to_string());
        if let Err(e) =
            sqlx::query("UPDATE rss_reading_lists SET feed_ids = ?, updated_at = ? WHERE id = ?")
                .bind(&json)
                .bind(&now)
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(ref ic) = icon_val {
        if let Err(e) =
            sqlx::query("UPDATE rss_reading_lists SET icon = ?, updated_at = ? WHERE id = ?")
                .bind(ic)
                .bind(&now)
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if icon_null.is_some() {
        if let Err(e) =
            sqlx::query("UPDATE rss_reading_lists SET icon = NULL, updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }
    if let Some(so) = sort_order {
        if let Err(e) =
            sqlx::query("UPDATE rss_reading_lists SET sort_order = ?, updated_at = ? WHERE id = ?")
                .bind(so)
                .bind(&now)
                .bind(&id)
                .execute(state.repo.pool())
                .await
        {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    }

    match get_rss_reading_list_by_id_http(&id, &state.repo).await {
        Ok(list) => (StatusCode::OK, Json(list)).into_response(),
        Err(e) => error_response(StatusCode::NOT_FOUND, &e.to_string()),
    }
}

/// Handle delete reading list
async fn handle_delete_reading_list(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match delete_rss_reading_list_http(&id, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle duplicate reading list
async fn handle_duplicate_reading_list(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    match duplicate_rss_reading_list_http(&id, &state.repo).await {
        Ok(list) => (StatusCode::OK, Json(list)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle reorder folders
async fn handle_reorder_folders_http(
    State(state): State<ServerState>,
    Json(payload): Json<Vec<(String, i32)>>,
) -> Response {
    match reorder_folders_http(payload, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle move feed to folder
async fn handle_move_feed_to_folder(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let folder_id = payload.get("folder_id").and_then(|v| v.as_str());
    let sort_order = payload
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    match move_feed_to_folder_http(&feed_id, folder_id, sort_order, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle toggle feed active
async fn handle_toggle_feed_active(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
) -> Response {
    match toggle_feed_active_http(&feed_id, &state.repo).await {
        Ok(is_active) => (
            StatusCode::OK,
            Json(serde_json::json!({"is_active": is_active})),
        )
            .into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle get feed statistics
async fn handle_get_feed_statistics(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
) -> Response {
    match get_feed_statistics_http(&feed_id, &state.repo).await {
        Ok(stats) => (StatusCode::OK, Json(stats)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle set feed view preferences
async fn handle_set_feed_view_prefs(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let view_mode = payload.get("view_mode").and_then(|v| v.as_str());
    let layout = payload.get("layout").and_then(|v| v.as_str());
    match set_feed_view_preferences_http(&feed_id, view_mode, layout, &state.repo).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle folder migration from localStorage
async fn handle_migrate_folders(
    State(state): State<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let folders_json = payload
        .get("folders")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "[]".to_string());
    match migrate_folders_from_localstorage_http(&folders_json, &state.repo).await {
        Ok(count) => (StatusCode::OK, Json(serde_json::json!({"migrated": count}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Handle getting a document by ID
async fn handle_get_document(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    use crate::database::Repository;

    match state.repo.get_document(&id).await {
        Ok(Some(doc)) => {
            let response = DocumentResponse {
                id: doc.id,
                title: doc.title,
                file_path: doc.file_path,
                file_type: format!("{:?}", doc.file_type),
                current_page: doc.current_page,
                current_scroll_percent: doc.current_scroll_percent,
                current_cfi: doc.current_cfi,
                current_view_state: doc.current_view_state,
                total_pages: doc.total_pages,
                content: doc.content,
                category: doc.category,
                tags: doc.tags,
                date_added: doc.date_added.to_rfc3339(),
                date_modified: doc.date_modified.to_rfc3339(),
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(None) => error_response(StatusCode::NOT_FOUND, "Document not found"),
        Err(e) => {
            error!("Failed to get document: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Handle updating document progress
async fn handle_update_progress(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<UpdateProgressRequest>,
) -> Response {
    use crate::database::Repository;

    match state
        .repo
        .update_document_progress(
            &id,
            payload.current_page,
            payload.current_scroll_percent,
            payload.current_cfi,
            payload.current_view_state,
        )
        .await
    {
        Ok(updated_doc) => {
            let response = DocumentResponse {
                id: updated_doc.id,
                title: updated_doc.title,
                file_path: updated_doc.file_path,
                file_type: format!("{:?}", updated_doc.file_type),
                current_page: updated_doc.current_page,
                current_scroll_percent: updated_doc.current_scroll_percent,
                current_cfi: updated_doc.current_cfi,
                current_view_state: updated_doc.current_view_state,
                total_pages: updated_doc.total_pages,
                content: updated_doc.content,
                category: updated_doc.category,
                tags: updated_doc.tags,
                date_added: updated_doc.date_added.to_rfc3339(),
                date_modified: updated_doc.date_modified.to_rfc3339(),
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            error!("Failed to update progress: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

/// Tauri commands

#[tauri::command]
pub async fn start_browser_sync_server(
    app_handle: AppHandle,
    port: u16,
    repo: tauri::State<'_, Repository>,
    ai_state: tauri::State<'_, crate::commands::ai::AIState>,
) -> Result<ServerStatus, AppError> {
    let loaded_config = load_config();
    let config = BrowserSyncConfig {
        host: "127.0.0.1".to_string(),
        port,
        auto_start: false,
        api_key: loaded_config.api_key,
    };

    let ai_config = {
        let guard = ai_state.config.lock().expect("AI config mutex poisoned");
        guard.clone()
    };

    // Get the pool from the repository and create a new Arc<Repository>
    let pool = repo.pool().clone();
    let repo_arc = Arc::new(Repository::new(pool));
    start_server(config, repo_arc, app_handle, ai_config).await?;

    Ok(ServerStatus {
        running: true,
        port,
        connections: 0,
    })
}

#[tauri::command]
pub async fn stop_browser_sync_server() -> Result<ServerStatus, AppError> {
    stop_server().await?;

    Ok(ServerStatus {
        running: false,
        port: 0,
        connections: 0,
    })
}

#[tauri::command]
pub async fn get_browser_sync_server_status(port: u16) -> Result<ServerStatus, AppError> {
    let loaded_config = load_config();
    let config = BrowserSyncConfig {
        host: "127.0.0.1".to_string(),
        port,
        auto_start: false,
        api_key: loaded_config.api_key,
    };

    Ok(get_status(config).await)
}

/// Get the config file path for browser sync settings
fn get_config_path() -> std::path::PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    path.push("incrementum");
    path.push("browser_sync_config.json");
    path
}

/// Load browser sync config from file
fn load_config() -> BrowserSyncConfig {
    let path = get_config_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str::<BrowserSyncConfig>(&content) {
            return config;
        }
    }
    BrowserSyncConfig::default()
}

/// Save browser sync config to file
fn save_config(config: &BrowserSyncConfig) -> Result<(), AppError> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let json = serde_json::to_string_pretty(config).map_err(AppError::Serialization)?;
    std::fs::write(&path, &json).map_err(AppError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, perms).map_err(AppError::Io)?;
    }
    Ok(())
}

/// Get browser sync config
#[tauri::command]
pub async fn get_browser_sync_config() -> Result<BrowserSyncConfig, AppError> {
    Ok(load_config())
}

/// Set browser sync config
#[tauri::command]
pub async fn set_browser_sync_config(config: BrowserSyncConfig) -> Result<(), AppError> {
    save_config(&config)
}

fn generate_automation_api_key() -> String {
    format!("inc_{}", uuid::Uuid::new_v4().simple())
}

#[tauri::command]
pub async fn get_automation_api_key() -> Result<String, AppError> {
    let mut config = load_config();
    if config.api_key.as_deref().unwrap_or_default().is_empty() {
        config.api_key = Some(generate_automation_api_key());
        save_config(&config)?;
    }
    Ok(config.api_key.unwrap_or_default())
}

#[tauri::command]
pub async fn rotate_automation_api_key() -> Result<String, AppError> {
    let mut config = load_config();
    let new_key = generate_automation_api_key();
    config.api_key = Some(new_key.clone());
    save_config(&config)?;
    Ok(new_key)
}

#[derive(Deserialize)]
struct SubscribeRequest {
    feed_url: String,
}

#[derive(Deserialize)]
struct MarkPlayedRequest {
    played: bool,
}

#[derive(Deserialize)]
struct UpdatePositionRequest {
    position: f64,
}

#[derive(Deserialize)]
struct RenameFeedRequest {
    new_title: String,
}

#[derive(Deserialize)]
struct PodcastSearchQuery {
    q: Option<String>,
}

async fn handle_podcast_search(Query(params): Query<PodcastSearchQuery>) -> Response {
    let q = params.q.unwrap_or_default();
    let q = q.trim();
    if q.is_empty() {
        return (StatusCode::OK, Json(Vec::<PodcastSearchResult>::new())).into_response();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("HTTP client error: {}", e),
            )
        }
    };

    let response = match client
        .post("https://apollo.rss.com/search/podcast-index/byterm")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "q": q }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Search request failed: {}", e),
            )
        }
    };

    if !response.status().is_success() {
        return error_response(
            StatusCode::BAD_GATEWAY,
            &format!("Search API returned HTTP {}", response.status()),
        );
    }

    match response.json::<PodcastSearchResponse>().await {
        Ok(data) => (
            StatusCode::OK,
            Json(
                data.feeds
                    .into_iter()
                    .map(Into::into)
                    .collect::<Vec<PodcastSearchResult>>(),
            ),
        )
            .into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to parse search response: {}", e),
        ),
    }
}

async fn handle_podcast_subscribe(
    State(state): State<ServerState>,
    Json(payload): Json<SubscribeRequest>,
) -> Response {
    if let Ok(Some(existing)) = state.repo.get_podcast_feed_by_url(&payload.feed_url).await {
        let episode_count = state
            .repo
            .count_podcast_episodes(&existing.id)
            .await
            .unwrap_or(0);
        let unplayed_count = state
            .repo
            .count_unplayed_podcast_episodes(&existing.id)
            .await
            .unwrap_or(0);
        return (
            StatusCode::OK,
            Json(PodcastFeedResponse {
                feed: existing,
                episode_count,
                unplayed_count,
            }),
        )
            .into_response();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Plethora/1.31.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to build HTTP client: {}", e),
            )
        }
    };

    let response = match client.get(&payload.feed_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to fetch podcast feed: {}", e),
            )
        }
    };

    if !response.status().is_success() {
        return error_response(
            StatusCode::BAD_GATEWAY,
            &format!("Failed to fetch podcast feed: HTTP {}", response.status()),
        );
    }

    let xml = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to read feed response: {}", e),
            )
        }
    };

    let parsed = match parse_podcast_feed(&xml) {
        Ok(p) => p,
        Err(e) => {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("Failed to parse podcast feed: {}", e),
            )
        }
    };

    let feed_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let feed = PodcastFeed {
        id: feed_id.clone(),
        title: parsed.title,
        description: parsed.description,
        image_url: parsed.image_url,
        author: parsed.author,
        language: parsed.language,
        link: parsed.link,
        feed_url: payload.feed_url.clone(),
        last_fetched: Some(now.clone()),
        subscribed_at: now,
        sort_order: 0,
        auto_transcribe: false,
        transcribe_language: None,
    };

    if let Err(e) = state.repo.insert_podcast_feed(&feed).await {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    if let Err(e) = state
        .repo
        .insert_podcast_episodes_bulk(&feed_id, &parsed.episodes)
        .await
    {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }

    let episode_count = parsed.episodes.len() as i64;
    (
        StatusCode::OK,
        Json(PodcastFeedResponse {
            feed,
            episode_count,
            unplayed_count: episode_count,
        }),
    )
        .into_response()
}

async fn handle_podcast_rename_feed(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
    Json(payload): Json<RenameFeedRequest>,
) -> Response {
    match state
        .repo
        .rename_podcast_feed(&feed_id, &payload.new_title)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_unsubscribe(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
) -> Response {
    match state.repo.delete_podcast_feed(&feed_id).await {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_list_feeds(State(state): State<ServerState>) -> Response {
    match state.repo.get_podcast_feeds().await {
        Ok(feeds) => {
            let mut results = Vec::new();
            for feed in feeds {
                let episode_count = state
                    .repo
                    .count_podcast_episodes(&feed.id)
                    .await
                    .unwrap_or(0);
                let unplayed_count = state
                    .repo
                    .count_unplayed_podcast_episodes(&feed.id)
                    .await
                    .unwrap_or(0);
                results.push(PodcastFeedResponse {
                    feed,
                    episode_count,
                    unplayed_count,
                });
            }
            (StatusCode::OK, Json(results)).into_response()
        }
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_refresh_feed(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
) -> Response {
    let feed = match state.repo.get_podcast_feed(&feed_id).await {
        Ok(Some(f)) => f,
        Ok(None) => {
            return error_response(
                StatusCode::NOT_FOUND,
                &format!("Podcast feed {} not found", feed_id),
            )
        }
        Err(e) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let feed_url = feed.feed_url.clone();

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Plethora/1.31.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to build HTTP client: {}", e),
            )
        }
    };

    let response = match client.get(&feed_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to fetch podcast feed: {}", e),
            )
        }
    };

    if !response.status().is_success() {
        return error_response(
            StatusCode::BAD_GATEWAY,
            &format!("Failed to fetch podcast feed: HTTP {}", response.status()),
        );
    }

    let xml = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to read feed response: {}", e),
            )
        }
    };

    let parsed = match parse_podcast_feed(&xml) {
        Ok(p) => p,
        Err(e) => {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("Failed to parse podcast feed: {}", e),
            )
        }
    };

    let mut updated_feed = feed.clone();
    updated_feed.title = parsed.title;
    updated_feed.description = parsed.description;
    if parsed.image_url.is_some() {
        updated_feed.image_url = parsed.image_url;
    }
    if parsed.author.is_some() {
        updated_feed.author = parsed.author;
    }
    let now = chrono::Utc::now().to_rfc3339();
    updated_feed.last_fetched = Some(now.clone());

    if let Err(e) = state.repo.update_podcast_feed_metadata(&updated_feed).await {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    if let Err(e) = state
        .repo
        .update_podcast_feed_last_fetched(&feed_id, &now)
        .await
    {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    if let Err(e) = state
        .repo
        .insert_podcast_episodes_bulk(&feed_id, &parsed.episodes)
        .await
    {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }

    let episode_count = state
        .repo
        .count_podcast_episodes(&feed_id)
        .await
        .unwrap_or(0);
    let unplayed_count = state
        .repo
        .count_unplayed_podcast_episodes(&feed_id)
        .await
        .unwrap_or(0);

    (
        StatusCode::OK,
        Json(PodcastFeedResponse {
            feed: updated_feed,
            episode_count,
            unplayed_count,
        }),
    )
        .into_response()
}

async fn handle_podcast_get_episodes(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let include_played = params
        .get("include_played")
        .map(|v| v == "true")
        .unwrap_or(true);
    match state
        .repo
        .get_podcast_episodes(Some(&feed_id), Some(include_played))
        .await
    {
        Ok(episodes) => (StatusCode::OK, Json(episodes)).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_get_episode_queue(
    State(state): State<ServerState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let include_played = params
        .get("include_played")
        .map(|v| v == "true")
        .unwrap_or(false);
    match state.repo.get_podcast_feeds().await {
        Ok(feeds) => {
            let mut all_episodes: Vec<PodcastEpisode> = Vec::new();
            for feed in feeds {
                if let Ok(episodes) = state
                    .repo
                    .get_podcast_episodes(Some(&feed.id), Some(include_played))
                    .await
                {
                    all_episodes.extend(episodes);
                }
            }
            (StatusCode::OK, Json(all_episodes)).into_response()
        }
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_mark_played(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
    Json(payload): Json<MarkPlayedRequest>,
) -> Response {
    match state
        .repo
        .update_episode_played(&episode_id, payload.played)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_update_position(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
    Json(payload): Json<UpdatePositionRequest>,
) -> Response {
    match state
        .repo
        .update_episode_position(&episode_id, payload.position)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_get_position(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
) -> Response {
    match state.repo.get_episode_position(&episode_id).await {
        Ok(pos) => (StatusCode::OK, Json(json!({"position": pos}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct TranscribeRequest {
    model: Option<String>,
    language: Option<String>,
    auto_segment: Option<bool>,
}

async fn handle_podcast_transcribe(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
    Json(payload): Json<TranscribeRequest>,
) -> Response {
    let episode = match state.repo.get_podcast_episode_by_id(&episode_id).await {
        Ok(Some(ep)) => ep,
        Ok(None) => return error_response(StatusCode::NOT_FOUND, "Episode not found"),
        Err(e) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let audio_url = episode.audio_url.clone();
    let model_id = payload.model.unwrap_or_else(|| "base".to_string());
    let lang = payload.language.unwrap_or_else(|| "auto".to_string());
    let ep_id = episode_id.clone();
    let ep_duration = episode.duration.unwrap_or(0);
    let app_handle = state.app_handle.clone();
    let repo = state.repo.clone();

    // Set status to downloading
    if let Err(e) = repo
        .update_episode_transcript_status(&episode_id, "downloading", None, None)
        .await
    {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    let _ = app_handle.emit(
        "podcast://transcription-progress",
        serde_json::json!({ "episodeId": &episode_id, "status": "downloading", "progress": 0 }),
    );

    // Spawn the full transcription pipeline (download + transcribe)
    tokio::spawn(async move {
        use crate::transcription::engine::{TranscriptSegment, TranscriptionEngine};
        use crate::transcription::model_manager::ModelManager;
        use std::sync::{Arc, Mutex};
        use tokio::io::AsyncWriteExt;

        let temp_dir = match app_handle.path().app_data_dir() {
            Ok(d) => d.join("temp_transcription"),
            Err(e) => {
                let _ = repo
                    .update_episode_transcript_status(
                        &ep_id,
                        "error",
                        Some(&format!("{}", e)),
                        None,
                    )
                    .await;
                let _ = app_handle.emit(
                    "podcast://transcription-error",
                    serde_json::json!({ "episodeId": &ep_id, "error": e.to_string() }),
                );
                return;
            }
        };
        let _ = std::fs::create_dir_all(&temp_dir);
        let ext = "mp3";
        let temp_file = temp_dir.join(format!("{}_episode.{}", ep_id, ext));

        let download_ok = async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .map_err(|e| format!("HTTP client error: {}", e))?;
            let response = client
                .get(&audio_url)
                .send()
                .await
                .map_err(|e| format!("Download failed: {}", e))?;
            if !response.status().is_success() {
                return Err(format!("Download failed: HTTP {}", response.status()));
            }
            let total_size = response.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            let mut file = tokio::fs::File::create(&temp_file)
                .await
                .map_err(|e| format!("Failed to create temp file: {}", e))?;
            let mut stream = response.bytes_stream();
            use futures_util::StreamExt;
            while let Some(item) = stream.next().await {
                let chunk = item.map_err(|e| format!("Download stream error: {}", e))?;
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("Write error: {}", e))?;
                downloaded += chunk.len() as u64;
                if total_size > 0 {
                    let pct = (downloaded as f64 / total_size as f64) * 30.0;
                    let _ = app_handle.emit(
                        "podcast://transcription-progress",
                        serde_json::json!({
                            "episodeId": &ep_id, "status": "downloading", "progress": pct as i32
                        }),
                    );
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("Flush error: {}", e))?;
            Ok::<(), String>(())
        }
        .await;

        if let Err(e) = download_ok {
            let _ = std::fs::remove_file(&temp_file);
            let _ = repo
                .update_episode_transcript_status(&ep_id, "error", Some(&e), None)
                .await;
            let _ = app_handle.emit(
                "podcast://transcription-error",
                serde_json::json!({ "episodeId": &ep_id, "error": e }),
            );
            return;
        }

        let _ = repo
            .update_episode_transcript_status(&ep_id, "transcribing", None, None)
            .await;
        let _ = app_handle.emit(
            "podcast://transcription-progress",
            serde_json::json!({
                "episodeId": &ep_id, "status": "transcribing", "progress": 30
            }),
        );

        let model_manager = match ModelManager::new(&app_handle) {
            Ok(m) => m,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_file);
                let _ = repo
                    .update_episode_transcript_status(
                        &ep_id,
                        "error",
                        Some(&format!("{}", e)),
                        None,
                    )
                    .await;
                let _ = app_handle.emit(
                    "podcast://transcription-error",
                    serde_json::json!({ "episodeId": &ep_id, "error": e.to_string() }),
                );
                return;
            }
        };

        let mut selected_model = model_id;
        if !model_manager.is_model_installed(&selected_model) {
            if let Some(fallback) = model_manager
                .list_profiles()
                .into_iter()
                .find(|p| model_manager.is_model_installed(&p.id))
            {
                selected_model = fallback.id;
            } else {
                let _ = std::fs::remove_file(&temp_file);
                let err_msg =
                    "No Whisper model installed. Download one in Settings > Audio Transcription.";
                let _ = repo
                    .update_episode_transcript_status(&ep_id, "error", Some(err_msg), None)
                    .await;
                let _ = app_handle.emit(
                    "podcast://transcription-error",
                    serde_json::json!({ "episodeId": &ep_id, "error": err_msg }),
                );
                return;
            }
        }

        let engine = TranscriptionEngine::new(app_handle.clone());
        let segments: Arc<Mutex<Vec<TranscriptSegment>>> = Arc::new(Mutex::new(Vec::new()));
        let segments_clone = segments.clone();
        let app_clone = app_handle.clone();
        let ep_id_clone = ep_id.clone();

        let transcribe_result = async {
            let prepared = engine
                .prepare_audio(std::path::Path::new(&temp_file))
                .await
                .map_err(|e| format!("Audio preparation failed: {}", e))?;
            let model_path = model_manager.get_model_path(&selected_model);
            engine.transcribe(
                &prepared, &model_path, &lang,
                move |seg| {
                    if let Ok(mut guard) = segments_clone.lock() {
                        guard.push(seg);
                    }
                },
                Some(Box::new(move |p: i32| {
                    let mapped = 30 + ((p as f64 / 100.0) * 70.0) as i32;
                    let _ = app_clone.emit("podcast://transcription-progress", serde_json::json!({
                        "episodeId": &ep_id_clone, "status": "transcribing", "progress": mapped
                    }));
                })),
            ).await.map_err(|e| format!("Transcription failed: {}", e))?;
            Ok::<(), String>(())
        }
        .await;

        let _ = std::fs::remove_file(&temp_file);

        match transcribe_result {
            Ok(()) => {
                let mut segs = {
                    let mut guard = segments.lock().unwrap_or_else(|e| e.into_inner());
                    guard.sort_by(|a, b| a.start_ms.cmp(&b.start_ms));
                    guard.clone()
                };
                let full_text: String = segs
                    .iter()
                    .map(|s| s.text.trim())
                    .collect::<Vec<&str>>()
                    .join(" ");
                let _ = repo
                    .update_episode_transcript_status(&ep_id, "done", None, Some(&full_text))
                    .await;
                let _ = app_handle.emit(
                    "podcast://transcription-complete",
                    serde_json::json!({
                        "episodeId": &ep_id, "segmentCount": segs.len(), "duration": ep_duration
                    }),
                );
            }
            Err(e) => {
                let _ = repo
                    .update_episode_transcript_status(&ep_id, "error", Some(&e), None)
                    .await;
                let _ = app_handle.emit(
                    "podcast://transcription-error",
                    serde_json::json!({ "episodeId": &ep_id, "error": e }),
                );
            }
        }
    });

    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

async fn handle_podcast_get_transcript(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
) -> Response {
    match state.repo.get_podcast_episode_by_id(&episode_id).await {
        Ok(Some(episode)) => (
            StatusCode::OK,
            Json(json!({
                "text": episode.transcript_text,
                "segments": [],
                "status": episode.transcript_status,
            })),
        )
            .into_response(),
        Ok(None) => error_response(StatusCode::NOT_FOUND, "Episode not found"),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn handle_podcast_cancel_transcription(
    State(state): State<ServerState>,
    axum::extract::Path(episode_id): axum::extract::Path<String>,
) -> Response {
    // Reset status to none
    match state
        .repo
        .update_episode_transcript_status(&episode_id, "none", None, None)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct AutoTranscribeRequest {
    enabled: bool,
    language: Option<String>,
}

async fn handle_podcast_set_auto_transcribe(
    State(state): State<ServerState>,
    axum::extract::Path(feed_id): axum::extract::Path<String>,
    Json(payload): Json<AutoTranscribeRequest>,
) -> Response {
    match state
        .repo
        .set_feed_auto_transcribe(&feed_id, payload.enabled, payload.language.as_deref())
        .await
    {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

/// Initialize browser sync server (called on app startup)
pub async fn initialize_if_enabled(
    repo: Arc<Repository>,
    app_handle: AppHandle,
    ai_config: Option<AIConfig>,
) -> Result<(), AppError> {
    let config = load_config();
    if config.auto_start {
        info!(
            "Auto-starting browser extension server on port {}",
            config.port
        );
        if let Err(err) = start_server(config, repo, app_handle, ai_config).await {
            warn!("Browser extension server auto-start skipped: {}", err);
        }
    }
    Ok(())
}

#[cfg(test)]
mod browser_import_persistence_tests {
    use super::*;

    fn payload(kind: &str, text: &str, html: Option<&str>, url: &str) -> ExtensionRequest {
        ExtensionRequest {
            url: url.to_string(),
            title: "Saved page".to_string(),
            text: text.to_string(),
            html_content: html.map(str::to_string),
            extracted_images: None,
            r#type: kind.to_string(),
            source: "browser_extension".to_string(),
            timestamp: None,
            context: None,
            capture_context: None,
            extension_version: None,
            tags: None,
            priority: None,
            analysis: None,
            fsrs_data: None,
            test: Some(true),
        }
    }

    #[test]
    fn only_explicit_extract_requests_route_to_extracts() {
        for kind in ["page", "link", "", " PAGE "] {
            assert_eq!(
                classify_extension_request(&payload(kind, "body", None, "https://example.com")),
                ExtensionRequestKind::Page
            );
        }
        assert_eq!(
            classify_extension_request(&payload(
                "extract",
                "selection",
                None,
                "https://example.com"
            )),
            ExtensionRequestKind::Extract
        );
    }

    #[test]
    fn browser_extension_ai_and_theme_routes_do_not_require_automation_key() {
        assert!(is_public_browser_extension_endpoint(
            "/",
            &axum::http::Method::POST
        ));
        assert!(is_public_browser_extension_endpoint(
            "/ai/process",
            &axum::http::Method::POST
        ));
        assert!(is_public_browser_extension_endpoint(
            "/ai/status",
            &axum::http::Method::GET
        ));
        assert!(is_public_browser_extension_endpoint(
            "/ai/image-occlusion",
            &axum::http::Method::POST
        ));
        assert!(is_public_browser_extension_endpoint(
            "/api/theme",
            &axum::http::Method::GET
        ));
        assert!(!is_public_browser_extension_endpoint(
            "/api/automation/cards",
            &axum::http::Method::POST
        ));
        assert!(!is_public_browser_extension_endpoint(
            "/ai/process",
            &axum::http::Method::GET
        ));
    }

    #[test]
    fn ai_flashcard_persistence_requires_an_explicit_request_flag() {
        let without_save: AIRequest = serde_json::from_value(json!({
            "content": "Selected browser text",
            "operation": "flashcards"
        }))
        .expect("valid AI request");
        assert!(!without_save.save_flashcards);
        assert!(without_save.card_types.is_empty());

        let with_save: AIRequest = serde_json::from_value(json!({
            "content": "Selected browser text",
            "operation": "flashcards",
            "save_flashcards": true,
            "card_types": ["qa"]
        }))
        .expect("valid AI request");
        assert!(with_save.save_flashcards);
        assert_eq!(with_save.card_types, vec!["qa"]);
    }

    #[test]
    fn extension_text_is_preferred_and_html_is_the_fallback() {
        let with_text = payload(
            "page",
            "  Extension article body  ",
            Some("<p>HTML fallback</p>"),
            "https://example.com",
        );
        assert_eq!(
            select_extension_document_text(&with_text),
            "Extension article body"
        );

        let html_only = payload(
            "page",
            "",
            Some("<article><h1>Heading</h1><p>Recovered body.</p></article>"),
            "https://example.com",
        );
        let selected = select_extension_document_text(&html_only);
        assert!(selected.contains("Heading"));
        assert!(selected.contains("Recovered body."));
    }

    #[test]
    fn explicit_extract_parent_metadata_does_not_keep_selection_markup() {
        let selection = payload(
            "extract",
            "Selected sentence only",
            Some("<p>Selected sentence only</p>"),
            "https://example.com/article",
        );
        let metadata = build_browser_extract_parent_metadata(&selection);
        assert_eq!(metadata.source.as_deref(), Some("browser_extension"));
        assert!(metadata.article_html.is_none());
        assert!(metadata.extracted_images.is_none());
        assert!(metadata.browser_import_mode.is_none());
    }

    #[test]
    fn navigation_shell_text_is_detected_but_normal_prose_is_not() {
        let shell = format!(
            "[Skip to main content][1] [Skip to navigation][2] {}",
            (0..80)
                .map(|index| format!("[Link {index}]"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        assert!(looks_like_navigation_heavy_text(&shell));

        let prose = (0..80)
            .map(|index| format!("Paragraph {index} contains a complete sentence about the article topic."))
            .collect::<Vec<_>>()
            .join("\n\n");
        assert!(!looks_like_navigation_heavy_text(&prose));
    }

    #[test]
    fn browser_source_urls_drop_fragments_for_deduplication() {
        assert_eq!(
            normalize_browser_source_url(" https://EXAMPLE.com/article#selection "),
            "https://example.com/article"
        );
    }

    #[test]
    fn capture_context_is_bounded_and_unknown_fields_are_dropped() {
        let mut request = payload("page", "body", None, "https://example.com/article");
        request.capture_context = Some(json!({
            "pageTitle": "Article",
            "nearbyText": "x".repeat(20_000),
            "headingPath": (0..40).map(|index| format!("Section {index}")).collect::<Vec<_>>(),
            "sourceTags": ["topic", "topic", "source"],
            "unexpected": "must not be persisted",
        }));

        let normalized = normalize_browser_capture_context(&request).expect("context");
        let encoded = serde_json::to_vec(&normalized).expect("json");
        assert!(encoded.len() <= BROWSER_CONTEXT_TOTAL_BYTES);
        assert!(normalized.get("unexpected").is_none());
        assert_eq!(normalized["headingPath"].as_array().unwrap().len(), 12);
        assert_eq!(normalized["sourceTags"].as_array().unwrap().len(), 2);
        assert_eq!(normalized["domain"], "example.com");
        assert!(normalized["nearbyText"].as_str().unwrap().len() < 20_000);
    }
}

#[cfg(test)]
mod oversized_request_diagnostics_tests {
    use super::*;
    use axum::body::{to_bytes, Bytes as AxumBytes};
    use axum::http::Request;
    use axum::routing::post;
    use tower05::ServiceExt;

    fn test_router() -> Router {
        Router::new()
            .route("/test", post(|_body: AxumBytes| async { StatusCode::OK }))
            .layer(RequestBodyLimitLayer::new(MAX_PAYLOAD_SIZE))
            // Same ordering as the real router: added after RequestBodyLimitLayer
            // so it runs first, ahead of that layer's own bare-413 response.
            .layer(middleware::from_fn(annotate_oversized_request))
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), 64 * 1024 * 1024)
            .await
            .expect("read response body");
        serde_json::from_slice(&bytes).expect("response body is JSON")
    }

    #[tokio::test]
    async fn declared_content_length_over_the_limit_is_rejected_before_the_body_is_read() {
        let declared = MAX_PAYLOAD_SIZE + 1;
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .header(axum::http::header::CONTENT_LENGTH, declared.to_string())
                    // The header lies; a real oversized upload never has to be
                    // constructed in-memory for this path to be exercised.
                    .body(Body::from(b"tiny body".to_vec()))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let body = response_json(response).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["received_bytes"], declared);
        assert_eq!(body["limit_bytes"], MAX_PAYLOAD_SIZE);
        assert_eq!(body["endpoint"], "/test");
        let message = body["error"].as_str().expect("error is a string");
        assert!(message.contains(&declared.to_string()));
        assert!(message.contains(&MAX_PAYLOAD_SIZE.to_string()));
        assert!(message.contains("/test"));
    }

    #[tokio::test]
    async fn a_body_that_exceeds_the_limit_without_a_content_length_header_is_still_diagnosable() {
        // No Content-Length: the fast pre-check cannot run, so
        // RequestBodyLimitLayer only rejects once the handler's Bytes
        // extractor actually reads the body. This is the path whose bare,
        // empty-body 413 the reporter saw before this change.
        let oversized = vec![b'x'; MAX_PAYLOAD_SIZE + 1];
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .body(Body::from(oversized))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let body = response_json(response).await;
        assert_eq!(body["success"], false);
        assert!(body["received_bytes"].is_null());
        assert_eq!(body["limit_bytes"], MAX_PAYLOAD_SIZE);
        assert_eq!(body["endpoint"], "/test");
        assert!(!body["error"].as_str().unwrap_or("").is_empty());
    }

    #[tokio::test]
    async fn a_request_within_the_limit_is_unaffected() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .header(axum::http::header::CONTENT_LENGTH, "5")
                    .body(Body::from(b"hello".to_vec()))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[cfg(test)]
mod x_thread_capture_tests {
    use super::*;
    use crate::database::Database;
    use crate::threadreader::ThreadError;
    use crate::twitter::{TwitterAuthor, TwitterThread};
    use axum::body::to_bytes;
    use std::path::PathBuf;

    /// Mirror of the in-tree test helper at `database/repository.rs:7282`:
    /// in-memory SQLite + full migration, so each test runs in isolation.
    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    fn x_payload(kind: &str, url: &str) -> ExtensionRequest {
        ExtensionRequest {
            url: url.to_string(),
            title: "Some X post".to_string(),
            text: String::new(),
            html_content: None,
            extracted_images: None,
            r#type: kind.to_string(),
            source: "browser_extension".to_string(),
            timestamp: None,
            context: None,
            capture_context: None,
            extension_version: None,
            tags: None,
            priority: None,
            analysis: None,
            fsrs_data: None,
            test: Some(true),
        }
    }

    fn thread_fixture() -> TwitterThread {
        TwitterThread {
            id: "1001".to_string(),
            root_id: "1001".to_string(),
            root_url: "https://x.com/janeresearch/status/1001".to_string(),
            author: TwitterAuthor {
                name: "Jane Researcher".to_string(),
                screen_name: "janeresearch".to_string(),
                avatar_url: None,
                verified: false,
                profile_url: "https://x.com/janeresearch".to_string(),
            },
            title: "Jane Researcher (@janeresearch) on X: \"First post\"".to_string(),
            posts: vec![],
            total_posts: 1,
            html_content: "<div class=\"x-thread-container\">html</div>".to_string(),
            structured_text: "X Thread by Jane Researcher (@janeresearch):".to_string(),
            created_at: None,
            source_kind: "threadreader".to_string(),
        }
    }

    #[test]
    fn x_status_urls_route_to_the_thread_pipeline_regardless_of_type() {
        for kind in ["x-thread", "page", "link", "", "extract", "video", " PAGE "] {
            for url in [
                "https://x.com/user/status/1234567890",
                "https://twitter.com/Some_User/status/9876543210?s=20",
                "https://www.x.com/user/status/1111111111111111111",
                "https://mobile.twitter.com/user/status/2222222222222222222/photo/1",
            ] {
                assert_eq!(
                    classify_extension_request(&x_payload(kind, url)),
                    ExtensionRequestKind::XThread,
                    "kind={:?} url={}",
                    kind,
                    url
                );
            }
        }
    }

    #[test]
    fn non_status_x_urls_and_lookalikes_stay_generic() {
        for url in [
            "https://x.com/PhillipAKennedy",
            "https://x.com/PhillipAKennedy/with_replies",
            "https://x.com/search?q=threadreader",
            "https://x.com/home",
            "https://x.com/i/status/1234567890",
            "https://x.com/user/status/notanid",
            "https://evil.example/x/user/status/1234567890",
            "https://www.youtube.com/watch?v=abc",
        ] {
            assert_eq!(
                classify_extension_request(&x_payload("page", url)),
                ExtensionRequestKind::Page,
                "url={}",
                url
            );
        }
    }

    #[tokio::test]
    async fn x_thread_capture_persists_a_thread_document_like_an_import() {
        let repo = setup_repo().await;
        let thread = thread_fixture();
        let doc = capture_x_thread_document(&repo, "https://x.com/janeresearch/status/1001", |_| async {
            Ok(thread.clone())
        })
        .await
        .expect("capture persists");

        assert_eq!(doc.category.as_deref(), Some("X Threads"));
        assert_eq!(doc.tags, vec!["x", "twitter", "thread"]);
        assert_eq!(doc.file_type, FileType::Html);
        // Canonical (root) URL is the dedupe key, same as import_twitter_thread.
        assert_eq!(doc.file_path, "https://x.com/janeresearch/status/1001");
        let metadata = doc.metadata.expect("metadata present");
        assert_eq!(metadata.article_html.as_deref(), Some("<div class=\"x-thread-container\">html</div>"));
        assert!(metadata.structured_content.is_some());
        assert_eq!(metadata.site_name.as_deref(), Some("X"));
        assert_eq!(metadata.author.as_deref(), Some("Jane Researcher"));
    }

    #[tokio::test]
    async fn duplicate_x_thread_capture_dedupes_by_canonical_url() {
        let repo = setup_repo().await;
        let thread = thread_fixture();
        let first = capture_x_thread_document(&repo, "https://x.com/janeresearch/status/1001", |_| async {
            Ok(thread.clone())
        })
        .await
        .expect("first capture");
        // Second capture arrives with a query string and a twitter.com host —
        // the resolved root URL is identical, so no second document.
        let second = capture_x_thread_document(
            &repo,
            "https://twitter.com/janeresearch/status/1001?s=20",
            |_| async { Ok(thread_fixture()) },
        )
        .await
        .expect("second capture");
        assert_eq!(first.id, second.id);
        assert!(
            repo.find_document_by_url("https://x.com/janeresearch/status/1001")
                .await
                .expect("lookup")
                .is_some()
        );
    }

    #[tokio::test]
    async fn x_thread_retrieval_failure_is_typed_not_a_generic_500() {
        let repo = setup_repo().await;
        let result = capture_x_thread_document(&repo, "https://x.com/user/status/1234567890", |_| async {
            Err(ThreadError::RateLimited(
                "ThreadReaderApp rate-limited (HTTP 429) for thread 1234567890".to_string(),
            ))
        })
        .await;
        match result {
            Err(XThreadCaptureError::Retrieval(ThreadError::RateLimited(_))) => {}
            other => panic!("expected typed RateLimited retrieval error, got {:?}", other),
        }

        // The HTTP mapping carries the typed kind + a reason the extension
        // can surface verbatim.
        let response = x_thread_error_response(&ThreadError::RateLimited(
            "ThreadReaderApp rate-limited".to_string(),
        ));
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        let body = to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("read body");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(parsed["success"], false);
        assert_eq!(parsed["errorType"], "rate_limited");
        assert!(parsed["error"]
            .as_str()
            .expect("error string")
            .contains("Rate limited"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_ingest_decoded_size_bounds_match_transport_limit() {
        // base64 "AA==" decodes to 1 byte
        assert_eq!(decoded_base64_size("AA=="), 3);
        assert_eq!(decoded_base64_size(""), 0);
        assert_eq!(decoded_base64_size("QQ=="), 3);

        // 7 MB decoded budget: 7 * 1024 * 1024 bytes -> 9_331_536 base64 chars
        let at_limit: usize = 7 * 1024 * 1024;
        let base64_len = at_limit.div_ceil(3) * 4;
        assert!(decoded_base64_size(&"A".repeat(base64_len)) >= at_limit);
        assert!(decoded_base64_size(&"A".repeat(base64_len + 4)) > IMAGE_OCCLUSION_DECODED_MAX_BYTES);
    }

    #[test]
    fn ingest_route_is_a_public_browser_extension_endpoint() {
        assert!(is_public_browser_extension_endpoint(
            "/api/image-registry/ingest",
            &axum::http::Method::POST
        ));
        assert!(!is_public_browser_extension_endpoint(
            "/api/image-registry/ingest",
            &axum::http::Method::GET
        ));
    }

    #[test]
    fn browser_import_tags_preserves_only_explicit_tags() {
        assert_eq!(
            browser_import_tags(Some(&vec!["anatomy".to_string(), "diagram".to_string()])),
            vec!["anatomy", "diagram"]
        );
        assert!(browser_import_tags(None).is_empty());
    }

    #[test]
    fn queued_browser_organization_emits_provenance_and_fingerprint() {
        let context = serde_json::json!({
            "sourceUrl": "https://example.com/article",
            "domain": "example.com",
            "pageTitle": "Anatomy diagram",
            "captionAltText": "Labeled heart diagram",
        });
        let (provenance, organization) = queued_browser_organization(
            "image-registry",
            "Anatomy diagram — Labeled heart diagram",
            &Some(context),
            &["anatomy".to_string()],
            None,
        );
        let provenance = provenance.expect("provenance present");
        let organization = organization.expect("organization present");
        assert_eq!(provenance["source"], "browser_extension");
        assert_eq!(provenance["itemType"], "image-registry");
        assert_eq!(provenance["sourceUrl"], "https://example.com/article");
        assert_eq!(organization["status"], "queued");
        assert_eq!(organization["confidenceBand"], "none");
        let fingerprint = organization["fingerprint"].as_str().expect("fingerprint");
        assert!(fingerprint.starts_with("browser-org-v1-"));
        assert_eq!(fingerprint.len(), "browser-org-v1-".len() + 64);
    }

    #[test]
    fn queued_browser_organization_is_empty_without_context() {
        let (provenance, organization) = queued_browser_organization(
            "image-registry",
            "content",
            &None,
            &[],
            None,
        );
        assert!(provenance.is_none());
        assert!(organization.is_none());
    }
}
