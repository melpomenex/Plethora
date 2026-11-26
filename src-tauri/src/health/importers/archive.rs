//! Secure, streaming ZIP archive inspector and bounded entry reader.
//!
//! Protects against:
//! - ZIP Slip / path traversal (`..`, backslashes, drive letters, UNC paths)
//! - Absolute paths (`/etc/passwd`)
//! - Unix symlink entries (`S_IFLNK` = 0o120000)
//! - Duplicate or case-colliding normalized paths
//! - Excessive entry counts (`max_entries`)
//! - ZIP bombs (excessive expanded size and excessive compression ratio)
//! - Integer overflow on size accounting

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use zip::ZipArchive;

use super::limits::ArchiveSecurityLimits;
use super::types::{ImportCancellationToken, ImportError};

#[derive(Debug, Clone)]
pub struct ZipEntryInfo {
    pub index: usize,
    pub normalized_path: String,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub is_dir: bool,
}

pub struct SafeZipArchive {
    archive: ZipArchive<BufReader<File>>,
    entries: Vec<ZipEntryInfo>,
    limits: ArchiveSecurityLimits,
    cumulative_bytes_read: u64,
}

impl SafeZipArchive {
    pub fn open(path: &Path, limits: ArchiveSecurityLimits) -> Result<Self, ImportError> {
        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let reader = BufReader::with_capacity(64 * 1024, file);
        let mut archive = ZipArchive::new(reader)
            .map_err(|e| ImportError::InvalidInput(format!("Malformed or unreadable ZIP archive: {e}")))?;

        if archive.len() > limits.max_entries {
            return Err(ImportError::SecurityViolation(format!(
                "Archive contains {} entries, exceeding the safety limit of {}",
                archive.len(),
                limits.max_entries
            )));
        }

        let mut seen_paths = HashSet::with_capacity(archive.len());
        let mut entries = Vec::with_capacity(archive.len());

        for idx in 0..archive.len() {
            let entry = archive.by_index_raw(idx).map_err(|e| {
                ImportError::InvalidInput(format!("Corrupt ZIP entry at index {idx}: {e}"))
            })?;

            // Reject Unix symlinks (mode & 0o170000 == 0o120000)
            if let Some(mode) = entry.unix_mode() {
                if (mode & 0o170000) == 0o120000 {
                    return Err(ImportError::SecurityViolation(format!(
                        "Archive contains a symlink entry ('{}'), which is not permitted",
                        entry.name()
                    )));
                }
            }

            let normalized = validate_and_normalize_entry_path(entry.name(), limits.max_path_len)?;
            let is_dir = entry.is_dir() || entry.name().ends_with('/');

            if !is_dir {
                let lower = normalized.to_ascii_lowercase();
                if !seen_paths.insert(lower) {
                    return Err(ImportError::SecurityViolation(format!(
                        "Archive contains duplicate path '{normalized}'"
                    )));
                }

                let uncomp = entry.size();
                let comp = entry.compressed_size();

                if uncomp > limits.max_single_entry_bytes {
                    return Err(ImportError::SecurityViolation(format!(
                        "Archive entry '{normalized}' declares {uncomp} bytes, exceeding the {} byte limit",
                        limits.max_single_entry_bytes
                    )));
                }

                if comp >= limits.ratio_floor_bytes {
                    let max_allowed = comp.saturating_mul(limits.max_compression_ratio);
                    if uncomp > max_allowed {
                        return Err(ImportError::SecurityViolation(format!(
                            "Archive entry '{normalized}' exceeds safe compression ratio ({comp} -> {uncomp} bytes)"
                        )));
                    }
                }
            }

            entries.push(ZipEntryInfo {
                index: idx,
                normalized_path: normalized,
                compressed_size: entry.compressed_size(),
                uncompressed_size: entry.size(),
                is_dir,
            });
        }

        Ok(Self {
            archive,
            entries,
            limits,
            cumulative_bytes_read: 0,
        })
    }

    pub fn entries(&self) -> &[ZipEntryInfo] {
        &self.entries
    }

