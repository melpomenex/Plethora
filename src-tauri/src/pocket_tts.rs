//! Pocket TTS - Local text-to-speech via a provisioned, bundled, or system runtime.
//!
//! Provides offline TTS using the Pocket TTS library from Kyutai Labs.
//! https://github.com/kyutai-labs/pocket-tts
//!
//! Three things live here and they are deliberately kept apart:
//!
//! 1. **Resolution** ([`resolve_pocket_tts_executable`]) — which `pocket-tts`
//!    executable to run: the venv this app provisioned, a runtime bundled with
//!    the app, or a user install on `PATH`. It reports the tier it picked, so
//!    status can tell "not installed" from "installed but broken".
//! 2. **Provisioning** ([`pocket_tts_install`]) — creating the venv under the
//!    app data dir, streaming real progress, cancelling, and removing.
//! 3. **Synthesis** ([`generate_pocket_speech`]) — running the CLI and reading
//!    the WAV back.
//!
//! No path here ever surfaces a bare `std::io::Error` to the user: every spawn
//! failure names the executable that was tried plus the recovery step.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

/// Emitted on every install tick: `pocket-tts://install-progress`.
pub const PROGRESS_EVENT: &str = "pocket-tts://install-progress";
/// Emitted exactly once per install, on every outcome: `pocket-tts://install-finished`.
pub const FINISHED_EVENT: &str = "pocket-tts://install-finished";

/// Free space the install gate insists on before anything is downloaded.
///
/// A constant rather than a computed estimate: a computed estimate would need
/// the resolved wheel set, which is pip's answer, not ours. 3 GiB sits well
/// above a measured CPU-only install (torch CPU wheel ~200 MB plus
/// `pocket-tts`/`mimi`/tokenizers/numpy) and below the ~4.7 GB that an
/// unpinned GPU resolution drags in. Over-estimating is the safe direction.
pub const POCKET_TTS_INSTALL_REQUIRED_BYTES: u64 = 3 * 1024 * 1024 * 1024;

/// The reason a machine with no interpreter gets, instead of an ENOENT on
/// `python3`. See the design's "A machine with no Python cannot install
/// anything" risk entry.
pub const POCKET_TTS_PYTHON_REQUIREMENT: &str =
    "Python 3.10 or newer is required to install the Pocket TTS runtime. Install Python, then retry.";

/// Appended to every user-facing failure so the next step is always named.
pub const RECOVERY_HINT: &str =
    "Reinstall from Settings → Text to Speech, or install it with `uv tool install pocket-tts`.";

const PYPI_INDEX_URL: &str = "https://pypi.org/simple";
const TORCH_CPU_EXTRA_INDEX: &str = "https://download.pytorch.org/whl/cpu";
const POCKET_TTS_PACKAGE: &str = "pocket-tts";
const RUNTIME_DIR_NAME: &str = "pocket-tts";
const PRELOAD_TEXT: &str = "Plethora is warming up text to speech.";

/// Minimum interval (or ≥1% jump) between two progress events, so a fast
/// download does not flood the webview with per-line IPC.
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

/// Cap on the captured child output kept for an error message. Enough for a
/// pip resolution traceback, small enough that a chatty install cannot grow
/// an unbounded string in memory.
const MAX_CAPTURED_OUTPUT: usize = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// Voices
// ─────────────────────────────────────────────────────────────────────────────

/// Pocket TTS voice identifiers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PocketVoice {
    Alba,
    Marius,
    Javert,
    Jean,
    Fantine,
    Cosette,
    Eponine,
    Azelma,
}

impl PocketVoice {
    pub fn as_str(&self) -> &'static str {
        match self {
            PocketVoice::Alba => "alba",
            PocketVoice::Marius => "marius",
            PocketVoice::Javert => "javert",
            PocketVoice::Jean => "jean",
            PocketVoice::Fantine => "fantine",
            PocketVoice::Cosette => "cosette",
            PocketVoice::Eponine => "eponine",
            PocketVoice::Azelma => "azelma",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "alba" => Some(PocketVoice::Alba),
            "marius" => Some(PocketVoice::Marius),
            "javert" => Some(PocketVoice::Javert),
            "jean" => Some(PocketVoice::Jean),
            "fantine" => Some(PocketVoice::Fantine),
            "cosette" => Some(PocketVoice::Cosette),
            "eponine" => Some(PocketVoice::Eponine),
            "azelma" => Some(PocketVoice::Azelma),
            _ => None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status shape
// ─────────────────────────────────────────────────────────────────────────────

/// Which tier a resolved `pocket-tts` executable came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PocketTTSSource {
    /// A venv this app created under the app data dir.
    Provisioned,
    /// A runtime shipped alongside the app binary.
    Bundled,
    /// A `pocket-tts` the user installed themselves, found on `PATH`.
    System,
}

impl PocketTTSSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            PocketTTSSource::Provisioned => "provisioned",
            PocketTTSSource::Bundled => "bundled",
            PocketTTSSource::System => "system",
        }
    }
}

/// Structural install state, so the UI branches on a code rather than on a
/// substring of a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PocketTTSState {
    /// No runtime anywhere.
    NotInstalled,
    /// An install is in flight right now.
    Installing,
    /// A working runtime was found.
    Installed,
    /// A runtime exists but fails to load; `detail` names the culprit.
    Broken,
    /// An install ran and failed; `error` says why.
    Failed,
}

impl PocketTTSState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PocketTTSState::NotInstalled => "notInstalled",
            PocketTTSState::Installing => "installing",
            PocketTTSState::Installed => "installed",
            PocketTTSState::Broken => "broken",
            PocketTTSState::Failed => "failed",
        }
    }
}

/// Result of speech generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PocketTTSResult {
    /// Audio data as base64-encoded WAV
    pub audio_data: String,
    /// Sample rate
    pub sample_rate: u32,
    /// Duration in seconds
    pub duration_sec: f64,
}

/// Runtime status. Carries no fabricated progress: there is no `downloading`
/// flag and no `download_progress`, because a percentage only exists while an
/// install is genuinely running, and that arrives on the progress event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PocketTTSStatus {
    pub state: PocketTTSState,
    /// Which tier produced `executable`.
    pub source: Option<PocketTTSSource>,
    /// Absolute path actually used.
    pub executable: Option<String>,
    /// The executable's own stderr when it exists but does not load.
    pub detail: Option<String>,
    /// Actionable, human-readable reason when `state` is not `Installed`.
    pub error: Option<String>,
}

impl PocketTTSStatus {
    fn not_installed() -> Self {
        Self {
            state: PocketTTSState::NotInstalled,
            source: None,
            executable: None,
            detail: None,
            error: Some(format!(
                "No Pocket TTS runtime was found. {RECOVERY_HINT}"
            )),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Executable resolution
// ─────────────────────────────────────────────────────────────────────────────

/// One place a `pocket-tts` executable might live, tagged with its tier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableCandidate {
    pub path: PathBuf,
    pub source: PocketTTSSource,
}

/// A candidate that exists but does not run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokenRuntime {
    pub path: PathBuf,
    pub source: PocketTTSSource,
    /// The CLI's own stderr (or why it could not be started).
    pub detail: String,
}

/// Why no working executable was found. `broken` is non-empty when something
/// was found but did not load — that is a *different* state from nothing
/// being there at all, and the UI offers a different fix for each.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolutionFailure {
    pub broken: Vec<BrokenRuntime>,
}

impl ResolutionFailure {
    /// Map a failed resolution onto the structured status the spec asks for.
    pub fn into_status(self) -> PocketTTSStatus {
        let Some(first) = self.broken.into_iter().next() else {
            return PocketTTSStatus::not_installed();
        };
        let path = first.path.to_string_lossy().to_string();
        PocketTTSStatus {
            state: PocketTTSState::Broken,
            source: Some(first.source),
            executable: Some(path.clone()),
            detail: Some(first.detail),
            error: Some(format!(
                "The Pocket TTS runtime at {path} is present but does not load. {RECOVERY_HINT}"
            )),
        }
    }
}

/// A working executable plus the tier it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedExecutable {
    pub path: PathBuf,
    pub source: PocketTTSSource,
}

/// What probing one candidate told us.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// Ran `--help` and exited 0.
    Working,
    /// Nothing at that path.
    Missing,
    /// Something is there, but it is not a runnable file.
    NotExecutable,
    /// Started, but failed. Carries the CLI's own stderr.
    Failed(String),
}

fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "pocket-tts.exe"
    } else {
        "pocket-tts"
    }
}

fn venv_bin_dir(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts")
    } else {
        venv_dir.join("bin")
    }
}

/// The `pocket-tts` console script inside a provisioned venv.
pub fn provisioned_executable(venv_dir: &Path) -> PathBuf {
    venv_bin_dir(venv_dir).join(executable_name())
}

/// The interpreter inside a provisioned venv.
pub fn provisioned_python(venv_dir: &Path) -> PathBuf {
    venv_bin_dir(venv_dir).join(if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "python3"
    })
}

/// The target triple used to namespace provisioned and bundled runtimes.
pub fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    "unknown-target"
}

/// `<app data>/pocket-tts/<triple>` — the parent of the provisioned venv.
pub fn pocket_tts_install_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()?
        .join(RUNTIME_DIR_NAME)
        .join(current_target_triple()))
}

/// `<app data>/pocket-tts/<triple>/.venv` — the runtime this app owns.
pub fn pocket_tts_venv_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(pocket_tts_install_dir(app)?.join(".venv"))
}

/// Base directories a *bundled* runtime could be unpacked into. Mirrors
/// `notebooklm_runtime_base_candidates` (`notebooklm.rs:2855`): resource dir
/// first (AppImage resolves resources relatively, so it has to lead), then the
/// dev-relative locations that make `tauri dev` work.
pub fn bundled_runtime_bases(app: &AppHandle) -> Vec<PathBuf> {
    let triple = current_target_triple();
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        bases.push(resource_dir.join("pocket-tts-runtime").join(triple));
        bases.push(
            resource_dir
                .join("bin")
                .join("pocket-tts-runtime")
                .join(triple),
        );
    }
    bases.push(PathBuf::from("src-tauri/bin/pocket-tts-runtime").join(triple));
    bases.push(PathBuf::from("bin/pocket-tts-runtime").join(triple));
    bases.push(PathBuf::from("../src-tauri/bin/pocket-tts-runtime").join(triple));
    bases
}

