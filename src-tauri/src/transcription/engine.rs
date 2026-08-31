use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f32,
    #[serde(default)]
    pub words_json: Option<String>,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    progress: i32,
}

#[derive(Clone, Serialize)]
struct PhasePayload {
    phase: String,
}

/// Emitted on `transcription://backend-fallback` when an accelerator run
/// fails mid-job and the transcription seamlessly continues on CPU.
#[derive(Clone, Serialize)]
struct BackendFallbackPayload {
    from: String,
    to: String,
    message: String,
}

/// Generic over the Tauri runtime so tests can drive the full spawn path
/// with a mock app; production code uses the default (`Wry`) invisibly.
pub struct TranscriptionEngine<R: tauri::Runtime = tauri::Wry> {
    app_handle: AppHandle<R>,
}

pub(crate) fn sidecar_executable_name(name: &str, target_triple: &str) -> String {
    if target_triple.contains("windows") {
        format!("{}-{}.exe", name, target_triple)
    } else {
        format!("{}-{}", name, target_triple)
    }
}

/// Set library path environment variable so sidecar binaries can find
/// shared libraries (libonnxruntime, libggml, etc.) in the same directory.
macro_rules! set_sidecar_env {
    ($cmd:expr, $bin_dir:expr) => {
        if let Some(bin_str) = $bin_dir.to_str() {
            #[cfg(target_os = "linux")]
            {
                let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
                // Include CUDA/cuDNN search paths if present on Linux systems
                let cuda_paths = ["/usr/local/cuda/lib64", "/usr/local/cuda/targets/x86_64-linux/lib", "/usr/lib/x86_64-linux-gnu"];
                let mut extra_paths = vec![bin_str.to_string()];
                for cp in cuda_paths {
                    if std::path::Path::new(cp).exists() {
                        extra_paths.push(cp.to_string());
                    }
                }
                let prefix = extra_paths.join(":");
                let path = if existing.is_empty() {
                    prefix
                } else {
                    format!("{}:{}", prefix, existing)
                };
                $cmd = $cmd.env("LD_LIBRARY_PATH", path);
            }
            #[cfg(target_os = "macos")]
            {
                let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
                let path = if existing.is_empty() {
                    bin_str.to_string()
                } else {
                    format!("{}:{}", bin_str, existing)
                };
                $cmd = $cmd.env("DYLD_LIBRARY_PATH", path);
            }
            #[cfg(target_os = "windows")]
            {
                let existing = std::env::var("PATH").unwrap_or_default();
                let path = format!("{};{}", bin_str, existing);
                $cmd = $cmd.env("PATH", path);
            }
        }
    };
}

/// Where and how to run a sherpa-onnx sidecar process. Sherpa is spawned via
/// an absolute path + `tokio::process` (not the shell plugin's `sidecar()`
/// API) because the GPU build is provisioned into app data at runtime —
/// invisible to the compile-time externalBin manifest.
struct SherpaSpawnTarget {
    /// Absolute binary path: the provisioned GPU runtime or the bundled CPU
    /// sidecar.
    path: PathBuf,
    /// Library dirs that must win the loader search path (GPU runs). When
    /// non-empty the bundled bin dir is deliberately excluded: it carries a
    /// CPU `libonnxruntime.so` with the same soname that would shadow the
    /// CUDA-enabled one.
    prefer_lib_dirs: Vec<PathBuf>,
}

impl<R: tauri::Runtime> TranscriptionEngine<R> {
    /// Resolve the sherpa binary for a run. When an accelerator was
    /// requested and the provisioned GPU runtime verifies on disk
    /// (manifest-checked, so existence == usable), run its binary; otherwise
    /// fall back to the bundled CPU sidecar with the usual pre-flight guard.
    fn resolve_sherpa_spawn(&self, binary: &str, provider: &str) -> Result<SherpaSpawnTarget> {
        if provider != "cpu" {
            if let Some(bin) =
                crate::transcription::gpu_runtime::runtime_bin(&self.app_handle, binary)
            {
                let lib =
                    crate::transcription::gpu_runtime::runtime_lib_dir(&self.app_handle)
                        .unwrap_or_else(|| {
                            bin.parent()
                                .map(|p| p.join("lib"))
                                .unwrap_or_else(|| bin.clone())
                        });
                tracing::debug!(
                    binary = %bin.display(),
                    lib = %lib.display(),
                    "sherpa GPU runtime spawn"
                );
                return Ok(SherpaSpawnTarget {
                    path: bin,
                    prefer_lib_dirs: vec![lib],
                });
            }
        }
        // Bundled CPU sidecar — same pre-flight guard as before.
        if let Some(reason) = self.check_sidecar_usable(binary) {
            return Err(anyhow!(reason));
        }
        let path = self.sidecar_path(binary).ok_or_else(|| {
            anyhow!(
                "Could not resolve sidecar '{}' location. Transcription is unavailable.",
                binary
            )
        })?;
        Ok(SherpaSpawnTarget {
            path,
            prefer_lib_dirs: Vec::new(),
        })
    }
}

