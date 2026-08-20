//! Minimal Hugging Face Hub API client (read-only, unauthenticated).
//!
//! Fetches repo info (`GET /api/models/{repo_id}`) and per-file LFS metadata
//! (`/raw/{revision}/{path}`), following the same probing pattern the legacy
//! `fetch_lfs_metadata` used for the pinned catalog. No auth is sent: only
//! public models are supported. Nothing in this module ever executes code from
//! a downloaded repository — it only reads JSON + plain-text metadata.

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const HF_API_BASE: &str = "https://huggingface.co/api/models";
pub const HF_RESOLVE_BASE: &str = "https://huggingface.co";

/// A parsed `owner/model[#revision]` input (either a bare id or a full URL).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepoInput {
    pub repo_id: String,
    pub revision: Option<String>,
}

/// Parse a user-supplied Hugging Face repo reference.
///
/// Accepts either a full URL (`https://huggingface.co/owner/model#rev`,
/// `https://huggingface.co/owner/model/tree/rev`, ...) or a bare
/// `owner/model` id with an optional `#revision` suffix. Rejects input that
/// does not look like a repo id (e.g. a bare "model" with no owner).
pub fn parse_repo_input(input: &str) -> Result<RepoInput> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Enter a Hugging Face repo id or URL"));
    }

    let mut rest = trimmed.to_string();

    // Strip a leading URL down to the repo id (and revision if it was encoded
    // as a path fragment on the resolve/tree URL).
    if let Ok(url) = url::Url::parse(trimmed) {
        let host = url.host_str().unwrap_or("");
        if !host.eq_ignore_ascii_case("huggingface.co") {
            return Err(anyhow!(
                "Only huggingface.co repositories are supported (got host {})",
                host
            ));
        }
        let mut segments: Vec<String> = url
            .path_segments()
            .map(|s| s.filter(|s| !s.is_empty()).map(|s| s.to_string()).collect())
            .unwrap_or_default();

        // Strip well-known trailing path segments (resolve/<rev>/..., tree/<rev>).
        while !segments.is_empty() {
            match segments[0].as_str() {
                "resolve" | "tree" | "blob" | "raw" if segments.len() >= 2 => {
                    segments.drain(..2);
                }
                "blobs" | "commits" | "revision" if segments.len() >= 2 => {
                    segments.drain(..2);
                }
                _ => break,
            }
        }

        if segments.len() < 2 {
            return Err(anyhow!(
                "Invalid Hugging Face repo URL: expected https://huggingface.co/owner/model"
            ));
        }
        let owner = segments.remove(0);
        let model = segments.remove(0);
        let repo_id = format!("{}/{}", owner, model);
        // Optional trailing `tree/<rev>` / `resolve/<rev>` carries the revision.
        let revision = match (segments.first().map(|s| s.as_str()), segments.get(1)) {
            (Some("tree"), Some(rev)) | (Some("resolve"), Some(rev)) | (Some("blob"), Some(rev)) => {
                Some(rev.clone())
            }
            _ => None,
        }
        .or_else(|| {
            url.fragment()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
        });
        return Ok(RepoInput { repo_id, revision });
    }

    // Bare `owner/model[#revision]`.
    let (id, fragment) = match trimmed.split_once('#') {
        Some((id, frag)) => (id, Some(frag.to_string())),
        None => (trimmed, None),
    };
    let id = id.trim_end_matches('/');
    let parts: Vec<&str> = id.split('/').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(anyhow!(
            "Invalid Hugging Face repo id '{id}'. Use the form owner/model (optionally #revision)."
        ));
    }
    Ok(RepoInput {
        repo_id: format!("{}/{}", parts[0], parts[1]),
        revision: fragment,
    })
}

/// A file entry listed in a repo's `siblings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfFile {
    pub rfilename: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub lfs: Option<HfLfsInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfLfsInfo {
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

/// Model card fields surfaced by `/api/models/{repo_id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfRepoInfo {
    pub id: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub sha: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub pipeline_tag: Option<String>,
    #[serde(default)]
    pub library_name: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub siblings: Vec<HfFile>,
    #[serde(default)]
    pub safetensors: Option<HfSafetensors>,
    #[serde(default)]
    pub card_data: Option<HfCardData>,
}

/// Parameter-count info from the `safetensors` block, when present.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfSafetensors {
    #[serde(default)]
    pub parameters: Option<HfSafetensorsParams>,
}

