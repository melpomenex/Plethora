//! Managed local Laya decision server.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::hf::adapters::HfRuntime;
use crate::models::hf::laya_catalog::{
    TYPED_DECISIONS_FILES, TYPED_DECISIONS_REPO, TYPED_DECISIONS_REVISION,
};
use crate::models::hf::manager::{registry_list, InstalledHfModel};
use crate::ocr::nougat_runtime::ensure_managed_uv;
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{sleep, Duration, Instant};

const LAYA_VERSION: &str = "0.5.2";
pub const LAYA_ENDPOINT: &str = "http://127.0.0.1:8000";
const LAYA_STATUS_EVENT: &str = "laya://server-status";
const LAYA_MODEL_PORT: u16 = 8000;
const LAYA_SUPPORT_FILE_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayaServerStatus {
    pub phase: String,
    pub running: bool,
    pub managed: bool,
    pub endpoint: String,
    pub detail: Option<String>,
}

impl Default for LayaServerStatus {
    fn default() -> Self {
        Self {
            phase: "stopped".to_string(),
            running: false,
            managed: false,
            endpoint: LAYA_ENDPOINT.to_string(),
            detail: None,
        }
    }
}

#[derive(Default)]
struct RuntimeState {
    child: Option<Child>,
    status: LayaServerStatus,
}

static SERVER_STATE: OnceLock<Mutex<RuntimeState>> = OnceLock::new();
static SERVER_OPERATION: OnceLock<TokioMutex<()>> = OnceLock::new();

fn state() -> &'static Mutex<RuntimeState> {
    SERVER_STATE.get_or_init(|| Mutex::new(RuntimeState::default()))
}

fn operation_lock() -> &'static TokioMutex<()> {
    SERVER_OPERATION.get_or_init(|| TokioMutex::new(()))
}

fn publish_status(
    app: &AppHandle,
    phase: &str,
    running: bool,
    managed: bool,
    detail: Option<String>,
) {
    let status = LayaServerStatus {
        phase: phase.to_string(),
        running,
        managed,
        endpoint: LAYA_ENDPOINT.to_string(),
        detail,
    };
    if let Ok(mut current) = state().lock() {
        current.status = status.clone();
    }
    let _ = app.emit(LAYA_STATUS_EVENT, status);
}

fn fail(app: &AppHandle, message: String) -> PlethoraError {
    publish_status(app, "error", false, false, Some(message.clone()));
    PlethoraError::Internal(message)
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        PlethoraError::Internal(format!("Failed to resolve Plethora app data: {error}"))
    })?;
    Ok(app_data.join("laya").join("server-runtime"))
}

fn python_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("venv").join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("venv").join("bin").join("python")
    }
}

fn server_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("venv").join("Scripts").join("laya-serve.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("venv").join("bin").join("laya-serve")
    }
}

fn configure_uv(command: &mut Command, root: &Path) {
    command
        .env("UV_CACHE_DIR", root.join("cache"))
        .env("UV_PYTHON_INSTALL_DIR", root.join("python"))
        .env("UV_NO_PROGRESS", "1")
        .env("UV_ISOLATED", "1")
        .env("UV_PYTHON_PREFERENCE", "only-managed");
}

fn tail_output(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).replace('\r', "");
    let tail: String = text.chars().rev().take(4_000).collect();
    tail.chars().rev().collect::<String>().trim().to_string()
}