/// Compose the loader environment for a tokio-spawned sidecar. Mirrors
/// `set_sidecar_env!` (kept for the shell-plugin spawns) with one addition:
/// `target.prefer_lib_dirs` (the GPU runtime's lib dir) is placed ahead of
/// everything and suppresses the bundled bin dir — see `SherpaSpawnTarget`.
fn apply_sidecar_loader_env(
    cmd: &mut tokio::process::Command,
    target: &SherpaSpawnTarget,
    bin_dir: Option<&Path>,
) {
    #[cfg(target_os = "linux")]
    {
        let mut extra_paths: Vec<String> = target
            .prefer_lib_dirs
            .iter()
            .map(|d| d.to_string_lossy().into_owned())
            .collect();
        if extra_paths.is_empty() {
            if let Some(dir) = bin_dir.and_then(|d| d.to_str()) {
                extra_paths.push(dir.to_string());
            }
        }
        // System CUDA toolkit paths (if the user happens to have one) only
        // matter for bundled CPU runs; GPU runs are self-contained.
        if target.prefer_lib_dirs.is_empty() {
            for cp in [
                "/usr/local/cuda/lib64",
                "/usr/local/cuda/targets/x86_64-linux/lib",
                "/usr/lib/x86_64-linux-gnu",
            ] {
                if Path::new(cp).exists() {
                    extra_paths.push(cp.to_string());
                }
            }
        }
        if !extra_paths.is_empty() {
            let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let prefix = extra_paths.join(":");
            let path = if existing.is_empty() {
                prefix
            } else {
                format!("{}:{}", prefix, existing)
            };
            cmd.env("LD_LIBRARY_PATH", path);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut dirs: Vec<String> = target
            .prefer_lib_dirs
            .iter()
            .map(|d| d.to_string_lossy().into_owned())
            .collect();
        if dirs.is_empty() {
            if let Some(dir) = bin_dir.and_then(|d| d.to_str()) {
                dirs.push(dir.to_string());
            }
        }
        if let Some(first) = dirs.first() {
            let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
            let path = if existing.is_empty() {
                first.clone()
            } else {
                format!("{}:{}", first, existing)
            };
            cmd.env("DYLD_LIBRARY_PATH", path);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = target;
        if let Some(dir) = bin_dir.and_then(|d| d.to_str()) {
            let existing = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{};{}", dir, existing));
        }
    }
}

/// Which sherpa-onnx model family a model belongs to. Each family uses a
/// different set of CLI flags but the same sidecar binary and the same
/// JSON-on-stderr result format.
#[derive(Clone, Copy, PartialEq)]
enum SherpaFamily {
    /// NVIDIA Parakeet TDT/CTC — `--nemo-ctc-model`. English-only (110m) or
    /// European-only (v3); no Chinese.
    Parakeet,
    /// Alibaba SenseVoice — `--sense-voice-model` + `--sense-voice-language`.
    /// Supports zh/en/ja/ko/yue; non-autoregressive; has ITN punctuation.
    SenseVoice,
    /// Zipformer transducer — `--zipformer-model` (combined) or the split
    /// `--encoder/--decoder/--joiner` form. Generic sherpa-onnx STT family used
    /// by most HF ONNX STT repos.
    Zipformer,
    /// FunASR Paraformer — `--paraformer-model`.
    Paraformer,
    /// NVIDIA Nemotron 3.5 ASR streaming transducer — the same split
    /// `--encoder/--decoder/--joiner` argv as Zipformer, but dispatched to the
    /// **online** (streaming) sherpa binary and parsed from its per-segment
    /// JSON output (see `nemotron::parse_online_segments`).
    NemotronTransducer,
}

/// The concrete files a sherpa-onnx STT invocation needs (paths already
/// resolved against the model dir).
#[derive(Clone)]
struct SherpaModelFiles {
    model: PathBuf,
    tokens: Option<PathBuf>,
    decoder: Option<PathBuf>,
    joiner: Option<PathBuf>,
    /// Enable SenseVoice ITN (punctuation + casing).
    use_itn: bool,
}

impl<R: tauri::Runtime> TranscriptionEngine<R> {
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle }
    }

    /// Returns the directory where sidecar binaries live (resource dir + "bin" in production,
    /// src-tauri/bin in dev). Returns None if the directory can't be resolved.
    ///
    /// In dev (`tauri dev` / `cargo run`), Tauri creates a `target/debug/bin/` for
    /// *resources* (dylibs etc.) but does NOT copy the `externalBin` sidecar binaries
    /// there. So if we naively return `resource_dir()/bin` we'll find the dylibs but
    /// miss the sidecar executables, and every transcription fails with "sidecar not
    /// found". To handle this we prefer the dev source `bin/` dir when it exists and
    /// actually contains sidecars; otherwise fall back to the resource dir.
    pub(crate) fn sidecar_bin_dir(&self) -> Option<PathBuf> {
        // Dev source dir: the src-tauri/bin checked into the repo. In a dev build
        // this is where the real sidecar binaries live.
        let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
        if dev_dir.is_dir() && dir_contains_sidecars(&dev_dir) {
            return Some(dev_dir);
        }
        // Production: the bundled Resources/bin directory.
        let dir = self.app_handle.path().resource_dir().ok()?.join("bin");
        if dir.is_dir() {
            return Some(dir);
        }
        None
    }

    /// Resolve the on-disk path of a named sidecar binary, searching every layout
    /// Tauri uses across dev and bundled builds. Returns the first existing path.
    ///
    /// Tauri places `externalBin` binaries in *different* locations depending on
    /// build mode and platform, and our own `download-sidecars.js`/`build.rs` use
    /// yet another naming. Rather than guess one, we probe all candidates:
    ///
    ///   1. Dev source dir:  `<CARGO_MANIFEST_DIR>/bin/<name>-<triple>`  (dev builds)
    ///   2. Resource dir:    `<resource_dir>/bin/<name>-<triple>`        (resources glob)
    ///   3. Bundled .app:    `<exe_dir>/<name>` and `<exe_dir>/<name>.exe`
    ///                       (Tauri externalBin on macOS/Windows — lives next to the
    ///                       main exe in Contents/MacOS/ with NO target-triple suffix)
    ///
    /// The triple-suffixed names come from our build pipeline; the bare `<name>`
    /// name is what Tauri's bundler actually writes into a production bundle.
    fn sidecar_path(&self, name: &str) -> Option<PathBuf> {
        let triple = env!("TAURI_TARGET_TRIPLE");
        let suffixed_name = sidecar_executable_name(name, triple);
        let candidates: Vec<PathBuf> = [
            // 1. Dev source bin/ (CARGO_MANIFEST_DIR is baked at compile time).
            Some(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("bin")
                    .join(&suffixed_name),
            ),
            // 2. Resource dir bin/ (where resources globs land in prod).
            self.app_handle
                .path()
                .resource_dir()
                .ok()
                .map(|d| d.join("bin").join(&suffixed_name)),
            // 3. Bundled externalBin: next to the main exe, bare name (no triple).
            //    On macOS this is Contents/MacOS/<name>; on Windows <exe_dir>/<name>.exe.
            std::env::current_exe().ok().and_then(|e| {
                e.parent().map(|p| {
                    if cfg!(windows) {
                        p.join(format!("{}.exe", name))
                    } else {
                        p.join(name)
                    }
                })
            }),
        ]
        .into_iter()
        .flatten()
        .collect();

        candidates.into_iter().find(|p| p.exists())
    }

    /// Verify a named sidecar is actually usable on disk: present, non-empty, and
    /// (on macOS) a real Mach-O rather than a 0-byte placeholder. Returns an
    /// explanatory error string if not usable, or None if it's fine.
    ///
    /// This catches the two failure modes that previously surfaced as a confusing
    /// bare "transcription failed" with no detail:
    ///   1. A 0-byte placeholder sidecar (e.g. sherpa-onnx on a target without a prebuilt asset).
    ///   2. A missing sidecar for the current target triple.
    pub(crate) fn check_sidecar_usable(&self, name: &str) -> Option<String> {
        let path = match self.sidecar_path(name) {
            Some(p) => p,
            None => {
                return Some(format!(
                    "Could not resolve sidecar '{}' location. Transcription is unavailable.",
                    name
                ))
            }
        };
        match std::fs::metadata(&path) {
            Err(_) => Some(format!(
                "Sidecar binary '{}' is missing (expected at {}). \
                 This build may not support local transcription on this platform.",
                name,
                path.display()
            )),
            Ok(md) if md.len() == 0 => Some(format!(
                "Sidecar binary '{}' is a 0-byte placeholder (at {}). \
                 The {} sidecar was not built for this platform; \
                 local transcription with this engine is unavailable. \
                 Try a different model or use Groq (cloud) transcription.",
                name,
                path.display(),
                name
            )),
            Ok(_) => None,
        }
    }

    /// Converts audio to 16kHz WAV as required by whisper.cpp.
    /// Emits "transcription://phase" with "preparing" so the UI can show a preparing state.
    pub async fn prepare_audio(&self, input_path: &Path) -> Result<PathBuf> {
        self.prepare_audio_from(input_path, 0).await
    }

    /// Converts the untranscribed tail of an audio file to 16kHz mono WAV.
    /// `start_ms` is measured on the original media timeline and is used by the
    /// persistent queue to resume after the last checkpointed segment.
    pub async fn prepare_audio_from(&self, input_path: &Path, start_ms: i64) -> Result<PathBuf> {
        let _ = self.app_handle.emit(
            "transcription://phase",
            PhasePayload {
                phase: "preparing".to_string(),
            },
        );
        let temp_dir = self
            .app_handle
            .path()
            .app_cache_dir()?
            .join("transcription");
        if !temp_dir.exists() {
            std::fs::create_dir_all(&temp_dir)?;
        }

        let output_path = temp_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));

        let mut args = vec![
            "-i".to_string(),
            input_path
                .to_str()
                .expect("input path is valid UTF-8")
                .to_string(),
        ];
        if start_ms > 0 {
            // Put -ss after -i for accurate seeking. A checkpoint is a transcript
            // boundary, so avoiding a coarse keyframe seek matters more than the
            // small startup cost for audio-only media.
            args.push("-ss".to_string());
            args.push(format!("{:.3}", start_ms as f64 / 1000.0));
        }
        args.extend([
            "-ar".to_string(),
            "16000".to_string(),
            "-ac".to_string(),
            "1".to_string(),
            "-c:a".to_string(),
            "pcm_s16le".to_string(),
            "-y".to_string(),
            output_path
                .to_str()
                .expect("output path is valid UTF-8")
                .to_string(),
        ]);

        let (mut rx, _) = crate::utils::ffmpeg::ffmpeg_command(&self.app_handle)?
            .args(args)
            .spawn()?;

        let mut success = false;
        let mut stderr_buf = String::new();
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                success = payload.code == Some(0);
                break;
            } else if let CommandEvent::Stderr(line) = event {
                let line_str = String::from_utf8_lossy(&line);
                if stderr_buf.len() < 4000 {
                    stderr_buf.push_str(&line_str);
                }
            }
        }

        if !success {
            let msg = if stderr_buf.trim().is_empty() {
                "FFmpeg conversion failed".to_string()
            } else {
                format!("FFmpeg conversion failed: {}", stderr_buf.trim())
            };
            return Err(anyhow!(msg));
        }

        Ok(output_path)
    }

    pub(crate) fn wav_duration_ms(&self, wav_path: &Path) -> Option<i64> {
        get_wav_duration_ms(wav_path)
    }

    pub async fn transcribe(
        &self,
        audio_path: &Path,
        model_path: &Path,
        language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!(
                "Whisper model file not found: {}",
                model_path.display()
            ));
        }

        let mut args = vec![
            "-m".to_string(),
            model_path.to_string_lossy().to_string(),
            "-f".to_string(),
            audio_path.to_string_lossy().to_string(),
            "-ojf".to_string(), // output json full
            "--print-progress".to_string(),
        ];

        if !language.eq_ignore_ascii_case("auto") {
            args.push("-l".to_string());
            args.push(language.to_string());
        }

        // Guard against a missing or 0-byte placeholder sidecar before spawning,
        // so the user gets an actionable message instead of a bare "failed".
        if let Some(reason) = self.check_sidecar_usable("whisper") {
            return Err(anyhow!(reason));
        }

        // Use the bundled sidecar binary ("whisper").
        let mut cmd = self
            .app_handle
            .shell()
            .sidecar("whisper")
            .map_err(|e| anyhow!("Whisper sidecar not found: {}", e))?;

        // Set library path so whisper can find libwhisper, libggml, etc.
        if let Some(bin_dir) = self.sidecar_bin_dir() {
            set_sidecar_env!(cmd, &bin_dir);
        }

        let (mut rx, _) = cmd
            .args(args)
            .spawn()
            .map_err(|e| anyhow!("Failed to launch sidecar 'whisper': {}", e))?;

        let mut success = false;
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();
        let mut stderr_line_buf = String::new();
        // Whether the startup banner told us which backend whisper actually
        // runs on. Reported once; the neutral (no-phase) UI state is kept
        // until the truth is known instead of guessing from library presence.
        let mut backend_reported = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    if stdout_buf.len() < 4000 {
                        stdout_buf.push_str(&line_str);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    stderr_line_buf.push_str(&line_str);

                    while let Some(newline_idx) = stderr_line_buf.find('\n') {
                        let line = stderr_line_buf[..newline_idx].trim().to_string();
                        stderr_line_buf = stderr_line_buf[newline_idx + 1..].to_string();

                        // Ground-truth compute telemetry: whisper.cpp prints its
                        // backend choice on stderr at startup — "use gpu = 1"
                        // plus a ggml_<backend>_init line (metal/cuda/vulkan),
                        // or "use gpu = 0" when CPU-only.
                        if !backend_reported {
                            let gpu_active = line.contains("use gpu = 1")
                                || line.contains("ggml_metal_device_init")
                                || line.contains("ggml_cuda_init")
                                || line.contains("ggml_vulkan_init");
                            let cpu_active = line.contains("use gpu = 0");
                            if gpu_active || cpu_active {
                                backend_reported = true;
                                let _ = self.app_handle.emit(
                                    "transcription://phase",
                                    PhasePayload {
                                        phase: if gpu_active {
                                            "transcribing-gpu".to_string()
                                        } else {
                                            "transcribing-cpu".to_string()
                                        },
                                    },
                                );
                            }
                        }

                        // Parse progress: "progress = 5%"
                        if let Some(idx) = line.find("progress =") {
                            let rest = &line[idx + 10..];
                            if let Some(end) = rest.find('%') {
                                if let Ok(p) = rest[..end].trim().parse::<i32>() {
                                    // If the build never printed a backend banner,
                                    // report the conservative default once progress
                                    // starts so the UI is never left without a phase.
                                    if !backend_reported {
                                        backend_reported = true;
                                        let _ = self.app_handle.emit(
                                            "transcription://phase",
                                            PhasePayload {
                                                phase: "transcribing-cpu".to_string(),
                                            },
                                        );
                                    }
                                    let _ = self.app_handle.emit(
                                        "transcription://progress",
                                        ProgressPayload { progress: p },
                                    );
                                    if let Some(ref cb) = on_progress {
                                        cb(p);
                                    }
                                }
                            }
                        }
                    }

                    if stderr_buf.len() < 4000 {
                        stderr_buf.push_str(&line_str);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    success = payload.code == Some(0);
                    break;
                }
                _ => {}
            }
        }

        if !success {
            let stderr_clean = stderr_buf.trim();
            let stdout_clean = stdout_buf.trim();
            let msg = if !stderr_clean.is_empty() {
                if stderr_clean.contains("libwhisper.so") || stderr_clean.contains("Shared library")
                {
                    format!("Whisper binary missing dependencies. Please run: ./fix-whisper.sh\nDetails: {}", stderr_clean)
                } else {
                    format!("Whisper transcription failed: {}", stderr_clean)
                }
            } else if !stdout_clean.is_empty() {
                format!("Whisper transcription failed (stdout): {}", stdout_clean)
            } else {
                // No output at all almost always means the sidecar was killed by
                // the OS before producing anything — typically a dyld library-load
                // failure or, on Apple Silicon, an invalid code signature.
                "Whisper sidecar exited without output. This usually means it was \
                 killed on launch — a shared library (libwhisper/libggml) could not \
                 be loaded, or on Apple Silicon the code signature is invalid. \
                 Rebuild the app (build.rs patches the rpath and re-signs the sidecar) \
                 or try a different transcription provider."
                    .to_string()
            };
            return Err(anyhow!(msg));
        }

        // After completion, whisper.cpp usually creates a .wav.json file (due to -ojf)
        let json_path = audio_path.with_extension("wav.json");
        if !json_path.exists() {
            return Err(anyhow!(
                "Whisper completed without producing output: {}",
                json_path.display()
            ));
        }

        let json_content = std::fs::read_to_string(&json_path)?;
        let data: serde_json::Value = serde_json::from_str(&json_content)?;

        if let Some(transcription) = data.get("transcription") {
            if let Some(segments) = transcription.as_array() {
                for seg in segments {
                    let segment = TranscriptSegment {
                        start_ms: (seg["offsets"]["from"].as_i64().unwrap_or(0)),
                        end_ms: (seg["offsets"]["to"].as_i64().unwrap_or(0)),
                        text: seg["text"].as_str().unwrap_or("").to_string(),
                        confidence: 1.0,
                        words_json: None,
                    };
                    on_segment(segment);
                }
            }
        }

        let _ = std::fs::remove_file(json_path);

        Ok(())
    }

    /// Transcribe audio using a Parakeet model via the sherpa-onnx sidecar.
    pub async fn transcribe_parakeet(
        &self,
        audio_path: &Path,
        model_dir: &Path,
        _language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        let files = SherpaModelFiles {
            model: model_dir.join("model.int8.onnx"),
            tokens: Some(model_dir.join("tokens.txt")),
            decoder: None,
            joiner: None,
            use_itn: false,
        };
        self.transcribe_sherpa(
            SherpaFamily::Parakeet,
            files,
            audio_path,
            model_dir,
            "auto", // Parakeet ignores language (English model)
            on_segment,
            on_progress,
        )
        .await
    }

    /// Transcribe audio using a SenseVoice model via the sherpa-onnx sidecar.
    /// `language` is one of: auto, zh, en, ja, ko, yue.
    pub async fn transcribe_sensevoice(
        &self,
        audio_path: &Path,
        model_dir: &Path,
        language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        let files = SherpaModelFiles {
            model: model_dir.join("model.int8.onnx"),
            tokens: Some(model_dir.join("tokens.txt")),
            decoder: None,
            joiner: None,
            use_itn: true,
        };
        self.transcribe_sherpa(
            SherpaFamily::SenseVoice,
            files,
            audio_path,
            model_dir,
            language,
            on_segment,
            on_progress,
        )
        .await
    }

    /// Transcribe audio with a generic Zipformer transducer model (installed
    /// from Hugging Face). `combined` is the single ONNX model file, or None
    /// when the model ships as split `encoder/decoder/joiner` files.
    pub async fn transcribe_zipformer(
        &self,
        audio_path: &Path,
        model_dir: &Path,
        combined: Option<PathBuf>,
        encoder: Option<PathBuf>,
        decoder: Option<PathBuf>,
        joiner: Option<PathBuf>,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        let model = combined
            .or(encoder.clone())
            .unwrap_or_else(|| model_dir.join("model.onnx"));
        let tokens = Some(model_dir.join("tokens.txt"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| model_dir.join("tokens.json"));
        let files = SherpaModelFiles {
            model,
            tokens: Some(tokens),
            decoder: decoder.or_else(|| {
                encoder
                    .as_ref()
                    .and_then(|_| Some(model_dir.join("decoder.onnx")).filter(|p| p.exists()))
            }),
            joiner: joiner.or_else(|| {
                encoder
                    .as_ref()
                    .and_then(|_| Some(model_dir.join("joiner.onnx")).filter(|p| p.exists()))
            }),
            use_itn: false,
        };
        self.transcribe_sherpa(
            SherpaFamily::Zipformer,
            files,
            audio_path,
            model_dir,
            "auto",
            on_segment,
            on_progress,
        )
        .await
    }

    /// Transcribe audio with a Paraformer model (installed from Hugging Face).
    pub async fn transcribe_paraformer(
        &self,
        audio_path: &Path,
        model_dir: &Path,
        model_file: PathBuf,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        let tokens = Some(model_dir.join("tokens.txt"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| model_dir.join("tokens.json"));
        let files = SherpaModelFiles {
            model: model_file,
            tokens: Some(tokens),
            decoder: None,
            joiner: None,
            use_itn: false,
        };
        self.transcribe_sherpa(
            SherpaFamily::Paraformer,
            files,
            audio_path,
            model_dir,
            "auto",
            on_segment,
            on_progress,
        )
        .await
    }

    /// Dispatch a transcription to the right engine based on a resolved route
    /// (used by the job queue / auto queue for both pinned and HF-installed
    /// models).
    pub async fn transcribe_route(
        &self,
        audio_path: &Path,
        model_path: &Path,
        route: &crate::models::hf::manager::SttEngineRoute,
        language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        use crate::models::hf::manager::SttEngineRoute;
        // Resolve the tokens file the same way the dedicated sherpa methods do.
        let tokens_for = |model_dir: &Path| {
            Some(model_dir.join("tokens.txt"))
                .filter(|p| p.exists())
                .unwrap_or_else(|| model_dir.join("tokens.json"))
        };
        match route {
            SttEngineRoute::Whisper => {
                self.transcribe(audio_path, model_path, language, on_segment, on_progress)
                    .await
            }
            SttEngineRoute::Parakeet { model } => {
                let files = SherpaModelFiles {
                    model: model_path.join(model),
                    tokens: Some(tokens_for(model_path)),
                    decoder: None,
                    joiner: None,
                    use_itn: false,
                };
                self.transcribe_sherpa(
                    SherpaFamily::Parakeet,
                    files,
                    audio_path,
                    model_path,
                    "auto",
                    on_segment,
                    on_progress,
                )
                .await
            }
            SttEngineRoute::SenseVoice { model } => {
                let files = SherpaModelFiles {
                    model: model_path.join(model),
                    tokens: Some(tokens_for(model_path)),
                    decoder: None,
                    joiner: None,
                    use_itn: true,
                };
                self.transcribe_sherpa(
                    SherpaFamily::SenseVoice,
                    files,
                    audio_path,
                    model_path,
                    language,
                    on_segment,
                    on_progress,
                )
                .await
            }
            SttEngineRoute::Zipformer {
                model,
                decoder,
                joiner,
            } => {
                let has_split = decoder.is_some() && joiner.is_some();
                let combined = if has_split {
                    None
                } else {
                    Some(model_path.join(model))
                };
                let encoder = if has_split {
                    Some(model_path.join(model))
                } else {
                    None
                };
                let decoder_path = decoder.as_ref().map(|d| model_path.join(d));
                let joiner_path = joiner.as_ref().map(|j| model_path.join(j));
                self.transcribe_zipformer(
                    audio_path,
                    model_path,
                    combined,
                    encoder,
                    decoder_path,
                    joiner_path,
                    on_segment,
                    on_progress,
                )
                .await
            }
            SttEngineRoute::Paraformer { model } => self
                .transcribe_paraformer(
                    audio_path,
                    model_path,
                    model_path.join(model),
                    on_segment,
                    on_progress,
                )
                .await,
            SttEngineRoute::Nemotron {
                encoder,
                decoder,
                joiner,
                tokens,
            } => {
                // `model_path` is the install dir (see `resolve_installed_path`);
                // the route carries the split-transducer file names.
                let files = SherpaModelFiles {
                    model: model_path.join(encoder),
                    tokens: Some(model_path.join(tokens)),
                    decoder: Some(model_path.join(decoder)),
                    joiner: Some(model_path.join(joiner)),
                    use_itn: false,
                };
                self.transcribe_sherpa(
                    SherpaFamily::NemotronTransducer,
                    files,
                    audio_path,
                    model_path,
                    language,
                    on_segment,
                    on_progress,
                )
                .await
            }
            SttEngineRoute::NotTranscription => Err(anyhow!(
                "This model is a TTS model and cannot be used for transcription."
            )),
        }
    }

    /// True when the named sidecar exists and is not a 0-byte placeholder
    /// (availability gating for model profiles / routing).
    pub fn sidecar_usable(app_handle: &AppHandle<R>, name: &str) -> bool {
        let engine = TranscriptionEngine::new(app_handle.clone());
        engine.check_sidecar_usable(name).is_none()
    }

    /// `transcribe_route` with segment collection instead of a callback
    /// (single-file command paths like `transcribe_local_nemotron`).
    pub async fn transcribe_route_collect(
        &self,
        audio_path: &Path,
        model_path: &Path,
        route: &crate::models::hf::manager::SttEngineRoute,
        language: &str,
    ) -> Result<Vec<TranscriptSegment>> {
        let segments: Vec<TranscriptSegment> = Vec::new();
        let collected = std::sync::Arc::new(std::sync::Mutex::new(segments));
        let sink = std::sync::Arc::clone(&collected);
        self.transcribe_route(audio_path, model_path, route, language, move |seg| {
            if let Ok(mut guard) = sink.lock() {
                guard.push(seg);
            }
        }, None)
        .await?;
        Ok(collected
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default())
    }

    /// Shared sherpa-onnx transcription path used by all model families.
    ///
    /// sherpa-onnx-offline runs on CPU and prints a single JSON result line to
    /// **stderr** with a `"text"` field. On silent/no-speech audio it prints
    /// nothing and exits 0 → we treat that as an empty transcript (success), not
    /// an error. The only per-family difference is the CLI arg set.
    ///
    /// **Chunking:** sherpa-onnx-offline processes the entire file in one encoder
    /// forward pass. For long audio (the app regularly transcribes multi-hour
    /// podcasts/lectures) that means unbounded memory growth and *no* progress
    /// feedback until the very end — which looks exactly like a hang in the UI.
    /// So we chunk the WAV into fixed windows (30s) and invoke the sidecar once
    /// per chunk, exactly like the legacy moonshine path did. Short files still
    /// run as a single chunk; long files get bounded memory + per-chunk progress.
    async fn transcribe_sherpa(
        &self,
        family: SherpaFamily,
        files: SherpaModelFiles,
        audio_path: &Path,
        model_dir: &Path,
        language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        if !model_dir.exists() {
            return Err(anyhow!(
                "Model directory not found: {}",
                model_dir.display()
            ));
        }

        // The streaming (Nemotron) family takes a dedicated whole-file path:
        // the online sidecar loads the model once and processes the entire WAV
        // in one persistent session (measured ~0.19 RTF with flat ~2.1 GB RSS
        // on an 11-minute file). The 30 s chunk loop below would only add a
        // ~2.1 s model reload + session reset per chunk — exactly the overhead
        // the persistent-session architecture removes — and streaming output
        // would lose cross-chunk endpointing context at every boundary.
        if matches!(family, SherpaFamily::NemotronTransducer) {
            return self
                .transcribe_nemotron_streaming(files, audio_path, language, on_segment, on_progress)
                .await;
        }

        let _ = self.app_handle.emit(
            "transcription://phase",
            PhasePayload {
                phase: "transcribing-cpu".to_string(),
            },
        );

        if let Some(ref cb) = on_progress {
            cb(5);
        }

        // Read + parse the prepared WAV to chunk it. Fall back to a single
        // whole-file pass if the WAV can't be parsed (short/garbled input).
        let wav_data =
            std::fs::read(audio_path).map_err(|e| anyhow!("Failed to read WAV file: {}", e))?;

        let chunk_duration_ms: i64 = 30_000;
        let total_duration_ms = get_wav_duration_ms(audio_path).unwrap_or(chunk_duration_ms);

        // Single-pass fast path: short audio (≤ one chunk) → one sidecar call,
        // one segment. Avoids chunk-WAV bookkeeping for the common short case.
        if total_duration_ms <= chunk_duration_ms {
            let raw = self
                .run_sherpa_sidecar(family, files, audio_path, language, "cpu", None, 0, None)
                .await?;
            if let Some(ref cb) = on_progress {
                cb(100);
            }
            for segment in Self::segments_from_sidecar_output(
                family,
                &raw,
                0,
                total_duration_ms as i64,
            ) {
                on_segment(segment);
            }
            return Ok(());
        }

        // Long-audio path: chunk into 30s windows. Parse the WAV header to find
        // the data chunk, then build a minimal WAV per window and transcribe it.
        let channels = u16::from_le_bytes([wav_data[22], wav_data[23]]) as u64;
        let sample_rate =
            u32::from_le_bytes([wav_data[24], wav_data[25], wav_data[26], wav_data[27]]) as u64;
        let bits_per_sample = u16::from_le_bytes([wav_data[34], wav_data[35]]) as u64;
        let bytes_per_sample = bits_per_sample / 8;

        let (data_offset, data_size) = find_wav_data_chunk(&wav_data)
            .ok_or_else(|| anyhow!("Failed to parse WAV data chunk"))?;

        let total_samples = data_size / (channels * bytes_per_sample);
        let chunk_samples = (sample_rate * chunk_duration_ms as u64) / 1000;
        let num_chunks = ((total_samples + chunk_samples - 1) / chunk_samples) as usize;

        let mut chunk_idx = 0usize;
        while (chunk_idx as u64 * chunk_samples) < total_samples {
            let start_sample = chunk_idx as u64 * chunk_samples;
            let end_sample = std::cmp::min(start_sample + chunk_samples, total_samples);
            let chunk_byte_offset = data_offset as u64 + start_sample * channels * bytes_per_sample;
            let chunk_byte_count = (end_sample - start_sample) * channels * bytes_per_sample;

            if chunk_byte_offset as usize >= wav_data.len() {
                break;
            }
            let end_byte = std::cmp::min(
                (chunk_byte_offset + chunk_byte_count) as usize,
                wav_data.len(),
            );
            let chunk_bytes = &wav_data[chunk_byte_offset as usize..end_byte];

            // Build a minimal 44-byte-header WAV for this chunk and write it
            // next to the source (same temp-dir convention as prepare_audio).
            let chunk_wav = build_wav_chunk(
                chunk_bytes,
                sample_rate as u32,
                channels as u16,
                bits_per_sample as u16,
            );
            let chunk_path = audio_path.with_extension(format!("chunk{}.wav", chunk_idx));
            std::fs::write(&chunk_path, &chunk_wav)
                .map_err(|e| anyhow!("Failed to write chunk WAV: {}", e))?;

            let chunk_start_ms = (start_sample * 1000) / sample_rate;
            let chunk_end_ms = (end_sample * 1000) / sample_rate;

            // Per-chunk transcription. A failed chunk shouldn't abort the whole
            // file — log and continue with an empty segment (matches the legacy
            // moonshine behavior).
            let raw = match self
                .run_sherpa_sidecar(
                    family,
                    files.clone(),
                    &chunk_path,
                    language,
                    "cpu",
                    None,
                    0,
                    None,
                )
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("sherpa chunk {} failed, continuing: {}", chunk_idx, e);
                    String::new()
                }
            };
            let _ = std::fs::remove_file(&chunk_path);

            for segment in Self::segments_from_sidecar_output(
                family,
                &raw,
                chunk_start_ms as i64,
                chunk_end_ms as i64,
            ) {
                on_segment(segment);
            }

            chunk_idx += 1;
            if let Some(ref cb) = on_progress {
                cb(std::cmp::min(95, 5 + ((chunk_idx * 90) / num_chunks.max(1))) as i32);
            }
        }

        if let Some(ref cb) = on_progress {
            cb(100);
        }
        Ok(())
    }

    /// Swap the int8 transducer files for the fp32 set from the provisioned
    /// GPU runtime, when one exists and the target device has the VRAM for
    /// it (~4 GB). Falls back to the caller's (int8) files otherwise.
    fn fp32_files_for_gpu(
        &self,
        files: &SherpaModelFiles,
        hardware: &crate::transcription::compute_backend::HardwareCapabilities,
        device_id: Option<u32>,
    ) -> SherpaModelFiles {
        let Some(dir) = crate::transcription::gpu_runtime::runtime_fp32_model_dir(&self.app_handle)
        else {
            return files.clone();
        };
        // encoder.onnx carries its weights in encoder.data (ONNX external
        // data); the manifest covers both, this is belt-and-suspenders.
        if !dir.join("encoder.onnx").is_file() || !dir.join("encoder.data").is_file() {
            return files.clone();
        }
        const FP32_MIN_VRAM: u64 = 4_000_000_000;
        let device = match device_id {
            Some(id) => hardware.devices.iter().find(|d| d.id == id),
            None => hardware
                .devices
                .iter()
                .find(|d| d.vendor.eq_ignore_ascii_case("nvidia")),
        };
        if let Some(device) = device {
            if let Some(vram) = device.vram_bytes {
                if vram < FP32_MIN_VRAM {
                    tracing::debug!(
                        device = %device.name,
                        vram_bytes = vram,
                        "GPU lacks VRAM for the fp32 model; keeping int8 files"
                    );
                    return files.clone();
                }
            }
        }
        tracing::debug!(model_dir = %dir.display(), "GPU session uses the fp32 model");
        SherpaModelFiles {
            model: dir.join("encoder.onnx"),
            tokens: Some(dir.join("tokens.txt")),
            decoder: Some(dir.join("decoder.onnx")),
            joiner: Some(dir.join("joiner.onnx")),
            use_itn: files.use_itn,
        }
    }

    /// Whole-audio streaming transcription for the Nemotron online model, with
    /// GPU-first backend selection and a strict local GPU → CPU fallback.
    ///
    /// The execution backend is resolved through `ComputeBackendSelector`
    /// (user policy from the mirrored transcription config → detected hardware
    /// → probed runtime providers → model support → session health cache). If
    /// the accelerator run fails, the backend is marked degraded so later jobs
    /// this session skip it, the UI is notified via
    /// `transcription://backend-fallback`, and the whole file is retried on
    /// CPU. The fallback is strictly local — a local job never escapes to a
    /// cloud provider (Groq/OpenRouter) because an accelerator failed.
    async fn transcribe_nemotron_streaming(
        &self,
        files: SherpaModelFiles,
        audio_path: &Path,
        language: &str,
        on_segment: impl Fn(TranscriptSegment),
        on_progress: Option<Box<dyn Fn(i32) + Send + Sync>>,
    ) -> Result<()> {
        use crate::transcription::compute_backend as compute;

        let hardware = compute::detect_hardware();
        let gpu = crate::transcription::gpu_runtime::evaluate(&self.app_handle);
        let runtime = compute::probe_runtime_capabilities(
            self.sidecar_bin_dir().as_deref(),
            Some(&gpu),
        );
        let model = compute::ModelCapabilities {
            model_id: "nemotron-3.5-asr-0.6b".to_string(),
            supported_backends: vec![
                compute::ComputeBackend::Cuda,
                compute::ComputeBackend::CoreMl,
                compute::ComputeBackend::DirectMl,
                compute::ComputeBackend::Cpu,
            ],
            min_vram_bytes: Some(1500 * 1024 * 1024),
        };
        let health = compute::get_health_cache();

        // User policy comes from the settings mirror; absent → Auto.
        let (mode, preferred_device) =
            match self.app_handle.try_state::<crate::database::Repository>() {
                Some(repo) => {
                    let config =
                        crate::commands::transcription_config::read_transcription_config(&repo)
                            .await;
                    (
                        config
                            .as_ref()
                            .and_then(|c| c.compute_mode.as_deref())
                            .map(compute::TranscriptionComputeMode::from_str)
                            .unwrap_or_default(),
                        config.as_ref().and_then(|c| c.device_id),
                    )
                }
                None => (compute::TranscriptionComputeMode::default(), None),
            };

        let selection = compute::ComputeBackendSelector::select_backend(
            mode,
            &hardware,
            &runtime,
            &model,
            &health,
            preferred_device,
        );

        // Out-of-the-box GPU: when this machine could run the GPU runtime but
        // it is not provisioned yet (and nobody is already installing it),
        // kick off the auto-provision in the background. This job — and every
        // job until it lands — simply runs on CPU; the settings card surfaces
        // download progress.
        if selection.primary.backend != compute::ComputeBackend::Cuda
            && mode != compute::TranscriptionComputeMode::CpuOnly
            && gpu.supported
            && !gpu.installed
            && !gpu.installing
        {
            crate::transcription::gpu_runtime::ensure_installed(&self.app_handle);
        }

        let provider = match selection.primary.backend {
            compute::ComputeBackend::Cuda => "cuda",
            compute::ComputeBackend::CoreMl => "coreml",
            compute::ComputeBackend::DirectMl => "directml",
            _ => "cpu",
        };
        let device_id = if provider == "cpu" {
            None
        } else {
            selection.primary.device_id
        };

        let phase = if provider == "cpu" {
            "transcribing-cpu"
        } else {
            "transcribing-gpu"
        };
        let _ = self.app_handle.emit(
            "transcription://phase",
            PhasePayload {
                phase: phase.to_string(),
            },
        );
        if let Some(ref cb) = on_progress {
            cb(5);
        }

        let total_duration_ms = get_wav_duration_ms(audio_path).unwrap_or(0);

        // GPU sessions prefer the fp32 model shipped with the provisioned
        // GPU runtime: int8 ops have no CUDA kernels (they fall back to the
        // CPU provider inside the session and measure at CPU parity or
        // worse), while fp32 runs fully on CUDA (~3.3× the CPU path on an
        // RTX 2060 Super — see FP32_MODEL_FILES). Gated on VRAM because the
        // fp32 weights need ~4 GB; smaller cards keep the int8 files on GPU
        // (or fall back to CPU via the error path below).
        let gpu_files = if provider != "cpu" {
            self.fp32_files_for_gpu(&files, &hardware, device_id)
        } else {
            files.clone()
        };

        let raw = match self
            .run_sherpa_sidecar(
                SherpaFamily::NemotronTransducer,
                gpu_files,
                audio_path,
                language,
                provider,
                device_id,
                total_duration_ms,
                on_progress.as_deref(),
            )
            .await
        {
            Ok(raw) => raw,
            Err(err) if provider != "cpu" => {
                tracing::warn!(
                    backend = %selection.primary.backend,
                    error = %err,
                    "accelerator failed for Nemotron; continuing on CPU"
                );
                health.mark_degraded(selection.primary.backend, err.to_string());
                let _ = self.app_handle.emit(
                    "transcription://backend-fallback",
                    BackendFallbackPayload {
                        from: selection.primary.backend.to_string(),
                        to: "CPU".to_string(),
                        message: "GPU unavailable — continuing on CPU".to_string(),
                    },
                );
                let _ = self.app_handle.emit(
                    "transcription://phase",
                    PhasePayload {
                        phase: "transcribing-cpu".to_string(),
                    },
                );
                if let Some(ref cb) = on_progress {
                    cb(5);
                }
                self.run_sherpa_sidecar(
                    SherpaFamily::NemotronTransducer,
                    files,
                    audio_path,
                    language,
                    "cpu",
                    None,
                    total_duration_ms,
                    on_progress.as_deref(),
                )
                .await?
            }
            Err(err) => return Err(err),
        };

        for segment in crate::transcription::nemotron::parse_online_segments(&raw, 0) {
            on_segment(segment);
        }
        if let Some(ref cb) = on_progress {
            cb(100);
        }
        Ok(())
    }

    /// `provider` selects the execution provider ("cpu", "cuda", "coreml",
    /// "directml") for the streaming family; offline families always run on
    /// CPU. `device_id` picks the GPU index for CUDA/DirectML. For the
    /// streaming family with a known `total_duration_ms`, completed-segment
    /// JSON lines on stderr drive live `on_progress` updates.
    async fn run_sherpa_sidecar(
        &self,
        family: SherpaFamily,
        files: SherpaModelFiles,
        wav_path: &Path,
        language: &str,
        provider: &str,
        device_id: Option<u32>,
        total_duration_ms: i64,
        on_progress: Option<&(dyn Fn(i32) + Send + Sync)>,
    ) -> Result<String> {
        // Nemotron runs on the streaming (online) binary; every other family
        // on the offline one.
        let binary = if matches!(family, SherpaFamily::NemotronTransducer) {
            "sherpa-online"
        } else {
            "sherpa-onnx"
        };
        // Guard against a missing or 0-byte placeholder sidecar before spawning,
        // so callers get an actionable message instead of a bare "failed".
        if let Some(reason) = self.check_sidecar_usable(binary) {
            return Err(anyhow!(reason));
        }

        if !files.model.exists() {
            return Err(anyhow!(
                "Model file missing: {} (expected {} in {})",
                files.model.display(),
                files.model.file_name().unwrap_or_default().to_string_lossy(),
                files.model.parent().map(|p| p.display().to_string()).unwrap_or_default()
            ));
        }
        let tokens_file = match files.tokens.as_ref() {
            Some(t) if t.exists() => t.clone(),
            _ => return Err(anyhow!(
                "Tokens file missing in {} (expected tokens.txt)",
                files.model.parent().map(|p| p.display().to_string()).unwrap_or_default()
            )),
        };

        // Resolve the run target up front (GPU runtime vs bundled CPU
        // sidecar) so a missing binary fails before any process is built.
        let spawn_target = self.resolve_sherpa_spawn(binary, provider)?;

        // Build the per-family CLI args. All families share --tokens + the wav path;
        // only the model-specifier flag differs.
        let mut args = vec![format!("--tokens={}", tokens_file.to_string_lossy())];
        match family {
            SherpaFamily::Parakeet => {
                args.push(format!("--nemo-ctc-model={}", files.model.to_string_lossy()));
            }
            SherpaFamily::SenseVoice => {
                args.push(format!(
                    "--sense-voice-model={}",
                    files.model.to_string_lossy()
                ));
                // Language: auto-detect by default; valid values are
                // auto/zh/en/ja/ko/yue. SenseVoice requires a non-empty value,
                // so normalize empty/unknown to "auto".
                let lang = match language.trim() {
                    "" | "auto" => "auto",
                    "zh" | "en" | "ja" | "ko" | "yue" => language.trim(),
                    // Unknown language code → let the model auto-detect rather than fail.
                    _ => "auto",
                };
                args.push(format!("--sense-voice-language={}", lang));
                // ITN adds punctuation + casing (e.g. "开放时间早上9点至下午5点。").
                if files.use_itn {
                    args.push("--sense-voice-use-itn=1".to_string());
                }
            }
            SherpaFamily::NemotronTransducer => {
                // Identical split-transducer argv to Zipformer — the only
                // differences are the binary (online) and the optional
                // per-stream language hint.
                args.push(format!("--encoder={}", files.model.to_string_lossy()));
                if let Some(dec) = files.decoder.as_ref() {
                    args.push(format!("--decoder={}", dec.to_string_lossy()));
                }
                if let Some(join) = files.joiner.as_ref() {
                    args.push(format!("--joiner={}", join.to_string_lossy()));
                }
                // Per-stream language hint for prompt-conditioned multilingual
                // models ("en", "ja", …). Empty/"auto" omits the flag so the
                // model auto-detects; a region suffix ("en-US") is stripped.
                let lang = language.trim().to_lowercase();
                let lang = lang.split('-').next().unwrap_or("").trim().to_string();
                if !lang.is_empty() && lang != "auto" {
                    args.push(format!("--language={}", lang));
                }
                // Execution provider: cpu (default), cuda, coreml, directml
                // depending on what `ComputeBackendSelector` picked.
                args.push(format!("--provider={}", provider));
                if provider != "cpu" {
                    if let Some(id) = device_id {
                        // GPU index (meaningful for CUDA/TRT; harmless elsewhere).
                        args.push(format!("--device={}", id));
                    }
                }
                // Thread count matters on BOTH paths: it is the CPU-side pool
                // for CPU runs, and — importantly — the pool onnxruntime uses
                // for the int8 ops without CUDA kernels that fall back to the
                // CPU execution provider inside a CUDA session (measured 2×
                // RTF difference between 1 and N threads on a 560 ms
                // streaming transducer).
                let threads = std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(4)
                    .clamp(2, 8);
                args.push(format!("--num-threads={threads}"));
            }
            SherpaFamily::Zipformer => {
                // Split transducer: --encoder/--decoder/--joiner.
                if let (Some(dec), Some(join)) = (files.decoder.as_ref(), files.joiner.as_ref()) {
                    args.push(format!("--encoder={}", files.model.to_string_lossy()));
                    args.push(format!("--decoder={}", dec.to_string_lossy()));
                    args.push(format!("--joiner={}", join.to_string_lossy()));
                } else {
                    // Combined single-file zipformer.
                    args.push(format!("--zipformer-model={}", files.model.to_string_lossy()));
                }
            }
            SherpaFamily::Paraformer => {
                args.push(format!("--paraformer-model={}", files.model.to_string_lossy()));
            }
        }
        args.push(wav_path.to_string_lossy().to_string());

        // Absolute-path spawn (see SherpaSpawnTarget): supports both the
        // bundled CPU sidecar and the runtime-provisioned GPU build, with a
        // loader path that makes the right libonnxruntime win.
        let mut cmd = tokio::process::Command::new(&spawn_target.path);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            // Reap the recognizer if the future is dropped mid-run (job
            // cancel, queue shutdown) instead of leaking a GPU process.
            .kill_on_drop(true);
        apply_sidecar_loader_env(&mut cmd, &spawn_target, self.sidecar_bin_dir().as_deref());
        let mut child = cmd.spawn().map_err(|e| {
            anyhow!(
                "Failed to launch sidecar '{}': {}",
                spawn_target.path.display(),
                e
            )
        })?;
        let mut stderr_pipe = tokio::io::BufReader::new(
            child
                .stderr
                .take()
                .ok_or_else(|| anyhow!("Failed to pipe sidecar stderr"))?,
        );

        let mut success = false;
        // Whole-file streaming runs emit one JSON line per endpointed segment,
        // so the transcript can be megabytes — the 16 KB cap used to truncate
        // long-audio transcripts. Keep a generous 16 MB ceiling purely as a
        // guard against pathological output.
        let stderr_cap = 16 * 1024 * 1024;
        let mut stderr_buf = String::new();
        let mut stderr_line_buf = String::new();
        // sherpa-onnx can silently continue on CPU when the requested provider
        // isn't available at runtime ("… Fallback to cpu!") while still exiting
        // 0 — detect that notice once and correct the reported backend.
        let mut silent_cpu_fallback = false;
        let mut raw_chunk: Vec<u8> = Vec::with_capacity(8 * 1024);
        // File mode emits segment output only at completion (see
        // `learned_rtf_map`), so whole-file progress is interpolated from the
        // learned decode pace on a slow tick while the stderr reader waits.
        let run_started = Instant::now();
        let mut max_reported_progress = 5i32; // caller already sent the initial 5%
        let mut progress_ticker = tokio::time::interval(Duration::from_secs(2));
        progress_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let progress_tick_enabled =
            total_duration_ms > 0 && matches!(family, SherpaFamily::NemotronTransducer);
        let report_progress = |p: i32,
                               max_seen: &mut i32,
                               on_progress: &Option<&(dyn Fn(i32) + Send + Sync)>| {
            if p < *max_seen {
                return;
            }
            *max_seen = p;
            let _ = self.app_handle.emit(
                "transcription://progress",
                ProgressPayload { progress: p },
            );
            if let Some(cb) = on_progress {
                cb(p);
            }
        };
        loop {
            use tokio::io::AsyncBufReadExt;
            let n = tokio::select! {
                read = stderr_pipe.read_until(b'\n', &mut raw_chunk) => read?,
                _ = progress_ticker.tick(), if progress_tick_enabled => {
                    if let Some(p) =
                        interpolated_progress(provider, run_started, total_duration_ms, max_reported_progress)
                    {
                        report_progress(p, &mut max_reported_progress, &on_progress);
                    }
                    continue;
                }
            };
            if n == 0 {
                break; // EOF — recognizer finished (or died without output)
            }
            let line_str = String::from_utf8_lossy(&raw_chunk).into_owned();
            raw_chunk.clear();
            if stderr_buf.len() < stderr_cap {
                stderr_buf.push_str(&line_str);
            }
            stderr_line_buf.push_str(&line_str);
            while let Some(newline_idx) = stderr_line_buf.find('\n') {
                let complete_line = stderr_line_buf[..newline_idx].trim().to_string();
                stderr_line_buf = stderr_line_buf[newline_idx + 1..].to_string();

                if provider != "cpu"
                    && !silent_cpu_fallback
                    && complete_line.contains("Fallback to cpu")
                {
                    silent_cpu_fallback = true;
                    let backend = match provider {
                        "cuda" => Some(crate::transcription::compute_backend::ComputeBackend::Cuda),
                        "coreml" => Some(crate::transcription::compute_backend::ComputeBackend::CoreMl),
                        "directml" => Some(crate::transcription::compute_backend::ComputeBackend::DirectMl),
                        _ => None,
                    };
                    if let Some(backend) = backend {
                        crate::transcription::compute_backend::get_health_cache()
                            .mark_degraded(
                                backend,
                                "sherpa runtime lacks this execution provider".to_string(),
                            );
                    }
                    let _ = self.app_handle.emit(
                        "transcription://phase",
                        PhasePayload {
                            phase: "transcribing-cpu".to_string(),
                        },
                    );
                    let _ = self.app_handle.emit(
                        "transcription://backend-fallback",
                        BackendFallbackPayload {
                            from: provider.to_string(),
                            to: "CPU".to_string(),
                            message: "GPU unavailable — continuing on CPU".to_string(),
                        },
                    );
                }

                // Real decoded positions from segment lines. In file mode
                // these arrive as a burst at completion (still useful: they
                // correct any interpolation overshoot before the final 100).
                if total_duration_ms > 0
                    && matches!(family, SherpaFamily::NemotronTransducer)
                {
                    if let Some(p) =
                        streaming_progress_from_line(&complete_line, total_duration_ms)
                    {
                        report_progress(p, &mut max_reported_progress, &on_progress);
                    }
                }
            }
        }
        let status = child.wait().await?;
        success = status.code() == Some(0);
        if success && progress_tick_enabled && !silent_cpu_fallback {
            // Never teach the accelerator's pace from a run that silently
            // fell back to CPU inside the recognizer.
            record_learned_rtf(provider, run_started, total_duration_ms);
        }

        if !success {
            let stderr_clean = stderr_buf.trim();
            let msg = if !stderr_clean.is_empty() {
                if stderr_clean.contains("onnxruntime") || stderr_clean.contains("Shared library") {
                    format!(
                        "sherpa-onnx missing ONNX Runtime dependencies.\nDetails: {}",
                        stderr_clean
                    )
                } else {
                    format!("sherpa-onnx transcription failed: {}", stderr_clean)
                }
            } else {
                // No output means the sidecar was killed on launch — typically a
                // dyld load failure (libonnxruntime unresolved) or, on Apple Silicon,
                // an invalid code signature.
                "sherpa-onnx sidecar exited without output. It was likely killed on \
                 launch — libonnxruntime could not be loaded, or on Apple Silicon the \
                 code signature is invalid. Rebuild the app (build.rs patches the rpath \
                 and re-signs the sidecar) or use a Whisper / Groq model instead."
                    .to_string()
            };
            return Err(anyhow!(msg));
        }

        // Return the raw stderr: offline families extract the single JSON
        // result line via `offline_text_from_output`; the streaming (Nemotron)
        // family parses per-segment JSON lines via `nemotron::parse_online_segments`.
        Ok(stderr_buf)
    }

    /// Derive per-chunk segments from a sidecar run's raw stderr.
    ///
    /// Offline families: the single `{"text": …}` line (if any) becomes one
    /// segment spanning the chunk. The streaming family: every JSON line is a
    /// timestamped segment (token timestamps + `start_time`, shifted by the
    /// chunk offset). Silent/no-speech chunks yield no segments.
    fn segments_from_sidecar_output(
        family: SherpaFamily,
        raw: &str,
        chunk_start_ms: i64,
        chunk_end_ms: i64,
    ) -> Vec<TranscriptSegment> {
        if matches!(family, SherpaFamily::NemotronTransducer) {
            return crate::transcription::nemotron::parse_online_segments(raw, chunk_start_ms);
        }
        let text = raw
            .lines()
            .find(|l| l.trim_start().starts_with('{'))
            .and_then(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
            .and_then(|v| {
                v.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();
        if text.trim().is_empty() {
            return Vec::new();
        }
        vec![TranscriptSegment {
            start_ms: chunk_start_ms,
            end_ms: chunk_end_ms,
            text: text.trim().to_string(),
            confidence: 1.0,
            words_json: None,
        }]
    }
}

/// True if a directory contains any file whose name starts with a known sidecar
/// prefix (`whisper-`, `sherpa-onnx-`, `sherpa-online-`). Used to decide whether the dev source
/// `bin/` dir is the right place to look for sidecar executables (as opposed to
/// the resource dir, which in dev holds dylibs but not the externalBin binaries).
fn dir_contains_sidecars(dir: &Path) -> bool {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.starts_with("whisper-")
                || name.starts_with("sherpa-onnx-")
                || name.starts_with("sherpa-online-")
            {
                return true;
            }
        }
    }
    false
}