    pub fn file_paths(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.normalized_path.as_str())
            .collect()
    }

    /// Stream an entry through a bounded reader into `consumer`, enforcing exact byte and ratio budgets.
    pub fn stream_entry<F, T>(
        &mut self,
        index: usize,
        cancel: &ImportCancellationToken,
        mut consumer: F,
    ) -> Result<T, ImportError>
    where
        F: FnMut(&mut dyn Read) -> Result<T, ImportError>,
    {
        cancel.check()?;
        let info = self
            .entries
            .get(index)
            .ok_or_else(|| ImportError::InvalidInput("Invalid archive entry index".into()))?
            .clone();
        if info.is_dir {
            return Err(ImportError::InvalidInput("Cannot read directory entry".into()));
        }

        let remaining_total = self
            .limits
            .max_total_expanded_bytes
            .saturating_sub(self.cumulative_bytes_read);
        let max_for_entry = self.limits.max_single_entry_bytes.min(remaining_total);

        let entry = self
            .archive
            .by_index(index)
            .map_err(|e| ImportError::InvalidInput(format!("Failed opening ZIP entry '{}': {e}", info.normalized_path)))?;

        let mut bounded = BoundedEntryReader {
            inner: entry,
            bytes_read: 0,
            max_bytes: max_for_entry,
            compressed_size: info.compressed_size,
            limits: self.limits,
            cancel,
            path: info.normalized_path,
        };

        let result = consumer(&mut bounded)?;
        self.cumulative_bytes_read = self
            .cumulative_bytes_read
            .checked_add(bounded.bytes_read)
            .ok_or_else(|| ImportError::SecurityViolation("Archive byte counter overflow".into()))?;
        Ok(result)
    }

    pub fn read_entry_bytes(
        &mut self,
        index: usize,
        max_bytes: usize,
        cancel: &ImportCancellationToken,
    ) -> Result<Vec<u8>, ImportError> {
        self.stream_entry(index, cancel, |reader| {
            let mut out = Vec::new();
            let mut buf = [0u8; 16 * 1024];
            loop {
                let n = reader
                    .read(&mut buf)
                    .map_err(|e| ImportError::Io(e.to_string()))?;
                if n == 0 {
                    break;
                }
                if out.len().saturating_add(n) > max_bytes {
                    return Err(ImportError::SecurityViolation(format!(
                        "Entry exceeds {max_bytes} byte in-memory read budget"
                    )));
                }
                out.extend_from_slice(&buf[..n]);
            }
            Ok(out)
        })
    }
}

struct BoundedEntryReader<'a, R: Read> {
    inner: R,
    bytes_read: u64,
    max_bytes: u64,
    compressed_size: u64,
    limits: ArchiveSecurityLimits,
    cancel: &'a ImportCancellationToken,
    path: String,
}

impl<'a, R: Read> Read for BoundedEntryReader<'a, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Import cancelled",
            ));
        }
        let n = self.inner.read(buf)?;
        if n == 0 {
            return Ok(0);
        }
        self.bytes_read = self.bytes_read.checked_add(n as u64).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Byte count overflow")
        })?;
        if self.bytes_read > self.max_bytes {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "Archive entry '{}' exceeded expanded byte limit ({} bytes)",
                    self.path, self.max_bytes
                ),
            ));
        }
        if self.compressed_size >= self.limits.ratio_floor_bytes {
            let max_ratio_bytes = self
                .compressed_size
                .saturating_mul(self.limits.max_compression_ratio);
            if self.bytes_read > max_ratio_bytes {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "Archive entry '{}' exceeded safe compression ratio",
                        self.path
                    ),
                ));
            }
        }
        Ok(n)
    }
}

pub fn validate_and_normalize_entry_path(
    raw: &str,
    max_len: usize,
) -> Result<String, ImportError> {
    if raw.is_empty() || raw.len() > max_len {
        return Err(ImportError::SecurityViolation(
            "Archive entry path is empty or exceeds maximum length".into(),
        ));
    }
    if raw.contains('\0') {
        return Err(ImportError::SecurityViolation(
            "Archive entry path contains NUL byte".into(),
        ));
    }
    if raw.starts_with('/') || raw.starts_with('\\') {
        return Err(ImportError::SecurityViolation(format!(
            "Archive contains absolute path '{raw}'"
        )));
    }
    if raw.len() >= 2 && raw.as_bytes()[1] == b':' {
        return Err(ImportError::SecurityViolation(format!(
            "Archive contains Windows drive prefix '{raw}'"
        )));
    }
    let normalized = raw.replace('\\', "/");
    let mut clean_parts = Vec::new();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(ImportError::SecurityViolation(format!(
                "Archive contains path traversal ('..') in '{raw}'"
            )));
        }
        clean_parts.push(part);
    }
    if clean_parts.is_empty() && !raw.ends_with('/') {
        return Err(ImportError::SecurityViolation(format!(
            "Archive contains invalid entry path '{raw}'"
        )));
    }
    Ok(clean_parts.join("/"))
}
