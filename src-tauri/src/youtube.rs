//! YouTube integration using yt-dlp
//!
//! This module provides functionality to interact with YouTube videos
//! through the yt-dlp command-line tool.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, State};

use crate::database::Repository;
use crate::models::{Document, DocumentMetadata, FileType};

pub mod captions;
pub mod innertube;
pub use innertube::{fetch_youtube_transcript_on_device_internal, OnDeviceTranscriptResult};

/// Bump when the shape/quality of cached `segments_json` changes in a way that
/// makes previously cached rows stale (e.g. word timings were not captured yet).
pub const YOUTUBE_WORD_TIMINGS_VERSION: i32 = 1;

/// YouTube video metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeVideoInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub channel: String,
    pub channel_id: Option<String>,
    pub duration: u64,
    pub view_count: u64,
    pub upload_date: String,
    pub thumbnail: String,
    pub publish_date: String,
    pub tags: Vec<String>,
    pub category: String,
    pub live_content: bool,
}

/// YouTube format info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeFormat {
    pub format_id: String,
    pub ext: String,
    pub quality: String,
    pub filesize: Option<u64>,
    pub vcodec: String,
    pub acodec: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
}

/// Per-word timing for karaoke highlighting. Field names deliberately match the
/// podcast word-timing JSON (`{word,start_ms,end_ms}`) so the frontend's shared
/// `findActiveWordIndex` can be reused verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordTiming {
    pub word: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// YouTube transcript segment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub text: String,
    pub start: f64,
    pub duration: f64,
    /// Measured per-word timings. Absent (never `null`) when the caption source
    /// carried no per-word offsets, keeping legacy cached blobs byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<WordTiming>>,
}

pub fn build_transcript_text(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_transcript_text_with_chapters(
    segments: &[TranscriptSegment],
    chapters: &[crate::commands::video::VideoChapter],
) -> String {
    if chapters.is_empty() {
        return build_transcript_text(segments);
    }

    let mut result = String::new();
    let mut current_chapter_index: Option<usize> = None;

    for segment in segments {
        // Find which chapter this segment belongs to
        let matched_chapter_idx = chapters
            .iter()
            .position(|ch| segment.start >= ch.start_time && segment.start < ch.end_time);

        if let Some(idx) = matched_chapter_idx {
            if current_chapter_index != Some(idx) {
                current_chapter_index = Some(idx);
                let chapter = &chapters[idx];
                if !result.is_empty() {
                    result.push_str("\n\n");
                }
                result.push_str(&format!("Chapter {}: {}\n\n", idx + 1, chapter.title));
            }
        }

        let trimmed_text = segment.text.trim();
        if !trimmed_text.is_empty() {
            if !result.is_empty() && !result.ends_with('\n') {
                result.push(' ');
            }
            result.push_str(trimmed_text);
        }
    }

    result
}

fn parse_transcript_segments(json: &str) -> Result<Vec<TranscriptSegment>, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse transcript cache: {}", e))
}

/// A cached transcript row may be served as-is when it was written by a build that
/// already captured word timings, or when it is the empty "no captions" sentinel
/// (re-fetching that one on every open would hammer the network for nothing).
fn is_transcript_cache_fresh(segments_json: &str, version: i32) -> bool {
    version >= YOUTUBE_WORD_TIMINGS_VERSION || segments_json.trim() == "[]"
}

/// Download options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub quality: String,
    pub format: String,
    pub output_template: String,
    pub subtitles: bool,
    pub auto_captions: bool,
    pub embed_subs: bool,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        Self {
            quality: "best".to_string(),
            format: "bestvideo+bestaudio/best".to_string(),
            output_template: "%(title)s.%(ext)s".to_string(),
            subtitles: true,
            auto_captions: true,
            embed_subs: false,
        }
    }
}

