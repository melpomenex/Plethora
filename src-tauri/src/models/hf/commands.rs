//! Tauri commands for the HF speech-model manager (requirement #19).

use super::adapters::{Artifact, DetectionConfidence, HfRuntime, detect_all};
use super::downloader::PROGRESS_EVENT;
use super::hf_client::{
    HfFile, RepoInput, build_file_index, clean_revision, fetch_repo_info, hf_metadata_client,
    params_millions, parse_repo_input, repo_display_name,
};
use super::manager::{
    InstallTarget, InstalledHfModel, app_data_dir, install, install_dir_for, is_pinned_nemotron_repo,
    model_id_for, registry_list, resolve_install_target, resolve_pinned_nemotron_install_target,
    uninstall, NEMOTRON_ASR_ENCODER_FILE, NEMOTRON_ASR_REVISION, NEMOTRON_ASR_SIZE_BYTES,
    nemotron_asr_catalog_entry,
};
use super::suitability::{Suitability, classify, disk_insufficient};
use super::system_info::{SystemInfo, detect_system_info, models_root_dir};
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, command};
use tokio_util::sync::CancellationToken;

// ─────────────────────────────────────────────────────────────────────────────
// Active-download tracking (cancel support + in-flight dedupe)
// ─────────────────────────────────────────────────────────────────────────────

/// Managed state: install id -> cancellation token for in-flight downloads.
#[derive(Default)]
pub struct ActiveHfDownloads {
    pub map: Mutex<HashMap<String, CancellationToken>>,
}

impl ActiveHfDownloads {
    /// Register an in-flight install. Returns `false` when the id is already
    /// downloading (duplicate-install rejection — two concurrent downloads
    /// would interleave progress under one key and fight over the same
    /// `.part` file).
    pub fn try_register(&self, id: &str, token: CancellationToken) -> bool {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        if map.contains_key(id) {
            return false;
        }
        map.insert(id.to_string(), token);
        true
    }

    pub fn unregister(&self, id: &str) {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        let token = self
            .map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned();
        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }
}

/// RAII guard: unregisters the install id on drop (including panics and early
/// returns), so an aborted install can never wedge the "already downloading"
/// gate shut.
pub struct ActiveDownloadGuard {
    pub app: AppHandle,
    pub id: String,
}

impl Drop for ActiveDownloadGuard {
    fn drop(&mut self) {
        if let Some(state) = self.app.try_state::<ActiveHfDownloads>() {
            state.unregister(&self.id);
        }
    }
}

/// Register `id` as in-flight, or fail with an "already downloading" error.
pub fn active_try_register(
    app: &AppHandle,
    id: &str,
    token: CancellationToken,
) -> std::result::Result<ActiveDownloadGuard, PlethoraError> {
    if let Some(state) = app.try_state::<ActiveHfDownloads>() {
        if !state.try_register(id, token) {
            return Err(PlethoraError::Internal(format!(
                "{id} is already downloading; wait for it to finish or cancel it first"
            )));
        }
    }
    Ok(ActiveDownloadGuard {
        app: app.clone(),
        id: id.to_string(),
    })
}

pub fn active_cancel(app: &AppHandle, id: &str) -> bool {
    app.try_state::<ActiveHfDownloads>()
        .map(|state| state.cancel(id))
        .unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspection
// ─────────────────────────────────────────────────────────────────────────────

/// A single file shown in the inspection UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfFileSummary {
    pub path: String,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

/// The full result of `hf_inspect_model`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfInspection {
    pub repo_id: String,
    pub revision: String,
    pub name: String,
    pub author: Option<String>,
    pub task: Option<String>,
    /// Architecture-ish tags (e.g. whisper, automatic-speech-recognition).
    pub architecture: Vec<String>,
    /// Parameter count in millions, when the repo exposes it.
    pub params_millions: Option<u64>,
    /// Derived precision/quantization of the primary model file (estimate).
    pub precision: Option<String>,
    /// Total size of the repo's non-directory files (estimate).
    pub download_size_bytes: u64,
    pub license: Option<String>,
    pub files: Vec<HfFileSummary>,
    pub candidates: Vec<Artifact>,
    pub suitability: Vec<ArtifactSuitability>,
    pub system_info: SystemInfo,
    /// True whenever any metadata shown is an estimate (sizes, precision).
    pub estimates_labeled: bool,
}

