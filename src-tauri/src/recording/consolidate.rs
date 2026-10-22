//! Consolidates rolling capture parts into one playable media file.
//!
//! Capture writes bounded parts under `parts/part_NNNNNN.bin`. Playback and
//! transcription need a single seekable file, so finalize joins the parts into
//! `audio.wav` for PCM captures (Android/iOS WAV parts, or raw `pcm16le`
//! parts) and `audio.webm`/`audio.m4a` for the fragmented containers that
//! `MediaRecorder` emits on desktop. Parts are left untouched for recovery.

use super::assets::{managed_recording_root, safe_resolve_recording_path};
use super::recovery::{ManifestPartEntry, RecordingManifest};
use crate::models::recording_session::SessionOperationError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, SessionOperationError>;

fn unavailable() -> SessionOperationError {
    SessionOperationError::source_unavailable()
}

const WAV_HEADER_LEN: u64 = 44;
const COPY_BUF_LEN: usize = 64 * 1024;

/// A single playable file produced from capture parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsolidatedMedia {
    /// Path relative to the session's managed root (e.g. `audio.wav`).
    pub relative_path: String,
    pub mime: String,
    pub byte_length: i64,
    pub sha256: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PcmFormat {
    sample_rate: u32,
    channels: u16,
}

impl PcmFormat {
    fn byte_rate(self) -> u64 {
        self.sample_rate as u64 * self.channels as u64 * 2
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PartLayout {
    /// PCM samples stored in `[offset, offset + len)`.
    Pcm {
        offset: u64,
        len: u64,
        format: PcmFormat,
    },
    /// Whole-file fragment of a compressed container.
    Container {
        mime: String,
        extension: &'static str,
    },
}

/// Joins a finalized capture's parts into one playable file inside the managed
/// root and returns its metadata. Returns `None` when the parts are not a
/// format this module can join safely.
pub fn consolidate_capture_media(
    data_dir: &Path,
    session_id: &str,
    manifest: &RecordingManifest,
) -> Result<Option<ConsolidatedMedia>> {
    if !manifest.finalized {
        return Ok(None);
    }
    let Some(layouts) = collect_layouts(data_dir, session_id, manifest)? else {
        return Ok(None);
    };
    let root = managed_recording_root(data_dir, session_id)?;
    match combine_parts(&root, &layouts, &manifest.parts) {
        Ok(media) => Ok(media),
        Err(error) => {
            tracing::warn!("[recording] failed to consolidate session {session_id}: {error}");
            Ok(None)
        }
    }
}

/// Writes all PCM parts to an arbitrary output path (used by partial-recording
/// export, which must also work before finalize). Returns the byte count.
pub fn write_capture_media_to(
    data_dir: &Path,
    session_id: &str,
    manifest: &RecordingManifest,
    output_path: &Path,
) -> Result<Option<u64>> {
    let Some(layouts) = collect_layouts(data_dir, session_id, manifest)? else {
        return Ok(None);
    };
    if !layouts
        .iter()
        .all(|(_, layout)| matches!(layout, PartLayout::Pcm { .. }))
    {
        return Ok(None);
    }
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|_| unavailable())?;
        }
    }
    match write_pcm_wav_to(output_path, &layouts) {
        Ok(Some((written, _, _))) => Ok(Some(written)),
        _ => Ok(None),
    }
}

/// Points the session's capture media asset at the consolidated file.
///
/// `state` is `ready` for a clean join and `partial` when verified parts had
/// gaps, so the UI never claims a complete recording it does not have.
pub async fn apply_consolidated_media(
    pool: &SqlitePool,
    session_id: &str,
    asset_id: &str,
    media: &ConsolidatedMedia,
    state: &str,
) -> Result<()> {
    let relative_path = format!("recordings/{session_id}/{}", media.relative_path);
    sqlx::query(
        "UPDATE media_assets
         SET relative_path = ?2, mime = ?3, byte_length = ?4, sha256 = ?5, duration_ms = ?6, state = ?7
         WHERE id = ?1 AND session_id = ?8",
    )
    .bind(asset_id)
    .bind(&relative_path)
    .bind(&media.mime)
    .bind(media.byte_length)
    .bind(&media.sha256)
    .bind(media.duration_ms)
    .bind(state)
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(SessionOperationError::from)?;
    Ok(())
}