/// Check if yt-dlp is installed
pub fn check_ytdlp_installed() -> Result<bool, String> {
    // Reuse the same binary resolution logic as the actual yt-dlp commands.
    let output = ytdlp_command()?.arg("--version").output();

    match output {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get the yt-dlp binary path, trying common locations before PATH lookup
fn resolve_ytdlp_path() -> &'static str {
    for path in [
        "/usr/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
        "/opt/homebrew/bin/yt-dlp",
    ] {
        if std::path::Path::new(path).exists() {
            return path;
        }
    }
    "yt-dlp"
}

/// Get the path where yt-dlp should be installed
fn get_ytdlp_install_path() -> Result<PathBuf, String> {
    let app_dir = dirs::data_dir()
        .ok_or("Could not find data directory")?
        .join("incrementum")
        .join("bin");

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create bin directory: {}", e))?;

    #[cfg(target_os = "windows")]
    let binary_name = "yt-dlp.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "yt-dlp";

    Ok(app_dir.join(binary_name))
}

/// Check if yt-dlp is installed in the app directory
pub fn check_ytdlp_in_app_dir() -> Result<bool, String> {
    match get_ytdlp_install_path() {
        Ok(path) => Ok(path.exists()),
        Err(_) => Ok(false),
    }
}

/// Get the path to yt-dlp binary (checks both system and app directory)
pub fn get_ytdlp_binary_path() -> Result<PathBuf, String> {
    // First check if it's in the app directory
    if let Ok(path) = get_ytdlp_install_path() {
        if path.exists() {
            return Ok(path);
        }
    }

    // Try common absolute paths before falling back to PATH lookup.
    Ok(PathBuf::from(resolve_ytdlp_path()))
}

/// Create a Command for yt-dlp with the correct binary path
fn ytdlp_command() -> Result<Command, String> {
    let path = get_ytdlp_binary_path()?;
    let mut cmd = Command::new(path);
    sanitize_python_env(&mut cmd);
    Ok(cmd)
}

/// Clear Python-related environment variables that AppImage can leak into
/// subprocesses. System `yt-dlp` is often a Python entrypoint script, and these
/// variables can make it fail to import the standard library.
fn sanitize_python_env(cmd: &mut Command) {
    for key in [
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONUSERBASE",
        "PYTHONNOUSERSITE",
        "PYTHONEXECUTABLE",
        "__PYVENV_LAUNCHER__",
        "VIRTUAL_ENV",
    ] {
        cmd.env_remove(key);
    }
}

/// Auto-setup yt-dlp by downloading it
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub async fn setup_ytdlp() -> Result<String, String> {
    let install_path = get_ytdlp_install_path()?;

    // Determine download URL based on platform
    let download_url = {
        #[cfg(target_os = "windows")]
        {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        }
        #[cfg(target_os = "macos")]
        {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        }
        #[cfg(target_os = "linux")]
        {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
        }
    };

    // Download the binary
    let response = reqwest::get(download_url)
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download data: {}", e))?;

    std::fs::write(&install_path, bytes)
        .map_err(|e| format!("Failed to write yt-dlp binary: {}", e))?;

    // Make it executable on Unix systems
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&install_path)
            .map_err(|e| format!("Failed to get metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&install_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Verify installation
    let version = tokio::task::spawn_blocking(move || get_ytdlp_version_from_path(&install_path))
        .await
        .map_err(|e| format!("yt-dlp version check task join error: {}", e))??;

    Ok(version)
}

/// Stub for unsupported platforms
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub async fn setup_ytdlp() -> Result<String, String> {
    Err("Automatic yt-dlp setup is not supported on this platform".to_string())
}

/// Get yt-dlp version from a specific path
fn get_ytdlp_version_from_path(path: &PathBuf) -> Result<String, String> {
    let mut cmd = Command::new(path);
    sanitize_python_env(&mut cmd);
    let output = cmd
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        return Err("yt-dlp command failed".to_string());
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(version)
}

/// Get yt-dlp version
pub fn get_ytdlp_version() -> Result<String, String> {
    let output = ytdlp_command()?
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        return Err("yt-dlp command failed".to_string());
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(version)
}

/// Extract video info using yt-dlp
pub fn extract_video_info(url: &str) -> Result<YouTubeVideoInfo, String> {
    let output = ytdlp_command()?
        .args(["--dump-json", "--no-playlist", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", error));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    Ok(parse_video_json(&json))
}

/// Parse video JSON from yt-dlp
fn parse_video_json(json: &serde_json::Value) -> YouTubeVideoInfo {
    let id = json["id"].as_str().unwrap_or("").to_string();
    let title = json["title"].as_str().unwrap_or("Unknown").to_string();
    let description = json["description"].as_str().unwrap_or("").to_string();
    let channel = json["channel"].as_str().unwrap_or("Unknown").to_string();
    let channel_id = json["channel_id"].as_str().map(|s| s.to_string());
    let duration = json["duration"].as_u64().unwrap_or(0);
    let view_count = json["view_count"].as_u64().unwrap_or(0);
    let upload_date = json["upload_date"].as_str().unwrap_or("").to_string();
    let thumbnail = json["thumbnail"].as_str().unwrap_or("").to_string();
    let tags = json["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let category = json["categories"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let live_content = json["is_live"].as_bool().unwrap_or(false);

    // Format publish date
    let publish_date = if upload_date.len() >= 8 {
        format!(
            "{}-{}-{}",
            &upload_date[0..4],
            &upload_date[4..6],
            &upload_date[6..8]
        )
    } else {
        String::new()
    };

    YouTubeVideoInfo {
        id,
        title,
        description,
        channel,
        channel_id,
        duration,
        view_count,
        upload_date,
        thumbnail,
        publish_date,
        tags,
        category,
        live_content,
    }
}

/// Get available formats for a video
pub fn get_video_formats(url: &str) -> Result<Vec<YouTubeFormat>, String> {
    let output = ytdlp_command()?
        .args(["--dump-json", "--list-formats", "--no-playlist", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", error));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let formats = json["formats"].as_array().ok_or("No formats found")?;

    let result = formats
        .iter()
        .filter_map(|f| {
            Some(YouTubeFormat {
                format_id: f["format_id"].as_str()?.to_string(),
                ext: f["ext"].as_str()?.to_string(),
                quality: f["format_note"]
                    .as_str()
                    .or(f["format"].as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                filesize: f["filesize"].as_u64(),
                vcodec: f["vcodec"]
                    .as_str()
                    .or(f["vcodec"].as_str())
                    .unwrap_or("none")
                    .to_string(),
                acodec: f["acodec"]
                    .as_str()
                    .or(f["acodec"].as_str())
                    .unwrap_or("none")
                    .to_string(),
                width: f["width"].as_u64().map(|w| w as u32),
                height: f["height"].as_u64().map(|h| h as u32),
                fps: f["fps"].as_u64().map(|f| f as u32),
            })
        })
        .collect();

    Ok(result)
}

/// Download video with options and cut sponsored segments if present
pub async fn download_video(
    app_handle: &AppHandle,
    url: &str,
    output_dir: PathBuf,
    options: &DownloadOptions,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let output_path = output_dir.join(&options.output_template);

    let output_path_str = output_path
        .to_str()
        .expect("output path is valid UTF-8")
        .to_string();
    let url_for_name = url.to_string();
    let name_output =
        tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
            let mut name_cmd = ytdlp_command()?;
            name_cmd.args([
                "--get-filename",
                "-o",
                output_path_str.as_str(),
                url_for_name.as_str(),
            ]);
            name_cmd
                .output()
                .map_err(|e| format!("Failed to run yt-dlp to get filename: {}", e))
        })
        .await
        .map_err(|e| format!("yt-dlp filename task join error: {}", e))??;
    if !name_output.status.success() {
        let err = String::from_utf8_lossy(&name_output.stderr);
        return Err(format!("Failed to determine download filename: {}", err));
    }
    let final_filepath_str = String::from_utf8_lossy(&name_output.stdout)
        .trim()
        .to_string();
    let final_filepath = PathBuf::from(&final_filepath_str);

    let video_id = extract_video_id(url);
    let mut segments = Vec::new();
    if let Some(ref vid) = video_id {
        if let Ok(segs) = crate::sponsorblock::fetch_sponsorblock_segments(vid).await {
            segments = segs;
        }
    }

    let mut download_filepath = final_filepath.clone();
    if !segments.is_empty() {
        // Download to a temporary raw file first
        let ext = final_filepath
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4");
        download_filepath = final_filepath.with_extension(format!("raw.{}", ext));
    }

    let download_filepath_str = download_filepath
        .to_str()
        .expect("download path is valid UTF-8")
        .to_string();
    let format_arg = options.format.clone();
    let subtitles = options.subtitles;
    let auto_captions = options.auto_captions;
    let embed_subs = options.embed_subs;
    let url_for_download = url.to_string();
    let output = tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        let mut cmd = ytdlp_command()?;
        cmd.arg("-f").arg(format_arg);
        cmd.arg("-o").arg(download_filepath_str);

        if subtitles {
            cmd.arg("--write-subs");
            cmd.arg("--sub-lang").arg("en");
        }
        if auto_captions {
            cmd.arg("--write-auto-subs");
        }
        if embed_subs {
            cmd.arg("--embed-subs");
        }

        cmd.arg(url_for_download);

        cmd.output()
            .map_err(|e| format!("Failed to run yt-dlp: {}", e))
    })
    .await
    .map_err(|e| format!("yt-dlp download task join error: {}", e))??;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp download failed: {}", error));
    }

    // Cut sponsored segments if present
    if !segments.is_empty() {
        println!("[SponsorBlock] Cutting downloaded YouTube video...");
        match crate::sponsorblock::cut_audio_file(
            app_handle,
            &download_filepath,
            &final_filepath,
            &segments,
        )
        .await
        {
            Ok(cuts) => {
                if let Some(ref vid) = video_id {
                    let _ = crate::sponsorblock::save_cuts_metadata(vid, &cuts);
                    // Also save cuts metadata by final filename to allow easy local lookup
                    if let Some(name) = final_filepath.file_name().and_then(|n| n.to_str()) {
                        let _ = crate::sponsorblock::save_cuts_metadata(name, &cuts);
                    }
                }
                let _ = std::fs::remove_file(&download_filepath);
            }
            Err(e) => {
                eprintln!(
                    "[SponsorBlock] YouTube video cutting failed: {}. Falling back to uncut.",
                    e
                );
                std::fs::rename(&download_filepath, &final_filepath).map_err(|rename_err| {
                    format!("Failed to save uncut fallback file: {}", rename_err)
                })?;
            }
        }
    }

    Ok(final_filepath)
}

/// Try to run yt-dlp with browser cookies from common browsers
fn try_with_browser_cookies(url: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let browsers = [
        "chrome", "firefox", "safari", "edge", "brave", "vivaldi", "opera",
    ];

    // First try without cookies
    let output = ytdlp_command()?
        .args(args)
        .arg(url)
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    // If successful or not a bot error, return as-is
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() && !stderr.contains("Sign in to confirm") {
        return Ok(output);
    }

    // Try with each browser's cookies
    for browser in &browsers {
        let cookie_output = ytdlp_command().and_then(|mut cmd| {
            cmd.args(args)
                .arg("--cookies-from-browser")
                .arg(browser)
                .arg(url);
            cmd.output()
                .map_err(|e| format!("Failed to run yt-dlp: {}", e))
        });

        match cookie_output {
            Ok(result) => {
                let result_stderr = String::from_utf8_lossy(&result.stderr);
                // If successful and no bot error, use this result
                if result.status.success() && !result_stderr.contains("Sign in to confirm") {
                    eprintln!("Successfully used cookies from {}", browser);
                    return Ok(result);
                }
                // If browser not found error, try next browser
                if result_stderr.contains("could not find")
                    || result_stderr.contains("not installed")
                {
                    continue;
                }
            }
            Err(_) => continue,
        }
    }

    if !output.status.success() || stderr.contains("Sign in to confirm") {
        return Err("YouTube is requiring sign-in to access this video.\n\n\
            To fix this:\n\
            1. Open YouTube in your browser (Chrome, Firefox, Safari, or Edge)\n\
            2. Watch any video for 10-20 seconds\n\
            3. Try again in the app\n\n\
            The app will automatically use your browser cookies if available."
            .to_string());
    }

    Ok(output)
}

/// Extract transcript using yt-dlp
pub fn extract_transcript(
    url: &str,
    language: Option<&str>,
) -> Result<Vec<TranscriptSegment>, String> {
    let temp_dir = std::env::temp_dir();
    let lang = language.unwrap_or("en");

    // Try to get video info with browser cookies first (helps avoid bot detection)
    let info_output = try_with_browser_cookies(url, &["--print", "%(id)s", "--no-playlist"])?;

    let video_id = String::from_utf8_lossy(&info_output.stdout)
        .trim()
        .to_string();

    // Download subtitles using yt-dlp with browser cookies
    let output_template = format!("{}/%(id)s", temp_dir.to_string_lossy());
    let subtitle_args = vec![
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        lang,
        "--sub-format",
        "json3/vtt",
        "--skip-download",
        "--no-playlist",
        "-o",
        &output_template,
    ];

    let output = try_with_browser_cookies(url, &subtitle_args)?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    // If subtitles aren't available, return empty rather than error
    if !output.status.success()
        && (stderr.contains("Subtitles not available")
            || stderr.contains("video doesn't have subtitles")
            || stderr.contains("Could not find automatic captions"))
    {
        return Ok(vec![]);
    }

    // Look for subtitle files with various naming patterns.
    // `--sub-format json3/vtt` prefers json3 (it carries per-word `tOffsetMs`),
    // so json3 candidates must be probed before the vtt ones.
    let subtitle_patterns = subtitle_file_candidates(&video_id, lang);

    for pattern in &subtitle_patterns {
        let path = temp_dir.join(pattern);
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let parsed = parse_subtitle_file(pattern, &content);
                let _ = std::fs::remove_file(&path); // Clean up
                if !parsed.is_empty() {
                    return Ok(parsed);
                }
            }
        }
    }

    // Also check for any files starting with video_id in temp dir
    let subtitle_files =
        std::fs::read_dir(&temp_dir).map_err(|e| format!("Failed to read temp dir: {}", e))?;

    // Collect first so the preferred (json3) extension can be tried before vtt/srt.
    let mut candidates: Vec<(usize, PathBuf, String)> = Vec::new();
    for entry in subtitle_files.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if !name.starts_with(&video_id) {
                continue;
            }
            if let Some(rank) = SUBTITLE_EXTENSIONS
                .iter()
                .position(|ext| name.ends_with(ext))
            {
                candidates.push((rank, path.clone(), name.to_string()));
            }
        }
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));

    for (_, path, name) in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let parsed = parse_subtitle_file(&name, &content);

            let _ = std::fs::remove_file(&path);

            if !parsed.is_empty() {
                return Ok(parsed);
            }
        }
    }

    Ok(vec![])
}