/// A candidate artifact paired with its suitability verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactSuitability {
    pub artifact: Artifact,
    pub suitability: Suitability,
}

/// Infer precision/quantization from the primary model file name (best effort).
fn infer_precision(info_files: &[HfFile]) -> Option<String> {
    let name = info_files
        .iter()
        .map(|f| f.rfilename.to_lowercase())
        .find(|n| {
            n.ends_with(".onnx")
                || (n.starts_with("ggml-") && n.ends_with(".bin"))
                || n.ends_with(".bin")
        })?;
    if name.contains("int8") {
        Some("int8 quantized".to_string())
    } else if name.contains("fp16") || name.contains("half") || name.contains("f16") {
        Some("fp16".to_string())
    } else if name.contains("fp32") || name.contains("f32") {
        Some("fp32".to_string())
    } else if name.contains("q4") || name.contains("q5") || name.contains("q8") {
        Some("quantized (q-format)".to_string())
    } else if name.starts_with("ggml-") && name.ends_with(".bin") {
        // whisper.cpp ggml models are fp16 internally unless the name says otherwise.
        Some("fp16 (ggml)".to_string())
    } else if name.ends_with(".onnx") {
        Some("unknown (likely fp32)".to_string())
    } else {
        None
    }
}

async fn build_pinned_nemotron_inspection(
    app_handle: &AppHandle,
) -> std::result::Result<HfInspection, PlethoraError> {
    let catalog = nemotron_asr_catalog_entry();
    let target = resolve_pinned_nemotron_install_target(app_handle)
        .await
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let app_data = app_data_dir(app_handle).map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let system_info = detect_system_info(&models_root_dir(&app_data));
    let artifact = target.artifact.clone();
    let suitability = vec![ArtifactSuitability {
        artifact: artifact.clone(),
        suitability: classify(&system_info, Some(&artifact)),
    }];

    Ok(HfInspection {
        repo_id: catalog.repo_id,
        revision: catalog.revision,
        name: catalog.display_name,
        author: Some("nvidia".to_string()),
        task: Some("automatic-speech-recognition".to_string()),
        architecture: vec!["nemotron".to_string(), "asr".to_string()],
        params_millions: Some(600),
        precision: Some("gguf".to_string()),
        download_size_bytes: target.artifact.download_size_bytes,
        license: target.license.clone(),
        files: target
            .artifact
            .files
            .iter()
            .map(|f| HfFileSummary {
                path: f.path.clone(),
                size: f.size.or(Some(NEMOTRON_ASR_SIZE_BYTES)),
                sha256: f.sha256.clone(),
            })
            .collect(),
        candidates: vec![artifact],
        suitability,
        system_info,
        estimates_labeled: false,
    })
}

