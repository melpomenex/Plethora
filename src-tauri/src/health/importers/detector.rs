//! Content-based deterministic format and wearable provider detection.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use crate::health::models::HealthProviderId;

use super::archive::SafeZipArchive;
use super::csv_reader::{detect_csv_delimiter, CsvStreamReader};
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, DetectionResult, ImportError,
};

#[derive(Debug, Clone)]
pub struct ImportInspection {
    pub file_name: String,
    pub extension: String,
    pub is_zip: bool,
    pub zip_paths: Vec<String>,
    pub zip_samples: Vec<(String, String)>,
    pub text_sample: String,
    pub magic_bytes: Vec<u8>,
    pub csv_headers: Vec<String>,
    pub csv_sample_rows: Vec<Vec<String>>,
}

pub fn inspect_file_for_detection(
    path: &Path,
    archive_limits: ArchiveSecurityLimits,
) -> Result<ImportInspection, ImportError> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
    let mut magic_buf = [0u8; 64];
    let n_magic = file
        .read(&mut magic_buf)
        .map_err(|e| ImportError::Io(e.to_string()))?;
    let magic_bytes = magic_buf[..n_magic].to_vec();
    let is_zip = magic_bytes.starts_with(b"PK\x03\x04") || magic_bytes.starts_with(b"PK\x05\x06");

    if is_zip {
        let mut archive = SafeZipArchive::open(path, archive_limits)?;
        let zip_paths: Vec<String> = archive
            .file_paths()
            .into_iter()
            .map(ToString::to_string)
            .collect();

        let mut zip_samples = Vec::new();
        let cancel = super::types::ImportCancellationToken::new();
        for info in archive.entries().to_vec() {
            if info.is_dir {
                continue;
            }
            let lower = info.normalized_path.to_ascii_lowercase();
            let interesting = lower.ends_with("sleep.csv")
                || lower.ends_with("sleeps.csv")
                || lower.ends_with("physiological_cycles.csv")
                || lower.ends_with("daily_sleep.csv")
                || lower.ends_with("daily_readiness.csv")
                || lower.ends_with("vitals.csv")
                || lower.contains("sleep") && (lower.ends_with(".csv") || lower.ends_with(".json"))
                || lower.ends_with("export.xml")
                || lower.contains("nightly_recovery");
            if interesting && zip_samples.len() < 8 {
                if let Ok(bytes) = read_entry_prefix(&mut archive, info.index, 16 * 1024, &cancel) {
                    if let Ok(text) = std::str::from_utf8(&bytes) {
                        zip_samples.push((info.normalized_path, text.to_string()));
                    }
                }
            }
        }

        return Ok(ImportInspection {
            file_name,
            extension,
            is_zip: true,
            zip_paths,
            zip_samples,
            text_sample: String::new(),
            magic_bytes,
            csv_headers: Vec::new(),
            csv_sample_rows: Vec::new(),
        });
    }

    drop(file);
    let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
    let mut reader = BufReader::new(file);
    let mut raw_sample = vec![0u8; 32 * 1024];
    let n = reader
        .read(&mut raw_sample)
        .map_err(|e| ImportError::Io(e.to_string()))?;
    raw_sample.truncate(n);
    let text_sample = String::from_utf8_lossy(&raw_sample).into_owned();

    let mut csv_headers = Vec::new();
    let mut csv_sample_rows = Vec::new();
    let trimmed = text_sample.trim_start_matches('\u{feff}').trim_start();
    let looks_like_text_csv = !trimmed.starts_with('<')
        && !trimmed.starts_with('{')
        && !trimmed.starts_with('[')
        && !magic_bytes.starts_with(b"PLHLTHV1")
        && (extension == "csv" || extension == "tsv" || extension == "txt" || trimmed.contains(','));

    if looks_like_text_csv && !trimmed.is_empty() {
        let delim = detect_csv_delimiter(&text_sample);
        let mut csv = CsvStreamReader::new(
            text_sample.as_bytes(),
            delim,
            StreamingParserLimits::default(),
        );
        if let Ok(Some(hdr)) = csv.next_row() {
            csv_headers = hdr;
            for _ in 0..4 {
                match csv.next_row() {
                    Ok(Some(row)) => csv_sample_rows.push(row),
                    _ => break,
                }
            }
        }
    }

    Ok(ImportInspection {
        file_name,
        extension,
        is_zip: false,
        zip_paths: Vec::new(),
        zip_samples: Vec::new(),
        text_sample,
        magic_bytes,
        csv_headers,
        csv_sample_rows,
    })
}

fn read_entry_prefix(
    archive: &mut SafeZipArchive,
    index: usize,
    max_bytes: usize,
    cancel: &super::types::ImportCancellationToken,
) -> Result<Vec<u8>, ImportError> {
    archive.stream_entry(index, cancel, |r| {
        let mut buf = vec![0u8; max_bytes];
        let mut total = 0;
        while total < max_bytes {
            let n = r.read(&mut buf[total..]).map_err(|e| ImportError::Io(e.to_string()))?;
            if n == 0 {
                break;
            }
            total += n;
        }
        buf.truncate(total);
        Ok(buf)
    })
}