/// Subtitle file extensions yt-dlp may produce, in order of preference.
/// json3 first: it is the only format carrying per-word `tOffsetMs` offsets.
const SUBTITLE_EXTENSIONS: &[&str] = &[".json3", ".json", ".vtt", ".srt"];

/// Candidate subtitle file names yt-dlp may have written, most preferred first.
fn subtitle_file_candidates(video_id: &str, lang: &str) -> Vec<String> {
    let short_lang = lang.split('-').next().unwrap_or(lang);
    let mut candidates: Vec<String> = Vec::new();
    for ext in SUBTITLE_EXTENSIONS {
        candidates.push(format!("{}.{}{}", video_id, lang, ext));
        if short_lang != lang {
            candidates.push(format!("{}.{}{}", video_id, short_lang, ext));
        }
        candidates.push(format!("{}{}", video_id, ext));
    }
    candidates
}

/// Dispatch a downloaded subtitle file to the right parser by extension.
fn parse_subtitle_file(file_name: &str, content: &str) -> Vec<TranscriptSegment> {
    if file_name.ends_with(".json3") || file_name.ends_with(".json") {
        captions::parse_json3_captions(content)
    } else if file_name.ends_with(".srt") {
        parse_srt(content)
    } else {
        captions::parse_vtt_with_words(content)
    }
}