/// Parameter counts by dtype from the `safetensors.parameters` block. Field
/// names mirror HF's JSON (`F32`/`F16`/`BF16`/`I8`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HfSafetensorsParams {
    #[serde(default)]
    pub F32: Option<u64>,
    #[serde(default)]
    pub F16: Option<u64>,
    #[serde(default)]
    pub BF16: Option<u64>,
    #[serde(default)]
    pub I8: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HfCardData {
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub language: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pipeline_tag: Option<String>,
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
}

/// LFS / file metadata for a single path in a repo.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct FileMetadata {
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

/// True when the path looks like a subdirectory prefix of a repo path.
pub fn is_dir_prefix(path: &str) -> bool {
    path.ends_with('/')
}

/// A reqwest client tuned for HF hub requests (default headers, timeouts).
pub fn hf_client() -> Client {
    Client::builder()
        .user_agent("Plethora/2.7 (HF speech model manager)")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| Client::new())
}

/// Fetch repo info for `repo_id` (optionally pinned to a revision).
pub async fn fetch_repo_info(
    client: &Client,
    repo_id: &str,
    revision: Option<&str>,
) -> Result<HfRepoInfo> {
    let mut url = format!("{}/{}", HF_API_BASE, url_encode_segments(repo_id));
    if let Some(rev) = revision.filter(|r| !r.is_empty() && *r != "main") {
        url.push_str(&format!("?revision={}", url_encode(rev)));
    }
    let response = client.get(&url).send().await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(anyhow!(
            "Repository '{repo_id}' not found on Hugging Face (404). Check the id and spelling."
        ));
    }
    if !response.status().is_success() {
        return Err(anyhow!(
            "Hugging Face API returned {} for {repo_id}",
            response.status()
        ));
    }
    let info: HfRepoInfo = response.json().await?;
    if info.private {
        return Err(anyhow!(
            "Repository '{repo_id}' is private. Plethora can only install public models."
        ));
    }
    Ok(info)
}