fn get_wav_duration_ms(wav_path: &Path) -> Option<i64> {
    let data = std::fs::read(wav_path).ok()?;
    if data.len() < 44 {
        return None;
    }

    let channels = u16::from_le_bytes([data[22], data[23]]) as u64;
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]) as u64;
    let bits_per_sample = u16::from_le_bytes([data[34], data[35]]) as u64;

    let (_offset, data_size) = find_wav_data_chunk(&data)?;

    let bytes_per_sample = bits_per_sample / 8;
    let total_samples = data_size / (channels * bytes_per_sample);
    let duration_ms = (total_samples * 1000) / sample_rate;
    Some(duration_ms as i64)
}

fn find_wav_data_chunk(data: &[u8]) -> Option<(u64, u64)> {
    if data.len() < 44 {
        return None;
    }
    let mut offset = 12u64;
    loop {
        if offset + 8 > data.len() as u64 {
            return None;
        }
        let chunk_id = &data[offset as usize..(offset + 4) as usize];
        let chunk_size = u32::from_le_bytes([
            data[(offset + 4) as usize],
            data[(offset + 5) as usize],
            data[(offset + 6) as usize],
            data[(offset + 7) as usize],
        ]) as u64;
        if chunk_id == b"data" {
            return Some((offset + 8, chunk_size));
        }
        offset += 8 + chunk_size;
    }
}