/// Parse timestamp line from VTT
pub(crate) fn parse_timestamp_line(line: &str) -> Option<(f64, f64)> {
    let parts: Vec<&str> = line.split("-->").collect();
    if parts.len() != 2 {
        return None;
    }

    let start = parse_vtt_timestamp(parts[0].trim())?;
    let end = parse_vtt_timestamp(
        parts[1]
            .split_whitespace()
            .next()
            .unwrap_or(parts[1].trim()),
    )?;

    Some((start, end))
}

/// Parse VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm)
pub(crate) fn parse_vtt_timestamp(ts: &str) -> Option<f64> {
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }

    let seconds_part = parts.last()?;
    let seconds: f64 = seconds_part.parse().ok()?;

    if parts.len() == 3 {
        let hours: f64 = parts[0].parse().ok()?;
        let minutes: f64 = parts[1].parse().ok()?;
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    } else if parts.len() == 2 {
        let minutes: f64 = parts[0].parse().ok()?;
        Some(minutes * 60.0 + seconds)
    } else {
        Some(seconds)
    }
}

/// Clean VTT text - remove formatting tags
fn clean_vtt_text(text: &str) -> String {
    let cleaned = text.to_string();

    let mut result = String::new();
    let mut in_tag = false;
    let mut tag_chars = Vec::new();

    for ch in cleaned.chars() {
        if ch == '<' {
            in_tag = true;
            tag_chars.clear();
        } else if ch == '>' {
            in_tag = false;
            tag_chars.clear();
        } else if in_tag {
            tag_chars.push(ch);
        } else {
            result.push(ch);
        }
    }

    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parse SRT format
fn parse_srt(content: &str) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    let blocks: Vec<&str> = content.split("\n\n").collect();

    for block in blocks {
        let lines: Vec<&str> = block.lines().collect();
        if lines.len() < 3 {
            continue;
        }

        // Skip index line (first line)
        // Parse timestamp line (second line)
        let ts_line = lines.get(1).unwrap_or(&"");
        if let Some((start, end)) = parse_srt_timestamp_line(ts_line) {
            // Collect remaining lines as text
            let text: String = lines[2..]
                .iter()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(clean_vtt_text)
                .collect::<Vec<_>>()
                .join(" ");

            if !text.is_empty() {
                segments.push(TranscriptSegment {
                    text,
                    start,
                    duration: end - start,
                    words: None,
                });
            }
        }
    }

    segments
}

/// Parse SRT timestamp line: 00:00:00,000 --> 00:00:02,500
fn parse_srt_timestamp_line(line: &str) -> Option<(f64, f64)> {
    let parts: Vec<&str> = line.split("-->").collect();
    if parts.len() != 2 {
        return None;
    }

    let start = parse_srt_timestamp(parts[0].trim())?;
    let end = parse_srt_timestamp(parts[1].trim())?;

    Some((start, end))
}

/// Parse SRT timestamp (HH:MM:SS,mmm or MM:SS,mmm)
fn parse_srt_timestamp(ts: &str) -> Option<f64> {
    let ts_normalized = ts.replace(',', ".");
    let parts: Vec<&str> = ts_normalized.split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }

    let seconds: f64 = parts.last()?.parse().ok()?;

    if parts.len() == 3 {
        let hours: f64 = parts[0].parse().ok()?;
        let minutes: f64 = parts[1].parse().ok()?;
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    } else if parts.len() == 2 {
        let minutes: f64 = parts[0].parse().ok()?;
        Some(minutes * 60.0 + seconds)
    } else {
        Some(seconds)
    }
}

/// Search YouTube (requires API key for full results)
pub fn search_youtube(
    query: &str,
    _api_key: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    // yt-dlp can do basic search without API key
    let output = ytdlp_command()?
        .args(["ytsearch5:", query, "--dump-json", "--flat-playlist"])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Search failed: {}", error));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let entries = json["entries"].as_array().ok_or("No search results")?;

    Ok(entries.clone())
}

