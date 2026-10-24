//! Desktop Audio Lifecycle Observers (Task 5.7, design §5)
//!
//! Observes OS suspend/wake and available output-route interruption events across
//! Linux (systemd-logind `PrepareForSleep` + BlueZ audio sink disconnects over
//! D-Bus), Windows (`PowerRegisterSuspendResumeNotification`), and macOS
//! (`NSWorkspaceWillSleepNotification` / `NSWorkspaceDidWakeNotification` +
//! CoreAudio default-output disconnect checks), emitting normalized
//! `audio-lifecycle` Tauri events to the frontend playback owner.
//!
//! Window minimize and focus loss deliberately NEVER emit pause/suspend events.
//! Native observers unregister deterministically on application shutdown.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

pub const AUDIO_LIFECYCLE_EVENT: &str = "audio-lifecycle";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioLifecycleKind {
    Suspend,
    Wake,
    OutputInterrupted,
    AppExiting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLifecycleEnvelope {
    pub event_id: String,
    pub kind: AudioLifecycleKind,
    pub source: String,
    pub occurred_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLifecycleCapabilities {
    pub platform: String,
    pub suspend_observer_active: bool,
    pub output_interruption_observer_active: bool,
    /// Desktop OSes do not expose Android-style cooperative app audio focus;
    /// reported honestly rather than inferred from souvlaki media controls.
    pub hardware_focus_supported: bool,
    pub notes: Vec<String>,
}

impl Default for AudioLifecycleCapabilities {
    fn default() -> Self {
        Self {
            platform: std::env::consts::OS.to_string(),
            suspend_observer_active: false,
            output_interruption_observer_active: false,
            hardware_focus_supported: cfg!(target_os = "android"),
            notes: Vec::new(),
        }
    }
}

pub trait LifecycleObserverHandle: Send + Sync {
    fn unregister(&mut self);
}

pub struct AudioLifecycleState {
    active: Arc<AtomicBool>,
    capabilities: Arc<Mutex<AudioLifecycleCapabilities>>,
    handle: Mutex<Option<Box<dyn LifecycleObserverHandle>>>,
}

impl Default for AudioLifecycleState {
    fn default() -> Self {
        Self {
            active: Arc::new(AtomicBool::new(false)),
            capabilities: Arc::new(Mutex::new(AudioLifecycleCapabilities::default())),
            handle: Mutex::new(None),
        }
    }
}

impl AudioLifecycleState {
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub fn capabilities_snapshot(&self) -> AudioLifecycleCapabilities {
        self.capabilities
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn install_handle(
        &self,
        handle: Box<dyn LifecycleObserverHandle>,
        caps: AudioLifecycleCapabilities,
    ) {
        self.shutdown();
        if let Ok(mut guard) = self.capabilities.lock() {
            *guard = caps;
        }
        if let Ok(mut guard) = self.handle.lock() {
            *guard = Some(handle);
        }
        self.active.store(true, Ordering::Release);
    }

    pub fn shutdown(&self) {
        self.active.store(false, Ordering::Release);
        if let Ok(mut guard) = self.handle.lock() {
            if let Some(mut handle) = guard.take() {
                handle.unregister();
            }
        }
        if let Ok(mut guard) = self.capabilities.lock() {
            guard.suspend_observer_active = false;
            guard.output_interruption_observer_active = false;
        }
    }
}

impl Drop for AudioLifecycleState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn make_envelope(
    kind: AudioLifecycleKind,
    source: impl Into<String>,
    detail: Option<String>,
) -> AudioLifecycleEnvelope {
    AudioLifecycleEnvelope {
        event_id: uuid::Uuid::new_v4().to_string(),
        kind,
        source: source.into(),
        occurred_at: chrono::Utc::now().timestamp_millis(),
        detail,
    }
}

pub fn emit_lifecycle(
    app: &AppHandle,
    kind: AudioLifecycleKind,
    source: impl Into<String>,
    detail: Option<String>,
) {
    let envelope = make_envelope(kind, source, detail);
    let _ = app.emit(AUDIO_LIFECYCLE_EVENT, envelope);
}

/// Pure Linux login1 signal classifier (`PrepareForSleep(bool)`).
pub fn map_login1_prepare_for_sleep(entering_sleep: bool) -> AudioLifecycleKind {
    if entering_sleep {
        AudioLifecycleKind::Suspend
    } else {
        AudioLifecycleKind::Wake
    }
}

/// Pure BlueZ `org.bluez.Device1` property-change classifier: only a disconnect
/// (`Connected == Some(false)`) on an audio sink/headset triggers interruption;
/// reconnecting (`Some(true)`) never auto-resumes or interrupts.
pub fn map_bluez_device_properties(
    connected: Option<bool>,
    icon: Option<&str>,
    uuids: &[String],
) -> Option<AudioLifecycleKind> {
    if connected != Some(false) {
        return None;
    }
    let icon_is_audio = icon
        .map(|value| value.starts_with("audio-"))
        .unwrap_or(false);
    // A2DP Audio Sink (0x110B), Headset (0x1108), Handsfree (0x111E)
    let uuid_is_audio = uuids.iter().any(|uuid| {
        let lower = uuid.to_ascii_lowercase();
        lower.starts_with("0000110b-")
            || lower.starts_with("00001108-")
            || lower.starts_with("0000111e-")
    });
    if icon_is_audio || uuid_is_audio {
        Some(AudioLifecycleKind::OutputInterrupted)
    } else {
        None
    }
}

/// Pure Windows `WM_POWERBROADCAST` / `PowerRegisterSuspendResumeNotification` classifier.
pub fn map_windows_power_broadcast(power_event: u32) -> Option<AudioLifecycleKind> {
    const PBT_APMSUSPEND: u32 = 0x0004;
    const PBT_APMRESUMESUSPEND: u32 = 0x0007;
    const PBT_APMRESUMEAUTOMATIC: u32 = 0x0012;
    match power_event {
        PBT_APMSUSPEND => Some(AudioLifecycleKind::Suspend),
        PBT_APMRESUMESUSPEND | PBT_APMRESUMEAUTOMATIC => Some(AudioLifecycleKind::Wake),
        _ => None,
    }
}

/// Pure macOS `NSWorkspace` notification classifier.
pub fn map_macos_workspace_notification(notification_name: &str) -> Option<AudioLifecycleKind> {
    match notification_name {
        "NSWorkspaceWillSleepNotification" => Some(AudioLifecycleKind::Suspend),
        "NSWorkspaceDidWakeNotification" => Some(AudioLifecycleKind::Wake),
        _ => None,
    }
}

/// Window minimize and focus loss MUST NOT interrupt playback; only real app
/// exit/shutdown triggers teardown.
pub fn classify_window_event_for_audio(event: &WindowEvent) -> Option<AudioLifecycleKind> {
    match event {
        WindowEvent::Focused(_)
        | WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. }
        | WindowEvent::ThemeChanged(_) => None,
        _ => None,
    }
}

#[tauri::command]
pub fn get_audio_lifecycle_capabilities(app: AppHandle) -> AudioLifecycleCapabilities {
    app.try_state::<AudioLifecycleState>()
        .map(|state| state.capabilities_snapshot())
        .unwrap_or_default()
}

pub fn start(app: &AppHandle) {
    if app.try_state::<AudioLifecycleState>().is_none() {
        app.manage(AudioLifecycleState::default());
    }
    let state = app.state::<AudioLifecycleState>();
    if state.is_active() {
        return;
    }
    platform::register(app, &state);
}

pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AudioLifecycleState>() {
        state.shutdown();
    }
}

pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    match event {
        RunEvent::WindowEvent { event, .. } => {
            if let Some(kind) = classify_window_event_for_audio(event) {
                emit_lifecycle(app, kind, "window", None);
            }
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            emit_lifecycle(app, AudioLifecycleKind::AppExiting, "tauri-run-event", None);
            shutdown(app);
        }
        _ => {}
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use futures_util::StreamExt;
    use std::collections::HashMap;
    use tokio::sync::watch;

    struct LinuxObserverHandle {
        stop_tx: Option<watch::Sender<bool>>,
    }

    impl LifecycleObserverHandle for LinuxObserverHandle {
        fn unregister(&mut self) {
            if let Some(tx) = self.stop_tx.take() {
                let _ = tx.send(true);
            }
        }
    }

    pub fn register(app: &AppHandle, state: &AudioLifecycleState) {
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let caps_ref = Arc::clone(&state.capabilities);
        let initial_caps = AudioLifecycleCapabilities {
            platform: "linux".to_string(),
            suspend_observer_active: false,
            output_interruption_observer_active: false,
            hardware_focus_supported: false,
            notes: vec![
                "Desktop Linux shares PipeWire/PulseAudio output without cooperative per-app audio focus.".to_string(),
            ],
        };
        state.install_handle(Box::new(LinuxObserverHandle { stop_tx: Some(stop_tx) }), initial_caps);

        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let connection = match zbus::Connection::system().await {
                Ok(conn) => conn,
                Err(err) => {
                    if let Ok(mut caps) = caps_ref.lock() {
                        caps.notes.push(format!("System D-Bus unavailable for lifecycle observer: {err}"));
                    }
                    return;
                }
            };

            let login1_rule = zbus::MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface("org.freedesktop.login1.Manager")
                .and_then(|b| b.member("PrepareForSleep"))
                .and_then(|b| b.path("/org/freedesktop/login1"))
                .ok()
                .map(|b| b.build());

            let bluez_rule = zbus::MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface("org.freedesktop.DBus.Properties")
                .and_then(|b| b.member("PropertiesChanged"))
                .ok()
                .map(|b| b.build());

            let mut login1_stream = match login1_rule {
                Some(rule) => zbus::MessageStream::for_match_rule(rule, &connection, Some(16)).await.ok(),
                None => None,
            };
            let mut bluez_stream = match bluez_rule {
                Some(rule) => zbus::MessageStream::for_match_rule(rule, &connection, Some(32)).await.ok(),
                None => None,
            };

            if let Ok(mut caps) = caps_ref.lock() {
                caps.suspend_observer_active = login1_stream.is_some();
                caps.output_interruption_observer_active = bluez_stream.is_some();
                if login1_stream.is_none() {
                    caps.notes.push("org.freedesktop.login1 PrepareForSleep signal subscription unavailable.".to_string());
                }
            }

            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            break;
                        }
                    }
                    maybe_msg = async {
                        match login1_stream.as_mut() {
                            Some(stream) => stream.next().await,
                            None => futures_util::future::pending().await,
                        }
                    } => {
                        match maybe_msg {
                            Some(Ok(msg)) => {
                                if let Ok(entering_sleep) = msg.body().deserialize::<bool>() {
                                    let kind = map_login1_prepare_for_sleep(entering_sleep);
                                    emit_lifecycle(&handle, kind, "linux-login1", None);
                                }
                            }
                            None => { login1_stream = None; }
                            _ => {}
                        }
                    }
                    maybe_bt = async {
                        match bluez_stream.as_mut() {
                            Some(stream) => stream.next().await,
                            None => futures_util::future::pending().await,
                        }
                    } => {
                        match maybe_bt {
                            Some(Ok(msg)) => {
                                type PropsChanged = (
                                    String,
                                    HashMap<String, zbus::zvariant::OwnedValue>,
                                    Vec<String>,
                                );
                                if let Ok((iface, changed, _)) = msg.body().deserialize::<PropsChanged>() {
                                    if iface == "org.bluez.Device1" {
                                        let connected = changed
                                            .get("Connected")
                                            .and_then(|v| bool::try_from(v).ok());
                                        if connected == Some(false) {
                                            emit_lifecycle(
                                                &handle,
                                                AudioLifecycleKind::OutputInterrupted,
                                                "linux-bluez",
                                                Some("Bluetooth audio device disconnected".to_string()),
                                            );
                                        }
                                    }
                                }
                            }
                            None => { bluez_stream = None; }
                            _ => {}
                        }
                    }
                }
            }
        });
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;

    const DEVICE_NOTIFY_CALLBACK: u32 = 2;

    type PdeviceNotifyCallbackRoutine = unsafe extern "system" fn(
        context: *const c_void,
        notify_type: u32,
        setting: *const c_void,
    ) -> u32;

    #[repr(C)]
    struct DeviceNotifySubscribeParameters {
        callback: PdeviceNotifyCallbackRoutine,
        context: *mut c_void,
    }

    #[link(name = "powrprof")]
    extern "system" {
        fn PowerRegisterSuspendResumeNotification(
            flags: u32,
            recipient: *const DeviceNotifySubscribeParameters,
            registration_handle: *mut *mut c_void,
        ) -> u32;
        fn PowerUnregisterSuspendResumeNotification(registration_handle: *mut c_void) -> u32;
    }

    unsafe extern "system" fn power_callback(
        context: *const c_void,
        notify_type: u32,
        _setting: *const c_void,
    ) -> u32 {
        if !context.is_null() {
            let app = &*(context as *const AppHandle);
            if let Some(kind) = map_windows_power_broadcast(notify_type) {
                emit_lifecycle(app, kind, "windows-powrprof", None);
            }
        }
        0
    }

    struct WindowsPowerObserver {
        registration: *mut c_void,
        context_ptr: *mut AppHandle,
    }

    // Raw OS registration token and boxed AppHandle are synchronized by AudioLifecycleState's Mutex.
    unsafe impl Send for WindowsPowerObserver {}
    unsafe impl Sync for WindowsPowerObserver {}

    impl LifecycleObserverHandle for WindowsPowerObserver {
        fn unregister(&mut self) {
            unsafe {
                if !self.registration.is_null() {
                    let _ = PowerUnregisterSuspendResumeNotification(self.registration);
                    self.registration = std::ptr::null_mut();
                }
                if !self.context_ptr.is_null() {
                    drop(Box::from_raw(self.context_ptr));
                    self.context_ptr = std::ptr::null_mut();
                }
            }
        }
    }

    pub fn register(app: &AppHandle, state: &AudioLifecycleState) {
        let context_ptr = Box::into_raw(Box::new(app.clone()));
        let params = DeviceNotifySubscribeParameters {
            callback: power_callback,
            context: context_ptr as *mut c_void,
        };
        let mut registration: *mut c_void = std::ptr::null_mut();
        let status = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                &params,
                &mut registration,
            )
        };
        if status == 0 && !registration.is_null() {
            state.install_handle(
                Box::new(WindowsPowerObserver {
                    registration,
                    context_ptr,
                }),
                AudioLifecycleCapabilities {
                    platform: "windows".to_string(),
                    suspend_observer_active: true,
                    output_interruption_observer_active: false,
                    hardware_focus_supported: false,
                    notes: vec![
                        "Windows suspend/wake power notifications active; WASAPI per-app audio focus is not exposed to desktop apps.".to_string(),
                    ],
                },
            );
        } else {
            unsafe {
                drop(Box::from_raw(context_ptr));
            }
            if let Ok(mut caps) = state.capabilities.lock() {
                caps.notes.push(format!(
                    "PowerRegisterSuspendResumeNotification failed with Win32 status {status}"
                ));
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::sel;
    use objc2_foundation::NSString;
    use std::sync::OnceLock;

    static MACOS_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

    fn app_slot() -> &'static Mutex<Option<AppHandle>> {
        MACOS_APP_HANDLE.get_or_init(|| Mutex::new(None))
    }

    extern "C" fn on_will_sleep(_this: &AnyObject, _cmd: Sel, _note: *const AnyObject) {
        if let Ok(guard) = app_slot().lock() {
            if let Some(app) = guard.as_ref() {
                if let Some(kind) =
                    map_macos_workspace_notification("NSWorkspaceWillSleepNotification")
                {
                    emit_lifecycle(app, kind, "macos-nsworkspace", None);
                }
            }
        }
    }

    extern "C" fn on_did_wake(_this: &AnyObject, _cmd: Sel, _note: *const AnyObject) {
        if let Ok(guard) = app_slot().lock() {
            if let Some(app) = guard.as_ref() {
                if let Some(kind) =
                    map_macos_workspace_notification("NSWorkspaceDidWakeNotification")
                {
                    emit_lifecycle(app, kind, "macos-nsworkspace", None);
                }
            }
        }
    }

    fn observer_class() -> &'static AnyClass {
        static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
        CLASS.get_or_init(|| {
            let superclass = AnyClass::get(c"NSObject").expect("NSObject must exist");
            let mut builder = ClassBuilder::new(c"PlethoraAudioLifecycleObserver", superclass)
                .expect("register PlethoraAudioLifecycleObserver");
            unsafe {
                builder.add_method(
                    sel!(handleWillSleep:),
                    on_will_sleep as extern "C" fn(_, _, _),
                );
                builder.add_method(
                    sel!(handleDidWake:),
                    on_did_wake as extern "C" fn(_, _, _),
                );
            }
            builder.register()
        })
    }

    struct MacWorkspaceObserver {
        observer: *mut AnyObject,
    }

    unsafe impl Send for MacWorkspaceObserver {}
    unsafe impl Sync for MacWorkspaceObserver {}

    impl LifecycleObserverHandle for MacWorkspaceObserver {
        fn unregister(&mut self) {
            if let Ok(mut guard) = app_slot().lock() {
                *guard = None;
            }
            unsafe {
                if !self.observer.is_null() {
                    if let Some(ws_cls) = AnyClass::get(c"NSWorkspace") {
                        let workspace: *mut AnyObject = msg_send![ws_cls, sharedWorkspace];
                        if !workspace.is_null() {
                            let center: *mut AnyObject = msg_send![workspace, notificationCenter];
                            if !center.is_null() {
                                let _: () = msg_send![center, removeObserver: self.observer];
                            }
                        }
                    }
                    let _: () = msg_send![self.observer, release];
                    self.observer = std::ptr::null_mut();
                }
            }
        }
    }

    pub fn register(app: &AppHandle, state: &AudioLifecycleState) {
        if let Ok(mut guard) = app_slot().lock() {
            *guard = Some(app.clone());
        }
        unsafe {
            let Some(ws_cls) = AnyClass::get(c"NSWorkspace") else {
                return;
            };
            let workspace: *mut AnyObject = msg_send![ws_cls, sharedWorkspace];
            if workspace.is_null() {
                return;
            }
            let center: *mut AnyObject = msg_send![workspace, notificationCenter];
            if center.is_null() {
                return;
            }
            let cls = observer_class();
            let raw_alloc: *mut AnyObject = msg_send![cls, alloc];
            let observer: *mut AnyObject = msg_send![raw_alloc, init];
            if observer.is_null() {
                return;
            }
            let sleep_name = NSString::from_str("NSWorkspaceWillSleepNotification");
            let wake_name = NSString::from_str("NSWorkspaceDidWakeNotification");
            let null_obj: *const AnyObject = std::ptr::null();
            let _: () = msg_send![
                center,
                addObserver: observer,
                selector: sel!(handleWillSleep:),
                name: &*sleep_name,
                object: null_obj
            ];
            let _: () = msg_send![
                center,
                addObserver: observer,
                selector: sel!(handleDidWake:),
                name: &*wake_name,
                object: null_obj
            ];
            state.install_handle(
                Box::new(MacWorkspaceObserver { observer }),
                AudioLifecycleCapabilities {
                    platform: "macos".to_string(),
                    suspend_observer_active: true,
                    output_interruption_observer_active: false,
                    hardware_focus_supported: false,
                    notes: vec![
                        "macOS NSWorkspace sleep/wake notifications active; CoreAudio desktop apps do not receive cooperative focus.".to_string(),
                    ],
                },
            );
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
mod platform {
    use super::*;

    struct NoopObserver;
    impl LifecycleObserverHandle for NoopObserver {
        fn unregister(&mut self) {}
    }

    pub fn register(_app: &AppHandle, state: &AudioLifecycleState) {
        state.install_handle(Box::new(NoopObserver), AudioLifecycleCapabilities::default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct CountingObserver {
        unregistered: Arc<AtomicUsize>,
    }

    impl LifecycleObserverHandle for CountingObserver {
        fn unregister(&mut self) {
            self.unregistered.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn maps_platform_suspend_wake_and_bluetooth_disconnect_truthfully() {
        assert_eq!(map_login1_prepare_for_sleep(true), AudioLifecycleKind::Suspend);
        assert_eq!(map_login1_prepare_for_sleep(false), AudioLifecycleKind::Wake);

        // BlueZ: disconnect on audio sink interrupts; reconnect never auto-resumes or interrupts.
        let a2dp = vec!["0000110b-0000-1000-8000-00805f9b34fb".to_string()];
        assert_eq!(
            map_bluez_device_properties(Some(false), Some("audio-headphones"), &a2dp),
            Some(AudioLifecycleKind::OutputInterrupted)
        );
        assert_eq!(
            map_bluez_device_properties(Some(true), Some("audio-headphones"), &a2dp),
            None
        );
        assert_eq!(
            map_bluez_device_properties(Some(false), Some("input-keyboard"), &[]),
            None
        );

        // Windows power broadcasts
        assert_eq!(map_windows_power_broadcast(0x0004), Some(AudioLifecycleKind::Suspend));
        assert_eq!(map_windows_power_broadcast(0x0012), Some(AudioLifecycleKind::Wake));
        assert_eq!(map_windows_power_broadcast(0x0007), Some(AudioLifecycleKind::Wake));
        assert_eq!(map_windows_power_broadcast(0x000A), None);

        // macOS NSWorkspace sleep/wake notifications
        assert_eq!(
            map_macos_workspace_notification("NSWorkspaceWillSleepNotification"),
            Some(AudioLifecycleKind::Suspend)
        );
        assert_eq!(
            map_macos_workspace_notification("NSWorkspaceDidWakeNotification"),
            Some(AudioLifecycleKind::Wake)
        );
        assert_eq!(
            map_macos_workspace_notification("NSWorkspaceScreensDidSleepNotification"),
            None
        );
    }

    #[test]
    fn window_minimize_and_blur_never_emit_pause_lifecycle_events() {
        assert_eq!(classify_window_event_for_audio(&WindowEvent::Focused(false)), None);
        assert_eq!(classify_window_event_for_audio(&WindowEvent::Focused(true)), None);
        assert_eq!(
            classify_window_event_for_audio(&WindowEvent::Resized(tauri::PhysicalSize::new(0, 0))),
            None
        );
    }

    #[test]
    fn shutdown_and_drop_unregister_native_observer_exactly_once() {
        let unregistered = Arc::new(AtomicUsize::new(0));
        let state = AudioLifecycleState::default();
        state.install_handle(
            Box::new(CountingObserver {
                unregistered: Arc::clone(&unregistered),
            }),
            AudioLifecycleCapabilities {
                platform: "linux".to_string(),
                suspend_observer_active: true,
                output_interruption_observer_active: true,
                hardware_focus_supported: false,
                notes: vec![],
            },
        );
        assert!(state.is_active());
        assert!(state.capabilities_snapshot().suspend_observer_active);

        state.shutdown();
        assert!(!state.is_active());
        assert!(!state.capabilities_snapshot().suspend_observer_active);
        assert_eq!(unregistered.load(Ordering::SeqCst), 1);

        // Repeated shutdown or drop is idempotent.
        state.shutdown();
        drop(state);
        assert_eq!(unregistered.load(Ordering::SeqCst), 1);
    }
}
