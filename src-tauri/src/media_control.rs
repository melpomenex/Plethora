//! Desktop Remote-Media Bridge (design Decision 6, task 6.3)
//!
//! A Rust-side media-control handle (macOS now-playing/media keys, Windows
//! System Media Transport Controls, Linux MPRIS — via `souvlaki`) that
//! emits normalized `remote-media-command` Tauri events with the same
//! envelope the Android Media3 bridge uses, and accepts metadata/playback
//! state updates from the frontend via the `update_media_metadata` command.
//!
//! The bridge is created when the frontend player first pushes metadata and
//! detached when playback stops/idles, so OS media UIs stay accurate and the
//! integration tears down cleanly (design Decision 6).

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use tauri::{AppHandle, Emitter, Manager};

/// The normalized envelope every adapter emits (mirrors the TS type).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMediaCommandEnvelope {
    pub command: &'static str,
    pub event_id: String,
    pub source: &'static str,
    pub occurred_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_hint_sec: Option<f64>,
}

/// Latest playback snapshot pushed by the frontend.
#[derive(Debug, Clone, Default)]
struct MediaSnapshot {
    title: String,
    artist: String,
    album: String,
    duration_sec: f64,
    position_sec: f64,
    is_playing: bool,
}

enum BridgeCommand {
    Update(MediaSnapshot),
    Detach,
}

/// Managed state: the channel to the thread owning the platform controls.
pub struct MediaControlBridge {
    sender: Mutex<Option<Sender<BridgeCommand>>>,
}

impl Default for MediaControlBridge {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
        }
    }
}

fn new_event_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn event_name(event: &MediaControlEvent) -> Option<&'static str> {
    match event {
        MediaControlEvent::Play => Some("Play"),
        MediaControlEvent::Pause => Some("Pause"),
        MediaControlEvent::Toggle => Some("TogglePlayPause"),
        MediaControlEvent::Next => Some("Next"),
        MediaControlEvent::Previous => Some("Previous"),
        MediaControlEvent::Seek(souvlaki::SeekDirection::Forward) => Some("SeekForward"),
        MediaControlEvent::Seek(souvlaki::SeekDirection::Backward) => Some("SeekBackward"),
        MediaControlEvent::SeekBy(souvlaki::SeekDirection::Forward, _) => Some("SeekForward"),
        MediaControlEvent::SeekBy(souvlaki::SeekDirection::Backward, _) => Some("SeekBackward"),
        // Stop maps to Pause (never remapped, transport-only).
        MediaControlEvent::Stop => Some("Pause"),
        _ => None,
    }
}

/// Create the platform media controls on a dedicated thread and register the
/// command→event callbacks. Returns the command sender on success.
fn spawn_bridge(app: AppHandle, initial: MediaSnapshot) -> Option<Sender<BridgeCommand>> {
    let config = PlatformConfig {
        dbus_name: "plethora",
        display_name: "Plethora",
        // Windows SMTC requires the main window handle; souvlaki accepts an
        // optional hwnd. None degrades to no SMTC on Windows (documented
        // fallback: in-app keyboard controls), other platforms ignore it.
        hwnd: None,
    };

    let mut controls = MediaControls::new(config).ok()?;

    let handle_for_cb = app.clone();
    controls
        .attach(move |event: MediaControlEvent| {
            if let Some(command) = event_name(&event) {
                let envelope = RemoteMediaCommandEnvelope {
                    command,
                    event_id: new_event_id(),
                    source: "desktop",
                    occurred_at: chrono::Utc::now().timestamp_millis(),
                    position_hint_sec: None,
                };
                // The WebView listener normalizes + dispatches; failures are
                // non-fatal (window may be closing).
                let _ = handle_for_cb.emit("remote-media-command", envelope);
            }
        })
        .ok()?;

    let (tx, rx) = channel::<BridgeCommand>();

    std::thread::Builder::new()
        .name("plethora-media-bridge".into())
        .spawn(move || {
            let mut controls = controls;
            let mut snapshot = initial;
            let mut idle_ticks = 0u32;

            // Apply the initial snapshot so OS media UIs populate immediately.
            let _ = apply_snapshot(&mut controls, &snapshot);

            loop {
                // Poll for updates; detach after sustained silence (player
                // stopped without a final update) so the OS integration
                // tears down cleanly.
                match rx.recv_timeout(Duration::from_millis(5_000)) {
                    Ok(BridgeCommand::Update(next)) => {
                        idle_ticks = 0;
                        snapshot = next;
                        let _ = apply_snapshot(&mut controls, &snapshot);
                    }
                    Ok(BridgeCommand::Detach) | Err(_) => {
                        // Explicit detach, or the frontend stopped pushing
                        // state (player unmounted): clear and exit.
                        idle_ticks += 1;
                        if idle_ticks >= 2 || matches!(rx.try_recv(), Ok(BridgeCommand::Detach) | Err(std::sync::mpsc::TryRecvError::Disconnected)) {
                            let _ = controls.detach();
                            return;
                        }
                    }
                }
            }
        })
        .ok()?;

    Some(tx)
}