/// Get playlist info
///
/// Uses --flat-playlist to get simplified video list, then fetches detailed info
pub fn get_playlist_info(url: &str) -> Result<serde_json::Value, String> {
    eprintln!("[yt-dlp] Fetching playlist info for: {}", url);

    // Try with browser cookies first (helps with authentication and rate limiting)
    let browsers = [
        "chrome", "firefox", "safari", "edge", "brave", "vivaldi", "opera",
    ];

    // First try without cookies - use --flat-playlist for simplified output
    // but we need to handle multiple JSON lines
    let output = ytdlp_command()
        .map_err(|e| format!("Failed to prepare yt-dlp command: {}", e))?
        .args([
            "--dump-json",
            "--flat-playlist",
            "--no-download",
            "--ignore-errors",
            url,
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            eprintln!(
                "[yt-dlp] Success without cookies, output size: {} bytes",
                output.stdout.len()
            );
            let stdout_str = String::from_utf8_lossy(&output.stdout);

            let mut entries = Vec::new();
            for line in stdout_str.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(line) {
                    Ok(video) => entries.push(video),
                    Err(e) => eprintln!("[yt-dlp] Failed to parse line: {} - Error: {}", line, e),
                }
            }

            if entries.is_empty() {
                return Err("No videos found in playlist".to_string());
            }

            // Construct a playlist object from the entries
            let playlist = serde_json::json!({
                "title": entries.first().and_then(|e| e["playlist_title"].as_str()).unwrap_or("Unknown Playlist"),
                "channel": entries.first().and_then(|e| e["channel"].as_str()).unwrap_or("Unknown Channel"),
                "channel_id": entries.first().and_then(|e| e["channel_id"].as_str()),
                "description": entries.first().and_then(|e| e["description"].as_str()).unwrap_or(""),
                "entries": entries,
            });

            return Ok(playlist);
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[yt-dlp] Failed without cookies: {}", stderr);
            let trimmed = stderr.trim();
            if !trimmed.is_empty() {
                return Err(format!(
                    "Failed to get playlist info from yt-dlp: {}",
                    trimmed
                ));
            }
        }
        Err(e) => {
            eprintln!("[yt-dlp] Command failed: {}", e);
            return Err(format!(
                "Failed to run yt-dlp: {}. Make sure yt-dlp is installed and in your PATH.",
                e
            ));
        }
    }

    // Try with each browser's cookies
    for browser in &browsers {
        eprintln!("[yt-dlp] Trying with {} cookies...", browser);
        let output = ytdlp_command()
            .map_err(|e| format!("Failed to prepare yt-dlp command: {}", e))?
            .args([
                "--dump-json",
                "--flat-playlist",
                "--no-download",
                "--ignore-errors",
                "--cookies-from-browser",
                browser,
                url,
            ])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                eprintln!("[yt-dlp] Success with {} cookies", browser);
                let stdout_str = String::from_utf8_lossy(&output.stdout);

                let mut entries = Vec::new();
                for line in stdout_str.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(video) = serde_json::from_str::<serde_json::Value>(line) {
                        entries.push(video);
                    }
                }

                if !entries.is_empty() {
                    let playlist = serde_json::json!({
                        "title": entries.first().and_then(|e| e["playlist_title"].as_str()).unwrap_or("Unknown Playlist"),
                        "channel": entries.first().and_then(|e| e["channel"].as_str()).unwrap_or("Unknown Channel"),
                        "channel_id": entries.first().and_then(|e| e["channel_id"].as_str()),
                        "description": entries.first().and_then(|e| e["description"].as_str()).unwrap_or(""),
                        "entries": entries,
                    });
                    return Ok(playlist);
                }
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[yt-dlp] Failed with {}: {}", browser, stderr);
                let trimmed = stderr.trim();
                if !trimmed.is_empty() {
                    return Err(format!(
                        "Failed to get playlist info from yt-dlp using {} cookies: {}",
                        browser, trimmed
                    ));
                }
            }
            Err(e) => {
                eprintln!("[yt-dlp] Command failed with {}: {}", browser, e);
            }
        }
    }

    Err("Failed to get playlist info. This could be because:\n\
        1. The playlist is private or doesn't exist\n\
        2. YouTube is requiring authentication - try watching the playlist in your browser first\n\
        3. yt-dlp needs to be updated (run: yt-dlp -U)\n\
        4. Your IP might be rate-limited by YouTube"
        .to_string())
}

/// Extract video ID from URL
pub fn extract_video_id(url: &str) -> Option<String> {
    // Various YouTube URL patterns
    let patterns = [
        r"(?i)youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})",
        r"(?i)youtu\.be\/([a-zA-Z0-9_-]{11})",
        r"(?i)youtube\.com\/embed\/([a-zA-Z0-9_-]{11})",
        r"(?i)youtube\.com\/v\/([a-zA-Z0-9_-]{11})",
        r"(?i)youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})",
    ];

    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(url) {
                if let Some(id) = caps.get(1) {
                    return Some(id.as_str().to_string());
                }
            }
        }
    }

    None
}

/// Tauri command: Check if yt-dlp is available
#[tauri::command]
pub async fn check_ytdlp() -> Result<bool, String> {
    let installed = tokio::task::spawn_blocking(check_ytdlp_installed)
        .await
        .map_err(|e| format!("yt-dlp check task join error: {}", e))??;
    if installed {
        return Ok(true);
    }
    check_ytdlp_in_app_dir()
}

/// Tauri command: Setup yt-dlp automatically
#[tauri::command]
pub async fn setup_ytdlp_auto() -> Result<String, String> {
    setup_ytdlp().await
}

/// Tauri command: Get yt-dlp path
#[tauri::command]
pub async fn get_ytdlp_path() -> Result<String, String> {
    let path = get_ytdlp_binary_path()?;
    Ok(path.to_string_lossy().to_string())
}

/// Tauri command: Get video info
#[tauri::command]
pub async fn get_youtube_video_info(url: String) -> Result<YouTubeVideoInfo, String> {
    tokio::task::spawn_blocking(move || extract_video_info(&url))
        .await
        .map_err(|e| format!("yt-dlp video info task join error: {}", e))?
}

/// Tauri command: Get video formats
#[tauri::command]
pub async fn get_youtube_formats(url: String) -> Result<Vec<YouTubeFormat>, String> {
    tokio::task::spawn_blocking(move || get_video_formats(&url))
        .await
        .map_err(|e| format!("yt-dlp formats task join error: {}", e))?
}