/// Percent-encode `value` for use as a single URL path/query segment
/// (mirrors `fetch_repo_info`, which encodes the `revision` query param).
fn url_encode(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

/// Percent-encode each `/`-separated path segment independently, preserving
/// `/` as the URL path separator. Dot segments (`.`, `..`) are neutralized by
/// encoding their dots, because the `urlencoding` crate leaves `.` unencoded —
/// without this, a repo id or path of `../..` would keep its literal dots and
/// escape the URL path.
fn url_encode_segments(value: &str) -> String {
    value
        .split('/')
        .map(|segment| match segment {
            ".." => "%2E%2E".to_string(),
            "." => "%2E".to_string(),
            other => url_encode(other),
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Fetch LFS/file metadata for one file path at a revision.
///
/// Mirrors the legacy `fetch_lfs_metadata` probe: request the `/raw/{revision}/
/// {path}` plain-text pointer and parse `oid sha256:` + `size` lines. Files
/// that are not LFS-tracked return `None` for both (the API `siblings` list
/// still usually carries their size).
pub async fn fetch_file_metadata(
    client: &Client,
    repo_id: &str,
    revision: &str,
    path: &str,
) -> Result<FileMetadata> {
    let raw_url = format!(
        "{}/{}/raw/{}/{}",
        HF_RESOLVE_BASE,
        repo_id,
        url_encode(revision),
        url_encode_segments(path.trim_start_matches('/'))
    );
    let response = client.get(&raw_url).send().await?;
    if !response.status().is_success() {
        return Ok(FileMetadata::default());
    }
    let body = response.text().await.unwrap_or_default();

    let mut sha256 = None;
    let mut size = None;
    for line in body.lines() {
        if let Some(hash) = line.strip_prefix("oid sha256:") {
            sha256 = Some(hash.trim().to_string());
        } else if let Some(sz) = line.strip_prefix("size ") {
            size = sz.trim().parse::<u64>().ok();
        }
    }
    Ok(FileMetadata { size, sha256 })
}

/// Resolve a raw download URL for a file at a revision.
///
/// `repo_id` (per segment), `revision` (as a whole) and `path` (per segment)
/// are all percent-encoded so hostile values like `#../..` can never flow raw
/// into the URL and change its meaning.
pub fn resolve_download_url(repo_id: &str, revision: &str, path: &str) -> String {
    format!(
        "{}/{}/resolve/{}/{}",
        HF_RESOLVE_BASE,
        url_encode_segments(repo_id),
        url_encode(revision),
        url_encode_segments(path.trim_start_matches('/'))
    )
}

/// Canonical-safe install directory name for a repo id + runtime.
pub fn safe_dir_name(repo_id: &str, revision: &str) -> String {
    let base = repo_id.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', ' '], "_");
    let rev = if revision.is_empty() || revision == "main" {
        String::new()
    } else {
        format!("@{}", revision.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', ' '], "_"))
    };
    format!("{}{}", base, rev)
}

/// Strip a leading `#` from a fragment-style revision.
pub fn clean_revision(revision: &str) -> String {
    revision.trim_start_matches('#').to_string()
}

/// Best-effort parameter count from the safetensors block (total or sum of
/// typed tensors), in millions of parameters.
pub fn params_millions(info: &HfRepoInfo) -> Option<u64> {
    let total = info
        .safetensors
        .as_ref()
        .and_then(|s| s.parameters.as_ref())
        .and_then(|p| p.total);
    if let Some(t) = total {
        return Some((t as f64 / 1_000_000.0).round() as u64);
    }
    let sum = info
        .safetensors
        .as_ref()
        .and_then(|s| s.parameters.as_ref())
        .map(|p| {
            p.F32.unwrap_or(0)
                + p.F16.unwrap_or(0)
                + p.BF16.unwrap_or(0)
                + p.I8.unwrap_or(0)
        });
    sum.filter(|s| *s > 0)
        .map(|s| (s as f64 / 1_000_000.0).round() as u64)
}

/// Extract a human-friendly model name from a repo id (last path segment).
pub fn repo_display_name(repo_id: &str) -> String {
    repo_id
        .rsplit('/')
        .next()
        .unwrap_or(repo_id)
        .to_string()
}

/// Compute the total download size of a file set from LFS/siblings metadata,
/// falling back to the artifact's declared size where the repo is opaque.
pub fn file_size_for(file: &HfFile) -> Option<u64> {
    if let Some(lfs) = file.lfs.as_ref() {
        if let Some(s) = lfs.size {
            return Some(s);
        }
    }
    file.size
}

/// Split a repo-relative path into components (used by adapters to walk dirs).
pub fn path_components(path: &str) -> Vec<String> {
    path.trim_start_matches('/')
        .split('/')
        .filter(|p| !p.is_empty() && !p.starts_with('.'))
        .map(|p| p.to_string())
        .collect()
}

/// The file name (last path segment) of a repo path.
pub fn file_name(path: &str) -> String {
    Path::new(path.trim_end_matches('/'))
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// A lazily-resolved view over a repo's files + LFS metadata, so adapters can
/// query sizes/hashes without extra IO.
#[derive(Debug, Clone, Default)]
pub struct FileIndex {
    /// repo-relative path -> file entry
    pub files: Vec<HfFile>,
    /// repo-relative path -> resolved size/sha256 (LFS or siblings)
    pub metadata: std::collections::HashMap<String, FileMetadata>,
}

impl FileIndex {
    pub fn size_of(&self, path: &str) -> Option<u64> {
        self.metadata
            .get(path)
            .and_then(|m| m.size)
            .or_else(|| self.files.iter().find(|f| f.rfilename == path).and_then(file_size_for))
    }

    pub fn sha_of(&self, path: &str) -> Option<String> {
        self.metadata
            .get(path)
            .and_then(|m| m.sha256.clone())
            .or_else(|| {
                self.files
                    .iter()
                    .find(|f| f.rfilename == path)
                    .and_then(|f| f.lfs.as_ref())
                    .and_then(|l| l.sha256.clone())
            })
    }

    /// All repo-relative paths (sorted, deduped).
    pub fn paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self.files.iter().map(|f| f.rfilename.clone()).collect();
        paths.extend(self.metadata.keys().cloned());
        paths.sort();
        paths.dedup();
        paths
    }

    pub fn has_file(&self, path: &str) -> bool {
        self.paths().iter().any(|p| p == path)
    }

    /// A path whose file name equals `name` (any directory).
    pub fn find_file_named(&self, name: &str) -> Option<String> {
        self.paths()
            .into_iter()
            .find(|p| file_name(p).eq_ignore_ascii_case(name))
    }

    /// All file names (last path segments) present in the repo.
    pub fn all_file_names(&self) -> Vec<String> {
        self.paths().iter().map(|p| file_name(p)).collect()
    }

    /// Find a file whose name matches the given predicate.
    pub fn find_file(&self, pred: impl Fn(&str) -> bool) -> Option<String> {
        self.paths().into_iter().find(|p| pred(&file_name(p)))
    }
}

/// Enrich a repo's file list with LFS pointer metadata (size + sha256) for the
/// files adapters care about. Bounded to the candidate set so inspection stays
/// fast even for huge repos.
pub async fn build_file_index(
    client: &Client,
    repo_id: &str,
    revision: &str,
    info: &HfRepoInfo,
) -> FileIndex {
    let mut pending: Vec<String> = info
        .siblings
        .iter()
        .map(|f| f.rfilename.clone())
        .filter(|p| {
            let lower = p.to_lowercase();
            lower.ends_with(".onnx")
                || lower.ends_with(".bin")
                || lower.ends_with(".json")
                || lower == "tokens.txt"
                || lower == "lexicon.txt"
                || lower == "voices.bin"
        })
        .collect();
    for name in ["tokens.txt", "tokens.json", "lexicon.txt", "voices.bin"] {
        pending.push(name.to_string());
    }
    pending.sort();
    pending.dedup();

    let mut metadata = std::collections::HashMap::new();
    for path in pending {
        if let Ok(m) = fetch_file_metadata(client, repo_id, revision, &path).await {
            metadata.insert(path, m);
        }
    }
    FileIndex {
        files: info.siblings.clone(),
        metadata,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_repo_id() {
        let p = parse_repo_input("ggerganov/whisper.cpp").unwrap();
        assert_eq!(p.repo_id, "ggerganov/whisper.cpp");
        assert_eq!(p.revision, None);
    }

    #[test]
    fn parses_repo_id_with_revision() {
        let p = parse_repo_input("ggerganov/whisper.cpp#main").unwrap();
        assert_eq!(p.repo_id, "ggerganov/whisper.cpp");
        assert_eq!(p.revision.as_deref(), Some("main"));
    }

    #[test]
    fn parses_full_url_with_fragment_revision() {
        let p = parse_repo_input("https://huggingface.co/ggerganov/whisper.cpp#main").unwrap();
        assert_eq!(p.repo_id, "ggerganov/whisper.cpp");
        assert_eq!(p.revision.as_deref(), Some("main"));
    }

    #[test]
    fn parses_full_url_without_fragment() {
        let p = parse_repo_input("https://huggingface.co/openai/whisper-tiny").unwrap();
        assert_eq!(p.repo_id, "openai/whisper-tiny");
        assert_eq!(p.revision, None);
    }

    #[test]
    fn parses_tree_url_revision() {
        let p = parse_repo_input("https://huggingface.co/foo/bar/tree/feature-branch").unwrap();
        assert_eq!(p.repo_id, "foo/bar");
        assert_eq!(p.revision.as_deref(), Some("feature-branch"));
    }

    #[test]
    fn rejects_non_hf_host() {
        let err = parse_repo_input("https://example.com/foo/bar").unwrap_err();
        assert!(err.to_string().contains("huggingface.co"));
    }

    #[test]
    fn rejects_single_segment_id() {
        assert!(parse_repo_input("whisper").is_err());
    }

    #[test]
    fn rejects_empty() {
        assert!(parse_repo_input("  ").is_err());
    }

    #[test]
    fn safe_dir_name_sanitizes() {
        assert_eq!(safe_dir_name("ggerganov/whisper.cpp", "main"), "ggerganov_whisper.cpp");
        assert!(safe_dir_name("a/b", "feature/x").contains('@'));
    }

    #[test]
    fn file_name_extracts_last_segment() {
        assert_eq!(file_name("ggml/ggml-base.bin"), "ggml-base.bin");
        assert_eq!(file_name("tokens.txt"), "tokens.txt");
    }

    #[test]
    fn resolve_download_url_encodes_revision_and_path() {
        // A hostile `#../..`-style revision must be encoded, never raw.
        let url = resolve_download_url("owner/model", "../..", "model.onnx");
        assert!(!url.contains("resolve/../.."), "raw traversal leaked: {url}");
        assert!(url.contains("resolve/%2E%2E%2F%2E%2E/") || url.contains("resolve/..%2F../"), "{url}");

        // Legit subdirectory paths keep `/` as separators after encoding.
        let url = resolve_download_url("owner/model", "main", "ggml/ggml-base.bin");
        assert!(url.ends_with("/resolve/main/ggml/ggml-base.bin"), "{url}");

        // A revision with a slash (branch names) is encoded as a whole.
        let url = resolve_download_url("owner/model", "feature/x", "model.onnx");
        assert!(url.contains("feature%2Fx"), "{url}");

        // Leading slashes are trimmed before joining.
        let url = resolve_download_url("owner/model", "main", "/etc/passwd");
        assert!(url.ends_with("/resolve/main/etc/passwd"), "{url}");

        // Repo id segments are percent-encoded so a hostile `../..` in the id
        // can never escape the URL path (defense in depth).
        let url = resolve_download_url("../evil/model", "main", "model.onnx");
        assert!(!url.contains("/../"), "raw traversal leaked via repo id: {url}");
        assert!(url.contains("/%2E%2E/evil/model/"), "{url}");
    }
}
