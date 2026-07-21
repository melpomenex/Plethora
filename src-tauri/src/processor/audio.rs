//! Audiobook (audio file) processing.
//!
//! Today this module is focused on one job: extracting embedded cover art from
//! the common audiobook container formats (MP4/M4B/M4A `covr` atom, MP3 ID3v2
//! `APIC` frame, FLAC `METADATA_BLOCK_PICTURE`, Vorbis Comments in OGG/Opus) so
//! that audiobook documents display a cover in the Documents grid and the
//! `AudiobookViewer`.
//!
//! This is intentionally an in-process, pure-Rust implementation backed by
//! [`lofty`]. The previous extractor shelled out to a system `ffmpeg`, which is
//! not bundled on any platform and is unreachable on Android (where
//! [`crate::utils::ffmpeg::resolve_ffmpeg_path`] only checks Homebrew paths).
//! That left audiobooks with no cover on mobile — see the `audiobook-cover-extraction`
//! OpenSpec change for the full background.

use std::path::Path;

use base64::{engine::general_purpose, Engine as _};
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;

use crate::error::Result;

/// Maximum edge length (in pixels) for an extracted cover. Covers larger than
/// this are downscaled before being persisted, both to keep the SQLite
/// `cover_image_url` column small and to match the on-screen tile size. M4B
/// audiobooks frequently embed 1000×1000+ JPEGs, which would otherwise bloat
/// the database and the frontend memory.
const COVER_MAX_EDGE: u32 = 512;

/// Extract embedded cover art from an audio file as a `(data_url, mime)` pair.
///
/// Returns `Ok(None)` when the file has no embedded cover (e.g. WAV, or an MP3
/// without an `APIC` frame) — the caller is then expected to fall back to an
/// online cover lookup. Any parse error is logged at `warn` level and also
/// yields `None`, so one malformed file can never abort a batch import.
pub fn extract_audio_cover_data_url(file_path: &str) -> Result<Option<(String, String)>> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Ok(None);
    }

    // Read the file and probe its format. The three steps return different
    // error types (`Probe::open` and `read()` are `lofty::Result`, while
    // `guess_file_type()` is `io::Result` because it only inspects magic
    // bytes), so each is matched separately and any failure simply yields
    // "no cover" rather than aborting the import.
    let probe = match Probe::open(path) {
        Ok(probe) => probe,
        Err(e) => {
            tracing::warn!("Failed to open audio file for {file_path}: {e}");
            return Ok(None);
        }
    };
    let probe = match probe.guess_file_type() {
        Ok(probe) => probe,
        Err(e) => {
            tracing::warn!("Failed to probe audio format for {file_path}: {e}");
            return Ok(None);
        }
    };
    let tagged_file = match probe.read() {
        Ok(file) => file,
        Err(e) => {
            tracing::warn!("Failed to parse audio metadata for {file_path}: {e}");
            return Ok(None);
        }
    };

    // Prefer the format's primary tag (ID3v2 for MP3, ILST for MP4, etc.), then
    // fall back to the first available tag. Some OGG/FLAC files only expose
    // their pictures through a secondary tag.
    let pictures: &[Picture] = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .map(|tag| tag.pictures())
        .unwrap_or(&[]);

    if pictures.is_empty() {
        return Ok(None);
    }

    // Pick the front cover if present; otherwise the first picture. We avoid
    // icons (`OtherIcon`) and prefer an actual cover image, but if only an
    // `Other`-typed picture exists we still use it — better than no cover.
    let cover = pictures
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| {
            pictures
                .iter()
                .find(|p| p.pic_type() != PictureType::OtherIcon)
        })
        .or_else(|| pictures.first());

    let Some(cover) = cover else {
        return Ok(None);
    };

    let mime = cover
        .mime_type()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| sniff_mime(cover.data()).to_string());

    let bytes = downscale_if_needed(cover.data(), &mime);

    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(Some((format!("data:{mime};base64,{encoded}"), mime)))
}

/// Sniff a MIME type from the cover's magic bytes. Used as a fallback when the
/// tag doesn't carry a MIME (e.g. some MP4 `covr` atoms are typed only by atom
/// sub-code, which lofty surfaces as `None`).
fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        // Same default the old ffmpeg-based extractor used.
        "image/jpeg"
    }
}

/// Downscale the cover so its longest edge is at most [`COVER_MAX_EDGE`]. If
/// the image is already small enough, or if it cannot be decoded (e.g. a
/// corrupted frame), the original bytes are returned unchanged so we never
/// throw away a usable cover just because the resizer choked on it.
fn downscale_if_needed(bytes: &[u8], mime: &str) -> Vec<u8> {
    // `image` doesn't decode WebP in 0.24 without an extra feature flag; leave
    // WebP (rare for embedded covers) untouched.
    if mime == "image/webp" {
        return bytes.to_vec();
    }

    let img = match image::load_from_memory(bytes) {
        Ok(img) => img,
        Err(e) => {
            tracing::warn!(
                "Cover bytes could not be decoded for resize (mime={mime}); using original: {e}"
            );
            return bytes.to_vec();
        }
    };

    let (w, h) = (img.width(), img.height());
    let longest = w.max(h);
    if longest <= COVER_MAX_EDGE {
        return bytes.to_vec();
    }

    let resized = img.thumbnail(COVER_MAX_EDGE, COVER_MAX_EDGE);

    // Re-encode in the source format so the persisted MIME stays accurate.
    let format = match mime {
        "image/png" => image::ImageFormat::Png,
        _ => image::ImageFormat::Jpeg,
    };

    let mut buf = std::io::Cursor::new(Vec::with_capacity(32 * 1024));
    if let Err(e) = image::DynamicImage::write_to(&resized, &mut buf, format) {
        tracing::warn!("Failed to re-encode downscaled cover; using original: {e}");
        return bytes.to_vec();
    }
    buf.into_inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_mime_recognizes_common_formats() {
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(&[0x89, 0x50, 0x4E, 0x47, 0x0D]), "image/png");
        assert_eq!(sniff_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp");
        assert_eq!(sniff_mime(&[]), "image/jpeg"); // default
    }

    #[test]
    fn missing_file_returns_none() {
        let result = extract_audio_cover_data_url("/nonexistent/path/to/audio.m4b").unwrap();
        assert!(result.is_none());
    }
}