/// Tauri command: Download video
#[tauri::command]
pub async fn download_youtube_video(
    app_handle: AppHandle,
    url: String,
    output_dir: String,
    options: Option<DownloadOptions>,
) -> Result<String, String> {
    let opts = options.unwrap_or_default();
    let path = download_video(&app_handle, &url, PathBuf::from(output_dir), &opts).await?;
    Ok(path.to_string_lossy().to_string())
}

pub async fn get_youtube_transcript_internal(
    url: &str,
    language: Option<&str>,
    document_id: Option<&str>,
    repo: &Repository,
) -> Result<Vec<TranscriptSegment>, String> {
    if let Some(video_id) = extract_video_id(url) {
        if let Ok(Some((_transcript, segments_json, version))) = repo
            .get_youtube_transcript_by_video_id_with_version(&video_id)
            .await
        {
            if is_transcript_cache_fresh(&segments_json, version) {
                return parse_transcript_segments(&segments_json);
            }
        }
    }

    let url_clone = url.to_string();
    let lang = language.map(|l| l.to_string());

    // Use spawn_blocking to avoid blocking the async runtime
    let segments =
        tokio::task::spawn_blocking(move || extract_transcript(&url_clone, lang.as_deref()))
            .await
            .map_err(|e| format!("Failed to join transcript task: {}", e))??;

    if let Some(video_id) = extract_video_id(url) {
        let transcript = build_transcript_text(&segments);
        let segments_json = serde_json::to_string(&segments)
            .map_err(|e| format!("Failed to serialize transcript: {}", e))?;
        repo.upsert_youtube_transcript(
            document_id,
            &video_id,
            &transcript,
            &segments_json,
            YOUTUBE_WORD_TIMINGS_VERSION,
        )
        .await
        .map_err(|e| format!("Failed to cache transcript: {}", e))?;
    }

    Ok(segments)
}

/// Tauri command: Extract transcript (accepts videoId or URL)
#[tauri::command]
pub async fn get_youtube_transcript(
    url: String,
    language: Option<String>,
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<TranscriptSegment>, String> {
    get_youtube_transcript_internal(
        &url,
        language.as_deref(),
        document_id.as_deref(),
        repo.inner(),
    )
    .await
}

/// Tauri command: Extract transcript by videoId
#[tauri::command]
pub async fn get_youtube_transcript_by_id(
    video_id: String,
    language: Option<String>,
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<TranscriptSegment>, String> {
    // Construct YouTube URL from video ID
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    get_youtube_transcript_internal(
        &url,
        language.as_deref(),
        document_id.as_deref(),
        repo.inner(),
    )
    .await
}

/// Tauri command: Fetch YouTube transcript on-device
#[tauri::command]
pub async fn fetch_youtube_transcript_on_device(
    video_id: String,
    language: Option<String>,
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<innertube::OnDeviceTranscriptResult, String> {
    // 1. Check local cache first
    if let Ok(Some((_transcript, segments_json, version))) = repo
        .get_youtube_transcript_by_video_id_with_version(&video_id)
        .await
    {
        if is_transcript_cache_fresh(&segments_json, version) {
            if let Ok(segments) = serde_json::from_str::<Vec<TranscriptSegment>>(&segments_json) {
                return Ok(innertube::OnDeviceTranscriptResult::Ok {
                    segments,
                    language: language.unwrap_or_else(|| "en".to_string()),
                });
            }
        }
    }

    // 2. Perform fetch
    let res =
        innertube::fetch_youtube_transcript_on_device_internal(&video_id, language.as_deref())
            .await;

    // 3. Cache successful results or NoCaptions
    match &res {
        innertube::OnDeviceTranscriptResult::Ok {
            segments,
            language: _,
        } => {
            let transcript = build_transcript_text(segments);
            if let Ok(segments_json) = serde_json::to_string(segments) {
                let _ = repo
                    .upsert_youtube_transcript(
                        document_id.as_deref(),
                        &video_id,
                        &transcript,
                        &segments_json,
                        YOUTUBE_WORD_TIMINGS_VERSION,
                    )
                    .await;
            }
        }
        innertube::OnDeviceTranscriptResult::Err { kind, .. } => {
            if kind == "NoCaptions" {
                // Cache empty transcript for NoCaptions to avoid retries
                let _ = repo
                    .upsert_youtube_transcript(
                        document_id.as_deref(),
                        &video_id,
                        "",
                        "[]",
                        YOUTUBE_WORD_TIMINGS_VERSION,
                    )
                    .await;
            }
        }
    }

    Ok(res)
}

/// Tauri command: Check if on-device transcript is available
#[tauri::command]
pub async fn on_device_transcript_available() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    let platform = "android";
    #[cfg(target_os = "ios")]
    let platform = "ios";
    #[cfg(target_os = "macos")]
    let platform = "macos";
    #[cfg(target_os = "windows")]
    let platform = "windows";
    #[cfg(target_os = "linux")]
    let platform = "linux";
    #[cfg(not(any(
        target_os = "android",
        target_os = "ios",
        target_os = "macos",
        target_os = "windows",
        target_os = "linux"
    )))]
    let platform = "unknown";

    Ok(serde_json::json!({
        "available": true,
        "platform": platform
    }))
}

/// Tauri command: Search YouTube
#[tauri::command]
pub async fn search_youtube_videos(
    query: String,
    api_key: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || search_youtube(&query, api_key.as_deref()))
        .await
        .map_err(|e| format!("yt-dlp search task join error: {}", e))?
}

/// Tauri command: Get playlist info
#[tauri::command]
pub async fn get_youtube_playlist_info(url: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || get_playlist_info(&url))
        .await
        .map_err(|e| format!("yt-dlp playlist task join error: {}", e))?
}

/// Tauri command: Extract video ID
#[tauri::command]
pub async fn extract_youtube_video_id(url: String) -> Result<Option<String>, String> {
    Ok(extract_video_id(&url))
}

