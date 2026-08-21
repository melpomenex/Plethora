//! Desktop sherpa-onnx TTS engine session.
//!
//! Owns the loaded `SherpaOnnxOfflineTts` handle on a dedicated worker thread
//! (onnxruntime sessions are never touched from the UI thread — design D5/D9).
//! Commands funnel through a channel; synthesis results come back over a
//! reply channel. One engine session per selected model: `unload()` on
//! provider/model switch, app quit, or drop.
//!
//! Cancellation: an `AtomicBool` flag is checked between generate calls (the
//! T1 spike showed the Supertonic impl invokes the progress callback only once
//! per call, so in-flight generation cannot be aborted mid-call — granularity
//! is per sentence chunk, which matches the per-chunk playback pipeline).
//!
//! Single-flight: one active synthesis at a time; a new request supersedes the
//! previous one by cancelling its flag first.

use crate::models::hf::adapters::{RunContract, SherpaTtsFamily};
use sherpa_ffi::{build_supertonic_config, SherpaCApi, SherpaOnnxGenerationConfig, EMPTY_C};
use std::ffi::{c_char, c_float, c_void, CString};
use std::os::raw::c_int32_t;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// A synthesized utterance: raw mono f32 samples + engine-reported rate.
pub struct SynthesisOutput {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

/// Info about the currently loaded model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedModelInfo {
    pub model_id: String,
    pub family: SherpaTtsFamily,
    pub sample_rate: u32,
    pub num_speakers: u32,
}

enum TtsRequest {
    Load {
        model_id: String,
        model_dir: PathBuf,
        contract: RunContract,
        reply: Sender<Result<LoadedModelInfo, String>>,
    },
    Synthesize {
        text: String,
        sid: i32,
        speed: f32,
        cancel: Arc<AtomicBool>,
        reply: Sender<Result<SynthesisOutput, String>>,
    },
    Unload {
        reply: Sender<Result<(), String>>,
    },
}

struct WorkerState {
    api: Option<SherpaCApi>,
    /// Raw `SherpaOnnxOfflineTts*` handle. Owned by the worker thread; never
    /// shared without the request channel.
    tts: *mut c_void,
    loaded: Option<LoadedModelInfo>,
    /// The config's owned C strings must outlive the engine handle.
    _config_strings: Option<sherpa_ffi::SupertonicConfigStrings>,
}

impl WorkerState {
    fn empty() -> WorkerState {
        WorkerState {
            api: None,
            tts: std::ptr::null_mut(),
            loaded: None,
            _config_strings: None,
        }
    }

    fn destroy_engine(&mut self) {
        if !self.tts.is_null() {
            if let Some(api) = &self.api {
                unsafe { (api.destroy)(self.tts) };
            }
            self.tts = std::ptr::null_mut();
        }
        self.loaded = None;
        // Drop the config strings after the engine (they were its inputs).
        self._config_strings = None;
    }
}

impl Drop for WorkerState {
    fn drop(&mut self) {
        // Drop guard: the engine handle is always destroyed even on error
        // paths (design D9).
        self.destroy_engine();
    }
}

/// Generation-time config for a synthesis call.
fn generation_config(sid: i32, speed: f32) -> SherpaOnnxGenerationConfig {
    SherpaOnnxGenerationConfig {
        silence_scale: 0.0,
        // Reader rate maps straight through, clamped to sherpa's sane range.
        speed: speed.clamp(0.5, 2.0),
        sid,
        reference_audio: std::ptr::null(),
        reference_audio_len: 0,
        reference_sample_rate: 0,
        reference_text: EMPTY_C.as_ptr(),
        num_steps: 0,
        extra: EMPTY_C.as_ptr(),
    }
}

/// Monotonic request counter for single-flight bookkeeping.
static ACTIVE_SYNTHESIS: AtomicU64 = AtomicU64::new(0);

