//! Native tray / menu-bar / status-area icon (requirement #20).
//!
//! Desktop-only module: declared under `#[cfg(desktop)]` in `lib.rs`, so
//! Android/iOS builds never compile this code (tauri-build emits the
//! `desktop` cfg alias for every non-mobile target).
//!
//! ## Platform conventions
//!
//! - **macOS:** a monochrome template image (`../icons/tray-icon-macos.png`)
//!   is used with [`TrayIconBuilder::icon_as_template`] so the status item
//!   adapts to the menu-bar appearance (light/dark). `tray-icon` renders the
//!   item at an 18pt height, so the 36×36 source is exactly @2x on Retina —
//!   crisp, no blurry scaling. A click opens the tray menu (the menu-bar
//!   convention), which contains Show/Hide/Quit.
//! - **Windows:** left-click shows and focuses the main window; right-click
//!   opens the menu. [`TrayIconBuilder::show_menu_on_left_click(false)`] keeps
//!   the menu off the primary click so left-click can show/focus instead.
//! - **Linux:** uses the standard status-notifier (libappindicator) backend
//!   that ships with `tray-icon`; the 32×32 mascot PNG is reused. Click events
//!   are not emitted on Linux and the menu opens on click — the conventional
//!   SNI behavior. Desktop fragmentation is expected: GNOME hides SNI unless an
//!   extension (e.g. AppIndicator) is installed, while KDE Plasma and COSMIC
//!   surface it natively. No desktop-specific hacks are used.
//!
//! ## Lifecycle
//!
//! Closing the main window quits Plethora exactly as before — this module does
//! not intercept `CloseRequested` and does not convert close into
//! minimize-to-tray. The tray only adds convenience actions (Show/Hide/Quit);
//! Quit calls [`AppHandle::exit`], which terminates the process.
//!
//! ## Known limitation
//!
//! Single-instance handling is not implemented, so launching a second copy
//! spawns a second process (unchanged from before this change).

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Tray icon id; used to re-fetch the live [`tauri::tray::TrayIcon`] handle
/// (e.g. to change the icon later) via `app.tray_by_id(TRAY_ID)`.
const TRAY_ID: &str = "plethora-tray";

const MENU_SHOW: &str = "tray-show";
const MENU_HIDE: &str = "tray-hide";
const MENU_QUIT: &str = "tray-quit";

/// Create and register the tray icon with its menu and event handlers.
///
/// The built [`tauri::tray::TrayIcon`] is registered in the app's resource
/// table, so it stays alive for the lifetime of the process even though the
/// returned handle is dropped.
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle();
    let menu = build_menu(app_handle)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Plethora");

    if let Some(icon) = load_tray_icon() {
        builder = builder.icon(icon);
    }

    // macOS: menu-bar-appropriate monochrome template so the status item
    // renders correctly in both light and dark menu bars.
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    // Windows: keep the menu off the primary click so left-click can show and
    // focus the window (see the tray-icon event handler below). Right-click
    // still opens the menu. macOS keeps the menu-bar convention (a click opens
    // the menu); Linux ignores this option (menu opens on click either way).
    #[cfg(target_os = "windows")]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    builder = builder.on_menu_event(|app, event| match event.id.as_ref() {
        MENU_SHOW => show_main_window(app),
        MENU_HIDE => hide_main_window(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    });

    // Windows emits tray click events; act on the conventional left-click
    // show/focus. Linux does not emit click events (the menu opens on click),
    // and macOS opens the menu on click by convention.
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

/// The tray menu: Show/Open, Hide (where supported) and Quit.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, MENU_SHOW, "Show Plethora", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Plethora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Plethora", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
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

/// Decode the embedded tray icon. macOS gets a purpose-built monochrome
/// template image; Linux/Windows reuse the 32×32 mascot PNG (the platform's
/// standard tray size). The bytes are compile-time constants, so a decode
/// failure here is unreachable in practice; we warn and continue gracefully,
/// matching the `apply_window_icons` pattern.
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
