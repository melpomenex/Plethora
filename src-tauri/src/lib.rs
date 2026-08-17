//! Incrementum Tauri application
#![allow(dead_code, private_interfaces, unused)]

mod ai;
mod ai_learning;
mod algorithms;
mod anki;
mod backup;
mod battery;
mod browser_sync_server;
mod cloud;
mod cloud_sync;
mod commands;
mod database;
mod demo;
mod error;
mod generator;
mod integrations;
mod kindle_clippings;
mod legacy_data;
mod mcp;
mod models;
mod notebooklm;
mod notifications;
mod ocr;
// `pub` (visibility only, no behavior change) so the dev-only diagnostic bin
// `src/bin/pdf-reflow-diag.rs` can call `pdf::analysis::analyze_page`
// directly without a Tauri runtime.
pub mod pdf;
mod pocket_tts;
mod podcast;
mod processor;
mod scheduler;
mod segmentation;
mod services;
mod study_json_import;
mod supermemo_import;
mod tas;
mod transcription;
mod twitter;
mod utils;
mod youtube;
// `screenshot` requires the `xcap` crate, which only has a backend on desktop
// (see the target-specific dependency in Cargo.toml). On android/ios the
// `screenshot` cargo feature is a no-op and the module is excluded entirely.
#[cfg(all(
    feature = "screenshot",
    not(any(target_os = "android", target_os = "ios"))
))]
mod screenshot;

mod epub_server;
mod media_server;
mod security;
#[cfg(test)]
mod security_tests;
mod sponsorblock;
mod web_proxy;

use anyhow::Context;
use database::Database;
use std::collections::HashSet;
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};
use tokio::sync::Notify;
use url::Url;

// Global state for the database
struct AppState {
    db: Arc<Mutex<Option<Database>>>,
}

use commands::ai::AIState;
use commands::focus_timer::FocusTimer;

impl AppState {
    fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(None)),
        }
    }
}

/// Gates frontend commands until database migrations and managed services are
/// ready. Native mobile webviews can begin issuing IPC while setup is still in
/// progress, so repository state must exist early without being queried early.
#[derive(Default)]
struct BackendReadyState {
    ready: AtomicBool,
    notify: Notify,
}

impl BackendReadyState {
    fn mark_ready(&self) {
        self.ready.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn wait(&self) {
        while !self.ready.load(Ordering::Acquire) {
            let notified = self.notify.notified();
            if self.ready.load(Ordering::Acquire) {
                break;
            }
            notified.await;
        }
    }
}

/// One-shot notices generated during startup that the frontend should surface
/// to the user exactly once on boot. Stored in managed state so the frontend
/// can poll them even if it boots after the originating event was emitted.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub enum StartupNotice {
    /// The on-disk SQLite database was corrupt; it was quarantined and a fresh
    /// empty database was created. The user has lost local data and may want
    /// to restore from a cloud backup.
    DatabaseRecoveredAfterQuarantine,
    /// A fresh database was created, but we found an auto-backup file
    /// in the public Downloads directory. The user may want to restore it.
    AutoBackupFound { backup_path: String },
    /// External file-level sync left SQLite conflict/corrupt siblings beside
    /// the live database. The files are preserved; the frontend only warns.
    DatabaseIntegrityWarning { artifacts: Vec<String> },
    /// A legacy Incrementum app-data directory was found and a migration is
    /// available. The frontend offers a localized consent dialog (task 3.1).
    LegacyDataAvailable { legacy_path: String },
    /// The legacy Incrementum app-data migration completed; the legacy
    /// directory is preserved untouched at `legacy_path`.
    LegacyDataMigrated {
        legacy_path: String,
        backup_db: Option<String>,
    },
}

mod startup_notice {
    use super::StartupNotice;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};

    /// Managed state holding an optional pending startup notice.
    #[derive(Default)]
    pub struct StartupNoticeState {
        pending: Mutex<Option<StartupNotice>>,
    }

    /// Store a startup notice, overwriting any previous one. No-op if the app
    /// handle has no managed state yet (e.g. very early in setup).
    pub fn set(app: &AppHandle, notice: StartupNotice) {
        if let Some(state) = app.try_state::<StartupNoticeState>() {
            *state.pending.lock().unwrap() = Some(notice);
        }
    }

    /// Take and return the pending startup notice, clearing it so it is only
    /// surfaced once. Returns `None` if there is nothing pending or the state
    /// has not been registered.
    pub fn take(app: &AppHandle) -> Option<StartupNotice> {
        app.try_state::<StartupNoticeState>()?
            .pending
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    }

    /// Register the managed state. Call once during setup, before any
    /// `set`/`take` calls.
    pub fn register(app: &AppHandle) {
        // Idempotent: only insert if not already managed.
        if app.try_state::<StartupNoticeState>().is_none() {
            app.manage(StartupNoticeState::default());
        }
    }
}

fn startup_log_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(app_dir) = app.path().app_data_dir() {
        app_dir.join("logs").join("startup.log")
    } else {
        std::env::temp_dir().join("incrementum-startup.log")
    }
}

fn log_startup(app: &tauri::AppHandle, message: &str) {
    let log_path = startup_log_path(app);
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = chrono::Utc::now().to_rfc3339();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

/// Find SQLite conflict artifacts without mutating them. A marker keeps the
/// same set from reappearing on every launch; a newly-created sibling changes
/// the signature and raises the notice again.
fn detect_database_integrity_artifacts(app: &tauri::AppHandle, app_dir: &std::path::Path) {
    let mut artifact_entries: Vec<(String, String)> = Vec::new();
    let entries = match std::fs::read_dir(app_dir) {
        Ok(entries) => entries,
        Err(err) => {
            tracing::warn!("database integrity scan skipped: {}", err);
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        // `.sync-conflict-` matches Syncthing conflict siblings; `.corrupt.`
        // matches this app's own quarantine naming under BOTH the legacy
        // `incrementum.db.corrupt.*` and current `plethora.db.corrupt.*`
        // stems (task 3.1/3.2 compatibility).
        if name.contains(".sync-conflict-")
            || name.contains(".corrupt-")
            || name.contains(".corrupt.")
        {
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or_default();
            let path_string = path.display().to_string();
            artifact_entries.push((
                path_string.clone(),
                format!("{}|{}|{}", path_string, metadata.len(), modified),
            ));
        }
    }
    artifact_entries.sort_by(|left, right| left.0.cmp(&right.0));
    if artifact_entries.is_empty() {
        return;
    }
    let artifacts: Vec<String> = artifact_entries
        .iter()
        .map(|(path, _)| path.clone())
        .collect();
    let marker = app_dir.join(".database-integrity-notice");
    let signature = artifact_entries
        .iter()
        .map(|(_, signature)| signature.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    if previous == signature {
        return;
    }
    if let Err(err) = std::fs::write(&marker, &signature) {
        tracing::warn!(
            "failed to persist database integrity notice marker: {}",
            err
        );
    }
    startup_notice::set(app, StartupNotice::DatabaseIntegrityWarning { artifacts });
}

/// Remove stranded podcast download files in the background. Active episode
/// IDs are excluded so a live transcription can never lose its input.
fn sweep_orphaned_transcription_temp_files(
    app: tauri::AppHandle,
    active_episode_ids: HashSet<String>,
) {
    let temp_dir = match app.path().app_data_dir() {
        Ok(path) => path.join("temp_transcription"),
        Err(err) => {
            tracing::debug!("transcription temp sweep skipped: {}", err);
            return;
        }
    };
    let now = std::time::SystemTime::now();
    let max_age = std::time::Duration::from_secs(24 * 60 * 60);
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(err) => {
            tracing::debug!("transcription temp sweep unreadable: {}", err);
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };
        if age <= max_age {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let active = active_episode_ids
            .iter()
            .any(|id| name.starts_with(&format!("{}_episode.", id)));
        if active {
            continue;
        }
        if let Err(err) = std::fs::remove_file(&path) {
            tracing::debug!(
                "failed to remove orphaned transcription temp file {}: {}",
                path.display(),
                err
            );
        } else {
            tracing::info!(
                "removed orphaned transcription temp file {}",
                path.display()
            );
        }
    }
}

fn install_panic_hook(app: tauri::AppHandle) {
    // Preserve the default hook so panics are still visible in the console,
    // while also writing to the startup log for GUI launches.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log_startup(&app, &format!("panic: {info}"));
        default_hook(info);
    }));
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn wait_for_backend_ready(state: tauri::State<'_, BackendReadyState>) -> Result<(), String> {
    state.wait().await;
    Ok(())
}

#[cfg(test)]
mod backend_ready_tests {
    use super::BackendReadyState;
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn waiters_are_released_only_after_backend_is_ready() {
        let state = Arc::new(BackendReadyState::default());
        let waiter_state = Arc::clone(&state);
        let waiter = tokio::spawn(async move { waiter_state.wait().await });

        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());

        state.mark_ready();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("backend-ready waiter timed out")
            .expect("backend-ready waiter panicked");
    }
}