pub fn detect_import_format(
    inspection: &ImportInspection,
    adapters: &[Box<dyn WearableImportAdapter>],
) -> DetectionResult {
    if inspection.magic_bytes.starts_with(b"PLHLTHV1")
        || inspection
            .file_name
            .to_ascii_lowercase()
            .ends_with(".plethora-health.enc")
    {
        return DetectionResult {
            confidence: DetectionConfidence::RecognizedUnsupported,
            primary: None,
            candidates: Vec::new(),
            file_kind: "encrypted_bundle".to_string(),
            is_archive: false,
            requires_csv_mapping: false,
            explanation: "This is a passphrase-protected Plethora health bundle (.plethora-health.enc). Use 'Import encrypted bundle' to decrypt and restore it.".to_string(),
        };
    }

    // Check for Android Health Connect internal SQLite backup ZIP
    if inspection.is_zip
        && inspection.zip_paths.iter().any(|p| {
            let lower = p.to_ascii_lowercase();
            lower.contains("health_connect") && (lower.ends_with(".db") || lower.ends_with(".sqlite"))
        })
    {
        return DetectionResult {
            confidence: DetectionConfidence::RecognizedUnsupported,
            primary: Some(DetectionCandidate {
                provider_id: HealthProviderId::AndroidHealthConnect,
                adapter_id: "android_health_connect_backup".to_string(),
                format_id: "health_connect_internal_sqlite".to_string(),
                format_label: "Android Health Connect Internal Backup".to_string(),
                confidence: DetectionConfidence::RecognizedUnsupported,
                score: 95,
                reasons: vec!["Archive contains an internal Android Health Connect SQLite database".to_string()],
            }),
            candidates: Vec::new(),
            file_kind: "zip".to_string(),
            is_archive: true,
            requires_csv_mapping: false,
            explanation: "Android Health Connect system backups use an internal OS-specific SQLite database rather than a portable interchange schema. Use Plethora's native Android Health Connect sync on Android, or export a portable .plethora-health.enc bundle from your Android device.".to_string(),
        };
    }

    // Check for workout-only FIT / GPX files (e.g. Suunto or Garmin workout FIT)
    if !inspection.is_zip
        && (inspection.extension == "fit"
            || inspection.magic_bytes.get(8..12) == Some(b".FIT")
            || inspection.extension == "gpx"
            || inspection.text_sample.contains("<gpx"))
    {
        return DetectionResult {
            confidence: DetectionConfidence::NoUsableSleepData,
            primary: None,
            candidates: Vec::new(),
            file_kind: inspection.extension.clone(),
            is_archive: false,
            requires_csv_mapping: false,
            explanation: "This file appears to be a workout/GPS track (.fit or .gpx), which does not contain sleep or overnight recovery records. For Suunto or Garmin sleep data, export your full account wellness archive or bridge through Apple Health / Health Connect.".to_string(),
        };
    }

    let mut candidates: Vec<DetectionCandidate> = adapters
        .iter()
        .filter_map(|adapter| adapter.detect(inspection))
        .collect();

    candidates.sort_by(|a, b| b.score.cmp(&a.score));

    if let Some(top) = candidates.first().cloned() {
        let second_close = candidates
            .get(1)
            .is_some_and(|second| top.score.saturating_sub(second.score) < 15);
        let confidence = if second_close {
            DetectionConfidence::Ambiguous
        } else {
            top.confidence
        };
        let explanation = if confidence == DetectionConfidence::Ambiguous {
            format!(
                "Multiple formats matched ({} and {}). Confirm which provider produced this export.",
                top.format_label,
                candidates[1].format_label
            )
        } else {
            top.reasons.join("; ")
        };
        return DetectionResult {
            confidence,
            primary: Some(top),
            candidates,
            file_kind: if inspection.is_zip {
                "zip".to_string()
            } else {
                inspection.extension.clone()
            },
            is_archive: inspection.is_zip,
            requires_csv_mapping: false,
            explanation,
        };
    }

    if !inspection.csv_headers.is_empty() {
        return DetectionResult {
            confidence: DetectionConfidence::Unknown,
            primary: None,
            candidates: Vec::new(),
            file_kind: "csv".to_string(),
            is_archive: false,
            requires_csv_mapping: true,
            explanation: "This CSV does not match a known wearable provider export. Map its columns below to import it.".to_string(),
        };
    }

    if inspection.is_zip
        && inspection
            .zip_paths
            .iter()
            .all(|p| {
                let l = p.to_ascii_lowercase();
                l.ends_with(".fit") || l.ends_with(".gpx") || l.ends_with(".tcx")
            })
    {
        return DetectionResult {
            confidence: DetectionConfidence::NoUsableSleepData,
            primary: None,
            candidates: Vec::new(),
            file_kind: "zip".to_string(),
            is_archive: true,
            requires_csv_mapping: false,
            explanation: "This archive contains only workout files (.fit/.gpx/.tcx) and no usable sleep or recovery records.".to_string(),
        };
    }

    DetectionResult {
        confidence: DetectionConfidence::Unknown,
        primary: None,
        candidates: Vec::new(),
        file_kind: if inspection.is_zip {
            "zip".to_string()
        } else {
            inspection.extension.clone()
        },
        is_archive: inspection.is_zip,
        requires_csv_mapping: false,
        explanation: "Unrecognized wearable export format. Check the provider's export instructions or select a supported .zip, .xml, .csv, or .json file.".to_string(),
    }
}