/// Estimate whole-file progress from one streaming-segment JSON line emitted
/// by the online sidecar. `start_time` is the absolute stream position of the
/// segment start and `timestamps` are segment-relative, so
/// Measured decode pace per provider ("cpu"/"cuda"): RTF = decode seconds per
/// audio second, learned from completed runs so the *next* run can interpolate
/// progress accurately. sherpa-onnx's file mode emits ALL segment output only
/// when the file completes (verified 2026-08-31: 90 s into a CPU decode of a
/// 101-min file, zero segment lines on stderr), so per-segment progress never
/// fires mid-run — without interpolation the UI sits at its initial value for
/// the whole job ("stuck at 33%" in the podcast view). Seeds are measured
/// RTX 2060 Super / desktop-CPU numbers; the first run on new hardware uses
/// its seed and then teaches the map.
fn learned_rtf_map() -> &'static Mutex<HashMap<&'static str, f64>> {
    static MAP: OnceLock<Mutex<HashMap<&'static str, f64>>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut m = HashMap::new();
        m.insert("cpu", 0.15);
        m.insert("cuda", 0.06);
        Mutex::new(m)
    })
}

/// Fixed start-up cost (model load + session init) before decoding begins.
fn model_load_allowance_secs(provider: &str) -> f64 {
    match provider {
        // fp32 weights (~2.5 GB) + cuDNN init.
        "cuda" => 25.0,
        _ => 6.0,
    }
}

