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
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use serde::Serialize;

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

/// Tags and properties probed from one audio file for multi-file audiobook
/// import. Every field degrades to `None` — probing failures (unsupported
/// codec such as WMA, corrupt file) must never fail an import.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadataProbe {
    pub duration_sec: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
}

/// Probe tags and duration from an audio file via lofty (in-process, works on
/// Android where no ffmpeg sidecar exists). Like the cover extractor, any
/// parse failure logs at `warn` and yields default (all-`None`) metadata.
pub fn probe_audio_metadata(file_path: &str) -> AudioMetadataProbe {
    let path = Path::new(file_path);
    if !path.exists() {
        return AudioMetadataProbe::default();
    }

    let probe = match Probe::open(path) {
        Ok(probe) => probe,
        Err(e) => {
            tracing::warn!("Failed to open audio file for {file_path}: {e}");
            return AudioMetadataProbe::default();
        }
    };
    let probe = match probe.guess_file_type() {
        Ok(probe) => probe,
        Err(e) => {
            tracing::warn!("Failed to probe audio format for {file_path}: {e}");
            return AudioMetadataProbe::default();
        }
    };
    let tagged_file = match probe.read() {
        Ok(file) => file,
        Err(e) => {
            tracing::warn!("Failed to parse audio metadata for {file_path}: {e}");
            return AudioMetadataProbe::default();
        }
    };

    let duration_raw = tagged_file.properties().duration().as_secs_f64();
    let duration_sec = if duration_raw.is_finite() && duration_raw > 0.0 {
        Some(duration_raw)
    } else {
        None
    };

    let mut out = AudioMetadataProbe {
        duration_sec,
        ..Default::default()
    };

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .cloned();
    if let Some(tag) = tag {
        use lofty::tag::ItemKey;
        let text = |key: ItemKey| {
            tag.get_string(key)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        out.title = text(ItemKey::TrackTitle);
        out.artist = text(ItemKey::TrackArtist);
        out.album = text(ItemKey::AlbumTitle);
        out.album_artist = text(ItemKey::AlbumArtist);

        // Track/disc numbers arrive as "3" or "3/12".
        let number = |key: ItemKey| {
            text(key).and_then(|s| {
                s.split('/')
                    .next()
                    .and_then(|head| head.trim().parse::<u32>().ok())
            })
        };
        out.track_number = number(ItemKey::TrackNumber);
        out.disc_number = number(ItemKey::DiscNumber);
    }

    out
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

    #[test]
    fn probe_missing_file_degrades_to_defaults() {
        let probe = probe_audio_metadata("/nonexistent/path/to/part.mp3");
        assert_eq!(probe.duration_sec, None);
        assert_eq!(probe.title, None);
        assert_eq!(probe.track_number, None);
    }

    #[test]
    fn probe_unparseable_file_degrades_to_defaults() {
        // A non-audio file: lofty fails the probe and we must get defaults,
        // never an error (import correctness never depends on probing).
        let dir = std::env::temp_dir().join("plethora-audio-probe-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("not-audio.mp3");
        std::fs::write(&file, b"this is definitely not an audio file").unwrap();
        let probe = probe_audio_metadata(file.to_string_lossy().as_ref());
        assert_eq!(probe.duration_sec, None);
        assert_eq!(probe.title, None);
        let _ = std::fs::remove_file(&file);
    }
}