fn collect_layouts(
    data_dir: &Path,
    session_id: &str,
    manifest: &RecordingManifest,
) -> Result<Option<Vec<(PathBuf, PartLayout)>>> {
    if manifest.parts.is_empty() {
        return Ok(None);
    }
    let mut parts = manifest.parts.clone();
    parts.sort_by_key(|part| part.sequence);

    let mut layouts = Vec::with_capacity(parts.len());
    for part in &parts {
        let path = safe_resolve_recording_path(data_dir, session_id, &part.relative_path)?;
        let len = fs::metadata(&path).map_err(|_| unavailable())?.len();
        if len == 0 {
            return Ok(None);
        }
        let layout = match inspect_part(&path, len, part, manifest) {
            Ok(Some(layout)) => layout,
            // Unknown or malformed part: never guess at audio layout.
            _ => return Ok(None),
        };
        layouts.push((path, layout));
    }
    Ok(Some(layouts))
}

fn combine_parts(
    root: &Path,
    layouts: &[(PathBuf, PartLayout)],
    parts: &[ManifestPartEntry],
) -> std::io::Result<Option<ConsolidatedMedia>> {
    let all_pcm = layouts
        .iter()
        .all(|(_, layout)| matches!(layout, PartLayout::Pcm { .. }));
    if all_pcm {
        return write_pcm_wav(root, layouts);
    }

    let all_containers = layouts
        .iter()
        .all(|(_, layout)| matches!(layout, PartLayout::Container { .. }));
    if !all_containers {
        return Ok(None);
    }

    let mut expected: Option<(String, &'static str)> = None;
    for (_, layout) in layouts {
        let PartLayout::Container { mime, extension } = layout else {
            return Ok(None);
        };
        match &expected {
            Some((expected_mime, expected_ext)) => {
                if expected_mime != mime || expected_ext != extension {
                    return Ok(None);
                }
            }
            None => expected = Some((mime.clone(), extension)),
        }
    }
    let Some((mime, extension)) = expected else {
        return Ok(None);
    };

    write_container(root, layouts, parts, &mime, extension)
}

fn write_pcm_wav(
    root: &Path,
    layouts: &[(PathBuf, PartLayout)],
) -> std::io::Result<Option<ConsolidatedMedia>> {
    let target = root.join("audio.wav");
    let Some((written, sha256, duration_ms)) = write_pcm_wav_to(&target, layouts)? else {
        return Ok(None);
    };
    Ok(Some(ConsolidatedMedia {
        relative_path: "audio.wav".to_string(),
        mime: "audio/wav".to_string(),
        byte_length: written as i64,
        sha256,
        duration_ms,
    }))
}

/// Streams PCM part payloads into one WAV file with a single header.
/// Returns `(bytes_written, sha256, duration_ms)`.
fn write_pcm_wav_to(
    target: &Path,
    layouts: &[(PathBuf, PartLayout)],
) -> std::io::Result<Option<(u64, String, i64)>> {
    let mut format: Option<PcmFormat> = None;
    let mut data_len: u64 = 0;
    for (_, layout) in layouts {
        let PartLayout::Pcm {
            len,
            format: part_format,
            ..
        } = layout
        else {
            return Ok(None);
        };
        match format {
            Some(expected) if expected != *part_format => return Ok(None),
            None => format = Some(*part_format),
            _ => {}
        }
        data_len = match data_len.checked_add(*len) {
            Some(total) => total,
            None => return Ok(None),
        };
    }

    let Some(format) = format else {
        return Ok(None);
    };
    if data_len == 0 || data_len > u32::MAX as u64 - 36 || format.byte_rate() == 0 {
        return Ok(None);
    }

    let tmp = temp_path(target);
    let header = build_wav_header(data_len, format);
    let mut hasher = Sha256::new();
    let mut written: u64 = 0;

    let copy_result = (|| -> std::io::Result<()> {
        let mut out = File::create(&tmp)?;
        out.write_all(&header)?;
        hasher.update(&header);
        written += header.len() as u64;

        let mut buffer = vec![0u8; COPY_BUF_LEN];
        for (path, layout) in layouts {
            let PartLayout::Pcm { offset, len, .. } = layout else {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "mixed part layouts",
                ));
            };
            let mut input = File::open(path)?;
            input.seek(SeekFrom::Start(*offset))?;
            let mut remaining = *len;
            while remaining > 0 {
                let take = remaining.min(buffer.len() as u64) as usize;
                let read = input.read(&mut buffer[..take])?;
                if read == 0 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "part ended before its declared data length",
                    ));
                }
                out.write_all(&buffer[..read])?;
                hasher.update(&buffer[..read]);
                written += read as u64;
                remaining -= read as u64;
            }
        }
        out.sync_all()
    })();

    if let Err(error) = copy_result {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }

    if let Err(error) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    sync_dir(target.parent().unwrap_or(target));

    let duration_ms = (data_len * 1000 / format.byte_rate()) as i64;
    Ok(Some((written, hex::encode(hasher.finalize()), duration_ms)))
}

