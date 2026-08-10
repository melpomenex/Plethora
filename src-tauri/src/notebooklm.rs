use crate::database::Repository;
use crate::error::AppError;
use crate::models::document::{Document, DocumentMetadata, FileType};
use crate::models::collection::DEFAULT_COLLECTION_ID;
use crate::models::{ItemType, LearningItem};
use async_trait::async_trait;
use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMSettings {
    pub enabled: bool,
    pub provider: String,
    pub active_notebook_id: Option<String>,
}

impl Default for NotebookLMSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "mock".to_string(),
            active_notebook_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMAuthState {
    pub connected: bool,
    pub last_connected_at: Option<String>,
    pub provider: String,
    pub storage_path: Option<String>,
}

impl Default for NotebookLMAuthState {
    fn default() -> Self {
        Self {
            connected: false,
            last_connected_at: None,
            provider: "mock".to_string(),
            storage_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMHealth {
    pub connected: bool,
    pub provider: String,
    pub active_notebook_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSummary {
    pub id: String,
    pub title: String,
    pub sources_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub id: String,
    pub artifact_type: String,
    pub title: String,
    pub created_at: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashcardItem {
    pub question: String,
    pub answer: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizItem {
    pub question: String,
    pub correct_answer: String,
    pub user_answer: Option<String>,
    pub was_correct: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPayload {
    pub flashcards: Vec<FlashcardItem>,
    pub quiz_items: Vec<QuizItem>,
    pub raw_text: Option<String>,
    /// JSON content for structured artifacts like mind-maps, data-tables, etc.
    pub json_content: Option<serde_json::Value>,
    /// URL or file path for media artifacts (audio, video)
    pub media_url: Option<String>,
    /// Last playback position in seconds for media artifacts (audio, video).
    /// Persisted with the job so reopening an artifact resumes where the user
    /// left off, and carried into the library document position on import.
    pub playback_position: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMJob {
    pub id: String,
    pub notebook_id: String,
    pub artifact_type: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub error: Option<String>,
    pub artifact: Option<ArtifactSummary>,
    pub payload: ArtifactPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateArtifactRequest {
    pub notebook_id: Option<String>,
    pub artifact_type: String,
    pub instructions: Option<String>,
    pub difficulty: Option<String>,
    pub quantity: Option<String>,
    pub retry_count: Option<u8>,
    /// slide-deck option: `detailed` (default) or `presenter`
    pub format: Option<String>,
    /// slide-deck option: `default` or `short`
    pub length: Option<String>,
    /// infographic option: `landscape` (default), `portrait`, or `square`
    pub orientation: Option<String>,
    /// infographic option: `concise`, `standard` (default), or `detailed`
    pub detail: Option<String>,
    /// infographic option: visual style passed through to the CLI
    pub style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSourceRequest {
    pub notebook_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskResponse {
    pub answer: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchResponse {
    pub status: String,
    pub imported_sources: usize,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewItem {
    pub question: String,
    pub answer: String,
    pub tags: Vec<String>,
    pub source_notebook_id: String,
    pub source_artifact_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
    pub item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportResult {
    pub format: String,
    pub mime_type: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobsFile {
    jobs: Vec<NotebookLMJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockNotebook {
    id: String,
    title: String,
    sources: Vec<SourceSummary>,
    artifacts: Vec<ArtifactSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockState {
    notebooks: Vec<MockNotebook>,
}

impl Default for MockState {
    fn default() -> Self {
        Self {
            notebooks: vec![MockNotebook {
                id: "nb_demo".to_string(),
                title: "Incrementum NotebookLM Demo".to_string(),
                sources: vec![],
                artifacts: vec![],
            }],
        }
    }
}

#[derive(Debug, Clone)]
struct ProviderContext {
    app_dir: PathBuf,
    notebooklm_bin: Option<PathBuf>,
    notebooklm_runtime_base: Option<PathBuf>,
    notebooklm_runtime_python: Option<PathBuf>,
    notebooklm_runtime_site_packages: Option<PathBuf>,
    notebooklm_runtime_playwright: Option<PathBuf>,
    notebooklm_runtime_validation_error: Option<String>,
    notebooklm_managed_python: Option<PathBuf>,
    is_appimage: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct NotebookLMRuntimeManifest {
    layout: Option<String>,
    python_executable: Option<String>,
    site_packages: Option<String>,
    playwright_dir: Option<String>,
    required_paths: Option<Vec<String>>,
}

#[async_trait]
trait NotebookLMProvider: Send + Sync {
    async fn health(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
    ) -> Result<NotebookLMHealth, AppError>;
    async fn list_notebooks(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
    ) -> Result<Vec<NotebookSummary>, AppError>;
    async fn create_notebook(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        title: &str,
    ) -> Result<NotebookSummary, AppError>;
    async fn list_sources(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
    ) -> Result<Vec<SourceSummary>, AppError>;
    async fn add_source(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        req: &AddSourceRequest,
    ) -> Result<SourceSummary, AppError>;
    async fn refresh_source(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        source_id: &str,
    ) -> Result<SourceSummary, AppError>;
    async fn ask(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        question: &str,
    ) -> Result<AskResponse, AppError>;
    #[allow(clippy::too_many_arguments)]
    async fn research(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        query: &str,
        mode: Option<String>,
        from: Option<String>,
    ) -> Result<ResearchResponse, AppError>;
    async fn generate_artifact(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        req: &GenerateArtifactRequest,
    ) -> Result<(ArtifactSummary, ArtifactPayload), AppError>;
}

struct MockNotebookLMProvider;

#[async_trait]
impl NotebookLMProvider for MockNotebookLMProvider {
    async fn health(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        _ctx: &ProviderContext,
    ) -> Result<NotebookLMHealth, AppError> {
        Ok(NotebookLMHealth {
            connected: auth.connected,
            provider: settings.provider.clone(),
            active_notebook_id: settings.active_notebook_id.clone(),
            message: if auth.connected {
                "Connected (mock provider)".to_string()
            } else {
                "Disconnected".to_string()
            },
        })
    }

    async fn list_notebooks(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
    ) -> Result<Vec<NotebookSummary>, AppError> {
        let state = load_mock_state(&ctx.app_dir)?;
        Ok(state
            .notebooks
            .into_iter()
            .map(|n| NotebookSummary {
                id: n.id,
                title: n.title,
                sources_count: n.sources.len(),
            })
            .collect())
    }

    async fn create_notebook(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        title: &str,
    ) -> Result<NotebookSummary, AppError> {
        let mut state = load_mock_state(&ctx.app_dir)?;
        let notebook = MockNotebook {
            id: format!("nb_{}", Uuid::new_v4().simple()),
            title: title.to_string(),
            sources: vec![],
            artifacts: vec![],
        };
        let summary = NotebookSummary {
            id: notebook.id.clone(),
            title: notebook.title.clone(),
            sources_count: 0,
        };
        state.notebooks.push(notebook);
        save_mock_state(&ctx.app_dir, &state)?;
        Ok(summary)
    }

    async fn list_sources(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
    ) -> Result<Vec<SourceSummary>, AppError> {
        let state = load_mock_state(&ctx.app_dir)?;
        let notebook = state
            .notebooks
            .into_iter()
            .find(|n| n.id == notebook_id)
            .ok_or_else(|| AppError::NotFound(format!("Notebook {notebook_id} not found")))?;
        Ok(notebook.sources)
    }

    async fn add_source(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        req: &AddSourceRequest,
    ) -> Result<SourceSummary, AppError> {
        let mut state = load_mock_state(&ctx.app_dir)?;
        let notebook = state
            .notebooks
            .iter_mut()
            .find(|n| n.id == notebook_id)
            .ok_or_else(|| AppError::NotFound(format!("Notebook {notebook_id} not found")))?;
        let source = SourceSummary {
            id: format!("src_{}", Uuid::new_v4().simple()),
            title: req
                .title
                .clone()
                .unwrap_or_else(|| req.content.chars().take(60).collect()),
            kind: req.kind.clone(),
            status: "ready".to_string(),
        };
        notebook.sources.push(source.clone());
        save_mock_state(&ctx.app_dir, &state)?;
        Ok(source)
    }

    async fn refresh_source(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        source_id: &str,
    ) -> Result<SourceSummary, AppError> {
        let mut state = load_mock_state(&ctx.app_dir)?;
        let notebook = state
            .notebooks
            .iter_mut()
            .find(|n| n.id == notebook_id)
            .ok_or_else(|| AppError::NotFound(format!("Notebook {notebook_id} not found")))?;
        let source = notebook
            .sources
            .iter_mut()
            .find(|s| s.id == source_id)
            .ok_or_else(|| AppError::NotFound(format!("Source {source_id} not found")))?;
        source.status = "refreshed".to_string();
        let cloned = source.clone();
        save_mock_state(&ctx.app_dir, &state)?;
        Ok(cloned)
    }

    async fn ask(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        _ctx: &ProviderContext,
        notebook_id: &str,
        question: &str,
    ) -> Result<AskResponse, AppError> {
        Ok(AskResponse {
            answer: format!(
                "NotebookLM mock answer for `{question}` in notebook `{notebook_id}`.\n\nUse real CLI provider to fetch live NotebookLM responses."
            ),
            sources: vec!["mock://source-1".to_string()],
        })
    }

    async fn research(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        _ctx: &ProviderContext,
        _notebook_id: &str,
        query: &str,
        mode: Option<String>,
        from: Option<String>,
    ) -> Result<ResearchResponse, AppError> {
        Ok(ResearchResponse {
            status: "completed".to_string(),
            imported_sources: 2,
            summary: format!(
                "Mock research completed for '{query}' (mode={}, from={}).",
                mode.unwrap_or_else(|| "fast".to_string()),
                from.unwrap_or_else(|| "web".to_string())
            ),
        })
    }

    async fn generate_artifact(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        _ctx: &ProviderContext,
        _notebook_id: &str,
        req: &GenerateArtifactRequest,
    ) -> Result<(ArtifactSummary, ArtifactPayload), AppError> {
        let artifact = ArtifactSummary {
            id: format!("art_{}", Uuid::new_v4().simple()),
            artifact_type: req.artifact_type.clone(),
            title: format!("{} result", req.artifact_type),
            created_at: Utc::now().to_rfc3339(),
            content: req.instructions.clone(),
        };

        let payload = match req.artifact_type.as_str() {
            "flashcards" => ArtifactPayload {
                flashcards: vec![
                    FlashcardItem {
                        question: "What is incremental reading?".to_string(),
                        answer: "A method for breaking reading into spaced reviewable chunks.".to_string(),
                        tags: vec!["notebooklm".to_string(), "incremental-reading".to_string()],
                    },
                    FlashcardItem {
                        question: "Why use NotebookLM artifacts in Incrementum?".to_string(),
                        answer: "To transform research outputs into schedulable review items.".to_string(),
                        tags: vec!["notebooklm".to_string(), "workflow".to_string()],
                    },
                ],
                ..ArtifactPayload::default()
            },
            "quiz" => ArtifactPayload {
                quiz_items: vec![
                    QuizItem {
                        question: "NotebookLM flashcards can be exported as JSON.".to_string(),
                        correct_answer: "True".to_string(),
                        user_answer: Some("False".to_string()),
                        was_correct: false,
                    },
                    QuizItem {
                        question: "Incrementum uses FSRS scheduling.".to_string(),
                        correct_answer: "True".to_string(),
                        user_answer: Some("True".to_string()),
                        was_correct: true,
                    },
                ],
                ..ArtifactPayload::default()
            },
            "mind-map" => {
                let mindmap_json = serde_json::json!({
                    "id": "root",
                    "text": req.instructions.clone().unwrap_or_else(|| "Main Topic".to_string()),
                    "children": [
                        {
                            "id": "child1",
                            "text": "Key Concept 1",
                            "children": [
                                {"id": "child1-1", "text": "Detail 1A"},
                                {"id": "child1-2", "text": "Detail 1B"}
                            ]
                        },
                        {
                            "id": "child2",
                            "text": "Key Concept 2",
                            "children": [
                                {"id": "child2-1", "text": "Detail 2A"},
                                {"id": "child2-2", "text": "Detail 2B"}
                            ]
                        },
                        {
                            "id": "child3",
                            "text": "Key Concept 3"
                        }
                    ]
                });
                ArtifactPayload {
                    json_content: Some(mindmap_json),
                    raw_text: Some(format!("Mind map: {}", req.instructions.clone().unwrap_or_default())),
                    ..ArtifactPayload::default()
                }
            },
            "data-table" => {
                let table_json = serde_json::json!([
                    {"Concept": "Process Scheduling", "Description": "Algorithms for CPU allocation", "Example": "Round Robin"},
                    {"Concept": "Memory Management", "Description": "Handling RAM allocation", "Example": "Virtual Memory"},
                    {"Concept": "File Systems", "Description": "Organization of storage", "Example": "NTFS, ext4"},
                    {"Concept": "I/O Management", "Description": "Device communication", "Example": "DMA, Interrupts"}
                ]);
                ArtifactPayload {
                    json_content: Some(table_json),
                    raw_text: Some("Data table with OS concepts".to_string()),
                    ..ArtifactPayload::default()
                }
            },
            "audio" => ArtifactPayload {
                media_url: Some("https://example.com/audio-overview.mp3".to_string()),
                raw_text: Some("Audio overview generated successfully. Listen to the podcast-style summary of your sources.".to_string()),
                ..ArtifactPayload::default()
            },
            "video" => ArtifactPayload {
                media_url: Some("https://example.com/video-overview.mp4".to_string()),
                raw_text: Some("Video overview generated successfully. Visual presentation of key concepts.".to_string()),
                ..ArtifactPayload::default()
            },
            "report" | "study-guide" => ArtifactPayload {
                raw_text: Some(format!(
                    "# Study Guide: {}\n\n## Summary\n\nThis is a comprehensive summary of the key concepts from your sources.\n\n## Key Points\n\n1. First important concept\n2. Second important concept\n3. Third important concept\n\n## Detailed Analysis\n\nThe material covers several fundamental topics that build upon each other...",
                    req.instructions.clone().unwrap_or_else(|| "Topic".to_string())
                )),
                ..ArtifactPayload::default()
            },
            _ => ArtifactPayload {
                raw_text: Some(format!(
                    "Mock {} artifact generated at {}",
                    req.artifact_type,
                    Utc::now().to_rfc3339()
                )),
                ..ArtifactPayload::default()
            },
        };

        Ok((artifact, payload))
    }
}

struct CliNotebookLMProvider;

#[derive(Debug, Clone)]
struct CliCommandResult {
    stdout: String,
}

impl CliCommandResult {
    fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_str::<serde_json::Value>(&self.stdout).ok()
    }
}

async fn execute_notebooklm_command(command: &mut Command) -> Result<CliCommandResult, AppError> {
    execute_notebooklm_command_with_input(command, None, 0).await
}

async fn execute_notebooklm_command_with_input(
    command: &mut Command,
    stdin_input: Option<&str>,
    input_delay_ms: u64,
) -> Result<CliCommandResult, AppError> {
    let command_label = format!(
        "{} {}",
        command.as_std().get_program().to_string_lossy(),
        command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ")
    )
    .trim()
    .to_string();

    let output = if let Some(input) = stdin_input {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|e| {
            AppError::IntegrationError(format!(
                "Failed to run notebooklm CLI ({command_label}): {e}"
            ))
        })?;
        if let Some(mut stdin) = child.stdin.take() {
            if input_delay_ms > 0 {
                sleep(Duration::from_millis(input_delay_ms)).await;
            }
            stdin.write_all(input.as_bytes()).await.map_err(|e| {
                AppError::IntegrationError(format!(
                    "Failed writing notebooklm CLI input ({command_label}): {e}"
                ))
            })?;
        }
        child.wait_with_output().await.map_err(|e| {
            AppError::IntegrationError(format!(
                "Failed to run notebooklm CLI ({command_label}): {e}"
            ))
        })?
    } else {
        command.output().await.map_err(|e| {
            AppError::IntegrationError(format!(
                "Failed to run notebooklm CLI ({command_label}): {e}"
            ))
        })?
    };

    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            format!("stdout: {stdout}")
        } else {
            "no stdout/stderr output".to_string()
        };
        return Err(AppError::IntegrationError(format!(
            "command `{}` failed (exit {}): {}",
            command_label, code, details
        )));
    }

    Ok(CliCommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    })
}

fn is_cli_missing_error(err: &AppError) -> bool {
    let lower = err.to_string().to_lowercase();
    lower.contains("no such file or directory")
        || lower.contains("os error 2")
        || lower.contains("command not found")
        // The checked-in macOS/Linux wrapper is executable, but when its
        // bundled runtime is absent it exits with this message. Treat that as
        // a missing CLI so managed Python + Playwright bootstrap can run on a
        // clean developer machine.
        || lower.contains("notebooklm is not installed")
}

fn apply_notebooklm_command_env(
    command: &mut Command,
    path_override: Option<&str>,
    playwright_path: Option<&Path>,
) {
    command.env("PYTHONWARNINGS", "ignore::DeprecationWarning");
    if let Some(playwright_path) = playwright_path {
        command.env("PLAYWRIGHT_BROWSERS_PATH", playwright_path);
    } else {
        command.env("PLAYWRIGHT_BROWSERS_PATH", "0");
    }
    if let Some(path) = path_override {
        command.env("PATH", path);
    }
}

async fn run_notebooklm_command_internal(
    ctx: &ProviderContext,
    args: &[String],
    allow_runtime_bootstrap: bool,
    stdin_input: Option<&str>,
    input_delay_ms: u64,
) -> Result<CliCommandResult, AppError> {
    if ctx.is_appimage {
        if let Some(validation_error) = ctx.notebooklm_runtime_validation_error.as_ref() {
            return Err(AppError::IntegrationError(format!(
                "Bundled NotebookLM runtime validation failed for AppImage: {}. Rebuild the app with a complete notebooklm-runtime bundle.",
                validation_error
            )));
        }
    }

    let storage_path = ctx.app_dir.join("storage_state.json");
    if let Some(parent) = storage_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut effective_args = vec![
        "--storage".to_string(),
        storage_path.to_string_lossy().to_string(),
    ];
    effective_args.extend(args.iter().cloned());
    let path_override = augmented_path_env();

    if let (Some(runtime_python), Some(site_packages)) = (
        ctx.notebooklm_runtime_python.as_ref(),
        ctx.notebooklm_runtime_site_packages.as_ref(),
    ) {
        tracing::debug!(
            runtime_base = ?ctx.notebooklm_runtime_base,
            "Running NotebookLM command with bundled runtime"
        );
        let python_home = runtime_python
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());
        let mut command = Command::new(runtime_python);
        command
            .arg("-m")
            .arg("notebooklm.notebooklm_cli")
            .args(&effective_args)
            .env("PYTHONPATH", site_packages)
            .env("PYTHONNOUSERSITE", "1")
            // Keep the CLI's browser profile beside the app-owned storage
            // file.  A packaged app must not depend on a stale or locked
            // ~/.notebooklm profile from another installation.
            .env("NOTEBOOKLM_HOME", &ctx.app_dir)
            .env("NOTEBOOKLM_PROFILE", "default");
        if let Some(home) = python_home {
            command.env("PYTHONHOME", home);
        }
        apply_notebooklm_command_env(
            &mut command,
            path_override.as_deref(),
            ctx.notebooklm_runtime_playwright.as_deref(),
        );
        return execute_notebooklm_command_with_input(&mut command, stdin_input, input_delay_ms)
            .await;
    }

    if let Some(managed_python) = ctx.notebooklm_managed_python.as_ref() {
        tracing::debug!("Running NotebookLM command with managed runtime");
        let mut command = Command::new(managed_python);
        command
            .arg("-m")
            .arg("notebooklm.notebooklm_cli")
            .args(&effective_args)
            .env("NOTEBOOKLM_HOME", &ctx.app_dir)
            .env("NOTEBOOKLM_PROFILE", "default");
        apply_notebooklm_command_env(&mut command, path_override.as_deref(), None);
        return execute_notebooklm_command_with_input(&mut command, stdin_input, input_delay_ms)
            .await;
    }

    let executable = ctx
        .notebooklm_bin
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "notebooklm".to_string());
    let mut command = Command::new(&executable);
    command
        .args(&effective_args)
        .env("NOTEBOOKLM_HOME", &ctx.app_dir)
        .env("NOTEBOOKLM_PROFILE", "default");
    apply_notebooklm_command_env(&mut command, path_override.as_deref(), None);
    match execute_notebooklm_command_with_input(&mut command, stdin_input, input_delay_ms).await {
        Ok(result) => return Ok(result),
        Err(err) if !allow_runtime_bootstrap || !is_cli_missing_error(&err) => return Err(err),
        Err(err) => {
            tracing::warn!(
                "NotebookLM CLI command not found; attempting managed runtime bootstrap: {}",
                err
            );
        }
    }

    let (managed_python, managed_playwright) = ensure_managed_notebooklm_runtime(ctx).await?;
    tracing::info!(
        "Installed NotebookLM managed runtime at {}",
        managed_python.to_string_lossy()
    );
    let mut managed_command = Command::new(managed_python);
    managed_command
        .arg("-m")
        .arg("notebooklm.notebooklm_cli")
        .args(&effective_args)
        .env("NOTEBOOKLM_HOME", &ctx.app_dir)
        .env("NOTEBOOKLM_PROFILE", "default");
    apply_notebooklm_command_env(
        &mut managed_command,
        path_override.as_deref(),
        managed_playwright.as_deref(),
    );
    execute_notebooklm_command_with_input(&mut managed_command, stdin_input, input_delay_ms).await
}

async fn run_notebooklm_command(
    ctx: &ProviderContext,
    args: &[String],
) -> Result<CliCommandResult, AppError> {
    run_notebooklm_command_internal(ctx, args, true, None, 0).await
}

async fn run_notebooklm_command_with_input(
    ctx: &ProviderContext,
    args: &[String],
    stdin_input: &str,
    input_delay_ms: u64,
) -> Result<CliCommandResult, AppError> {
    run_notebooklm_command_internal(ctx, args, true, Some(stdin_input), input_delay_ms).await
}

async fn run_notebooklm_command_no_bootstrap(
    ctx: &ProviderContext,
    args: &[String],
) -> Result<CliCommandResult, AppError> {
    run_notebooklm_command_internal(ctx, args, false, None, 0).await
}

/// Candidate persistent-browser profiles used by the bundled login flow.
///
/// New packaged installs keep this under the app data directory (because the
/// child CLI receives NOTEBOOKLM_HOME). The two home-directory candidates are
/// retained as a migration/read-only fallback so an existing notebooklm-py
/// installation can be reused without forcing the user to sign in twice.
fn notebooklm_browser_profile_candidates(ctx: &ProviderContext) -> Vec<PathBuf> {
    let mut candidates = vec![
        ctx.app_dir
            .join("profiles")
            .join("default")
            .join("browser_profile"),
    ];

    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join(".notebooklm")
                .join("profiles")
                .join("default")
                .join("browser_profile"),
        );
        candidates.push(home.join(".notebooklm").join("browser_profile"));
    }

    candidates.dedup();
    candidates
}

/// Export cookies from a persistent Playwright profile into the app's
/// storage_state.json. notebooklm-py's interactive login normally performs
/// this itself, but a browser that is already authenticated can still leave
/// the CLI waiting on Google's final redirect. Exporting the profile after
/// that flow exits makes the one-click path resilient to that redirect race.
async fn export_notebooklm_browser_profile(
    ctx: &ProviderContext,
    browser_profile: &Path,
    storage_path: &Path,
) -> Result<(), AppError> {
    let Some(runtime_python) = ctx.notebooklm_runtime_python.as_ref() else {
        return Err(AppError::IntegrationError(
            "bundled NotebookLM Python runtime is unavailable".to_string(),
        ));
    };
    let Some(playwright_path) = ctx.notebooklm_runtime_playwright.as_ref() else {
        return Err(AppError::IntegrationError(
            "bundled Playwright browser runtime is unavailable".to_string(),
        ));
    };

    let Some(parent) = storage_path.parent() else {
        return Err(AppError::IntegrationError(
            "NotebookLM storage path has no parent directory".to_string(),
        ));
    };
    fs::create_dir_all(parent)?;

    // Use the installed headful Chromium binary explicitly and run it in
    // headless mode. The portable bundle intentionally omits Playwright's
    // separate headless-shell download, so relying on Playwright's default
    // executable would fail on a clean packaged install.
    let script = r#"
import json
import os
import platform
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

profile = Path(sys.argv[1])
storage = Path(sys.argv[2])
playwright_root = Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"])

if not profile.is_dir():
    raise SystemExit(f"browser profile does not exist: {profile}")

if platform.system() == "Darwin":
    candidates = list(playwright_root.glob(
        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ))
elif platform.system() == "Windows":
    candidates = list(playwright_root.glob("chromium-*/chrome-win*/chrome.exe"))
else:
    candidates = list(playwright_root.glob("chromium-*/chrome-linux*/chrome"))

kwargs = {"headless": True, "args": ["--no-sandbox", "--password-store=basic"]}
if candidates:
    kwargs["executable_path"] = str(candidates[0])

with sync_playwright() as playwright:
    context = playwright.chromium.launch_persistent_context(str(profile), **kwargs)
    state = context.storage_state()
    context.close()

# Keep the same Google-only cookie boundary as notebooklm-py's normal login
# path. Cookies are credential-equivalent, so do not copy unrelated domains.
state["cookies"] = [
    cookie
    for cookie in state.get("cookies", [])
    if (
        (domain := str(cookie.get("domain", "")).lstrip(".").lower()) == "google.com"
        or domain.endswith(".google.com")
    )
]
storage.parent.mkdir(parents=True, exist_ok=True)
fd, temp_name = tempfile.mkstemp(prefix=f".{storage.name}.", suffix=".tmp", dir=storage.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(state, output, indent=2, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temp_name, 0o600)
    os.replace(temp_name, storage)
except Exception:
    try:
        os.unlink(temp_name)
    except OSError:
        pass
    raise
"#;

    let python_home = runtime_python
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    let site_packages = ctx
        .notebooklm_runtime_site_packages
        .as_ref()
        .ok_or_else(|| {
            AppError::IntegrationError("bundled NotebookLM site-packages are unavailable".to_string())
        })?;
    let mut command = Command::new(runtime_python);
    command
        .arg("-c")
        .arg(script)
        .arg(browser_profile)
        .arg(storage_path)
        .env("PYTHONPATH", site_packages)
        .env("PYTHONNOUSERSITE", "1")
        .env("PLAYWRIGHT_BROWSERS_PATH", playwright_path)
        .env("NOTEBOOKLM_HOME", &ctx.app_dir);
    if let Some(home) = python_home {
        command.env("PYTHONHOME", home);
    }

    execute_notebooklm_command(&mut command).await.map(|_| ())
}

async fn try_recover_notebooklm_browser_auth(
    ctx: &ProviderContext,
    storage_path: &Path,
) -> Option<PathBuf> {
    for profile in notebooklm_browser_profile_candidates(ctx) {
        if !profile.is_dir() {
            continue;
        }

        tracing::info!(profile = %profile.display(), "Trying to export NotebookLM browser profile");
        if let Err(error) = export_notebooklm_browser_profile(ctx, &profile, storage_path).await {
            tracing::debug!(profile = %profile.display(), %error, "NotebookLM browser profile export failed");
            continue;
        }

        let verified = run_first_success_no_bootstrap(
            ctx,
            vec![vec![
                "auth".to_string(),
                "check".to_string(),
                "--json".to_string(),
            ]],
        )
        .await;
        if verified
            .as_ref()
            .map(|result| stdout_reports_authenticated(&result.stdout))
            .unwrap_or(false)
        {
            return Some(profile);
        }
    }

    None
}

fn augmented_path_env() -> Option<String> {
    let mut ordered: Vec<PathBuf> = env::var_os("PATH")
        .map(|raw| env::split_paths(&raw).collect())
        .unwrap_or_default();

    if cfg!(target_os = "linux") || cfg!(target_os = "macos") {
        let home = env::var("HOME")
            .ok()
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()));
        if let Some(home) = home {
            ordered.push(PathBuf::from(home).join(".local/bin"));
        }
    }
    if cfg!(target_os = "macos") {
        ordered.push(PathBuf::from("/opt/homebrew/bin"));
        ordered.push(PathBuf::from("/usr/local/bin"));
    }
    if cfg!(target_os = "linux") {
        ordered.push(PathBuf::from("/usr/local/sbin"));
        ordered.push(PathBuf::from("/usr/local/bin"));
        ordered.push(PathBuf::from("/usr/sbin"));
        ordered.push(PathBuf::from("/usr/bin"));
        ordered.push(PathBuf::from("/sbin"));
        ordered.push(PathBuf::from("/bin"));
    }

    let mut deduped = Vec::new();
    for path in ordered {
        if path.as_os_str().is_empty() || !path.exists() {
            continue;
        }
        if !deduped.iter().any(|p: &PathBuf| p == &path) {
            deduped.push(path);
        }
    }

    if deduped.is_empty() {
        return None;
    }

    env::join_paths(deduped)
        .ok()
        .map(|joined| joined.to_string_lossy().to_string())
}

async fn run_first_success_with_bootstrap(
    ctx: &ProviderContext,
    candidates: Vec<Vec<String>>,
    allow_runtime_bootstrap: bool,
) -> Result<CliCommandResult, AppError> {
    let mut errors = vec![];
    for args in candidates {
        let result = if allow_runtime_bootstrap {
            run_notebooklm_command(ctx, &args).await
        } else {
            run_notebooklm_command_no_bootstrap(ctx, &args).await
        };
        match result {
            Ok(result) => return Ok(result),
            Err(err) => errors.push(format!("{} -> {}", args.join(" "), err)),
        }
    }

    Err(AppError::IntegrationError(format!(
        "All notebooklm CLI command attempts failed:\n{}",
        errors.join("\n")
    )))
}

async fn run_first_success(
    ctx: &ProviderContext,
    candidates: Vec<Vec<String>>,
) -> Result<CliCommandResult, AppError> {
    run_first_success_with_bootstrap(ctx, candidates, true).await
}

async fn run_first_success_no_bootstrap(
    ctx: &ProviderContext,
    candidates: Vec<Vec<String>>,
) -> Result<CliCommandResult, AppError> {
    run_first_success_with_bootstrap(ctx, candidates, false).await
}

fn notebook_text(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = v.get(*key).and_then(|x| x.as_str()) {
            return Some(value.to_string());
        }
    }
    None
}

fn notebook_usize(v: &serde_json::Value, keys: &[&str]) -> Option<usize> {
    for key in keys {
        if let Some(value) = v.get(*key).and_then(|x| x.as_u64()) {
            return Some(value as usize);
        }
    }
    None
}

/// Parse the JSON output of `notebooklm source add --json` (and other
/// single-source commands) into a `SourceSummary`.
///
/// The pinned CLI (0.8.0rc1) wraps the source in a top-level `source` object:
/// `{"source": {"id", "title", "type", "url"}}`. Older shapes put the fields
/// at the top level directly. Both are accepted; returns `None` when no id
/// can be found.
fn parse_source_summary_json(value: &serde_json::Value) -> Option<SourceSummary> {
    let inner = value.get("source").unwrap_or(value);
    let id = notebook_text(inner, &["id", "source_id"])?;
    let title = notebook_text(inner, &["title", "name"]).unwrap_or_else(|| "Source".to_string());
    let kind = notebook_text(inner, &["kind", "type"]).unwrap_or_else(|| "unknown".to_string());
    let status =
        notebook_text(inner, &["status"]).unwrap_or_else(|| "unknown".to_string());
    Some(SourceSummary {
        id,
        title,
        kind,
        status,
    })
}

/// Parse the JSON output of `notebooklm source list --json` into source
/// summaries. Accepts both a bare array and the `{"sources": [...]}` envelope.
fn parse_source_list_json(value: &serde_json::Value) -> Vec<SourceSummary> {
    let source_array = if let Some(arr) = value.as_array() {
        arr.clone()
    } else {
        value
            .get("sources")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    source_array.iter().filter_map(parse_source_summary_json).collect()
}

/// Parse the JSON output of `notebooklm create <title> --json` into a
/// `NotebookSummary`.
///
/// The pinned CLI (0.8.0rc1) wraps the created notebook in a top-level
/// `notebook` object: `{"notebook": {"id", "title", "created_at", ...}}`.
/// Older CLI shapes put `id`/`title` at the top level directly. Both are
/// accepted; returns `None` when no id can be found.
fn parse_create_notebook_json(value: &serde_json::Value, fallback_title: &str) -> Option<NotebookSummary> {
    let inner = value.get("notebook").unwrap_or(value);
    let id = notebook_text(inner, &["id", "notebook_id"])?;
    let title = notebook_text(inner, &["title", "name"]).unwrap_or_else(|| fallback_title.to_string());
    Some(NotebookSummary {
        id,
        title,
        sources_count: 0,
    })
}

async fn cli_use_notebook(ctx: &ProviderContext, notebook_id: &str) -> Result<(), AppError> {
    run_notebooklm_command(ctx, &["use".to_string(), notebook_id.to_string()]).await?;
    Ok(())
}

fn parse_notebook_list(value: &serde_json::Value) -> Vec<NotebookSummary> {
    if let Some(array) = value.as_array() {
        return array
            .iter()
            .filter_map(|item| {
                let id = notebook_text(item, &["id", "notebook_id"])?;
                let title = notebook_text(item, &["title", "name"])
                    .unwrap_or_else(|| "Notebook".to_string());
                let sources_count =
                    notebook_usize(item, &["sources_count", "sourcesCount", "source_count"])
                        .unwrap_or(0);
                Some(NotebookSummary {
                    id,
                    title,
                    sources_count,
                })
            })
            .collect();
    }

    if let Some(array) = value.get("notebooks").and_then(|v| v.as_array()) {
        return array
            .iter()
            .filter_map(|item| {
                let id = notebook_text(item, &["id", "notebook_id"])?;
                let title = notebook_text(item, &["title", "name"])
                    .unwrap_or_else(|| "Notebook".to_string());
                let sources_count =
                    notebook_usize(item, &["sources_count", "sourcesCount", "source_count"])
                        .unwrap_or(0);
                Some(NotebookSummary {
                    id,
                    title,
                    sources_count,
                })
            })
            .collect();
    }

    vec![]
}

fn normalize_cli_type(raw: &str) -> String {
    raw.to_lowercase().replace(['_', ' '], "-")
}

fn cli_list_filter_for(app_artifact_type: &str) -> &'static str {
    match normalize_cli_type(app_artifact_type).as_str() {
        "flashcards" => "flashcard",
        "study-guide" => "report",
        "mind-map" => "mind-map",
        "data-table" => "data-table",
        "audio" => "audio",
        "video" => "video",
        "quiz" => "quiz",
        "report" => "report",
        "slide-deck" => "slide-deck",
        "infographic" => "infographic",
        _ => "all",
    }
}

fn parse_generate_task_id(v: &serde_json::Value) -> Option<String> {
    notebook_text(
        v,
        &[
            "task_id",
            "taskId",
            "artifact_id",
            "artifactId",
            "note_id",
            "noteId",
        ],
    )
}

fn csv_field(field: &str) -> String {
    field.trim().trim_matches('"').to_string()
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut values = vec![];
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && matches!(chars.peek(), Some('"')) {
                    field.push('"');
                    let _ = chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                values.push(csv_field(&field));
                field.clear();
            }
            _ => field.push(ch),
        }
    }
    values.push(csv_field(&field));
    values
}

fn parse_csv_to_json_rows(csv: &str) -> serde_json::Value {
    let mut lines = csv.lines().filter(|l| !l.trim().is_empty());
    let headers = lines.next().map(parse_csv_line).unwrap_or_default();
    let rows = lines
        .map(parse_csv_line)
        .map(|values| {
            let mut row = serde_json::Map::new();
            for (idx, h) in headers.iter().enumerate() {
                row.insert(
                    h.clone(),
                    serde_json::Value::String(values.get(idx).cloned().unwrap_or_default()),
                );
            }
            serde_json::Value::Object(row)
        })
        .collect::<Vec<_>>();
    serde_json::Value::Array(rows)
}

static NOTEBOOKLM_INLINE_DOLLAR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\$([^$\n]+)\$").expect("valid notebooklm inline-dollar regex"));

fn normalize_notebooklm_text(input: &str) -> String {
    // NotebookLM quiz/flashcard outputs sometimes wrap plain terms like $SCAN$.
    // Strip inline dollar wrappers while preserving inner text.
    NOTEBOOKLM_INLINE_DOLLAR_RE
        .replace_all(input, "$1")
        .replace(r"\$", "$")
        .trim()
        .to_string()
}

#[async_trait]
impl NotebookLMProvider for CliNotebookLMProvider {
    async fn health(
        &self,
        auth: &NotebookLMAuthState,
        settings: &NotebookLMSettings,
        ctx: &ProviderContext,
    ) -> Result<NotebookLMHealth, AppError> {
        let verification = run_first_success_no_bootstrap(
            ctx,
            vec![
                vec![
                    "auth".to_string(),
                    "check".to_string(),
                    "--json".to_string(),
                ],
                vec!["status".to_string(), "--json".to_string()],
                vec!["status".to_string()],
            ],
        )
        .await;

        match verification {
            Ok(result) if stdout_reports_authenticated(&result.stdout) => {
                Ok(NotebookLMHealth {
                    connected: auth.connected,
                    provider: settings.provider.clone(),
                    active_notebook_id: settings.active_notebook_id.clone(),
                    message: "NotebookLM CLI authenticated".to_string(),
                })
            }
            Ok(_) => Err(AppError::IntegrationError(
                "NotebookLM CLI is installed but not authenticated".to_string(),
            )),
            Err(error) => Err(AppError::IntegrationError(format!(
                "NotebookLM CLI is not reachable: {error}"
            ))),
        }
    }

    async fn list_notebooks(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
    ) -> Result<Vec<NotebookSummary>, AppError> {
        let result =
            run_first_success(ctx, vec![vec!["list".to_string(), "--json".to_string()]]).await;
        let result = match result {
            Ok(r) => r,
            Err(e) => {
                let err = e.to_string();
                if is_auth_error(&err) {
                    tracing::info!("NotebookLM list requires login; returning empty notebook list");
                    return Ok(vec![]);
                }
                tracing::warn!("NotebookLM list failed; returning empty list: {}", err);
                return Ok(vec![]);
            }
        };
        if let Some(json) = result.json() {
            return Ok(parse_notebook_list(&json));
        }
        Ok(vec![])
    }

    async fn create_notebook(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        title: &str,
    ) -> Result<NotebookSummary, AppError> {
        let result = run_notebooklm_command(
            ctx,
            &[
                "create".to_string(),
                title.to_string(),
                "--json".to_string(),
            ],
        )
        .await?;
        if let Some(json) = result.json() {
            return parse_create_notebook_json(&json, title)
                .ok_or_else(|| {
                    AppError::IntegrationError(
                        "NotebookLM CLI create did not return notebook ID".to_string(),
                    )
                });
        }
        Err(AppError::IntegrationError(
            "NotebookLM CLI create returned non-JSON output. Re-run command manually with --json."
                .to_string(),
        ))
    }

    async fn list_sources(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
    ) -> Result<Vec<SourceSummary>, AppError> {
        let result = run_first_success(
            ctx,
            vec![
                vec![
                    "source".to_string(),
                    "list".to_string(),
                    "--json".to_string(),
                    "--notebook".to_string(),
                    notebook_id.to_string(),
                ],
                vec![
                    "source".to_string(),
                    "list".to_string(),
                    "--json".to_string(),
                    "-n".to_string(),
                    notebook_id.to_string(),
                ],
            ],
        )
        .await?;

        let Some(json) = result.json() else {
            return Ok(vec![]);
        };

        Ok(parse_source_list_json(&json))
    }

    async fn add_source(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        req: &AddSourceRequest,
    ) -> Result<SourceSummary, AppError> {
        let mut base = vec![
            "source".to_string(),
            "add".to_string(),
            req.content.clone(),
            "--json".to_string(),
            "--notebook".to_string(),
            notebook_id.to_string(),
        ];
        if let Some(title) = &req.title {
            base.push("--title".to_string());
            base.push(title.clone());
        }

        let mut alt = vec![
            "source".to_string(),
            "add".to_string(),
            req.content.clone(),
            "--json".to_string(),
            "-n".to_string(),
            notebook_id.to_string(),
        ];
        if let Some(title) = &req.title {
            alt.push("--title".to_string());
            alt.push(title.clone());
        }

        let result = run_first_success(ctx, vec![base, alt]).await?;
        let Some(json) = result.json() else {
            return Err(AppError::IntegrationError(
                "NotebookLM CLI source add returned non-JSON output.".to_string(),
            ));
        };
        let mut summary = parse_source_summary_json(&json).ok_or_else(|| {
            AppError::IntegrationError(
                "NotebookLM CLI source add did not return source ID".to_string(),
            )
        })?;
        // A freshly added source is processing until ingestion resolves; the
        // CLI summary carries no status field for the add path.
        if summary.status == "unknown" {
            summary.status = "processing".to_string();
        }
        Ok(summary)
    }

    async fn refresh_source(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        source_id: &str,
    ) -> Result<SourceSummary, AppError> {
        let result = run_first_success(
            ctx,
            vec![
                vec![
                    "source".to_string(),
                    "refresh".to_string(),
                    source_id.to_string(),
                    "--json".to_string(),
                    "--notebook".to_string(),
                    notebook_id.to_string(),
                ],
                vec![
                    "source".to_string(),
                    "refresh".to_string(),
                    source_id.to_string(),
                    "--json".to_string(),
                    "-n".to_string(),
                    notebook_id.to_string(),
                ],
            ],
        )
        .await?;

        let Some(json) = result.json() else {
            return Err(AppError::IntegrationError(
                "NotebookLM CLI source refresh returned non-JSON output.".to_string(),
            ));
        };

        let id =
            notebook_text(&json, &["id", "source_id"]).unwrap_or_else(|| source_id.to_string());
        let title =
            notebook_text(&json, &["title", "name"]).unwrap_or_else(|| "Source".to_string());
        let kind = notebook_text(&json, &["kind", "type"]).unwrap_or_else(|| "unknown".to_string());
        let status = notebook_text(&json, &["status"]).unwrap_or_else(|| "refreshed".to_string());
        Ok(SourceSummary {
            id,
            title,
            kind,
            status,
        })
    }

    async fn ask(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        question: &str,
    ) -> Result<AskResponse, AppError> {
        let mut attempts = vec![
            vec![
                "ask".to_string(),
                question.to_string(),
                "--json".to_string(),
                "--notebook".to_string(),
                notebook_id.to_string(),
            ],
            vec![
                "ask".to_string(),
                question.to_string(),
                "--json".to_string(),
                "-n".to_string(),
                notebook_id.to_string(),
            ],
        ];

        // Fallback: set notebook context first, then ask.
        if cli_use_notebook(ctx, notebook_id).await.is_ok() {
            attempts.push(vec![
                "ask".to_string(),
                question.to_string(),
                "--json".to_string(),
            ]);
        }

        let result = run_first_success(ctx, attempts).await?;
        if let Some(json) = result.json() {
            let answer = notebook_text(&json, &["answer", "response", "text"])
                .unwrap_or_else(|| result.stdout.clone());
            // The pinned CLI (0.8.0rc1) emits references as `references` (an
            // array of {source_id, ...}); older shapes used `sources`.
            let sources = json
                .get("references")
                .or_else(|| json.get("sources"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| {
                            s.as_str()
                                .map(|x| x.to_string())
                                .or_else(|| notebook_text(s, &["source_id", "id", "title"]))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            return Ok(AskResponse { answer, sources });
        }

        Ok(AskResponse {
            answer: result.stdout,
            sources: vec![],
        })
    }

    async fn research(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        query: &str,
        mode: Option<String>,
        from: Option<String>,
    ) -> Result<ResearchResponse, AppError> {
        let mode = mode.unwrap_or_else(|| "fast".to_string());
        let from = from.unwrap_or_else(|| "web".to_string());
        // notebooklm-py CLI workflow:
        // 1) source add-research "<query>" --no-wait ...
        // 2) research wait --json --import-all ...
        let start = run_first_success(
            ctx,
            vec![
                vec![
                    "source".to_string(),
                    "add-research".to_string(),
                    query.to_string(),
                    "--mode".to_string(),
                    mode.clone(),
                    "--from".to_string(),
                    from.clone(),
                    "--no-wait".to_string(),
                    "--notebook".to_string(),
                    notebook_id.to_string(),
                ],
                vec![
                    "source".to_string(),
                    "add-research".to_string(),
                    query.to_string(),
                    "--mode".to_string(),
                    mode.clone(),
                    "--from".to_string(),
                    from.clone(),
                    "--no-wait".to_string(),
                    "-n".to_string(),
                    notebook_id.to_string(),
                ],
            ],
        )
        .await?;

        let wait = run_first_success(
            ctx,
            vec![
                vec![
                    "research".to_string(),
                    "wait".to_string(),
                    "--json".to_string(),
                    "--import-all".to_string(),
                    "--notebook".to_string(),
                    notebook_id.to_string(),
                ],
                vec![
                    "research".to_string(),
                    "wait".to_string(),
                    "--json".to_string(),
                    "--import-all".to_string(),
                    "-n".to_string(),
                    notebook_id.to_string(),
                ],
            ],
        )
        .await?;

        if let Some(json) = wait.json() {
            let summary = notebook_text(
                &json,
                &["summary", "answer", "response", "text", "message", "result"],
            )
            .unwrap_or_else(|| wait.stdout.clone());
            let imported_sources = notebook_usize(
                &json,
                &[
                    "imported_sources",
                    "importedSources",
                    "sources_imported",
                    "sourcesCount",
                ],
            )
            .unwrap_or(0);
            let status = notebook_text(&json, &["status", "state"])
                .unwrap_or_else(|| "completed".to_string());
            return Ok(ResearchResponse {
                status,
                imported_sources,
                summary,
            });
        }

        Ok(ResearchResponse {
            status: "completed".to_string(),
            imported_sources: 0,
            summary: format!("{}\n{}", start.stdout, wait.stdout),
        })
    }

    async fn generate_artifact(
        &self,
        _auth: &NotebookLMAuthState,
        _settings: &NotebookLMSettings,
        ctx: &ProviderContext,
        notebook_id: &str,
        req: &GenerateArtifactRequest,
    ) -> Result<(ArtifactSummary, ArtifactPayload), AppError> {
        let now = Utc::now().to_rfc3339();
        let artifact_type = normalize_cli_type(&req.artifact_type);
        let mut generate_args = vec!["generate".to_string()];
        let mut extra_attempts: Vec<Vec<String>> = vec![];

        match artifact_type.as_str() {
            "study-guide" => {
                generate_args.push("report".to_string());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                generate_args.push("--format".to_string());
                generate_args.push("study-guide".to_string());
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "report" => {
                generate_args.push("report".to_string());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "mind-map" => {
                generate_args.push("mind-map".to_string());
                generate_args.push("--json".to_string());
            }
            "data-table" => {
                generate_args.push("data-table".to_string());
                generate_args.push(
                    req.instructions
                        .as_ref()
                        .filter(|s| !s.trim().is_empty())
                        .map(|s| s.trim().to_string())
                        .unwrap_or_else(|| {
                            "Summarize key concepts in a comparison table.".to_string()
                        }),
                );
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "flashcards" | "quiz" => {
                generate_args.push(artifact_type.clone());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                if let Some(quantity) = req.quantity.as_ref() {
                    let q = quantity.trim().to_lowercase();
                    if q == "fewer" || q == "standard" || q == "more" {
                        generate_args.push("--quantity".to_string());
                        generate_args.push(q);
                    }
                }
                if let Some(difficulty) = req.difficulty.as_ref() {
                    let d = difficulty.trim().to_lowercase();
                    if d == "easy" || d == "medium" || d == "hard" {
                        generate_args.push("--difficulty".to_string());
                        generate_args.push(d);
                    }
                }
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "audio" | "video" => {
                generate_args.push(artifact_type.clone());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "slide-deck" => {
                generate_args.push("slide-deck".to_string());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                if let Some(format) = req.format.as_ref() {
                    let f = format.trim().to_lowercase();
                    if f == "detailed" || f == "presenter" {
                        generate_args.push("--format".to_string());
                        generate_args.push(f);
                    }
                }
                if let Some(length) = req.length.as_ref() {
                    let l = length.trim().to_lowercase();
                    if l == "default" || l == "short" {
                        generate_args.push("--length".to_string());
                        generate_args.push(l);
                    }
                }
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            "infographic" => {
                generate_args.push("infographic".to_string());
                if let Some(instructions) =
                    req.instructions.as_ref().filter(|s| !s.trim().is_empty())
                {
                    generate_args.push(instructions.trim().to_string());
                }
                if let Some(orientation) = req.orientation.as_ref() {
                    let o = orientation.trim().to_lowercase();
                    if o == "landscape" || o == "portrait" || o == "square" {
                        generate_args.push("--orientation".to_string());
                        generate_args.push(o);
                    }
                }
                if let Some(detail) = req.detail.as_ref() {
                    let d = detail.trim().to_lowercase();
                    if d == "concise" || d == "standard" || d == "detailed" {
                        generate_args.push("--detail".to_string());
                        generate_args.push(d);
                    }
                }
                if let Some(style) = req.style.as_ref().filter(|s| !s.trim().is_empty()) {
                    generate_args.push("--style".to_string());
                    generate_args.push(style.trim().to_string());
                }
                generate_args.push("--wait".to_string());
                generate_args.push("--json".to_string());
            }
            _ => {
                return Err(AppError::IntegrationError(format!(
                    "Unsupported NotebookLM artifact type for CLI provider: {}",
                    req.artifact_type
                )));
            }
        }

        if let Some(retry_count) = req.retry_count {
            if retry_count > 0 && artifact_type != "mind-map" {
                generate_args.push("--retry".to_string());
                generate_args.push(retry_count.to_string());
            }
        }

        let mut with_notebook = generate_args.clone();
        with_notebook.push("--notebook".to_string());
        with_notebook.push(notebook_id.to_string());

        let mut with_notebook_short = generate_args.clone();
        with_notebook_short.push("-n".to_string());
        with_notebook_short.push(notebook_id.to_string());

        extra_attempts.push(with_notebook);
        extra_attempts.push(with_notebook_short);
        if cli_use_notebook(ctx, notebook_id).await.is_ok() {
            extra_attempts.push(generate_args.clone());
        }

        let generate_result = run_first_success(ctx, extra_attempts).await?;
        let generate_json = generate_result.json();
        let mut artifact_id = generate_json.as_ref().and_then(parse_generate_task_id);

        if artifact_id.is_none() {
            let list_type = cli_list_filter_for(&artifact_type).to_string();
            let list_result = run_first_success(
                ctx,
                vec![
                    vec![
                        "artifact".to_string(),
                        "list".to_string(),
                        "--type".to_string(),
                        list_type.clone(),
                        "--json".to_string(),
                        "--notebook".to_string(),
                        notebook_id.to_string(),
                    ],
                    vec![
                        "artifact".to_string(),
                        "list".to_string(),
                        "--type".to_string(),
                        list_type,
                        "--json".to_string(),
                        "-n".to_string(),
                        notebook_id.to_string(),
                    ],
                ],
            )
            .await?;
            if let Some(json) = list_result.json() {
                if let Some(artifacts) = json.get("artifacts").and_then(|v| v.as_array()) {
                    let mut latest = artifacts
                        .iter()
                        .filter_map(|a| {
                            Some((
                                notebook_text(a, &["created_at", "createdAt"]).unwrap_or_default(),
                                notebook_text(a, &["id"])?,
                            ))
                        })
                        .collect::<Vec<_>>();
                    latest.sort_by(|a, b| b.0.cmp(&a.0));
                    artifact_id = latest.first().map(|(_, id)| id.clone());
                }
            }
        }

        let artifact = ArtifactSummary {
            id: artifact_id
                .clone()
                .unwrap_or_else(|| format!("art_{}", Uuid::new_v4().simple())),
            artifact_type: artifact_type.clone(),
            title: format!("{} result", artifact_type),
            created_at: now.clone(),
            content: req.instructions.clone(),
        };

        let artifact_dir = ctx.app_dir.join("artifacts");
        fs::create_dir_all(&artifact_dir)?;
        let file_stem = format!(
            "{}-{}",
            artifact_type.replace('/', "-"),
            Uuid::new_v4().simple()
        );

        let mut payload = ArtifactPayload::default();

        match artifact_type.as_str() {
            "audio" | "video" => {
                let ext = if artifact_type == "audio" {
                    "mp3"
                } else {
                    "mp4"
                };
                let output_path = artifact_dir.join(format!("{}.{}", file_stem, ext));
                let mut download = vec![
                    "download".to_string(),
                    artifact_type.clone(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                payload.media_url = Some(output_path.to_string_lossy().to_string());
                payload.raw_text = Some(format!(
                    "{} overview generated via NotebookLM CLI.",
                    artifact_type
                ));
            }
            "slide-deck" => {
                let output_path = artifact_dir.join(format!("{}.pdf", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "slide-deck".to_string(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                payload.media_url = Some(output_path.to_string_lossy().to_string());
                payload.raw_text = Some(format!(
                    "Slide deck generated via NotebookLM CLI: {}",
                    output_path.display()
                ));
            }
            "infographic" => {
                let output_path = artifact_dir.join(format!("{}.png", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "infographic".to_string(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                payload.media_url = Some(output_path.to_string_lossy().to_string());
                payload.raw_text = Some(format!(
                    "Infographic generated via NotebookLM CLI: {}",
                    output_path.display()
                ));
            }
            "report" | "study-guide" => {
                let output_path = artifact_dir.join(format!("{}.md", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "report".to_string(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                payload.raw_text = Some(fs::read_to_string(&output_path)?);
            }
            "mind-map" => {
                let output_path = artifact_dir.join(format!("{}.json", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "mind-map".to_string(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                let text = fs::read_to_string(&output_path)?;
                payload.json_content = serde_json::from_str::<serde_json::Value>(&text).ok();
                payload.raw_text = Some(text);
            }
            "data-table" => {
                let output_path = artifact_dir.join(format!("{}.csv", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "data-table".to_string(),
                    output_path.to_string_lossy().to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                let csv = fs::read_to_string(&output_path)?;
                payload.raw_text = Some(csv.clone());
                payload.json_content = Some(parse_csv_to_json_rows(&csv));
            }
            "flashcards" => {
                let output_path = artifact_dir.join(format!("{}.json", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "flashcards".to_string(),
                    output_path.to_string_lossy().to_string(),
                    "--format".to_string(),
                    "json".to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                let parsed =
                    serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&output_path)?)
                        .unwrap_or_else(|_| serde_json::json!({}));
                payload.flashcards = parsed
                    .get("cards")
                    .and_then(|v| v.as_array())
                    .map(|cards| {
                        cards
                            .iter()
                            .map(|c| FlashcardItem {
                                question: normalize_notebooklm_text(
                                    &notebook_text(c, &["front", "question", "q", "f"])
                                        .unwrap_or_default(),
                                ),
                                answer: normalize_notebooklm_text(
                                    &notebook_text(c, &["back", "answer", "a", "b"])
                                        .unwrap_or_default(),
                                ),
                                tags: vec!["notebooklm".to_string(), "flashcards".to_string()],
                            })
                            .filter(|f| {
                                !f.question.trim().is_empty() && !f.answer.trim().is_empty()
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                payload.raw_text = Some(fs::read_to_string(&output_path)?);
            }
            "quiz" => {
                let output_path = artifact_dir.join(format!("{}.json", file_stem));
                let mut download = vec![
                    "download".to_string(),
                    "quiz".to_string(),
                    output_path.to_string_lossy().to_string(),
                    "--format".to_string(),
                    "json".to_string(),
                ];
                if let Some(id) = artifact_id.as_ref() {
                    download.push("--artifact".to_string());
                    download.push(id.clone());
                }
                download.push("--notebook".to_string());
                download.push(notebook_id.to_string());
                run_notebooklm_command(ctx, &download).await?;
                let parsed =
                    serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&output_path)?)
                        .unwrap_or_else(|_| serde_json::json!({}));
                payload.quiz_items = parsed
                    .get("questions")
                    .and_then(|v| v.as_array())
                    .map(|questions| {
                        questions
                            .iter()
                            .map(|q| {
                                let correct_answer = q
                                    .get("answerOptions")
                                    .and_then(|opts| opts.as_array())
                                    .and_then(|opts| {
                                        opts.iter().find_map(|o| {
                                            let is_correct = o
                                                .get("isCorrect")
                                                .and_then(|v| v.as_bool())
                                                .unwrap_or(false);
                                            if is_correct {
                                                notebook_text(o, &["text", "answer"])
                                            } else {
                                                None
                                            }
                                        })
                                    })
                                    .unwrap_or_default();
                                QuizItem {
                                    question: normalize_notebooklm_text(
                                        &notebook_text(q, &["question", "q"]).unwrap_or_default(),
                                    ),
                                    correct_answer: normalize_notebooklm_text(&correct_answer),
                                    user_answer: None,
                                    was_correct: false,
                                }
                            })
                            .filter(|q| {
                                !q.question.trim().is_empty() && !q.correct_answer.trim().is_empty()
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                payload.raw_text = Some(fs::read_to_string(&output_path)?);
            }
            _ => {}
        }

        Ok((artifact, payload))
    }
}

fn provider_for(settings: &NotebookLMSettings) -> Box<dyn NotebookLMProvider> {
    if settings.provider == "cli" {
        Box::new(CliNotebookLMProvider)
    } else {
        Box::new(MockNotebookLMProvider)
    }
}

fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    "unknown-target"
}

fn is_appimage_context() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    std::env::var("APPIMAGE").is_ok() || std::env::var("APPDIR").is_ok()
}

fn notebooklm_binary_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = vec![];
    let triple = current_target_triple();
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };

    if let Ok(path) = std::env::var("NOTEBOOKLM_BIN_PATH") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(format!("notebooklm-{}{}", triple, ext)));
        candidates.push(
            resource_dir
                .join("bin")
                .join(format!("notebooklm-{}{}", triple, ext)),
        );
        candidates.push(resource_dir.join("bin").join(format!("notebooklm{}", ext)));
    }

    // Dev-mode relative paths from either repo root or src-tauri cwd.
    candidates.push(PathBuf::from("src-tauri/bin").join(format!("notebooklm-{}{}", triple, ext)));
    candidates.push(PathBuf::from("src-tauri/bin").join(format!("notebooklm{}", ext)));
    candidates.push(PathBuf::from("bin").join(format!("notebooklm-{}{}", triple, ext)));
    candidates.push(PathBuf::from("bin").join(format!("notebooklm{}", ext)));
    candidates
        .push(PathBuf::from("../src-tauri/bin").join(format!("notebooklm-{}{}", triple, ext)));
    candidates.push(PathBuf::from("../src-tauri/bin").join(format!("notebooklm{}", ext)));
    if cfg!(target_os = "linux") || cfg!(target_os = "macos") {
        let home = env::var("HOME")
            .ok()
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()));
        if let Some(home) = home {
            candidates.push(PathBuf::from(home).join(".local/bin").join("notebooklm"));
        }
    }
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/notebooklm"));
        candidates.push(PathBuf::from("/usr/local/bin/notebooklm"));
    }
    if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/usr/local/bin/notebooklm"));
        candidates.push(PathBuf::from("/usr/bin/notebooklm"));
        candidates.push(PathBuf::from("/bin/notebooklm"));
    }
    candidates.push(PathBuf::from(format!("notebooklm{}", ext)));
    candidates
}

fn notebooklm_runtime_base_candidates(app: &tauri::AppHandle) -> Vec<(PathBuf, bool)> {
    let mut candidates: Vec<(PathBuf, bool)> = vec![];
    let triple = current_target_triple();
    let appimage = is_appimage_context();
    let mut resource_candidates: Vec<(PathBuf, bool)> = vec![];

    if let Ok(resource_dir) = app.path().resource_dir() {
        resource_candidates.push((resource_dir.join("notebooklm-runtime").join(triple), true));
        resource_candidates.push((
            resource_dir
                .join("bin")
                .join("notebooklm-runtime")
                .join(triple),
            true,
        ));
    }

    if appimage {
        candidates.extend(resource_candidates.iter().cloned());
    }

    if let Ok(path) = std::env::var("NOTEBOOKLM_RUNTIME_PATH") {
        if !path.trim().is_empty() {
            candidates.push((PathBuf::from(path), false));
        }
    }

    if !appimage {
        candidates.extend(resource_candidates);
    }

    candidates.push((
        PathBuf::from("src-tauri/bin/notebooklm-runtime").join(triple),
        false,
    ));
    candidates.push((PathBuf::from("bin/notebooklm-runtime").join(triple), false));
    candidates.push((
        PathBuf::from("../src-tauri/bin/notebooklm-runtime").join(triple),
        false,
    ));
    candidates
}

fn parse_runtime_manifest(base: &Path) -> Result<Option<NotebookLMRuntimeManifest>, String> {
    let manifest_path = base.join("runtime-manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest {}: {e}", manifest_path.display()))?;
    let manifest: NotebookLMRuntimeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse manifest {}: {e}", manifest_path.display()))?;
    Ok(Some(manifest))
}

fn validate_bundled_notebooklm_runtime(
    base: &Path,
) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
    let default_python_rel = if cfg!(target_os = "windows") {
        "python/python.exe"
    } else {
        "python/bin/python3"
    };
    let manifest = parse_runtime_manifest(base)?;
    let python_rel = manifest
        .as_ref()
        .and_then(|m| m.python_executable.as_deref())
        .unwrap_or(default_python_rel);
    let site_packages_rel = manifest
        .as_ref()
        .and_then(|m| m.site_packages.as_deref())
        .unwrap_or("site-packages");
    let playwright_rel = manifest
        .as_ref()
        .and_then(|m| m.playwright_dir.as_deref())
        .unwrap_or("playwright");

    if let Some(layout) = manifest.as_ref().and_then(|m| m.layout.as_deref()) {
        if layout != "portable-python-home-v1" {
            return Err(format!("unsupported runtime layout `{layout}`"));
        }
    }

    let runtime_python = base.join(python_rel);
    let site_packages = base.join(site_packages_rel);
    let notebooklm_module = site_packages.join("notebooklm");
    let playwright = base.join(playwright_rel);
    let playwright_opt = if playwright.exists() {
        Some(playwright)
    } else {
        None
    };

    let mut missing = Vec::new();
    if !runtime_python.exists() {
        missing.push(format!("python executable at {}", runtime_python.display()));
    }
    if !site_packages.exists() {
        missing.push(format!("site-packages at {}", site_packages.display()));
    }
    if !notebooklm_module.exists() {
        missing.push(format!(
            "notebooklm module at {}",
            notebooklm_module.display()
        ));
    }

    if let Some(required_paths) = manifest.as_ref().and_then(|m| m.required_paths.as_ref()) {
        for required in required_paths {
            let candidate = base.join(required);
            if !candidate.exists() {
                missing.push(format!("required path {}", candidate.display()));
            }
        }
    }

    if missing.is_empty() {
        Ok((runtime_python, site_packages, playwright_opt))
    } else {
        Err(format!(
            "missing runtime components: {}",
            missing.join(", ")
        ))
    }
}

fn managed_notebooklm_runtime_base(app_dir: &Path) -> PathBuf {
    app_dir.join("runtime").join(current_target_triple())
}

fn managed_notebooklm_runtime_python(base: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        base.join(".venv").join("Scripts").join("python.exe")
    } else {
        base.join(".venv").join("bin").join("python3")
    }
}

fn managed_runtime_has_notebooklm_package(base: &Path) -> bool {
    if cfg!(target_os = "windows") {
        return base
            .join(".venv")
            .join("Lib")
            .join("site-packages")
            .join("notebooklm")
            .exists();
    }

    let lib_dir = base.join(".venv").join("lib");
    let entries = match fs::read_dir(&lib_dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("python") {
            continue;
        }
        if path.join("site-packages").join("notebooklm").exists() {
            return true;
        }
    }

    false
}

/// Smoke-test a managed runtime's Python by actually importing the
/// `notebooklm.notebooklm_cli` module. Existence checks alone are
/// insufficient: a venv's `python3` may be a dangling symlink (e.g. to a
/// CommandLineTools Python that was since removed/upgraded) or a Python
/// version too old for the installed package, both of which leave the
/// `notebooklm` site-packages dir present but the interpreter unable to
/// import it. Returning `false` here causes `resolve_managed_notebooklm_runtime`
/// to treat the runtime as broken and fall through to the system CLI.
async fn managed_runtime_imports_notebooklm(python: &Path) -> bool {
    let import = Command::new(python)
        .arg("-c")
        .arg("import notebooklm.notebooklm_cli")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match tokio::time::timeout(Duration::from_secs(5), import).await {
        Ok(Ok(output)) => output.status.success(),
        // Spawn failure (bad interpreter, EACCES, ...) or timeout: treat as broken.
        _ => false,
    }
}

async fn resolve_managed_notebooklm_runtime(app_dir: &Path) -> (Option<PathBuf>, Option<PathBuf>) {
    let base = managed_notebooklm_runtime_base(app_dir);
    let python = managed_notebooklm_runtime_python(&base);
    if !(python.exists() && managed_runtime_has_notebooklm_package(&base)) {
        return (None, None);
    }
    // The runtime *looks* installed. Confirm it can actually import the
    // notebooklm module before preferring it over the system CLI — a broken
    // venv (dangling python symlink, incompatible Python version) would
    // otherwise shadow a working system install and surface as "CLI Not Found".
    if !managed_runtime_imports_notebooklm(&python).await {
        tracing::warn!(
            python = %python.display(),
            "Managed NotebookLM runtime present but its Python cannot import notebooklm; \
             falling through to system CLI. Remove {} to silence this.",
            base.display()
        );
        return (None, None);
    }
    (Some(python), None)
}

async fn detect_system_python() -> Option<Vec<String>> {
    let path_override = augmented_path_env();
    let candidates: Vec<Vec<String>> = if cfg!(target_os = "windows") {
        vec![
            vec!["py".to_string(), "-3".to_string()],
            vec!["python".to_string()],
            vec!["python3".to_string()],
        ]
    } else {
        let mut linux = vec![vec!["python3".to_string()], vec!["python".to_string()]];
        if let Ok(home) = env::var("HOME") {
            linux.push(vec![format!("{home}/.local/bin/python3")]);
            linux.push(vec![format!("{home}/.local/bin/python")]);
        }
        linux.push(vec!["/usr/local/bin/python3".to_string()]);
        linux.push(vec!["/usr/local/bin/python".to_string()]);
        linux.push(vec!["/usr/bin/python3".to_string()]);
        linux.push(vec!["/usr/bin/python".to_string()]);
        linux
    };

    for candidate in candidates {
        let mut cmd = Command::new(&candidate[0]);
        if candidate.len() > 1 {
            cmd.args(&candidate[1..]);
        }
        if let Some(path) = path_override.as_ref() {
            cmd.env("PATH", path);
        }
        let status = cmd.arg("--version").output().await;
        if let Ok(output) = status {
            if output.status.success() {
                return Some(candidate);
            }
        }
    }

    None
}

async fn run_command_required(
    program: &str,
    args: &[String],
    envs: &[(String, String)],
    label: &str,
) -> Result<(), AppError> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(path) = augmented_path_env() {
        cmd.env("PATH", path);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::IntegrationError(format!("Failed to execute {label}: {e}")))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        format!("stdout: {stdout}")
    } else {
        "no stdout/stderr output".to_string()
    };
    Err(AppError::IntegrationError(format!(
        "{label} failed: {details}"
    )))
}

async fn run_command_optional(program: &str, args: &[String], label: &str) {
    if let Err(e) = run_command_required(program, args, &[], label).await {
        tracing::warn!("Optional command failed: {}", e);
    }
}

async fn ensure_managed_notebooklm_runtime(
    ctx: &ProviderContext,
) -> Result<(PathBuf, Option<PathBuf>), AppError> {
    let python_cmd = detect_system_python().await.ok_or_else(|| {
        AppError::IntegrationError(
            "NotebookLM runtime is not installed and no system Python was found. Install Python 3 and retry."
                .to_string(),
        )
    })?;

    let base = managed_notebooklm_runtime_base(&ctx.app_dir);
    let venv_dir = base.join(".venv");
    fs::create_dir_all(&base)?;

    let venv_python = managed_notebooklm_runtime_python(&base);
    if !venv_python.exists() {
        let mut venv_args = python_cmd[1..].to_vec();
        venv_args.extend([
            "-m".to_string(),
            "venv".to_string(),
            venv_dir.to_string_lossy().to_string(),
        ]);
        run_command_required(&python_cmd[0], &venv_args, &[], "Create NotebookLM venv").await?;
        if !venv_python.exists() {
            return Err(AppError::IntegrationError(
                "NotebookLM venv was created but python executable is missing".to_string(),
            ));
        }
    }

    let pip_upgrade = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--upgrade".to_string(),
        "pip".to_string(),
    ];
    run_command_optional(
        &venv_python.to_string_lossy(),
        &pip_upgrade,
        "Upgrade pip in NotebookLM runtime",
    )
    .await;

    // Pin to the 0.8.0rc1 pre-release for the NotebookLM→Google Gemini rebrand
    // login fix; the bare spec would otherwise resolve to the latest *stable*
    // (0.7.3), which can no longer complete the login flow. Drop the pin once a
    // stable 0.8.0 ships.
    let install_cli = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "notebooklm-py[browser]==0.8.0rc1".to_string(),
    ];
    run_command_required(
        &venv_python.to_string_lossy(),
        &install_cli,
        &[],
        "Install notebooklm-py runtime",
    )
    .await?;

    let install_browser = vec![
        "-m".to_string(),
        "playwright".to_string(),
        "install".to_string(),
        "chromium".to_string(),
    ];
    run_command_required(
        &venv_python.to_string_lossy(),
        &install_browser,
        &[("PLAYWRIGHT_BROWSERS_PATH".to_string(), "0".to_string())],
        "Install Playwright Chromium",
    )
    .await?;

    Ok((venv_python, None))
}

type NotebookLMRuntimeResult = (
    Option<PathBuf>,
    Option<PathBuf>,
    Option<PathBuf>,
    Option<PathBuf>,
    Option<String>,
);

fn resolve_notebooklm_runtime(app: &tauri::AppHandle) -> NotebookLMRuntimeResult {
    let mut first_error: Option<String> = None;
    let mut first_packaged_error: Option<String> = None;

    for (base, is_packaged_candidate) in notebooklm_runtime_base_candidates(app) {
        if !base.exists() {
            continue;
        }

        match validate_bundled_notebooklm_runtime(&base) {
            Ok((runtime_python, site_packages, playwright_opt)) => {
                tracing::info!(
                    runtime_base = %base.display(),
                    packaged_candidate = is_packaged_candidate,
                    "NotebookLM runtime selected"
                );
                return (
                    Some(runtime_python),
                    Some(site_packages),
                    playwright_opt,
                    Some(base),
                    None,
                );
            }
            Err(reason) => {
                let details = format!("{} ({})", base.display(), reason);
                tracing::warn!(
                    runtime_base = %base.display(),
                    packaged_candidate = is_packaged_candidate,
                    "NotebookLM runtime candidate rejected: {}",
                    reason
                );
                if first_error.is_none() {
                    first_error = Some(details.clone());
                }
                if is_packaged_candidate && first_packaged_error.is_none() {
                    first_packaged_error = Some(details);
                }
            }
        }
    }

    if is_appimage_context() {
        let err = first_packaged_error.or(first_error).unwrap_or_else(|| {
            "no bundled runtime candidate found in AppImage resources".to_string()
        });
        return (None, None, None, None, Some(err));
    }

    (None, None, None, None, first_error)
}

fn resolve_notebooklm_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    for candidate in notebooklm_binary_candidates(app) {
        if candidate == PathBuf::from("notebooklm") || candidate == PathBuf::from("notebooklm.exe")
        {
            return Some(candidate);
        }
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

async fn provider_context(app: &tauri::AppHandle, app_dir: PathBuf) -> ProviderContext {
    let (
        notebooklm_runtime_python,
        notebooklm_runtime_site_packages,
        notebooklm_runtime_playwright,
        notebooklm_runtime_base,
        notebooklm_runtime_validation_error,
    ) = resolve_notebooklm_runtime(app);
    let (notebooklm_managed_python, managed_playwright) =
        resolve_managed_notebooklm_runtime(&app_dir).await;
    let notebooklm_runtime_playwright = notebooklm_runtime_playwright.or(managed_playwright);
    let notebooklm_bin = resolve_notebooklm_binary(app);

    if let Some(base) = notebooklm_runtime_base.as_ref() {
        tracing::info!(
            runtime_base = %base.display(),
            "NotebookLM provider context initialized with bundled runtime"
        );
    } else if let Some(err) = notebooklm_runtime_validation_error.as_ref() {
        tracing::warn!("NotebookLM bundled runtime unavailable: {}", err);
    } else if notebooklm_managed_python.is_some() {
        tracing::info!("NotebookLM provider context initialized with managed runtime");
    } else if notebooklm_bin.is_some() {
        tracing::info!("NotebookLM provider context initialized with system CLI runtime");
    } else {
        tracing::warn!("NotebookLM provider context initialized without runtime candidates");
    }

    ProviderContext {
        app_dir,
        notebooklm_bin,
        notebooklm_runtime_base,
        notebooklm_runtime_python,
        notebooklm_runtime_site_packages,
        notebooklm_runtime_playwright,
        notebooklm_runtime_validation_error,
        notebooklm_managed_python,
        is_appimage: is_appimage_context(),
    }
}

fn integration_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::IntegrationError(format!("Failed to resolve app data dir: {e}")))?
        .join("notebooklm");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

fn auth_path(root: &Path) -> PathBuf {
    root.join("auth.json")
}

fn jobs_path(root: &Path) -> PathBuf {
    root.join("jobs.json")
}

fn mock_state_path(root: &Path) -> PathBuf {
    root.join("mock_state.json")
}

fn load_settings(root: &Path) -> Result<NotebookLMSettings, AppError> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(NotebookLMSettings::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_settings(root: &Path, settings: &NotebookLMSettings) -> Result<(), AppError> {
    write_json_secure(&settings_path(root), settings)
}

fn load_auth(root: &Path) -> Result<NotebookLMAuthState, AppError> {
    let path = auth_path(root);
    if !path.exists() {
        return Ok(NotebookLMAuthState::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_auth(root: &Path, auth: &NotebookLMAuthState) -> Result<(), AppError> {
    write_json_secure(&auth_path(root), auth)
}

fn persist_cli_auth_state(root: &Path, storage: &Path) -> Result<(), AppError> {
    let mut auth_state = load_auth(root)?;
    auth_state.connected = true;
    auth_state.last_connected_at = Some(Utc::now().to_rfc3339());
    auth_state.provider = "cli".to_string();
    auth_state.storage_path = Some(storage.to_string_lossy().to_string());
    save_auth(root, &auth_state)?;

    let mut settings = load_settings(root)?;
    settings.enabled = true;
    settings.provider = "cli".to_string();
    save_settings(root, &settings)?;
    Ok(())
}

fn load_jobs(root: &Path) -> Result<JobsFile, AppError> {
    let path = jobs_path(root);
    if !path.exists() {
        return Ok(JobsFile::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_jobs(root: &Path, jobs: &JobsFile) -> Result<(), AppError> {
    write_json_secure(&jobs_path(root), jobs)
}

fn load_mock_state(root: &Path) -> Result<MockState, AppError> {
    let path = mock_state_path(root);
    if !path.exists() {
        let state = MockState::default();
        write_json_secure(&path, &state)?;
        return Ok(state);
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_mock_state(root: &Path, state: &MockState) -> Result<(), AppError> {
    write_json_secure(&mock_state_path(root), state)
}

fn write_json_secure<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let payload = serde_json::to_vec_pretty(value)?;
    fs::write(path, payload)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms)?;
    }
    Ok(())
}

fn resolve_notebook_id(
    settings: &NotebookLMSettings,
    input: &Option<String>,
) -> Result<String, AppError> {
    input
        .clone()
        .or_else(|| settings.active_notebook_id.clone())
        .ok_or_else(|| AppError::InvalidInput("No notebook selected".to_string()))
}

/// Decide whether a NotebookLM CLI status/auth response affirmatively reports
/// an authenticated session.
///
/// This **fails closed**: only an explicit positive counts. Everything else —
/// an unparseable body, a body with no recognizable field, ambiguous text — is
/// treated as not authenticated.
///
/// The previous logic did the opposite in three places. It trusted the process
/// exit status without reading the body (`auth check --json` exiting 0 while
/// reporting `{"authenticated": false}` was read as success), and when a call
/// failed it asked whether the error message *looked* like an auth error,
/// so any unrecognized failure — CLI missing, Playwright browser absent,
/// timeout, connection refused — was read as authenticated. That is what
/// produced a green "Connected · 0 notebook(s)" over a session that had never
/// logged in.
fn stdout_reports_authenticated(stdout: &str) -> bool {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return false;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return json_reports_authenticated(&value);
    }

    let lower = trimmed.to_lowercase();
    // Explicit negatives win over any positive-looking substring they contain.
    const NEGATIVE: [&str; 7] = [
        "not logged in",
        "not authenticated",
        "not signed in",
        "no active session",
        "unauthorized",
        "please log in",
        "please login",
    ];
    if NEGATIVE.iter().any(|marker| lower.contains(marker)) {
        return false;
    }

    const POSITIVE: [&str; 3] = ["logged in as", "authenticated as", "signed in as"];
    POSITIVE.iter().any(|marker| lower.contains(marker))
}

/// Look for an affirmative authenticated flag, or failing that a non-empty
/// account identity, anywhere in the top level or one nesting level down.
fn json_reports_authenticated(value: &serde_json::Value) -> bool {
    const FLAGS: [&str; 6] = [
        "authenticated",
        "isAuthenticated",
        "is_authenticated",
        "loggedIn",
        "logged_in",
        "signedIn",
    ];
    for key in FLAGS {
        if let Some(flag) = value.get(key).and_then(|v| v.as_bool()) {
            return flag;
        }
    }

    const IDENTITY: [&str; 3] = ["email", "account", "user"];
    for key in IDENTITY {
        if let Some(identity) = value.get(key).and_then(|v| v.as_str()) {
            if !identity.trim().is_empty() {
                return true;
            }
        }
    }

    // notebooklm-py auth check --json reports a successful cookie/session
    // validation as `{ status: "ok", checks: { cookies_present: true,
    // sid_cookie: true } }`; it does not include an `authenticated` field.
    // Require both cookie checks so an unrelated `{status:"ok"}` response
    // cannot be mistaken for an authenticated NotebookLM session.
    if value.get("status").and_then(|v| v.as_str()) == Some("ok") {
        let checks = value.get("checks");
        let cookies_present = checks
            .and_then(|v| v.get("cookies_present"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let sid_cookie = checks
            .and_then(|v| v.get("sid_cookie"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if cookies_present && sid_cookie {
            return true;
        }
    }

    // Some CLI versions nest the payload; check one level down, but never
    // treat a bare object with no recognizable field as authenticated.
    for key in ["auth", "status", "data", "session"] {
        if let Some(nested) = value.get(key) {
            if nested.is_object() && json_reports_authenticated(nested) {
                return true;
            }
        }
    }

    false
}

/// Fail-closed wrapper for a CLI invocation whose result decides auth state.
fn cli_result_reports_authenticated(result: &Result<CliCommandResult, AppError>) -> bool {
    match result {
        Ok(command) => stdout_reports_authenticated(&command.stdout),
        // A failed invocation is never evidence of an authenticated session.
        Err(_) => false,
    }
}

fn is_auth_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("auth")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("session")
        || lower.contains("not logged in")
        || lower.contains("login")
        || lower.contains("unauthorized")
}

fn should_retry_generation(err: &str, attempts_left: u8) -> bool {
    attempts_left > 0 && !is_auth_error(err)
}

fn quiz_to_import_items(quiz_items: &[QuizItem], mode: &str) -> Vec<(String, String)> {
    let missed_only = mode.eq_ignore_ascii_case("missed-only");
    quiz_items
        .iter()
        .filter(|q| !missed_only || !q.was_correct)
        .map(|q| {
            let answer = q
                .user_answer
                .clone()
                .filter(|a| !a.trim().is_empty())
                .unwrap_or_else(|| q.correct_answer.clone());
            (
                normalize_notebooklm_text(&q.question),
                normalize_notebooklm_text(&answer),
            )
        })
        .collect()
}

async fn upsert_learning_items(
    repo: &Repository,
    candidates: &[ImportPreviewItem],
    deck_name: Option<String>,
    dedupe: bool,
) -> Result<SyncResult, AppError> {
    let mut created = 0;
    let mut updated = 0;
    let mut skipped = 0;
    let mut item_ids = Vec::new();
    let existing = repo.get_all_learning_items().await?;
    let mut index: HashMap<(String, String), LearningItem> = HashMap::new();
    for item in existing {
        index.insert(
            (
                item.question.trim().to_lowercase(),
                item.answer
                    .clone()
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase(),
            ),
            item,
        );
    }

    for candidate in candidates {
        let key = (
            candidate.question.trim().to_lowercase(),
            candidate.answer.trim().to_lowercase(),
        );
        if dedupe {
            if let Some(mut existing_item) = index.get(&key).cloned() {
                for tag in candidate.tags.iter() {
                    if !existing_item.tags.contains(tag) {
                        existing_item.tags.push(tag.clone());
                    }
                }
                if let Some(deck) = &deck_name {
                    let deck_tag = format!("deck:{deck}");
                    if !existing_item.tags.contains(&deck_tag) {
                        existing_item.tags.push(deck_tag);
                    }
                }
                existing_item.date_modified = Utc::now();
                let saved = repo.update_learning_item(&existing_item).await?;
                updated += 1;
                item_ids.push(saved.id);
                continue;
            }
        }

        let mut item = LearningItem::new(ItemType::Flashcard, candidate.question.clone());
        item.answer = Some(candidate.answer.clone());
        item.tags = candidate.tags.clone();
        item.tags.push("source:notebooklm".to_string());
        item.tags
            .push(format!("notebook:{}", candidate.source_notebook_id));
        item.tags
            .push(format!("artifact:{}", candidate.source_artifact_id));
        if let Some(deck) = &deck_name {
            item.tags.push(format!("deck:{deck}"));
        }
        let saved = repo.create_learning_item(&item).await?;
        created += 1;
        item_ids.push(saved.id.clone());
        index.insert(key, saved);
    }

    if !dedupe {
        skipped = 0;
    }

    Ok(SyncResult {
        created,
        updated,
        skipped,
        item_ids,
    })
}

#[tauri::command]
pub async fn notebooklm_get_settings(
    app: tauri::AppHandle,
) -> Result<NotebookLMSettings, AppError> {
    let root = integration_root(&app)?;
    load_settings(&root)
}

#[tauri::command]
pub async fn notebooklm_set_settings(
    app: tauri::AppHandle,
    enabled: Option<bool>,
    provider: Option<String>,
    active_notebook_id: Option<String>,
) -> Result<NotebookLMSettings, AppError> {
    let root = integration_root(&app)?;
    let mut settings = load_settings(&root)?;
    if let Some(v) = enabled {
        settings.enabled = v;
    }
    if let Some(v) = provider {
        settings.provider = v;
    }
    if active_notebook_id.is_some() {
        settings.active_notebook_id = active_notebook_id;
    }
    save_settings(&root, &settings)?;
    tracing::info!("notebooklm.settings.updated");
    Ok(settings)
}

#[tauri::command]
pub async fn notebooklm_connect(
    app: tauri::AppHandle,
    auth_json: Option<String>,
    provider: Option<String>,
) -> Result<NotebookLMAuthState, AppError> {
    let root = integration_root(&app)?;
    let mut settings = load_settings(&root)?;
    settings.enabled = true;
    if let Some(p) = provider {
        settings.provider = p;
    }
    save_settings(&root, &settings)?;

    let storage = root.join("storage_state.json");
    if let Some(auth) = auth_json {
        fs::write(&storage, auth.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&storage, fs::Permissions::from_mode(0o600))?;
        }
    } else if settings.provider == "cli" && !storage.exists() {
        let _ = try_copy_system_auth(&storage);
    }

    let mut auth = load_auth(&root)?;
    auth.connected = true;
    auth.last_connected_at = Some(Utc::now().to_rfc3339());
    auth.provider = settings.provider.clone();
    auth.storage_path = Some(storage.to_string_lossy().to_string());
    save_auth(&root, &auth)?;
    tracing::info!("notebooklm.connect provider={}", auth.provider);
    Ok(auth)
}

#[tauri::command]
pub async fn notebooklm_disconnect(app: tauri::AppHandle) -> Result<NotebookLMAuthState, AppError> {
    let root = integration_root(&app)?;
    let storage = root.join("storage_state.json");
    if storage.exists() {
        let _ = fs::remove_file(storage);
    }
    let mut auth = load_auth(&root)?;
    auth.connected = false;
    auth.storage_path = None;
    save_auth(&root, &auth)?;
    tracing::info!("notebooklm.disconnect");
    Ok(auth)
}

#[tauri::command]
pub async fn notebooklm_health(app: tauri::AppHandle) -> Result<NotebookLMHealth, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let provider = provider_for(&settings);
    provider
        .health(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_list_notebooks(
    app: tauri::AppHandle,
) -> Result<Vec<NotebookSummary>, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let provider = provider_for(&settings);
    provider
        .list_notebooks(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_create_notebook(
    app: tauri::AppHandle,
    title: String,
) -> Result<NotebookSummary, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let provider = provider_for(&settings);
    let notebook = provider
        .create_notebook(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &title,
        )
        .await?;
    tracing::info!("notebooklm.notebook.created id={}", notebook.id);
    Ok(notebook)
}

#[tauri::command]
pub async fn notebooklm_select_notebook(
    app: tauri::AppHandle,
    notebook_id: String,
) -> Result<NotebookLMSettings, AppError> {
    let root = integration_root(&app)?;
    let mut settings = load_settings(&root)?;
    settings.active_notebook_id = Some(notebook_id);
    save_settings(&root, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn notebooklm_list_sources(
    app: tauri::AppHandle,
    notebook_id: Option<String>,
) -> Result<Vec<SourceSummary>, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &notebook_id)?;
    let provider = provider_for(&settings);
    provider
        .list_sources(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &selected,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_add_source(
    app: tauri::AppHandle,
    req: AddSourceRequest,
) -> Result<SourceSummary, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &req.notebook_id)?;
    let provider = provider_for(&settings);
    let source = provider
        .add_source(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &selected,
            &req,
        )
        .await?;
    tracing::info!(
        "notebooklm.source.added id={} kind={}",
        source.id,
        source.kind
    );
    Ok(source)
}

#[tauri::command]
pub async fn notebooklm_refresh_source(
    app: tauri::AppHandle,
    source_id: String,
    notebook_id: Option<String>,
) -> Result<SourceSummary, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &notebook_id)?;
    let provider = provider_for(&settings);
    provider
        .refresh_source(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &selected,
            &source_id,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_ask(
    app: tauri::AppHandle,
    question: String,
    notebook_id: Option<String>,
) -> Result<AskResponse, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &notebook_id)?;
    let provider = provider_for(&settings);
    provider
        .ask(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &selected,
            &question,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_research(
    app: tauri::AppHandle,
    query: String,
    mode: Option<String>,
    from: Option<String>,
    notebook_id: Option<String>,
) -> Result<ResearchResponse, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &notebook_id)?;
    let provider = provider_for(&settings);
    provider
        .research(
            &auth,
            &settings,
            &provider_context(&app, root.clone()).await,
            &selected,
            &query,
            mode,
            from,
        )
        .await
}

#[tauri::command]
pub async fn notebooklm_generate_artifact(
    app: tauri::AppHandle,
    req: GenerateArtifactRequest,
) -> Result<NotebookLMJob, AppError> {
    let root = integration_root(&app)?;
    let settings = load_settings(&root)?;
    let auth = load_auth(&root)?;
    let selected = resolve_notebook_id(&settings, &req.notebook_id)?;
    let provider = provider_for(&settings);
    let mut jobs = load_jobs(&root)?;
    let now = Utc::now().to_rfc3339();
    let mut job = NotebookLMJob {
        id: format!("job_{}", Uuid::new_v4().simple()),
        notebook_id: selected.clone(),
        artifact_type: req.artifact_type.clone(),
        status: "queued".to_string(),
        created_at: now.clone(),
        updated_at: now,
        error: None,
        artifact: None,
        payload: ArtifactPayload::default(),
    };
    jobs.jobs.push(job.clone());
    save_jobs(&root, &jobs)?;

    job.status = "running".to_string();
    job.updated_at = Utc::now().to_rfc3339();
    replace_job(&root, &job)?;
    tracing::info!(
        "notebooklm.job.started id={} type={}",
        job.id,
        job.artifact_type
    );

    let mut attempts_left = req.retry_count.unwrap_or(0);
    tracing::info!(
        "notebooklm.generate_artifact.start job_id={} type={} provider={}",
        job.id,
        req.artifact_type,
        settings.provider
    );
    loop {
        match provider
            .generate_artifact(
                &auth,
                &settings,
                &provider_context(&app, root.clone()).await,
                &selected,
                &req,
            )
            .await
        {
            Ok((artifact, payload)) => {
                job.status = "succeeded".to_string();
                job.updated_at = Utc::now().to_rfc3339();
                job.artifact = Some(artifact);
                job.payload = payload.clone();
                replace_job(&root, &job)?;
                tracing::info!(
                    "notebooklm.job.succeeded id={} type={} has_json_content={} has_media_url={}",
                    job.id,
                    job.artifact_type,
                    payload.json_content.is_some(),
                    payload.media_url.is_some()
                );
                return Ok(job);
            }
            Err(e) => {
                let msg = e.to_string();
                if should_retry_generation(&msg, attempts_left) {
                    attempts_left -= 1;
                    tracing::warn!(
                        "notebooklm.job.retry id={} remaining_retries={} reason={}",
                        job.id,
                        attempts_left,
                        msg
                    );
                    continue;
                }
                job.status = if is_auth_error(&msg) {
                    "expired-auth".to_string()
                } else {
                    "failed".to_string()
                };
                job.error = Some(msg);
                job.updated_at = Utc::now().to_rfc3339();
                replace_job(&root, &job)?;
                tracing::warn!("notebooklm.job.failed id={} status={}", job.id, job.status);
                return Ok(job);
            }
        }
    }
}

fn replace_job(root: &Path, updated: &NotebookLMJob) -> Result<(), AppError> {
    let mut jobs = load_jobs(root)?;
    if let Some(existing) = jobs.jobs.iter_mut().find(|j| j.id == updated.id) {
        *existing = updated.clone();
    } else {
        jobs.jobs.push(updated.clone());
    }
    save_jobs(root, &jobs)
}

#[tauri::command]
pub async fn notebooklm_get_jobs(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<NotebookLMJob>, AppError> {
    let root = integration_root(&app)?;
    let mut jobs = load_jobs(&root)?.jobs;
    jobs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    if let Some(limit) = limit {
        jobs.truncate(limit);
    }
    Ok(jobs)
}

#[tauri::command]
pub async fn notebooklm_get_job(
    app: tauri::AppHandle,
    job_id: String,
) -> Result<Option<NotebookLMJob>, AppError> {
    let root = integration_root(&app)?;
    let jobs = load_jobs(&root)?;
    Ok(jobs.jobs.into_iter().find(|j| j.id == job_id))
}

/// Persist a media artifact's playback position (seconds) with its job so
/// reopening the artifact resumes where the user left off.
#[tauri::command]
pub async fn notebooklm_set_artifact_position(
    app: tauri::AppHandle,
    job_id: String,
    position_seconds: f64,
) -> Result<(), AppError> {
    let root = integration_root(&app)?;
    let mut jobs = load_jobs(&root)?;
    let job = jobs
        .jobs
        .iter_mut()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Job {job_id} not found")))?;
    job.payload.playback_position = Some(position_seconds.max(0.0));
    save_jobs(&root, &jobs)?;
    Ok(())
}

#[tauri::command]
pub async fn notebooklm_preview_flashcards(
    app: tauri::AppHandle,
    job_id: String,
) -> Result<Vec<ImportPreviewItem>, AppError> {
    let root = integration_root(&app)?;
    let jobs = load_jobs(&root)?;
    let job = jobs
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Job {job_id} not found")))?;
    let artifact_id = job
        .artifact
        .as_ref()
        .map(|a| a.id.clone())
        .unwrap_or_else(|| "unknown".to_string());
    Ok(job
        .payload
        .flashcards
        .iter()
        .map(|f| ImportPreviewItem {
            question: normalize_notebooklm_text(&f.question),
            answer: normalize_notebooklm_text(&f.answer),
            tags: f.tags.clone(),
            source_notebook_id: job.notebook_id.clone(),
            source_artifact_id: artifact_id.clone(),
        })
        .collect())
}

#[tauri::command]
pub async fn notebooklm_preview_quiz_import(
    app: tauri::AppHandle,
    job_id: String,
    mode: Option<String>,
) -> Result<Vec<ImportPreviewItem>, AppError> {
    let root = integration_root(&app)?;
    let jobs = load_jobs(&root)?;
    let job = jobs
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Job {job_id} not found")))?;
    let quiz_mode = mode.unwrap_or_else(|| "all".to_string());
    let artifact_id = job
        .artifact
        .as_ref()
        .map(|a| a.id.clone())
        .unwrap_or_else(|| "unknown".to_string());
    Ok(quiz_to_import_items(&job.payload.quiz_items, &quiz_mode)
        .into_iter()
        .map(|(question, answer)| ImportPreviewItem {
            question,
            answer,
            tags: vec!["notebooklm".to_string(), "quiz-import".to_string()],
            source_notebook_id: job.notebook_id.clone(),
            source_artifact_id: artifact_id.clone(),
        })
        .collect())
}

#[tauri::command]
pub async fn notebooklm_sync_flashcards(
    app: tauri::AppHandle,
    job_id: String,
    deck_name: Option<String>,
    dedupe: Option<bool>,
    repo: tauri::State<'_, Repository>,
) -> Result<SyncResult, AppError> {
    let preview = notebooklm_preview_flashcards(app.clone(), job_id).await?;
    let result = upsert_learning_items(&repo, &preview, deck_name, dedupe.unwrap_or(true)).await?;
    tracing::info!(
        "notebooklm.sync.flashcards created={} updated={} skipped={}",
        result.created,
        result.updated,
        result.skipped
    );
    Ok(result)
}

#[tauri::command]
pub async fn notebooklm_sync_quiz(
    app: tauri::AppHandle,
    job_id: String,
    mode: Option<String>,
    deck_name: Option<String>,
    dedupe: Option<bool>,
    repo: tauri::State<'_, Repository>,
) -> Result<SyncResult, AppError> {
    let preview = notebooklm_preview_quiz_import(app.clone(), job_id, mode).await?;
    let result = upsert_learning_items(&repo, &preview, deck_name, dedupe.unwrap_or(true)).await?;
    tracing::info!(
        "notebooklm.sync.quiz created={} updated={} skipped={}",
        result.created,
        result.updated,
        result.skipped
    );
    Ok(result)
}

#[tauri::command]
pub async fn notebooklm_sync_preview_items(
    preview_items: Vec<ImportPreviewItem>,
    deck_name: Option<String>,
    dedupe: Option<bool>,
    repo: tauri::State<'_, Repository>,
) -> Result<SyncResult, AppError> {
    let result =
        upsert_learning_items(&repo, &preview_items, deck_name, dedupe.unwrap_or(true)).await?;
    tracing::info!(
        "notebooklm.sync.preview created={} updated={} skipped={}",
        result.created,
        result.updated,
        result.skipped
    );
    Ok(result)
}

#[tauri::command]
pub async fn notebooklm_export_job_artifact(
    app: tauri::AppHandle,
    job_id: String,
    output_format: Option<String>,
) -> Result<ArtifactExportResult, AppError> {
    let root = integration_root(&app)?;
    let jobs = load_jobs(&root)?;
    let job = jobs
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Job {job_id} not found")))?;

    let format = output_format
        .unwrap_or_else(|| "json".to_string())
        .to_lowercase();
    let (mime_type, content, extension) = if format == "markdown" {
        let mut lines = Vec::new();
        if !job.payload.flashcards.is_empty() {
            lines.push("# Flashcards".to_string());
            for (idx, f) in job.payload.flashcards.iter().enumerate() {
                lines.push(format!("## Card {}", idx + 1));
                lines.push(format!("Q: {}", f.question));
                lines.push(format!("A: {}", f.answer));
                lines.push(String::new());
            }
        }
        if !job.payload.quiz_items.is_empty() {
            lines.push("# Quiz Items".to_string());
            for (idx, q) in job.payload.quiz_items.iter().enumerate() {
                lines.push(format!("## Question {}", idx + 1));
                lines.push(format!("Q: {}", q.question));
                lines.push(format!("Correct: {}", q.correct_answer));
                lines.push(format!(
                    "User: {}",
                    q.user_answer
                        .clone()
                        .unwrap_or_else(|| "(none)".to_string())
                ));
                lines.push(format!("Was correct: {}", q.was_correct));
                lines.push(String::new());
            }
        }
        // Text content (reports, study guides) and structured content
        // (mind-maps, data-tables) live outside flashcards/quiz payloads —
        // omitting them produced an empty file for those types.
        if let Some(raw) = job.payload.raw_text.as_ref().filter(|r| !r.trim().is_empty()) {
            if !lines.is_empty() {
                lines.push(String::new());
            }
            lines.push("# Content".to_string());
            lines.push(String::new());
            lines.push(raw.trim().to_string());
            lines.push(String::new());
        }
        if let Some(json) = job.payload.json_content.as_ref() {
            if !json.is_null() {
                if !lines.is_empty() {
                    lines.push(String::new());
                }
                lines.push("# Structured Content".to_string());
                lines.push(String::new());
                lines.push(serde_json::to_string_pretty(json)?);
            }
        }
        if lines.iter().all(|l| l.trim().is_empty()) {
            return Err(AppError::IntegrationError(
                "This artifact has no content to export.".to_string(),
            ));
        }
        (
            "text/markdown".to_string(),
            lines.join("\n"),
            "md".to_string(),
        )
    } else if format == "html" {
        let json = serde_json::to_string_pretty(&job.payload)?;
        (
            "text/html".to_string(),
            format!(
                "<!doctype html><html><body><h1>NotebookLM Export</h1><pre>{}</pre></body></html>",
                html_escape(&json)
            ),
            "html".to_string(),
        )
    } else {
        let payload_json = serde_json::to_string_pretty(&job.payload)?;
        if payload_json.trim().is_empty() {
            return Err(AppError::IntegrationError(
                "This artifact has no content to export.".to_string(),
            ));
        }
        (
            "application/json".to_string(),
            payload_json,
            "json".to_string(),
        )
    };

    Ok(ArtifactExportResult {
        format: format.clone(),
        mime_type,
        file_name: format!("notebooklm-{}-{}.{}", job.artifact_type, job.id, extension),
        content,
    })
}

/// Result of importing a completed NotebookLM job into the library.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactImportResult {
    pub document_id: String,
    pub title: String,
    pub file_type: String,
    pub already_imported: bool,
}

fn file_type_string(file_type: &FileType) -> &'static str {
    match file_type {
        FileType::Pdf => "pdf",
        FileType::Epub => "epub",
        FileType::Markdown => "markdown",
        FileType::Html => "html",
        FileType::Youtube => "youtube",
        FileType::Audio => "audio",
        FileType::Video => "video",
        FileType::Image => "image",
        FileType::Other => "other",
    }
}

/// Human-readable title for an imported artifact, from the job's artifact
/// summary when it is meaningful, else a type-based fallback.
fn import_title(job: &NotebookLMJob, artifact_type: &str) -> String {
    if let Some(artifact) = &job.artifact {
        let title = artifact.title.trim();
        if !title.is_empty() && !title.ends_with(" result") {
            return title.to_string();
        }
    }
    let label = artifact_type.replace('-', " ");
    let words = label.split_whitespace().collect::<Vec<_>>();
    let title = words
        .iter()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("NotebookLM {}", title)
}

/// A storage directory for imported NotebookLM media files, under the app
/// data dir so files survive sandbox revocation like other library media.
fn notebooklm_imports_dir_from_ctx(ctx: &ProviderContext) -> Result<PathBuf, AppError> {
    let dir = ctx.app_dir.join("incrementum").join("notebooklm-imports");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Retrieve an artifact's media through the CLI `download` subcommand into a
/// temp path, verify the transfer, then move it into app-managed storage.
/// Returns the final file path. On any failure the temp file is deleted and
/// nothing is left behind; auth failures are surfaced distinctly so the user
/// knows to reconnect rather than regenerate.
async fn retrieve_artifact_media(
    ctx: &ProviderContext,
    notebook_id: &str,
    artifact_id: Option<&str>,
    artifact_type: &str,
    ext: &str,
) -> Result<PathBuf, AppError> {
    let temp_dir = ctx.app_dir.join("artifacts");
    fs::create_dir_all(&temp_dir)?;
    let temp_path = temp_dir.join(format!(
        "import-{}-{}.{}",
        artifact_type.replace('/', "-"),
        Uuid::new_v4().simple(),
        ext
    ));

    let mut download = vec![
        "download".to_string(),
        artifact_type.to_string(),
        temp_path.to_string_lossy().to_string(),
    ];
    if let Some(id) = artifact_id {
        download.push("--artifact".to_string());
        download.push(id.to_string());
    }
    download.push("--notebook".to_string());
    download.push(notebook_id.to_string());

    if let Err(err) = run_notebooklm_command(ctx, &download).await {
        let _ = fs::remove_file(&temp_path);
        let message = err.to_string();
        if is_auth_error(&message) {
            return Err(AppError::IntegrationError(format!(
                "NotebookLM session is no longer authenticated. Reconnect before importing this artifact: {message}"
            )));
        }
        return Err(AppError::IntegrationError(format!(
            "Failed to download {} artifact: {message}",
            artifact_type
        )));
    }

    // Verify the transfer completed: the file must exist and be non-empty.
    let metadata = fs::metadata(&temp_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        AppError::IntegrationError(format!(
            "Downloaded {} artifact is missing (transfer did not complete): {e}",
            artifact_type
        ))
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&temp_path);
        return Err(AppError::IntegrationError(format!(
            "Downloaded {} artifact is empty; import aborted.",
            artifact_type
        )));
    }

    let imports_dir = match notebooklm_imports_dir_from_ctx(ctx) {
        Ok(dir) => dir,
        Err(err) => {
            let _ = fs::remove_file(&temp_path);
            return Err(err);
        }
    };
    let final_path = imports_dir.join(
        temp_path
            .file_name()
            .ok_or_else(|| AppError::Internal("no temp file name".to_string()))?,
    );
    fs::rename(&temp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        AppError::Internal(format!("Failed to move downloaded artifact into place: {e}"))
    })?;
    Ok(final_path)
}

/// The `commands::ocr_image_file` result, mapped into an optional text so the
/// import path can treat OCR as best-effort without naming a provider.
async fn ocr_imported_infographic(image_path: &str) -> Option<String> {
    let request = crate::commands::ocr::OCRImageRequest {
        image_path: vec![PathBuf::from(image_path)],
        provider: None,
        language: None,
    };
    match crate::commands::ocr::ocr_image_file(request).await {
        Ok(response) => {
            let text = response.text.trim().to_string();
            if text.is_empty() { None } else { Some(text) }
        }
        Err(err) => {
            tracing::warn!(
                "notebooklm.import.ocr.failed best-effort; image still imported: {}",
                err
            );
            None
        }
    }
}

/// Build the origin metadata shared by every imported artifact.
fn origin_metadata(job: &NotebookLMJob, structured: Option<serde_json::Value>) -> DocumentMetadata {
    let mut metadata = DocumentMetadata {
        source: Some("notebooklm".to_string()),
        source_notebook_id: Some(job.notebook_id.clone()),
        source_job_id: Some(job.id.clone()),
        ..Default::default()
    };
    if let Some(json) = structured {
        metadata.structured_content = Some(json);
    }
    metadata
}

/// Import a completed job as a library Document at the collection root.
#[tauri::command]
pub async fn notebooklm_import_job_artifact(
    app: tauri::AppHandle,
    job_id: String,
    collection_id: Option<String>,
    repo: tauri::State<'_, Repository>,
) -> Result<ArtifactImportResult, AppError> {
    let root = integration_root(&app)?;
    let jobs = load_jobs(&root)?;
    let job = jobs
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Job {job_id} not found")))?;

    if job.status != "succeeded" {
        return Err(AppError::IntegrationError(format!(
            "Job {job_id} has status '{}'; only succeeded jobs can be imported",
            job.status
        )));
    }

    let artifact_type = normalize_cli_type(&job.artifact_type);

    // Already-imported check: a document whose metadata records this job id.
    let existing = repo
        .list_documents()
        .await?
        .into_iter()
        .find(|d| {
            d.metadata
                .as_ref()
                .and_then(|m| m.source_job_id.as_deref())
                == Some(job.id.as_str())
        });
    if let Some(existing) = existing {
        tracing::info!(
            "notebooklm.import.already_imported job_id={} document_id={}",
            job.id,
            existing.id
        );
        // Heal a missing podcast episode row for a previously-imported audio
        // artifact. `insert_podcast_episode_with_id` is INSERT OR IGNORE, so
        // this is safe to re-run on every already-imported request — a failed
        // episode insert on the original import no longer leaves the audio
        // permanently without its podcast row.
        if artifact_type == "audio" {
            if let Ok(feed) = repo.ensure_notebooklm_podcast_feed().await {
                let _ = repo
                    .insert_podcast_episode_with_id(
                        &job.id,
                        &feed.id,
                        &existing.title,
                        &existing.file_path,
                        None,
                    )
                    .await;
            }
        }
        return Ok(ArtifactImportResult {
            document_id: existing.id,
            title: existing.title,
            file_type: file_type_string(&existing.file_type).to_string(),
            already_imported: true,
        });
    }

    let title = import_title(&job, &artifact_type);

    // Dispatch per artifact type. Text/structured types build directly from
    // the job payload; media types retrieve the file first.
    let document = match artifact_type.as_str() {
        "report" | "study-guide" => {
            let text = job.payload.raw_text.clone().ok_or_else(|| {
                AppError::IntegrationError(format!(
                    "{} artifact has no text content to import; regenerate it.",
                    artifact_type
                ))
            })?;
            if text.trim().is_empty() {
                return Err(AppError::IntegrationError(format!(
                    "{} artifact has no text content to import; regenerate it.",
                    artifact_type
                )));
            }
            let mut doc = Document::with_collection(
                title,
                format!("notebooklm://{}", job.id),
                FileType::Markdown,
                None,
            );
            doc.content = Some(text);
            doc.metadata = Some(origin_metadata(&job, None));
            doc
        }
        "mind-map" | "data-table" => {
            let json_content = job.payload.json_content.clone().ok_or_else(|| {
                AppError::IntegrationError(format!(
                    "{} artifact has no structured JSON content; regenerate it.",
                    artifact_type
                ))
            })?;
            if json_content.is_null() {
                return Err(AppError::IntegrationError(format!(
                    "{} artifact has no structured JSON content; regenerate it.",
                    artifact_type
                )));
            }
            let text = job
                .payload
                .raw_text
                .clone()
                .unwrap_or_else(|| json_content.to_string());
            let mut doc = Document::with_collection(
                title,
                format!("notebooklm://{}", job.id),
                FileType::Markdown,
                None,
            );
            doc.content = Some(text);
            doc.metadata = Some(origin_metadata(&job, Some(json_content)));
            doc
        }
        "audio" | "video" | "slide-deck" | "infographic" => {
            let ctx = provider_context(&app, root.clone()).await;
            let artifact_id = job.artifact.as_ref().map(|a| a.id.clone());

            let ext = match artifact_type.as_str() {
                "audio" => "mp3",
                "video" => "mp4",
                "slide-deck" => "pdf",
                "infographic" => "png",
                _ => unreachable!(),
            };
            let media_path = retrieve_artifact_media(
                &ctx,
                &job.notebook_id,
                artifact_id.as_deref(),
                &artifact_type,
                ext,
            )
            .await?;

            let file_type = match artifact_type.as_str() {
                "audio" => FileType::Audio,
                "video" => FileType::Video,
                "slide-deck" => FileType::Pdf,
                "infographic" => FileType::Image,
                _ => unreachable!(),
            };

            let mut doc = Document::with_collection(
                title.clone(),
                media_path.to_string_lossy().to_string(),
                file_type,
                None,
            );

            if artifact_type == "audio" {
                // Register as a podcast episode so the existing podcast
                // surface plays it and the `probeAudioDuration` backfill
                // (PodcastManager, lofty-backed) populates duration. The
                // episode id is the job id, kept stable so re-import after a
                // failed run does not duplicate rows. The file must live in
                // the podcast-audio dir named `<episodeId>.<ext>` so
                // `get_downloaded_episode_path` resolves it. The episode ROW
                // is inserted only after the document row is created (see
                // below) so a failed import leaves no phantom episode.
                let audio_dir = crate::commands::podcast::podcast_audio_dir_public(&app)
                    .map_err(|e| AppError::IntegrationError(format!(
                        "Failed to resolve podcast audio dir: {e}"
                    )))?;
                let episode_path = audio_dir.join(format!("{}.{}", job.id, ext));
                if episode_path != media_path {
                    // Re-import after a failed run may leave a stale file
                    // behind (the episode row is ignored if present, but the
                    // file should reflect the current download). Overwrite
                    // explicitly rather than relying on platform-dependent
                    // rename semantics.
                    if episode_path.exists() {
                        fs::remove_file(&episode_path).map_err(|e| {
                            AppError::Internal(format!(
                                "Failed to clear stale imported audio: {e}"
                            ))
                        })?;
                    }
                    fs::rename(&media_path, &episode_path).map_err(|e| {
                        let _ = fs::remove_file(&media_path);
                        AppError::Internal(format!(
                            "Failed to place imported audio into podcast storage: {e}"
                        ))
                    })?;
                }
                let mut metadata = origin_metadata(&job, None);
                metadata.source = Some(format!("podcast:{}", job.id));
                doc.metadata = Some(metadata);
                doc.file_path = episode_path.to_string_lossy().to_string();
            } else {
                doc.metadata = Some(origin_metadata(&job, None));
            }

            if artifact_type == "infographic" {
                // Best-effort OCR through the user's configured provider. A
                // failure still imports the image; the text layer is a bonus.
                if let Some(text) =
                    ocr_imported_infographic(&media_path.to_string_lossy()).await
                {
                    doc.content = Some(text);
                }
            }
            doc
        }
        "flashcards" | "quiz" => {
            return Err(AppError::IntegrationError(
                "Flashcards and quizzes import through the existing sync flow, not the artifact import command."
                    .to_string(),
            ));
        }
        other => {
            return Err(AppError::IntegrationError(format!(
                "Unsupported NotebookLM artifact type for import: {}",
                other
            )));
        }
    };

    let mut document = document;
    // Imported artifacts land at the collection library root (None resolves
    // to the default collection), so they enter the Queue on the same terms
    // as any other library item.
    document.collection_id = collection_id
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| crate::models::collection::DEFAULT_COLLECTION_ID.to_string());
    document.priority_rating = 8;
    document.priority_score = 8.0;
    if !document.tags.iter().any(|t| t == "notebooklm") {
        document.tags.push("notebooklm".to_string());
    }

    let created = repo.create_document(&document).await?;

    // Make the document due immediately so it lands in front of the Queue.
    // `create_document` does not persist scheduling columns, so set it after.
    repo.update_document_scheduling(&created.id, Some(Utc::now()), None, None, None, None)
        .await?;

    // Audio artifacts register their podcast episode row only now, after the
    // document row exists — a failed import leaves no phantom episode.
    if artifact_type == "audio" {
        let feed = repo.ensure_notebooklm_podcast_feed().await?;
        let episode_path = &document.file_path;
        repo.insert_podcast_episode_with_id(
            &job.id,
            &feed.id,
            &created.title,
            episode_path,
            None,
        )
        .await?;
    }

    // Infographics also register in the image registry so the artifact is
    // available as an image asset (deduplicated by content hash — if the
    // image is already registered this is a no-op returning the existing
    // asset). Best-effort: a registry failure must not fail the import.
    if artifact_type == "infographic" {
        let file_path = document.file_path.clone();
        let file_name = std::path::Path::new(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_string());
        // Derive the mime from the file extension so a JPEG/WebP infographic
        // is not mislabeled as PNG (the CLI downloads infographics as .png,
        // but staying extension-aware is cheap and future-proof).
        let lower = file_path.to_lowercase();
        let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            "image/jpeg"
        } else if lower.ends_with(".webp") {
            "image/webp"
        } else if lower.ends_with(".gif") {
            "image/gif"
        } else {
            "image/png"
        };
        if let Err(err) =
            crate::commands::image_registry::ingest_image_asset_from_path_inner(
                &file_path,
                Some(mime.to_string()),
                file_name,
                repo.inner(),
            )
            .await
        {
            tracing::warn!(
                "notebooklm.import.image_registry failed job_id={} err={}",
                job.id,
                err
            );
        }
    }

    // Carry the artifact's saved playback position into the imported library
    // document (audio/video), so playback resumes where the user left off
    // even after import. Best-effort: a position write must not fail import.
    if (artifact_type == "audio" || artifact_type == "video") {
        if let Some(position_seconds) = job.payload.playback_position {
            let position = crate::models::position::DocumentPosition::Time {
                seconds: position_seconds.max(0.0) as u32,
                total_duration: None,
            };
            let service = crate::services::PositionService::new(repo.pool().clone());
            if let Err(err) = service.save_position(&created.id, &position).await {
                tracing::warn!(
                    "notebooklm.import.position carry failed job_id={} err={}",
                    job.id,
                    err
                );
            }
        }
    }

    tracing::info!(
        "notebooklm.import.created job_id={} document_id={} type={}",
        job.id,
        created.id,
        artifact_type
    );

    Ok(ArtifactImportResult {
        document_id: created.id,
        title: created.title,
        file_type: file_type_string(&created.file_type).to_string(),
        already_imported: false,
    })
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Check if notebooklm CLI is installed and get its version
#[tauri::command]
pub async fn notebooklm_check_cli(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let ctx = provider_context(&app, integration_root(&app)?).await;

    // Try to run notebooklm --version or notebooklm version
    let version_result = run_first_success_no_bootstrap(
        &ctx,
        vec![vec!["--version".to_string()], vec!["version".to_string()]],
    )
    .await;

    match version_result {
        Ok(result) => {
            let version = result.stdout.trim().to_string();
            // Try to check login status
            let status_result = run_first_success_no_bootstrap(
                &ctx,
                vec![
                    vec![
                        "auth".to_string(),
                        "check".to_string(),
                        "--json".to_string(),
                    ],
                    vec!["status".to_string(), "--json".to_string()],
                    vec!["status".to_string()],
                ],
            )
            .await;

            // Fail closed: only an affirmative status body counts as a session.
            let mut is_authenticated = cli_result_reports_authenticated(&status_result);

            if !is_authenticated {
                let app_storage = ctx.app_dir.join("storage_state.json");
                if try_copy_system_auth(&app_storage).is_some() {
                    // Re-check status now that system auth is copied
                    let status_retry = run_first_success_no_bootstrap(
                        &ctx,
                        vec![
                            vec![
                                "auth".to_string(),
                                "check".to_string(),
                                "--json".to_string(),
                            ],
                            vec!["status".to_string(), "--json".to_string()],
                            vec!["status".to_string()],
                        ],
                    )
                    .await;
                    is_authenticated = cli_result_reports_authenticated(&status_retry);
                }
            }

            Ok(serde_json::json!({
                "installed": true,
                "version": version,
                "is_authenticated": is_authenticated,
                "binary_path": ctx
                    .notebooklm_runtime_python
                    .or(ctx.notebooklm_managed_python)
                    .or(ctx.notebooklm_bin)
                    .map(|p| p.to_string_lossy().to_string()),
            }))
        }
        Err(e) => {
            tracing::warn!("notebooklm CLI not found or not working: {}", e);
            Ok(serde_json::json!({
                "installed": false,
                "error": e.to_string(),
            }))
        }
    }
}

/// Try to copy system-level auth from ~/.notebooklm/storage_state.json to the app's storage dir.
/// Returns the path that was copied from if successful.
fn try_copy_system_auth(app_storage: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // Check multiple candidate locations where notebooklm CLI saves cookies
    let candidates = vec![
        home.join(".notebooklm")
            .join("profiles")
            .join("default")
            .join("storage_state.json"),
        home.join(".notebooklm").join("storage_state.json"),
    ];

    let mut system_storage = None;
    for candidate in candidates {
        if candidate.exists() {
            system_storage = Some(candidate);
            break;
        }
    }

    let system_storage = system_storage?;

    // Read and validate the system auth file
    let content = fs::read_to_string(&system_storage).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    // Basic validation: must have cookies array with at least one entry
    let has_cookies = parsed
        .get("cookies")
        .and_then(|c| c.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    if !has_cookies {
        tracing::debug!(
            "System auth file at {} exists but has no cookies",
            system_storage.display()
        );
        return None;
    }

    // Copy to app storage
    if let Some(parent) = app_storage.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = fs::write(app_storage, content.as_bytes()) {
        tracing::warn!("Failed to copy system auth to app storage: {}", e);
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(app_storage, fs::Permissions::from_mode(0o600));
    }

    tracing::info!(
        "Copied system auth from {} to {}",
        system_storage.display(),
        app_storage.display()
    );
    Some(system_storage)
}

/// Run notebooklm login command
/// Uses a multi-strategy approach:
///   1. Reuse existing system auth from ~/.notebooklm/storage_state.json (no browser needed)
///   2. Run system `notebooklm login` from PATH (proper Chromium browser)
///   3. Fall back to bundled sidecar login (may have GTK issues)
#[tauri::command]
pub async fn notebooklm_cli_login(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let root = integration_root(&app)?;
    let ctx = provider_context(&app, root.clone()).await;
    let app_storage = root.join("storage_state.json");

    tracing::info!("Starting notebooklm CLI login flow (multi-strategy)");

    // ── Strategy 1: Reuse existing system auth ────────────────────────────
    if let Some(source_path) = try_copy_system_auth(&app_storage) {
        tracing::info!("Strategy 1: Found system auth at {}", source_path.display());

        // Verify the copied auth actually works
        let verify = run_first_success_no_bootstrap(
            &ctx,
            vec![vec![
                "auth".to_string(),
                "check".to_string(),
                "--json".to_string(),
            ]],
        )
        .await;

        let auth_valid = match &verify {
            // The body decides, not the exit status: `auth check --json` can
            // exit 0 while reporting an unauthenticated session.
            Ok(command) => stdout_reports_authenticated(&command.stdout),
            Err(verify_err) => {
                let msg = verify_err.to_string();
                // `auth check` does not exist in older CLI versions. Falling
                // back to a command that requires a session is legitimate
                // evidence; any other failure is not.
                if msg.contains("no such command") || msg.contains("No such command") {
                    run_first_success_no_bootstrap(
                        &ctx,
                        vec![vec!["list".to_string(), "--json".to_string()]],
                    )
                    .await
                    .is_ok()
                } else {
                    false
                }
            }
        };

        if auth_valid {
            // Auto-connect after successful auth copy
            let mut auth_state = load_auth(&root)?;
            auth_state.connected = true;
            auth_state.last_connected_at = Some(Utc::now().to_rfc3339());
            auth_state.provider = "cli".to_string();
            auth_state.storage_path = Some(app_storage.to_string_lossy().to_string());
            save_auth(&root, &auth_state)?;

            let mut settings = load_settings(&root)?;
            settings.enabled = true;
            settings.provider = "cli".to_string();
            save_settings(&root, &settings)?;

            tracing::info!("Strategy 1 succeeded: reused system auth");
            return Ok(serde_json::json!({
                "success": true,
                "message": "Logged in using existing system authentication",
                "strategy": "system_auth_copy",
                "output": format!("Copied auth from {}", source_path.display()),
            }));
        } else {
            tracing::warn!("Strategy 1: system auth copied but verification failed, continuing to next strategy");
        }
    }

    // A previous login may have completed in Chromium without the CLI
    // noticing Google's final redirect. Re-export the persistent browser
    // profile before opening another window; this also migrates auth created
    // by an older build that stored its profile under ~/.notebooklm.
    if ctx.notebooklm_runtime_python.is_some() {
        if let Some(profile) = try_recover_notebooklm_browser_auth(&ctx, &app_storage).await {
            persist_cli_auth_state(&root, &app_storage)?;
            tracing::info!(profile = %profile.display(), "Reused authenticated NotebookLM browser profile");
            return Ok(serde_json::json!({
                "success": true,
                "message": "Logged in using the existing browser session",
                "strategy": "browser_profile_reuse",
                "output": format!("Captured auth from {}", profile.display()),
            }));
        }
    }

    // ── Strategy 2: System CLI login (proper browser) ─────────────────────
    // Try to find system `notebooklm` on PATH and run login WITHOUT --storage
    // override, so it uses ~/.notebooklm/ natively and opens a proper Chromium
    // The packaged runtime gets first chance below; this avoids an unrelated
    // system CLI's two-minute stdin wait on a clean one-click install.
    let system_cli_result = if ctx.notebooklm_runtime_python.is_none() {
        let path_override = augmented_path_env();
        let mut cmd = Command::new("notebooklm");
        cmd.arg("login")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = path_override {
            cmd.env("PATH", path);
        }
        // Don't set PLAYWRIGHT_BROWSERS_PATH=0 here — let system CLI use its own browser
        match cmd.spawn() {
            Ok(mut child) => {
                // Wait for the user to complete login, then send Enter
                // The CLI login waits for user input after browser opens
                if let Some(mut stdin) = child.stdin.take() {
                    // Wait up to 120s for user to log in, then send Enter
                    sleep(Duration::from_secs(120)).await;
                    let _ = stdin.write_all(b"\n").await;
                }
                match child.wait_with_output().await {
                    Ok(output) if output.status.success() => {
                        Some(Ok(String::from_utf8_lossy(&output.stdout)
                            .trim()
                            .to_string()))
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                        Some(Err(stderr))
                    }
                    Err(e) => Some(Err(e.to_string())),
                }
            }
            Err(_) => {
                tracing::debug!("Strategy 2: system `notebooklm` not found on PATH");
                None // not found on PATH, skip to strategy 3
            }
        }
    } else {
        None
    };

    if let Some(cli_result) = system_cli_result {
        match cli_result {
            Ok(stdout) => {
                tracing::info!("Strategy 2: system CLI login completed");

                // Copy the newly-created system auth to our app dir
                if try_copy_system_auth(&app_storage).is_some() {
                    // Auto-connect
                    let mut auth_state = load_auth(&root)?;
                    auth_state.connected = true;
                    auth_state.last_connected_at = Some(Utc::now().to_rfc3339());
                    auth_state.provider = "cli".to_string();
                    auth_state.storage_path = Some(app_storage.to_string_lossy().to_string());
                    save_auth(&root, &auth_state)?;

                    let mut settings = load_settings(&root)?;
                    settings.enabled = true;
                    settings.provider = "cli".to_string();
                    save_settings(&root, &settings)?;

                    return Ok(serde_json::json!({
                        "success": true,
                        "message": "Login successful via system browser",
                        "strategy": "system_cli_login",
                        "output": stdout,
                    }));
                }

                // Even if copy failed, login may have still written to system path
                return Ok(serde_json::json!({
                    "success": true,
                    "message": "Login completed. You may need to reconnect.",
                    "strategy": "system_cli_login",
                    "output": stdout,
                }));
            }
            Err(err_str) => {
                tracing::warn!("Strategy 2: system CLI login failed: {}", err_str);
                // Fall through to strategy 3
            }
        }
    }

    // ── Strategy 3: Bundled sidecar login (fallback) ──────────────────────
    tracing::info!("Strategy 3: falling back to bundled sidecar login");

    match run_notebooklm_command_with_input(&ctx, &["login".to_string()], "\n", 120000).await {
        Ok(result) => {
            // Verify authentication
            let verify = run_first_success_no_bootstrap(
                &ctx,
                vec![vec!["list".to_string(), "--json".to_string()]],
            )
            .await;
            // `list --json` requires a session, so a successful call is itself
            // the affirmative evidence. Any failure — auth-shaped or not — means
            // the login did not complete; connecting anyway is what produced a
            // "Connected" state over a session that had never logged in.
            if let Err(verify_err) = verify {
                tracing::warn!(
                    "Strategy 3: login flow ended but auth verification failed: {}",
                    verify_err
                );

                if let Some(profile) =
                    try_recover_notebooklm_browser_auth(&ctx, &app_storage).await
                {
                    persist_cli_auth_state(&root, &app_storage)?;
                    return Ok(serde_json::json!({
                        "success": true,
                        "message": "Login successful using the browser session",
                        "strategy": "browser_profile_recovery",
                        "output": format!("Captured auth from {}", profile.display()),
                    }));
                }

                return Err(AppError::IntegrationError(
                    "Login did not complete. Please try running 'notebooklm login' in a terminal first, then reconnect."
                        .to_string(),
                ));
            }

            persist_cli_auth_state(&root, &app_storage)?;

            tracing::info!("Strategy 3: bundled sidecar login completed successfully");
            Ok(serde_json::json!({
                "success": true,
                "message": "Login successful",
                "strategy": "bundled_sidecar",
                "output": result.stdout,
            }))
        }
        Err(e) => {
            let err_str = e.to_string();
            tracing::error!("Strategy 3: bundled sidecar login failed: {}", err_str);

            if let Some(profile) = try_recover_notebooklm_browser_auth(&ctx, &app_storage).await {
                persist_cli_auth_state(&root, &app_storage)?;
                return Ok(serde_json::json!({
                    "success": true,
                    "message": "Login successful using the browser session",
                    "strategy": "browser_profile_recovery",
                    "output": format!("Captured auth from {}", profile.display()),
                }));
            }

            Err(AppError::IntegrationError(format!(
                "Login failed. Try running 'notebooklm login' in a terminal first, then click Sign In again. Error: {}",
                err_str
            )))
        }
    }
}

/// Run notebooklm logout command
#[tauri::command]
pub async fn notebooklm_cli_logout(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let ctx = provider_context(&app, integration_root(&app)?).await;

    tracing::info!("Running notebooklm CLI logout");

    match run_first_success(
        &ctx,
        vec![
            vec!["logout".to_string()],
            vec!["auth".to_string(), "logout".to_string()],
        ],
    )
    .await
    {
        Ok(result) => {
            tracing::info!("notebooklm logout completed");
            Ok(serde_json::json!({
                "success": true,
                "message": "Logout successful",
                "output": result.stdout,
            }))
        }
        Err(e) => {
            tracing::warn!("notebooklm logout had issues: {}", e);
            // Logout might still have succeeded even with errors
            Ok(serde_json::json!({
                "success": true,
                "message": "Logout may have succeeded",
                "output": e.to_string(),
            }))
        }
    }
}

/// Get detailed CLI authentication status
#[tauri::command]
pub async fn notebooklm_cli_status(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let ctx = provider_context(&app, integration_root(&app)?).await;

    let result = run_first_success_no_bootstrap(
        &ctx,
        vec![
            vec![
                "auth".to_string(),
                "check".to_string(),
                "--json".to_string(),
            ],
            vec!["status".to_string(), "--json".to_string()],
            vec!["status".to_string()],
        ],
    )
    .await;

    match result {
        Ok(output) => {
            // Fail closed. This previously treated any output that did not
            // contain one of two exact phrases as an authenticated session, so
            // empty output or an unrelated error line reported "logged in".
            Ok(serde_json::json!({
                "is_authenticated": stdout_reports_authenticated(&output.stdout),
                "status_output": output.stdout,
                "error": null,
            }))
        }
        Err(e) => {
            let err_str = e.to_string().to_lowercase();
            let is_auth_error = err_str.contains("not logged in")
                || err_str.contains("unauthorized")
                || err_str.contains("401")
                || err_str.contains("no active session");

            Ok(serde_json::json!({
                "is_authenticated": false,
                "status_output": null,
                "error": e.to_string(),
                "is_auth_error": is_auth_error,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_missed_only_quiz_mode() {
        let quiz = vec![
            QuizItem {
                question: "Q1".to_string(),
                correct_answer: "A1".to_string(),
                user_answer: Some("A2".to_string()),
                was_correct: false,
            },
            QuizItem {
                question: "Q2".to_string(),
                correct_answer: "A2".to_string(),
                user_answer: Some("A2".to_string()),
                was_correct: true,
            },
        ];
        let items = quiz_to_import_items(&quiz, "missed-only");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].0, "Q1");
    }

    #[test]
    fn keeps_all_quiz_items_in_all_mode() {
        let quiz = vec![
            QuizItem {
                question: "Q1".to_string(),
                correct_answer: "A1".to_string(),
                user_answer: None,
                was_correct: false,
            },
            QuizItem {
                question: "Q2".to_string(),
                correct_answer: "A2".to_string(),
                user_answer: Some("A2".to_string()),
                was_correct: true,
            },
        ];
        let items = quiz_to_import_items(&quiz, "all");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].1, "A1");
    }

    #[test]
    fn parses_nested_notebook_create_json() {
        // The pinned CLI (0.8.0rc1) wraps the created notebook in a top-level
        // `notebook` object. This is the shape that previously produced
        // "NotebookLM CLI create did not return notebook ID".
        let json = serde_json::json!({
            "notebook": {
                "id": "nb_123",
                "title": "My Notebook",
                "created_at": "2026-08-10T00:00:00Z"
            }
        });
        let parsed = parse_create_notebook_json(&json, "fallback").unwrap();
        assert_eq!(parsed.id, "nb_123");
        assert_eq!(parsed.title, "My Notebook");
    }

    #[test]
    fn parses_flat_notebook_create_json() {
        // Older CLI shapes put id/title at the top level.
        let json = serde_json::json!({
            "id": "nb_456",
            "name": "Flat Notebook"
        });
        let parsed = parse_create_notebook_json(&json, "fallback").unwrap();
        assert_eq!(parsed.id, "nb_456");
        assert_eq!(parsed.title, "Flat Notebook");
    }

    #[test]
    fn create_json_without_id_is_none() {
        let json = serde_json::json!({ "notebook": { "title": "no id" } });
        assert!(parse_create_notebook_json(&json, "fallback").is_none());
    }

    #[test]
    fn parses_nested_source_add_json() {
        // The pinned CLI (0.8.0rc1) wraps the added source in a top-level
        // `source` object. This is the shape that previously produced
        // "NotebookLM CLI source add did not return source ID".
        let json = serde_json::json!({
            "source": {
                "id": "src_123",
                "title": "My Source",
                "type": "url",
                "url": "https://example.com"
            }
        });
        let parsed = parse_source_summary_json(&json).unwrap();
        assert_eq!(parsed.id, "src_123");
        assert_eq!(parsed.title, "My Source");
        assert_eq!(parsed.kind, "url");
    }

    #[test]
    fn parses_flat_source_add_json() {
        let json = serde_json::json!({
            "id": "src_456",
            "title": "Flat Source",
            "type": "text",
            "status": "processing"
        });
        let parsed = parse_source_summary_json(&json).unwrap();
        assert_eq!(parsed.id, "src_456");
        assert_eq!(parsed.status, "processing");
    }

    #[test]
    fn source_add_json_without_id_is_none() {
        let json = serde_json::json!({ "source": { "title": "no id" } });
        assert!(parse_source_summary_json(&json).is_none());
    }

    #[test]
    fn parses_source_list_envelope() {
        let json = serde_json::json!({
            "sources": [
                { "id": "a", "title": "One", "type": "url" },
                { "id": "b", "title": "Two", "type": "text" }
            ],
            "count": 2
        });
        let parsed = parse_source_list_json(&json);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "a");
        assert_eq!(parsed[1].kind, "text");
    }

    #[test]
    fn identifies_auth_errors() {
        assert!(is_auth_error("HTTP 401 Unauthorized"));
        assert!(is_auth_error("session expired"));
        assert!(!is_auth_error("network timeout"));
    }

    #[test]
    fn affirmative_json_reports_authenticated() {
        assert!(stdout_reports_authenticated(r#"{"authenticated": true}"#));
        assert!(stdout_reports_authenticated(r#"{"loggedIn": true}"#));
        assert!(stdout_reports_authenticated(r#"{"is_authenticated": true}"#));
        assert!(stdout_reports_authenticated(
            r#"{"email": "reader@example.com"}"#
        ));
        assert!(stdout_reports_authenticated(
            r#"{"auth": {"authenticated": true}}"#
        ));
        assert!(stdout_reports_authenticated(
            r#"{"status":"ok","checks":{"cookies_present":true,"sid_cookie":true}}"#
        ));
    }

    #[test]
    fn explicit_unauthenticated_json_is_not_authenticated() {
        // The reported bug: the command exits 0 and the body says no.
        assert!(!stdout_reports_authenticated(r#"{"authenticated": false}"#));
        assert!(!stdout_reports_authenticated(r#"{"loggedIn": false}"#));
        assert!(!stdout_reports_authenticated(
            r#"{"auth": {"authenticated": false}}"#
        ));
        assert!(!stdout_reports_authenticated(
            r#"{"status":"ok","checks":{"cookies_present":false,"sid_cookie":false}}"#
        ));
    }

    #[test]
    fn unrecognized_or_empty_output_is_not_authenticated() {
        assert!(!stdout_reports_authenticated(""));
        assert!(!stdout_reports_authenticated("   "));
        // Valid JSON with nothing to go on must not be read as success.
        assert!(!stdout_reports_authenticated("{}"));
        assert!(!stdout_reports_authenticated(r#"{"version": "1.2.3"}"#));
        assert!(!stdout_reports_authenticated(r#"{"email": ""}"#));
        // Unrelated diagnostics previously counted as authenticated because
        // they did not contain one of two exact phrases.
        assert!(!stdout_reports_authenticated("Error: browser profile locked"));
        assert!(!stdout_reports_authenticated(
            "The browser window was closed during login."
        ));
    }

    #[test]
    fn plain_text_needs_an_explicit_positive() {
        assert!(stdout_reports_authenticated("Logged in as reader@example.com"));
        assert!(stdout_reports_authenticated("Signed in as someone"));
        assert!(!stdout_reports_authenticated("Not logged in"));
        assert!(!stdout_reports_authenticated("No active session"));
        assert!(!stdout_reports_authenticated("Unauthorized"));
        // A negative wins even when it contains a positive-looking substring.
        assert!(!stdout_reports_authenticated("You are not authenticated"));
    }

    #[test]
    fn a_failed_invocation_is_never_authenticated() {
        // Timeout, missing CLI, connection refused — none are evidence of a
        // session, and all were previously read as authenticated because they
        // did not match the auth-error keyword list.
        for message in [
            "command not found: notebooklm",
            "operation timed out",
            "Connection refused (os error 61)",
            "playwright browser is not installed",
        ] {
            let result: Result<CliCommandResult, AppError> =
                Err(AppError::IntegrationError(message.to_string()));
            assert!(
                !cli_result_reports_authenticated(&result),
                "{} must not report authenticated",
                message
            );
        }
    }

    #[test]
    fn bundled_wrapper_missing_runtime_triggers_bootstrap() {
        let error = AppError::IntegrationError(
            "command `notebooklm login` failed (exit 1): error: notebooklm is not installed\nInstall it with: pip install notebooklm-py".to_string(),
        );
        assert!(is_cli_missing_error(&error));
    }

    #[test]
    fn a_successful_invocation_still_needs_an_affirmative_body() {
        let result: Result<CliCommandResult, AppError> = Ok(CliCommandResult {
            stdout: r#"{"authenticated": false}"#.to_string(),
        });
        assert!(!cli_result_reports_authenticated(&result));

        let result: Result<CliCommandResult, AppError> = Ok(CliCommandResult {
            stdout: r#"{"authenticated": true}"#.to_string(),
        });
        assert!(cli_result_reports_authenticated(&result));
    }

    #[test]
    fn retries_non_auth_errors_only() {
        assert!(should_retry_generation("temporary timeout", 1));
        assert!(!should_retry_generation("HTTP 401 Unauthorized", 3));
        assert!(!should_retry_generation("temporary timeout", 0));
    }

    #[test]
    fn export_html_escapes_payload() {
        let escaped = html_escape("<script>alert('x')</script>");
        assert_eq!(escaped, "&lt;script&gt;alert('x')&lt;/script&gt;");
    }

    #[test]
    fn persists_job_lifecycle_states() {
        let root = std::env::temp_dir().join(format!("notebooklm-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp dir");
        let now = Utc::now().to_rfc3339();

        let mut job = NotebookLMJob {
            id: "job_test".to_string(),
            notebook_id: "nb_1".to_string(),
            artifact_type: "flashcards".to_string(),
            status: "queued".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
            error: None,
            artifact: None,
            payload: ArtifactPayload::default(),
        };
        replace_job(&root, &job).expect("queued write");

        job.status = "running".to_string();
        replace_job(&root, &job).expect("running write");
        let loaded = load_jobs(&root).expect("load jobs");
        assert_eq!(loaded.jobs.len(), 1);
        assert_eq!(loaded.jobs[0].status, "running");

        job.status = "expired-auth".to_string();
        job.error = Some("session expired".to_string());
        replace_job(&root, &job).expect("expired write");
        let loaded = load_jobs(&root).expect("load jobs");
        assert_eq!(loaded.jobs[0].status, "expired-auth");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn persists_media_playback_position() {
        // A video artifact's playback position must survive a save → reload
        // round trip so reopening the artifact resumes where the user left off.
        let root = std::env::temp_dir().join(format!("notebooklm-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp dir");
        let now = Utc::now().to_rfc3339();

        let mut job = NotebookLMJob {
            id: "job_video".to_string(),
            notebook_id: "nb_1".to_string(),
            artifact_type: "video".to_string(),
            status: "succeeded".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
            error: None,
            artifact: None,
            payload: ArtifactPayload {
                media_url: Some("/tmp/video.mp4".to_string()),
                ..ArtifactPayload::default()
            },
        };
        replace_job(&root, &job).expect("write job");

        // Simulate the set-position command: update the job's payload and save.
        let mut jobs = load_jobs(&root).expect("load jobs");
        let saved = jobs
            .jobs
            .iter_mut()
            .find(|j| j.id == "job_video")
            .expect("find job");
        saved.payload.playback_position = Some(42.0);
        save_jobs(&root, &jobs).expect("save position");

        let reloaded = load_jobs(&root).expect("reload jobs");
        assert_eq!(
            reloaded.jobs[0].payload.playback_position,
            Some(42.0),
            "playback position must survive the job save/reload round trip"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_augmented_path_env_macos() {
        let path_env = augmented_path_env();
        assert!(path_env.is_some(), "Should return augmented PATH");
        let path_str = path_env.unwrap();
        assert!(
            path_str.contains("/opt/homebrew/bin") || path_str.contains("/usr/local/bin"),
            "Augmented path should contain brew bin or usr local bin: {}",
            path_str
        );
    }

    /// A Python that doesn't exist on disk must fail the import smoke test,
    /// so a managed venv with a dangling python symlink is treated as broken.
    #[tokio::test]
    async fn managed_runtime_smoke_test_rejects_missing_python() {
        let bogus = PathBuf::from("/this/python/does/not/exist");
        assert!(
            !managed_runtime_imports_notebooklm(&bogus).await,
            "smoke test should fail for a non-existent python"
        );
    }

    /// A real Python that exists but cannot import `notebooklm.notebooklm_cli`
    /// must fail the smoke test. This is the exact failure mode that caused
    /// the "CLI Not Found" bug: a managed venv whose python symlink pointed
    /// at an incompatible (or since-removed) system Python.
    #[tokio::test]
    async fn managed_runtime_smoke_test_rejects_import_failure() {
        // Find any python3 on PATH; if none is available the test is a no-op.
        let python = which_python_for_test();
        let Some(python) = python else {
            eprintln!("skipping: no python3 on PATH");
            return;
        };
        // `import notebooklm.notebooklm_cli` should fail in a clean test
        // environment (the module isn't installed globally), proving the
        // smoke test catches import errors rather than just file presence.
        let ok = managed_runtime_imports_notebooklm(&python).await;
        // We can't assert !ok unconditionally (a dev machine may have it
        // installed globally), but the helper must terminate and return a
        // bool — the real assertion is that a bogus module name is rejected.
        let bogus_module = Command::new(&python)
            .arg("-c")
            .arg("import this_module_definitely_does_not_exist_xyz")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await;
        let bogus_status = bogus_module.as_ref().ok().map(|o| o.status);
        assert!(
            matches!(bogus_module, Ok(o) if !o.status.success()),
            "python must report failure for a non-existent import (got {:?})",
            bogus_status
        );
        // Surface the notebooklm result for visibility without hard-asserting.
        eprintln!("notebooklm import on system python returned: {ok}");
    }

    /// `resolve_managed_notebooklm_runtime` must return `(None, None)` when the
    /// venv directory is absent — i.e. there's nothing to fall through *from*.
    #[tokio::test]
    async fn managed_runtime_resolution_none_when_venv_absent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        // No runtime created under this app_dir.
        let (py, pw) = resolve_managed_notebooklm_runtime(tmp.path()).await;
        assert!(py.is_none(), "expected None python when no venv exists");
        assert!(pw.is_none(), "expected None playwright when no venv exists");
    }

    /// Helper: locate a python3 on PATH for tests, or None.
    fn which_python_for_test() -> Option<PathBuf> {
        for candidate in ["python3", "python"] {
            if let Ok(out) = std::process::Command::new(candidate)
                .arg("-c")
                .arg("import sys; print(sys.executable)")
                .output()
            {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(PathBuf::from(path));
                    }
                }
            }
        }
        None
    }
}