/// Dirs to search for a `pocket-tts` the *user* installed. The four named by
/// the design come first (so a predictable location wins over whatever
/// `PATH` happens to hold), then the ambient `PATH` entries.
pub fn system_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
    }
    for fixed in ["/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(fixed));
    }
    if cfg!(target_os = "windows") {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let programs = PathBuf::from(local).join("Programs").join("Python");
            dirs.push(programs.clone());
            dirs.push(programs.join("Scripts"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dedupe_dirs(dirs)
}

fn dedupe_dirs(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for dir in dirs {
        if dir.as_os_str().is_empty() {
            continue;
        }
        if seen.insert(dir.clone()) {
            out.push(dir);
        }
    }
    out
}

/// The executable(s) a bundled runtime base can be launched through. A bundled
/// base holds a portable `python/` + `site-packages/`, not a console script,
/// so the launcher that knows how to drive it is the sibling
/// `pocket-tts-<triple>` wrapper written by `scripts/download-sidecars.js`.
/// A base that instead carries a venv-shaped `bin/pocket-tts` works too.
fn bundled_executables(base: &Path) -> Vec<PathBuf> {
    let triple = current_target_triple();
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let mut out: Vec<PathBuf> = Vec::new();
    // A venv-shaped console script inside the base is a real `pocket-tts`, so
    // it is tried first — that is the layout a provisioned runtime has, and
    // treating both tiers identically is the point.
    out.push(provisioned_executable(base));
    if let Some(parent) = base.parent() {
        out.push(parent.join(format!("pocket-tts-{triple}{ext}")));
        out.push(parent.join(format!("pocket-tts{ext}")));
    }
    out
}

/// Build the ordered candidate list. Pure, so the tier order is testable
/// without a `Tauri` app or a filesystem.
///
/// `invoked_dir` — the directory the running binary was launched from — is
/// skipped: a `pocket-tts` sitting next to the app binary is either the
/// stale copy we are trying to replace or a half-updated one, and resolving
/// back to it defeats the whole point of provisioning.
pub fn pocket_tts_candidates(
    venv_dir: Option<PathBuf>,
    bundled_bases: Vec<PathBuf>,
    system_dirs: Vec<PathBuf>,
    invoked_dir: Option<PathBuf>,
) -> Vec<ExecutableCandidate> {
    let invoked = invoked_dir.map(|d| normalize_dir(&d));
    let mut out: Vec<ExecutableCandidate> = Vec::new();
    let mut seen: BTreeSet<PathBuf> = BTreeSet::new();

    let mut push = |path: PathBuf, source: PocketTTSSource, out: &mut Vec<_>| {
        let parent = path.parent().map(normalize_dir);
        if invoked.is_some() && parent.is_some() && parent == invoked {
            return;
        }
        if seen.insert(path.clone()) {
            out.push(ExecutableCandidate { path, source });
        }
    };

    if let Some(venv) = venv_dir {
        push(
            provisioned_executable(&venv),
            PocketTTSSource::Provisioned,
            &mut out,
        );
    }
    for base in bundled_bases {
        for path in bundled_executables(&base) {
            push(path, PocketTTSSource::Bundled, &mut out);
        }
    }
    for dir in system_dirs {
        push(dir.join(executable_name()), PocketTTSSource::System, &mut out);
    }
    out
}

fn normalize_dir(dir: &Path) -> PathBuf {
    dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf())
}

/// The directory the running binary lives in, if we can determine it.
pub fn invoked_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// Full candidate list for this app, in tier order.
pub fn pocket_tts_executable_candidates(app: &AppHandle) -> Vec<ExecutableCandidate> {
    let venv = pocket_tts_venv_dir(app).ok();
    pocket_tts_candidates(
        venv,
        bundled_runtime_bases(app),
        system_search_dirs(),
        invoked_dir(),
    )
}

/// Is `path` a file we could try to execute at all?
pub fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Walk `candidates` in order and take the first that probes clean. A
/// candidate that exists but does not load is recorded as broken and the walk
/// *continues*, so a broken provisioned copy never shadows a working system
/// install.
///
/// `probe` is injected so the tier order and the broken/missing distinction
/// are testable without spawning anything.
pub fn select_working_candidate<F>(
    candidates: Vec<ExecutableCandidate>,
    mut probe: F,
) -> std::result::Result<ResolvedExecutable, ResolutionFailure>
where
    F: FnMut(&Path) -> ProbeOutcome,
{
    let mut broken = Vec::new();
    for candidate in candidates {
        match probe(&candidate.path) {
            ProbeOutcome::Working => {
                return Ok(ResolvedExecutable {
                    path: candidate.path,
                    source: candidate.source,
                })
            }
            ProbeOutcome::NotExecutable => broken.push(BrokenRuntime {
                detail: format!("{} is not an executable file.", candidate.path.display()),
                path: candidate.path,
                source: candidate.source,
            }),
            ProbeOutcome::Failed(detail) => broken.push(BrokenRuntime {
                path: candidate.path,
                source: candidate.source,
                detail,
            }),
            ProbeOutcome::Missing => {}
        }
    }
    Err(ResolutionFailure { broken })
}

/// Run `<executable> --help` and classify the result. The exit code is the
/// whole contract: `pocket-tts` has no `--version`, and `--help` loads every
/// import the real run would, so a wheel that cannot import torch fails here
/// rather than on the user's first utterance.
pub async fn probe_executable(executable: &Path) -> ProbeOutcome {
    if !executable.exists() {
        return ProbeOutcome::Missing;
    }
    if !is_executable_file(executable) {
        return ProbeOutcome::NotExecutable;
    }
    let mut cmd = tokio::process::Command::new(executable);
    cmd.env_clear();
    for (key, value) in synthesis_env_from(&|k| std::env::var(k).ok()) {
        cmd.env(key, value);
    }
    cmd.arg("--help");
    match output_tolerant(&mut cmd).await {
        Ok(output) if output.status.success() => ProbeOutcome::Working,
        Ok(output) => ProbeOutcome::Failed(trimmed_output(&output.stdout, &output.stderr)),
        Err(e) => ProbeOutcome::Failed(format!("could not be started: {e}")),
    }
}

/// Resolve the executable to use, probing each tier. Never propagates an OS
/// error: a failure is a [`ResolutionFailure`], which becomes a structured
/// status.
pub async fn resolve_pocket_tts_executable(
    app: &AppHandle,
) -> std::result::Result<ResolvedExecutable, ResolutionFailure> {
    let candidates = pocket_tts_executable_candidates(app);
    let mut broken = Vec::new();
    for candidate in candidates {
        match probe_executable(&candidate.path).await {
            ProbeOutcome::Working => {
                return Ok(ResolvedExecutable {
                    path: candidate.path,
                    source: candidate.source,
                })
            }
            ProbeOutcome::NotExecutable => broken.push(BrokenRuntime {
                detail: format!("{} is not an executable file.", candidate.path.display()),
                path: candidate.path,
                source: candidate.source,
            }),
            ProbeOutcome::Failed(detail) => broken.push(BrokenRuntime {
                path: candidate.path,
                source: candidate.source,
                detail,
            }),
            ProbeOutcome::Missing => {}
        }
    }
    Err(ResolutionFailure { broken })
}

/// Resolve without probing.
///
/// Synthesis uses this rather than [`resolve_pocket_tts_executable`]: the probe
/// is `pocket-tts --help`, which imports torch and costs seconds, and paying
/// that on every utterance to save one failed spawn is a bad trade. A
/// provisioned copy that exists but is broken therefore surfaces as a synthesis
/// error naming its path (with the recovery hint) rather than being silently
/// skipped — and [`generate_pocket_speech`] still falls through to the next
/// candidate if the spawn itself fails.
pub fn resolve_pocket_tts_candidate(app: &AppHandle) -> Option<ExecutableCandidate> {
    pocket_tts_executable_candidates(app)
        .into_iter()
        .find(|candidate| is_executable_file(&candidate.path))
}

// ─────────────────────────────────────────────────────────────────────────────
// Install slot and in-flight guard
// ─────────────────────────────────────────────────────────────────────────────

/// The three phases the UI shows, plus the terminal one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PocketTTSInstallPhase {
    /// Finding an interpreter and creating the venv.
    EnvironmentPrep,
    /// Downloading and installing `pocket-tts` and its dependency closure.
    RuntimeFetch,
    /// One throwaway generation so the first real one is not blocked on the
    /// Hugging Face weight fetch.
    WeightPreload,
    /// Everything verified.
    Complete,
}

impl PocketTTSInstallPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            PocketTTSInstallPhase::EnvironmentPrep => "environment-prep",
            PocketTTSInstallPhase::RuntimeFetch => "runtime-fetch",
            PocketTTSInstallPhase::WeightPreload => "weight-preload",
            PocketTTSInstallPhase::Complete => "complete",
        }
    }

    /// Share of the whole install this phase accounts for, as
    /// `(low_percent, high_percent)`. The three phases share one bar: prepping
    /// the environment is quick, the runtime fetch is the download, and the
    /// preload is a single generation.
    ///
    /// Reported as metadata rather than folded into the emitted `percent`,
    /// because `percent` has to stay honest: with an unknown total it is 0,
    /// and a synthesised overall number here would put a made-up figure on the
    /// wire that the design forbids.
    pub fn share(&self) -> (f32, f32) {
        match self {
            PocketTTSInstallPhase::EnvironmentPrep => (0.0, 5.0),
            PocketTTSInstallPhase::RuntimeFetch => (5.0, 90.0),
            PocketTTSInstallPhase::WeightPreload => (90.0, 99.0),
            PocketTTSInstallPhase::Complete => (100.0, 100.0),
        }
    }
}

/// The single install slot. At most one install runs at a time, so this is an
/// `Option` rather than a map — there is only ever one runtime to install.
#[derive(Debug, Clone)]
pub struct InstallSlot {
    pub id: String,
    pub token: CancellationToken,
    pub phase: PocketTTSInstallPhase,
}

impl InstallSlot {
    pub fn new(id: String, token: CancellationToken) -> Self {
        Self {
            id,
            token,
            phase: PocketTTSInstallPhase::EnvironmentPrep,
        }
    }
}

/// Managed state, held by `app.manage(..)`. Replaces the old `available` flag
/// (written once, never updated) and `current_process` (nulled by
/// `stop_pocket_tts` and never acted on) with the install slot that actually
/// has to be coordinated.
///
/// Named `…InstallState` rather than `PocketTTSState` because
/// [`PocketTTSState`] is the *status* enum the frontend branches on; the two
/// once shared a name.
#[derive(Default)]
pub struct PocketTTSInstallState {
    install: std::sync::Mutex<Option<InstallSlot>>,
}

impl PocketTTSInstallState {
    /// Claim the install slot. `false` means an install is already running —
    /// the caller must not start a second pip against the same venv.
    pub fn try_register(&self, slot: InstallSlot) -> bool {
        let mut guard = self.install.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return false;
        }
        *guard = Some(slot);
        true
    }

    pub fn current(&self) -> Option<InstallSlot> {
        self.install
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_phase(&self, id: &str, phase: PocketTTSInstallPhase) {
        let mut guard = self.install.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(slot) = guard.as_mut() {
            if slot.id == id {
                slot.phase = phase;
            }
        }
    }

    /// Release the slot, but only if it is still ours — a late `Drop` from an
    /// install that was already unregistered must not evict its successor.
    pub fn unregister(&self, id: &str) -> Option<InstallSlot> {
        let mut guard = self.install.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(slot) if slot.id == id => guard.take(),
            _ => None,
        }
    }
}

/// RAII guard: releases the install slot on every exit path, including a
/// panic, so an aborted install can never wedge the "already installing" gate
/// shut for the rest of the session.
pub struct PocketTTSInstallGuard {
    app: AppHandle,
    id: String,
}

impl PocketTTSInstallGuard {
    pub fn new(app: AppHandle, id: String) -> Self {
        Self { app, id }
    }
}

impl Drop for PocketTTSInstallGuard {
    fn drop(&mut self) {
        if let Some(state) = self.app.try_state::<PocketTTSInstallState>() {
            state.unregister(&self.id);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Install events
// ─────────────────────────────────────────────────────────────────────────────

/// Emitted on every install tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PocketTTSInstallProgress {
    pub id: String,
    pub phase: PocketTTSInstallPhase,
    pub received: u64,
    /// 0 when the total is not known yet — the UI shows an indeterminate bar.
    pub total: u64,
    pub percent: f32,
}

/// Emitted exactly once per install, on success, failure, and cancellation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PocketTTSInstallFinished {
    pub id: String,
    pub ok: bool,
    pub cancelled: bool,
    pub message: String,
}

/// Progress emission state: throttle plus the high-water marks that keep the
/// reported values monotonic. A retried download, a late-discovered
/// dependency, or a cache hit that *shrinks* the announced total must never
/// move the bar backwards.
pub struct PocketTTSProgressTracker<'a> {
    sink: Box<dyn FnMut(&PocketTTSInstallProgress) + Send + 'a>,
    id: String,
    phase: PocketTTSInstallPhase,
    total: Option<u64>,
    last_emit: Option<Instant>,
    last_percent: f32,
    max_percent: f32,
    max_received: u64,
    min_interval: Duration,
}

impl<'a> PocketTTSProgressTracker<'a> {
    pub fn new(sink: Box<dyn FnMut(&PocketTTSInstallProgress) + Send + 'a>, id: &str) -> Self {
        Self {
            sink,
            id: id.to_string(),
            phase: PocketTTSInstallPhase::EnvironmentPrep,
            total: None,
            last_emit: None,
            last_percent: 0.0,
            max_percent: 0.0,
            max_received: 0,
            min_interval: PROGRESS_EMIT_INTERVAL,
        }
    }

    /// Tests drive the tracker synchronously, so the throttle has to be
    /// switchable or a fast loop would only ever emit its first tick.
    #[cfg(test)]
    fn without_throttle(mut self) -> Self {
        self.min_interval = Duration::ZERO;
        self
    }

    pub fn set_phase(&mut self, phase: PocketTTSInstallPhase) {
        self.phase = phase;
    }

    pub fn set_total(&mut self, total: Option<u64>) {
        self.total = total;
    }

    /// Percent for a byte count. 0.0 when the total is unknown — the UI shows
    /// the raw byte count and an indeterminate bar instead of a made-up number.
    pub fn percent_for(&self, received: u64) -> f32 {
        match self.total {
            Some(t) => (received as f32 / t.max(1) as f32 * 100.0).min(100.0),
            None => 0.0,
        }
    }

    /// Record a byte count, emitting when due. Never reports a percentage or a
    /// byte count below one already reported.
    pub fn record(&mut self, received: u64) {
        let shown = received.max(self.max_received);
        let percent = self.percent_for(shown).max(self.max_percent);
        self.max_received = shown;
        self.max_percent = percent;
        let due = match self.last_emit {
            None => true,
            Some(t) => t.elapsed() >= self.min_interval || percent - self.last_percent >= 1.0,
        };
        if due {
            self.emit(shown, percent);
        }
    }

    /// Terminal tick: always emitted, always 100% of the current phase.
    pub fn emit_phase_end(&mut self) {
        self.max_percent = 100.0;
        let received = self.max_received;
        self.emit(received, 100.0);
    }