fn apply_snapshot(controls: &mut MediaControls, snapshot: &MediaSnapshot) -> Result<(), souvlaki::Error> {
    controls.set_metadata(MediaMetadata {
        title: Some(&snapshot.title),
        artist: Some(&snapshot.artist),
        album: Some(&snapshot.album),
        duration: if snapshot.duration_sec > 0.0 {
            Some(Duration::from_secs_f64(snapshot.duration_sec))
        } else {
            None
        },
        cover_url: None,
    })?;
    controls.set_playback(if snapshot.is_playing {
        MediaPlayback::Playing {
            progress: Some(MediaPosition(Duration::from_secs_f64(snapshot.position_sec.max(0.0)))),
        }
    } else {
        MediaPlayback::Paused {
            progress: Some(MediaPosition(Duration::from_secs_f64(snapshot.position_sec.max(0.0)))),
        }
    })
}

/// Frontend → bridge metadata/playback-state update (Tauri command).
#[tauri::command]
pub async fn update_media_metadata(
    app: AppHandle,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    is_playing: Option<bool>,
) -> Result<(), String> {
    let snapshot = MediaSnapshot {
        title: title.unwrap_or_else(|| "Plethora".into()),
        artist: artist.unwrap_or_else(|| "Plethora".into()),
        album: album.unwrap_or_else(|| "Library".into()),
        duration_sec: duration_sec.unwrap_or(0.0),
        position_sec: position_sec.unwrap_or(0.0),
        is_playing: is_playing.unwrap_or(false),
    };

    let bridge = app.state::<MediaControlBridge>();
    let mut guard = bridge.sender.lock().map_err(|e| e.to_string())?;

    if let Some(tx) = guard.as_ref() {
        let _ = tx.send(BridgeCommand::Update(snapshot));
    } else {
        // First update while audio is active: create the bridge.
        if snapshot.is_playing {
            if let Some(tx) = spawn_bridge(app.clone(), snapshot) {
                *guard = Some(tx);
            }
            // Creation failure (no DBus session, no SMTC hwnd, …) is not an
            // error: in-app controls keep working; the bridge stays detached.
        }
    }
    Ok(())
}

/// Explicit teardown when the player unmounts (clean OS integration).
#[tauri::command]
pub async fn detach_media_controls(app: AppHandle) -> Result<(), String> {
    let bridge = app.state::<MediaControlBridge>();
    if let Ok(mut guard) = bridge.sender.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(BridgeCommand::Detach);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every platform event maps onto the canonical TS RemoteMediaCommand
    /// union; unmapped events (volume, position set) are ignored gracefully.
    #[test]
    fn platform_events_map_to_canonical_commands() {
        use souvlaki::SeekDirection;

        assert_eq!(event_name(&MediaControlEvent::Play), Some("Play"));
        assert_eq!(event_name(&MediaControlEvent::Pause), Some("Pause"));
        assert_eq!(event_name(&MediaControlEvent::Toggle), Some("TogglePlayPause"));
        assert_eq!(event_name(&MediaControlEvent::Next), Some("Next"));
        assert_eq!(event_name(&MediaControlEvent::Previous), Some("Previous"));
        assert_eq!(event_name(&MediaControlEvent::Stop), Some("Pause"));
        assert_eq!(
            event_name(&MediaControlEvent::Seek(SeekDirection::Forward)),
            Some("SeekForward")
        );
        assert_eq!(
            event_name(&MediaControlEvent::Seek(SeekDirection::Backward)),
            Some("SeekBackward")
        );
        assert_eq!(
            event_name(&MediaControlEvent::SeekBy(SeekDirection::Forward, Duration::from_secs(15))),
            Some("SeekForward")
        );
        // Volume/position changes are metadata, not commands.
        assert_eq!(event_name(&MediaControlEvent::SetVolume(0.5)), None);
        assert_eq!(
            event_name(&MediaControlEvent::SetPosition(MediaPosition(Duration::from_secs(5)))),
            None
        );
    }

    #[test]
    fn envelopes_carry_unique_event_ids() {
        let a = RemoteMediaCommandEnvelope {
            command: "Next",
            event_id: new_event_id(),
            source: "desktop",
            occurred_at: 0,
            position_hint_sec: None,
        };
        let b = RemoteMediaCommandEnvelope {
            command: "Next",
            event_id: new_event_id(),
            source: "desktop",
            occurred_at: 0,
            position_hint_sec: None,
        };
        assert_ne!(a.event_id, b.event_id);
    }
}
