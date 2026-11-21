//! Native tray / menu-bar / status-area icon (requirement #4 / #20).
//!
//! Desktop-only module: declared under `#[cfg(desktop)]` in `lib.rs`, so
//! Android/iOS builds never compile this code (tauri-build emits the
//! `desktop` cfg alias for every non-mobile target).
//!
//! ## Lifecycle
//!
//! Closing the main window quits Plethora exactly as before — this module does
//! not intercept `CloseRequested` and does not convert close into
//! minimize-to-tray. Quit calls [`AppHandle::exit`], which terminates the process.

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// Tray icon id; used to re-fetch the live [`tauri::tray::TrayIcon`] handle
/// via `app.tray_by_id(TRAY_ID)`.
const TRAY_ID: &str = "plethora-tray";

pub const MENU_OPEN: &str = "tray-open";
pub const MENU_QUEUE: &str = "tray-queue";
pub const MENU_REVIEW: &str = "tray-review";
pub const MENU_CONTINUE_READING: &str = "tray-continue-reading";
pub const MENU_IMPORT: &str = "tray-import";
pub const MENU_LEARNING_INSIGHTS: &str = "tray-learning-insights";
pub const MENU_SETTINGS: &str = "tray-settings";
pub const MENU_HIDE: &str = "tray-hide";
pub const MENU_QUIT: &str = "tray-quit";

pub const TRAY_ACTION_EVENT: &str = "tray://action";

/// Stores the most recent tray action issued before the frontend listener is
/// ready, so startup/cold-launch tray clicks are never lost.
#[derive(Default)]
pub struct PendingTrayAction(pub Mutex<Option<String>>);

pub fn action_for_menu_id(menu_id: &str) -> Option<&'static str> {
    match menu_id {
        MENU_QUEUE => Some("open-queue"),
        MENU_REVIEW => Some("start-review"),
        MENU_CONTINUE_READING => Some("continue-reading"),
        MENU_IMPORT => Some("import-document"),
        MENU_LEARNING_INSIGHTS => Some("learning-insights"),
        MENU_SETTINGS => Some("open-settings"),
        _ => None,
    }
}

/// Create and register the tray icon with its menu and event handlers.
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle();
    let menu = build_menu(app_handle)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Plethora");

    if let Some(icon) = load_tray_icon() {
        builder = builder.icon(icon);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    #[cfg(target_os = "windows")]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    builder = builder.on_menu_event(|app, event| {
        let id = event.id.as_ref();
        match id {
            MENU_OPEN => show_main_window(app),
            MENU_HIDE => hide_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {
                if let Some(action) = action_for_menu_id(id) {
                    dispatch_tray_action(app, action);
                }
            }
        }
    });

    #[cfg(target_os = "windows")]
    {
        builder = builder.on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    }

    builder.build(app)?;
    Ok(())
}

/// The tray menu: Open, quick learning workflows, Settings, Hide, and Quit.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Plethora", true, None::<&str>)?;
    let queue = MenuItem::with_id(app, MENU_QUEUE, "Open Queue", true, None::<&str>)?;
    let review = MenuItem::with_id(app, MENU_REVIEW, "Start Review", true, None::<&str>)?;
    let continue_reading = MenuItem::with_id(
        app,
        MENU_CONTINUE_READING,
        "Continue Reading",
        true,
        None::<&str>,
    )?;
    let import_doc = MenuItem::with_id(app, MENU_IMPORT, "Import Document…", true, None::<&str>)?;
    let insights = MenuItem::with_id(
        app,
        MENU_LEARNING_INSIGHTS,
        "Learning Insights",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Plethora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Plethora", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &open,
            &sep1,
            &queue,
            &review,
            &continue_reading,
            &import_doc,
            &insights,
            &sep2,
            &settings,
            &hide,
            &quit,
        ],
    )
}

fn dispatch_tray_action(app: &AppHandle, action: &str) {
    show_main_window(app);
    if let Some(pending) = app.try_state::<PendingTrayAction>() {
        if let Ok(mut guard) = pending.0.lock() {
            *guard = Some(action.to_string());
        }
    }
    let _ = app.emit(TRAY_ACTION_EVENT, action);
}

/// Show, unminimize and focus the main window, bringing it to the front.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hide the main window. Closing the window still quits the app; this only
/// hides it while the tray stays available to bring it back.
fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Decode the embedded tray icon.
fn load_tray_icon() -> Option<tauri::image::Image<'static>> {
    #[cfg(target_os = "macos")]
    let bytes: &'static [u8] = include_bytes!("../icons/tray-icon-macos.png");
    #[cfg(not(target_os = "macos"))]
    let bytes: &'static [u8] = include_bytes!("../icons/32x32.png");

    match tauri::image::Image::from_bytes(bytes) {
        Ok(icon) => Some(icon),
        Err(err) => {
            tracing::warn!("[tray] Plethora tray icon failed to decode: {err}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_workflow_menu_id_to_canonical_action() {
        assert_eq!(action_for_menu_id(MENU_QUEUE), Some("open-queue"));
        assert_eq!(action_for_menu_id(MENU_REVIEW), Some("start-review"));
        assert_eq!(
            action_for_menu_id(MENU_CONTINUE_READING),
            Some("continue-reading")
        );
        assert_eq!(action_for_menu_id(MENU_IMPORT), Some("import-document"));
        assert_eq!(
            action_for_menu_id(MENU_LEARNING_INSIGHTS),
            Some("learning-insights")
        );
        assert_eq!(action_for_menu_id(MENU_SETTINGS), Some("open-settings"));
        assert_eq!(action_for_menu_id(MENU_OPEN), None);
        assert_eq!(action_for_menu_id(MENU_HIDE), None);
        assert_eq!(action_for_menu_id(MENU_QUIT), None);
    }
}
