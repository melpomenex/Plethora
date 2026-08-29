use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::OnceCell;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

use super::engine::run_sync_cycle;
use super::flags::sync_v2_enabled;
use super::gate::{bulk_lane_allowed, cloud_sync_enabled};
use super::retry::{record_failure, record_success, reset_on_network_restore, should_attempt_now};
use super::telemetry;
use super::SyncEngine;
use crate::database::Repository;
use crate::entitlements::EntitlementCache;
use crate::plethora_auth::AuthManager;
use std::sync::Arc;

static APP: OnceCell<AppHandle> = OnceCell::new();
static DEBOUNCE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static PERIODIC: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static ONLINE: AtomicBool = AtomicBool::new(true);
static WIFI_ONLY: AtomicBool = AtomicBool::new(false);
static ON_WIFI: AtomicBool = AtomicBool::new(true);

pub fn init(app: AppHandle) {
    let _ = APP.set(app.clone());
    start_periodic_sync(app);
}

pub fn on_app_foreground() {
    request_background_sync(false);
}

pub fn on_app_background() {
    // no-op for now; mobile lifecycle hook point
}

pub fn on_run_event(event: &RunEvent) {
    if matches!(event, RunEvent::Resumed) {
        on_app_foreground();
    }
}

pub fn on_network_restored() {
    reset_on_network_restore();
    request_background_sync(false);
}

pub fn set_online(online: bool) {
    ONLINE.store(online, Ordering::Relaxed);
    if online {
        on_network_restored();
    }
}

pub fn set_wifi_only(enabled: bool) {
    WIFI_ONLY.store(enabled, Ordering::Relaxed);
}

pub fn set_on_wifi(on_wifi: bool) {
    ON_WIFI.store(on_wifi, Ordering::Relaxed);
}

pub fn request_background_sync(fast_lane: bool) {
    if !should_attempt_now() {
        return;
    }
    let Some(app) = APP.get() else {
        return;
    };
    let entitlements = app.state::<Arc<EntitlementCache>>();
    if !sync_v2_enabled(Some(cloud_sync_enabled(&*entitlements))) {
        return;
    }
    let app = app.clone();

    let mut guard = match DEBOUNCE.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if let Some(handle) = guard.take() {
        handle.abort();
    }

    // This function is also called by synchronous Tauri commands and desktop
    // lifecycle callbacks, which are not guaranteed to run inside Tokio's
    // entered context. Use Tauri's global runtime handle so opening sync
    // settings or restoring the network cannot panic with "no reactor".
    *guard = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(if fast_lane { 1 } else { 2 })).await;
        if let Err(message) = run_scheduled_sync(&app, fast_lane).await {
            let engine = app.state::<Arc<SyncEngine>>();
            engine.set_error(message);
            let _ = app.emit("plethora-sync-status-changed", engine.get_status());
        }
    }));
}

fn start_periodic_sync(app: AppHandle) {
    let mut guard = match PERIODIC.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if guard.is_some() {
        return;
    }
    *guard = Some(tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            if let Err(message) = run_scheduled_sync(&app, false).await {
                let engine = app.state::<Arc<SyncEngine>>();
                engine.set_error(message);
                let _ = app.emit("plethora-sync-status-changed", engine.get_status());
            }
        }
    }));
}

async fn run_scheduled_sync(app: &AppHandle, fast_lane: bool) -> Result<(), String> {
    if !ONLINE.load(Ordering::Relaxed) {
        return Ok(());
    }
    if !should_attempt_now() {
        return Ok(());
    }

    let auth = app.state::<Arc<AuthManager>>();
    if auth.get_access_token().is_none() {
        return Ok(());
    }

    let entitlements = app.state::<Arc<EntitlementCache>>();
    if !cloud_sync_enabled(&entitlements) {
        return Ok(());
    }

    let battery = crate::battery::get_battery_state();
    if !fast_lane
        && !bulk_lane_allowed(
            &battery,
            WIFI_ONLY.load(Ordering::Relaxed),
            ON_WIFI.load(Ordering::Relaxed),
        )
    {
        return Ok(());
    }

    let repo = app.state::<Repository>();
    let engine = app.state::<Arc<SyncEngine>>();
    let started = std::time::Instant::now();
    engine.set_syncing(true);
    let result = run_sync_cycle(&repo, &auth, &engine, &*entitlements).await;
    engine.set_syncing(false);
    engine.refresh_pending_count(repo.pool()).await;

    match result {
        Ok((push, pull)) => {
            record_success();
            engine.set_last_synced(chrono::Utc::now().to_rfc3339());
            let _ = telemetry::record_event(
                repo.pool(),
                "sync_cycle",
                Some(started.elapsed().as_millis() as u64),
                Some(push.accepted),
                Some(pull.records.len()),
                None,
                None,
            )
            .await;
        }
        Err(error) => {
            record_failure();
            engine.set_error(error.to_string());
            let _ = telemetry::record_event(
                repo.pool(),
                "sync_failure",
                Some(started.elapsed().as_millis() as u64),
                None,
                None,
                None,
                Some(super::retry::consecutive_failures()),
            )
            .await;
            return Err(error.to_string());
        }
    }

    let _ = app.emit("plethora-sync-status-changed", engine.get_status());
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn tauri_runtime_spawn_is_safe_without_entered_tokio_context() {
        let (tx, rx) = mpsc::channel();

        std::thread::spawn(move || {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1)).await;
                let _ = tx.send(());
            });
        })
        .join()
        .expect("caller thread should not panic while scheduling");

        rx.recv_timeout(Duration::from_secs(2))
            .expect("scheduled task should run on Tauri's runtime");
    }
}