/// Interpolated whole-file progress for a running recognizer: elapsed decode
/// time over the expected total (audio × learned RTF), clamped to 5..=95 and
/// never below `floor` so it cannot regress under a real segment anchor.
fn interpolated_progress(
    provider: &str,
    started: Instant,
    total_duration_ms: i64,
    floor: i32,
) -> Option<i32> {
    if total_duration_ms <= 0 {
        return None;
    }
    let elapsed_ms = started.elapsed().as_millis() as f64;
    let rtf = {
        let map = learned_rtf_map().lock().unwrap_or_else(|e| e.into_inner());
        map.get(provider).copied().unwrap_or(0.15)
    };
    interpolated_progress_from(
        elapsed_ms,
        model_load_allowance_secs(provider),
        rtf,
        total_duration_ms,
        floor,
    )
}

/// Pure core of [`interpolated_progress`] (unit-testable without a clock).
fn interpolated_progress_from(
    elapsed_ms: f64,
    load_allowance_secs: f64,
    rtf: f64,
    total_duration_ms: i64,
    floor: i32,
) -> Option<i32> {
    if total_duration_ms <= 0 || rtf <= 0.0 {
        return None;
    }
    let decode_ms = (elapsed_ms - load_allowance_secs * 1000.0).max(0.0);
    let expected_ms = total_duration_ms as f64 * rtf;
    let p = 5.0 + 90.0 * (decode_ms / expected_ms).min(1.0);
    Some((p as i32).clamp(floor, 95))
}