fn write_container(
    root: &Path,
    layouts: &[(PathBuf, PartLayout)],
    parts: &[ManifestPartEntry],
    mime: &str,
    extension: &str,
) -> std::io::Result<Option<ConsolidatedMedia>> {
    let target = root.join(format!("audio.{extension}"));
    let tmp = temp_path(&target);
    let mut hasher = Sha256::new();
    let mut written: u64 = 0;
    let mut buffer = vec![0u8; COPY_BUF_LEN];

    let copy_result = (|| -> std::io::Result<()> {
        let mut out = File::create(&tmp)?;
        for (path, _) in layouts {
            let mut input = File::open(path)?;
            loop {
                let read = input.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                out.write_all(&buffer[..read])?;
                hasher.update(&buffer[..read]);
                written += read as u64;
            }
        }
        out.sync_all()
    })();

    if let Err(error) = copy_result {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    if written == 0 {
        let _ = fs::remove_file(&tmp);
        return Ok(None);
    }
    if let Err(error) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    sync_dir(root);

    let duration_ms: i64 = parts.iter().map(|part| part.duration_ms.max(0)).sum();
    Ok(Some(ConsolidatedMedia {
        relative_path: format!("audio.{extension}"),
        mime: mime.to_string(),
        byte_length: written as i64,
        sha256: hex::encode(hasher.finalize()),
        duration_ms,
    }))
}

/// Inspects one part without reading its audio payload.
fn inspect_part(
    path: &Path,
    file_len: u64,
    part: &ManifestPartEntry,
    manifest: &RecordingManifest,
) -> std::io::Result<Option<PartLayout>> {
    let hint = PartHint::from_part(part);
    let mut file = File::open(path)?;

    let mut magic = [0u8; 12];
    if file_len >= 12 && file.read_exact(&mut magic).is_ok() {
        if &magic[0..4] == b"RIFF" && &magic[8..12] == b"WAVE" {
            // A RIFF/WAVE part must parse cleanly; never fall back to raw PCM.
            return parse_wav(&mut file, file_len).map(|parsed| {
                parsed.map(|(offset, len, format)| PartLayout::Pcm {
                    offset,
                    len,
                    format,
                })
            });
        }
    }

    if hint.is_pcm() {
        let format = hint
            .format()
            .or_else(|| manifest_pcm_format(manifest, &hint));
        let Some(format) = format else {
            return Ok(None);
        };
        return Ok(Some(PartLayout::Pcm {
            offset: 0,
            len: file_len,
            format,
        }));
    }

    let Some((mime, extension)) = hint.container() else {
        return Ok(None);
    };
    Ok(Some(PartLayout::Container { mime, extension }))
}

/// Parses the `fmt ` and `data` chunks of a WAV file.
fn parse_wav(file: &mut File, file_len: u64) -> std::io::Result<Option<(u64, u64, PcmFormat)>> {
    let mut position: u64 = 12;
    let mut format: Option<PcmFormat> = None;
    let mut data: Option<(u64, u64)> = None;

    while position.saturating_add(8) <= file_len {
        file.seek(SeekFrom::Start(position))?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header)?;
        let size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as u64;
        let body = position + 8;
        let available = file_len.saturating_sub(body);

        if &header[0..4] == b"fmt " {
            if size < 16 || available < 16 {
                return Ok(None);
            }
            let mut fmt = [0u8; 16];
            file.seek(SeekFrom::Start(body))?;
            file.read_exact(&mut fmt)?;
            let audio_format = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let sample_rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
            let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
            if audio_format != 1 || channels == 0 || sample_rate == 0 || bits != 16 {
                return Ok(None);
            }
            format = Some(PcmFormat {
                sample_rate,
                channels,
            });
        } else if &header[0..4] == b"data" {
            let len = if size == 0 || size == u32::MAX as u64 || size > available {
                available
            } else {
                size
            };
            data = Some((body, len));
            // Streaming WAVs can advertise an unknown size; the rest of the
            // file is the payload.
            if size == 0 || size == u32::MAX as u64 {
                break;
            }
        }

        let advance = size.saturating_add(size & 1);
        position = match body.checked_add(advance) {
            Some(next) => next,
            None => break,
        };
    }

    Ok(match (format, data) {
        (Some(format), Some((offset, len))) if len > 0 => Some((offset, len, format)),
        _ => None,
    })
}