/// The desktop sherpa TTS engine. Cloneable handle; all work happens on the
/// dedicated worker thread.
pub struct SherpaTtsEngine {
    tx: Sender<TtsRequest>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for SherpaTtsEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SherpaTtsEngine {
    /// Spawn the engine worker thread.
    pub fn new() -> SherpaTtsEngine {
        let (tx, rx) = channel();
        let worker = std::thread::Builder::new()
            .name("sherpa-tts".to_string())
            .spawn(move || worker_loop(rx))
            .expect("spawn sherpa-tts worker");
        SherpaTtsEngine {
            tx,
            worker: Mutex::new(Some(worker)),
        }
    }

    /// Load a model from an installed HF directory + validated contract.
    pub async fn load(
        &self,
        model_id: String,
        model_dir: PathBuf,
        contract: RunContract,
    ) -> Result<LoadedModelInfo, String> {
        let (reply_tx, reply_rx) = channel();
        self.tx
            .send(TtsRequest::Load {
                model_id,
                model_dir,
                contract,
                reply: reply_tx,
            })
            .map_err(|_| "sherpa TTS worker terminated".to_string())?;
        tokio::task::spawn_blocking(move || reply_rx.recv().map_err(|_| "worker dropped".to_string()))
            .await
            .map_err(|e| e.to_string())?
    }

    /// Synthesize one sentence chunk. Returns non-empty PCM samples at the
    /// engine-reported sample rate. Cancels any in-flight synthesis first
    /// (single-flight: newest request wins).
    pub async fn synthesize(&self, text: String, sid: i32, speed: f32) -> Result<SynthesisOutput, String> {
        if text.trim().is_empty() {
            return Err("text is empty".to_string());
        }
        let (reply_tx, reply_rx) = channel();
        let cancel = Arc::new(AtomicBool::new(false));
        ACTIVE_SYNTHESIS.fetch_add(1, Ordering::SeqCst);
        self.tx
            .send(TtsRequest::Synthesize {
                text,
                sid,
                speed,
                cancel: cancel.clone(),
                reply: reply_tx,
            })
            .map_err(|_| "sherpa TTS worker terminated".to_string())?;
        let result =
            tokio::task::spawn_blocking(move || reply_rx.recv().map_err(|_| "worker dropped".to_string()))
                .await
                .map_err(|e| e.to_string())?;
        ACTIVE_SYNTHESIS.fetch_sub(1, Ordering::SeqCst);
        result
    }

    /// Cancel the active synthesis (takes effect between generate calls).
    pub fn cancel(&self) {
        CANCEL_ACTIVE.store(true, Ordering::SeqCst);
    }

    /// Unload the current model and free all ONNX sessions.
    pub async fn unload(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = channel();
        self.tx
            .send(TtsRequest::Unload { reply: reply_tx })
            .map_err(|_| "sherpa TTS worker terminated".to_string())?;
        tokio::task::spawn_blocking(move || reply_rx.recv().map_err(|_| "worker dropped".to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
}

impl Drop for SherpaTtsEngine {
    fn drop(&mut self) {
        // Best-effort synchronous unload: send Unload and give the worker a
        // moment, then join. The worker's Drop guard also destroys the engine.
        let _ = self.tx.send(TtsRequest::Unload {
            reply: channel().0,
        });
        if let Ok(mut guard) = self.worker.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }
}

/// Process-wide cancel latch for the active synthesis. The engine serializes
/// synthesis (single worker), so one latch is unambiguous.
static CANCEL_ACTIVE: AtomicBool = AtomicBool::new(false);

fn worker_loop(rx: Receiver<TtsRequest>) {
    let mut state = WorkerState::empty();
    while let Ok(req) = rx.recv() {
        match req {
            TtsRequest::Load {
                model_id,
                model_dir,
                contract,
                reply,
            } => {
                let _ = reply.send(load_model(&mut state, &model_id, &model_dir, &contract));
            }
            TtsRequest::Synthesize {
                text,
                sid,
                speed,
                cancel,
                reply,
            } => {
                CANCEL_ACTIVE.store(false, Ordering::SeqCst);
                let _ = reply.send(synthesize_once(&mut state, &text, sid, speed, &cancel));
            }
            TtsRequest::Unload { reply } => {
                state.destroy_engine();
                let _ = reply.send(Ok(()));
            }
        }
    }
}

fn load_model(
    state: &mut WorkerState,
    model_id: &str,
    model_dir: &PathBuf,
    contract: &RunContract,
) -> Result<LoadedModelInfo, String> {
    // Reject invalid contracts before touching FFI.
    contract.validate().map_err(|e| format!("invalid run contract for {model_id}: {e}"))?;
    if !contract.paths_contained() {
        return Err(format!("run contract for {model_id} references paths outside the install dir"));
    }

    let lib_path = sherpa_ffi::locate_c_api_lib()
        .ok_or_else(|| "sherpa-onnx C API library not found; re-run scripts/download-sidecars.js".to_string())?;
    let api = SherpaCApi::load(&lib_path)?;

    let (strings, config) = build_supertonic_config(model_dir, contract)?;

    // Destroy any previously loaded engine before creating a new one.
    state.destroy_engine();
    state.api = None;

    let tts = unsafe { (api.create)(&config) };
    if tts.is_null() {
        return Err(format!(
            "sherpa-onnx rejected the Supertonic configuration for {model_id} (see logs; \
             verify all seven pipeline files are present)"
        ));
    }
    let sr = unsafe { (api.sample_rate)(tts) };
    let speakers = unsafe { (api.num_speakers)(tts) };
    if sr <= 0 {
        unsafe { (api.destroy)(tts) };
        return Err("engine reported an invalid sample rate".to_string());
    }

    state.api = Some(api);
    state.tts = tts;
    state._config_strings = Some(strings);
    let info = LoadedModelInfo {
        model_id: model_id.to_string(),
        family: contract.effective_tts_family().unwrap_or(SherpaTtsFamily::Supertonic),
        sample_rate: sr as u32,
        num_speakers: speakers.max(0) as u32,
    };
    state.loaded = Some(info.clone());
    Ok(info)
}

unsafe extern "C" fn progress_cb(
    _samples: *const c_float,
    _n: c_int32_t,
    _progress: c_float,
    _arg: *mut c_void,
) -> c_int32_t {
    // Return 0 to stop early when cancellation was requested. For Supertonic
    // this fires once per generate call (spike finding); the flag is also
    // checked between calls.
    if CANCEL_ACTIVE.load(Ordering::SeqCst) {
        0
    } else {
        1
    }
}

fn synthesize_once(
    state: &mut WorkerState,
    text: &str,
    sid: i32,
    speed: f32,
    cancel: &Arc<AtomicBool>,
) -> Result<SynthesisOutput, String> {
    if state.tts.is_null() {
        return Err("no model loaded".to_string());
    }
    let api = state.api.as_ref().ok_or("no model loaded")?;
    let text_c = CString::new(text).map_err(|e| format!("invalid text: {e}"))?;
    let gen_cfg = generation_config(sid, speed);

    let audio = unsafe {
        (api.generate)(
            state.tts,
            text_c.as_ptr(),
            &gen_cfg,
            Some(progress_cb),
            Arc::as_ptr(cancel) as *mut c_void,
        )
    };
    if audio.is_null() {
        return Err("synthesis failed (sherpa returned no audio)".to_string());
    }
    let n = unsafe { (*audio).n }.max(0) as usize;
    let sample_rate = unsafe { (*audio).sample_rate }.max(0) as u32;
    let mut samples = Vec::with_capacity(n);
    unsafe {
        for i in 0..n {
            samples.push(*(*audio).samples.add(i));
        }
    }
    unsafe { (api.destroy_audio)(audio) };

    if cancel.load(Ordering::SeqCst) || CANCEL_ACTIVE.load(Ordering::SeqCst) {
        // Cancelled: discard partial audio rather than returning it.
        return Err("synthesis cancelled".to_string());
    }
    if samples.is_empty() {
        return Err("synthesis produced no audio".to_string());
    }
    Ok(SynthesisOutput { samples, sample_rate })
}
