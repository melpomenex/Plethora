//! Kindle Clippings Import
//!
//! Parses `My Clippings.txt` files from Kindle e-readers and imports highlights
//! and notes as Incrementum Documents + Extracts. Supports idempotent re-import
//! with content-hash-based deduplication.

use std::collections::HashMap;
use std::fs;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use regex::Regex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::Row;
use tauri::State;

use crate::database::Repository;
use crate::error::{IncrementumError, Result};
use crate::models::{Document, Extract, FileType};

#[derive(Debug, Clone, PartialEq)]
pub enum ClippingType {
    Highlight,
    Note,
    Bookmark,
}

#[derive(Debug, Clone)]
pub struct KindleClipping {
    pub book_title: String,
    pub author: Option<String>,
    pub clipping_type: ClippingType,
    pub page: Option<i32>,
    pub location_start: Option<i32>,
    pub location_end: Option<i32>,
    pub date_added: Option<DateTime<Utc>>,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleBookGroup {
    pub title: String,
    pub author: Option<String>,
    pub normalized_title: String,
    pub highlights_count: usize,
    pub notes_count: usize,
    pub bookmarks_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleValidationResult {
    pub books: Vec<KindleBookGroup>,
    pub total_clippings: usize,
    pub total_highlights: usize,
    pub total_notes: usize,
    pub total_bookmarks: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindlePreviewResult {
    pub books: Vec<KindleBookPreview>,
    pub total_new_extracts: usize,
    pub total_existing_extracts: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleBookPreview {
    pub title: String,
    pub author: Option<String>,
    pub new_highlights: usize,
    pub existing_highlights: usize,
    pub new_notes: usize,
    pub existing_notes: usize,
    pub skipped_bookmarks: usize,
    pub is_new_book: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleImportResult {
    pub new_documents: usize,
    pub new_extracts: usize,
    pub updated_documents: usize,
    pub warnings: Vec<String>,
    /// IDs of all documents created or updated by this import. Used by the
    /// generic import path to return a representative document and by
    /// `import_document_multi` to return the full set.
    pub document_ids: Vec<String>,
}

fn hex_sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Normalize a book title for consistent grouping.
pub fn normalize_book_title(title: &str) -> String {
    title
        .trim()
        .replace('\u{feff}', "") // BOM
        .replace('\u{200b}', "") // zero-width space
        .replace('\r', " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extract author from a title line like "Book Title (Author Name)".
fn extract_author(title: &str) -> (String, Option<String>) {
    let trimmed = title.trim();

    if let Some(last_open) = trimmed.rfind('(') {
        if trimmed.ends_with(')') && last_open > 0 {
            let author_candidate = &trimmed[last_open + 1..trimmed.len() - 1];
            let clean_author = author_candidate.trim();
            if !clean_author.is_empty()
                && !clean_author
                    .chars()
                    .next()
                    .map_or(true, |c| c.is_ascii_digit())
                && clean_author.len() < trimmed.len() / 2
            {
                let clean_title = trimmed[..last_open].trim().to_string();
                if !clean_title.is_empty() {
                    return (clean_title, Some(clean_author.to_string()));
                }
            }
        }
    }

    (trimmed.to_string(), None)
}

/// Compute a stable content hash for deduplication.
fn compute_content_hash(normalized_book_title: &str, content: &str) -> String {
    hex_sha256(&format!(
        "{}|{}",
        normalized_book_title,
        content.trim().to_lowercase()
    ))
}

/// Compute a synthetic file_path for Kindle documents.
fn kindle_file_path(normalized_title: &str) -> String {
    format!("kindle://{}", hex_sha256(normalized_title))
}

/// Decode raw bytes to text, trying UTF-8 first and falling back to Latin-1.
///
/// Shared between the path-based reader (`read_file_bytes`) and the
/// `*_bytes` Tauri commands used on mobile, where the file arrives as a
/// `Vec<u8>` from the in-browser File store (the Tauri dialog returns
/// unreadable `content://` URIs on Android, so mobile routes File objects
/// through the browser-file store and sends their bytes over IPC instead).
/// Decode raw bytes to text, trying UTF-8 first and falling back to Latin-1.
///
/// Public so the generic document import path
/// (`commands::document::import_kindle_clippings_from_disk`) can decode a
/// detected `My Clippings.txt` exactly the way this module does.
fn decode_clippings_bytes(bytes: &[u8]) -> String {
    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }

    // Fall back to Latin-1 (ISO-8859-1) — always valid
    bytes.iter().map(|&b| b as char).collect::<String>()
}

/// Read a file trying UTF-8 first, falling back to Latin-1.
fn read_file_bytes(path: &str) -> Result<String> {
    let bytes = fs::read(path)
        .map_err(|e| IncrementumError::NotFound(format!("Cannot read file '{}': {}", path, e)))?;
    Ok(decode_clippings_bytes(&bytes))
}

/// Read and decode a `My Clippings.txt` file from disk. Public so the generic
/// document import path can decode a detected clippings file with the exact
/// same UTF-8 → Latin-1 fallback this module uses internally. Returns
/// [`IncrementumError::NotFound`] on read failure.
pub fn read_kindle_text(path: &std::path::Path) -> Result<String> {
    let bytes = fs::read(path).map_err(|e| {
        IncrementumError::NotFound(format!("Cannot read file '{}': {}", path.display(), e))
    })?;
    Ok(decode_clippings_bytes(&bytes))
}

/// Returns true iff a file's basename looks like Kindle `My Clippings.txt`.
///
/// Case-insensitive, and collapses runs of whitespace, `_`, and `-` to a
/// single space so variants like `my_clippings.txt`, `My-Clippings.txt`,
/// and `my  clippings.txt` all match. Used as the fast-path filename gate
/// before the more expensive content sniff.
fn basename_is_kindle_clippings(path: &std::path::Path) -> bool {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let normalized: String = stem
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '_' | '-' => ' ',
            other => other,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    normalized == "my clippings"
}

/// Pure content sniff: does this decoded text look like a Kindle clippings
/// file? Returns true iff it contains at least two `==========` separator
/// lines AND at least one metadata line matching `- Your (Highlight|Note|Bookmark)`.
///
/// No I/O. Used by both [`is_kindle_clippings_path`] and
/// [`is_kindle_clippings_bytes`].
pub fn is_kindle_clippings_text(text: &str) -> bool {
    let separator_count = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| *line == "==========")
        .count();
    if separator_count < 2 {
        return false;
    }

    let metadata_re =
        Regex::new(r"(?i)^[ \t]*- Your (Highlight|Note|Bookmark)\b").expect("valid regex");
    text.lines()
        .any(|line| metadata_re.is_match(line.trim_start()))
}

/// Path-based detector: returns true iff the file's basename matches
/// `My Clippings.txt` (case/separator-insensitive) AND its decoded content
/// passes [`is_kindle_clippings_text`]. Returns false on any I/O or decode
/// error so callers fall through to the generic `.txt` import path.
pub fn is_kindle_clippings_path(path: &std::path::Path) -> bool {
    if !basename_is_kindle_clippings(path) {
        return false;
    }
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    is_kindle_clippings_text(&decode_clippings_bytes(&bytes))
}

/// Bytes-based detector for the mobile import path: same logic as
/// [`is_kindle_clippings_path`] but takes a pre-decoded filename plus raw
/// bytes (the mobile path gets File objects through the in-browser store
/// rather than readable filesystem paths).
pub fn is_kindle_clippings_bytes(file_name: &str, bytes: &[u8]) -> bool {
    if !basename_is_kindle_clippings(std::path::Path::new(file_name)) {
        return false;
    }
    is_kindle_clippings_text(&decode_clippings_bytes(bytes))
}

/// Parse the Kindle date format:
/// `"Added on DayOfWeek, Month DD, YYYY H:MM:SS AM/PM"`
fn parse_kindle_date(date_str: &str) -> Option<DateTime<Utc>> {
    let trimmed = date_str.trim();
    // Strip "Added on" prefix if present
    let trimmed = trimmed.strip_prefix("Added on ").unwrap_or(trimmed).trim();

    let re = Regex::new(
        r"(?i)^(\w+),\s+(\w+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$",
    )
    .ok()?;

    let caps = re.captures(trimmed)?;

    let month_name = caps.get(2)?.as_str();
    let day: u32 = caps.get(3)?.as_str().parse().ok()?;
    let year: i32 = caps.get(4)?.as_str().parse().ok()?;
    let hour: u32 = caps.get(5)?.as_str().parse().ok()?;
    let minute: u32 = caps.get(6)?.as_str().parse().ok()?;
    let second: u32 = caps.get(7)?.as_str().parse().ok()?;
    let ampm = caps.get(8)?.as_str();

    let mut hour = hour as u32;
    if ampm.eq_ignore_ascii_case("PM") && hour != 12 {
        hour += 12;
    } else if ampm.eq_ignore_ascii_case("AM") && hour == 12 {
        hour = 0;
    }

    let month_num = match month_name.to_lowercase().as_str() {
        "january" => 1,
        "february" => 2,
        "march" => 3,
        "april" => 4,
        "may" => 5,
        "june" => 6,
        "july" => 7,
        "august" => 8,
        "september" => 9,
        "october" => 10,
        "november" => 11,
        "december" => 12,
        _ => return None,
    };

    let date = NaiveDate::from_ymd_opt(year, month_num, day)?;
    let time = NaiveTime::from_hms_opt(hour, minute, second)?;
    let naive = date.and_time(time);
    Some(naive.and_utc())
}

/// Parse the metadata line from a clipping entry.
fn parse_metadata_line(
    line: &str,
) -> Option<(ClippingType, Option<i32>, Option<i32>, Option<i32>, &str)> {
    let trimmed = line.trim();
    if !trimmed.starts_with("- Your ") {
        return None;
    }

    let (clipping_type, rest) = if trimmed.contains("Your Highlight") {
        (
            ClippingType::Highlight,
            trimmed.trim_start_matches("- Your Highlight").trim(),
        )
    } else if trimmed.contains("Your Note") {
        (
            ClippingType::Note,
            trimmed.trim_start_matches("- Your Note").trim(),
        )
    } else if trimmed.contains("Your Bookmark") {
        (
            ClippingType::Bookmark,
            trimmed.trim_start_matches("- Your Bookmark").trim(),
        )
    } else {
        return None;
    };

    let mut page: Option<i32> = None;
    let mut loc_start: Option<i32> = None;
    let mut loc_end: Option<i32> = None;
    let mut date_str = "";

    let parts: Vec<&str> = rest.split(" | ").collect();

    for part in parts {
        let part = part.trim();
        if part.starts_with("on page ") {
            page = part.trim_start_matches("on page ").parse().ok();
        } else if part.starts_with("Location ") {
            let loc_str = part.trim_start_matches("Location ");
            if let Some(hyphen) = loc_str.find('-') {
                loc_start = loc_str[..hyphen].trim().parse().ok();
                loc_end = loc_str[hyphen + 1..].trim().parse().ok();
            } else {
                loc_start = loc_str.trim().parse().ok();
            }
        } else if part.starts_with("Added on ") {
            date_str = part.trim_start_matches("Added on ");
        }
    }

    Some((clipping_type, page, loc_start, loc_end, date_str))
}

/// Internal: parse a clippings file into raw clippings and warnings.
///
/// Reads the file from `path` then delegates to [`parse_clippings_raw_from_text`].
fn parse_clippings_raw(path: &str) -> Result<(Vec<KindleClipping>, Vec<String>)> {
    let text = read_file_bytes(path)?;
    parse_clippings_raw_from_text(&text)
}

/// Internal: parse already-decoded clippings text into raw clippings and warnings.
///
/// This is the pure-in-memory parse path shared by the path-based commands
/// (which read the file first) and the `*_bytes` Tauri commands used on mobile
/// (which receive the file contents over IPC as `Vec<u8>` because the Tauri
/// dialog returns unreadable `content://` URIs on Android).
fn parse_clippings_raw_from_text(text: &str) -> Result<(Vec<KindleClipping>, Vec<String>)> {
    // Strip BOM
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    // Normalize line endings (owned String so we can split borrow below)
    let text = text.replace("\r\n", "\n").replace('\r', "\n");

    // Split on separator
    let separator = "==========";
    let entries: Vec<&str> = text
        .split(separator)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if entries.is_empty() {
        return Err(IncrementumError::InvalidInput(
            "File does not appear to be a Kindle clippings file (no entries found)".to_string(),
        ));
    }

    let mut warnings = Vec::new();
    let mut clippings: Vec<KindleClipping> = Vec::new();
    let mut skipped_empty = 0usize;

    let metadata_re =
        Regex::new(r"(?i)^[ \t]*- Your (Highlight|Note|Bookmark)(.*)").expect("valid regex");

    for (idx, entry) in entries.iter().enumerate() {
        let lines: Vec<&str> = entry.lines().collect();
        if lines.is_empty() {
            continue;
        }

        let raw_title = lines[0].trim();
        if raw_title.is_empty() {
            continue;
        }

        let metadata_line = if lines.len() > 1 {
            lines[1].trim()
        } else {
            skipped_empty += 1;
            continue;
        };

        let caps = match metadata_re.captures(metadata_line) {
            Some(c) => c,
            None => {
                warnings.push(format!(
                    "Skipping entry {} for '{}': unrecognized metadata format",
                    idx + 1,
                    raw_title.chars().take(60).collect::<String>()
                ));
                continue;
            }
        };

        let clipping_type_str = caps.get(1).expect("regex group 1 captured").as_str();
        let clipping_type = match clipping_type_str {
            "Highlight" => ClippingType::Highlight,
            "Note" => ClippingType::Note,
            "Bookmark" => ClippingType::Bookmark,
            _ => continue,
        };

        let (clipping_type_parsed, page, loc_start, loc_end, date_str) =
            parse_metadata_line(metadata_line).unwrap_or((clipping_type, None, None, None, ""));

        let date_added = if date_str.is_empty() {
            None
        } else {
            parse_kindle_date(date_str)
        };

        // Content: everything after the blank line following the metadata
        let content_start = if lines.len() > 2 { 3 } else { 2 };
        let content_lines: Vec<&str> = if content_start < lines.len() {
            lines[content_start..].iter().copied().collect()
        } else {
            vec![]
        };
        let content = content_lines.join("\n").trim().to_string();

        if content.is_empty() {
            skipped_empty += 1;
            continue;
        }

        let normalized = normalize_book_title(raw_title);
        let content_hash = compute_content_hash(&normalized, &content);
        let (_clean_title, author) = extract_author(raw_title);

        clippings.push(KindleClipping {
            book_title: raw_title.to_string(),
            author,
            clipping_type: clipping_type_parsed,
            page,
            location_start: loc_start,
            location_end: loc_end,
            date_added,
            content,
            content_hash,
        });
    }

    if skipped_empty > 0 {
        warnings.push(format!("Skipped {} empty clippings", skipped_empty));
    }

    if clippings.is_empty() {
        return Err(IncrementumError::InvalidInput(
            "No importable clippings found in file".to_string(),
        ));
    }

    Ok((clippings, warnings))
}

/// Internal: group clippings by normalized book title.
fn group_clippings(clippings: &[KindleClipping]) -> Vec<KindleBookGroup> {
    let mut book_map: HashMap<String, KindleBookGroup> = HashMap::new();

    for clipping in clippings {
        let normalized = normalize_book_title(&clipping.book_title);
        let group = book_map.entry(normalized.clone()).or_insert_with(|| {
            let (_, author) = extract_author(&clipping.book_title);
            KindleBookGroup {
                title: clipping.book_title.clone(),
                author,
                normalized_title: normalized.clone(),
                highlights_count: 0,
                notes_count: 0,
                bookmarks_count: 0,
            }
        });

        match clipping.clipping_type {
            ClippingType::Highlight => group.highlights_count += 1,
            ClippingType::Note => group.notes_count += 1,
            ClippingType::Bookmark => group.bookmarks_count += 1,
        }
    }

    let mut books: Vec<KindleBookGroup> = book_map.into_values().collect();
    books.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    books
}

/// Parse a `My Clippings.txt` file and return a validation result.
///
/// Reads the file from `path` then delegates to [`parse_kindle_clippings_from_text`].
pub fn parse_kindle_clippings(path: &str) -> Result<KindleValidationResult> {
    let file_mtime: Option<DateTime<Utc>> = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| DateTime::<Utc>::from(t));

    let text = read_file_bytes(path)?;
    parse_kindle_clippings_from_text(&text, file_mtime)
}

/// Parse already-decoded clippings text and return a validation result.
///
/// `file_mtime` is used only as a fallback for clippings whose date Added line
/// is unparseable; pass `None` to use "current time" in the warning text. The
/// `*_bytes` Tauri commands (mobile path) call this with `None` because the
/// in-browser File store exposes no file mtime.
pub fn parse_kindle_clippings_from_text(
    text: &str,
    file_mtime: Option<DateTime<Utc>>,
) -> Result<KindleValidationResult> {
    let (clippings, mut warnings) = parse_clippings_raw_from_text(text)?;
    let books = group_clippings(&clippings);

    let importable_books: Vec<&KindleBookGroup> = books
        .iter()
        .filter(|b| b.highlights_count > 0 || b.notes_count > 0)
        .collect();

    if importable_books.is_empty() {
        return Err(IncrementumError::InvalidInput(
            "File contains only bookmarks and no importable highlights or notes".to_string(),
        ));
    }

    let total_highlights: usize = books.iter().map(|g| g.highlights_count).sum();
    let total_notes: usize = books.iter().map(|g| g.notes_count).sum();
    let total_bookmarks: usize = books.iter().map(|g| g.bookmarks_count).sum();
    let total_clippings = total_highlights + total_notes + total_bookmarks;

    let unparseable_dates: usize = clippings.iter().filter(|c| c.date_added.is_none()).count();

    if unparseable_dates > 0 {
        let fallback = match file_mtime {
            Some(t) => format!("using file modification time ({})", t.format("%Y-%m-%d")),
            None => "using current time".to_string(),
        };
        warnings.push(format!(
            "{} clippings had unparseable dates ({})",
            unparseable_dates, fallback
        ));
    }

    Ok(KindleValidationResult {
        books,
        total_clippings,
        total_highlights,
        total_notes,
        total_bookmarks,
        warnings,
    })
}

/// Validate a clippings file against the existing database.
///
/// Reads the file from `path` then delegates to [`validate_kindle_clippings_preview_from_text`].
pub async fn validate_kindle_clippings_preview(
    path: &str,
    repo: &Repository,
) -> Result<KindlePreviewResult> {
    let text = read_file_bytes(path)?;
    validate_kindle_clippings_preview_from_text(&text, repo).await
}

/// Validate already-decoded clippings text against the existing database.
///
/// Used by both the path-based command and the `*_bytes` Tauri command (mobile),
/// which receives the file contents over IPC because the Tauri dialog returns
/// unreadable `content://` URIs on Android.
pub async fn validate_kindle_clippings_preview_from_text(
    text: &str,
    repo: &Repository,
) -> Result<KindlePreviewResult> {
    let (clippings, warnings) = parse_clippings_raw_from_text(text)?;

    // Group clippings by normalized title for processing
    let mut book_clippings: HashMap<String, Vec<&KindleClipping>> = HashMap::new();
    for c in &clippings {
        let normalized = normalize_book_title(&c.book_title);
        book_clippings.entry(normalized).or_default().push(c);
    }

    let mut book_previews = Vec::new();
    let mut total_new = 0usize;
    let mut total_existing = 0usize;

    for (normalized_title, book_clips) in &book_clippings {
        let has_importable = book_clips.iter().any(|c| {
            c.clipping_type == ClippingType::Highlight || c.clipping_type == ClippingType::Note
        });

        if !has_importable {
            continue;
        }

        let synthetic_path = kindle_file_path(normalized_title);
        let existing_doc = repo.find_document_by_url(&synthetic_path).await?;
        let is_new_book = existing_doc.is_none();
        let doc_id = existing_doc.as_ref().map(|d| d.id.as_str());

        let existing_hashes: std::collections::HashSet<String> = if let Some(id) = doc_id {
            let extracts = repo.list_extracts_by_document(id).await?;
            extracts.into_iter().filter_map(|e| e.source_hash).collect()
        } else {
            std::collections::HashSet::new()
        };

        let mut new_highlights = 0usize;
        let mut existing_highlights = 0usize;
        let mut new_notes = 0usize;
        let mut existing_notes = 0usize;
        let mut bookmarks_count = 0usize;
        let title = book_clips[0].book_title.clone();
        let author = book_clips[0].author.clone();

        for c in book_clips {
            match c.clipping_type {
                ClippingType::Highlight => {
                    if existing_hashes.contains(&c.content_hash) {
                        existing_highlights += 1;
                    } else {
                        new_highlights += 1;
                    }
                }
                ClippingType::Note => {
                    if existing_hashes.contains(&c.content_hash) {
                        existing_notes += 1;
                    } else {
                        new_notes += 1;
                    }
                }
                ClippingType::Bookmark => {
                    bookmarks_count += 1;
                }
            }
        }

        total_new += new_highlights + new_notes;
        total_existing += existing_highlights + existing_notes;

        book_previews.push(KindleBookPreview {
            title,
            author,
            new_highlights,
            existing_highlights,
            new_notes,
            existing_notes,
            skipped_bookmarks: bookmarks_count,
            is_new_book,
        });
    }

    // Sort by new content count descending
    book_previews.sort_by(|a, b| {
        let a_new = a.new_highlights + a.new_notes;
        let b_new = b.new_highlights + b.new_notes;
        b_new.cmp(&a_new)
    });

    Ok(KindlePreviewResult {
        books: book_previews,
        total_new_extracts: total_new,
        total_existing_extracts: total_existing,
        warnings,
    })
}

/// Import a `My Clippings.txt` file into the database.
///
/// Reads the file from `path` then delegates to [`do_import_kindle_clippings_from_text`].
pub async fn do_import_kindle_clippings(
    path: &str,
    repo: &Repository,
    collection_id: Option<String>,
) -> Result<KindleImportResult> {
    let file_mtime: Option<DateTime<Utc>> = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| DateTime::<Utc>::from(t));

    let text = read_file_bytes(path)?;
    do_import_kindle_clippings_from_text(&text, repo, collection_id, file_mtime).await
}

/// Import already-decoded clippings text into the database.
///
/// Used by both the path-based command and the `*_bytes` Tauri command (mobile).
/// `file_mtime` is used only as a fallback for clippings with unparseable dates;
/// pass `None` to fall back to the current time (the mobile `*_bytes` path,
/// which has no file mtime available from the in-browser File store).
pub async fn do_import_kindle_clippings_from_text(
    text: &str,
    repo: &Repository,
    collection_id: Option<String>,
    file_mtime: Option<DateTime<Utc>>,
) -> Result<KindleImportResult> {
    let (clippings, warnings) = parse_clippings_raw_from_text(text)?;
    let now = Utc::now();

    // Group by normalized title
    let mut book_clippings: HashMap<String, Vec<&KindleClipping>> = HashMap::new();
    for c in &clippings {
        let normalized = normalize_book_title(&c.book_title);
        book_clippings.entry(normalized).or_default().push(c);
    }

    let mut new_documents = 0usize;
    let mut new_extracts = 0usize;
    let mut updated_documents = 0usize;
    let mut document_ids: Vec<String> = Vec::new();

    for (normalized_title, book_clips) in &book_clippings {
        let has_importable = book_clips.iter().any(|c| {
            c.clipping_type == ClippingType::Highlight || c.clipping_type == ClippingType::Note
        });

        if !has_importable {
            continue;
        }

        let synthetic_path = kindle_file_path(normalized_title);
        let existing_doc = repo.find_document_by_url(&synthetic_path).await?;
        let doc_id: String;

        if let Some(ref doc) = existing_doc {
            doc_id = doc.id.clone();
        } else {
            let title = book_clips[0].book_title.clone();
            let author = book_clips[0].author.clone();

            // Build document content from all importable clippings (highlights + notes)
            let mut content_parts: Vec<String> = Vec::new();
            for c in book_clips {
                if c.clipping_type == ClippingType::Bookmark {
                    continue;
                }
                match c.clipping_type {
                    ClippingType::Highlight => {
                        content_parts.push(format!("> {}", c.content));
                    }
                    ClippingType::Note => {
                        content_parts.push(format!("**Note:** {}", c.content));
                    }
                    ClippingType::Bookmark => {}
                }
            }
            let doc_content = if content_parts.is_empty() {
                None
            } else {
                Some(content_parts.join("\n\n---\n\n"))
            };

            let mut new_doc = Document::with_collection(
                title,
                synthetic_path,
                // The document body is markdown (highlights as blockquotes,
                // notes as bold-prefixed paragraphs), so mark it as such.
                // Previously this was `FileType::Other`, which made the viewer
                // fall through to the "preview not available" wall whenever
                // the doc's `content` field was stripped (e.g. by the library
                // list endpoint) and labeled the doc "other" in every UI.
                FileType::Markdown,
                collection_id.clone(),
            );
            new_doc.category = Some("Kindle".to_string());
            new_doc.tags = vec!["kindle-import".to_string()];
            new_doc.content = doc_content;
            new_doc.metadata = Some(crate::models::DocumentMetadata {
                author,
                source: Some("kindle-clippings".to_string()),
                subject: None,
                keywords: None,
                created_at: None,
                modified_at: None,
                file_size: None,
                language: None,
                page_count: None,
                word_count: None,
                fetched_at: None,
                site_name: None,
                browser_import_mode: None,
                article_html: None,
                extracted_images: None,
                ..Default::default()
            });

            repo.create_document(&new_doc).await?;
            doc_id = new_doc.id.clone();
            new_documents += 1;
        }
        // Record the affected document (whether newly created or pre-existing)
        // so callers can surface the per-book document set from this import.
        document_ids.push(doc_id.clone());

        // Collect existing hashes for dedup
        let existing_extracts = repo.list_extracts_by_document(&doc_id).await?;
        let existing_hashes: std::collections::HashSet<String> = existing_extracts
            .iter()
            .filter_map(|e| e.source_hash.clone())
            .collect();

        for clipping in book_clips {
            match clipping.clipping_type {
                ClippingType::Bookmark => continue,
                ClippingType::Highlight | ClippingType::Note => {}
            }

            if existing_hashes.contains(&clipping.content_hash) {
                continue;
            }

            let date = clipping.date_added.unwrap_or(file_mtime.unwrap_or(now));

            let mut extract = Extract::new(doc_id.clone(), clipping.content.clone());
            extract.source_hash = Some(clipping.content_hash.clone());
            extract.date_created = date;
            extract.date_modified = date;

            if clipping.clipping_type == ClippingType::Note {
                extract.notes = Some(clipping.content.clone());
                extract.tags = vec!["kindle".to_string(), "kindle-note".to_string()];
            } else {
                extract.tags = vec!["kindle".to_string()];
            }

            repo.create_extract(&extract).await?;
            new_extracts += 1;
        }

        if let Some(mut doc) = repo.get_document(&doc_id).await? {
            let current_extracts = repo.list_extracts_by_document(&doc_id).await?;
            doc.extract_count = current_extracts.len() as i32;
            doc.date_modified = Utc::now();
            repo.update_document(&doc_id, &doc).await?;
            updated_documents += 1;
        }
    }

    Ok(KindleImportResult {
        new_documents,
        new_extracts,
        updated_documents,
        warnings,
        document_ids,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleBackfillResult {
    pub documents_updated: usize,
    pub learning_items_created: usize,
    pub errors: Vec<String>,
}

pub async fn do_backfill_kindle_imports(repo: &Repository) -> Result<KindleBackfillResult> {
    // Find all Kindle documents
    let rows = sqlx::query("SELECT id FROM documents WHERE file_path LIKE 'kindle://%'")
        .fetch_all(repo.db_pool())
        .await?;

    let mut documents_updated = 0usize;
    let mut learning_items_created = 0usize;
    let mut errors = Vec::new();

    for row in &rows {
        let doc_id: String = row.try_get("id")?;

        // Get all extracts for this document that don't have a learning item yet
        let extract_rows = sqlx::query(
            r#"
            SELECT e.id, e.content, e.notes, e.date_created, e.tags
            FROM extracts e
            WHERE e.document_id = ?
            AND NOT EXISTS (
                SELECT 1 FROM learning_items li WHERE li.extract_id = e.id
            )
            "#,
        )
        .bind(&doc_id)
        .fetch_all(repo.db_pool())
        .await
        .map_err(|e| e.to_string());

        let extract_rows = match extract_rows {
            Ok(r) => r,
            Err(err) => {
                errors.push(format!("doc {}: {}", doc_id, err));
                continue;
            }
        };

        if extract_rows.is_empty() {
            continue;
        }

        let now = Utc::now();
        let mut content_parts: Vec<String> = Vec::new();

        for extract_row in &extract_rows {
            let extract_id: String = extract_row.try_get("id").unwrap_or_default();
            let content: String = extract_row.try_get("content").unwrap_or_default();
            let notes: Option<String> = extract_row.try_get("notes").ok();
            let date_created: Option<String> = extract_row.try_get("date_created").ok();
            let tags_json: Option<String> = extract_row.try_get("tags").ok();
            let existing_tags: Vec<String> = tags_json
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();

            if !content.is_empty() {
                if existing_tags.contains(&"kindle-note".to_string()) {
                    content_parts.push(format!("**Note:** {}", content));
                } else {
                    content_parts.push(format!("> {}", content));
                }
            }

            let item_id = uuid::Uuid::new_v4().to_string();
            let due_date = date_created
                .as_deref()
                .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339())
                .unwrap_or_else(|| now.to_rfc3339());

            let item_tags = if existing_tags.contains(&"kindle-note".to_string()) {
                serde_json::to_string(&vec!["kindle", "kindle-note"])
                    .unwrap_or_else(|_| "[]".to_string())
            } else {
                serde_json::to_string(&vec!["kindle"]).unwrap_or_else(|_| "[]".to_string())
            };

            let answer = if existing_tags.contains(&"kindle-note".to_string()) {
                "Recall this note from the book"
            } else {
                "Recall this highlight from the book"
            };

            let insert_result = sqlx::query(
                r#"
                INSERT INTO learning_items (
                    id, extract_id, document_id, item_type, question,
                    answer, difficulty, interval, ease_factor, due_date,
                    date_created, date_modified, state, is_suspended, tags,
                    algorithm_type
                ) VALUES (?1, ?2, ?3, 'flashcard', ?4, ?5, 3, 0, 2.5, ?6, ?7, ?8, 'new', 0, ?9, 'fsrs')
                "#,
            )
            .bind(&item_id)
            .bind(&extract_id)
            .bind(&doc_id)
            .bind(&content)
            .bind(answer)
            .bind(&due_date)
            .bind(&now.to_rfc3339())
            .bind(&now.to_rfc3339())
            .bind(&item_tags)
            .execute(repo.db_pool())
            .await;

            match insert_result {
                Ok(_) => learning_items_created += 1,
                Err(e) => errors.push(format!("extract {}: {}", extract_id, e)),
            }
        }

        let doc_content = if content_parts.is_empty() {
            None
        } else {
            Some(content_parts.join("\n\n---\n\n"))
        };

        let update_result = sqlx::query(
            r#"
            UPDATE documents
            SET content = COALESCE(?1, content),
                extract_count = (SELECT COUNT(*) FROM extracts WHERE document_id = ?2),
                date_modified = ?3
            WHERE id = ?2
            "#,
        )
        .bind(&doc_content)
        .bind(&doc_id)
        .bind(now.to_rfc3339())
        .execute(repo.db_pool())
        .await;

        match update_result {
            Ok(_) => documents_updated += 1,
            Err(e) => errors.push(format!("doc update {}: {}", doc_id, e)),
        }
    }

    Ok(KindleBackfillResult {
        documents_updated,
        learning_items_created,
        errors,
    })
}

#[tauri::command]
pub fn parse_kindle_clippings_file(file_path: String) -> Result<KindleValidationResult> {
    parse_kindle_clippings(&file_path)
}

#[tauri::command]
pub async fn validate_kindle_clippings(
    file_path: String,
    repo: State<'_, Repository>,
) -> Result<KindlePreviewResult> {
    validate_kindle_clippings_preview(&file_path, &repo).await
}

#[tauri::command]
pub async fn import_kindle_clippings_file(
    file_path: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<KindleImportResult> {
    do_import_kindle_clippings(&file_path, &repo, collection_id).await
}

// --- Mobile (bytes) variants ---
//
// On native mobile the Tauri dialog plugin returns unreadable `content://`
// URIs, so the frontend routes the picked File through the in-browser File
// store and sends its raw bytes over IPC instead. These commands mirror the
// path-based ones above but accept `Vec<u8>`; they decode the bytes to text
// and delegate to the same `*_from_text` internals, so behavior is identical
// to the desktop path. See src/utils/kindleClippingsImport.ts for the
// isNativeMobile() fork that selects these commands.

#[tauri::command]
pub fn parse_kindle_clippings_file_bytes(file_bytes: Vec<u8>) -> Result<KindleValidationResult> {
    let text = decode_clippings_bytes(&file_bytes);
    parse_kindle_clippings_from_text(&text, None)
}

#[tauri::command]
pub async fn validate_kindle_clippings_bytes(
    file_bytes: Vec<u8>,
    repo: State<'_, Repository>,
) -> Result<KindlePreviewResult> {
    let text = decode_clippings_bytes(&file_bytes);
    validate_kindle_clippings_preview_from_text(&text, &repo).await
}

#[tauri::command]
pub async fn import_kindle_clippings_file_bytes(
    file_bytes: Vec<u8>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<KindleImportResult> {
    let text = decode_clippings_bytes(&file_bytes);
    do_import_kindle_clippings_from_text(&text, &repo, collection_id, None).await
}

#[tauri::command]
pub async fn backfill_kindle_imports(repo: State<'_, Repository>) -> Result<KindleBackfillResult> {
    do_backfill_kindle_imports(&repo).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{Database, Repository};
    use chrono::{Datelike, Timelike};
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::NamedTempFile;

    fn write_temp(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().expect("temp file");
        write!(f, "{}", content).expect("write");
        f
    }

    /// Mirror of the in-tree test helper at `database/repository.rs:7282`.
    /// In-memory SQLite + full migration, so each integration test runs in
    /// isolation. Used by the import-integration tests below.
    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    fn sample_clipping_file() -> String {
        r#"Atomic Habits (James Clear)
- Your Highlight on page 42 | Location 678-680 | Added on Sunday, January 15, 2024 3:45:22 PM

The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become.

==========
Deep Work (Cal Newport)
- Your Highlight on page 15 | Location 234-235 | Added on Monday, February 5, 2024 10:30:00 AM

If you don't produce, you won't thrive—no matter how skilled or talented you are.

==========
Deep Work (Cal Newport)
- Your Note on page 50 | Location 800 | Added on Tuesday, February 6, 2024 2:15:00 PM

This connects to the idea of deliberate practice from Peak.

==========
Atomic Habits (James Clear)
- Your Bookmark on page 100 | Location 1500 | Added on Wednesday, March 1, 2024 9:00:00 AM

==========
Nonexistent Book
- Your Bookmark | Added on Thursday, March 2, 2024 12:00:00 PM

==========
"#
            .to_string()
    }

    #[test]
    fn test_parse_valid_file() {
        let f = write_temp(&sample_clipping_file());
        let result = parse_kindle_clippings(f.path().to_str().unwrap()).unwrap();
        assert_eq!(result.books.len(), 2);
        assert_eq!(result.total_highlights, 2);
        assert_eq!(result.total_notes, 1);
        // Bookmarks are skipped (no content), so total_bookmarks == 0
    }

    #[test]
    fn test_grouping_by_normalized_title() {
        let f = write_temp(&sample_clipping_file());
        let result = parse_kindle_clippings(f.path().to_str().unwrap()).unwrap();

        let deep_work = result.books.iter().find(|b| b.title.contains("Deep Work"));
        assert!(deep_work.is_some());
        assert_eq!(deep_work.unwrap().highlights_count, 1);
        assert_eq!(deep_work.unwrap().notes_count, 1);

        let atomic = result
            .books
            .iter()
            .find(|b| b.title.contains("Atomic Habits"));
        assert!(atomic.is_some());
        assert_eq!(atomic.unwrap().highlights_count, 1);
        assert_eq!(atomic.unwrap().bookmarks_count, 0);
    }

    #[test]
    fn test_author_extraction() {
        assert_eq!(
            extract_author("Atomic Habits (James Clear)"),
            ("Atomic Habits".to_string(), Some("James Clear".to_string()))
        );
        assert_eq!(extract_author("Deep Work"), ("Deep Work".to_string(), None));
    }

    #[test]
    fn test_date_parsing() {
        let result = parse_kindle_date("Added on Sunday, January 15, 2024 3:45:22 PM");
        assert!(result.is_some());
        let dt = result.unwrap();
        assert_eq!(dt.year(), 2024);
        assert_eq!(dt.month(), 1);
        assert_eq!(dt.day(), 15);
        assert_eq!(dt.hour(), 15);

        let am_result = parse_kindle_date("Added on Monday, February 5, 2024 9:00:00 AM");
        assert!(am_result.is_some());
        assert_eq!(am_result.unwrap().hour(), 9);

        let noon = parse_kindle_date("Added on Friday, March 1, 2024 12:00:00 PM");
        assert!(noon.is_some());
        assert_eq!(noon.unwrap().hour(), 12);

        let midnight = parse_kindle_date("Added on Saturday, April 1, 2024 12:00:00 AM");
        assert!(midnight.is_some());
        assert_eq!(midnight.unwrap().hour(), 0);

        assert!(parse_kindle_date("not a date").is_none());
    }

    #[test]
    fn test_content_hash_stability() {
        let hash1 = compute_content_hash("atomic habits", "some highlighted text");
        let hash2 = compute_content_hash("atomic habits", "some highlighted text");
        assert_eq!(hash1, hash2);

        let hash3 = compute_content_hash("deep work", "some highlighted text");
        assert_ne!(hash1, hash3);

        let hash4 = compute_content_hash("atomic habits", "SOME HIGHLIGHTED TEXT");
        assert_eq!(hash1, hash4);
    }

    #[test]
    fn test_normalize_book_title() {
        assert_eq!(normalize_book_title("  Hello World  "), "Hello World");
        assert_eq!(
            normalize_book_title("\u{feff}Book\u{200b}Title"),
            "BookTitle"
        );
        assert_eq!(
            normalize_book_title("Multi\nLine  Title"),
            "Multi Line Title"
        );
    }

    #[test]
    fn test_empty_file() {
        let f = write_temp("");
        let result = parse_kindle_clippings(f.path().to_str().unwrap());
        assert!(result.is_err());
    }

    #[test]
    fn test_only_bookmarks() {
        let content = r#"Some Book (Author)
- Your Bookmark | Added on Sunday, January 1, 2024 12:00:00 PM

==========
"#
        .to_string();
        let f = write_temp(&content);
        let result = parse_kindle_clippings(f.path().to_str().unwrap());
        assert!(result.is_err());
        // Bookmarks have no content, so nothing is importable
        assert!(result.unwrap_err().to_string().contains("No importable"));
    }

    #[test]
    fn test_empty_content_clipping_skipped() {
        let content = r#"Book (Author)
- Your Highlight on page 1 | Location 1 | Added on Sunday, January 1, 2024 12:00:00 PM

==========
"#
        .to_string();
        let f = write_temp(&content);
        let result = parse_kindle_clippings(f.path().to_str().unwrap());
        assert!(result.is_err());
    }

    #[test]
    fn test_kindle_file_path_deterministic() {
        let p1 = kindle_file_path("atomic habits");
        let p2 = kindle_file_path("atomic habits");
        assert_eq!(p1, p2);
        assert!(p1.starts_with("kindle://"));
    }

    // --- Detector tests (is_kindle_clippings_text / is_kindle_clippings_path) ---

    #[test]
    fn test_detector_real_kindle_sample() {
        assert!(is_kindle_clippings_text(&sample_clipping_file()));
    }

    #[test]
    fn test_detector_requires_at_least_two_separators() {
        // Only one separator line → not a Kindle file.
        let single = "Book (Author)\n- Your Highlight on page 1 | Location 1 | Added on Sunday, January 1, 2024 12:00:00 PM\n\nhighlight\n==========\n";
        assert!(!is_kindle_clippings_text(single));
    }

    #[test]
    fn test_detector_requires_metadata_line() {
        // Has separators but no Kindle metadata line → not Kindle.
        let no_meta = "==========\n==========\n==========\n";
        assert!(!is_kindle_clippings_text(no_meta));
    }

    #[test]
    fn test_detector_empty_or_whitespace_file() {
        assert!(!is_kindle_clippings_text(""));
        assert!(!is_kindle_clippings_text("   \n\t\n   "));
    }

    #[test]
    fn test_detector_path_basename_mismatch() {
        // Correct Kindle content but wrong filename → false via basename gate.
        let f = write_temp(&sample_clipping_file());
        // NamedTempFile uses a random basename (no "my clippings" stem), so
        // the path-based detector must reject it on filename alone.
        assert!(!is_kindle_clippings_path(f.path()));
    }

    #[test]
    fn test_detector_path_correct_filename_and_content() {
        // Correct Kindle content AND correct filename → true.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("My Clippings.txt");
        std::fs::write(&path, sample_clipping_file()).expect("write");
        assert!(is_kindle_clippings_path(&path));
    }

    #[test]
    fn test_detector_path_correct_filename_non_kindle_content() {
        // Correct filename but non-Kindle content → false via content sniff.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("My Clippings.txt");
        std::fs::write(&path, "just some notes\nnot a kindle file\n").expect("write");
        assert!(!is_kindle_clippings_path(&path));
    }

    #[test]
    fn test_detector_path_filename_variants_match() {
        let dir = tempfile::tempdir().expect("temp dir");
        let content = sample_clipping_file();
        for name in [
            "my clippings.txt",
            "My Clippings.txt",
            "MY CLIPPINGS.txt",
            "my_clippings.txt",
            "my-clippings.txt",
            "My  Clippings.txt", // double space
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, &content).expect("write");
            assert!(
                basename_is_kindle_clippings(&path),
                "basename should match for {name}"
            );
            assert!(is_kindle_clippings_path(&path), "should detect {name}");
        }
    }

    #[test]
    fn test_detector_path_unrelated_txt_filename() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("notes.txt");
        // Even with Kindle content, the basename gate rejects unrelated names.
        std::fs::write(&path, sample_clipping_file()).expect("write");
        assert!(!basename_is_kindle_clippings(&path));
        assert!(!is_kindle_clippings_path(&path));
    }

    #[test]
    fn test_detector_latin1_encoded_real_sample() {
        // Build a small Kindle sample that contains a non-ASCII character
        // (U+00E9 é, which is 0xE9 in Latin-1 and 0xC3 0xA9 in UTF-8). Encode
        // it as Latin-1 so the UTF-8 decoder rejects it, then confirm the
        // bytes-based detector still recognises it via the Latin-1 fallback.
        let text = "Café Notes (Author)\n\
                    - Your Highlight on page 1 | Location 1 | Added on Sunday, January 1, 2024 12:00:00 PM\n\
                    \n\
                    Sample résumé highlight\n\
                    \n\
                    ==========\n\
                    Second Book (Other)\n\
                    - Your Note on page 2 | Location 2 | Added on Monday, February 5, 2024 9:00:00 AM\n\
                    \n\
                    Another note\n\
                    \n\
                    ==========\n";
        let latin1_bytes: Vec<u8> = text
            .chars()
            .map(|c| {
                let cp = c as u32;
                if cp <= 0xFF {
                    cp as u8
                } else {
                    // Outside Latin-1 range — substitute '?' to keep the test
                    // well-defined (none of the chars above exceed U+00FF).
                    b'?'
                }
            })
            .collect();
        // Sanity: the UTF-8 decoder must reject this, or we're not exercising
        // the fallback path at all.
        assert!(
            String::from_utf8(latin1_bytes.clone()).is_err(),
            "sample must be invalid UTF-8 to exercise the Latin-1 fallback"
        );
        assert!(is_kindle_clippings_bytes("My Clippings.txt", &latin1_bytes));
    }

    #[test]
    fn test_detector_bytes_filename_gate() {
        // Wrong filename with Kindle content → false via basename gate.
        let bytes = sample_clipping_file().into_bytes();
        assert!(!is_kindle_clippings_bytes("random.txt", &bytes));
    }

    // --- Integration tests for the import path (covers tasks 7.2 / 7.3) ---
    //
    // These exercise `do_import_kindle_clippings_from_text` (the shared
    // delegate used by the dedicated Kindle flow, the mobile bytes flow, AND
    // the generic document import path's `import_kindle_clippings_from_disk`)
    // against an in-memory SQLite Repository, so they verify the metadata the
    // generic path relies on (`kindle://<sha256>` file_path, `category =
    // "Kindle"`, `tags = ["kindle-import"]`, `metadata.source =
    // "kindle-clippings"`, content-hash dedup).

    fn multi_book_sample() -> String {
        // Two books, three importable clippings (2 highlights + 1 note) plus
        // a bookmark that should be skipped.
        r#"Atomic Habits (James Clear)
- Your Highlight on page 42 | Location 678-680 | Added on Sunday, January 15, 2024 3:45:22 PM

Highlight one from atomic habits.

==========
Deep Work (Cal Newport)
- Your Highlight on page 15 | Location 234-235 | Added on Monday, February 5, 2024 10:30:00 AM

Highlight two from deep work.

==========
Deep Work (Cal Newport)
- Your Note on page 50 | Location 800 | Added on Tuesday, February 6, 2024 2:15:00 PM

Note one on deep work.

==========
Deep Work (Cal Newport)
- Your Bookmark on page 100 | Location 1500 | Added on Wednesday, March 1, 2024 9:00:00 AM

==========
"#
        .to_string()
    }

    #[tokio::test]
    async fn test_import_creates_per_book_documents_with_correct_metadata() {
        // Task 7.2: importing a multi-book clippings file produces one
        // document per book with the metadata the generic import path relies
        // on for dedup and backfill.
        let repo = setup_repo().await;
        let result = do_import_kindle_clippings_from_text(
            &multi_book_sample(),
            &repo,
            None,
            None,
        )
        .await
        .expect("import");

        // Two distinct books → two documents.
        assert_eq!(result.new_documents, 2, "one document per book");
        assert_eq!(result.document_ids.len(), 2);
        assert!(result.new_extracts >= 3, "highlights + notes become extracts");

        for id in &result.document_ids {
            let doc = repo
                .get_document(id)
                .await
                .expect("db")
                .expect("document exists");
            assert!(
                doc.file_path.starts_with("kindle://"),
                "synthetic kindle:// path, got {}",
                doc.file_path
            );
            // Pin the file_type fix: Kindle docs must be markdown so the
            // viewer doesn't fall through to the "preview not available" wall
            // when `content` is stripped by the library list endpoint.
            assert_eq!(
                doc.file_type,
                FileType::Markdown,
                "Kindle docs must be typed as markdown, got {:?}",
                doc.file_type
            );
            assert_eq!(doc.category.as_deref(), Some("Kindle"));
            assert!(doc.tags.iter().any(|t| t == "kindle-import"));
            assert_eq!(
                doc.metadata.as_ref().and_then(|m| m.source.as_deref()),
                Some("kindle-clippings"),
                "metadata.source must be kindle-clippings for backfill to find it"
            );
        }
    }

    #[tokio::test]
    async fn test_import_is_idempotent_under_reimport() {
        // Task 7.2: re-importing the same file must not duplicate documents
        // or extracts. The content-hash dedup is what makes the generic import
        // path safe: users can drop the same `My Clippings.txt` again after
        // adding new highlights without polluting the library.
        let repo = setup_repo().await;
        let text = multi_book_sample();

        let first = do_import_kindle_clippings_from_text(&text, &repo, None, None)
            .await
            .expect("first import");
        let second = do_import_kindle_clippings_from_text(&text, &repo, None, None)
            .await
            .expect("re-import");

        // Second pass finds zero new docs and zero new extracts.
        assert_eq!(second.new_documents, 0, "no new docs on re-import");
        assert_eq!(second.new_extracts, 0, "no new extracts on re-import");
        // But it still reports the same affected document ids.
        assert_eq!(first.document_ids.len(), second.document_ids.len());
        // And the persisted extract count for each book didn't double.
        for id in &second.document_ids {
            let extracts = repo.list_extracts_by_document(id).await.expect("db");
            assert!(
                extracts.len() <= first.new_extracts,
                "re-import must not duplicate extracts; got {}",
                extracts.len()
            );
        }
    }

    #[tokio::test]
    async fn test_import_only_new_clippings_on_partial_reimport() {
        // Simulate a user who imported the file once, then added a new
        // highlight to the file on their Kindle and re-imported. Only the new
        // clipping should produce a new extract.
        let repo = setup_repo().await;

        let original = r#"Atomic Habits (James Clear)
- Your Highlight on page 42 | Location 678-680 | Added on Sunday, January 15, 2024 3:45:22 PM

Original highlight.

==========
Deep Work (Cal Newport)
- Your Highlight on page 15 | Location 234-235 | Added on Monday, February 5, 2024 10:30:00 AM

Another original highlight.

==========
"#
        .to_string();
        let _first = do_import_kindle_clippings_from_text(&original, &repo, None, None)
            .await
            .expect("first");

        let updated = format!(
            "{original}==========\nDeep Work (Cal Newport)\n- Your Highlight on page 99 | Location 999-1000 | Added on Thursday, March 14, 2024 1:00:00 PM\n\nA brand new highlight added later.\n\n==========\n"
        );
        let second =
            do_import_kindle_clippings_from_text(&updated, &repo, None, None)
                .await
                .expect("second");

        assert_eq!(second.new_documents, 0, "no new books on partial re-import");
        assert_eq!(
            second.new_extracts, 1,
            "exactly the one new highlight should be added"
        );
    }

    #[test]
    fn test_non_kindle_txt_falls_through_to_generic_path() {
        // Task 7.3 regression: a normal .txt file must NOT be detected as
        // Kindle clippings, so it falls through to the generic `.txt` import
        // path. (We test the detector here rather than `import_from_path`
        // because the latter needs a Tauri AppHandle; the detector is the
        // decision point that protects the generic path.)
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "just some plain text notes\nline two\n").expect("write");
        assert!(
            !is_kindle_clippings_path(&path),
            "plain .txt must not be mistaken for Kindle clippings"
        );
        // Even with the Kindle filename, non-Kindle content is rejected.
        let path2 = dir.path().join("My Clippings.txt");
        std::fs::write(&path2, "plain text masquerading under the Kindle name\n").expect("write");
        assert!(
            !is_kindle_clippings_path(&path2),
            "filename alone must not trigger Kindle import — content sniff gates it"
        );
    }

    #[tokio::test]
    async fn test_migration_repairs_existing_kindle_docs_to_markdown() {
        // Migration 064_kindle_clippings_docs_are_markdown repairs Kindle docs
        // that were imported before this fix and stored with file_type =
        // 'other'. We simulate the real-world sequence: run migrations up to
        // (but not including) 064, insert a legacy Kindle doc, then run 064
        // and confirm it flips the row to 'markdown' while leaving a
        // genuinely-other-typed control doc untouched.
        use crate::database::{Database, Repository};
        use sqlx::Row;
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");

        // Run all migrations EXCEPT 064 by deleting the migration from the
        // tracking set after applying 000-063. Easiest: apply everything,
        // then un-record 064 so the next run_migrations call will re-run it.
        // (Migrations are idempotent in schema terms — 064 is a pure UPDATE,
        // so re-running it on a freshly-migrated DB is safe.)
        db.migrate().await.expect("migrate through 063");
        let pool = db.pool();
        sqlx::query("DELETE FROM _schema_migrations WHERE name = '064_kindle_clippings_docs_are_markdown'")
            .execute(pool)
            .await
            .expect("un-record 064");
        let repo = Repository::new(pool.clone());

        // Insert a legacy Kindle doc with the pre-fix file_type = 'other'.
        let legacy_id = "legacy-kindle-doc-1";
        sqlx::query(
            r#"INSERT INTO documents (id, title, file_path, file_type, content, content_hash,
                                      date_added, date_modified, is_archived, is_favorite)
               VALUES (?1, ?2, ?3, 'other', ?4, ?5, ?6, ?6, 0, 0)"#,
        )
        .bind(legacy_id)
        .bind("Legacy Kindle Book")
        .bind("kindle://legacy-hash-abc")
        .bind("> a highlight")
        .bind("legacy-hash")
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .expect("insert legacy doc");

        // Control: a genuinely-other-typed doc with a real file path (NOT a
        // kindle:// path). The migration must leave this one alone.
        let control_id = "control-other-doc";
        sqlx::query(
            r#"INSERT INTO documents (id, title, file_path, file_type, content, content_hash,
                                      date_added, date_modified, is_archived, is_favorite)
               VALUES (?1, ?2, ?3, 'other', NULL, NULL, ?4, ?4, 0, 0)"#,
        )
        .bind(control_id)
        .bind("Some Other Doc")
        .bind("/tmp/real-file.dat")
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .expect("insert control doc");

        // Now run pending migrations — only 064 is un-recorded, so it fires.
        crate::database::migrations::run_migrations(pool)
            .await
            .expect("run_migrations");

        let legacy = repo.get_document(legacy_id).await.expect("db").expect("doc");
        assert_eq!(
            legacy.file_type,
            FileType::Markdown,
            "migration 064 must re-type legacy Kindle docs as markdown"
        );

        let control = repo.get_document(control_id).await.expect("db").expect("doc");
        assert_eq!(
            control.file_type,
            FileType::Other,
            "migration 064 must NOT touch non-Kindle other-typed docs"
        );
    }
}