fn manifest_pcm_format(manifest: &RecordingManifest, hint: &PartHint) -> Option<PcmFormat> {
    let from_manifest = match (manifest.sample_rate, manifest.channels) {
        (Some(sample_rate), Some(channels)) if sample_rate > 0 && channels > 0 => Some(PcmFormat {
            sample_rate,
            channels,
        }),
        _ => None,
    };
    from_manifest.or_else(|| hint.format())
}

/// Parsed `formatJson` hints for one part.
struct PartHint {
    encoding: Option<String>,
    mime: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
}

impl PartHint {
    fn from_part(part: &ManifestPartEntry) -> Self {
        let value: Option<serde_json::Value> = serde_json::from_str(&part.format_json).ok();
        let get_str = |key: &str| {
            value
                .as_ref()
                .and_then(|json| json.get(key))
                .and_then(|json| json.as_str())
                .map(|text| text.to_string())
        };
        let get_u64 = |key: &str| {
            value
                .as_ref()
                .and_then(|json| json.get(key))
                .and_then(|json| json.as_u64())
        };
        Self {
            encoding: get_str("encoding"),
            mime: get_str("mime"),
            sample_rate: get_u64("sampleRate").and_then(|value| u32::try_from(value).ok()),
            channels: get_u64("channels").and_then(|value| u16::try_from(value).ok()),
        }
    }

    fn is_pcm(&self) -> bool {
        self.encoding
            .as_deref()
            .is_some_and(|encoding| encoding.eq_ignore_ascii_case("pcm16le"))
    }

    fn format(&self) -> Option<PcmFormat> {
        match (self.sample_rate, self.channels) {
            (Some(sample_rate), Some(channels)) if sample_rate > 0 && channels > 0 => {
                Some(PcmFormat {
                    sample_rate,
                    channels,
                })
            }
            _ => None,
        }
    }

    fn container(&self) -> Option<(String, &'static str)> {
        let mime = self
            .mime
            .as_deref()?
            .split(';')
            .next()?
            .trim()
            .to_ascii_lowercase();
        match mime.as_str() {
            // MediaRecorder timeslice parts: the first fragment carries the
            // container init segment and later fragments are media segments,
            // so bytewise concatenation restores one stream.
            "audio/webm" | "video/webm" => Some(("audio/webm".to_string(), "webm")),
            "audio/mp4" | "audio/x-m4a" | "audio/m4a" => Some(("audio/mp4".to_string(), "m4a")),
            _ => None,
        }
    }
}

