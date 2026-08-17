//! Screenshot capture functionality

#[cfg(feature = "screenshot")]
use crate::error::{PlethoraError, Result};
#[cfg(feature = "screenshot")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(feature = "screenshot")]
use std::io::Cursor;
#[cfg(feature = "screenshot")]
use xcap::{Monitor, Window};

/// Capture a screenshot of the primary screen
#[cfg(feature = "screenshot")]
#[tauri::command]
pub async fn capture_screenshot() -> Result<String> {
    let monitors = Monitor::all().map_err(|err| {
        PlethoraError::Internal(format!("Failed to enumerate monitors: {err}"))
    })?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| PlethoraError::NotFound("No monitors available".to_string()))?;

    let image = monitor
        .capture_image()
        .map_err(|err| PlethoraError::Internal(format!("Failed to capture screen: {err}")))?;
    encode_image(image)
}

/// Capture a screenshot of a specific screen by index
#[cfg(feature = "screenshot")]
#[tauri::command]
pub async fn capture_screen_by_index(index: usize) -> Result<String> {
    let monitors = Monitor::all().map_err(|err| {
        PlethoraError::Internal(format!("Failed to enumerate monitors: {err}"))
    })?;
    let monitor = monitors.get(index).ok_or_else(|| {
        PlethoraError::InvalidInput(format!("Screen index {index} out of range"))
    })?;

    let image = monitor
        .capture_image()
        .map_err(|err| PlethoraError::Internal(format!("Failed to capture screen: {err}")))?;
    encode_image(image)
}

/// Get information about all available screens
#[cfg(feature = "screenshot")]
#[tauri::command]
pub fn get_screen_info() -> Vec<ScreenInfo> {
    let monitors = Monitor::all().unwrap_or_default();

    monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| ScreenInfo {
            index,
            width: monitor.width().unwrap_or(0),
            height: monitor.height().unwrap_or(0),
            x: monitor.x().unwrap_or(0),
            y: monitor.y().unwrap_or(0),
            scale_factor: monitor.scale_factor().unwrap_or(1.0),
            is_primary: monitor.is_primary().unwrap_or(false),
        })
        .collect()
}

/// Capture a screenshot of the app window by title
#[cfg(feature = "screenshot")]
#[tauri::command]
pub async fn capture_app_window() -> Result<String> {
    let windows = Window::all()
        .map_err(|err| PlethoraError::Internal(format!("Failed to enumerate windows: {err}")))?;
    let window = windows
        .iter()
        .find(|w| w.title().as_deref().unwrap_or("") == "Plethora")
        .or_else(|| windows.first())
        .ok_or_else(|| PlethoraError::NotFound("No windows available".to_string()))?;

    let image = window
        .capture_image()
        .map_err(|err| PlethoraError::Internal(format!("Failed to capture window: {err}")))?;
    encode_image(image)
}

/// Capture a rectangle within the current webview's content area.
///
/// The rectangle uses CSS viewport coordinates from `getBoundingClientRect`.
/// Tauri supplies the physical content/outer-window offsets and scale factor,
/// allowing us to crop the xcap window image without relying on title-bar
/// dimensions or platform-specific constants.
#[cfg(feature = "screenshot")]
#[tauri::command]
pub async fn capture_app_window_region(
    window: tauri::WebviewWindow,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
) -> Result<String> {
    if !left.is_finite()
        || !top.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
    {
        return Err(PlethoraError::InvalidInput(
            "Screenshot region is invalid".to_string(),
        ));
    }

    let windows = Window::all()
        .map_err(|err| PlethoraError::Internal(format!("Failed to enumerate windows: {err}")))?;
    let captured_window = windows
        .iter()
        .find(|candidate| candidate.title().as_deref().unwrap_or("") == "Incrementum")
        .or_else(|| windows.first())
        .ok_or_else(|| PlethoraError::NotFound("No windows available".to_string()))?;
    let captured_image = captured_window
        .capture_image()
        .map_err(|err| PlethoraError::Internal(format!("Failed to capture window: {err}")))?;

    let inner_position = window.inner_position().map_err(|err| {
        PlethoraError::Internal(format!("Failed to read content position: {err}"))
    })?;
    let outer_position = window.outer_position().map_err(|err| {
        PlethoraError::Internal(format!("Failed to read window position: {err}"))
    })?;
    let inner_size = window
        .inner_size()
        .map_err(|err| PlethoraError::Internal(format!("Failed to read content size: {err}")))?;
    let outer_size = window
        .outer_size()
        .map_err(|err| PlethoraError::Internal(format!("Failed to read window size: {err}")))?;
    let scale = window.scale_factor().map_err(|err| {
        PlethoraError::Internal(format!("Failed to read display scale: {err}"))
    })?;

    // xcap backends differ: some capture the full decorated window and others
    // capture only its client area. Use the closest Tauri physical size to
    // decide whether title-bar and border offsets belong in the crop.
    let captured_width = i64::from(captured_image.width());
    let captured_height = i64::from(captured_image.height());
    let inner_error = (captured_width - i64::from(inner_size.width)).abs()
        + (captured_height - i64::from(inner_size.height)).abs();
    let outer_error = (captured_width - i64::from(outer_size.width)).abs()
        + (captured_height - i64::from(outer_size.height)).abs();
    let (content_offset_x, content_offset_y) = if inner_error <= outer_error {
        (0.0, 0.0)
    } else {
        (
            f64::from(inner_position.x - outer_position.x),
            f64::from(inner_position.y - outer_position.y),
        )
    };
    let x = (content_offset_x + left * scale).round().max(0.0) as u32;
    let y = (content_offset_y + top * scale).round().max(0.0) as u32;
    let requested_width = (width * scale).round().max(1.0) as u32;
    let requested_height = (height * scale).round().max(1.0) as u32;
    let crop_width = requested_width.min(captured_image.width().saturating_sub(x));
    let crop_height = requested_height.min(captured_image.height().saturating_sub(y));
    if crop_width == 0 || crop_height == 0 {
        return Err(PlethoraError::InvalidInput(
            "Screenshot region is outside the app window".to_string(),
        ));
    }

    let image = convert_xcap_image(captured_image)?;
    let cropped = image::imageops::crop_imm(&image, x, y, crop_width, crop_height).to_image();
    encode_rgba_image(cropped)
}

#[cfg(feature = "screenshot")]
fn encode_image(image: xcap::image::ImageBuffer<xcap::image::Rgba<u8>, Vec<u8>>) -> Result<String> {
    encode_rgba_image(convert_xcap_image(image)?)
}

#[cfg(feature = "screenshot")]
fn convert_xcap_image(
    image: xcap::image::ImageBuffer<xcap::image::Rgba<u8>, Vec<u8>>,
) -> Result<image::RgbaImage> {
    let width = image.width();
    let height = image.height();
    let raw_data = image.into_raw();

    image::ImageBuffer::from_raw(width, height, raw_data)
        .ok_or_else(|| PlethoraError::Internal("Failed to create image buffer".to_string()))
}

#[cfg(feature = "screenshot")]
fn encode_rgba_image(image: image::RgbaImage) -> Result<String> {
    let mut buffer = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgba8(image);

    dynamic_image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageOutputFormat::Png)
        .map_err(|err| PlethoraError::Internal(format!("Failed to encode screenshot: {err}")))?;
    Ok(general_purpose::STANDARD.encode(buffer))
}

#[cfg(feature = "screenshot")]
#[derive(Debug, serde::Serialize)]
pub struct ScreenInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f32,
    pub is_primary: bool,
}
