//! Installation manager + persisted registry for user-installed Hugging Face
//! models (requirement #19).
//!
//! Ownership:
//! - Registry rows live in the SQLite `hf_installed_models` table (migration
//!   084). Rows carry the repo id, revision, runtime, artifact info, integrity
//!   metadata (per-file sha256), and install date.
//! - Files live under `<app_data>/models/<runtime>/` (same tree as the pinned
//!   catalog) in per-repo directories.
//! - `get_installed_hf_models` re-verifies rows against disk on every call, so
//!   a model whose files were deleted externally is surfaced (and not offered
//!   as usable).
//!
//! Security: downloaded bytes are verified (SHA-256 when the repo exposes it),
//! installs are atomic (`.part` → rename), and nothing here ever executes code
//! from a downloaded repo.

use super::adapters::{
    Artifact, ArtifactFile, DetectionConfidence, HfRuntime, RunContract, RuntimeAdapter,
    SherpaOnnxSttAdapter, SherpaOnnxTtsAdapter, WhisperCppAdapter, NemotronAsrAdapter,
};
use super::downloader::{InstallFinished, FINISHED_EVENT, download_file};
use super::hf_client::{
    FileMetadata, RepoInput, build_file_index, clean_revision, fetch_repo_info, hf_client,
    resolve_download_url, safe_dir_name,
};
use crate::database::Repository;
use anyhow::{anyhow, Result};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::Pool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// Shared logical model key for cloud/local Nemotron ASR.
pub const NEMOTRON_ASR_LOGICAL_KEY: &str = "nemotron-3.5-asr-0.6b";
/// Pinned Hugging Face repo for the local Nemotron ASR weights (~742 MB GGUF).
pub const NEMOTRON_ASR_REPO_ID: &str = "nvidia/nemotron-3.5-asr-0.6b";
pub const NEMOTRON_ASR_REVISION: &str = "main";
pub const NEMOTRON_ASR_SIZE_BYTES: u64 = 778_043_392;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedNemotronAsrCatalogEntry {
    pub logical_key: String,
    pub repo_id: String,
    pub revision: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub license: String,
    pub capability: String,
    pub supports_streaming: bool,
    pub languages: Vec<String>,
}

/// Metadata for the pinned Nemotron ASR catalog card (Local Models → Speech-to-Text).
pub fn nemotron_asr_catalog_entry() -> PinnedNemotronAsrCatalogEntry {
    PinnedNemotronAsrCatalogEntry {
        logical_key: NEMOTRON_ASR_LOGICAL_KEY.to_string(),
        repo_id: NEMOTRON_ASR_REPO_ID.to_string(),
        revision: NEMOTRON_ASR_REVISION.to_string(),
        display_name: "NVIDIA Nemotron 3.5 ASR 0.6B".to_string(),
        size_bytes: NEMOTRON_ASR_SIZE_BYTES,
        license: "nvidia-open-model-license".to_string(),
        capability: "asr".to_string(),
        supports_streaming: true,
        languages: vec![
            "multilingual".to_string(),
            "en".to_string(),
            "es".to_string(),
            "fr".to_string(),
            "de".to_string(),
            "zh".to_string(),
            "ja".to_string(),
        ],
    }
}

/// True when the pinned Nemotron ASR model is registered and verified on disk.
pub async fn is_nemotron_asr_installed(pool: &Pool<sqlx::Sqlite>) -> bool {
    let id = model_id_for(
        HfRuntime::NemotronAsr,
        NEMOTRON_ASR_REPO_ID,
        NEMOTRON_ASR_REVISION,
    );
    let Some(model) = registry_get(pool, &id).await else {
        return false;
    };
    verify_on_disk(&model.install_dir, &model.artifact_files)
}

/// One installed file, relative to the model's install dir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModelFile {
    pub path: String,
    pub size: u64,
    pub sha256: Option<String>,
}

/// A registry row — the source of truth for an installed HF model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledHfModel {
    pub id: String,
    pub repo_id: String,
    pub revision: String,
    pub runtime: HfRuntime,
    pub artifact_kind: String,
    pub install_dir: String,
    pub artifact_files: Vec<InstalledModelFile>,
    pub download_size_bytes: u64,
    pub license: Option<String>,
    pub run_contract: RunContract,
    pub installed_at: String,
    /// Re-verified on disk by `installed_models`/`registry_list`.
    pub installed: bool,
}

impl HfRuntime {
    /// Stable string used everywhere the runtime is named outside Rust:
    /// the model id prefix (`hf:{tag}:{repo}@{rev}`), the registry `runtime`
    /// column, and the serde kebab-case serialized value the frontend sends
    /// back to `hf_install_model`. `tag()` and serde MUST stay in sync — see
    /// the `serde_roundtrip_from_tag_matches_for_every_variant` test.
    pub fn tag(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper-cpp",
            HfRuntime::SherpaOnnxStt => "sherpa-onnx-stt",
            HfRuntime::SherpaOnnxTts => "sherpa-onnx-tts",
            HfRuntime::NemotronAsr => "nemotron-asr",
        }
    }

    pub fn from_tag(tag: &str) -> Option<HfRuntime> {
        match tag {
            // Canonical (== serde kebab-case == what the frontend sends).
            "whisper-cpp" => Some(HfRuntime::WhisperCpp),
            "sherpa-onnx-stt" => Some(HfRuntime::SherpaOnnxStt),
            "sherpa-onnx-tts" => Some(HfRuntime::SherpaOnnxTts),
            "nemotron-asr" => Some(HfRuntime::NemotronAsr),
            // Legacy compact aliases (pre-alignment registry rows / model ids).
            "whisper" => Some(HfRuntime::WhisperCpp),
            "sherpa-stt" => Some(HfRuntime::SherpaOnnxStt),
            "sherpa-tts" => Some(HfRuntime::SherpaOnnxTts),
            "nemotron" => Some(HfRuntime::NemotronAsr),
            _ => None,
        }
    }

    pub fn adapter(self) -> Box<dyn RuntimeAdapter> {
        match self {
            HfRuntime::WhisperCpp => Box::new(WhisperCppAdapter),
            HfRuntime::SherpaOnnxStt => Box::new(SherpaOnnxSttAdapter),
            HfRuntime::SherpaOnnxTts => Box::new(SherpaOnnxTtsAdapter),
            HfRuntime::NemotronAsr => Box::new(NemotronAsrAdapter),
        }
    }
}

/// Build the model id that appears in the STT picker / settings.
pub fn model_id_for(runtime: HfRuntime, repo_id: &str, revision: &str) -> String {
    let rev = clean_revision(revision);
    let rev_part = if rev.is_empty() || rev == "main" {
        String::new()
    } else {
        format!("@{}", rev)
    };
    format!("hf:{}:{}{}", runtime.tag(), repo_id, rev_part)
}