async fn run_checked(command: &mut Command, label: &str) -> Result<()> {
    command.stdin(Stdio::null());
    command.kill_on_drop(true);
    let output = command
        .output()
        .await
        .map_err(|error| PlethoraError::Internal(format!("Could not start {label}: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = if output.stderr.is_empty() {
        tail_output(&output.stdout)
    } else {
        tail_output(&output.stderr)
    };
    Err(PlethoraError::Internal(format!(
        "{label} failed ({}).{}",
        output.status,
        if detail.is_empty() {
            String::new()
        } else {
            format!(" {detail}")
        }
    )))
}

fn expected_digest(path: &str) -> Option<&'static str> {
    TYPED_DECISIONS_FILES
        .iter()
        .find(|(p, _)| *p == path)
        .map(|(_, digest)| *digest)
}

async fn file_has_digest(path: &Path, expected: &str) -> bool {
    let path = path.to_path_buf();
    let expected = expected.to_owned();
    tokio::task::spawn_blocking(move || {
        crate::models::hf::downloader::sha256_of_file(&path)
            .is_ok_and(|digest| digest.eq_ignore_ascii_case(&expected))
    })
    .await
    .unwrap_or(false)
}

async fn download_support_file(
    client: &reqwest::Client,
    model_dir: &Path,
    relative_path: &str,
    digest: &str,
) -> Result<()> {
    let destination = model_dir.join(relative_path);
    if !destination.starts_with(model_dir) {
        return Err(PlethoraError::Validation(
            "The Laya checkpoint contains an unsafe file path.".to_string(),
        ));
    }
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            PlethoraError::Internal(format!("Could not prepare Laya checkpoint files: {error}"))
        })?;
        let real_parent = tokio::fs::canonicalize(parent).await.map_err(|error| {
            PlethoraError::Internal(format!(
                "Could not resolve the Laya checkpoint path: {error}"
            ))
        })?;
        let real_root = tokio::fs::canonicalize(model_dir).await.map_err(|error| {
            PlethoraError::Internal(format!(
                "Could not resolve the Laya model directory: {error}"
            ))
        })?;
        if !real_parent.starts_with(&real_root) {
            return Err(PlethoraError::Validation(
                "The Laya checkpoint path resolves outside its managed model directory."
                    .to_string(),
            ));
        }
    }
    if file_has_digest(&destination, digest).await {
        return Ok(());
    }

    let url = format!(
        "https://huggingface.co/{TYPED_DECISIONS_REPO}/resolve/{TYPED_DECISIONS_REVISION}/{relative_path}"
    );
    let response = client.get(url).send().await.map_err(|error| {
        PlethoraError::Internal(format!("Could not fetch Laya checkpoint metadata: {error}"))
    })?;
    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Laya checkpoint file download returned HTTP {}.",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > LAYA_SUPPORT_FILE_LIMIT)
    {
        return Err(PlethoraError::Validation(
            "A Laya checkpoint support file exceeded the expected size.".to_string(),
        ));
    }

    let temporary = destination.with_extension("laya-part");
    if tokio::fs::try_exists(&temporary).await.unwrap_or(false) {
        tokio::fs::remove_file(&temporary).await.map_err(|error| {
            PlethoraError::Internal(format!("Could not clear a temporary Laya file: {error}"))
        })?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!("Could not create a temporary Laya file: {error}"))
        })?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            PlethoraError::Internal(format!("Laya checkpoint download failed: {error}"))
        })?;
        size = size.saturating_add(chunk.len() as u64);
        if size > LAYA_SUPPORT_FILE_LIMIT {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(PlethoraError::Validation(
                "A Laya checkpoint support file exceeded the expected size.".to_string(),
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|error| {
            PlethoraError::Internal(format!("Could not save a Laya checkpoint file: {error}"))
        })?;
    }
    file.flush().await.map_err(|error| {
        PlethoraError::Internal(format!("Could not finish a Laya checkpoint file: {error}"))
    })?;
    file.sync_all().await.map_err(|error| {
        PlethoraError::Internal(format!("Could not sync a Laya checkpoint file: {error}"))
    })?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(digest) {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(PlethoraError::Internal(format!(
            "Laya checkpoint verification failed for {relative_path}."
        )));
    }
    if tokio::fs::try_exists(&destination).await.unwrap_or(false) {
        tokio::fs::remove_file(&destination)
            .await
            .map_err(|error| {
                PlethoraError::Internal(format!(
                    "Could not replace a Laya checkpoint file: {error}"
                ))
            })?;
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!("Could not install a Laya checkpoint file: {error}"))
        })?;
    Ok(())
}