/// Teach the pace map from a completed successful run.
fn record_learned_rtf(provider: &str, started: Instant, total_duration_ms: i64) {
    if total_duration_ms <= 0 {
        return;
    }
    let elapsed_s = started.elapsed().as_secs_f64();
    let decode_s = (elapsed_s - model_load_allowance_secs(provider)).max(1.0);
    let measured = decode_s / (total_duration_ms as f64 / 1000.0);
    if !(0.005..=3.0).contains(&measured) {
        return; // nonsensical measurement (e.g. reused process) — keep the old pace
    }
    let mut map = learned_rtf_map().lock().unwrap_or_else(|e| e.into_inner());
    map.insert(if provider == "cuda" { "cuda" } else { "cpu" }, measured);
}

/// `start_time + last timestamp` ≈ how far into the audio the recognizer has
/// decoded. Non-JSON lines (config echo, RTF stats) and unknown shapes return
/// None. Clamped to 5..=95 so the value never regresses past the initial 5%
/// or pre-empt the caller's final 100.
fn streaming_progress_from_line(line: &str, total_duration_ms: i64) -> Option<i32> {
    if total_duration_ms <= 0 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    let start = value.get("start_time").and_then(|t| t.as_f64())?;
    let last_ts = value
        .get("timestamps")
        .and_then(|t| t.as_array())
        .and_then(|a| a.last())
        .and_then(|t| t.as_f64())
        .unwrap_or(0.0);
    let decoded_ms = ((start + last_ts) * 1000.0) as i64;
    if decoded_ms <= 0 {
        return None;
    }
    Some((((decoded_ms * 100) / total_duration_ms) as i32).clamp(5, 95))
}