    fn emit(&mut self, received: u64, percent: f32) {
        (self.sink)(&PocketTTSInstallProgress {
            id: self.id.clone(),
            phase: self.phase,
            received,
            total: self.total.unwrap_or(0),
            percent,
        });
        self.last_percent = percent;
        self.last_emit = Some(Instant::now());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// pip/uv output → progress
// ─────────────────────────────────────────────────────────────────────────────

/// Turns the install front-end's own chatter into a byte count.
///
/// pip with `--progress-bar off` announces each artifact once
/// (`Downloading torch-2.5.1-…whl (755.1 MB)`) and never reports per-file
/// completion, so "the previous download finished" is inferred from the *next*
/// announcement arriving. That is a good approximation for the purpose — the
/// user needs a bar that only ever moves forward — and it degrades to
/// `total: 0` (an indeterminate bar) when the output carries no sizes at all.
#[derive(Debug, Clone, Default)]
pub struct PipProgressParser {
    announced_total: u64,
    completed_bytes: u64,
    /// Size of the download currently believed to be in flight.
    pending: Option<u64>,
    /// Packages served from pip's cache; they stream nothing but do complete.
    cached_packages: usize,
}

impl PipProgressParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one output line. Returns `Some(received)` when the completed byte
    /// count advanced, so the caller can feed the tracker.
    pub fn feed(&mut self, line: &str) -> Option<u64> {
        let before = self.completed_bytes;
        let trimmed = line.trim();

        if let Some(size) = parse_announced_download_size(trimmed) {
            self.complete_pending();
            self.announced_total += size;
            self.pending = Some(size);
        } else if is_using_cached(trimmed) {
            self.complete_pending();
            self.cached_packages += 1;
        } else if is_installing_collected(trimmed) || is_successfully_installed(trimmed) {
            self.complete_pending();
        }

        (self.completed_bytes != before).then_some(self.completed_bytes)
    }

    /// Flush the last in-flight download once the command has exited.
    pub fn finish(&mut self) -> Option<u64> {
        let before = self.completed_bytes;
        self.complete_pending();
        (self.completed_bytes != before).then_some(self.completed_bytes)
    }

    fn complete_pending(&mut self) {
        if let Some(size) = self.pending.take() {
            self.completed_bytes += size;
        }
    }

    /// Total announced so far; 0 means "unknown", which the UI renders as an
    /// indeterminate bar.
    pub fn announced_total(&self) -> u64 {
        self.announced_total
    }

    pub fn completed_bytes(&self) -> u64 {
        self.completed_bytes
    }

    pub fn cached_packages(&self) -> usize {
        self.cached_packages
    }
}

/// `  Downloading torch-2.5.1-cp313-…whl (755.1 MB)` → `Some(755_100_000)`
fn parse_announced_download_size(line: &str) -> Option<u64> {
    let rest = line.trim_start().strip_prefix("Downloading ")?;
    let open = rest.rfind('(')?;
    let close = rest.rfind(')')?;
    if close < open {
        return None;
    }
    parse_size(&rest[open + 1..close])
}

fn is_using_cached(line: &str) -> bool {
    line.trim_start().starts_with("Using cached ")
}

fn is_installing_collected(line: &str) -> bool {
    line.trim_start().starts_with("Installing collected packages")
}

fn is_successfully_installed(line: &str) -> bool {
    line.trim_start().starts_with("Successfully installed")
}

/// `755.1 MB` → bytes. Accepts the decimal units pip prints and the binary
/// spellings some front-ends use.
pub fn parse_size(raw: &str) -> Option<u64> {
    let mut parts = raw.split_whitespace();
    let value: f64 = parts.next()?.parse().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    let multiplier = match parts.next()?.to_ascii_lowercase().as_str() {
        "b" | "byte" | "bytes" => 1.0,
        "kb" | "k" => 1e3,
        "mb" | "m" => 1e6,
        "gb" | "g" => 1e9,
        "tb" | "t" => 1e12,
        "kib" => 1024.0,
        "mib" => 1024.0 * 1024.0,
        "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((value * multiplier).round() as u64)
}

// ─────────────────────────────────────────────────────────────────────────────
// Install environment
// ─────────────────────────────────────────────────────────────────────────────

/// Environment for a *child process* of the app.
///
/// SYNTHESIS clears the environment first and then re-adds only what the CLI
/// needs. That is deliberate: an AppImage exports `LD_LIBRARY_PATH` and
/// `LD_PRELOAD` pointing at its own bundled libraries, and letting those reach
/// the sidecar's grandchildren produces symbol-lookup failures deep inside
/// torch. `HOME`/`XDG_*` are kept so the Hugging Face weight cache lands
/// somewhere stable.
///
/// This is the *install* counterpart, and it is deliberately the opposite: pip
/// needs `HOME`, an augmented `PATH`, and the proxy variables to reach an
/// index at all. What it must not inherit is the loader interposition pair,
/// so `LD_PRELOAD`/`LD_LIBRARY_PATH` are explicitly removed from the parent
/// environment instead of relying on a blanket clear.
///
/// The two sites differ on purpose; see the design's
/// "`env_clear` divergence between install and synthesis" entry.
pub fn augmented_pocket_tts_env() -> Vec<(String, String)> {
    augmented_pocket_tts_env_from(&|key| std::env::var(key).ok())
}

/// Injectable-lookup variant so the contents are testable without mutating the
/// test process's environment.
pub fn augmented_pocket_tts_env_from(get: &dyn Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = Vec::new();
    fn push(vars: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
        if let Some(value) = value {
            vars.push((key.to_string(), value));
        }
    }

    push(&mut vars, "HOME", get("HOME"));
    push(&mut vars, "USER", get("USER"));
    vars.push(("PATH".to_string(), augmented_path(get)));
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "PIP_INDEX_URL",
    ] {
        push(&mut vars, key, get(key));
    }
    push(&mut vars, "XDG_CACHE_HOME", get("XDG_CACHE_HOME"));
    push(&mut vars, "XDG_DATA_HOME", get("XDG_DATA_HOME"));
    vars
}

/// `PATH` with the standard user-local and system bin dirs appended, so a
/// Python installed by a version manager or a distro default is findable even
/// when the GUI app inherited a bare `PATH`.
pub fn augmented_path(get: &dyn Fn(&str) -> Option<String>) -> String {
    let mut dirs: Vec<PathBuf> = get("PATH")
        .map(|raw| std::env::split_paths(&raw).collect())
        .unwrap_or_default();
    if let Some(home) = get("HOME") {
        dirs.push(PathBuf::from(home).join(".local").join("bin"));
    }
    if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
    }
    for fixed in ["/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(fixed));
    }
    std::env::join_paths(dedupe_dirs(dirs))
        .map(|joined| joined.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Environment for *synthesis*: cleared, then only what the CLI needs. See
/// [`augmented_pocket_tts_env`] for why the install path does not do this.
pub fn synthesis_env() -> Vec<(String, String)> {
    synthesis_env_from(&|key| std::env::var(key).ok())
}

pub fn synthesis_env_from(get: &dyn Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = Vec::new();
    for key in ["HOME", "USER"] {
        if let Some(value) = get(key) {
            vars.push((key.to_string(), value));
        }
    }
    vars.push((
        "PATH".to_string(),
        get("PATH").unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".to_string()),
    ));
    for key in [
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "DISPLAY",
    ] {
        if let Some(value) = get(key) {
            vars.push((key.to_string(), value));
        }
    }
    vars
}

/// Remove a directory tree, tolerating absence. Used to make sure no partial
/// runtime outlives a failed or cancelled install.
pub fn remove_dir_if_present(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk-space preflight
// ─────────────────────────────────────────────────────────────────────────────

/// The decision the disk gate makes, split from the volume probe so the rule
/// itself is testable — `volume_space` almost never returns `None` on a real
/// machine, so exercising "unmeasurable" through it is not possible.
pub fn decide_install_disk_space(
    measured: Option<(u64, u64)>,
    required: u64,
    dir: &Path,
) -> Result<()> {
    // Unmeasurable free space is not a refusal, matching the HF module's
    // `disk_insufficient`: a gate that blocks on a measurement failure blocks
    // installs on exactly the machines where they are most needed.
    let Some((available, _total)) = measured else {
        return Ok(());
    };
    if available < required {
        return Err(anyhow!(
            "Not enough free disk space to install Pocket TTS: {} is required and {} is available on {}. Free up space and try again.",
            human_bytes(required),
            human_bytes(available),
            dir.display()
        ));
    }
    Ok(())
}

/// Refuse to start when the volume holding the app data dir cannot hold the
/// install.
pub fn check_install_disk_space(dir: &Path, required: u64) -> Result<()> {
    decide_install_disk_space(
        crate::models::hf::system_info::volume_space(dir),
        required,
        dir,
    )
}

/// Preinstall disk gate for the Pocket TTS runtime.
pub fn pocket_tts_install_disk_check(app: &AppHandle) -> Result<()> {
    let install_dir = pocket_tts_install_dir(app)?;
    check_install_disk_space(&install_dir, POCKET_TTS_INSTALL_REQUIRED_BYTES)
}

/// `3221225472` → `"3.0 GB"`. Only used in messages, so MiB/GiB precision would
/// be false comfort.
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Python detection
// ─────────────────────────────────────────────────────────────────────────────

/// Interpreters to try, in order. Mirrors `detect_system_python`
/// (`notebooklm.rs:3069`) with the `~/.local/bin` and system-dir entries the
/// design calls for; a bare `python3` is useless to a GUI app that inherited a
/// minimal `PATH`.
pub fn pocket_tts_python_candidates() -> Vec<Vec<String>> {
    if cfg!(target_os = "windows") {
        return vec![
            vec!["py".to_string(), "-3".to_string()],
            vec!["python".to_string()],
            vec!["python3".to_string()],
        ];
    }
    let mut candidates = vec![
        vec!["python3".to_string()],
        vec!["python".to_string()],
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(vec![format!("{home}/.local/bin/python3")]);
        candidates.push(vec![format!("{home}/.local/bin/python")]);
    }
    for dir in ["/usr/local/bin", "/usr/bin"] {
        candidates.push(vec![format!("{dir}/python3")]);
        candidates.push(vec![format!("{dir}/python")]);
    }
    candidates
}

/// The message shown when no interpreter answers. Named here so the wording
/// has one home and can be asserted on.
pub fn python_missing_error() -> String {
    POCKET_TTS_PYTHON_REQUIREMENT.to_string()
}

/// The probe that decides whether an interpreter is usable.
///
/// `-c` cannot even reach `main` without a working standard library, whereas
/// `--version` prints its banner and exits 0 even when `PYTHONHOME` names a
/// directory with no `encodings` module — which is exactly what the AppImage
/// `AppRun` sets. `venv` is the module the install needs next, so it is the
/// honest gate rather than a proxy for one.
const PYTHON_PROBE: &[&str] = &["-c", "import venv"];

/// Does this interpreter start and import `venv` under `env_vars`?
///
/// Split out from [`detect_pocket_tts_python`] so the probe itself can be
/// tested against stubs instead of the machine's real Python.
async fn probe_pocket_tts_python(candidate: &[String], env_vars: &[(String, String)]) -> bool {
    let mut cmd = tokio::process::Command::new(&candidate[0]);
    if candidate.len() > 1 {
        cmd.args(&candidate[1..]);
    }
    for (key, value) in env_vars {
        if key == "LD_PRELOAD" || key == "LD_LIBRARY_PATH" {
            cmd.env_remove(key);
        } else {
            cmd.env(key, value);
        }
    }
    crate::utils::python_env::sanitize_python_env(cmd.as_std_mut());
    cmd.args(PYTHON_PROBE);
    matches!(cmd.output().await, Ok(output) if output.status.success())
}

/// First interpreter that can import `venv`, probed under the install
/// environment (augmented `PATH`, no loader interposition, no `PYTHONHOME`
/// inherited from the AppImage launcher).
pub async fn detect_pocket_tts_python() -> Result<Vec<String>> {
    let env_vars = augmented_pocket_tts_env();
    for candidate in pocket_tts_python_candidates() {
        if probe_pocket_tts_python(&candidate, &env_vars).await {
            return Ok(candidate);
        }
    }
    Err(anyhow!("{}", python_missing_error()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Install argument vectors
// ─────────────────────────────────────────────────────────────────────────────

/// `<venv python> -m pip install …`
///
/// `--extra-index-url` (rather than a `torch==2.x+cpu` pin) is what keeps this
/// in the hundreds of megabytes: in PEP 440 a local version sorts *above* the
/// plain release, so pip prefers the CPU wheel without pinning a version that
/// would go stale the day PyTorch publishes a new one. `--index-url` stays
/// PyPI so `pocket-tts` and its non-torch dependencies resolve normally.
pub fn pip_install_args(venv_python: &Path) -> Vec<String> {
    vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--progress-bar".to_string(),
        "off".to_string(),
        "--disable-pip-version-check".to_string(),
        "--index-url".to_string(),
        PYPI_INDEX_URL.to_string(),
        "--extra-index-url".to_string(),
        TORCH_CPU_EXTRA_INDEX.to_string(),
        POCKET_TTS_PACKAGE.to_string(),
    ]
}

/// `uv pip install --python <venv python> …` — same target, same indexes, much
/// faster on a torch-sized dependency set. A drop-in substitution behind
/// [`run_install_step`], not a second code path: the verify step afterwards is
/// the shared gate.
///
/// `--no-progress` is *not* pip's `--progress-bar off` spelled differently: `uv`
/// has no `--progress-bar` and rejects the whole command with `unexpected
/// argument` before touching the network. `--index-url` is kept because `uv`
/// still accepts it as a deprecated alias for `--default-index`, so one spelling
/// covers both old and current `uv`.
///
/// No byte progress is lost by asking for it: with a piped stderr `uv` reports
/// no per-artifact sizes either way (its bar is drawn for a terminal), so this
/// path shows an indeterminate bar where the pip path shows real bytes. Asking
/// explicitly beats inheriting whatever a future `uv` decides to draw.
pub fn uv_install_args(venv_python: &Path) -> Vec<String> {
    vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        venv_python.to_string_lossy().to_string(),
        "--no-progress".to_string(),
        "--index-url".to_string(),
        PYPI_INDEX_URL.to_string(),
        "--extra-index-url".to_string(),
        TORCH_CPU_EXTRA_INDEX.to_string(),
        POCKET_TTS_PACKAGE.to_string(),
    ]
}

/// Is a `uv` binary on the augmented `PATH`?
pub fn find_uv_binary(env_vars: &[(String, String)]) -> Option<PathBuf> {
    let path = env_vars
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(if cfg!(target_os = "windows") {
            "uv.exe"
        } else {
            "uv"
        });
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Child-process execution
// ─────────────────────────────────────────────────────────────────────────────

/// Why an install step ended the way it did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallError {
    Cancelled,
    Failed(String),
}

impl InstallError {
    pub fn message(&self) -> String {
        match self {
            InstallError::Cancelled => "Install cancelled.".to_string(),
            InstallError::Failed(message) => message.clone(),
        }
    }
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

/// How a streamed command ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutcome {
    pub code: Option<i32>,
    pub output: String,
}

impl CommandOutcome {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// `ETXTBSY` — the kernel still has the file write-accounted, so `execve` is
/// refused even though the writer is gone.
const ERR_TEXT_FILE_BUSY: i32 = 26;

/// Spawn, retrying briefly while the kernel reports `ETXTBSY`.
///
/// pip creates the venv's console script and the install pipeline execs it
/// moments later; a script that recent can still be write-accounted, and the
/// `execve` then fails with `Text file busy (os error 26)`. The state clears on
/// its own within milliseconds, so a short bounded backoff turns a spurious
/// install failure into a non-event. Anything that persists past the backoff
/// is a real problem and is reported as one.
async fn spawn_tolerant(
    cmd: &mut tokio::process::Command,
) -> std::io::Result<tokio::process::Child> {
    const ATTEMPTS: u32 = 20;
    let mut last: Option<std::io::Error> = None;
    for attempt in 0..ATTEMPTS {
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.raw_os_error() == Some(ERR_TEXT_FILE_BUSY) && attempt + 1 < ATTEMPTS => {
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(10 * (attempt as u64 + 1))).await;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("spawn failed")))
}

/// [`spawn_tolerant`] plus the collect-output behaviour of `Command::output`.
async fn output_tolerant(
    cmd: &mut tokio::process::Command,
) -> std::io::Result<std::process::Output> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    spawn_tolerant(cmd).await?.wait_with_output().await
}

fn trimmed_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let stdout_text = String::from_utf8_lossy(stdout);
    let text = if stderr_text.trim().is_empty() {
        stdout_text.trim().to_string()
    } else {
        stderr_text.trim().to_string()
    };
    if text.is_empty() {
        "no output".to_string()
    } else {
        text
    }
}

/// How the process finished, as far as the wait loop is concerned.
enum WaitResult {
    Exited(std::process::ExitStatus),
    Cancelled,
}

/// Poll for exit while watching the cancel token.
///
/// A `tokio::select!` over `child.wait()` cannot also call `child.start_kill()`
/// — the wait future holds the `&mut Child` for the whole select — so this
/// polls `try_wait()` instead. 100 ms of cancel latency is invisible next to a
/// multi-minute download and keeps the kill and the wait on the same borrow.
async fn wait_with_cancel(
    child: &mut tokio::process::Child,
    token: &CancellationToken,
) -> Result<WaitResult, std::io::Error> {
    loop {
        if token.is_cancelled() {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Ok(WaitResult::Cancelled);
        }
        match child.try_wait()? {
            Some(status) => return Ok(WaitResult::Exited(status)),
            None => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}

/// Run a command to completion, streaming every output line to `on_line` so
/// the pip/uv parser sees the real thing, and aborting promptly on cancel.
///
/// stdout and stderr are drained *while* the process runs, not after: a chatty
/// resolver can fill a 64 KiB pipe buffer and block the child forever if
/// nothing is reading.
pub async fn run_streamed_command<F>(
    program: &Path,
    args: &[String],
    install_env: bool,
    env_vars: &[(String, String)],
    token: &CancellationToken,
    on_line: F,
) -> Result<CommandOutcome, InstallError>
where
    F: FnMut(&str) + Send + 'static,
{
    let mut cmd = tokio::process::Command::new(program);
    if !install_env {
        cmd.env_clear();
    }
    for (key, value) in env_vars {
        cmd.env(key, value);
    }
    if install_env {
        for key in ["LD_PRELOAD", "LD_LIBRARY_PATH"] {
            cmd.env_remove(key);
        }
        // The AppImage launcher exports `PYTHONHOME`/`PYTHONPATH` for a Python
        // it does not bundle. Inheriting them makes `python3 -m venv` abort
        // with "No module named 'encodings'". Removed after `env_vars` is
        // applied so the removal wins.
        crate::utils::python_env::sanitize_python_env(cmd.as_std_mut());
    }
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = spawn_tolerant(&mut cmd).await.map_err(|e| {
        InstallError::Failed(format!("Could not start {}: {e}", program.display()))
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let collected: Arc<std::sync::Mutex<String>> =
        Arc::new(std::sync::Mutex::new(String::new()));
    let sink: Arc<std::sync::Mutex<F>> = Arc::new(std::sync::Mutex::new(on_line));

    let stdout_drain = async {
        if let Some(stdout) = stdout {
            drain_stream(stdout, collected.clone(), sink.clone()).await;
        }
    };
    let stderr_drain = async {
        if let Some(stderr) = stderr {
            drain_stream(stderr, collected.clone(), sink.clone()).await;
        }
    };

    let (waited, (), ()) = tokio::join!(
        wait_with_cancel(&mut child, token),
        stdout_drain,
        stderr_drain
    );
    let status = match waited {
        Ok(WaitResult::Exited(status)) => status,
        Ok(WaitResult::Cancelled) => return Err(InstallError::Cancelled),
        Err(e) => {
            return Err(InstallError::Failed(format!(
                "{} failed: {e}",
                program.display()
            )))
        }
    };

    let output = collected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .trim()
        .to_string();
    Ok(CommandOutcome {
        code: status.code(),
        output,
    })
}

async fn drain_stream<R, F>(
    stream: R,
    collected: Arc<std::sync::Mutex<String>>,
    sink: Arc<std::sync::Mutex<F>>,
) where
    R: tokio::io::AsyncRead + Unpin,
    F: FnMut(&str),
{
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        {
            let mut buffer = collected.lock().unwrap_or_else(|e| e.into_inner());
            if buffer.len() < MAX_CAPTURED_OUTPUT {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
        // pip writes its download log to stdout and its resolver log to
        // stderr; both matter to the parser, so both feed the same sink.
        let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
        sink(&line);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Install pipeline
// ─────────────────────────────────────────────────────────────────────────────

/// Everything the install pipeline needs that is not process-global, so the
/// orchestration can be tested against a temp dir.
#[derive(Debug, Clone)]
pub struct InstallPaths {
    pub install_dir: PathBuf,
    pub venv_dir: PathBuf,
    pub venv_python: PathBuf,
    pub executable: PathBuf,
}

impl InstallPaths {
    pub fn for_app(app: &AppHandle) -> Result<Self> {
        let venv_dir = pocket_tts_venv_dir(app)?;
        Ok(Self::from_venv_dir(&venv_dir))
    }

    pub fn from_venv_dir(venv_dir: &Path) -> Self {
        Self {
            install_dir: venv_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| venv_dir.to_path_buf()),
            venv_dir: venv_dir.to_path_buf(),
            venv_python: provisioned_python(venv_dir),
            executable: provisioned_executable(venv_dir),
        }
    }
}

/// Create the venv, install the package, verify it, and preload the weights.
///
/// Every failure path removes the venv first, so no partial runtime survives
/// to be reported as `Broken` on the next status call. Cancellation returns
/// [`InstallError::Cancelled`], which the caller turns into a `cancelled`
/// terminal event rather than a failure the user has to interpret.
#[allow(clippy::too_many_arguments)]
/// Tear down a runtime that never became usable.
///
/// A leftover partial venv is worse than none: the resolver would find it,
/// fail the probe, and report `Broken` on every later status call. So every
/// failure *and* cancellation goes through here before the caller returns.
pub fn cleanup_failed_install(paths: &InstallPaths) -> std::io::Result<()> {
    remove_dir_if_present(&paths.venv_dir)
}

pub async fn run_pocket_tts_install(
    app: AppHandle,
    id: String,
    paths: InstallPaths,
    token: CancellationToken,
) -> std::result::Result<String, InstallError> {
    let state = app.state::<PocketTTSInstallState>();
    let install_env = augmented_pocket_tts_env();

    let outcome = install_inner(&app, &id, &state, &paths, &token, &install_env).await;
    if outcome.is_err() {
        if let Err(e) = cleanup_failed_install(&paths) {
            tracing::warn!(
                "Failed to remove partial Pocket TTS venv {}: {e}",
                paths.venv_dir.display()
            );
        }
    }
    outcome
}

async fn install_inner(
    app: &AppHandle,
    id: &str,
    state: &State<'_, PocketTTSInstallState>,
    paths: &InstallPaths,
    token: &CancellationToken,
    install_env: &[(String, String)],
) -> std::result::Result<String, InstallError> {
    let progress_id = id.to_string();
    let emit_app = app.clone();
    let mut tracker = PocketTTSProgressTracker::new(
        Box::new(move |event| {
            if let Err(e) = emit_app.emit(PROGRESS_EVENT, event) {
                tracing::warn!("Failed to emit Pocket TTS install progress: {e}");
            }
        }),
        &progress_id,
    );

    // ── Phase 1: environment prep ──────────────────────────────────────────
    tracker.set_phase(PocketTTSInstallPhase::EnvironmentPrep);
    tracker.set_total(None);
    tracker.record(0);
    state.set_phase(id, PocketTTSInstallPhase::EnvironmentPrep);

    if let Err(e) = std::fs::create_dir_all(&paths.install_dir) {
        return Err(InstallError::Failed(format!(
            "Could not create the Pocket TTS install directory {}: {e}",
            paths.install_dir.display()
        )));
    }
    // A previous failed run may have left a half-built venv; `python -m venv`
    // would happily reuse it and `pip` would resolve against whatever it finds.
    let _ = remove_dir_if_present(&paths.venv_dir);

    let python = detect_pocket_tts_python()
        .await
        .map_err(|e| InstallError::Failed(e.to_string()))?;

    let mut venv_args = python[1..].to_vec();
    venv_args.extend([
        "-m".to_string(),
        "venv".to_string(),
        paths.venv_dir.to_string_lossy().to_string(),
    ]);
    let outcome = run_streamed_command(
        Path::new(&python[0]),
        &venv_args,
        true,
        install_env,
        token,
        |_| {},
    )
    .await?;
    if !outcome.success() {
        return Err(InstallError::Failed(format!(
            "Could not create a Python environment for Pocket TTS: {}",
            describe_failure(&outcome)
        )));
    }
    if !paths.venv_python.exists() {
        return Err(InstallError::Failed(format!(
            "The Python environment was created but {} is missing.",
            paths.venv_python.display()
        )));
    }
    tracker.emit_phase_end();

    // ── Phase 2: runtime fetch ─────────────────────────────────────────────
    tracker.set_phase(PocketTTSInstallPhase::RuntimeFetch);
    state.set_phase(id, PocketTTSInstallPhase::RuntimeFetch);

    let uv = find_uv_binary(install_env);
    let (program, args) = match uv {
        Some(uv) => (uv, uv_install_args(&paths.venv_python)),
        None => (
            paths.venv_python.clone(),
            pip_install_args(&paths.venv_python),
        ),
    };

    // The line sink has to be `Send + 'static` because the drain tasks outlive
    // the call frame, so the parser lives behind a shared mutex and is read
    // back once the command has exited.
    let parser: Arc<std::sync::Mutex<PipProgressParser>> =
        Arc::new(std::sync::Mutex::new(PipProgressParser::new()));
    let sink_parser = parser.clone();
    let install_outcome = run_streamed_command(
        &program,
        &args,
        true,
        install_env,
        token,
        move |line| {
            sink_parser
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .feed(line);
        },
    )
    .await;
    // `finish` accounts for the download that was still in flight when the
    // command exited — pip never announces that one.
    let (total, received) = {
        let mut guard = parser.lock().unwrap_or_else(|e| e.into_inner());
        guard.finish();
        (guard.announced_total(), guard.completed_bytes())
    };

    tracker.set_total(if total > 0 { Some(total) } else { None });
    tracker.record(received);
    tracker.emit_phase_end();

    let install_outcome = install_outcome?;
    if !install_outcome.success() {
        return Err(InstallError::Failed(format!(
            "Could not install the Pocket TTS runtime: {}",
            describe_failure(&install_outcome)
        )));
    }

    // ── Verify: the runtime must actually load ─────────────────────────────
    if !paths.executable.exists() {
        return Err(InstallError::Failed(format!(
            "The Pocket TTS runtime was installed but {} is missing.",
            paths.executable.display()
        )));
    }
    verify_provisioned_runtime(&paths.executable).await?;

    // ── Phase 3: weight preload ────────────────────────────────────────────
    tracker.set_phase(PocketTTSInstallPhase::WeightPreload);
    tracker.set_total(None);
    tracker.record(tracker.max_received);
    state.set_phase(id, PocketTTSInstallPhase::WeightPreload);
    preload_weights(paths).await?;
    tracker.emit_phase_end();

    tracker.set_phase(PocketTTSInstallPhase::Complete);
    state.set_phase(id, PocketTTSInstallPhase::Complete);
    tracker.emit_phase_end();

    Ok(format!(
        "Pocket TTS installed at {}",
        paths.executable.display()
    ))
}

fn describe_failure(outcome: &CommandOutcome) -> String {
    if outcome.output.is_empty() {
        match outcome.code {
            Some(code) => format!("exited with code {code} and printed nothing"),
            None => "was terminated by a signal".to_string(),
        }
    } else {
        outcome.output.clone()
    }
}

/// Run `pocket-tts --help` under the *synthesis* environment and require exit
/// code 0.
///
/// Synthesis environment on purpose: a runtime that only loads under the
/// install environment (because it inherited a `PATH` or a proxy the packaged
/// app will not have) is a broken runtime, and this is where that is caught
/// rather than on the user's first utterance.
pub async fn verify_provisioned_runtime(executable: &Path) -> std::result::Result<(), InstallError> {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.env_clear();
    for (key, value) in synthesis_env() {
        cmd.env(key, value);
    }
    cmd.arg("--help");
    match output_tolerant(&mut cmd).await {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(InstallError::Failed(format!(
            "The installed Pocket TTS runtime does not load: {} {RECOVERY_HINT}",
            trimmed_output(&output.stdout, &output.stderr)
        ))),
        Err(e) => Err(InstallError::Failed(format!(
            "The installed Pocket TTS runtime could not be started at {}: {e}. {RECOVERY_HINT}",
            executable.display()
        ))),
    }
}

/// Fetch the model weights by running one short generation. A failure here
/// fails the install: leaving the weights unfetched would hand the user a
/// runtime whose first utterance stalls on a multi-hundred-megabyte download
/// with no progress bar and no phase label.
pub async fn preload_weights(paths: &InstallPaths) -> std::result::Result<(), InstallError> {
    let output_path = paths.install_dir.join("pocket-tts-preload.wav");
    let text_path = paths.install_dir.join("pocket-tts-preload.txt");
    let _guard = TempFileGuard(text_path.clone());
    std::fs::write(&text_path, PRELOAD_TEXT)
        .map_err(|e| InstallError::Failed(format!("Could not stage the preload text: {e}")))?;

    let mut cmd = tokio::process::Command::new(&paths.executable);
    cmd.env_clear();
    for (key, value) in synthesis_env() {
        cmd.env(key, value);
    }
    cmd.args([
        "generate",
        "--text-file",
        &text_path.to_string_lossy(),
        "--voice",
        PocketVoice::Alba.as_str(),
        "--output-path",
        &output_path.to_string_lossy(),
    ]);
    let result = output_tolerant(&mut cmd).await;
    let _ = std::fs::remove_file(&output_path);

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(InstallError::Failed(format!(
            "Pocket TTS was installed but its model weights could not be prepared: {}",
            trimmed_output(&output.stdout, &output.stderr)
        ))),
        Err(e) => Err(InstallError::Failed(format!(
            "Pocket TTS was installed but its model weights could not be prepared: {e}"
        ))),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis
// ─────────────────────────────────────────────────────────────────────────────

/// Removes a file on every exit path, including a failed spawn.
///
/// The `--text-file` mechanism this guards is not incidental: it is how long
/// text gets past `ARG_MAX`, especially inside an AppImage, where the limit is
/// tighter and the failure mode is a spawn that never starts.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn build_generation_args(
    text_file_str: &str,
    voice: PocketVoice,
    output_str: &str,
) -> Vec<String> {
    vec![
        "generate".to_string(),
        "--text-file".to_string(),
        text_file_str.to_string(),
        "--voice".to_string(),
        voice.as_str().to_string(),
        "--output-path".to_string(),
        output_str.to_string(),
    ]
}

/// Generate speech using Pocket TTS.
///
/// Tries the resolved tiers in order. The first candidate that actually
/// produces audio wins; if a candidate starts but fails, the next one is
/// tried, so a half-broken provisioned venv does not make synthesis
/// impossible while a system install exists. If every candidate fails, the
/// error names the *preferred* one — that is the one the user has to act on —
/// and carries the recovery step.
pub async fn generate_pocket_speech(
    app_handle: &AppHandle,
    text: String,
    voice: String,
    _speed: f64,
) -> Result<PocketTTSResult> {
    let voice_id =
        PocketVoice::from_str(&voice).ok_or_else(|| anyhow!("Invalid voice: {}", voice))?;

    let cache_dir = app_handle.path().app_cache_dir()?;
    std::fs::create_dir_all(&cache_dir)?;
    let output_path = cache_dir.join(format!("pocket-tts-{}.wav", uuid::Uuid::new_v4()));
    let output_str = output_path
        .to_str()
        .ok_or_else(|| anyhow!("Invalid output path"))?
        .to_string();

    // For long text, write to a temp file and pass --text-file instead of
    // --text to stay under the OS argument-length limit (ARG_MAX) — the
    // wrapper translates it back to --text. The guard makes the cleanup
    // unconditional: a failed spawn used to leak the file forever, because
    // removal only happened inside the Terminated arm.
    let text_file = cache_dir.join(format!("pocket-tts-input-{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&text_file, &text)?;
    let _text_guard = TempFileGuard(text_file.clone());
    let text_file_str = text_file
        .to_str()
        .ok_or_else(|| anyhow!("Invalid text file path"))?
        .to_string();

    let args = build_generation_args(&text_file_str, voice_id, &output_str);
    let mut first_failure: Option<anyhow::Error> = None;

    for candidate in synthesis_candidates(app_handle) {
        let executable = candidate.path.to_string_lossy().to_string();
        match run_generation(&candidate.path, &args, &output_path).await {
            Ok(()) => return read_audio_result(&output_path),
            Err(message) => {
                if first_failure.is_none() {
                    first_failure = Some(anyhow!("{message} {RECOVERY_HINT}"));
                }
                let _ = std::fs::remove_file(&output_path);
            }
        }
        tracing::debug!("Pocket TTS candidate {executable} failed; trying the next tier");
    }

    Err(first_failure.unwrap_or_else(|| {
        anyhow!(
            "No Pocket TTS runtime is installed, so there is nothing to synthesize with. {RECOVERY_HINT}"
        )
    }))
}

/// Tiers synthesis will try: the resolved candidates in order, then the
/// packaged sidecar wrapper as a last resort.
fn synthesis_candidates(app: &AppHandle) -> Vec<ExecutableCandidate> {
    let mut candidates = pocket_tts_executable_candidates(app)
        .into_iter()
        .filter(|candidate| is_executable_file(&candidate.path))
        .collect::<Vec<_>>();
    if let Ok(sidecar_path) = sidecar_path() {
        if !candidates.iter().any(|c| c.path == sidecar_path) {
            candidates.push(ExecutableCandidate {
                path: sidecar_path,
                source: PocketTTSSource::Bundled,
            });
        }
    }
    candidates
}

/// The path `tauri_plugin_shell` would resolve `sidecar("pocket-tts")` to.
/// Used only as a last-resort launcher, and to name the path in errors.
fn sidecar_path() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    Ok(exe
        .with_file_name(if cfg!(target_os = "windows") {
            "pocket-tts.exe"
        } else {
            "pocket-tts"
        }))
}

async fn run_generation(
    executable: &Path,
    args: &[String],
    output_path: &Path,
) -> std::result::Result<(), String> {
    // The env_clear is documented at `augmented_pocket_tts_env`: an AppImage's
    // LD_LIBRARY_PATH/LD_PRELOAD reach the sidecar's grandchildren and cause
    // symbol-lookup failures inside torch.
    let mut cmd = tokio::process::Command::new(executable);
    cmd.env_clear();
    for (key, value) in synthesis_env() {
        cmd.env(key, value);
    }
    cmd.args(args);

    let output = output_tolerant_with_text(&mut cmd, text)
        .await
        .map_err(|e| {
            format!(
                "Could not start Pocket TTS at {}: {e}",
                executable.display()
            )
        })?;

    if !output.status.success() {
        return Err(format!(
            "Pocket TTS synthesis failed at {}: {}",
            executable.display(),
            trimmed_output(&output.stdout, &output.stderr)
        ));
    }
    if !output_path.exists() {
        return Err(format!(
            "Pocket TTS ran at {} but wrote no audio file.",
            executable.display()
        ));
    }
    Ok(())
}

fn read_audio_result(output_path: &Path) -> Result<PocketTTSResult> {
    let audio_data = std::fs::read(output_path)?;
    let audio_base64 =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &audio_data);
    let _ = std::fs::remove_file(output_path);

    // Estimate duration (assuming 24kHz sample rate, 16-bit mono)
    let sample_rate = 24000u32;
    let bytes_per_sample = 2u32;
    let num_samples = audio_data.len() as u32 / bytes_per_sample;
    let duration_sec = num_samples as f64 / sample_rate as f64;

    Ok(PocketTTSResult {
        audio_data: format!("data:audio/wav;base64,{}", audio_base64),
        sample_rate,
        duration_sec,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/// Check the Pocket TTS runtime. Returns `Ok` on **every** path — there is no
/// `?` on the spawn, because "the sidecar is missing" is a status, not an
/// error the caller should have to catch.
pub async fn check_pocket_tts_available(app_handle: &AppHandle) -> Result<PocketTTSStatus> {
    let install_in_flight = app_handle
        .try_state::<PocketTTSInstallState>()
        .map(|state| state.current().is_some())
        .unwrap_or(false);

    match resolve_pocket_tts_executable(app_handle).await {
        Ok(resolved) => Ok(PocketTTSStatus {
            state: if install_in_flight {
                PocketTTSState::Installing
            } else {
                PocketTTSState::Installed
            },
            source: Some(resolved.source),
            executable: Some(resolved.path.to_string_lossy().to_string()),
            detail: None,
            error: None,
        }),
        Err(failure) => Ok(failure.into_status()),
    }
}

/// Stop any ongoing Pocket TTS synthesis.
///
/// The old implementation nulled a `current_process` field that nothing ever
/// acted on; a spawned generation runs to completion and the OS reaps it. The
/// command is kept because the frontend calls it on teardown.
pub async fn stop_pocket_tts(_app_handle: &AppHandle) -> Result<()> {
    Ok(())
}

/// Clean up Pocket TTS resources
pub async fn cleanup_pocket_tts(app_handle: &AppHandle) -> Result<()> {
    stop_pocket_tts(app_handle).await?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

fn emit_finished(app: &AppHandle, id: &str, ok: bool, cancelled: bool, message: String) {
    if let Err(e) = app.emit(
        FINISHED_EVENT,
        PocketTTSInstallFinished {
            id: id.to_string(),
            ok,
            cancelled,
            message,
        },
    ) {
        tracing::warn!("Failed to emit Pocket TTS install-finished: {e}");
    }
}

/// Tauri command: Get Pocket TTS status
#[tauri::command]
pub async fn pocket_tts_status(app_handle: tauri::AppHandle) -> Result<PocketTTSStatus, String> {
    check_pocket_tts_available(&app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// Tauri command: Generate speech
#[tauri::command]
pub async fn pocket_tts_generate(
    app_handle: tauri::AppHandle,
    text: String,
    voice: String,
    speed: f64,
) -> Result<PocketTTSResult, String> {
    generate_pocket_speech(&app_handle, text, voice, speed)
        .await
        .map_err(|e| e.to_string())
}

/// Tauri command: Stop synthesis
#[tauri::command]
pub async fn pocket_tts_stop(app_handle: tauri::AppHandle) -> Result<(), String> {
    stop_pocket_tts(&app_handle).await.map_err(|e| e.to_string())
}

/// Tauri command: Cleanup resources
#[tauri::command]
pub async fn pocket_tts_cleanup(app_handle: tauri::AppHandle) -> Result<(), String> {
    cleanup_pocket_tts(&app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// Why an install request was refused before it started.
///
/// The *reason* is a code and the *message* is prose on purpose: the panel
/// branches on the code to pick localized recovery text, and falls back to the
/// message verbatim for anything it does not recognise. The alternative —
/// matching on substrings like `error.includes("not installed")` — is exactly
/// what this change deletes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PocketTTSInstallRefusal {
    /// `diskSpace` | `pythonMissing` | `alreadyInstalling` | `internal`
    pub reason: String,
    pub message: String,
}

impl PocketTTSInstallRefusal {
    pub fn new(reason: &str, message: impl Into<String>) -> Self {
        Self {
            reason: reason.to_string(),
            message: message.into(),
        }
    }
}

/// Classify a preflight failure into a refusal code.
///
/// The disk gate and the interpreter check are the only two preflight
/// failures, and both are recognised by their own constant rather than by
/// matching their message.
pub fn classify_install_refusal(message: &str) -> PocketTTSInstallRefusal {
    if message == POCKET_TTS_PYTHON_REQUIREMENT {
        return PocketTTSInstallRefusal::new("pythonMissing", message);
    }
    if message.contains(&human_bytes(POCKET_TTS_INSTALL_REQUIRED_BYTES)) {
        return PocketTTSInstallRefusal::new("diskSpace", message);
    }
    PocketTTSInstallRefusal::new("internal", message)
}

/// Tauri command: Install the Pocket TTS runtime.
///
/// Returns the install id as soon as the slot is claimed. The work runs
/// detached: a torch-sized download runs for minutes, and holding an IPC
/// response open that long is fragile against a webview reload and gives the
/// UI nothing to render in the meantime. Progress and the terminal event carry
/// the outcome instead.
#[tauri::command]
pub async fn pocket_tts_install(
    app_handle: tauri::AppHandle,
) -> std::result::Result<String, PocketTTSInstallRefusal> {
    pocket_tts_install_disk_check(&app_handle)
        .map_err(|e| classify_install_refusal(&e.to_string()))?;

    let id = format!("pocket-tts-{}", uuid::Uuid::new_v4());
    let token = CancellationToken::new();
    let state = app_handle.state::<PocketTTSInstallState>();
    if !state.try_register(InstallSlot::new(id.clone(), token.clone())) {
        return Err(PocketTTSInstallRefusal::new(
            "alreadyInstalling",
            "A Pocket TTS install is already running. Wait for it to finish or cancel it first.",
        ));
    }

    let paths = InstallPaths::for_app(&app_handle).map_err(|e| {
        state.unregister(&id);
        classify_install_refusal(&e.to_string())
    })?;

    let guard = PocketTTSInstallGuard::new(app_handle.clone(), id.clone());
    let task_app = app_handle.clone();
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        // The guard lives inside the task, so the slot is held for the whole
        // install and released even if the task panics.
        let _guard = guard;
        match run_pocket_tts_install(task_app.clone(), task_id.clone(), paths, token).await {
            Ok(message) => emit_finished(&task_app, &task_id, true, false, message),
            Err(InstallError::Cancelled) => {
                emit_finished(&task_app, &task_id, false, true, InstallError::Cancelled.message())
            }
            Err(InstallError::Failed(message)) => {
                emit_finished(&task_app, &task_id, false, false, message)
            }
        }
    });

    Ok(id)
}

/// Cancel the in-flight install, if any. `false` means nothing was running,
/// which the command reports as a successful no-op.
pub fn cancel_install_slot(state: &PocketTTSInstallState) -> bool {
    match state.current() {
        Some(slot) => {
            slot.token.cancel();
            true
        }
        None => false,
    }
}

/// Tauri command: Cancel an in-flight install.
///
/// The install task owns the cleanup and the terminal event, so exactly one
/// `install-finished` is emitted per install no matter which path ended it.
/// Cancelling with nothing in flight is a no-op that changes no state.
#[tauri::command]
pub async fn pocket_tts_cancel_install(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(state) = app_handle.try_state::<PocketTTSInstallState>() {
        cancel_install_slot(&state);
    }
    Ok(())
}

/// Remove the provisioned venv. Refused while an install is running; a no-op
/// when there is nothing provisioned.
///
/// Split from the command so both rules are testable without a `Tauri` app.
pub fn uninstall_provisioned_venv(in_flight: bool, venv_dir: &Path) -> Result<(), String> {
    if in_flight {
        return Err(
            "Cannot remove the Pocket TTS runtime while an install is running. Cancel it first."
                .to_string(),
        );
    }
    remove_dir_if_present(venv_dir).map_err(|e| {
        format!(
            "Could not remove the Pocket TTS runtime at {}: {e}",
            venv_dir.display()
        )
    })
}

/// Tauri command: Remove the runtime this app provisioned.
///
/// Only the provisioned venv is removed. A `pocket-tts` the user installed
/// themselves is never touched, and stays reported as available afterwards.
#[tauri::command]
pub async fn pocket_tts_uninstall(app_handle: tauri::AppHandle) -> Result<(), String> {
    let in_flight = app_handle
        .try_state::<PocketTTSInstallState>()
        .map(|state| state.current().is_some())
        .unwrap_or(false);
    let venv_dir = pocket_tts_venv_dir(&app_handle).map_err(|e| e.to_string())?;
    uninstall_provisioned_venv(in_flight, &venv_dir)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> tempfile::TempDir {
        tempfile::tempdir().unwrap_or_else(|e| panic!("tempdir for {label}: {e}"))
    }

    fn make_executable(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(path, perms).unwrap();
        }
    }

    fn always_working(_: &Path) -> ProbeOutcome {
        ProbeOutcome::Working
    }

    // ── 1.1 resolution ─────────────────────────────────────────────────────

    #[test]
    fn provisioned_copy_is_preferred_over_a_system_one() {
        let dir = temp_dir("provisioned-wins");
        let venv = dir.path().join("venv");
        let system = dir.path().join("usr-bin");
        make_executable(&provisioned_executable(&venv));
        make_executable(&system.join(executable_name()));

        let expected = provisioned_executable(&venv);
        let candidates = pocket_tts_candidates(Some(venv), Vec::new(), vec![system], None);
        let resolved = select_working_candidate(candidates, always_working).unwrap();

        assert_eq!(resolved.source, PocketTTSSource::Provisioned);
        assert_eq!(resolved.path, expected);
    }

    #[test]
    fn bundled_copy_is_preferred_over_path() {
        let dir = temp_dir("bundled-wins");
        let bundled_base = dir.path().join("src-tauri/bin/pocket-tts-runtime/x86_64");
        let system = dir.path().join("usr-bin");
        make_executable(&provisioned_executable(&bundled_base));
        make_executable(&system.join(executable_name()));

        let candidates = pocket_tts_candidates(
            None,
            vec![bundled_base.clone()],
            vec![system.clone()],
            None,
        );
        let resolved = select_working_candidate(candidates, always_working).unwrap();

        assert_eq!(resolved.source, PocketTTSSource::Bundled);
        assert_eq!(resolved.path, provisioned_executable(&bundled_base));
        assert!(system.join(executable_name()) != resolved.path);
    }

    #[test]
    fn system_copy_is_the_last_resort() {
        let dir = temp_dir("system-last");
        let system = dir.path().join("usr-bin");
        make_executable(&system.join(executable_name()));

        let candidates = pocket_tts_candidates(None, Vec::new(), vec![system.clone()], None);
        let resolved = select_working_candidate(candidates, always_working).unwrap();

        assert_eq!(resolved.source, PocketTTSSource::System);
    }

    #[test]
    fn a_candidate_that_exists_but_is_not_executable_is_broken_not_selected() {
        let dir = temp_dir("not-executable");
        let venv = dir.path().join("venv");
        let venv_exe = provisioned_executable(&venv);
        std::fs::create_dir_all(venv_exe.parent().unwrap()).unwrap();
        std::fs::write(&venv_exe, b"not a program").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&venv_exe).unwrap().permissions();
            perms.set_mode(0o644);
            std::fs::set_permissions(&venv_exe, perms).unwrap();
        }

        let candidates = pocket_tts_candidates(Some(venv), Vec::new(), Vec::new(), None);
        let failure = select_working_candidate(candidates, |path| {
            if !path.exists() {
                ProbeOutcome::Missing
            } else if !is_executable_file(path) {
                ProbeOutcome::NotExecutable
            } else {
                ProbeOutcome::Working
            }
        })
        .unwrap_err();

        assert_eq!(failure.broken.len(), 1);
        let status = failure.into_status();
        assert_eq!(status.state, PocketTTSState::Broken);
        assert!(status
            .executable
            .as_deref()
            .is_some_and(|p| p.ends_with(executable_name())));
    }

    #[test]
    fn a_broken_higher_tier_does_not_shadow_a_working_lower_one() {
        let dir = temp_dir("broken-shadows");
        let venv = dir.path().join("venv");
        let system = dir.path().join("usr-bin");
        make_executable(&provisioned_executable(&venv));
        make_executable(&system.join(executable_name()));

        let broken_path = provisioned_executable(&venv);
        let candidates = pocket_tts_candidates(Some(venv), Vec::new(), vec![system], None);
        let resolved = select_working_candidate(candidates, |path| {
            if *path == broken_path {
                ProbeOutcome::Failed("ImportError: no module named torch".to_string())
            } else {
                always_working(path)
            }
        })
        .unwrap();

        assert_eq!(resolved.source, PocketTTSSource::System);
    }

    #[test]
    fn a_candidate_in_the_invoking_directory_is_skipped() {
        let dir = temp_dir("invoked-dir");
        let venv = dir.path().join("venv");
        let invoked = dir.path().join("next-to-the-binary");
        make_executable(&invoked.join(executable_name()));
        make_executable(&provisioned_executable(&venv));

        let candidates = pocket_tts_candidates(
            Some(venv.clone()),
            Vec::new(),
            vec![invoked.clone()],
            Some(invoked),
        );

        assert!(!candidates
            .iter()
            .any(|c| c.path == dir.path().join("next-to-the-binary").join(executable_name())));
        assert!(candidates
            .iter()
            .any(|c| c.path == provisioned_executable(&venv)));
    }

    // ── 1.2 status shape ───────────────────────────────────────────────────

    #[test]
    fn source_and_state_round_trip_through_serde() {
        for source in [
            PocketTTSSource::Provisioned,
            PocketTTSSource::Bundled,
            PocketTTSSource::System,
        ] {
            let json = serde_json::to_string(&source).unwrap();
            let back: PocketTTSSource = serde_json::from_str(&json).unwrap();
            assert_eq!(source, back, "source {json} did not round-trip");
        }
        for state in [
            PocketTTSState::NotInstalled,
            PocketTTSState::Installing,
            PocketTTSState::Installed,
            PocketTTSState::Broken,
            PocketTTSState::Failed,
        ] {
            let json = serde_json::to_string(&state).unwrap();
            let back: PocketTTSState = serde_json::from_str(&json).unwrap();
            assert_eq!(state, back, "state {json} did not round-trip");
        }
    }

    #[test]
    fn status_no_longer_carries_a_fabricated_percentage() {
        let json = serde_json::to_value(PocketTTSStatus {
            state: PocketTTSState::NotInstalled,
            source: None,
            executable: None,
            detail: None,
            error: None,
        })
        .unwrap();
        let object = json.as_object().unwrap();
        assert!(!object.contains_key("available"));
        assert!(!object.contains_key("downloading"));
        assert!(!object.contains_key("download_progress"));
    }

    // ── 1.3 status never fails ─────────────────────────────────────────────

    #[test]
    fn resolution_failure_with_nothing_found_is_not_installed_not_an_error() {
        let failure = select_working_candidate(
            pocket_tts_candidates(None, Vec::new(), Vec::new(), None),
            |_| ProbeOutcome::Missing,
        )
        .unwrap_err();

        let status = failure.into_status();
        assert_eq!(status.state, PocketTTSState::NotInstalled);
        assert!(status.error.unwrap().contains("No Pocket TTS runtime"));
    }

    #[test]
    fn not_installed_status_never_mentions_an_os_errno() {
        let status = ResolutionFailure::default().into_status();
        let error = status.error.unwrap();
        assert!(!error.contains("os error"), "leaked an errno: {error}");
        assert!(error.contains("uv tool install pocket-tts"), "{error}");
    }

    // ── 1.4 / 2.1 disk gate ────────────────────────────────────────────────

    #[test]
    fn disk_gate_refuses_when_free_space_is_short() {
        let dir = temp_dir("disk-short");
        let outcome = check_install_disk_space(dir.path(), u64::MAX);
        let message = outcome.unwrap_err().to_string();
        assert!(message.contains(&human_bytes(u64::MAX)), "{message}");
        assert!(message.contains("free disk space"), "{message}");
    }

    #[test]
    fn disk_gate_proceeds_when_free_space_is_sufficient() {
        let dir = temp_dir("disk-ok");
        // 1 byte: any real volume clears this.
        assert!(check_install_disk_space(dir.path(), 1).is_ok());
    }

    #[test]
    fn disk_gate_proceeds_when_space_cannot_be_measured() {
        // `volume_space` maps a path to the longest matching mount point and
        // effectively never returns `None` on a live machine, so the rule is
        // exercised through the decision it feeds rather than through a probe.
        let outcome = decide_install_disk_space(None, u64::MAX, Path::new("/data"));
        assert!(outcome.is_ok(), "{:?}", outcome.err());
    }

    #[test]
    fn disk_gate_reports_both_numbers_when_it_refuses() {
        let error = decide_install_disk_space(Some((2_000_000_000, 4_000_000_000)), 3_000_000_000, Path::new("/data"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("3.0 GB"), "{error}");
        assert!(error.contains("2.0 GB"), "{error}");
        assert!(error.contains("/data"), "{error}");
    }

    #[test]
    fn the_required_bytes_constant_is_three_gibibytes() {
        assert_eq!(POCKET_TTS_INSTALL_REQUIRED_BYTES, 3_221_225_472);
    }

    // ── 2.2 python detection ───────────────────────────────────────────────

    #[test]
    fn python_candidate_list_covers_the_named_locations() {
        let candidates = pocket_tts_python_candidates();
        assert!(!candidates.is_empty());
        let joined = candidates
            .iter()
            .map(|c| c.join(" "))
            .collect::<Vec<_>>()
            .join("\n");
        if cfg!(target_os = "windows") {
            assert!(joined.contains("py -3"), "{joined}");
        } else {
            assert!(candidates.contains(&vec!["python3".to_string()]), "{joined}");
            assert!(candidates.contains(&vec!["python".to_string()]), "{joined}");
        }
    }

    #[test]
    fn missing_python_error_names_the_requirement() {
        let message = python_missing_error();
        assert!(message.contains("Python 3.10"), "{message}");
    }

    /// Write an executable `/bin/sh` stub and return it as a candidate argv.
    #[cfg(unix)]
    fn stub_interpreter(dir: &Path, label: &str, body: &str) -> Vec<String> {
        let stub = dir.join(label);
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(&stub, body).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&stub).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&stub, perms).unwrap();
        }
        vec![stub.to_string_lossy().to_string()]
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_probe_imports_venv_rather_than_asking_for_the_version() {
        let dir = temp_dir("probe-import");
        let stub = stub_interpreter(
            dir.path(),
            "imports-only",
            "#!/bin/sh\ncase \"$1\" in -c) exit 0;; --version) exit 9;; *) exit 9;; esac\n",
        );

        assert!(probe_pocket_tts_python(&stub, &[]).await);
    }

    /// The AppImage failure mode: `--version` answers, everything else dies in
    /// a broken `PYTHONHOME`. Such an interpreter must not be selected, or the
    /// install fails at `python -m venv` instead of falling through to the next
    /// candidate.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_interpreter_that_prints_its_version_but_cannot_start_is_rejected() {
        let dir = temp_dir("probe-broken-stdlib");
        let stub = stub_interpreter(
            dir.path(),
            "version-only",
            "#!/bin/sh\ncase \"$1\" in --version) echo 'Python 3.14.7'; exit 0;; esac\necho 'Fatal Python error: Failed to import encodings module' >&2\nexit 1\n",
        );

        assert!(!probe_pocket_tts_python(&stub, &[]).await);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_probe_strips_a_pythonhome_leaked_by_the_appimage_launcher() {
        let dir = temp_dir("probe-pythonhome");
        // The stub stands in for a real interpreter: it fails outright when it
        // is handed a PYTHONHOME, which is how CPython behaves.
        let stub = stub_interpreter(
            dir.path(),
            "env-sensitive",
            "#!/bin/sh\n[ -n \"${PYTHONHOME:-}\" ] && exit 1\n[ -n \"${PYTHONPATH:-}\" ] && exit 1\nexit 0\n",
        );
        let leaked = vec![
            (
                "PYTHONHOME".to_string(),
                "/tmp/.mount_PlethoraXXXX/usr/".to_string(),
            ),
            (
                "PYTHONPATH".to_string(),
                "/tmp/.mount_PlethoraXXXX/usr/share/pyshared/:".to_string(),
            ),
        ];

        assert!(
            probe_pocket_tts_python(&stub, &leaked).await,
            "the AppImage launcher must not reach the interpreter"
        );
    }

    // ── 2.3 install environment ────────────────────────────────────────────

    #[test]
    fn install_env_drops_loader_interposition_and_keeps_home_and_path() {
        let env = augmented_pocket_tts_env_from(&|key| match key {
            "HOME" => Some("/home/tester".to_string()),
            "PATH" => Some("/usr/bin".to_string()),
            "HTTP_PROXY" => Some("http://proxy:3128".to_string()),
            "LD_PRELOAD" => Some("/opt/appimage/hook.so".to_string()),
            "LD_LIBRARY_PATH" => Some("/opt/appimage/lib".to_string()),
            _ => None,
        });

        let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(!keys.contains(&"LD_PRELOAD"), "{keys:?}");
        assert!(!keys.contains(&"LD_LIBRARY_PATH"), "{keys:?}");
        assert!(keys.contains(&"HOME"), "{keys:?}");
        assert!(keys.contains(&"PATH"), "{keys:?}");
        assert!(keys.contains(&"HTTP_PROXY"), "{keys:?}");
        assert!(env.iter().any(|(k, v)| k == "HOME" && v == "/home/tester"));
        assert!(env
            .iter()
            .any(|(k, v)| k == "PATH" && v.contains("/usr/bin") && v.len() > "/usr/bin".len()));
    }

    #[test]
    fn synthesis_env_is_cleared_then_refilled() {
        let env = synthesis_env_from(&|key| match key {
            "HOME" => Some("/home/tester".to_string()),
            "PATH" => Some("/usr/bin".to_string()),
            "LD_PRELOAD" => Some("/opt/appimage/hook.so".to_string()),
            _ => None,
        });
        let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["HOME", "PATH"]);
    }

    /// `python3 -m venv` is the step that used to die with "No module named
    /// 'encodings'" under the AppImage, so the sanitising belongs on the
    /// install path specifically — synthesis already starts from a cleared env.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_install_command_does_not_hand_a_pythonhome_to_its_child() {
        let dir = temp_dir("install-pythonhome");
        let python = stub_interpreter(
            dir.path(),
            "python3",
            "#!/bin/sh\n[ -n \"${PYTHONHOME:-}\" ] && { echo 'Fatal Python error: Failed to import encodings module' >&2; exit 1; }\nexit 0\n",
        );
        let leaked = vec![
            (
                "PYTHONHOME".to_string(),
                "/tmp/.mount_PlethoraXXXX/usr/".to_string(),
            ),
            (
                "PYTHONPATH".to_string(),
                "/tmp/.mount_PlethoraXXXX/usr/share/pyshared/:".to_string(),
            ),
        ];
        let args = vec!["-m".to_string(), "venv".to_string()];

        let outcome = run_streamed_command(
            Path::new(&python[0]),
            &args,
            true,
            &leaked,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();

        assert!(outcome.success(), "{}", outcome.output);
    }

    // ── 2.4 install argument vectors ───────────────────────────────────────

    #[test]
    fn pip_args_pin_the_cpu_wheel_index() {
        let args = pip_install_args(Path::new("/data/venv/bin/python3"));
        let joined = args.join(" ");
        assert!(joined.contains(TORCH_CPU_EXTRA_INDEX), "{joined}");
        assert!(joined.contains(PYPI_INDEX_URL), "{joined}");
        assert!(args.contains(&"off".to_string()), "progress bar must be off");
        assert!(args.contains(&"--disable-pip-version-check".to_string()));
        assert_eq!(args.last().unwrap(), POCKET_TTS_PACKAGE);
    }

    #[test]
    fn uv_args_target_the_same_venv_with_the_same_index() {
        let python = Path::new("/data/venv/bin/python3");
        let args = uv_install_args(python);
        let joined = args.join(" ");
        assert!(joined.contains(TORCH_CPU_EXTRA_INDEX), "{joined}");
        assert!(joined.contains(PYPI_INDEX_URL), "{joined}");
        assert!(args.contains(&python.to_string_lossy().to_string()), "{joined}");
        assert_eq!(args.last().unwrap(), POCKET_TTS_PACKAGE);
    }

    /// `uv` has no `--progress-bar`: passing pip's spelling aborts the install
    /// before a byte is downloaded, with `unexpected argument '--progress-bar'`.
    #[test]
    fn each_front_end_gets_its_own_progress_flag() {
        let python = Path::new("/data/venv/bin/python3");

        let uv = uv_install_args(python);
        assert!(uv.contains(&"--no-progress".to_string()), "{uv:?}");
        assert!(!uv.contains(&"--progress-bar".to_string()), "{uv:?}");
        assert!(
            !uv.iter().any(|a| a == "off"),
            "uv takes a bare --no-progress, no value: {uv:?}"
        );

        let pip = pip_install_args(python);
        let progress = pip
            .iter()
            .position(|a| a == "--progress-bar")
            .expect("pip silences its bar");
        assert_eq!(pip[progress + 1], "off");
        assert!(!pip.contains(&"--no-progress".to_string()), "{pip:?}");
    }

    #[test]
    fn uv_is_found_on_the_augmented_path() {
        let dir = temp_dir("uv");
        let uv = dir.path().join("uv");
        make_executable(&uv);
        let env = vec![(
            "PATH".to_string(),
            std::env::join_paths([dir.path()]).unwrap().to_string_lossy().to_string(),
        )];
        assert_eq!(find_uv_binary(&env), Some(uv));
    }

    // ── 2.5 verify ─────────────────────────────────────────────────────────

    #[cfg(unix)]
    #[tokio::test]
    async fn a_stub_that_exits_non_zero_fails_verification_with_its_own_stderr() {
        let dir = temp_dir("verify-fail");
        let stub = dir.path().join("pocket-tts");
        std::fs::write(&stub, b"#!/bin/sh\necho 'ModuleNotFoundError: torch' >&2\nexit 3\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&stub).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&stub, perms).unwrap();
        }

        let error = verify_provisioned_runtime(&stub).await.unwrap_err();
        let message = error.message();
        assert!(message.contains("ModuleNotFoundError: torch"), "{message}");
        assert!(message.contains(RECOVERY_HINT), "{message}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_stub_that_exits_zero_verifies() {
        let dir = temp_dir("verify-ok");
        let stub = dir.path().join("pocket-tts");
        make_executable(&stub);
        if let Err(e) = verify_provisioned_runtime(&stub).await {
            panic!("verify failed: {}", e.message());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_missing_executable_does_not_leak_an_errno() {
        let dir = temp_dir("verify-missing");
        let stub = dir.path().join("pocket-tts");
        let error = verify_provisioned_runtime(&stub).await.unwrap_err();
        let message = error.message();
        assert!(message.contains(&stub.display().to_string()), "{message}");
        assert!(message.contains(RECOVERY_HINT), "{message}");
    }

    // ── 2.6 / 3.6 cleanup ──────────────────────────────────────────────────

    #[tokio::test]
    async fn a_failing_preload_leaves_no_venv_behind() {
        let dir = temp_dir("preload-fail");
        let paths = InstallPaths::from_venv_dir(&dir.path().join("venv"));
        std::fs::create_dir_all(&paths.venv_dir).unwrap();
        make_executable(&paths.executable);

        // The stub accepts --help (so verification passes) and then fails the
        // preload generation.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(
                &paths.executable,
                b"#!/bin/sh\ncase \"$1\" in --help) exit 0;; esac\necho 'weights unavailable' >&2\nexit 1\n",
            )
            .unwrap();
            let mut perms = std::fs::metadata(&paths.executable).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&paths.executable, perms).unwrap();

            let error = preload_weights(&paths).await.unwrap_err();
            assert!(
                error.message().contains("weights unavailable"),
                "preload message was: {}",
                error.message()
            );
        }

        // This is the cleanup the install pipeline runs on every non-Ok exit,
        // including cancellation. A leftover partial venv would be found by the
        // resolver and reported as `Broken` on every later status call.
        cleanup_failed_install(&paths).unwrap();
        assert!(
            !paths.venv_dir.exists(),
            "a failed install left {} behind",
            paths.venv_dir.display()
        );
    }

    #[test]
    fn remove_dir_if_present_tolerates_absence() {
        let dir = temp_dir("remove-absent");
        assert!(remove_dir_if_present(&dir.path().join("nope")).is_ok());
        let real = dir.path().join("real");
        std::fs::create_dir_all(&real).unwrap();
        assert!(remove_dir_if_present(&real).is_ok());
        assert!(!real.exists());
    }

    // ── 3.1 / 3.2 install slot and guard ───────────────────────────────────

    #[test]
    fn a_second_register_is_rejected() {
        let state = PocketTTSInstallState::default();
        assert!(state.try_register(InstallSlot::new(
            "first".into(),
            CancellationToken::new()
        )));
        assert!(!state.try_register(InstallSlot::new(
            "second".into(),
            CancellationToken::new()
        )));
        assert_eq!(state.current().unwrap().id, "first");
    }

    #[test]
    fn the_guard_releases_the_slot_on_drop() {
        let state = PocketTTSInstallState::default();
        state.try_register(InstallSlot::new("a".into(), CancellationToken::new()));
        // Simulate the guard's `Drop` without needing an `AppHandle`.
        assert!(state.unregister("a").is_some());
        assert!(state.current().is_none());
        assert!(state.try_register(InstallSlot::new(
            "b".into(),
            CancellationToken::new()
        )));
    }

    #[test]
    fn unregister_does_not_evict_a_successor() {
        let state = PocketTTSInstallState::default();
        state.try_register(InstallSlot::new("a".into(), CancellationToken::new()));
        state.unregister("a");
        state.try_register(InstallSlot::new("b".into(), CancellationToken::new()));
        assert!(state.unregister("a").is_none());
        assert_eq!(state.current().unwrap().id, "b");
    }

    #[test]
    fn the_phase_slot_tracks_the_current_phase() {
        let state = PocketTTSInstallState::default();
        state.try_register(InstallSlot::new("a".into(), CancellationToken::new()));
        state.set_phase("a", PocketTTSInstallPhase::WeightPreload);
        assert_eq!(
            state.current().unwrap().phase,
            PocketTTSInstallPhase::WeightPreload
        );
        // A stale id must not move the phase of the install that owns the slot.
        state.set_phase("other", PocketTTSInstallPhase::Complete);
        assert_eq!(
            state.current().unwrap().phase,
            PocketTTSInstallPhase::WeightPreload
        );
    }

    // ── 3.3 event payloads ─────────────────────────────────────────────────

    #[test]
    fn install_refusals_carry_a_code_not_just_prose() {
        let disk = classify_install_refusal(&format!(
            "Not enough free disk space to install Pocket TTS: {} is required and 1.0 GB is available on /data.",
            human_bytes(POCKET_TTS_INSTALL_REQUIRED_BYTES)
        ));
        assert_eq!(disk.reason, "diskSpace");
        assert!(disk.message.contains("1.0 GB"), "{}", disk.message);

        let python = classify_install_refusal(&python_missing_error());
        assert_eq!(python.reason, "pythonMissing");

        let other = classify_install_refusal("something unforeseen");
        assert_eq!(other.reason, "internal");
        assert_eq!(other.message, "something unforeseen");
    }

    #[test]
    fn the_refusal_serializes_as_a_code_and_a_message() {
        let json = serde_json::to_value(PocketTTSInstallRefusal::new("diskSpace", "full")).unwrap();
        assert_eq!(json["reason"], "diskSpace");
        assert_eq!(json["message"], "full");
    }

    #[test]
    fn event_payloads_serialize_with_the_documented_fields() {
        let progress = PocketTTSInstallProgress {
            id: "pocket-tts-1".into(),
            phase: PocketTTSInstallPhase::RuntimeFetch,
            received: 10,
            total: 100,
            percent: 10.0,
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["phase"], "runtime-fetch");
        for field in ["id", "phase", "received", "total", "percent"] {
            assert!(json.get(field).is_some(), "missing {field}");
        }

        let finished = PocketTTSInstallFinished {
            id: "pocket-tts-1".into(),
            ok: false,
            cancelled: true,
            message: "Install cancelled.".into(),
        };
        let json = serde_json::to_value(&finished).unwrap();
        for field in ["id", "ok", "cancelled", "message"] {
            assert!(json.get(field).is_some(), "missing {field}");
        }
    }

    #[test]
    fn the_phase_set_covers_all_three_reported_phases() {
        for phase in [
            PocketTTSInstallPhase::RuntimeFetch,
            PocketTTSInstallPhase::EnvironmentPrep,
            PocketTTSInstallPhase::WeightPreload,
        ] {
            let json = serde_json::to_string(&phase).unwrap();
            assert!(json.contains('-'), "phase {json} is not a readable slug");
        }
        // Phases must occupy disjoint, ascending shares of one bar.
        assert!(PocketTTSInstallPhase::EnvironmentPrep.share().1 < 100.0);
        assert!(PocketTTSInstallPhase::RuntimeFetch.share().0 > 0.0);
        assert!(PocketTTSInstallPhase::WeightPreload.share().0 >= 90.0);
        assert_eq!(PocketTTSInstallPhase::Complete.share(), (100.0, 100.0));
    }

    // ── 3.4 progress tracker ───────────────────────────────────────────────

    #[test]
    fn a_decreasing_byte_sequence_never_produces_a_decreasing_event() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let mut tracker = PocketTTSProgressTracker::new(
            Box::new(move |event: &PocketTTSInstallProgress| {
                sink_seen.lock().unwrap().push((event.received, event.percent));
            }),
            "id",
        )
        .without_throttle();
        tracker.set_phase(PocketTTSInstallPhase::RuntimeFetch);
        tracker.set_total(Some(1000));

        for received in [100u64, 250, 900, 400, 100, 1000] {
            tracker.record(received);
        }

        let events = seen.lock().unwrap().clone();
        assert!(events.len() > 1, "expected several events, got {events:?}");
        for pair in events.windows(2) {
            assert!(
                pair[1].0 >= pair[0].0,
                "received went backwards: {events:?}"
            );
            assert!(
                pair[1].1 >= pair[0].1,
                "percent went backwards: {events:?}"
            );
        }
        assert_eq!(events.last().unwrap().0, 1000);
    }

    #[test]
    fn an_unknown_total_reports_bytes_with_a_zero_percent() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let mut tracker = PocketTTSProgressTracker::new(
            Box::new(move |event: &PocketTTSInstallProgress| {
                sink_seen.lock().unwrap().push(event.clone());
            }),
            "id",
        )
        .without_throttle();
        tracker.set_phase(PocketTTSInstallPhase::WeightPreload);
        tracker.set_total(None);
        tracker.record(4096);

        let events = seen.lock().unwrap().clone();
        let last = events.last().unwrap();
        assert_eq!(last.received, 4096);
        assert_eq!(last.total, 0);
        assert_eq!(last.percent, 0.0);
    }

    // ── 3.5 pip output parsing ─────────────────────────────────────────────

    #[test]
    fn pip_output_yields_a_rising_byte_count() {
        let fixture = [
            "Collecting pocket-tts",
            "  Downloading pocket_tts-0.3.0-py3-none-any.whl (2.3 MB)",
            "  Downloading torch-2.5.1-cp313-cp313-manylinux_2_28_x86_64.whl (755.1 MB)",
            "  Downloading numpy-2.1.3-cp313-cp313-manylinux_2_28_x86_64.whl (16.4 MB)",
            "Installing collected packages: numpy, pocket-tts, torch",
            "Successfully installed numpy-2.1.3 pocket-tts-0.3.0 torch-2.5.1",
        ];
        let mut parser = PipProgressParser::new();
        let mut received: Vec<u64> = fixture
            .iter()
            .filter_map(|line| parser.feed(line))
            .collect();
        received.extend(parser.finish());

        assert_eq!(parser.announced_total(), 2_300_000 + 755_100_000 + 16_400_000);
        for pair in received.windows(2) {
            assert!(pair[1] > pair[0], "not monotonic: {received:?}");
        }
        assert_eq!(received.last().copied(), Some(parser.announced_total()));
    }

    #[test]
    fn a_cache_hit_advances_the_completed_count_without_streaming_bytes() {
        let mut parser = PipProgressParser::new();
        assert_eq!(parser.feed("  Using cached torch-2.5.1-cp313.whl"), None);
        assert_eq!(parser.cached_packages(), 1);
        assert_eq!(parser.announced_total(), 0);
    }

    #[test]
    fn output_with_no_parseable_sizes_yields_an_unknown_total() {
        let mut parser = PipProgressParser::new();
        for line in [
            "Collecting pocket-tts",
            "  Downloading pocket_tts-0.3.0-py3-none-any.whl",
            "  Downloading torch-2.5.1-cp313-cp313-manylinux_2_28_x86_64.whl",
            "Installing collected packages: pocket-tts",
            "Successfully installed pocket-tts-0.3.0",
        ] {
            assert_eq!(parser.feed(line), None, "unexpected bytes from {line}");
        }
        assert_eq!(parser.announced_total(), 0);
        assert_eq!(parser.completed_bytes(), 0);
    }

    #[test]
    fn sizes_parse_in_decimal_and_binary_units() {
        assert_eq!(parse_size("755.1 MB"), Some(755_100_000));
        assert_eq!(parse_size("900 bytes"), Some(900));
        assert_eq!(parse_size("1.5 GiB"), Some(1_610_612_736));
        assert_eq!(parse_size("nonsense"), None);
        assert_eq!(parse_size("12 parsecs"), None);
    }

    // ── 3.7 / 3.8 cancel and uninstall ─────────────────────────────────────

    #[test]
    fn cancelling_with_nothing_in_flight_is_a_no_op() {
        let state = PocketTTSInstallState::default();
        assert!(!cancel_install_slot(&state));
        assert!(state.current().is_none());
    }

    #[test]
    fn cancelling_trips_the_install_token() {
        let state = PocketTTSInstallState::default();
        let token = CancellationToken::new();
        state.try_register(InstallSlot::new("a".into(), token.clone()));
        assert!(cancel_install_slot(&state));
        assert!(token.is_cancelled());
    }

    #[test]
    fn uninstall_refuses_while_an_install_is_running() {
        let dir = temp_dir("uninstall-busy");
        let venv = dir.path().join("venv");
        std::fs::create_dir_all(&venv).unwrap();
        let error = uninstall_provisioned_venv(true, &venv).unwrap_err();
        assert!(error.contains("an install is running"), "unexpected refusal: {error}");
        // The running install is not disturbed.
        assert!(venv.exists());
    }

    #[test]
    fn uninstall_with_no_provided_runtime_succeeds_and_changes_nothing() {
        let dir = temp_dir("uninstall-empty");
        let venv = dir.path().join("venv");
        assert!(uninstall_provisioned_venv(false, &venv).is_ok());
        assert!(!venv.exists());
    }

    #[test]
    fn uninstall_removes_only_the_provisioned_copy() {
        let dir = temp_dir("uninstall-system-kept");
        let venv = dir.path().join("venv");
        let system = dir.path().join("usr-bin");
        make_executable(&provisioned_executable(&venv));
        let system_exe = system.join(executable_name());
        make_executable(&system_exe);

        assert!(uninstall_provisioned_venv(false, &venv).is_ok());
        assert!(system_exe.exists(), "the user's own install was deleted");

        // After removal the system copy must still resolve, and as `System`.
        let resolved = select_working_candidate(
            pocket_tts_candidates(Some(venv), Vec::new(), vec![system], None),
            |path| {
                if !path.exists() {
                    ProbeOutcome::Missing
                } else {
                    always_working(path)
                }
            },
        )
        .unwrap();
        assert_eq!(resolved.source, PocketTTSSource::System);
        assert_eq!(resolved.path, system_exe);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failed_spawn_names_the_path_and_the_recovery_step() {
        let dir = temp_dir("spawn-fail");
        let missing = dir.path().join("pocket-tts");
        let error = run_generation(&missing, &["generate".to_string()], &dir.path().join("o.wav"))
            .await
            .unwrap_err();
        let full = format!("{error} {RECOVERY_HINT}");

        assert!(full.contains(&missing.display().to_string()), "{full}");
        assert!(full.contains("uv tool install pocket-tts"), "{full}");
        assert!(!full.trim().starts_with("No such file"), "{full}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_non_zero_exit_keeps_the_clis_own_stderr_and_adds_recovery() {
        let dir = temp_dir("nonzero");
        let stub = dir.path().join("pocket-tts");
        std::fs::write(&stub, b"#!/bin/sh\necho 'CUDA out of memory' >&2\nexit 2\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&stub).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&stub, perms).unwrap();
        }
        let error = run_generation(&stub, &["generate".to_string()], &dir.path().join("o.wav"))
            .await
            .unwrap_err();
        let full = format!("{error} {RECOVERY_HINT}");

        assert!(full.contains("CUDA out of memory"), "{full}");
        assert!(full.contains("uv tool install pocket-tts"), "{full}");
    }

    #[test]
    fn the_temp_file_guard_removes_its_file() {
        let dir = temp_dir("temp-guard");
        let path = dir.path().join("input.txt");
        std::fs::write(&path, b"hello").unwrap();
        {
            let _guard = TempFileGuard(path.clone());
            assert!(path.exists());
        }
        assert!(!path.exists());
    }

    #[test]
    fn the_generation_args_use_text_file_not_text() {
        let args = build_generation_args("/tmp/in.txt", PocketVoice::Javert, "/tmp/out.wav");
        assert!(args.contains(&"--text-file".to_string()));
        assert!(!args.contains(&"--text".to_string()));
        assert_eq!(args[args.len() - 1], "/tmp/out.wav");
    }
}