async fn resolve_typed_model(
    app: &AppHandle,
    repo: &Repository,
) -> Result<(InstalledHfModel, PathBuf)> {
    let models = registry_list(repo.pool()).await.map_err(|error| {
        PlethoraError::Internal(format!("Could not read installed Laya models: {error}"))
    })?;
    let model = models
        .into_iter()
        .find(|model| {
            model.repo_id.eq_ignore_ascii_case(TYPED_DECISIONS_REPO)
                && model.revision == TYPED_DECISIONS_REVISION
                && model.runtime == HfRuntime::LayaDecision
                && model.installed
        })
        .ok_or_else(|| {
            PlethoraError::Validation(
                "Download the Laya typed-decisions model in Plethora before starting its server."
                    .to_string(),
            )
        })?;

    let install_dir = PathBuf::from(&model.install_dir);
    let app_data = app.path().app_data_dir().map_err(|error| {
        PlethoraError::Internal(format!(
            "Could not resolve Plethora data directory: {error}"
        ))
    })?;
    let canonical_app_data = tokio::fs::canonicalize(&app_data).await.map_err(|error| {
        PlethoraError::Internal(format!(
            "Could not resolve Plethora data directory: {error}"
        ))
    })?;
    let models_dir = tokio::fs::canonicalize(app_data.join("models"))
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!(
                "Could not resolve the managed models directory: {error}"
            ))
        })?;
    if !models_dir.starts_with(&canonical_app_data) {
        return Err(PlethoraError::Validation(
            "Plethora's models directory resolves outside its app data directory.".to_string(),
        ));
    }
    let canonical_root = tokio::fs::canonicalize(models_dir.join("laya"))
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!(
                "Could not resolve the Laya models directory: {error}"
            ))
        })?;
    if !canonical_root.starts_with(&models_dir) {
        return Err(PlethoraError::Validation(
            "The Laya models directory resolves outside Plethora's managed models directory."
                .to_string(),
        ));
    }
    let canonical_install = tokio::fs::canonicalize(&install_dir)
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!(
                "Could not resolve the installed Laya model: {error}"
            ))
        })?;
    if !canonical_install.starts_with(&canonical_root) {
        return Err(PlethoraError::Validation(
            "The installed Laya model is outside Plethora's managed model directory.".to_string(),
        ));
    }

    for path in ["model.safetensors", "tokenizer/tokenizer.json"] {
        let expected = expected_digest(path).expect("catalog has the primary Laya files");
        let file = model.artifact_files.iter().find(|file| file.path == path);
        if file.and_then(|file| file.sha256.as_deref()) != Some(expected) {
            return Err(PlethoraError::Validation(format!(
                "The installed Laya file {path} is not pinned to the supported checkpoint. Remove it and download it again."
            )));
        }
        if !file_has_digest(&canonical_install.join(path), expected).await {
            return Err(PlethoraError::Validation(format!(
                "The installed Laya file {path} failed verification. Remove it and download it again."
            )));
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| {
            PlethoraError::Internal(format!("Could not create the Laya downloader: {error}"))
        })?;
    for (path, digest) in TYPED_DECISIONS_FILES {
        if matches!(*path, "model.safetensors" | "tokenizer/tokenizer.json") {
            continue;
        }
        download_support_file(&client, &canonical_install, path, digest).await?;
    }
    Ok((model, canonical_install))
}

async fn endpoint_is_healthy(client: &reqwest::Client) -> bool {
    client
        .get(format!("{LAYA_ENDPOINT}/health"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

/// Returns true when Plethora's managed `laya-serve` child process is alive.
pub fn is_managed_running() -> bool {
    let Ok(mut current) = state().lock() else {
        return false;
    };
    if current
        .child
        .as_mut()
        .is_some_and(|child| child.try_wait().ok().flatten().is_some())
    {
        current.child = None;
        current.status = LayaServerStatus::default();
        return false;
    }
    current.child.is_some()
}

/// Fast health check for a local `laya-serve` endpoint.
pub async fn is_laya_endpoint_healthy(base_url: &str) -> bool {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    let client = reqwest::Client::new();
    client
        .get(format!("{trimmed}/health"))
        .timeout(Duration::from_millis(400))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn port_is_open() -> bool {
    std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], LAYA_MODEL_PORT)),
        Duration::from_millis(250),
    )
    .is_ok()
}