pub async fn import_youtube_video_internal(
    url: &str,
    collection_id: Option<String>,
    repo: &Repository,
) -> Result<Document, String> {
    // First, verify yt-dlp is available
    let ytdlp_available = tokio::task::spawn_blocking(check_ytdlp_installed)
        .await
        .map_err(|e| format!("yt-dlp check task join error: {}", e))
        .map_err(|e| format!("Failed to check yt-dlp: {}", e))??;

    if !ytdlp_available {
        return Err(
            "yt-dlp is not installed. Please install it to import YouTube videos.".to_string(),
        );
    }

    let url_for_info = url.to_string();
    let info = tokio::task::spawn_blocking(move || extract_video_info(&url_for_info))
        .await
        .map_err(|e| format!("yt-dlp video info task join error: {}", e))?
        .map_err(|e| format!("Failed to fetch video info: {}", e))?;

    let video_id = &info.id;

    let mut doc = Document::with_collection(
        info.title.clone(),
        format!("https://www.youtube.com/watch?v={}", video_id),
        FileType::Youtube,
        collection_id,
    );

    // Set YouTube-specific fields
    // Note: category is not set to avoid foreign key constraint issues
    doc.tags = vec!["youtube".to_string(), "video".to_string()];
    doc.total_pages = Some(info.duration as i32);
    doc.priority_score = 7.0; // YouTube videos get higher priority
    if !info.thumbnail.is_empty() {
        doc.cover_image_url = Some(info.thumbnail.clone());
        doc.cover_image_source = Some("youtube".to_string());
    }

    // Set metadata with YouTube info
    // Use current time if publish_date is not available or invalid
    let created_at = chrono::Utc::now();

    doc.metadata = Some(DocumentMetadata {
        author: Some(info.channel),
        subject: None,
        keywords: if info.tags.is_empty() {
            None
        } else {
            Some(info.tags)
        },
        created_at: Some(created_at),
        modified_at: None,
        file_size: None,
        language: Some("en".to_string()),
        page_count: None,
        word_count: None,
        source: Some("youtube".to_string()),
        fetched_at: Some(created_at),
        site_name: Some("YouTube".to_string()),
        browser_import_mode: None,
        article_html: None,
        extracted_images: None,
        ..Default::default()
    });

    let mut created = repo
        .create_document(&doc)
        .await
        .map_err(|e| format!("Failed to save document to database: {}", e))?;

    // Auto-fetch and save chapters from YouTube (non-blocking, fail gracefully)
    let chapters = get_youtube_chapters_internal(url, Some(&created.id), repo)
        .await
        .unwrap_or_default();

    // Auto-fetch and save transcript from YouTube (non-blocking, fail gracefully)
    if let Ok(segments) = get_youtube_transcript_internal(url, None, Some(&created.id), repo).await
    {
        if !segments.is_empty() {
            let structured_transcript = if !chapters.is_empty() {
                build_transcript_text_with_chapters(&segments, &chapters)
            } else {
                build_transcript_text(&segments)
            };

            let content_hash = Some(crate::processor::generate_content_hash(
                &structured_transcript,
            ));
            let mut metadata = created.metadata.clone().unwrap_or_default();
            metadata.word_count = Some(structured_transcript.split_whitespace().count() as i32);
            metadata.source = Some("youtube".to_string());
            metadata.site_name = Some("YouTube".to_string());
            metadata.fetched_at = Some(chrono::Utc::now());

            if repo
                .update_document_content(
                    &created.id,
                    &structured_transcript,
                    content_hash.clone(),
                    None,
                    Some(metadata.clone()),
                )
                .await
                .is_ok()
            {
                created.content = Some(structured_transcript);
                created.content_hash = content_hash;
                created.metadata = Some(metadata);
            }
        }
    }

    Ok(created)
}

/// Import YouTube video to database
#[tauri::command]
pub async fn import_youtube_video(
    url: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document, String> {
    import_youtube_video_internal(&url, collection_id, repo.inner()).await
}

/// YouTube chapter data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeChapter {
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
}

/// Parse chapters from yt-dlp JSON output
pub fn parse_chapters_from_json(json: &serde_json::Value) -> Vec<YouTubeChapter> {
    let mut chapters = Vec::new();

    let duration = json["duration"]
        .as_f64()
        .or_else(|| json["duration"].as_u64().map(|d| d as f64));

    // Try to get chapters from the 'chapters' field
    if let Some(chapters_array) = json["chapters"].as_array() {
        for (i, chapter) in chapters_array.iter().enumerate() {
            let title = chapter["title"]
                .as_str()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());
            let start = chapter["start_time"]
                .as_f64()
                .or_else(|| chapter["start_time"].as_u64().map(|value| value as f64));

            if let (Some(title), Some(start)) = (title, start) {
                let end_time = chapter["end_time"]
                    .as_f64()
                    .or_else(|| chapter["end_time"].as_u64().map(|value| value as f64));
                // If end_time is not provided, estimate from duration or next chapter
                let end = end_time.unwrap_or_else(|| {
                    // Try to get duration from video info
                    duration.unwrap_or(0.0)
                });

                chapters.push(YouTubeChapter {
                    title: title.to_string(),
                    start_time: start,
                    end_time: end,
                });
            }
        }
    }

    if chapters.is_empty() {
        if let Some(description) = json["description"].as_str() {
            chapters = parse_chapters_from_description(description, duration);
        }
    }

    chapters
}

fn parse_timestamp_to_seconds(timestamp: &str) -> Option<f64> {
    let parts: Vec<&str> = timestamp.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }

    let mut values = Vec::with_capacity(parts.len());
    for part in parts {
        let value = part.trim().parse::<u64>().ok()?;
        values.push(value);
    }

    let seconds = *values.last()?;
    if seconds >= 60 {
        return None;
    }

    let (hours, minutes) = if values.len() == 3 {
        if values[1] >= 60 {
            return None;
        }
        (values[0], values[1])
    } else {
        (0, values[0])
    };

    Some((hours * 3600 + minutes * 60 + seconds) as f64)
}

