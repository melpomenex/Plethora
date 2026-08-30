use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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

pub struct TranscriptionEngine {
    app_handle: AppHandle,
}

pub(crate) fn sidecar_executable_name(name: &str, target_triple: &str) -> String {
    if target_triple.contains("windows") {
        format!("{}-{}.exe", name, target_triple)
    } else {
        format!("{}-{}", name, target_triple)
    }
}

static VULKAN_CHECKED: AtomicBool = AtomicBool::new(false);
static VULKAN_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// Set library path environment variable so sidecar binaries can find
/// shared libraries (libonnxruntime, libggml, etc.) in the same directory.
macro_rules! set_sidecar_env {
    ($cmd:expr, $bin_dir:expr) => {
        if let Some(bin_str) = $bin_dir.to_str() {
            #[cfg(target_os = "linux")]
            {
                let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
                let path = if existing.is_empty() {
                    bin_str.to_string()
                } else {
                    format!("{}:{}", bin_str, existing)
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

impl TranscriptionEngine {
    pub fn new(app_handle: AppHandle) -> Self {
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
    fn sidecar_bin_dir(&self) -> Option<PathBuf> {
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
    fn check_sidecar_usable(&self, name: &str) -> Option<String> {
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

    /// Checks whether libggml-vulkan.so is present in the sidecar bin directory.
    /// Caches the result after the first check.
    fn vulkan_available(&self) -> bool {
        if VULKAN_CHECKED.load(Ordering::Relaxed) {
            return VULKAN_AVAILABLE.load(Ordering::Relaxed);
        }
        let available = self
            .sidecar_bin_dir()
            .map(|dir| dir.join("libggml-vulkan.so").exists())
            .unwrap_or(false);
        if available {
            println!("[TranscriptionEngine] Vulkan GPU backend detected");
        }
        VULKAN_AVAILABLE.store(available, Ordering::Relaxed);
        VULKAN_CHECKED.store(true, Ordering::Relaxed);
        available
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

        let use_gpu = self.vulkan_available();

        let phase = if use_gpu {
            "transcribing-gpu"
        } else {
            "transcribing-cpu"
        };
        let _ = self.app_handle.emit(
            "transcription://phase",
            PhasePayload {
                phase: phase.to_string(),
            },
        );

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

                        // Parse progress: "progress = 5%"
                        if let Some(idx) = line.find("progress =") {
                            let rest = &line[idx + 10..];
                            if let Some(end) = rest.find('%') {
                                if let Ok(p) = rest[..end].trim().parse::<i32>() {
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
            SttEngineRoute::Nemotron { model_file } => {
                // `model_path` arrives as the resolved GGUF *file* for
                // Nemotron (see `resolve_installed_path`), while
                // `transcribe_file` takes (install_dir, model_file). Joining
                // the file onto itself produced `<install>/<gguf>/<gguf>`.
                let install_dir = model_path.parent().unwrap_or(model_path);
                let segments = crate::transcription::nemotron::transcribe_file(
                    install_dir,
                    model_file,
                    audio_path,
                    language,
                )
                .await?;
                for segment in segments {
                    on_segment(segment);
                }
                Ok(())
            }
            SttEngineRoute::NotTranscription => Err(anyhow!(
                "This model is a TTS model and cannot be used for transcription."
            )),
        }
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
            let text = self
                .run_sherpa_sidecar(family, files, audio_path, language)
                .await?;
            if let Some(ref cb) = on_progress {
                cb(100);
            }
            if !text.trim().is_empty() {
                on_segment(TranscriptSegment {
                    start_ms: 0,
                    end_ms: total_duration_ms,
                    text: text.trim().to_string(),
                    confidence: 1.0,
                    words_json: None,
                });
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
            let text = match self
                .run_sherpa_sidecar(family, files.clone(), &chunk_path, language)
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("sherpa chunk {} failed, continuing: {}", chunk_idx, e);
                    String::new()
                }
            };
            let _ = std::fs::remove_file(&chunk_path);

            if !text.trim().is_empty() {
                on_segment(TranscriptSegment {
                    start_ms: chunk_start_ms as i64,
                    end_ms: chunk_end_ms as i64,
                    text: text.trim().to_string(),
                    confidence: 1.0,
                    words_json: None,
                });
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

    async fn run_sherpa_sidecar(
        &self,
        family: SherpaFamily,
        files: SherpaModelFiles,
        wav_path: &Path,
        language: &str,
    ) -> Result<String> {
        // Guard against a missing or 0-byte placeholder sidecar before spawning,
        // so callers get an actionable message instead of a bare "failed".
        if let Some(reason) = self.check_sidecar_usable("sherpa-onnx") {
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

        let mut cmd = self
            .app_handle
            .shell()
            .sidecar("sherpa-onnx")
            .map_err(|e| anyhow!("sherpa-onnx sidecar not found: {}", e))?;

        // Belt-and-suspenders: the sidecar already has the right rpaths, but set the
        // library path too (matches the whisper pattern) so libonnxruntime resolves.
        if let Some(bin_dir) = self.sidecar_bin_dir() {
            set_sidecar_env!(cmd, &bin_dir);
        }

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

        let (mut rx, _) = cmd
            .args(args)
            .spawn()
            .map_err(|e| anyhow!("Failed to launch sidecar 'sherpa-onnx': {}", e))?;

        let mut success = false;
        let mut stderr_buf = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                // sherpa-onnx writes its result JSON to stderr (stdout stays empty).
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    if stderr_buf.len() < 16_000 {
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

        // Extract the JSON result line from stderr. On silent/no-speech audio there
        // is no JSON line at all — treat that as an empty transcript (Ok("")).
        let text = stderr_buf
            .lines()
            .find(|l| l.trim_start().starts_with('{'))
            .and_then(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
            .and_then(|v| {
                v.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();
        Ok(text)
    }
}

/// True if a directory contains any file whose name starts with a known sidecar
/// prefix (`whisper-`, `sherpa-onnx-`). Used to decide whether the dev source
/// `bin/` dir is the right place to look for sidecar executables (as opposed to
/// the resource dir, which in dev holds dylibs but not the externalBin binaries).
fn dir_contains_sidecars(dir: &Path) -> bool {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.starts_with("whisper-") || name.starts_with("sherpa-onnx-") {
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
}