async fn ensure_laya_package(app: &AppHandle, root: &Path) -> Result<PathBuf> {
    let uv = ensure_managed_uv(app, root).await?;
    let python = python_binary(root);
    let python_ok = if tokio::fs::try_exists(&python).await.unwrap_or(false) {
        let mut command = Command::new(&python);
        command.arg("--version");
        crate::utils::python_env::sanitize_python_env(command.as_std_mut());
        command
            .output()
            .await
            .is_ok_and(|output| output.status.success())
    } else {
        false
    };
    if !python_ok {
        let mut command = Command::new(&uv);
        // `configure_uv` sets `UV_PYTHON_PREFERENCE=only-managed`; passing
        // `--managed-python` as well makes uv reject the duplicate preference.
        command
            .args(["venv", "--python", "3.11"])
            .arg(root.join("venv"));
        configure_uv(&mut command, root);
        run_checked(&mut command, "Python 3.11 setup").await?;
    }

    let package_ready = {
        let mut command = Command::new(&python);
        command.args([
            "-c",
            "import importlib.metadata as m; assert m.version('laya') == '0.5.2'; import fastapi, uvicorn, torch, transformers",
        ]);
        crate::utils::python_env::sanitize_python_env(command.as_std_mut());
        command
            .output()
            .await
            .is_ok_and(|output| output.status.success())
    };
    if !package_ready {
        let mut command = Command::new(&uv);
        command
            .args(["pip", "install", "--python"])
            .arg(&python)
            .args(["--index-url", "https://pypi.org/simple", "--upgrade"])
            .arg(format!("laya[serve]=={LAYA_VERSION}"));
        configure_uv(&mut command, root);
        run_checked(&mut command, "Laya server installation").await?;
    }
    if !tokio::fs::try_exists(server_binary(root))
        .await
        .unwrap_or(false)
    {
        return Err(PlethoraError::Internal(
            "Laya installed without its laya-serve launcher.".to_string(),
        ));
    }
    Ok(python)
}

#[tauri::command]
pub async fn laya_server_status(_app: AppHandle) -> Result<LayaServerStatus> {
    let client = reqwest::Client::new();
    let managed_running = {
        let mut current = state().lock().unwrap_or_else(|error| error.into_inner());
        if current
            .child
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_some())
        {
            current.child = None;
            current.status = LayaServerStatus::default();
        }
        current.child.is_some()
    };
    if managed_running || endpoint_is_healthy(&client).await {
        let managed = state()
            .lock()
            .map(|current| current.child.is_some())
            .unwrap_or(false);
        let status = LayaServerStatus {
            phase: "running".to_string(),
            running: true,
            managed,
            endpoint: LAYA_ENDPOINT.to_string(),
            detail: None,
        };
        if let Ok(mut current) = state().lock() {
            current.status = status.clone();
        }
        return Ok(status);
    }
    let status = state()
        .lock()
        .map(|current| current.status.clone())
        .unwrap_or_default();
    Ok(status)
}