#[command]
pub async fn hf_inspect_model(
    app_handle: AppHandle,
    repo_input: String,
) -> Result<HfInspection> {
    let parsed: RepoInput = parse_repo_input(&repo_input)?;
    if is_pinned_nemotron_repo(&parsed.repo_id) {
        return build_pinned_nemotron_inspection(&app_handle).await;
    }
    let client = hf_metadata_client();
    let revision = clean_revision(parsed.revision.as_deref().unwrap_or("main"));
    let revision = if revision.is_empty() { "main" } else { revision.as_str() };

    let info = fetch_repo_info(&client, &parsed.repo_id, Some(revision))
        .await
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;

    let index = build_file_index(&client, &parsed.repo_id, revision, &info).await;
    let candidates = detect_all(&info, &index);

    let system_info = {
        let app_data = app_data_dir(&app_handle).map_err(|e| PlethoraError::Internal(e.to_string()))?;
        detect_system_info(&models_root_dir(&app_data))
    };

    let suitability: Vec<ArtifactSuitability> = candidates
        .iter()
        .map(|artifact| ArtifactSuitability {
            artifact: artifact.clone(),
            suitability: classify(&system_info, Some(artifact)),
        })
        .collect();

    // A repo with no detectable artifact gets an explicit unsupported verdict.
    if suitability.is_empty() {
        let unsupported = ArtifactSuitability {
            artifact: Artifact {
                runtime: super::adapters::HfRuntime::WhisperCpp,
                kind: "none".to_string(),
                label: "No supported artifact".to_string(),
                files: vec![],
                download_size_bytes: 0,
                run_contract: super::adapters::RunContract::Whisper {
                    model_file: String::new(),
                },
                estimated_memory_bytes: 0,
                confidence: DetectionConfidence::Exact,
                metadata: Default::default(),
            },
            suitability: classify(&system_info, None),
        };
        // Keep `candidates` empty; only carry the verdict for the UI.
        return Ok(HfInspection {
            repo_id: parsed.repo_id,
            revision: revision.to_string(),
            name: repo_display_name(&info.id),
            author: info.author.clone(),
            task: info.pipeline_tag.clone(),
            architecture: info.tags.clone(),
            params_millions: params_millions(&info),
            precision: infer_precision(&info.siblings),
            download_size_bytes: info
                .siblings
                .iter()
                .filter_map(|f| super::hf_client::file_size_for(f))
                .sum(),
            license: info.license.clone(),
            files: index
                .paths()
                .into_iter()
                .map(|p| HfFileSummary {
                    size: index.size_of(&p),
                    sha256: index.sha_of(&p),
                    path: p,
                })
                .collect(),
            candidates: vec![],
            suitability: vec![unsupported],
            system_info,
            estimates_labeled: true,
        });
    }

    Ok(HfInspection {
        repo_id: parsed.repo_id,
        revision: revision.to_string(),
        name: repo_display_name(&info.id),
        author: info.author.clone(),
        task: info.pipeline_tag.clone(),
        architecture: info.tags.clone(),
        params_millions: params_millions(&info),
        precision: infer_precision(&info.siblings),
        download_size_bytes: info
            .siblings
            .iter()
            .filter_map(|f| super::hf_client::file_size_for(f))
            .sum(),
        license: info.license.clone(),
        files: index
            .paths()
            .into_iter()
            .map(|p| HfFileSummary {
                size: index.size_of(&p),
                sha256: index.sha_of(&p),
                path: p,
            })
            .collect(),
        candidates,
        suitability,
        system_info,
        estimates_labeled: true,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// System info
// ─────────────────────────────────────────────────────────────────────────────

#[command]
pub fn get_system_info(app_handle: AppHandle) -> Result<SystemInfo> {
    let app_data = app_data_dir(&app_handle).map_err(|e| PlethoraError::Internal(e.to_string()))?;
    Ok(detect_system_info(&models_root_dir(&app_data)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Install / cancel / uninstall / list
// ─────────────────────────────────────────────────────────────────────────────

/// Parse the `runtime` argument sent by the frontend. The frontend sends the
/// serde kebab-case values (`whisper-cpp | sherpa-onnx-stt | sherpa-onnx-tts`),
/// which `HfRuntime::from_tag` accepts (see `manager.rs`).
fn parse_runtime_arg(runtime: &str) -> std::result::Result<HfRuntime, PlethoraError> {
    HfRuntime::from_tag(runtime)
        .ok_or_else(|| PlethoraError::InvalidInput(format!("Unknown runtime '{}'", runtime)))
}

#[command]
pub async fn hf_install_model(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    repo_input: String,
    runtime: String,
    artifact_kind: String,
) -> Result<InstalledHfModel> {
    let parsed: RepoInput = parse_repo_input(&repo_input)?;
    let runtime = parse_runtime_arg(&runtime)?;

    let target: InstallTarget = if is_pinned_nemotron_repo(&parsed.repo_id)
        && runtime == HfRuntime::NemotronAsr
    {
        resolve_pinned_nemotron_install_target(&app_handle)
            .await
            .map_err(|e| PlethoraError::Internal(e.to_string()))?
    } else {
        resolve_install_target(&app_handle, &parsed, runtime, &artifact_kind)
            .await
            .map_err(|e| PlethoraError::Internal(e.to_string()))?
    };

    // Server-side hard gate: re-run the disk check so an artifact that no
    // longer fits (or a Not-Recommended override) can never install a model
    // when the drive lacks space. Re-checks the live artifact, not stale UI
    // state.
    let app_data = app_data_dir(&app_handle).map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let system_info = detect_system_info(&models_root_dir(&app_data));
    if let Some(msg) = disk_insufficient(&system_info, &target.artifact) {
        return Err(PlethoraError::Validation(msg));
    }

    let cancel = CancellationToken::new();
    // Reject duplicate concurrent installs of the same model id; the guard
    // unregisters on any exit path (success, error, panic).
    let _guard = active_try_register(&app_handle, &target.model_id, cancel.clone())?;

    let result = install(&app_handle, &repo, &target, cancel.clone()).await;

    result.map_err(|e| PlethoraError::Internal(e.to_string()))
}

#[command]
pub fn hf_cancel_install(app_handle: AppHandle, id: String) -> Result<()> {
    if !active_cancel(&app_handle, &id) {
        // Not an error: nothing in flight (already finished).
        return Ok(());
    }
    Ok(())
}

#[command]
pub async fn hf_uninstall_model(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    id: String,
) -> Result<()> {
    uninstall(&app_handle, &repo, &id).await.map_err(|e| PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn get_installed_hf_models(repo: State<'_, Repository>) -> Result<Vec<InstalledHfModel>> {
    registry_list(repo.pool()).await.map_err(|e| PlethoraError::Internal(e.to_string()))
}

/// Pinned Nemotron ASR catalog metadata for Local Models → Speech-to-Text.
#[command]
pub fn get_nemotron_asr_catalog_entry() -> super::manager::PinnedNemotronAsrCatalogEntry {
    super::manager::nemotron_asr_catalog_entry()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact kebab-case values the frontend sends to `hf_install_model`
    /// (`src/api/hfModels.ts` type `HfRuntime`), mapped to the variant they
    /// must produce. This pins the review-blocker parse path.
    #[test]
    fn hf_install_model_parses_exact_frontend_runtime_values() {
        let cases: &[(&str, HfRuntime)] = &[
            ("whisper-cpp", HfRuntime::WhisperCpp),
            ("sherpa-onnx-stt", HfRuntime::SherpaOnnxStt),
            ("sherpa-onnx-tts", HfRuntime::SherpaOnnxTts),
            ("nemotron-asr", HfRuntime::NemotronAsr),
        ];
        for (raw, expected) in cases {
            let parsed = parse_runtime_arg(raw).unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(parsed, *expected, "frontend value {raw:?}");
        }
        assert!(parse_runtime_arg("bogus").is_err());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // In-flight dedupe (fix-nemotron-model-download)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn duplicate_install_id_is_rejected_while_in_flight() {
        let state = ActiveHfDownloads::default();
        let first = CancellationToken::new();
        assert!(
            state.try_register("hf:nemotron-asr:repo", first.clone()),
            "first registration succeeds"
        );
        assert!(
            !state.try_register("hf:nemotron-asr:repo", CancellationToken::new()),
            "second registration for the same id is rejected"
        );
        // A different id is unaffected.
        assert!(state.try_register("other-model", CancellationToken::new()));
    }

    #[test]
    fn unregister_frees_the_slot_for_the_next_install() {
        let state = ActiveHfDownloads::default();
        assert!(state.try_register("m1", CancellationToken::new()));
        state.unregister("m1");
        assert!(
            state.try_register("m1", CancellationToken::new()),
            "slot is reusable after unregister"
        );
    }

    #[test]
    fn cancel_fires_the_registered_token() {
        let state = ActiveHfDownloads::default();
        let token = CancellationToken::new();
        assert!(state.try_register("m1", token.clone()));
        assert!(!state.cancel("missing"), "unknown id reports false");
        assert!(state.cancel("m1"));
        assert!(token.is_cancelled(), "in-flight token is cancelled");
    }
}