/// Build a minimal 44-byte-header PCM WAV from raw samples. Used to feed
/// per-chunk slices of a long source WAV into sherpa-onnx (which has no
/// built-in chunking and would otherwise load the entire multi-hour file into
/// one encoder pass, growing memory without bound and reporting no progress).
fn build_wav_chunk(
    pcm_data: &[u8],
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
) -> Vec<u8> {
    let mut wav = Vec::with_capacity(44 + pcm_data.len());
    // RIFF header
    wav.extend_from_slice(b"RIFF");
    let file_size = (36 + pcm_data.len()) as u32;
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    // fmt sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // sub-chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate as u32 * channels as u32 * (bits_per_sample as u32 / 8);
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = channels as u16 * (bits_per_sample as u16 / 8);
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());
    // data sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm_data.len() as u32).to_le_bytes());
    wav.extend_from_slice(pcm_data);
    wav
}

#[cfg(test)]
mod tests {
    use super::sidecar_executable_name;
    use super::{SherpaFamily, TranscriptSegment};

    /// Recorded v1.13.6 streaming output for the pinned Nemotron model.
    const ONLINE_FIXTURE: &str = include_str!("__fixtures__/sherpa-online-nemotron-output.txt");

    /// LIVE end-to-end run of the refactored absolute-path spawn path, both
    /// variants: the full `transcribe_sherpa` route (Auto → CUDA when the
    /// provisioned GPU runtime verifies) and a direct CPU
    /// `run_sherpa_sidecar` spawn. Requires the GPU runtime provisioned
    /// (gpu_runtime live test) and the Nemotron model installed in the real
    /// app data dir.
    ///
    ///   cargo test --lib live_engine_spawns -- --ignored --nocapture
    #[cfg(target_os = "linux")]
    #[tokio::test]
    #[ignore = "live test: runs the real sherpa sidecars against the installed model"]
    async fn live_engine_spawns_gpu_and_cpu_sherpa_sessions() {
        use tauri::Manager;
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("mock app from the repo tauri.conf.json");
        let handle = app.handle().clone();
        let gpu = crate::transcription::gpu_runtime::evaluate(&handle);
        let model_dir = handle
            .path()
            .app_data_dir()
            .unwrap()
            .join("models/nemotron-asr/csukuangfj2_sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11");
        if !gpu.ready || !model_dir.join("encoder.int8.onnx").exists() {
            println!(
                "SKIPPED: needs a provisioned GPU runtime + installed Nemotron model (ready={})",
                gpu.ready
            );
            return;
        }

        let wav = std::env::temp_dir().join("gpu-engine-live-test.wav");
        let ff = tokio::process::Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2"])
            .arg(&wav)
            .output()
            .await
            .expect("ffmpeg");
        assert!(ff.status.success());

        let files = super::SherpaModelFiles {
            model: model_dir.join("encoder.int8.onnx"),
            tokens: Some(model_dir.join("tokens.txt")),
            decoder: Some(model_dir.join("decoder.int8.onnx")),
            joiner: Some(model_dir.join("joiner.int8.onnx")),
            use_itn: false,
        };
        let engine = super::TranscriptionEngine::new(handle.clone());

        // Full route under Auto policy → CUDA spawn of the provisioned GPU
        // binary with the GPU lib dir first on the loader path.
        let segments = std::sync::Mutex::new(Vec::new());
        engine
            .transcribe_sherpa(
                SherpaFamily::NemotronTransducer,
                files.clone(),
                &wav,
                &model_dir,
                "auto",
                |s: TranscriptSegment| segments.lock().unwrap().push(s),
                None,
            )
            .await
            .expect("GPU session through the engine must succeed");
        println!(
            "gpu route ok ({} segments collected; silence input yields none)",
            segments.lock().unwrap().len()
        );

        // Direct CPU spawn of the bundled sidecar (the pre-refactor default
        // path) must keep working unchanged.
        let raw = engine
            .run_sherpa_sidecar(
                SherpaFamily::NemotronTransducer,
                files,
                &wav,
                "auto",
                "cpu",
                None,
                2000,
                None,
            )
            .await
            .expect("CPU spawn must succeed");
        assert!(!raw.trim().is_empty(), "CPU run must produce output");
        println!("cpu spawn ok ({} bytes of output)", raw.len());
    }