fn build_wav_header(data_len: u64, format: PcmFormat) -> Vec<u8> {
    let byte_rate = format.byte_rate() as u32;
    let block_align = format.channels.saturating_mul(2);
    let mut header = Vec::with_capacity(WAV_HEADER_LEN as usize);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&16u32.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&format.channels.to_le_bytes());
    header.extend_from_slice(&format.sample_rate.to_le_bytes());
    header.extend_from_slice(&byte_rate.to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&16u16.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&(data_len as u32).to_le_bytes());
    debug_assert_eq!(header.len() as u64, WAV_HEADER_LEN);
    header
}

fn temp_path(target: &Path) -> PathBuf {
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    target.with_extension(format!("tmp.{}", &nonce[..8]))
}

fn sync_dir(dir: &Path) {
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::init_recording_manifest;
    use crate::recording::recovery::write_manifest_atomic;
    use tempfile::TempDir;

    fn wav_part(samples: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
        let format = PcmFormat {
            sample_rate,
            channels,
        };
        let mut bytes = build_wav_header(samples.len() as u64, format);
        bytes.extend_from_slice(samples);
        bytes
    }

    fn write_part(
        root: &Path,
        sequence: u32,
        bytes: &[u8],
        format_json: &str,
    ) -> ManifestPartEntry {
        let parts_dir = root.join("parts");
        fs::create_dir_all(&parts_dir).unwrap();
        let name = format!("part_{sequence:06}.bin");
        fs::write(parts_dir.join(&name), bytes).unwrap();
        ManifestPartEntry {
            sequence: sequence as i64,
            relative_path: format!("parts/{name}"),
            byte_length: bytes.len() as i64,
            sha256: crate::recording::compute_sha256(bytes),
            start_ms: sequence as i64 * 5000,
            duration_ms: 5000,
            format_json: format_json.to_string(),
            committed_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn joins_pcm_wav_parts_into_one_wav() {
        let dir = TempDir::new().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let asset_id = uuid::Uuid::new_v4().to_string();
        let root = managed_recording_root(dir.path(), &session_id).unwrap();

        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "ep-1",
            "audio/wav",
            Some(16000),
            Some(1),
        )
        .unwrap();
        let first_samples: Vec<u8> = (0..3_200u32).map(|i| (i % 251) as u8).collect();
        let second_samples: Vec<u8> = (0..1_600u32).map(|i| (i % 241) as u8).collect();
        let first = wav_part(&first_samples, 16000, 1);
        let second = wav_part(&second_samples, 16000, 1);
        let format_json = "{\"sampleRate\":16000,\"channels\":1,\"encoding\":\"pcm16le\"}";
        manifest
            .parts
            .push(write_part(&root, 0, &first, format_json));
        manifest
            .parts
            .push(write_part(&root, 1, &second, format_json));
        manifest.finalized = true;
        write_manifest_atomic(&root, &manifest).unwrap();

        let media = consolidate_capture_media(dir.path(), &session_id, &manifest)
            .unwrap()
            .expect("consolidated media");

        assert_eq!(media.relative_path, "audio.wav");
        assert_eq!(media.mime, "audio/wav");
        assert_eq!(media.byte_length, (WAV_HEADER_LEN + 4_800) as i64);
        assert_eq!(media.duration_ms, 150); // 4800 bytes at 32000 B/s

        let audio = fs::read(root.join("audio.wav")).unwrap();
        assert_eq!(&audio[0..4], b"RIFF");
        assert_eq!(&audio[8..12], b"WAVE");
        assert_eq!(
            u32::from_le_bytes([audio[40], audio[41], audio[42], audio[43]]),
            4_800
        );
        assert_eq!(&audio[44..3_200 + 44], &first_samples[..]);
        assert_eq!(&audio[3_200 + 44..], &second_samples[..]);
        assert_eq!(media.sha256, crate::recording::compute_sha256(&audio));
    }

    #[test]
    fn joins_raw_pcm_parts_using_format_json() {
        let dir = TempDir::new().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let asset_id = uuid::Uuid::new_v4().to_string();
        let root = managed_recording_root(dir.path(), &session_id).unwrap();

        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "ep-1",
            "audio/wav",
            None,
            None,
        )
        .unwrap();
        let format_json = "{\"sampleRate\":8000,\"channels\":2,\"encoding\":\"pcm16le\"}";
        manifest
            .parts
            .push(write_part(&root, 0, &[7u8, 0, 8, 0], format_json));
        manifest
            .parts
            .push(write_part(&root, 1, &[9u8, 0], format_json));
        manifest.finalized = true;
        write_manifest_atomic(&root, &manifest).unwrap();

        let media = consolidate_capture_media(dir.path(), &session_id, &manifest)
            .unwrap()
            .expect("consolidated media");
        let audio = fs::read(root.join("audio.wav")).unwrap();
        let sample_rate = u32::from_le_bytes([audio[24], audio[25], audio[26], audio[27]]);
        let channels = u16::from_le_bytes([audio[22], audio[23]]);
        assert_eq!(sample_rate, 8000);
        assert_eq!(channels, 2);
        assert_eq!(&audio[44..], &[7u8, 0, 8, 0, 9, 0]);
    }

    #[test]
    fn concatenates_fragmented_container_parts() {
        let dir = TempDir::new().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let asset_id = uuid::Uuid::new_v4().to_string();
        let root = managed_recording_root(dir.path(), &session_id).unwrap();

        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "ep-1",
            "audio/webm",
            None,
            None,
        )
        .unwrap();
        let format_json = "{\"mime\":\"audio/webm;codecs=opus\"}";
        manifest
            .parts
            .push(write_part(&root, 0, b"EBML-init", format_json));
        manifest
            .parts
            .push(write_part(&root, 1, b"cluster-1", format_json));
        manifest.finalized = true;
        write_manifest_atomic(&root, &manifest).unwrap();

        let media = consolidate_capture_media(dir.path(), &session_id, &manifest)
            .unwrap()
            .expect("consolidated media");
        assert_eq!(media.relative_path, "audio.webm");
        assert_eq!(media.mime, "audio/webm");
        assert_eq!(media.byte_length, 18);
        assert_eq!(media.duration_ms, 10_000);
        assert_eq!(
            fs::read(root.join("audio.webm")).unwrap(),
            b"EBML-initcluster-1"
        );
    }

    #[test]
    fn skips_unfinalized_or_mixed_parts() {
        let dir = TempDir::new().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let asset_id = uuid::Uuid::new_v4().to_string();
        let root = managed_recording_root(dir.path(), &session_id).unwrap();

        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "ep-1",
            "audio/wav",
            Some(16000),
            Some(1),
        )
        .unwrap();
        manifest.parts.push(write_part(
            &root,
            0,
            &wav_part(&[1, 0], 16000, 1),
            "{\"sampleRate\":16000,\"channels\":1,\"encoding\":\"pcm16le\"}",
        ));
        manifest
            .parts
            .push(write_part(&root, 1, b"webm", "{\"mime\":\"audio/webm\"}"));
        manifest.finalized = true;
        write_manifest_atomic(&root, &manifest).unwrap();
        assert!(
            consolidate_capture_media(dir.path(), &session_id, &manifest)
                .unwrap()
                .is_none()
        );

        manifest.parts.truncate(1);
        manifest.finalized = false;
        write_manifest_atomic(&root, &manifest).unwrap();
        assert!(
            consolidate_capture_media(dir.path(), &session_id, &manifest)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn exports_pcm_parts_to_an_arbitrary_wav_path() {
        let dir = TempDir::new().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let asset_id = uuid::Uuid::new_v4().to_string();
        let root = managed_recording_root(dir.path(), &session_id).unwrap();

        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "ep-1",
            "audio/wav",
            Some(16000),
            Some(1),
        )
        .unwrap();
        manifest.parts.push(write_part(
            &root,
            0,
            &wav_part(&[1, 0, 2, 0], 16000, 1),
            "{\"sampleRate\":16000,\"channels\":1,\"encoding\":\"pcm16le\"}",
        ));
        write_manifest_atomic(&root, &manifest).unwrap();

        let output = dir.path().join("export/session.wav");
        let written = write_capture_media_to(dir.path(), &session_id, &manifest, &output)
            .unwrap()
            .expect("exported bytes");
        let bytes = fs::read(&output).unwrap();
        assert_eq!(written, bytes.len() as u64);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[44..], &[1, 0, 2, 0]);
    }
}