#[tauri::command]
async fn download_update_apk(
    app: tauri::AppHandle,
    url: String,
    on_progress: tauri::ipc::Channel<f64>,
) -> Result<String, String> {
    use futures::StreamExt;
    use std::fs::File;
    use std::io::Write;

    let client = reqwest::Client::builder()
        .user_agent("incrementum-updater")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to update URL: {e}"))?;

    let total_size = res.content_length().unwrap_or(0);

    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let apk_path = cache_dir.join("latest_update.apk");

    let mut file =
        File::create(&apk_path).map_err(|e| format!("Failed to create local update file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error downloading update chunk: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Error writing update to disk: {e}"))?;
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = downloaded as f64 / total_size as f64;
            let _ = on_progress.send(progress);
        }
    }

    Ok(apk_path.to_string_lossy().to_string())
}

/// The bundle type the current binary was packaged in — "appimage", "deb",
/// "rpm", "app" (macOS), "msi"/"nsis" (Windows) — or "unknown" for unbundled
/// dev runs. The update flow uses this to decide whether an in-place updater
/// install can work: tauri-plugin-updater replaces the running executable,
/// which on Linux is only user-writable for AppImage installs. deb/rpm
/// installs live at /usr/bin and must download a new package instead of
/// attempting (and always failing) the in-place path.
#[tauri::command]
fn updater_bundle_type() -> String {
    tauri::utils::platform::bundle_type()
        .map(|t| format!("{t:?}").to_lowercase())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Consume and return any pending one-shot startup notice (e.g. "your database
/// was reset due to corruption"). Returns `null` when nothing is pending. The
/// frontend should call this once on boot; the notice is cleared on read so it
/// is only surfaced a single time.
#[tauri::command]
fn consume_startup_notice(app_handle: tauri::AppHandle) -> Option<StartupNotice> {
    startup_notice::take(&app_handle)
}

/// Run the one-time Incrementum → Plethora app-data migration after the user
/// consented in the frontend dialog. Closes the live database pool, copies the
/// legacy tree in (never moving or deleting anything from it), sets the
/// current database aside as a `.pre-migration-backup`, and returns a report.
/// The frontend relaunches the app immediately after this succeeds so all
/// services re-open the migrated database.
#[tauri::command]
async fn migrate_legacy_data(
    app: tauri::AppHandle,
    repo: tauri::State<'_, database::Repository>,
) -> std::result::Result<serde_json::Value, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, repo);
        return Err("Legacy data migration is desktop-only".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let legacy_dir = legacy_data::legacy_app_data_dir(&app_dir);
        // Close the pool first so no connection writes through the file set
        // while it is being replaced.
        repo.pool().close().await;
        let report = tauri::async_runtime::spawn_blocking(move || {
            legacy_data::perform_migration(&app_dir, &legacy_dir)
        })
        .await
        .map_err(|e| format!("migration task failed: {e}"))?
        .map_err(|e| format!("migration failed: {e:#}"))?;
        serde_json::to_value(&report).map_err(|e| e.to_string())
    }
}

/// Record that the user declined the one-time legacy-data migration; the
/// offer will not be repeated. The legacy directory is left untouched either
/// way.
#[tauri::command]
fn decline_legacy_data_migration(app: tauri::AppHandle) -> std::result::Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        legacy_data::mark_declined(&app_dir);
        Ok(())
    }
}