    /// LIVE: the GPU file remap must hand the engine the fp32 set from the
    /// provisioned runtime when the device has VRAM for it, and keep the
    /// int8 files when it does not.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    #[ignore = "live test: needs a provisioned GPU runtime"]
    async fn live_fp32_remap_follows_vram() {
        use std::path::PathBuf;
        use tauri::Manager;
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("mock app");
        let handle = app.handle().clone();
        if !crate::transcription::gpu_runtime::evaluate(&handle).ready {
            println!("SKIPPED: GPU runtime not provisioned");
            return;
        }
        let engine = super::TranscriptionEngine::new(handle);
        let int8 = super::SherpaModelFiles {
            model: PathBuf::from("/int8/encoder.int8.onnx"),
            tokens: Some(PathBuf::from("/int8/tokens.txt")),
            decoder: Some(PathBuf::from("/int8/decoder.int8.onnx")),
            joiner: Some(PathBuf::from("/int8/joiner.int8.onnx")),
            use_itn: false,
        };
        let big_gpu = crate::transcription::compute_backend::HardwareCapabilities {
            cpu_threads: 8,
            devices: vec![crate::transcription::compute_backend::DeviceInfo {
                id: 0,
                name: "RTX".into(),
                vendor: "nvidia".into(),
                vram_bytes: Some(8 * 1024 * 1024 * 1024),
                free_vram_bytes: None,
            }],
        };
        let remapped = engine.fp32_files_for_gpu(&int8, &big_gpu, None);
        assert!(
            remapped.model.ends_with("model/encoder.onnx"),
            "expected the fp32 encoder, got {}",
            remapped.model.display()
        );
        let small_gpu = crate::transcription::compute_backend::HardwareCapabilities {
            cpu_threads: 8,
            devices: vec![crate::transcription::compute_backend::DeviceInfo {
                id: 0,
                name: "MX150".into(),
                vendor: "nvidia".into(),
                vram_bytes: Some(2 * 1024 * 1024 * 1024),
                free_vram_bytes: None,
            }],
        };
        let kept = engine.fp32_files_for_gpu(&int8, &small_gpu, None);
        assert_eq!(kept.model, int8.model, "small GPUs keep the int8 files");
    }

    #[test]
    fn interpolated_progress_stages_and_caps() {
        use super::interpolated_progress_from;
        // 100 s of audio at RTF 0.1 → expect ~10 s decode after allowance.
        let total = 100_000i64;
        // During model load: pinned to the floor (5).
        assert_eq!(
            interpolated_progress_from(3_000.0, 6.0, 0.1, total, 5),
            Some(5)
        );
        // Half decoded → 5 + 90*0.5 = 50.
        assert_eq!(
            interpolated_progress_from(6_000.0 + 5_000.0, 6.0, 0.1, total, 5),
            Some(50)
        );
        // Past the expected end → capped at 95, never 100 (caller owns that).
        assert_eq!(
            interpolated_progress_from(6_000.0 + 60_000.0, 6.0, 0.1, total, 5),
            Some(95)
        );
        // Never regresses below a real anchor.
        assert_eq!(
            interpolated_progress_from(0.0, 6.0, 0.1, total, 60),
            Some(60)
        );
        // Degenerate inputs.
        assert_eq!(interpolated_progress_from(1.0, 6.0, 0.1, 0, 5), None);
        assert_eq!(interpolated_progress_from(1.0, 6.0, 0.0, total, 5), None);
    }

    #[test]
    fn pace_seeds_cover_both_backends() {
        let map = super::learned_rtf_map()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for key in ["cpu", "cuda"] {
            let rtf = map.get(key).expect("seed present");
            // Both seeds must be sane decode paces (read-only test: never
            // insert, other tests interpolate from these).
            assert!((0.01..=1.0).contains(rtf), "{key} seed {rtf}");
        }
    }

    #[test]
    fn offline_output_becomes_one_chunk_bounded_segment() {
        let raw = "config noise\n{\"text\":\"hello there\"}\n";
        let segs = super::TranscriptionEngine::<tauri::Wry>::segments_from_sidecar_output(
            SherpaFamily::SenseVoice,
            raw,
            30_000,
            60_000,
        );
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "hello there");
        assert_eq!(segs[0].start_ms, 30_000);
        assert_eq!(segs[0].end_ms, 60_000);
    }

    #[test]
    fn offline_silent_chunk_yields_no_segments() {
        let segs = super::TranscriptionEngine::<tauri::Wry>::segments_from_sidecar_output(
            SherpaFamily::SenseVoice,
            "no json at all",
            0,
            30_000,
        );
        assert!(segs.is_empty());
    }

    #[test]
    fn streaming_output_becomes_timestamped_segments_with_chunk_offset() {
        let segs = super::TranscriptionEngine::<tauri::Wry>::segments_from_sidecar_output(
            SherpaFamily::NemotronTransducer,
            ONLINE_FIXTURE,
            30_000,
            60_000,
        );
        assert_eq!(segs.len(), 1);
        assert!(segs[0].text.contains("tribal chief"));
        // Fixture token timestamps 1.68 s → 7.12 s, shifted by the 30 s chunk.
        assert_eq!(segs[0].start_ms, 30_000 + 1680);
        assert_eq!(segs[0].end_ms, 30_000 + 7120);
    }

    #[test]
    fn sidecar_names_follow_tauri_platform_convention() {
        assert_eq!(
            sidecar_executable_name("sherpa-onnx", "x86_64-pc-windows-msvc"),
            "sherpa-onnx-x86_64-pc-windows-msvc.exe"
        );
        assert_eq!(
            sidecar_executable_name("sherpa-onnx", "aarch64-apple-darwin"),
            "sherpa-onnx-aarch64-apple-darwin"
        );
    }

    #[test]
    fn streaming_progress_tracks_decoded_position() {
        // Segment starting 60 s into a 10-minute file, last token at 62.5 s.
        let line = concat!(
            r#"{"text": "hello", "tokens": [" hello"], "timestamps": [2.5], "#,
            r#""start_time": 60.0, "segment": 12}"#
        );
        assert_eq!(super::streaming_progress_from_line(line, 600_000), Some(10));
        // Near the end: clamped to 95, never 100 (the caller sets that).
        let late = concat!(
            r#"{"text": "end", "tokens": [" end"], "timestamps": [1.0], "#,
            r#""start_time": 599.0, "segment": 200}"#
        );
        assert_eq!(super::streaming_progress_from_line(late, 600_000), Some(95));
    }

    #[test]
    fn streaming_progress_ignores_noise_lines() {
        assert_eq!(super::streaming_progress_from_line("Number of threads: 4", 60_000), None);
        assert_eq!(super::streaming_progress_from_line("not json at all", 60_000), None);
        // JSON without start_time (not a result line).
        assert_eq!(super::streaming_progress_from_line(r#"{"text": "x"}"#, 60_000), None);
        // Zero decoded position yields nothing rather than a fake 0%.
        let zero = r#"{"text": "", "timestamps": [], "start_time": 0.0}"#;
        assert_eq!(super::streaming_progress_from_line(zero, 60_000), None);
        // Unknown total duration → no progress estimate.
        assert_eq!(super::streaming_progress_from_line(zero, 0), None);
    }
}