#[tauri::command]
pub async fn laya_server_start(
    app: AppHandle,
    repo: State<'_, Repository>,
) -> Result<LayaServerStatus> {
    let _operation = operation_lock().lock().await;
    let client = reqwest::Client::new();
    if endpoint_is_healthy(&client).await {
        publish_status(
            &app,
            "running",
            true,
            false,
            Some("Connected to the local Laya server.".to_string()),
        );
        return Ok(LayaServerStatus {
            phase: "running".to_string(),
            running: true,
            managed: false,
            endpoint: LAYA_ENDPOINT.to_string(),
            detail: Some("Connected to the local Laya server.".to_string()),
        });
    }
    if port_is_open() {
        return Err(fail(
            &app,
            "Port 8000 is already in use by another local service. Close it and try again."
                .to_string(),
        ));
    }

    publish_status(
        &app,
        "preparing-model",
        false,
        false,
        Some("Preparing and verifying the downloaded Laya checkpoint…".to_string()),
    );
    let (_model, model_dir) = resolve_typed_model(&app, &repo)
        .await
        .map_err(|error| fail(&app, error.to_string()))?;

    publish_status(
        &app,
        "installing-runtime",
        false,
        false,
        Some(
            "Setting up the isolated Laya runtime. This can take a while the first time."
                .to_string(),
        ),
    );
    let root = runtime_root(&app).map_err(|error| fail(&app, error.to_string()))?;
    tokio::fs::create_dir_all(&root).await.map_err(|error| {
        fail(
            &app,
            format!("Could not create the managed Laya runtime: {error}"),
        )
    })?;
    let _python = ensure_laya_package(&app, &root)
        .await
        .map_err(|error| fail(&app, error.to_string()))?;

    let extra_models = serde_json::json!({ "typed-decisions": model_dir.to_string_lossy() });
    let log_path = root.join("laya-serve.log");
    let log_output = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|error| fail(&app, format!("Could not open the Laya server log: {error}")))?;
    let log_error = log_output.try_clone().map_err(|error| {
        fail(
            &app,
            format!("Could not prepare Laya server logging: {error}"),
        )
    })?;
    let mut command = Command::new(server_binary(&root));
    command
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_output))
        .stderr(Stdio::from(log_error))
        .kill_on_drop(true);
    crate::utils::python_env::sanitize_python_env(command.as_std_mut());
    // The Laya variables are set after inherited Python state is sanitized.
    command
        .env("LAYA_HOST", "127.0.0.1")
        .env("LAYA_PORT", LAYA_MODEL_PORT.to_string())
        .env("LAYA_MODELS", "typed-decisions")
        .env("LAYA_EXTRA_MODELS", extra_models.to_string())
        .env("LAYA_PRELOAD", "1")
        .env("HF_HOME", root.join("huggingface"))
        .env("HF_HUB_OFFLINE", "1")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("USE_TF", "0");

    publish_status(
        &app,
        "starting",
        false,
        false,
        Some("Loading Laya's decision model…".to_string()),
    );
    let mut child = command
        .spawn()
        .map_err(|error| fail(&app, format!("Could not start laya-serve: {error}")))?;
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if endpoint_is_healthy(&client).await {
            let status = LayaServerStatus {
                phase: "running".to_string(),
                running: true,
                managed: true,
                endpoint: LAYA_ENDPOINT.to_string(),
                detail: Some("Laya is ready for Plethora.".to_string()),
            };
            let mut current = state().lock().unwrap_or_else(|error| error.into_inner());
            current.child = Some(child);
            current.status = status.clone();
            let _ = app.emit(LAYA_STATUS_EVENT, status.clone());
            return Ok(status);
        }
        if let Some(exit) = child
            .try_wait()
            .map_err(|error| fail(&app, format!("Could not check laya-serve: {error}")))?
        {
            let detail = read_log_tail(&log_path).await;
            return Err(fail(
                &app,
                format!(
                    "Laya stopped before it was ready ({exit}).{} Log: {}",
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(" {detail}")
                    },
                    log_path.display()
                ),
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill().await;
            let detail = read_log_tail(&log_path).await;
            return Err(fail(
                &app,
                format!(
                    "Laya did not become ready within 10 minutes.{} Log: {}",
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(" {detail}")
                    },
                    log_path.display()
                ),
            ));
        }
        sleep(Duration::from_millis(500)).await;
    }
}

async fn read_log_tail(path: &Path) -> String {
    tokio::fs::read(path)
        .await
        .map(|bytes| tail_output(&bytes))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn laya_server_stop(app: AppHandle) -> Result<LayaServerStatus> {
    let mut child = {
        let mut current = state().lock().unwrap_or_else(|error| error.into_inner());
        current.child.take()
    };
    if let Some(mut child) = child.take() {
        child.kill().await.map_err(|error| {
            fail(
                &app,
                format!("Could not stop the managed Laya server: {error}"),
            )
        })?;
    }
    publish_status(&app, "stopped", false, false, None);
    Ok(LayaServerStatus::default())
}

/// Kill the managed server when Plethora exits. External servers are untouched.
pub fn stop_on_exit() {
    if let Ok(mut current) = state().try_lock() {
        if let Some(child) = current.child.as_mut() {
            let _ = child.start_kill();
        }
    }
}