#[tauri::command]
async fn restore_local_db_backup(
    app: tauri::AppHandle,
    repo: tauri::State<'_, database::Repository>,
    backup_path: String,
) -> std::result::Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join(database::connection::DB_FILE_NAME);

    // Close the connection pool to avoid lock conflicts
    let pool = repo.pool().clone();
    pool.close().await;

    let backup_db_path = std::path::PathBuf::from(backup_path);
    if !backup_db_path.exists() {
        return Err("Backup file does not exist".to_string());
    }

    // Run online backup copy pages
    tokio::task::spawn_blocking(move || {
        let backup_db = rusqlite::Connection::open_with_flags(
            &backup_db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let mut live_db = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        )?;
        let backup = rusqlite::backup::Backup::new(&backup_db, &mut live_db)?;
        backup.run_to_completion(5, std::time::Duration::from_millis(250), None)?;
        Ok::<(), rusqlite::Error>(())
    })
    .await
    .map_err(|e| format!("Restore task join error: {e}"))?
    .map_err(|e| format!("SQLite copy failed: {e}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_platform_vibrancy(window: &tauri::WebviewWindow, theme_id: &str) -> bool {
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
    if theme_id == "liquid-glass"
        || theme_id == "amber-liquid-glass"
        || theme_id == "rose-liquid-glass"
    {
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .is_ok()
    } else {
        let _ = clear_vibrancy(window);
        false
    }
}

#[cfg(target_os = "windows")]
fn apply_platform_vibrancy(window: &tauri::WebviewWindow, theme_id: &str) -> bool {
    use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
    if theme_id == "liquid-glass"
        || theme_id == "amber-liquid-glass"
        || theme_id == "rose-liquid-glass"
    {
        if apply_mica(window, None).is_ok() {
            true
        } else {
            // Amber-tinted fallback (30, 20, 8) for acrylic
            apply_acrylic(window, Some((30, 20, 8, 120))).is_ok()
        }
    } else {
        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
        false
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_platform_vibrancy(_window: &tauri::WebviewWindow, _theme_id: &str) -> bool {
    false
}

#[tauri::command]
fn apply_theme_vibrancy(
    window: tauri::WebviewWindow,
    theme_id: String,
    colors: Option<serde_json::Value>,
) -> bool {
    crate::browser_sync_server::set_active_theme(theme_id.clone(), colors);
    apply_platform_vibrancy(&window, &theme_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the rustls crypto provider as the very first thing. reqwest's
    // `rustls-tls` feature compiles rustls 0.23 in `*-no-provider` mode, so no
    // provider is auto-registered. On Android the first TLS Client build (which
    // happens inside Wry's WebView request interception) panics with
    // "No rustls crypto provider is configured" and SIGABRTs the app. Installing
    // `ring` here (the backend reqwest selects) makes every later Client build
    // resolve a provider. Must run before dotenvy/Tauri init/client creation.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // EARLY LOG: Entry point
    let _ = (|| -> anyhow::Result<()> {
        let log_path = std::env::temp_dir().join("incrementum-startup.log");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_secs();
        writeln!(file, "[{timestamp}] startup: run() entry")?;
        Ok(())
    })();

    // Load .env file for environment variables (OAuth client IDs, etc.)
    // This must happen before any code that reads environment variables
    if let Err(e) = dotenvy::dotenv() {
        // Only log if .env exists but failed to load, not if it just doesn't exist
        if std::path::Path::new(".env").exists() {
            eprintln!("Warning: Failed to load .env file: {}", e);
        }
    }

    // EARLY LOG: After dotenv
    let _ = (|| -> anyhow::Result<()> {
        let log_path = std::env::temp_dir().join("incrementum-startup.log");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_secs();
        writeln!(file, "[{timestamp}] startup: after dotenv")?;
        Ok(())
    })();

    // NOTE: WebKitGTK environment variables for Linux are now set in main.rs
    // before this function is called. This ensures they are set early enough
    // to affect all WebKit initialization.

    // NOTE: tracing initialization is now owned by tauri-plugin-log (registered
    // on the builder below). The plugin installs a global `log` logger; the
    // `log` feature on the `tracing` crate (see Cargo.toml) bridges tracing
    // events into that logger, so tracing::warn!/info!/error! reach Logcat on
    // Android and stdout+logfile on desktop.

    const LOCALHOST_PORT: u16 = 9527;

    // EARLY LOG: Before chrono
    let _ = (|| -> anyhow::Result<()> {
        let log_path = std::env::temp_dir().join("incrementum-startup.log");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_secs();
        writeln!(file, "[{timestamp}] startup: before chrono")?;
        Ok(())
    })();

    // Early log for debugging startup crashes
    let _ = (|| -> anyhow::Result<()> {
        let log_path = std::env::temp_dir().join("incrementum-startup.log");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before UNIX epoch")
            .as_secs();
        writeln!(file, "[{timestamp}] startup: before builder")?;
        Ok(())
    })();

    // Check for command line argument to clear window state
    #[cfg(all(
        not(debug_assertions),
        not(any(target_os = "android", target_os = "ios"))
    ))]
    {
        let clear_requested = std::env::args().any(|arg| {
            arg == "--clear-window-state" || arg == "--reset-window-state" || arg == "-c"
        });

        if clear_requested {
            // Clear the state under the CURRENT identifier first, then the
            // legacy `com.incrementum.app` one (kept so pre-rebrand installs
            // are covered too).
            let mut candidates: Vec<std::path::PathBuf> = Vec::new();
            if cfg!(target_os = "macos") {
                if let Some(data_dir) = dirs::data_dir() {
                    candidates.push(
                        data_dir.join("com.plethora.app/.window-state.json"),
                    );
                    candidates.push(
                        data_dir.join("com.incrementum.app/.window-state.json"),
                    );
                }
            } else {
                if let Some(config_dir) = dirs::config_dir() {
                    candidates.push(config_dir.join("com.plethora.app/.window-state.json"));
                    candidates.push(
                        config_dir.join("com.incrementum.app/.window-state.json"),
                    );
                }
            }

            for path in candidates {
                if path.exists() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    let mut builder = tauri::Builder::default()
        // Logging — registered first so every other plugin's init is captured.
        // On Android, TargetKind::Stdout is auto-routed through android_logger
        // to Logcat (see tauri-plugin-log src/lib.rs ~line 589), which is what
        // makes `adb logcat` show app logs in release builds. On desktop we also
        // tee to a rotating log file in the OS log dir. The `tracing` crate's
        // `log` feature (Cargo.toml) bridges tracing::* events into this logger.
        .plugin({
            // Stdout → Logcat on Android (auto-routed by the plugin), and to the
            // console on desktop. Added first so every later plugin's init logs.
            let mut log_targets = vec![tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Stdout,
            )];
            // Desktop also tees to a rotating file in the OS log dir.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            log_targets.push(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::LogDir { file_name: None },
            ));
            tauri_plugin_log::Builder::new()
                .targets(log_targets)
                .level(log::LevelFilter::Info)
                // Silence chatty dependency modules.
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("rustls", log::LevelFilter::Warn)
                .level_for("sqlx", log::LevelFilter::Warn)
                // pdf-extract logs per-glyph benign "Unicode mismatch"/missing
                // char notices at warn — one per glyph is a stdout flood that
                // lags the whole machine on Windows (issue #45). Real
                // extraction failures are error-level and stay visible.
                .level_for("pdf_extract", log::LevelFilter::Error)
                .build()
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Filesystem access for writeTextFile/readFile from
        // @tauri-apps/plugin-fs (used by app-state export, image save, and
        // NotebookLM artifact export). Dialog-picked paths are granted scope
        // automatically; the fs:default permission covers the rest.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // OS info — available on all targets (desktop + android + ios).
        // The frontend uses platform() to detect native mobile builds so it
        // can render the mobile UI shell instead of the desktop tabbed view.
        .plugin(tauri_plugin_os::init())
        // Folder import: recursive document import from a user-picked folder.
        // Desktop uses a native folder dialog + walkdir; Android uses SAF
        // (ACTION_OPEN_DOCUMENT_TREE) and iOS uses UIDocumentPickerViewController
        // in folder mode, staging files into app-private storage.
        .plugin(incrementum_folder_import::init())
        // On-device TTS for Android: native sherpa-onnx inference (KittenTTS
        // Micro / Kokoro-82M) with AudioTrack playback, audio focus, lifecycle,
        // model downloads, and System-TTS fallback — all owned by the Kotlin
        // plugin. No PCM crosses the Tauri IPC. Desktop commands return an
        // Android-only error; Pocket TTS is the desktop local option, untouched.
        .plugin(incrementum_android_tts::init())
        // On-device generative AI for Android: ML Kit GenAI (Gemini Nano via
        // AICore) for capability detection, summarization, and free-form
        // prompting. Off Android the status command reports
        // `platform_unsupported` and inference returns a typed error, so the
        // frontend falls back to the configured cloud provider unchanged.
        .plugin(incrementum_android_genai::init());

    // Updater + process (relaunch after install) are desktop-only.
    // The plugin reads its config from the `plugins.updater` block in
    // tauri.conf.json. `tauri-plugin-process` provides the relaunch
    // command invoked from the frontend after a successful update.
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        builder = builder.plugin(tauri_plugin_process::init());
    }

    builder = builder.plugin(tauri_plugin_notification::init());

    // Desktop release builds serve the frontend over http://localhost via the
    // tauri-plugin-localhost plugin (a desktop-only dependency). This sidesteps
    // the `tauri://` custom-protocol being treated as a remote origin, which
    // otherwise breaks YouTube iframe embeds (Error 153). On android/ios the
    // plugin is absent from the dependency graph and the mobile build passes
    // --features custom-protocol, so Tauri serves the bundled frontendDist via
    // tauri:// instead — the mobile WebView can't reach the loopback server.
    #[cfg(all(
        not(debug_assertions),
        not(any(target_os = "android", target_os = "ios"))
    ))]
    {
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(LOCALHOST_PORT).build());
    }

    // Desktop-only: persist the main window's size and maximized state across
    // launches so the app reopens at the size the user left it. Mobile targets
    // don't have freely positionable windows, so it's gated to desktop.
    //
    // Only SIZE + MAXIMIZED are persisted. Persisting POSITION, VISIBLE,
    // DECORATIONS and FULLSCREEN triggers well-known macOS bugs in this plugin
    // (tauri-apps/plugins-workspace#1918 window gets stuck via is_maximized()
    // in restore_state; #3215 restore failures; #3289 window resized too small
    // / restored off-screen after a monitor disconnect) that can render the
    // whole window invisible. tauri.conf.json sets `center: true`, so with
    // POSITION disabled the window re-centers safely each launch.
    #[cfg(all(
        not(debug_assertions),
        not(any(target_os = "android", target_os = "ios"))
    ))]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );
    }

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        builder = builder
            .menu(|app| {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                let mut menu = Menu::new(app)?;

                #[cfg(target_os = "macos")]
                {
                    use tauri::menu::Submenu;
                    let app_submenu = Submenu::with_items(
                        app,
                        "Plethora",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, Some("About Plethora"), None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(
                                app,
                                "clear-window-state",
                                "Clear Window State",
                                true,
                                None::<&str>,
                            )?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, Some("Hide Plethora"))?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, Some("Quit Plethora"))?,
                        ],
                    )?;
                    menu.append(&app_submenu)?;

                    // Put command palette accelerators in a normal application menu.
                    // NSApplication resolves these before WKWebView can swallow Cmd+K.
                    let edit_submenu = Submenu::with_items(
                        app,
                        "Edit",
                        true,
                        &[
                            &MenuItem::with_id(
                                app,
                                "accel-k",
                                "Command Palette",
                                true,
                                Some("Cmd+K"),
                            )?,
                            &MenuItem::with_id(
                                app,
                                "accel-p",
                                "Command Palette (P)",
                                true,
                                Some("Cmd+P"),
                            )?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?;
                    menu.append(&edit_submenu)?;
                }

                // Windows: no native menu bar — webview handles keyboard shortcuts directly.
                #[cfg(target_os = "windows")]
                {}

                #[cfg(target_os = "linux")]
                {}

                Ok(menu)
            })
            .on_menu_event(|app, event| {
                let id = event.id.as_ref();
                tracing::info!("[cmd+key] menu event fired: {}", id);

                if id == "clear-window-state" {
                    #[cfg(all(
                        not(debug_assertions),
                        not(any(target_os = "android", target_os = "ios"))
                    ))]
                    {
                        if let Ok(config_dir) = app.path().app_config_dir() {
                            let state_file = config_dir.join(".window-state.json");
                            if state_file.exists() {
                                let _ = std::fs::remove_file(&state_file);
                            }
                        }
                    }
                    use tauri_plugin_dialog::DialogExt;
                    app.dialog()
                        .message("Window state cleared. Please restart the application for changes to take effect.")
                        .title("Window State Reset")
                        .show(|_| {});
                    return;
                }

                if !matches!(id, "accel-k" | "accel-p") {
                    return;
                }

                tracing::info!("[cmd+key] emitting command-palette-open to webview");
                if app.get_webview_window("main").is_some() {
                    if let Err(e) = app.emit_to("main", "command-palette-open", id) {
                        tracing::error!("[cmd+key] emit_to FAILED: {}", e);
                    }
                }
            });
    }

    builder
        .setup(|app| {
            let app_handle = app.handle().clone();
            install_panic_hook(app_handle.clone());
            log_startup(&app_handle, "startup: begin");

            // Verify window state file is valid JSON, delete if corrupted or empty
            #[cfg(all(
                not(debug_assertions),
                not(any(target_os = "android", target_os = "ios"))
            ))]
            {
                if let Ok(config_dir) = app.path().app_config_dir() {
                    let state_file = config_dir.join(".window-state.json");
                    if state_file.exists() {
                        let mut needs_delete = false;
                        if let Ok(content) = std::fs::read_to_string(&state_file) {
                            if content.trim().is_empty() || serde_json::from_str::<serde_json::Value>(&content).is_err() {
                                needs_delete = true;
                            }
                        } else {
                            needs_delete = true;
                        }
                        if needs_delete {
                            tracing::warn!("Window state file is corrupted or empty, deleting to prevent startup hangs: {:?}", state_file);
                            let _ = std::fs::remove_file(&state_file);
                        }
                    }
                }
            }

            // Register managed state for one-shot startup notices before any
            // code that might set one (e.g. database recovery) runs.
            startup_notice::register(&app_handle);
            app.manage(BackendReadyState::default());

            let result: anyhow::Result<()> = tauri::async_runtime::block_on(async {
                // Instantly register critical managed states with lazy/placeholder values.
                // This happens within the active Tokio runtime context, preventing abort crashes.
                // It ensures that any early IPC calls from the fast-loading mobile WebView
                // resolve the State injection successfully rather than throwing "state not managed" errors.
                app.manage(AppState::new());
                let saved_ai_config =
                    commands::ai::load_ai_config_preferences(&app.handle().clone());
                app.manage(AIState {
                    config: Arc::new(std::sync::Mutex::new(saved_ai_config)),
                });
                app.manage(FocusTimer::new());
                app.manage(commands::podcast::PodcastTranscriptionTokens::default());

                let app_dir = app
                    .path()
                    .app_data_dir()
                    .context("Failed to get app data dir")?;

                log_startup(
                    &app_handle,
                    &format!("startup: app data dir = {}", app_dir.display()),
                );

                std::fs::create_dir_all(&app_dir).with_context(|| {
                    format!("Failed to create app data dir: {}", app_dir.display())
                })?;

                log_startup(&app_handle, "startup: app data dir ready");

                // One-time legacy Incrementum → Plethora data migration
                // (task 3.1, desktop only). Detection arms a pending marker
                // BEFORE the fresh database makes the directory non-empty;
                // the consent dialog itself lives in the frontend so it can
                // be localized (see MainLayout).
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    if let Some(legacy_dir) = legacy_data::detect_pending_migration(&app_dir) {
                        log_startup(
                            &app_handle,
                            &format!(
                                "startup: legacy data available at {}",
                                legacy_dir.display()
                            ),
                        );
                        startup_notice::set(
                            &app_handle,
                            StartupNotice::LegacyDataAvailable {
                                legacy_path: legacy_dir.display().to_string(),
                            },
                        );
                    } else if let Some(report) =
                        legacy_data::take_migration_completion_notice(&app_dir)
                    {
                        log_startup(&app_handle, "startup: legacy data migration completed");
                        startup_notice::set(
                            &app_handle,
                            StartupNotice::LegacyDataMigrated {
                                legacy_path: report.legacy_dir,
                                backup_db: report.backup_db,
                            },
                        );
                    }
                }

                // Never mutate SQLite siblings created by an external file
                // sync tool; preserve them and surface a dismissible notice.
                detect_database_integrity_artifacts(&app_handle, &app_dir);

                let db_path = database::connection::resolve_database_path(&app_dir);

                let (db, db_outcome) = Database::open_or_recover(db_path)
                    .await
                    .context("Failed to initialize database")?;

                if matches!(
                    db_outcome,
                    database::connection::OpenOutcome::RecoveredAfterQuarantine
                ) {
                    // The on-disk database was corrupt and got quarantined aside;
                    // a fresh empty database now lives at db_path. Tell the
                    // frontend so it can surface a "your database was reset —
                    // restore from a backup?" notice. The webview may not be
                    // listening yet, so also stash a pending notice the frontend
                    // can poll on boot (see `consume_startup_notice`).
                    log_startup(
                        &app_handle,
                        "startup: database was CORRUPT — quarantined and recreated",
                    );
                    tracing::error!(
                        "Startup database failed integrity check; quarantined the \
                         corrupt file and created a fresh database. Local data was reset."
                    );
                    startup_notice::set(
                        &app_handle,
                        StartupNotice::DatabaseRecoveredAfterQuarantine,
                    );
                    let _ = app_handle.emit("database-recovered", ());
                } else if matches!(db_outcome, database::connection::OpenOutcome::CreatedFresh) {
                    #[cfg(target_os = "android")]
                    {
                        let paths = [
                            "/storage/emulated/0/Download/Incrementum/Incrementum_Backup_Auto.db",
                            "/sdcard/Download/Incrementum/Incrementum_Backup_Auto.db",
                        ];
                        for p in &paths {
                            let path = std::path::Path::new(p);
                            if path.exists() {
                                tracing::info!("Found database auto-backup at: {}", p);
                                startup_notice::set(
                                    &app_handle,
                                    StartupNotice::AutoBackupFound {
                                        backup_path: p.to_string(),
                                    },
                                );
                                break;
                            }
                        }
                    }
                }

                // Retrieve the AppState managed early on the builder and store the database in it
                let app_state = app.state::<AppState>();
                let pool = db.pool().clone();
                *app_state.db.lock().expect("app state mutex poisoned") = Some(db);

                log_startup(&app_handle, "startup: database initialized");

                // Register the real repository immediately so early mobile IPC
                // can resolve State<Repository>. invokeCommand waits on
                // BackendReadyState, so normal commands cannot query it before
                // migrations complete.
                let repo = database::Repository::new(pool.clone());
                if !app.manage(repo.clone()) {
                    anyhow::bail!("Repository state was already managed before database setup");
                }

                crate::database::migrations::run_migrations(&pool)
                    .await
                    .context("Failed to run migrations")?;

                log_startup(&app_handle, "startup: migrations complete");

                // Close reading sessions the last run left open — a crash, a
                // force-quit, or an OS shutdown. Each is ended at its last
                // recorded heartbeat, so the unobserved gap since then adds
                // nothing to the document's time. Idempotent: a second launch
                // finds nothing left to close.
                match database::ItemActivityRepository::new(pool.clone())
                    .close_stale_reading_sessions()
                    .await
                {
                    Ok(0) => {}
                    Ok(recovered) => {
                        tracing::info!("Recovered {} stale reading session(s)", recovered);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to recover stale reading sessions: {}", e);
                    }
                }

                // Initialize cloud auth provider and AI key store (managed immediately so commands can access them)
                let legacy_store_dir = {
                    let legacy = legacy_data::legacy_app_data_dir(&app_dir);
                    if legacy.is_dir() {
                        Some(legacy)
                    } else {
                        None
                    }
                };
                let auth_store =
                    cloud::auth_store::AuthStore::new(app_dir.clone(), legacy_store_dir.clone());
                let cloud_auth_provider = cloud::auth_store::CloudAuthProvider::new();
                let ai_key_store =
                    commands::ai_key_store::AIKeyStore::new(app_dir.clone(), legacy_store_dir);

                app.manage(cloud_auth_provider.clone());
                app.manage(auth_store.clone());
                app.manage(ai_key_store.clone());
                app.manage(pocket_tts::PocketTTSState::default());
                app.manage(transcription::TranscriptionState {
                    job_queue: transcription::job_queue::JobQueue::new(
                        app.handle().clone(),
                        repo.clone(),
                    ),
                    auto_queue: transcription::auto_queue::AutoTranscriptionQueue::new(
                        app.handle().clone(),
                        repo.clone(),
                    ),
                });
                // AI learning semantic index: background chunking/embedding
                // worker + retrieval state (no AppHandle dependency — it is
                // fully testable against an in-memory database).
                app.manage(commands::ai_learning::AiLearningState::new(
                    repo.clone(),
                ));
                // On-device embedding bridge (task 4.5, design D10): hand the
                // indexer a direct Rust→Kotlin path into the android-genai
                // plugin's EmbeddingGemma command. Android only; everywhere
                // else the OnDevice backend stays the lexical-only stub.
                #[cfg(target_os = "android")]
                {
                    let bridge_app = app.handle().clone();
                    ai_learning::embeddings_backend::install_on_device_embedder(std::sync::Arc::new(
                        move |texts: &[String], normalize: bool, kind: &str| {
                            let plugin_kind = match kind {
                                "query" => incrementum_android_genai::EmbeddingKind::Query,
                                _ => incrementum_android_genai::EmbeddingKind::Document,
                            };
                            incrementum_android_genai::embed_texts_via_app(
                                &bridge_app,
                                texts.to_vec(),
                                normalize,
                                plugin_kind,
                            )
                            .map(|result| {
                                ai_learning::embeddings_backend::OnDeviceEmbedOutput {
                                    vectors: result.vectors,
                                }
                            })
                            .map_err(|e| {
                                ai_learning::embeddings_backend::OnDeviceEmbedFailure {
                                    code: e.code,
                                    message: e.message,
                                }
                            })
                        },
                    ));
                }

                let active_episode_ids = app
                    .state::<commands::podcast::PodcastTranscriptionTokens>()
                    .lock()
                    .map(|tokens| tokens.keys().cloned().collect::<HashSet<_>>())
                    .unwrap_or_default();
                let sweep_app = app_handle.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    sweep_orphaned_transcription_temp_files(sweep_app, active_episode_ids);
                });

                // block app startup.  Providers are registered into the managed
                // state once loaded.
                let bg_cloud_auth = cloud_auth_provider.clone();
                let bg_auth_store = auth_store.clone();
                tauri::async_runtime::spawn(async move {
                    for provider_type in &[
                        cloud::CloudProviderType::OneDrive,
                        cloud::CloudProviderType::GoogleDrive,
                        cloud::CloudProviderType::Dropbox,
                    ] {
                        if let Ok(Some(token)) = bg_auth_store.get_token(*provider_type).await {
                            let provider: Box<dyn cloud::CloudProvider> = match provider_type {
                                cloud::CloudProviderType::OneDrive => {
                                    Box::new(cloud::OneDriveProvider::with_token(
                                        cloud::OneDriveConfig::default(),
                                        token,
                                    ))
                                }
                                cloud::CloudProviderType::GoogleDrive => {
                                    Box::new(cloud::GoogleDriveProvider::with_token(
                                        cloud::GoogleDriveConfig::default(),
                                        token,
                                    ))
                                }
                                cloud::CloudProviderType::Dropbox => {
                                    Box::new(cloud::DropboxProvider::with_token(
                                        cloud::DropboxConfig::default(),
                                        token,
                                    ))
                                }
                            };
                            bg_cloud_auth.set_provider(*provider_type, provider);
                        }
                    }
                    tracing::info!("Cloud auth token loading complete");
                });

                // Load API keys from keychain into in-memory AIState on startup.
                let ai_state_handle: tauri::State<'_, AIState> = app.state::<AIState>();
                let ai_config_mutex = Arc::clone(&ai_state_handle.config);
                let bg_key_store = ai_key_store.clone();
                drop(ai_state_handle);
                tauri::async_runtime::spawn(async move {
                    for provider in &["openai", "anthropic", "openrouter", "brave"] {
                        match bg_key_store.get_key(provider).await {
                            Ok(Some(key)) => {
                                let mut config =
                                    ai_config_mutex.lock().expect("AI config mutex poisoned");
                                let current = config.get_or_insert_with(Default::default);
                                match *provider {
                                    "openai" => current.api_keys.openai = Some(key),
                                    "anthropic" => current.api_keys.anthropic = Some(key),
                                    "openrouter" => current.api_keys.openrouter = Some(key),
                                    "brave" => current.api_keys.brave = Some(key),
                                    _ => {}
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                tracing::warn!("Failed to load AI key for {}: {}", provider, e);
                            }
                        }
                    }
                    tracing::info!("AI API keys loaded from keychain");
                });

                // Check and import demo content in the background so it doesn't
                // block app startup.
                let demo_repo = repo.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = demo::check_and_import_demo_content(&demo_repo).await {
                        tracing::warn!("Demo content import failed: {}", e);
                    }
                });

                // Repository state was managed earlier in setup (right after it
                // was created), so there is nothing to manage here.

                // Initialize browser sync server in the background if auto-start is enabled.
                let bg_app_handle = app_handle.clone();
                let repo_arc = std::sync::Arc::new(database::Repository::new(pool));
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        browser_sync_server::initialize_if_enabled(repo_arc, bg_app_handle, None)
                            .await
                    {
                        tracing::warn!("Browser sync server initialization failed: {}", e);
                    }
                });

                if let Some(window) = app.get_webview_window("main") {
                    // On desktop release builds the frontend is served over
                    // http://localhost via tauri-plugin-localhost, so navigate
                    // the main window there. On android/ios the localhost plugin
                    // is absent and the frontend is served from the bundled
                    // frontendDist via the tauri:// protocol — navigating to
                    // localhost:9527 there leaves the screen blank ("could not
                    // be loaded"), so skip the redirect on mobile.
                    #[cfg(all(
                        not(debug_assertions),
                        not(any(target_os = "android", target_os = "ios"))
                    ))]
                    if let Ok(url) = Url::parse(&format!("http://localhost:{LOCALHOST_PORT}/")) {
                        let _ = window.navigate(url);
                    }
                    #[cfg(all(
                        feature = "devtools",
                        not(any(target_os = "ios", target_os = "android"))
                    ))]
                    if std::env::var("INCREMENTUM_OPEN_DEVTOOLS").is_ok() {
                        window.open_devtools();
                    }
                    tracing::info!("Webview ready at {:?}", window.url());

                    // Hide the Linux menu bar where it would otherwise clutter the UI.
                    // Windows WebView2 needs the native menu visible for accelerators.
                    #[cfg(target_os = "linux")]
                    {
                        let _ = window.hide_menu();
                    }
                }

                app.state::<BackendReadyState>().mark_ready();
                log_startup(&app_handle, "startup: backend ready");

                Ok(())
            });

            if let Err(err) = result {
                log_startup(&app_handle, &format!("startup: error: {err:#}"));
                return Err(err.into());
            }

            log_startup(&app_handle, "startup: complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            wait_for_backend_ready,
            commands::memory_scenario::get_memory_scenario_config,
            download_update_apk,
            updater_bundle_type,
            consume_startup_notice,
            migrate_legacy_data,
            decline_legacy_data_migration,
            restore_local_db_backup,
            apply_theme_vibrancy,
            commands::get_documents,
            commands::get_document,
            commands::resolve_document_cover,
            commands::set_document_cover,
            commands::create_document,
            commands::update_document,
                                                                                                                        commands::get_learning_item_ids_modified_since,
            commands::get_learning_items_for_postpone,
                                                                                                                                                                                                                                                                                                                                                                                    commands::update_document_content,
            commands::update_document_priority,
            commands::update_document_progress,
            commands::delete_document,
            commands::bulk_delete_documents,
            commands::bulk_move_documents_to_collection,
            commands::bulk_set_document_priority,
            commands::dismiss_document,
            commands::collections::get_collections,
            commands::collections::create_collection,
            commands::collections::get_collection,
            commands::collections::update_collection,
            commands::collections::delete_collection,
            commands::collections::get_active_collection,
            commands::collections::set_active_collection,
            commands::collections::get_collection_due_count,
            commands::get_document_position,
            commands::save_document_position,
            commands::get_document_progress,
            commands::create_bookmark,
            commands::list_bookmarks,
            commands::delete_bookmark,
            commands::start_reading_session,
            commands::end_reading_session,
            commands::get_active_session,
            commands::record_active_time,
            commands::get_item_stats_summary,
            commands::get_item_stats_detail,
            commands::get_documents_with_progress,
            commands::get_startup_snapshot,
            commands::get_daily_reading_stats,
            commands::import_document,
            commands::import_documents,
            commands::import_document_from_bytes,
            commands::import_document_multi,
            commands::stage_import_file_start,
            commands::append_import_file_chunk,
            commands::import_pdf_highlights_as_extracts,
            commands::read_document_file,
            commands::hash_document_file,
            commands::get_pdf_document_source_info,
            commands::read_pdf_document_range,
            commands::get_pdf_reflow_cache_page,
            commands::put_pdf_reflow_cache_page,
            commands::delete_pdf_reflow_cache,
            commands::pdf_reflow_get_page,
            commands::pdf_reflow_put_page,
            commands::pdf_reflow_put_asset,
            commands::pdf_reflow_get_asset,
            commands::pdf_reflow_delete_cache,
            commands::pdf_reflow_analyze_page,
            commands::pdf_reflow_apply_ocr_page,
            commands::pdf_reflow_build_graphical_fallback,
            commands::pdf_reflow_resolve_selection,
            commands::pdf_reflow_selection_rects,
            media_server::get_media_stream_url,
            epub_server::get_epub_stream_url,
            web_proxy::get_web_proxy_url,
            web_proxy::set_web_bridge_script,
            commands::fetch_url_content,
                                                commands::fetch_web_page_preview,
            commands::store_source_snapshot,
            commands::capture_rendered_dom,
            commands::update_web_article,
            commands::find_document_id_by_source_url,
            commands::delete_source_snapshots,
            commands::cleanup_source_snapshots,
            commands::convert_pdf_to_html,
            commands::convert_document_pdf_to_html,
            commands::extract_document_text,
            commands::get_extracts,
            commands::get_extract,
            commands::create_extract,
            commands::update_extract,
            commands::delete_extract,
            commands::set_extract_priority,
            commands::bulk_delete_extracts,
            commands::get_card_source_context,
            commands::bulk_generate_cards,
            commands::submit_extract_review,
            commands::create_cloze_from_extract,
            commands::create_qa_from_extract,
            commands::get_reviewable_extracts,
            commands::get_due_items,
            commands::create_learning_item,
            commands::create_learning_items_batch,
            commands::record_ai_provenance,
            commands::get_ai_provenance,
            commands::update_learning_item_content_with_version,
            commands::update_learning_item_tags,
            commands::update_learning_item_priority,
            commands::get_auto_postpone_settings,
            commands::set_auto_postpone_settings,
            commands::run_auto_postpone,
            commands::build_neural_queue,
            commands::get_neural_queue_front,
            commands::get_neural_queue_resolved_front,
            commands::consume_neural_queue_element,
            commands::refill_neural_queue_if_depleted,
            commands::get_neural_queue_remaining,
            // Knowledge relationships (Phase 5): concepts + typed links
            // (D21) and the passage extract-worthiness cache (D23). Kept
            // with the knowledge-infrastructure registrations.
            commands::upsert_concept,
            commands::get_concept,
            commands::find_concepts_by_names,
            commands::propose_concept_link,
            commands::accept_concept_link,
            commands::dismiss_concept_link,
            commands::delete_concept_link,
            commands::list_concept_links_for,
            commands::list_concept_links_targeting,
            commands::get_concept_backlinks,
            commands::concept_link_fingerprint_dismissed,
            commands::get_passage_score,
            commands::put_passage_score,
            commands::get_items_by_tag,
            commands::get_learning_item_versions,
            commands::revert_learning_item_version,
            commands::set_learning_item_prerequisites,
            commands::get_learning_item_prerequisites,
            commands::get_daily_note_links,
            commands::export_mnemosyne,
            commands::generate_learning_items_from_extract,
            commands::get_learning_items,
            commands::get_learning_item,
            commands::delete_learning_item,
            commands::restore_learning_item,
            commands::get_learning_items_by_extract,
            commands::get_all_learning_items,
            commands::check_semantic_duplicate_candidates,
            commands::ingest_image_asset,
            commands::ingest_image_asset_from_path,
            commands::ingest_remote_image_asset,
            commands::list_image_assets,
            commands::get_image_asset,
            commands::delete_image_asset,
            commands::rename_image_asset,
            commands::get_categories,
            commands::create_category,
            commands::get_queue,
            commands::get_next_queue_item,
            commands::get_priority_standing,
            commands::get_queue_items,
            commands::get_queued_items,
            commands::get_due_queue_items,
            commands::get_due_documents_only,
            commands::get_queue_with_playlist_intersperse,
            commands::get_queue_stats,
            commands::postpone_item,
            commands::bulk_suspend_items,
            commands::bulk_unsuspend_items,
            commands::bulk_delete_items,
            commands::bulk_update_item_priorities,
            commands::bulk_postpone_items,
            commands::bulk_move_items_to_collection,
            commands::bulk_update_item_tags,
            commands::bulk_set_item_lifecycle,
            commands::export_queue,
            commands::advance_item,
            commands::advance_due_queue,
            commands::load_balance_queue,
            commands::apply_easy_days,
            commands::simulate_review_forecast,
            commands::forget_extract,
            commands::dismiss_extract,
            commands::graduate_extract,
            commands::start_review,
            commands::submit_review,
            commands::restore_learning_item_state,
            commands::get_next_review_times,
            commands::preview_review_intervals,
            commands::get_sm20_arena_stats,
            commands::optimize_sm20_fsrs,
            commands::optimize_sm20_m4,
            commands::get_review_streak,
            commands::record_recall_prompt,
            commands::set_recall_prompt_outcome,
            commands::get_recent_recall_prompts,
            commands::record_answer_assessment,
            commands::get_answer_assessments_for_item,
            commands::get_answer_assessment_counts,
            commands::get_review_sessions_by_collection,
            commands::get_all_review_results,
            commands::get_review_results_by_sessions,
            commands::get_categories_by_collection,
            commands::calculate_sm2_next,
            commands::rate_document,
            commands::rate_document_engaging,
            commands::restore_document_scheduling,
            commands::rate_extract,
            commands::calculate_priority_scores,
            commands::compare_algorithms_command,
            commands::get_algorithm_params,
            commands::get_review_statistics,
            commands::get_due_workload_forecast,
            commands::optimize_algorithm_params,
            commands::get_sm20_optimization_status,
            commands::optimize_sm20_locally,
            commands::get_default_engagement_preferences,
            commands::get_smart_start_position,
            commands::get_ai_config,
            commands::set_ai_config,
            commands::set_api_key,
            commands::get_masked_api_key,
            commands::remove_api_key,
            commands::secure_storage_set,
            commands::secure_storage_get,
            commands::secure_storage_clear,
            commands::generate_flashcards_from_extract,
            commands::generate_flashcards_from_content,
            commands::answer_question,
            commands::answer_about_extract,
            commands::summarize_content,
            commands::extract_key_points,
            commands::generate_title,
            commands::simplify_content,
            commands::generate_questions,
            commands::list_ollama_models,
            commands::test_ai_connection,
            commands::brave_web_search,
            commands::generate_progressive_summaries,
            commands::get_memory_content,
            commands::save_memory_content,
            commands::update_memory_from_chat,
            commands::get_dashboard_stats,
            commands::get_memory_stats,
            commands::get_activity_data,
            commands::get_category_stats,
            commands::get_leech_dashboard,
            commands::get_workload_data,
            commands::get_workload_day_details,
            youtube::check_ytdlp,
            youtube::setup_ytdlp_auto,
            youtube::get_ytdlp_path,
            youtube::get_youtube_video_info,
            youtube::get_youtube_formats,
            youtube::download_youtube_video,
            youtube::get_youtube_transcript,
            youtube::get_youtube_transcript_by_id,
            youtube::fetch_youtube_transcript_on_device,
            youtube::on_device_transcript_available,
            youtube::search_youtube_videos,
            youtube::get_youtube_playlist_info,
            youtube::extract_youtube_video_id,
            youtube::import_youtube_video,
            twitter::import_twitter_video,
            twitter::get_twitter_video_info,
            youtube::get_youtube_chapters,
            commands::import_video_file,
            commands::get_video_storage_path,
            commands::add_video_bookmark,
            commands::get_video_bookmarks,
            commands::delete_video_bookmark,
            commands::set_video_chapters,
            commands::get_video_chapters,
            commands::set_video_transcript,
            commands::get_video_transcript,
            commands::generate_video_transcript,
            commands::split_audio_for_groq,
            commands::cleanup_audio_chunks,
            commands::read_file_bytes,
            commands::create_video_extract,
            commands::get_video_extracts,
            commands::get_video_extract,
            commands::update_video_extract,
            commands::delete_video_extract,
            commands::rate_video_extract,
            commands::parse_audiobook_metadata,
            commands::import_podcast_audio_file,
            commands::scan_directory_for_audiobooks,
            commands::parse_audiobook_chapters,
            commands::prepare_audiobook_playback,
            commands::extract_audio_sample,
            commands::generate_audiobook_transcript,
            commands::get_transcription_config,
            commands::set_transcription_config,
            commands::extract_audio_cover_art,
            // YouTube playlist auto-import commands
            commands::subscribe_to_playlist,
            commands::get_playlist_subscriptions,
            commands::get_playlist_subscription,
            commands::update_playlist_subscription,
            commands::delete_playlist_subscription,
            commands::refresh_playlist,
            commands::import_playlist_video,
            commands::get_unimported_playlist_videos,
            commands::get_playlist_settings,
            commands::update_playlist_settings,
            commands::get_playlist_queue_items,
            commands::mark_playlist_video_queued,
            integrations::export_to_obsidian,
            integrations::export_extract_to_obsidian,
            integrations::export_flashcards_to_obsidian,
            integrations::export_conversation_to_obsidian,
            integrations::export_assistant_message_to_obsidian,
            integrations::import_from_obsidian,
            integrations::sync_to_obsidian,
            integrations::sync_from_obsidian,
            integrations::sync_to_logseq,
            integrations::sync_from_logseq,
            integrations::delete_from_obsidian,
            integrations::sync_flashcard_to_anki,
            integrations::sync_flashcards_to_anki,
            integrations::start_extension_server,
            integrations::stop_extension_server,
            integrations::get_extension_server_status,
            integrations::send_to_extension,
            integrations::process_extension_page,
            // NotebookLM integration commands
            notebooklm::notebooklm_get_settings,
            notebooklm::notebooklm_set_settings,
            notebooklm::notebooklm_connect,
            notebooklm::notebooklm_disconnect,
            notebooklm::notebooklm_health,
            notebooklm::notebooklm_list_notebooks,
            notebooklm::notebooklm_create_notebook,
            notebooklm::notebooklm_select_notebook,
            notebooklm::notebooklm_list_sources,
            notebooklm::notebooklm_add_source,
            notebooklm::notebooklm_refresh_source,
            notebooklm::notebooklm_ask,
            notebooklm::notebooklm_research,
            notebooklm::notebooklm_generate_artifact,
            notebooklm::notebooklm_get_jobs,
            notebooklm::notebooklm_get_job,
            notebooklm::notebooklm_set_artifact_position,
            notebooklm::notebooklm_preview_flashcards,
            notebooklm::notebooklm_preview_quiz_import,
            notebooklm::notebooklm_sync_flashcards,
            notebooklm::notebooklm_sync_quiz,
            notebooklm::notebooklm_sync_preview_items,
            notebooklm::notebooklm_export_job_artifact,
            notebooklm::notebooklm_import_job_artifact,
            notebooklm::notebooklm_check_cli,
            notebooklm::notebooklm_cli_login,
            notebooklm::notebooklm_cli_logout,
            notebooklm::notebooklm_cli_status,
            pocket_tts::pocket_tts_status,
            pocket_tts::pocket_tts_generate,
            pocket_tts::pocket_tts_stop,
            pocket_tts::pocket_tts_cleanup,
            // Browser sync server commands (HTTP for extension)
            browser_sync_server::start_browser_sync_server,
            browser_sync_server::stop_browser_sync_server,
            browser_sync_server::get_browser_sync_server_status,
            browser_sync_server::get_browser_sync_config,
            browser_sync_server::set_browser_sync_config,
            browser_sync_server::get_automation_api_key,
            browser_sync_server::rotate_automation_api_key,
            commands::create_rss_feed,
            commands::get_rss_feeds,
            commands::get_rss_feed,
            commands::update_rss_feed,
            commands::delete_rss_feed,
            commands::create_rss_article,
            commands::bulk_create_rss_articles,
            commands::get_rss_articles,
            commands::mark_rss_article_read,
            commands::mark_rss_feed_read,
            commands::toggle_rss_article_queued,
            commands::update_rss_feed_fetched,
            commands::get_rss_feed_unread_count,
            commands::cleanup_old_rss_articles,
            commands::fetch_rss_feed_url,
            // RSS full content fetching commands
            commands::fetch_article_full_content,
            commands::update_feed_auto_fetch,
            commands::get_article_full_content,
            // Substack API proxy commands
            commands::substack_search,
            commands::substack_categories,
            commands::substack_pub_homepage,
            commands::substack_category_feed,
            // RSS feature commands (NewsBlur-inspired)
            commands::add_rss_classifier,
            commands::remove_rss_classifier,
            commands::get_rss_classifiers,
            commands::update_rss_classifiers_batch,
            commands::compute_intelligence_score,
            commands::recompute_all_intelligence_scores,
            commands::get_rss_articles_with_intelligence,
            commands::mark_rss_article_unread,
            commands::mark_rss_articles_before_date_read,
            commands::mark_rss_articles_after_date_read,
            commands::auto_mark_articles_as_read,
            commands::get_read_rss_articles,
            commands::get_river_of_news,
            commands::search_rss_articles,
            commands::fts_search,
            commands::fts_search_suggestions,
            commands::fts_get_stats,
            commands::fts_reindex,
            commands::compute_story_clusters,
            commands::get_rss_article_clusters,
            commands::invalidate_clusters_for_feed,
            commands::add_tag,
            commands::remove_tag,
            commands::get_article_tags,
            commands::get_all_tags,
            commands::tag_article,
            commands::untag_article,
            commands::get_articles_by_tag,
            commands::rename_tag,
            commands::merge_tags,
            commands::create_annotation,
            commands::get_article_annotations,
            commands::update_annotation,
            commands::delete_annotation,
            commands::get_discovered_sites,
            commands::delete_discovered_site,
            commands::refresh_discoveries,
            commands::seed_curated_feeds,
            commands::create_rss_folder,
            commands::update_rss_folder,
            commands::delete_rss_folder,
            commands::get_rss_folders,
            commands::create_rss_reading_list,
            commands::update_rss_reading_list,
            commands::delete_rss_reading_list,
            commands::get_rss_reading_lists,
            commands::duplicate_rss_reading_list,
            commands::move_feed_to_folder,
            commands::reorder_feeds,
            commands::reorder_folders,
            commands::toggle_feed_active,
            commands::get_feed_statistics,
            commands::set_feed_view_preferences,
            commands::migrate_folders_from_localstorage,
            commands::segment_document,
            commands::auto_segment_and_create_extracts,
            commands::split_document,
            commands::import_legacy_archive,
            commands::preview_segmentation,
            commands::extract_key_points_from_text,
            commands::batch_segment_documents,
            commands::get_recommended_segmentation,
            commands::check_notification_permission,
            commands::request_notification_permission,
            commands::send_notification,
            commands::send_study_reminder,
            commands::send_cards_due_notification,
            commands::send_review_completed_notification,
            commands::send_document_imported_notification,
            // Anna's Archive commands
            commands::search_books,
            commands::download_book,
            commands::get_available_mirrors,
            commands::schedule_study_reminders,
            commands::get_notification_settings,
            commands::update_notification_settings,
            commands::create_custom_notification,
            commands::mcp::mcp_list_servers,
            commands::mcp::mcp_add_server,
            commands::mcp::mcp_remove_server,
            commands::mcp::mcp_update_server,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_get_incrementum_tools,
            commands::mcp::mcp_call_incrementum_tool,
            commands::mcp::mcp_get_server_tools,
            commands::mcp::mcp_get_server_info,
            commands::llm::llm_chat,
            commands::llm::llm_chat_with_context,
            commands::llm::llm_stream_chat,
            commands::llm::llm_cancel_stream,
            commands::llm::llm_get_models,
            commands::llm::llm_test_connection,
            commands::oauth_start,
            commands::oauth_callback,
            commands::oauth_get_account,
            commands::oauth_disconnect,
            commands::oauth_is_authenticated,
            commands::backup_create,
            commands::backup_restore,
            commands::backup_list,
            commands::backup_delete,
            commands::cloud_sync_init,
            commands::cloud_sync_now,
            commands::cloud_sync_get_status,
            commands::cloud_sync_resolve_conflicts,
            commands::cloud_list_files,
            commands::cloud_import_files,
            commands::import_collection_archive,
            commands::import_collection_archive_merge,
            commands::scheduler_init,
            commands::scheduler_start,
            commands::scheduler_stop,
            commands::scheduler_update_config,
            commands::scheduler_get_status,
            commands::scheduler_trigger_backup,
            anki::import_anki_package_to_learning_items,
            anki::import_anki_package_bytes_to_learning_items,
            anki::export_deck_as_apkg,
            anki::export_deck_as_csv,
            anki::export_all_decks_as_apkg,
            supermemo_import::import_supermemo_package,
            supermemo_import::validate_supermemo_package,
            // Study JSON import commands
            study_json_import::import_study_json_file,
            study_json_import::validate_study_json_file,
            // Kindle clippings import commands
            kindle_clippings::parse_kindle_clippings_file,
            kindle_clippings::validate_kindle_clippings,
            kindle_clippings::import_kindle_clippings_file,
            // Mobile (bytes) variants — receive file contents over IPC because
            // the Tauri dialog returns unreadable content:// URIs on Android.
            kindle_clippings::parse_kindle_clippings_file_bytes,
            kindle_clippings::validate_kindle_clippings_bytes,
            kindle_clippings::import_kindle_clippings_file_bytes,
            kindle_clippings::backfill_kindle_imports,
            demo::import_demo_content_manually,
            demo::get_demo_content_status,
            commands::init_ocr,
            commands::ocr_image_file,
            commands::ocr_image_bytes,
            commands::ocr_pdf_file,
            commands::extract_key_phrases,
            commands::get_available_ocr_providers,
            commands::is_provider_available,
            commands::get_ocr_config,
            commands::update_ocr_config,
            commands::nougat_runtime_status,
            commands::nougat_install_managed_runtime,
            commands::glm_runtime_status,
            commands::glm_download_ollama_installer,
            commands::glm_open_installer,
            commands::glm_start_ollama_runtime,
            commands::glm_stop_ollama_runtime,
            commands::glm_pull_ollama_model,
            #[cfg(all(
                feature = "screenshot",
                not(any(target_os = "android", target_os = "ios"))
            ))]
            screenshot::capture_screenshot,
            #[cfg(all(
                feature = "screenshot",
                not(any(target_os = "android", target_os = "ios"))
            ))]
            screenshot::capture_screen_by_index,
            #[cfg(all(
                feature = "screenshot",
                not(any(target_os = "android", target_os = "ios"))
            ))]
            screenshot::capture_app_window,
            #[cfg(all(
                feature = "screenshot",
                not(any(target_os = "android", target_os = "ios"))
            ))]
            screenshot::capture_app_window_region,
            #[cfg(all(
                feature = "screenshot",
                not(any(target_os = "android", target_os = "ios"))
            ))]
            screenshot::get_screen_info,
            transcription::get_transcription_profiles,
            transcription::download_transcription_model,
            transcription::delete_transcription_model,
            transcription::start_transcription,
            transcription::get_transcript,
            transcription::save_transcript,
            transcription::enqueue_auto_transcription,
            transcription::get_transcription_queue,
            transcription::cancel_transcription_job,
            transcription::retry_transcription_job,
            transcription::prioritize_transcription_job,
            transcription::get_transcription_status,
            transcription::enqueue_all_untranscribed,
            transcription::get_untranscribed_media_documents,
            transcription::clear_transcription_queue,
            transcription::remove_transcription_entry,
            commands::embed_queue_items,
            commands::embed_active_rss_articles,
            commands::compute_semantic_graph,
            commands::get_embedding_config,
            commands::ai_learning_enqueue_document,
            commands::ai_learning_enqueue_all,
            commands::ai_learning_index_status,
            commands::ai_learning_index_pause,
            commands::ai_learning_index_resume,
            commands::ai_learning_index_cancel,
            commands::ai_learning_reset_index,
            commands::ai_learning_retrieve,
            commands::ai_learning_remove_source_chunks,
            commands::get_focus_timer_state,
            commands::start_focus_timer,
            commands::pause_focus_timer,
            commands::reset_focus_timer,
            commands::skip_focus_timer_phase,
            commands::update_focus_timer_config,
            commands::get_focus_timer_remaining,
            commands::tick_focus_timer,
            commands::reset_focus_timer_daily_stats,
            battery::get_battery_state,
            commands::search_podcasts,
            commands::subscribe_podcast,
            commands::unsubscribe_podcast,
            commands::rename_podcast_feed,
            commands::get_podcast_feeds,
            commands::refresh_podcast_feed,
            commands::get_podcast_episodes,
            commands::mark_episode_played,
            commands::update_episode_position,
            commands::get_episode_position,
            commands::import_podcast_episode_as_document,
            // Podcast transcription commands
            commands::podcast::transcribe_podcast_episode,
            commands::podcast::get_podcast_transcript,
            commands::podcast::save_podcast_transcript_segments,
            commands::podcast::resolve_podcast_audio_url,
            commands::podcast::split_audio_for_groq_mobile,
            commands::podcast::cleanup_mobile_audio_chunks,
            commands::podcast::transcribe_podcast_groq_chunks,
            commands::podcast::transcribe_audio_file_groq,
            commands::podcast::cancel_podcast_transcription,
            commands::podcast::set_feed_auto_transcribe,
            commands::podcast::download_podcast_episode,
            commands::podcast::get_downloaded_episode_path,
            commands::podcast::delete_downloaded_episode,
            commands::podcast::save_podcast_transcript,
            sponsorblock::get_sponsorblock_cuts,
            // TAS (Tag-Aware Scheduling) commands
            commands::tas::build_tas_queue,
            commands::tas::set_tag_prerequisites,
            commands::tas::get_tag_maturity_stats,
            commands::tas::get_tags,
            commands::tas::upsert_tag,
            commands::tas::delete_tag,
            commands::tas::sync_tags,
            commands::tas::compute_tag_centroids,
            commands::tas::get_tas_config,
            commands::tas::update_tas_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