fn parse_chapters_from_description(
    description: &str,
    duration: Option<f64>,
) -> Vec<YouTubeChapter> {
    let re = match regex::Regex::new(
        r"(?m)^\s*(?:[-*]\s*)?(?P<ts>\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|\||:)?\s*(?P<title>.+?)\s*$",
    ) {
        Ok(value) => value,
        Err(_) => return vec![],
    };

    let mut chapters = Vec::new();
    for caps in re.captures_iter(description) {
        let timestamp = match caps.name("ts") {
            Some(value) => value.as_str(),
            None => continue,
        };
        let title = caps
            .name("title")
            .map(|value| value.as_str().trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("Chapter");

        let start_time = match parse_timestamp_to_seconds(timestamp) {
            Some(value) => value,
            None => continue,
        };

        chapters.push(YouTubeChapter {
            title: title.to_string(),
            start_time,
            end_time: duration.unwrap_or(0.0),
        });
    }

    if chapters.is_empty() {
        return chapters;
    }

    chapters.sort_by(|a, b| {
        a.start_time
            .partial_cmp(&b.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    chapters.dedup_by(|a, b| a.start_time == b.start_time);

    chapters
}

/// Extract chapters from a YouTube video URL
pub fn extract_chapters(url: &str) -> Result<Vec<YouTubeChapter>, String> {
    let output = ytdlp_command()?
        .args(["--dump-json", "--no-playlist", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", error));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    Ok(parse_chapters_from_json(&json))
}

pub async fn get_youtube_chapters_internal(
    url: &str,
    document_id: Option<&str>,
    repo: &Repository,
) -> Result<Vec<crate::commands::video::VideoChapter>, String> {
    use tokio::task::spawn_blocking;

    let url_clone = url.to_string();
    // Extract chapters from YouTube (blocking call)
    let youtube_chapters = spawn_blocking(move || extract_chapters(&url_clone))
        .await
        .map_err(|e| format!("Failed to join task: {}", e))??;

    if youtube_chapters.is_empty() {
        return Ok(vec![]);
    }

    // Convert to VideoChapter format and save to database
    let mut video_chapters = Vec::new();
    for (i, chapter) in youtube_chapters.iter().enumerate() {
        let id = uuid::Uuid::new_v4().to_string();
        let end_time = if i + 1 < youtube_chapters.len() {
            youtube_chapters[i + 1].start_time
        } else {
            // Last chapter - use its end_time or video duration
            chapter.end_time
        };

        video_chapters.push(crate::commands::video::VideoChapter {
            id: id.clone(),
            document_id: document_id.unwrap_or_default().to_string(),
            title: chapter.title.clone(),
            start_time: chapter.start_time,
            end_time,
            order: i as i32,
        });
    }

    if let Some(doc_id) = document_id {
        let existing = repo.get_video_chapters(doc_id).await.ok();
        if let Some(chapters) = existing {
            if !chapters.is_empty() {
                // Chapters already exist, return those
                return Ok(chapters);
            }
        }

        repo.set_video_chapters(doc_id, &video_chapters)
            .await
            .map_err(|e| format!("Failed to save chapters: {}", e))?;
    }

    Ok(video_chapters)
}

/// Tauri command: Get chapters from YouTube video URL
#[tauri::command]
pub async fn get_youtube_chapters(
    url: String,
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<crate::commands::video::VideoChapter>, String> {
    get_youtube_chapters_internal(&url, document_id.as_deref(), repo.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// yt-dlp writes `{id}.{lang}.{ext}`; if the candidate list or the extension
    /// dispatch misses `.json3` the transcript silently comes back empty.
    #[test]
    fn subtitle_candidates_cover_json3_before_vtt() {
        let candidates = subtitle_file_candidates("dQw4w9WgXcQ", "en-US");

        assert!(candidates.contains(&"dQw4w9WgXcQ.en-US.json3".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.en.json3".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.json3".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.en-US.vtt".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.en.vtt".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.vtt".to_string()));
        assert!(candidates.contains(&"dQw4w9WgXcQ.en-US.srt".to_string()));

        let first_json3 = candidates
            .iter()
            .position(|c| c.ends_with(".json3"))
            .unwrap();
        let first_vtt = candidates.iter().position(|c| c.ends_with(".vtt")).unwrap();
        assert!(first_json3 < first_vtt, "json3 must be probed before vtt");
    }

    #[test]
    fn subtitle_candidates_do_not_duplicate_for_simple_lang() {
        let candidates = subtitle_file_candidates("abc123", "en");
        assert_eq!(candidates.len(), SUBTITLE_EXTENSIONS.len() * 2);
        assert!(candidates.contains(&"abc123.en.json3".to_string()));
    }

    #[test]
    fn parse_subtitle_file_dispatches_by_extension() {
        let json3 = r#"{"events":[{"tStartMs":0,"dDurationMs":1000,
            "segs":[{"utf8":"hello"},{"utf8":" world","tOffsetMs":500}]}]}"#;
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello<00:00:00.500><c> world</c>\n";
        let srt = "1\n00:00:00,000 --> 00:00:01,000\nhello world\n";

        for name in ["vid.en.json3", "vid.json3", "vid.en.json"] {
            let parsed = parse_subtitle_file(name, json3);
            assert_eq!(parsed.len(), 1, "{} should parse as json3", name);
            assert_eq!(parsed[0].text, "hello world");
            assert_eq!(parsed[0].words.as_ref().map(|w| w.len()), Some(2));
        }

        let parsed_vtt = parse_subtitle_file("vid.en.vtt", vtt);
        assert_eq!(parsed_vtt.len(), 1);
        assert_eq!(parsed_vtt[0].words.as_ref().map(|w| w.len()), Some(2));

        let parsed_srt = parse_subtitle_file("vid.en.srt", srt);
        assert_eq!(parsed_srt.len(), 1);
        assert_eq!(parsed_srt[0].text, "hello world");
        assert!(parsed_srt[0].words.is_none());
    }

    #[test]
    fn non_caption_json_parses_to_nothing_instead_of_panicking() {
        // yt-dlp's `{id}.info.json` can sit in the same temp dir.
        let info_json = r#"{"id":"abc","title":"Some video","formats":[]}"#;
        assert!(parse_subtitle_file("abc.info.json", info_json).is_empty());
    }

    #[test]
    fn cache_freshness_rules() {
        assert!(!is_transcript_cache_fresh(r#"[{"text":"x"}]"#, 0));
        assert!(is_transcript_cache_fresh(r#"[{"text":"x"}]"#, 1));
        // The NoCaptions sentinel must never be considered stale.
        assert!(is_transcript_cache_fresh("[]", 0));
    }
}