/// Parse a model id back into (runtime, repo_id, revision).
pub fn parse_model_id(id: &str) -> Option<(HfRuntime, String, String)> {
    let rest = id.strip_prefix("hf:")?;
    let (tag, repo_part) = rest.split_once(':')?;
    let runtime = HfRuntime::from_tag(tag)?;
    let (repo_id, revision) = match repo_part.split_once('@') {
        Some((r, rev)) => (r.to_string(), rev.to_string()),
        None => (repo_part.to_string(), "main".to_string()),
    };
    Some((runtime, repo_id, revision))
}

pub fn install_dir_for(runtime: HfRuntime, app_data_dir: &Path) -> PathBuf {
    runtime.adapter().install_dir(app_data_dir)
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry (SQLite)
// ─────────────────────────────────────────────────────────────────────────────

async fn registry_insert(pool: &Pool<sqlx::Sqlite>, model: &InstalledHfModel) -> Result<()> {
    let files = serde_json::to_string(&model.artifact_files)?;
    let contract = serde_json::to_string(&model.run_contract)?;
    sqlx::query(
        "INSERT OR REPLACE INTO hf_installed_models
         (id, repo_id, revision, runtime, artifact_kind, install_dir, artifact_files,
          download_size_bytes, license, run_contract, metadata, installed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&model.id)
    .bind(&model.repo_id)
    .bind(&model.revision)
    .bind(model.runtime.tag())
    .bind(&model.artifact_kind)
    .bind(&model.install_dir)
    .bind(&files)
    .bind(model.download_size_bytes as i64)
    .bind(&model.license)
    .bind(&contract)
    .bind("{}")
    .bind(&model.installed_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Normalize a deserialized row's run contract without touching the DB:
/// legacy sherpa TTS rows (`family: None`) get their family inferred
/// (`voices.bin` ⇒ Kokoro, else VITS) so callers never see an inferred-None
/// contract. Writes back to the row are optional and not required — the next
/// install of the same repo persists a fully-formed contract.
fn with_inferred_tts_family(mut model: InstalledHfModel) -> InstalledHfModel {
    if let RunContract::SherpaTts { family: None, .. } = &model.run_contract {
        if let Some(family) = model.run_contract.effective_tts_family() {
            if let RunContract::SherpaTts {
                family: slot,
                ..
            } = &mut model.run_contract
            {
                *slot = Some(family);
            }
        }
    }
    model
}

async fn registry_get(pool: &Pool<sqlx::Sqlite>, id: &str) -> Option<InstalledHfModel> {
    let row: Option<(String, String, String, String, String, String, i64, Option<String>, String, String)> =
        sqlx::query_as(
            "SELECT repo_id, revision, runtime, artifact_kind, install_dir, artifact_files,
                    download_size_bytes, license, run_contract, installed_at
             FROM hf_installed_models WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()?;
    row.and_then(|(repo_id, revision, runtime, artifact_kind, install_dir, files, size, license, contract, at)| {
        let runtime = HfRuntime::from_tag(&runtime)?;
        let artifact_files: Vec<InstalledModelFile> = serde_json::from_str(&files).ok()?;
        let run_contract: RunContract = serde_json::from_str(&contract).ok()?;
        Some(with_inferred_tts_family(InstalledHfModel {
            id: id.to_string(),
            repo_id,
            revision,
            runtime,
            artifact_kind,
            install_dir,
            artifact_files,
            download_size_bytes: size as u64,
            license,
            run_contract,
            installed_at: at,
            installed: false,
        }))
    })
}
async fn registry_delete(pool: &Pool<sqlx::Sqlite>, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM hf_installed_models WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// True when a model with the same repo id + revision + runtime is registered.
pub async fn registry_is_installed(
    pool: &Pool<sqlx::Sqlite>,
    repo_id: &str,
    revision: &str,
    runtime: HfRuntime,
) -> bool {
    let rev = clean_revision(revision);
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM hf_installed_models WHERE repo_id = ? AND revision = ? AND runtime = ?",
    )
    .bind(repo_id)
    .bind(if rev.is_empty() { "main" } else { rev.as_str() })
    .bind(runtime.tag())
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .unwrap_or(false)
}

/// List all registry rows, re-verifying each against disk.
pub async fn registry_list(pool: &Pool<sqlx::Sqlite>) -> Result<Vec<InstalledHfModel>> {
    let rows: Vec<(String, String, String, String, String, String, String, i64, Option<String>, String, String)> =
        sqlx::query_as(
            "SELECT id, repo_id, revision, runtime, artifact_kind, install_dir, artifact_files,
                    download_size_bytes, license, run_contract, installed_at
             FROM hf_installed_models ORDER BY installed_at DESC",
        )
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(
            |(id, repo_id, revision, runtime, artifact_kind, install_dir, files, size, license, contract, at)| {
                let runtime = HfRuntime::from_tag(&runtime)?;
                let artifact_files: Vec<InstalledModelFile> = serde_json::from_str(&files).ok()?;
                let run_contract: RunContract = serde_json::from_str(&contract).ok()?;
                let installed = verify_on_disk(&install_dir, &artifact_files);
                Some(with_inferred_tts_family(InstalledHfModel {
                    id,
                    repo_id,
                    revision,
                    runtime,
                    artifact_kind,
                    install_dir,
                    artifact_files,
                    download_size_bytes: size as u64,
                    license,
                    run_contract,
                    installed_at: at,
                    installed,
                }))
            },
        )
        .collect())
}

/// Remove a registry row (does not touch files).
pub async fn registry_remove(pool: &Pool<sqlx::Sqlite>, id: &str) -> Result<bool> {
    let removed = registry_get(pool, id).await.is_some();
    registry_delete(pool, id).await?;
    Ok(removed)
}

/// Verify that every artifact file exists and is non-empty.
pub fn verify_on_disk(install_dir: &str, files: &[InstalledModelFile]) -> bool {
    if files.is_empty() {
        return false;
    }
    let root = Path::new(install_dir);
    files.iter().all(|f| {
        let p = root.join(&f.path);
        std::fs::metadata(&p).map(|m| m.len() > 0).unwrap_or(false)
    })
}

/// Resolve the model path used by the STT engine for a model id.
///
/// Returns `None` when `id` is not an HF-managed model (the caller falls back
/// to the pinned catalog).
pub async fn resolve_installed_path(pool: &Pool<sqlx::Sqlite>, id: &str) -> Option<PathBuf> {
    let (runtime, _repo, _rev) = parse_model_id(id)?;
    let model = registry_get(pool, id).await?;
    if !model.installed && !verify_on_disk(&model.install_dir, &model.artifact_files) {
        return None;
    }
    // Defense in depth: every path referenced by the run contract must be a
    // contained relative path (covers the Whisper model_file and every
    // sherpa TTS file field — never resolve a traversal out of the install
    // dir, even if a stale or hostile registry row references `../evil.bin`).
    if !model.run_contract.paths_contained() {
        return None;
    }
    let root = PathBuf::from(&model.install_dir);
    match runtime {
        HfRuntime::WhisperCpp => match model.run_contract {
            RunContract::Whisper { model_file } => {
                let path = root.join(&model_file);
                // Defense in depth: a registry row's run-contract path must stay
                // inside the install dir (never resolve to an absolute/escaped
                // path, even if a malicious or stale registry row references
                // something like `/model.int8.onnx` or `../evil.bin`).
                if !path.starts_with(&root) {
                    return None;
                }
                Some(path)
            }
            _ => None,
        },
        HfRuntime::NemotronAsr => match model.run_contract {
            RunContract::NemotronAsr { model_file } => {
                let path = root.join(&model_file);
                if !path.starts_with(&root) {
                    return None;
                }
                Some(path)
            }
            _ => None,
        },
        // sherpa engines take the model *directory*.
        HfRuntime::SherpaOnnxStt | HfRuntime::SherpaOnnxTts => Some(root),
    }
}

/// Look up the run contract for a model id (used by the STT engine router).
pub async fn resolve_run_contract(
    pool: &Pool<sqlx::Sqlite>,
    id: &str,
) -> Option<(HfRuntime, RunContract)> {
    if parse_model_id(id).is_none() {
        return None;
    }
    let model = registry_get(pool, id).await?;
    if !verify_on_disk(&model.install_dir, &model.artifact_files) {
        return None;
    }
    if !model.run_contract.paths_contained() {
        return None;
    }
    Some((model.runtime, model.run_contract))
}

/// Resolve an installed sherpa TTS model id to its on-disk directory plus a
/// validated, family-resolved run contract.
///
/// This is the shared storage bridge used by the desktop TTS engine and the
/// Android plugin shim: HF-installed weights stay in `<app_data>/models/tts/`
/// and are consumed in place — never duplicated into another runtime's asset
/// area. Returns `None` when the id is unknown, files are missing, the
/// contract fails validation, or any contract path escapes the install dir.
pub async fn resolve_installed_tts(
    pool: &Pool<sqlx::Sqlite>,
    id: &str,
) -> Option<(PathBuf, RunContract)> {
    let (runtime, contract) = resolve_run_contract(pool, id).await?;
    if runtime != HfRuntime::SherpaOnnxTts {
        return None;
    }
    if contract.validate().is_err() {
        return None;
    }
    let (_tag, _repo, _rev) = parse_model_id(id)?;
    let model = registry_get(pool, id).await?;
    Some((PathBuf::from(model.install_dir), contract))
}

/// Resolve an installed Nemotron ASR model to its on-disk directory plus contract.
pub async fn resolve_installed_nemotron(
    pool: &Pool<sqlx::Sqlite>,
    id: &str,
) -> Option<(PathBuf, RunContract)> {
    let (runtime, contract) = resolve_run_contract(pool, id).await?;
    if runtime != HfRuntime::NemotronAsr {
        return None;
    }
    if contract.validate().is_err() {
        return None;
    }
    let model = registry_get(pool, id).await?;
    Some((PathBuf::from(model.install_dir), contract))
}

/// How an STT model id should be dispatched to the transcription engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SttEngineRoute {
    /// whisper.cpp ggml path.
    Whisper,
    /// sherpa-onnx `--nemo-ctc-model` (Parakeet). `model` is the ONNX file.
    Parakeet { model: String },
    /// sherpa-onnx `--sense-voice-model`. `model` is the ONNX file.
    SenseVoice { model: String },
    /// sherpa-onnx zipformer transducer. `model` is the primary ONNX file
    /// (combined, or `encoder.onnx` when `decoder`/`joiner` are present).
    Zipformer {
        model: String,
        decoder: Option<String>,
        joiner: Option<String>,
    },
    /// sherpa-onnx `--paraformer-model`.
    Paraformer { model: String },
    /// Nemotron ASR GGUF (embedded runtime).
    Nemotron { model_file: String },
    /// A model that exists but is not an STT model (e.g. TTS).
    NotTranscription,
}

/// Resolve the engine route for a model id.
///
/// - HF-installed models: looked up from the registry run contract.
/// - Pinned catalog models: the legacy `parakeet-`/`sense-voice-` prefix rule.
/// - Everything else: whisper (matches the pre-existing default).
pub async fn stt_route_for_model(pool: &Pool<sqlx::Sqlite>, model_id: &str) -> SttEngineRoute {
    if let Some((_runtime, contract)) = resolve_run_contract(pool, model_id).await {
        return match contract {
            RunContract::Whisper { .. } => SttEngineRoute::Whisper,
            RunContract::SherpaStt {
                family,
                model_file,
                decoder_file,
                joiner_file,
                ..
            } => match family {
                super::adapters::SherpaSttFamily::NemoCtc => {
                    SttEngineRoute::Parakeet { model: model_file }
                }
                super::adapters::SherpaSttFamily::SenseVoice => {
                    SttEngineRoute::SenseVoice { model: model_file }
                }
                super::adapters::SherpaSttFamily::Zipformer => SttEngineRoute::Zipformer {
                    model: model_file,
                    decoder: decoder_file,
                    joiner: joiner_file,
                },
                super::adapters::SherpaSttFamily::Paraformer => SttEngineRoute::Paraformer {
                    model: model_file,
                },
            },
            RunContract::SherpaTts { .. } => SttEngineRoute::NotTranscription,
            RunContract::NemotronAsr { model_file } => SttEngineRoute::Nemotron { model_file },
        };
    }
    if model_id.starts_with("sense-voice-") {
        SttEngineRoute::SenseVoice {
            model: "model.int8.onnx".to_string(),
        }
    } else if model_id.starts_with("parakeet-") {
        SttEngineRoute::Parakeet {
            model: "model.int8.onnx".to_string(),
        }
    } else {
        SttEngineRoute::Whisper
    }
}

/// Resolve the app-data dir from an AppHandle.
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?)
}

// ─────────────────────────────────────────────────────────────────────────────
// Installation lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/// Everything the install command needs, resolved up front.
pub struct InstallTarget {
    pub repo_id: String,
    pub revision: String,
    pub runtime: HfRuntime,
    pub artifact: Artifact,
    pub model_id: String,
    pub install_dir: PathBuf,
    pub license: Option<String>,
    /// repo-relative path -> metadata (size/sha256)
    pub file_metadata: std::collections::HashMap<String, FileMetadata>,
}

/// Re-fetch + re-detect the requested artifact, validating the runtime/kind
/// the client asked for. This ensures install never trusts client-supplied
/// artifact descriptors — it re-inspects the live repo.
pub async fn resolve_install_target(
    app: &AppHandle,
    repo_input: &RepoInput,
    runtime: HfRuntime,
    artifact_kind: &str,
) -> Result<InstallTarget> {
    let client = hf_client();
    let revision = clean_revision(repo_input.revision.as_deref().unwrap_or("main"));
    let revision = if revision.is_empty() { "main" } else { revision.as_str() };

    let info = fetch_repo_info(&client, &repo_input.repo_id, Some(revision)).await?;

    // Build a FileIndex enriched with LFS metadata for the candidate files.
    let index = build_file_index(&client, &repo_input.repo_id, revision, &info).await;

    let artifact = runtime
        .adapter()
        .detect_artifact(&info, &index)
        .filter(|a| a.runtime == runtime && a.kind == artifact_kind)
        .ok_or_else(|| {
            anyhow!(
                "No '{}' artifact of kind '{}' could be detected in {}@{}. Re-inspect the repo and \
                 try again.",
                runtime.label(),
                artifact_kind,
                repo_input.repo_id,
                revision
            )
        })?;

    let app_data = app_data_dir(app)?;
    let install_dir = install_dir_for(runtime, &app_data).join(safe_dir_name(
        &repo_input.repo_id,
        revision,
    ));
    let model_id = model_id_for(runtime, &repo_input.repo_id, revision);

    Ok(InstallTarget {
        repo_id: repo_input.repo_id.clone(),
        revision: revision.to_string(),
        runtime,
        artifact,
        model_id,
        install_dir,
        license: info.license.clone(),
        file_metadata: index.metadata,
    })
}

/// Validate a repo-relative file path for safe joining under the install dir.
///
/// Returns the sanitized relative path (with any leading `/` removed) or `None`
/// when the path could escape the install dir: a `..`/`.`/empty component, a
/// backslash (Windows separator), or a drive/absolute prefix. Every returned
/// path is composed only of plain `name[/name...]` components, so
/// `install_dir.join(rel)` can never climb above `install_dir`.
pub fn sanitize_install_rel(path: &str) -> Option<String> {
    let rel = path.trim_start_matches('/');
    if rel.is_empty() || rel.contains('\\') || rel.contains(':') {
        return None;
    }
    let mut components = Vec::new();
    for comp in rel.split('/') {
        if comp.is_empty() || comp == "." || comp == ".." {
            return None;
        }
        components.push(comp);
    }
    Some(components.join("/"))
}

/// One file to fetch as part of an artifact install.
#[derive(Clone)]
pub struct DownloadSpec {
    pub rel: String,
    pub url: String,
    pub expected_sha: Option<String>,
    pub expected_size: Option<u64>,
}

/// Download a set of files into `install_dir`, verifying each one's integrity.
///
/// If any file fails after earlier files were already placed (renamed into
/// place), the whole per-repo install dir is removed so no orphan files survive
/// without a corresponding registry row.
async fn download_artifact_files(
    client: &Client,
    install_dir: &Path,
    files: &[DownloadSpec],
    app: Option<&AppHandle>,
    install_id: &str,
    cancel: &CancellationToken,
) -> Result<Vec<InstalledModelFile>> {
    let mut artifact_files: Vec<InstalledModelFile> = Vec::new();
    for spec in files {
        let rel = sanitize_install_rel(&spec.rel)
            .ok_or_else(|| anyhow!("Unsafe file path '{}' in artifact", spec.rel))?;
        let dest = install_dir.join(&rel);
        // Defense in depth: the joined path must stay under the install dir.
        if !dest.starts_with(install_dir) {
            return Err(anyhow!(
                "Refusing to install '{}': path escapes the install directory.",
                spec.rel
            ));
        }
        let result = download_file(
            client,
            &spec.url,
            &dest,
            spec.expected_sha.as_deref(),
            spec.expected_size,
            app,
            install_id,
            &rel,
            Some(cancel),
        )
        .await;
        if let Err(e) = result {
            // Partial install: remove the whole per-repo dir so no orphan files
            // linger without a registry row.
            let _ = super::downloader::remove_dir_if_exists(install_dir);
            return Err(e);
        }
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        artifact_files.push(InstalledModelFile {
            path: rel,
            size,
            sha256: spec.expected_sha.clone(),
        });
    }
    Ok(artifact_files)
}

/// ONNX / Nemotron GGUF installs must be integrity-pinned: refuse when any
/// artifact lacks a published SHA-256 (fail closed — these files are fed to
/// native runtimes as untrusted input). Whisper ggml models are not gated this
/// hard (they are not parsed by onnxruntime).
fn ensure_sherpa_hash_pinned(runtime: HfRuntime, specs: &[DownloadSpec]) -> Result<()> {
    if matches!(
        runtime,
        HfRuntime::SherpaOnnxStt | HfRuntime::SherpaOnnxTts | HfRuntime::NemotronAsr
    ) && specs.iter().any(|s| s.expected_sha.is_none())
    {
        return Err(anyhow!(
            "Refusing to install: the repository does not publish a SHA-256 for \
             every artifact, so the download cannot be integrity-verified. Only \
             hash-pinned models are installable for this runtime."
        ));
    }
    Ok(())
}

/// Download + register a resolved install target.
pub async fn install(
    app: &AppHandle,
    repo: &Repository,
    target: &InstallTarget,
    cancel: CancellationToken,
) -> Result<InstalledHfModel> {
    // Duplicate-install prevention (same repo id + revision + runtime).
    if registry_is_installed(repo.pool(), &target.repo_id, &target.revision, target.runtime).await {
        return Err(anyhow!(
            "{} ({}) is already installed.",
            target.repo_id,
            target.revision
        ));
    }

    let client = hf_client();

    let specs: Vec<DownloadSpec> = target
        .artifact
        .files
        .iter()
        .map(|file| {
            let meta = target.file_metadata.get(&file.path);
            let expected_sha = meta
                .and_then(|m| m.sha256.clone())
                .or_else(|| file.sha256.clone());
            let expected_size = meta.and_then(|m| m.size).or(file.size);
            DownloadSpec {
                rel: file.path.clone(),
                url: resolve_download_url(&target.repo_id, &target.revision, &file.path),
                expected_sha,
                expected_size,
            }
        })
        .collect();

    // Security: sherpa (ONNX) models are parsed by the bundled onnxruntime
    // sidecar — untrusted input-to-execution. Only install ONNX artifacts whose
    // integrity is pinned by a published SHA-256; refuse hash-less sherpa
    // installs (fail closed) instead of feeding an unverified model to the
    // runtime. Whisper ggml models are binary-loaded by whisper.cpp; we still
    // prefer a hash when one is exposed, but a missing hash there is not a
    // hard block (the format is not fed to onnxruntime).
    ensure_sherpa_hash_pinned(target.runtime, &specs)?;

    // Failure mid-download removes the whole per-repo dir (no orphan files).
    let artifact_files =
        download_artifact_files(&client, &target.install_dir, &specs, Some(app), &target.model_id, &cancel)
            .await?;
    let installed_size: u64 = artifact_files.iter().map(|f| f.size).sum();
    // Verify the installed file set satisfies the run contract.
    if !verify_on_disk(target.install_dir.to_string_lossy().as_ref(), &artifact_files) {
        let _ = super::downloader::remove_dir_if_exists(&target.install_dir);
        return Err(anyhow!(
            "Model downloaded but installed files failed verification."
        ));
    }

    let model = InstalledHfModel {
        id: target.model_id.clone(),
        repo_id: target.repo_id.clone(),
        revision: target.revision.clone(),
        runtime: target.runtime,
        artifact_kind: target.artifact.kind.clone(),
        install_dir: target.install_dir.to_string_lossy().to_string(),
        artifact_files,
        download_size_bytes: installed_size,
        license: target.license.clone(),
        run_contract: target.artifact.run_contract.clone(),
        installed_at: Utc::now().to_rfc3339(),
        installed: true,
    };

    registry_insert(repo.pool(), &model).await?;

    let _ = app.emit(
        FINISHED_EVENT,
        InstallFinished {
            id: model.id.clone(),
            ok: true,
            message: format!("Installed {}", model.repo_id),
        },
    );

    Ok(model)
}

/// Uninstall: remove files + registry row. `app_data` is the app-data dir the
/// managed models tree lives under (used to refuse deleting outside it).
/// Returns the removed model's repo id on success. No AppHandle needed, so the
/// file/registry mechanics are unit-testable.
pub async fn uninstall_with_app_data(
    repo: &Repository,
    id: &str,
    app_data: &Path,
) -> Result<String> {
    let model = registry_get(repo.pool(), id)
        .await
        .ok_or_else(|| anyhow!("Model '{}' is not installed", id))?;

    // Only delete files that live under the managed models tree (never follow
    // a tampered install_dir outside app_data).
    let managed_root = app_data.join("models");
    let install_dir = PathBuf::from(&model.install_dir);
    if !install_dir.starts_with(&managed_root) {
        return Err(anyhow!(
            "Refusing to delete '{}': install dir is outside the managed models directory.",
            install_dir.display()
        ));
    }

    super::downloader::remove_dir_if_exists(&install_dir)?;
    registry_delete(repo.pool(), id).await?;
    Ok(model.repo_id)
}

/// Uninstall wrapper used by the Tauri command (resolves the app-data dir and
/// emits the finished event).
pub async fn uninstall(app: &AppHandle, repo: &Repository, id: &str) -> Result<()> {
    let app_data = app_data_dir(app)?;
    let repo_id = uninstall_with_app_data(repo, id, &app_data).await?;
    let _ = app.emit(
        FINISHED_EVENT,
        InstallFinished {
            id: id.to_string(),
            ok: true,
            message: format!("Removed {}", repo_id),
        },
    );
    Ok(())
}

/// Merge installed HF STT models into the transcription `ModelProfile` list
/// (used by `get_transcription_profiles` so the STT picker shows them).
pub async fn hf_stt_profiles(
    pool: &Pool<sqlx::Sqlite>,
) -> Vec<crate::transcription::model_manager::ModelProfile> {
    let models = registry_list(pool).await.unwrap_or_default();
    let mut profiles = Vec::new();
    for m in models {
        if !m.installed {
            continue;
        }
        if m.runtime != HfRuntime::SherpaOnnxStt
            && m.runtime != HfRuntime::WhisperCpp
            && m.runtime != HfRuntime::NemotronAsr
        {
            continue;
        }
        let first_sha = m.artifact_files.first().and_then(|f| f.sha256.clone());
        let runtime_label = m.runtime.label();
        profiles.push(crate::transcription::model_manager::ModelProfile {
            id: m.id.clone(),
            name: m.repo_id.clone(),
            description: format!(
                "User-installed Hugging Face model ({} · {}, rev {})",
                runtime_label, m.artifact_kind, m.revision
            ),
            url: format!("https://huggingface.co/{}", m.repo_id),
            sha256: first_sha.unwrap_or_default(),
            size_bytes: m.download_size_bytes,
            installed: true,
        });
    }
    profiles
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> Pool<sqlx::Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory database");
        sqlx::query(
            r#"CREATE TABLE hf_installed_models (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL,
                revision TEXT NOT NULL DEFAULT 'main',
                runtime TEXT NOT NULL,
                artifact_kind TEXT NOT NULL,
                install_dir TEXT NOT NULL,
                artifact_files TEXT NOT NULL,
                download_size_bytes INTEGER NOT NULL DEFAULT 0,
                license TEXT,
                run_contract TEXT NOT NULL,
                metadata TEXT NOT NULL,
                installed_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create table");
        pool
    }

    fn whisper_model(install_dir: &str) -> InstalledHfModel {
        InstalledHfModel {
            id: model_id_for(HfRuntime::WhisperCpp, "someone/whisper-tiny", "main"),
            repo_id: "someone/whisper-tiny".to_string(),
            revision: "main".to_string(),
            runtime: HfRuntime::WhisperCpp,
            artifact_kind: "ggml-whisper".to_string(),
            install_dir: install_dir.to_string(),
            artifact_files: vec![InstalledModelFile {
                path: "ggml-tiny.bin".to_string(),
                size: 75_000_000,
                sha256: Some("abc123".to_string()),
            }],
            download_size_bytes: 75_000_000,
            license: Some("mit".to_string()),
            run_contract: RunContract::Whisper {
                model_file: "ggml-tiny.bin".to_string(),
            },
            installed_at: "2026-08-19T00:00:00Z".to_string(),
            installed: true,
        }
    }

    fn write_model_files(model: &InstalledHfModel) {
        let root = Path::new(&model.install_dir);
        std::fs::create_dir_all(root).unwrap();
        for f in &model.artifact_files {
            std::fs::write(root.join(&f.path), vec![0x42u8; 100]).unwrap();
        }
    }

    #[tokio::test]
    async fn model_id_roundtrips() {
        let id = model_id_for(HfRuntime::SherpaOnnxStt, "someone/asr", "feature/x");
        let (runtime, repo, rev) = parse_model_id(&id).unwrap();
        assert_eq!(runtime, HfRuntime::SherpaOnnxStt);
        assert_eq!(repo, "someone/asr");
        assert_eq!(rev, "feature/x");
    }

    // ── runtime tag <-> serde agreement (review blocker) ───────────────────
    #[test]
    fn tag_matches_serde_kebab_case_for_every_variant() {
        for runtime in [
            HfRuntime::WhisperCpp,
            HfRuntime::SherpaOnnxStt,
            HfRuntime::SherpaOnnxTts,
            HfRuntime::NemotronAsr,
        ] {
            let serialized = serde_json::to_value(runtime).unwrap();
            let as_str = serialized.as_str().expect("runtime serializes to a string");
            assert_eq!(
                runtime.tag(),
                as_str,
                "tag() must equal the serde value for {runtime:?}"
            );
        }
    }

    #[test]
    fn serde_roundtrip_from_tag_matches_for_every_variant() {
        for runtime in [
            HfRuntime::WhisperCpp,
            HfRuntime::SherpaOnnxStt,
            HfRuntime::SherpaOnnxTts,
            HfRuntime::NemotronAsr,
        ] {
            let serialized = serde_json::to_string(&runtime).unwrap();
            // serde_json::to_string produces a quoted JSON string; extract the
            // raw value so from_tag receives exactly what the frontend sends.
            let value = serde_json::to_value(runtime).unwrap();
            let raw = value.as_str().unwrap();
            assert_eq!(raw, serialized.trim_matches('"'));
            assert_eq!(
                HfRuntime::from_tag(raw),
                Some(runtime),
                "from_tag round-trip failed for {raw:?}"
            );
        }
    }

    #[test]
    fn from_tag_accepts_exact_frontend_values() {
        // The frontend sends these serde kebab-case values to hf_install_model.
        assert_eq!(HfRuntime::from_tag("whisper-cpp"), Some(HfRuntime::WhisperCpp));
        assert_eq!(HfRuntime::from_tag("sherpa-onnx-stt"), Some(HfRuntime::SherpaOnnxStt));
        assert_eq!(HfRuntime::from_tag("sherpa-onnx-tts"), Some(HfRuntime::SherpaOnnxTts));
        assert_eq!(HfRuntime::from_tag("nemotron-asr"), Some(HfRuntime::NemotronAsr));
        assert_eq!(HfRuntime::from_tag("bogus"), None);
    }

    // ── install-path traversal hardening ───────────────────────────────────
    #[test]
    fn sanitize_install_rel_blocks_path_traversal() {
        // `..` sibling escape.
        assert_eq!(sanitize_install_rel("../evil.onnx"), None);
        // `..` embedded inside the path.
        assert_eq!(sanitize_install_rel("a/../../evil.onnx"), None);
        assert_eq!(sanitize_install_rel("ggml/../evil.onnx"), None);
        // Absolute path collapses to a contained relative path.
        assert_eq!(sanitize_install_rel("/etc/passwd"), Some("etc/passwd".to_string()));
        assert_eq!(sanitize_install_rel("/"), None);
        // `.` / empty components.
        assert_eq!(sanitize_install_rel("."), None);
        assert_eq!(sanitize_install_rel("./model.onnx"), None);
        assert_eq!(sanitize_install_rel(""), None);
        assert_eq!(sanitize_install_rel("a//b"), None);
        // Windows separators / drive prefixes.
        assert_eq!(sanitize_install_rel("..\\evil.onnx"), None);
        assert_eq!(sanitize_install_rel("C:/evil.onnx"), None);
        // Legit subdirectories still allowed.
        assert_eq!(sanitize_install_rel("ggml/ggml-base.bin"), Some("ggml/ggml-base.bin".to_string()));
    }

    #[test]
    fn install_rel_never_escapes_install_dir() {
        let install_dir = Path::new("/tmp/app/models/whisper/owner_model");
        for hostile in ["../evil.onnx", "/etc/passwd", "a/../../evil.onnx", "C:/evil.onnx"] {
            if let Some(rel) = sanitize_install_rel(hostile) {
                let joined = install_dir.join(&rel);
                assert!(
                    joined.starts_with(install_dir),
                    "{hostile:?} escaped via {rel:?}"
                );
            }
        }
    }

    // ── hash-less sherpa (ONNX) installs are refused (fail closed) ─────────
    #[test]
    fn sherpa_hashless_install_is_refused() {
        let sha = Some("abc123".to_string());
        let with_sha = DownloadSpec {
            rel: "model.onnx".to_string(),
            url: "https://hf.co/x/resolve/main/model.onnx".to_string(),
            expected_sha: sha,
            expected_size: Some(100),
        };
        let without_sha = DownloadSpec {
            expected_sha: None,
            ..with_sha.clone()
        };

        // sherpa STT/TTS / Nemotron with any hash-less artifact → refused.
        for runtime in [
            HfRuntime::SherpaOnnxStt,
            HfRuntime::SherpaOnnxTts,
            HfRuntime::NemotronAsr,
        ] {
            let err = ensure_sherpa_hash_pinned(runtime, &[with_sha.clone(), without_sha.clone()])
                .expect_err("hash-less artifact must be refused");
            assert!(err.to_string().contains("SHA-256"), "{err}");
        }
        // All artifacts hash-pinned → allowed.
        assert!(ensure_sherpa_hash_pinned(HfRuntime::SherpaOnnxStt, &[with_sha.clone()]).is_ok());
        // Whisper ggml is not hard-gated on a hash.
        assert!(ensure_sherpa_hash_pinned(HfRuntime::WhisperCpp, &[without_sha.clone()]).is_ok());
    }

    // ── resolve_installed_path run-contract containment ────────────────────
    #[tokio::test]
    async fn resolve_installed_path_rejects_escaping_run_contract() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();

        for hostile in ["../evil.bin", "/etc/passwd"] {
            let mut model = whisper_model(dir.path().to_str().unwrap());
            model.run_contract = RunContract::Whisper {
                model_file: hostile.to_string(),
            };
            registry_insert(&pool, &model).await.unwrap();
            let resolved = resolve_installed_path(&pool, &model.id).await;
            assert!(resolved.is_none(), "{hostile:?} must not resolve outside install dir");
        }
    }

    // ── partial multi-file install cleanup ─────────────────────────────────
    #[tokio::test]
    async fn failed_multi_file_install_removes_orphan_files() {
        use crate::models::hf::test_support::TestServerBuilder;
        use sha2::{Digest, Sha256};

        let good_body = b"good model bytes".to_vec();
        let good_sha = format!("{:x}", Sha256::digest(&good_body));
        let good_len = good_body.len() as u64;
        let server = TestServerBuilder::new(move |_| (200, good_body.clone()))
            .spawn()
            .await;

        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("models/whisper/owner_model");
        let cancel = CancellationToken::new();
        let specs = vec![
            DownloadSpec {
                rel: "model.bin".to_string(),
                url: server.url.clone(),
                expected_sha: Some(good_sha.clone()),
                expected_size: Some(good_len),
            },
            // Second file fails integrity (wrong sha) -> immediate error.
            DownloadSpec {
                rel: "tokens.txt".to_string(),
                url: server.url.clone(),
                expected_sha: Some("deadbeef".repeat(8)),
                expected_size: Some(good_len),
            },
        ];

        let err = download_artifact_files(
            &reqwest::Client::new(),
            &install_dir,
            &specs,
            None,
            "test",
            &cancel,
        )
        .await
        .expect_err("second file integrity fails");
        server.stop();
        assert!(err.to_string().contains("Integrity"), "{}", err);
        assert!(
            !install_dir.exists(),
            "no orphan files after failed multi-file install"
        );
    }

    // ── 5.10: duplicate install prevention ─────────────────────────────────
    #[tokio::test]
    async fn duplicate_install_is_detected() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let mut model = whisper_model(dir.path().to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();

        assert!(registry_is_installed(&pool, "someone/whisper-tiny", "main", HfRuntime::WhisperCpp).await);
        // Same repo but a different revision is a distinct install.
        assert!(!registry_is_installed(&pool, "someone/whisper-tiny", "dev", HfRuntime::WhisperCpp).await);

        model.revision = "dev".to_string();
        model.id = model_id_for(HfRuntime::WhisperCpp, "someone/whisper-tiny", "dev");
        registry_insert(&pool, &model).await.unwrap();
        assert!(registry_is_installed(&pool, "someone/whisper-tiny", "dev", HfRuntime::WhisperCpp).await);
    }

    // ── 5.10: restart re-detection (files present vs removed) ──────────────
    #[tokio::test]
    async fn restart_redetection_reports_files_missing() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let model = whisper_model(dir.path().to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();

        // "After restart": files are present → installed.
        let listed = registry_list(&pool).await.unwrap();
        let m = listed.iter().find(|m| m.id == model.id).expect("row listed");
        assert!(m.installed, "model files on disk → installed");

        // User deletes the file externally (or a restart finds it gone).
        std::fs::remove_file(Path::new(&model.install_dir).join("ggml-tiny.bin")).unwrap();
        let listed = registry_list(&pool).await.unwrap();
        let m = listed.iter().find(|m| m.id == model.id).expect("row still listed");
        assert!(!m.installed, "missing files → not installed");

        // And the STT profile merge must not surface it as selectable.
        let profiles = hf_stt_profiles(&pool).await;
        assert!(profiles.is_empty());
    }

    #[tokio::test]
    async fn restart_redetection_with_files_is_selectable_in_picker() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let model = whisper_model(dir.path().to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();

        let profiles = hf_stt_profiles(&pool).await;
        assert_eq!(profiles.len(), 1, "installed HF whisper appears in STT picker");
        assert_eq!(profiles[0].id, model.id);
        assert!(profiles[0].installed);

        // Resolve the engine path for the STT engine.
        let resolved = resolve_installed_path(&pool, &model.id).await.expect("path resolves");
        assert!(resolved.ends_with("ggml-tiny.bin"));
    }

    // ── 5.10: remove model (files + registry row) ──────────────────────────
    #[tokio::test]
    async fn uninstall_removes_files_and_registry_row() {
        let pool = test_pool().await;
        let app_data = tempfile::tempdir().unwrap();
        let install_dir = app_data
            .path()
            .join("models")
            .join("whisper")
            .join("someone_whisper-tiny");
        let model = whisper_model(install_dir.to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();

        assert!(Path::new(&model.install_dir).exists());
        uninstall_with_app_data(&Repository::new(pool.clone()), &model.id, app_data.path())
            .await
            .expect("uninstall succeeds");

        assert!(!Path::new(&model.install_dir).exists());
        let listed = registry_list(&pool).await.unwrap();
        assert!(listed.iter().find(|m| m.id == model.id).is_none());
    }

    #[tokio::test]
    async fn uninstall_refuses_paths_outside_managed_tree() {
        let pool = test_pool().await;
        let app_data = tempfile::tempdir().unwrap();
        // install_dir deliberately outside app_data/models.
        let outside = tempfile::tempdir().unwrap();
        let model = whisper_model(outside.path().to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();

        let err = uninstall_with_app_data(&Repository::new(pool.clone()), &model.id, app_data.path())
            .await
            .expect_err("refuses unsafe path");
        assert!(err.to_string().contains("managed models directory"), "{}", err);
        assert!(Path::new(&model.install_dir).exists(), "file preserved");
    }

    #[tokio::test]
    async fn install_dir_is_scoped_per_runtime_and_repo() {
        let app_data = tempfile::tempdir().unwrap();
        let whisper_dir = install_dir_for(HfRuntime::WhisperCpp, app_data.path());
        let stt_dir = install_dir_for(HfRuntime::SherpaOnnxStt, app_data.path());
        let tts_dir = install_dir_for(HfRuntime::SherpaOnnxTts, app_data.path());
        assert!(whisper_dir.to_string_lossy().contains("whisper"));
        assert!(stt_dir.to_string_lossy().contains("parakeet"));
        assert!(tts_dir.to_string_lossy().contains("tts"));
    }

    // ── supertonic: legacy-row inference + shared storage bridge ───────────

    fn legacy_tts_row_json() -> String {
        // Exactly what a pre-change row looks like in the DB.
        r#"{"type":"sherpa-tts","model_file":"model.onnx","tokens_file":"tokens.txt","voices_file":"voices.bin"}"#
            .to_string()
    }

    fn supertonic_row_json() -> String {
        serde_json::json!({
            "type": "sherpa-tts",
            "family": "supertonic",
            "model_file": "duration_predictor.int8.onnx",
            "text_encoder_file": "text_encoder.int8.onnx",
            "vector_estimator_file": "vector_estimator.int8.onnx",
            "vocoder_file": "vocoder.int8.onnx",
            "tts_json_file": "tts.json",
            "unicode_indexer_file": "unicode_indexer.bin",
            "voice_bin_file": "voice.bin",
        })
        .to_string()
    }

    fn files_json(paths: &[&str]) -> String {
        serde_json::to_string(
            &paths
                .iter()
                .map(|p| InstalledModelFile {
                    path: p.to_string(),
                    size: 10,
                    sha256: None,
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    async fn insert_raw_row(pool: &Pool<sqlx::Sqlite>, id: &str, dir: &str, contract: &str, files: &str) {
        sqlx::query(
            "INSERT INTO hf_installed_models
             (id, repo_id, revision, runtime, artifact_kind, install_dir, artifact_files,
              download_size_bytes, license, run_contract, metadata, installed_at)
             VALUES (?, ?, 'main', 'sherpa-onnx-tts', ?, ?, ?, 0, NULL, ?, '{}', '2026-08-19T00:00:00Z')",
        )
        .bind(id)
        .bind("someone/tts-model")
        .bind(if id.contains("supertonic") { "supertonic" } else { "kokoro" })
        .bind(dir)
        .bind(files)
        .bind(contract)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn registry_read_infers_legacy_tts_family_without_db_write() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let model_dir = dir.path().join("models/tts/someone_tts-model");
        std::fs::create_dir_all(&model_dir).unwrap();
        for f in ["model.onnx", "tokens.txt", "voices.bin"] {
            std::fs::write(model_dir.join(f), vec![0x42; 100]).unwrap();
        }
        insert_raw_row(
            &pool,
            "hf:sherpa-onnx-tts:someone/tts-model",
            model_dir.to_str().unwrap(),
            &legacy_tts_row_json(),
            &files_json(&["model.onnx", "tokens.txt", "voices.bin"]),
        )
        .await;

        let listed = registry_list(&pool).await.unwrap();
        let m = listed.iter().find(|m| m.id == "hf:sherpa-onnx-tts:someone/tts-model").unwrap();
        assert_eq!(
            m.run_contract.effective_tts_family(),
            Some(crate::models::hf::adapters::SherpaTtsFamily::Kokoro),
            "voices.bin ⇒ Kokoro"
        );
        assert!(matches!(
            m.run_contract,
            RunContract::SherpaTts { family: Some(_), .. }
        ));
    }

    #[tokio::test]
    async fn resolve_installed_tts_returns_supertonic_dir_and_contract() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let model_dir = dir.path().join("models/tts/someone_supertonic");
        std::fs::create_dir_all(&model_dir).unwrap();
        for f in [
            "duration_predictor.int8.onnx",
            "text_encoder.int8.onnx",
            "vector_estimator.int8.onnx",
            "vocoder.int8.onnx",
            "tts.json",
            "unicode_indexer.bin",
            "voice.bin",
        ] {
            std::fs::write(model_dir.join(f), vec![0x42; 100]).unwrap();
        }
        insert_raw_row(
            &pool,
            "hf:sherpa-onnx-tts:someone/supertonic",
            model_dir.to_str().unwrap(),
            &supertonic_row_json(),
            &files_json(&[
                "duration_predictor.int8.onnx",
                "text_encoder.int8.onnx",
                "vector_estimator.int8.onnx",
                "vocoder.int8.onnx",
                "tts.json",
                "unicode_indexer.bin",
                "voice.bin",
            ]),
        )
        .await;

        let (resolved_dir, contract) =
            resolve_installed_tts(&pool, "hf:sherpa-onnx-tts:someone/supertonic")
                .await
                .expect("supertonic resolves");
        assert_eq!(resolved_dir, model_dir);
        assert_eq!(
            contract.effective_tts_family(),
            Some(crate::models::hf::adapters::SherpaTtsFamily::Supertonic)
        );
        assert!(contract.validate().is_ok());

        // Unknown / non-TTS ids do not resolve.
        assert!(resolve_installed_tts(&pool, "hf:sherpa-onnx-tts:someone/missing").await.is_none());
        assert!(resolve_installed_tts(&pool, "not-an-hf-id").await.is_none());
    }

    #[tokio::test]
    async fn resolve_installed_tts_rejects_traversal_contracts() {
        let pool = test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let model_dir = dir.path().join("models/tts/evil");
        std::fs::create_dir_all(&model_dir).unwrap();
        let hostile = serde_json::json!({
            "type": "sherpa-tts",
            "family": "supertonic",
            "model_file": "../evil.onnx",
            "text_encoder_file": "text_encoder.int8.onnx",
            "vector_estimator_file": "vector_estimator.int8.onnx",
            "vocoder_file": "vocoder.int8.onnx",
            "tts_json_file": "tts.json",
            "unicode_indexer_file": "unicode_indexer.bin",
            "voice_bin_file": "voice.bin",
        })
        .to_string();
        insert_raw_row(
            &pool,
            "hf:sherpa-onnx-tts:someone/evil",
            model_dir.to_str().unwrap(),
            &hostile,
            &files_json(&["duration_predictor.int8.onnx"]),
        )
        .await;
        assert!(
            resolve_installed_tts(&pool, "hf:sherpa-onnx-tts:someone/evil")
                .await
                .is_none(),
            "a traversal path in any contract field must refuse to resolve"
        );
    }

    // ── engine routing ─────────────────────────────────────────────────────
    #[tokio::test]
    async fn stt_route_resolves_hf_contract_and_catalog_prefixes() {
        let pool = test_pool().await;

        // Catalog prefix fallbacks (no registry row).
        assert_eq!(
            stt_route_for_model(&pool, "parakeet-tdt-ctc-110m").await,
            SttEngineRoute::Parakeet { model: "model.int8.onnx".to_string() }
        );
        assert_eq!(
            stt_route_for_model(&pool, "sense-voice-small").await,
            SttEngineRoute::SenseVoice { model: "model.int8.onnx".to_string() }
        );
        assert_eq!(stt_route_for_model(&pool, "distil-small.en").await, SttEngineRoute::Whisper);

        // HF whisper model.
        let dir = tempfile::tempdir().unwrap();
        let model = whisper_model(dir.path().to_str().unwrap());
        write_model_files(&model);
        registry_insert(&pool, &model).await.unwrap();
        assert_eq!(stt_route_for_model(&pool, &model.id).await, SttEngineRoute::Whisper);

        // HF sherpa sense-voice model.
        let sense = InstalledHfModel {
            id: model_id_for(HfRuntime::SherpaOnnxStt, "someone/sense-voice-x", "main"),
            repo_id: "someone/sense-voice-x".to_string(),
            revision: "main".to_string(),
            runtime: HfRuntime::SherpaOnnxStt,
            artifact_kind: "sense-voice".to_string(),
            install_dir: dir.path().to_str().unwrap().to_string(),
            artifact_files: vec![
                InstalledModelFile { path: "model.int8.onnx".to_string(), size: 10, sha256: None },
                InstalledModelFile { path: "tokens.txt".to_string(), size: 10, sha256: None },
            ],
            download_size_bytes: 20,
            license: None,
            run_contract: RunContract::SherpaStt {
                family: crate::models::hf::adapters::SherpaSttFamily::SenseVoice,
                model_file: "model.int8.onnx".to_string(),
                decoder_file: None,
                joiner_file: None,
                tokens_file: Some("tokens.txt".to_string()),
                use_itn: true,
            },
            installed_at: "2026-08-19T00:00:00Z".to_string(),
            installed: true,
        };
        write_model_files(&sense);
        registry_insert(&pool, &sense).await.unwrap();
        assert_eq!(
            stt_route_for_model(&pool, &sense.id).await,
            SttEngineRoute::SenseVoice { model: "model.int8.onnx".to_string() }
        );
    }
}
