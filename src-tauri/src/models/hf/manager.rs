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
    SherpaOnnxSttAdapter, SherpaOnnxTtsAdapter, WhisperCppAdapter,
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
    /// Compact id prefix used in the model id (`hf:{tag}:{repo}@{rev}`).
    pub fn tag(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper",
            HfRuntime::SherpaOnnxStt => "sherpa-stt",
            HfRuntime::SherpaOnnxTts => "sherpa-tts",
        }
    }

    pub fn from_tag(tag: &str) -> Option<HfRuntime> {
        match tag {
            "whisper" => Some(HfRuntime::WhisperCpp),
            "sherpa-stt" => Some(HfRuntime::SherpaOnnxStt),
            "sherpa-tts" => Some(HfRuntime::SherpaOnnxTts),
            _ => None,
        }
    }

    pub fn adapter(self) -> Box<dyn RuntimeAdapter> {
        match self {
            HfRuntime::WhisperCpp => Box::new(WhisperCppAdapter),
            HfRuntime::SherpaOnnxStt => Box::new(SherpaOnnxSttAdapter),
            HfRuntime::SherpaOnnxTts => Box::new(SherpaOnnxTtsAdapter),
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
        Some(InstalledHfModel {
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
        })
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
                Some(InstalledHfModel {
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
                })
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
    let root = PathBuf::from(&model.install_dir);
    match runtime {
        HfRuntime::WhisperCpp => match model.run_contract {
            RunContract::Whisper { model_file } => Some(root.join(model_file)),
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
    Some((model.runtime, model.run_contract))
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

    // Ensure the model files aren't already on disk (leftover from a crash).
    let mut artifact_files: Vec<InstalledModelFile> = Vec::new();
    let client = hf_client();
    let mut installed_size: u64 = 0;

    for file in &target.artifact.files {
        let rel = file.path.trim_start_matches('/');
        let dest = target.install_dir.join(rel);
        let url = resolve_download_url(&target.repo_id, &target.revision, rel);

        let meta = target.file_metadata.get(&file.path);
        let expected_sha = meta
            .and_then(|m| m.sha256.clone())
            .or_else(|| file.sha256.clone());
        let expected_size = meta
            .and_then(|m| m.size)
            .or(file.size);

        download_file(
            &client,
            &url,
            &dest,
            expected_sha.as_deref(),
            expected_size,
            Some(app),
            &target.model_id,
            rel,
            Some(&cancel),
        )
        .await?;

        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        installed_size += size;
        artifact_files.push(InstalledModelFile {
            path: rel.to_string(),
            size,
            sha256: expected_sha,
        });
    }

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
        if m.runtime != HfRuntime::SherpaOnnxStt && m.runtime != HfRuntime::WhisperCpp {
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
