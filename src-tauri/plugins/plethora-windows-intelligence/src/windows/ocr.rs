//! Windows System OCR inference via WinRT TextRecognizer.

use crate::{Error, WindowsOcrRecognizeResult, PACKAGE_IDENTITY_MISSING, UNSUPPORTED_OS};
use crate::winrt::native_bridge;

use super::{current_package_identity, meets_ai_os_requirement, MIN_WIN11_AI_BUILD};

/// Maximum encoded image payload accepted before WinRT decode (25 MB).
pub const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

fn preflight_ocr() -> Result<(), Error> {
    if current_package_identity().is_none() {
        return Err(Error::new(
            PACKAGE_IDENTITY_MISSING,
            "Windows System OCR requires package identity (sparse MSIX registration)",
        ));
    }
    if !meets_ai_os_requirement() {
        return Err(Error::new(
            UNSUPPORTED_OS,
            format!("Windows 11 build {MIN_WIN11_AI_BUILD}+ is required for Windows System OCR"),
        ));
    }
    Ok(())
}

pub fn recognize(image_data: &[u8]) -> Result<WindowsOcrRecognizeResult, Error> {
    preflight_ocr()?;
    if image_data.is_empty() {
        return Err(Error::new("invalid_argument", "Empty image payload"));
    }
    if image_data.len() > MAX_IMAGE_BYTES {
        return Err(Error::new(
            "invalid_argument",
            format!("Image exceeds {MAX_IMAGE_BYTES} byte limit"),
        ));
    }

    let json = native_bridge::recognize_image(image_data).map_err(|msg| {
        if msg.contains("package") {
            Error::new(PACKAGE_IDENTITY_MISSING, msg)
        } else {
            Error::new("ocr_failed", msg)
        }
    })?;

    let parsed: WindowsOcrRecognizeResult = serde_json::from_str(&json).map_err(|e| {
        Error::new(
            "ocr_failed",
            format!("Failed to parse OCR bridge response: {e}"),
        )
    })?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_payload() {
        let err = recognize(&[]).expect_err("empty");
        assert_eq!(err.code, "invalid_argument");
    }
}
