//! Dynamic FFI surface for the bundled sherpa-onnx C API (desktop TTS).
//!
//! The shared library ships inside the sherpa-onnx tarballs the build already
//! provisions (`libsherpa-onnx-c-api.{so,dylib}` / `sherpa-onnx-c-api.dll`,
//! copied into `src-tauri/bin` next to the sidecar). It is loaded at runtime
//! with `libloading` — no build-time link — and guarded by a version check
//! before any model load, mirroring the exe/onnxruntime ABI-mismatch guard the
//! sidecar path uses.
//!
//! Struct layouts are pinned to the provisioned sherpa-onnx release series
//! (1.13.x) and were verified against the v1.13.6 `c-api.h` during the T1
//! spike (see the change's tasks.md). Field order matters: these are C ABI
//! structs, not serde models.

#![allow(non_snake_case, non_camel_case_types, dead_code)]

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_float, c_void, CStr, CString};
use std::os::raw::c_int32_t;
use std::path::{Path, PathBuf};

/// The sherpa-onnx major.minor series the FFI structs are pinned to. The
/// runtime `SherpaOnnxGetVersionStr()` must start with this prefix before any
/// model load — a mismatch means the provisioned library predates or postdates
/// the struct layouts in this file and must not be trusted.
pub const EXPECTED_SHERPA_VERSION_PREFIX: &str = "1.13";

// ─────────────────────────────────────────────────────────────────────────────
// #[repr(C)] config structs (v1.13.x c-api.h)
// ─────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct SherpaOnnxOfflineTtsVitsModelConfig {
    pub model: *const c_char,
    pub lexicon: *const c_char,
    pub tokens: *const c_char,
    pub data_dir: *const c_char,
    pub noise_scale: c_float,
    pub noise_scale_w: c_float,
    pub length_scale: c_float,
    pub dict_dir: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsMatchaModelConfig {
    pub acoustic_model: *const c_char,
    pub vocoder: *const c_char,
    pub lexicon: *const c_char,
    pub tokens: *const c_char,
    pub data_dir: *const c_char,
    pub noise_scale: c_float,
    pub length_scale: c_float,
    pub dict_dir: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsKokoroModelConfig {
    pub model: *const c_char,
    pub voices: *const c_char,
    pub tokens: *const c_char,
    pub data_dir: *const c_char,
    pub length_scale: c_float,
    pub dict_dir: *const c_char,
    pub lexicon: *const c_char,
    pub lang: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsKittenModelConfig {
    pub model: *const c_char,
    pub voices: *const c_char,
    pub tokens: *const c_char,
    pub data_dir: *const c_char,
    pub length_scale: c_float,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsZipvoiceModelConfig {
    pub tokens: *const c_char,
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub vocoder: *const c_char,
    pub data_dir: *const c_char,
    pub lexicon: *const c_char,
    pub feat_scale: c_float,
    pub t_shift: c_float,
    pub target_rms: c_float,
    pub guidance_scale: c_float,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsPocketModelConfig {
    pub lm_flow: *const c_char,
    pub lm_main: *const c_char,
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub text_conditioner: *const c_char,
    pub vocab_json: *const c_char,
    pub token_scores_json: *const c_char,
    pub voice_embedding_cache_capacity: c_int32_t,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsSupertonicModelConfig {
    pub duration_predictor: *const c_char,
    pub text_encoder: *const c_char,
    pub vector_estimator: *const c_char,
    pub vocoder: *const c_char,
    pub tts_json: *const c_char,
    pub unicode_indexer: *const c_char,
    pub voice_style: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsModelConfig {
    pub vits: SherpaOnnxOfflineTtsVitsModelConfig,
    pub num_threads: c_int32_t,
    pub debug: c_int32_t,
    pub provider: *const c_char,
    pub matcha: SherpaOnnxOfflineTtsMatchaModelConfig,
    pub kokoro: SherpaOnnxOfflineTtsKokoroModelConfig,
    pub kitten: SherpaOnnxOfflineTtsKittenModelConfig,
    pub zipvoice: SherpaOnnxOfflineTtsZipvoiceModelConfig,
    pub pocket: SherpaOnnxOfflineTtsPocketModelConfig,
    pub supertonic: SherpaOnnxOfflineTtsSupertonicModelConfig,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTtsConfig {
    pub model: SherpaOnnxOfflineTtsModelConfig,
    pub rule_fsts: *const c_char,
    pub max_num_sentences: c_int32_t,
    pub rule_fars: *const c_char,
    pub silence_scale: c_float,
}

#[repr(C)]
pub struct SherpaOnnxGenerationConfig {
    pub silence_scale: c_float,
    pub speed: c_float,
    pub sid: c_int32_t,
    pub reference_audio: *const c_float,
    pub reference_audio_len: c_int32_t,
    pub reference_sample_rate: c_int32_t,
    pub reference_text: *const c_char,
    pub num_steps: c_int32_t,
    pub extra: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxGeneratedAudio {
    pub samples: *const c_float,
    pub n: c_int32_t,
    pub sample_rate: c_int32_t,
}

/// Generation progress callback. Return 1 to continue, 0 to stop early.
/// NOTE (verified in the T1 spike): the Supertonic impl calls this once per
/// `generate` call — after completion — so callback-abort does not provide
/// mid-call cancellation. Cancellation granularity is per generate call.
pub type ProgressCallbackWithArg =
    unsafe extern "C" fn(samples: *const c_float, n: c_int32_t, progress: c_float, arg: *mut c_void) -> c_int32_t;

// ─────────────────────────────────────────────────────────────────────────────
// Library discovery + loading
// ─────────────────────────────────────────────────────────────────────────────

/// Platform file name of the bundled sherpa-onnx C API shared library.
pub fn c_api_lib_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "sherpa-onnx-c-api.dll"
    } else if cfg!(target_os = "macos") {
        "libsherpa-onnx-c-api.dylib"
    } else {
        "libsherpa-onnx-c-api.so"
    }
}

/// Candidate directories the library is provisioned into, in probe order.
/// Mirrors the sidecar discovery rules: dev `src-tauri/bin`, bundled resource
/// `bin/`, and (Windows/externalBin layouts) the executable's directory.
pub fn candidate_lib_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    // 1. Dev source bin/ (provisioned by download-sidecars.js).
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"));
    if let Some(exe) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        // 2. Next to the main executable (externalBin layout / dev target dir).
        dirs.push(exe.clone());
        // 3. Bundled resource bin/ (Linux `bin/*.so*` / macOS `bin/*.dylib`
        //    resources land under <resource_dir>/bin; the exe sits in
        //    Contents/MacOS, so this is <exe>/../Resources/bin).
        dirs.push(exe.join("../Resources/bin"));
    }
    dirs
}

/// Locate the bundled C API library on disk.
pub fn locate_c_api_lib() -> Option<PathBuf> {
    let name = c_api_lib_name();
    candidate_lib_dirs()
        .into_iter()
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

#[cfg(windows)]
fn add_dll_directory(dir: &Path) {
    // Isolate dependency resolution (onnxruntime.dll) to our own bin dir —
    // never rely on PATH, where a System32 onnxruntime.dll can shadow ours
    // (documented past incident; see the change design D11).
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn AddDllDirectory(path: *const u16) -> *mut c_void;
    }
    let mut wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
    wide.push(0);
    unsafe {
        AddDllDirectory(wide.as_ptr());
    }
}

/// Load the C API library and verify its version guard.
pub struct SherpaCApi {
    /// Kept alive for the lifetime of every pointer handed out by this engine.
    _lib: Library,
    /// Raw symbol pointers copied out of the `Symbol`s (same lifetime as `_lib`).
    pub(crate) create: unsafe extern "C" fn(*const SherpaOnnxOfflineTtsConfig) -> *mut c_void,
    pub(crate) destroy: unsafe extern "C" fn(*mut c_void),
    pub(crate) sample_rate: unsafe extern "C" fn(*const c_void) -> c_int32_t,
    pub(crate) num_speakers: unsafe extern "C" fn(*const c_void) -> c_int32_t,
    pub(crate) generate:
        unsafe extern "C" fn(*const c_void, *const c_char, *const SherpaOnnxGenerationConfig, Option<ProgressCallbackWithArg>, *mut c_void) -> *const SherpaOnnxGeneratedAudio,
    pub(crate) destroy_audio: unsafe extern "C" fn(*const SherpaOnnxGeneratedAudio),
    pub version: String,
    pub path: PathBuf,
}

impl SherpaCApi {
    /// Load from `path` and run the version guard.
    pub fn load(path: &Path) -> Result<SherpaCApi, String> {
        #[cfg(windows)]
        if let Some(parent) = path.parent() {
            add_dll_directory(parent);
        }
        let lib = unsafe { Library::new(path) }.map_err(|e| format!("failed to load {}: {e}", path.display()))?;
        let api = unsafe {
            let get_version: Symbol<unsafe extern "C" fn() -> *const c_char> =
                lib.get(b"SherpaOnnxGetVersionStr").map_err(|e| format!("missing SherpaOnnxGetVersionStr: {e}"))?;
            let version = CStr::from_ptr(get_version()).to_string_lossy().into_owned();
            if !version.starts_with(EXPECTED_SHERPA_VERSION_PREFIX) {
                return Err(format!(
                    "sherpa-onnx C API version mismatch: library reports {version}, this build's \
                     FFI structs are pinned to {EXPECTED_SHERPA_VERSION_PREFIX}.x. Re-provision \
                     the sidecar runtime (scripts/download-sidecars.js)."
                ));
            }
            let create = *lib
                .get::<unsafe extern "C" fn(*const SherpaOnnxOfflineTtsConfig) -> *mut c_void>(
                    b"SherpaOnnxCreateOfflineTts",
                )
                .map_err(|e| format!("missing SherpaOnnxCreateOfflineTts: {e}"))?;
            let destroy = *lib
                .get::<unsafe extern "C" fn(*mut c_void)>(b"SherpaOnnxDestroyOfflineTts")
                .map_err(|e| format!("missing SherpaOnnxDestroyOfflineTts: {e}"))?;
            let sample_rate = *lib
                .get::<unsafe extern "C" fn(*const c_void) -> c_int32_t>(b"SherpaOnnxOfflineTtsSampleRate")
                .map_err(|e| format!("missing SherpaOnnxOfflineTtsSampleRate: {e}"))?;
            let num_speakers = *lib
                .get::<unsafe extern "C" fn(*const c_void) -> c_int32_t>(b"SherpaOnnxOfflineTtsNumSpeakers")
                .map_err(|e| format!("missing SherpaOnnxOfflineTtsNumSpeakers: {e}"))?;
            let generate = *lib
                .get::<unsafe extern "C" fn(
                    *const c_void,
                    *const c_char,
                    *const SherpaOnnxGenerationConfig,
                    Option<ProgressCallbackWithArg>,
                    *mut c_void,
                ) -> *const SherpaOnnxGeneratedAudio>(b"SherpaOnnxOfflineTtsGenerateWithConfig")
                .map_err(|e| format!("missing SherpaOnnxOfflineTtsGenerateWithConfig: {e}"))?;
            let destroy_audio = *lib
                .get::<unsafe extern "C" fn(*const SherpaOnnxGeneratedAudio)>(
                    b"SherpaOnnxDestroyOfflineTtsGeneratedAudio",
                )
                .map_err(|e| format!("missing SherpaOnnxDestroyOfflineTtsGeneratedAudio: {e}"))?;
            SherpaCApi {
                _lib: lib,
                create,
                destroy,
                sample_rate,
                num_speakers,
                generate,
                destroy_audio,
                version,
                path: path.to_path_buf(),
            }
        };
        Ok(api)
    }

    /// Probe availability only: locate + load + version-check, then unload.
    pub fn probe() -> Result<String, String> {
        let path = locate_c_api_lib().ok_or_else(|| {
            format!(
                "sherpa-onnx C API library ({}) not found. It ships with the bundled \
                 sherpa-onnx runtime; re-run scripts/download-sidecars.js.",
                c_api_lib_name()
            )
        })?;
        let api = SherpaCApi::load(&path)?;
        Ok(api.version)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config construction (pure — unit-testable without loading the library)
// ─────────────────────────────────────────────────────────────────────────────

/// Owned C strings for a Supertonic config, plus the assembled FFI config.
///
/// The `CString`s must outlive any call that uses the config; keep the struct
/// alive alongside it (same pattern as the T1 spike).
pub struct SupertonicConfigStrings {
    pub duration_predictor: CString,
    pub text_encoder: CString,
    pub vector_estimator: CString,
    pub vocoder: CString,
    pub tts_json: CString,
    pub unicode_indexer: CString,
    pub voice_style: CString,
    pub provider: CString,
}

/// Build the absolute-path Supertonic config from an install dir + contract.
///
/// Rejects contracts that are not a valid Supertonic pipeline *before* any
/// FFI call, and verifies every referenced file exists on disk (sherpa's
/// `Validate()` would fail later with a less precise error).
pub fn build_supertonic_config(
    model_dir: &Path,
    contract_files: &crate::models::hf::adapters::RunContract,
) -> Result<(SupertonicConfigStrings, SherpaOnnxOfflineTtsConfig), String> {
    use crate::models::hf::adapters::{RunContract, SherpaTtsFamily};
    let RunContract::SherpaTts {
        family: Some(SherpaTtsFamily::Supertonic),
        model_file,
        text_encoder_file,
        vector_estimator_file,
        vocoder_file,
        tts_json_file,
        unicode_indexer_file,
        voice_bin_file,
        ..
    } = contract_files
    else {
        return Err("not a Supertonic sherpa TTS contract".to_string());
    };
    contract_files.validate().map_err(|e| format!("invalid run contract: {e}"))?;

    let resolve = |rel: &Option<String>| -> Result<CString, String> {
        let rel = rel.as_deref().ok_or("missing Supertonic pipeline file")?;
        let abs = model_dir.join(rel);
        if !abs.is_file() {
            return Err(format!("model file missing: {}", abs.display()));
        }
        CString::new(abs.to_string_lossy().as_ref()).map_err(|e| e.to_string())
    };

    let strings = SupertonicConfigStrings {
        duration_predictor: resolve(&Some(model_file.clone()))?,
        text_encoder: resolve(text_encoder_file)?,
        vector_estimator: resolve(vector_estimator_file)?,
        vocoder: resolve(vocoder_file)?,
        tts_json: resolve(tts_json_file)?,
        unicode_indexer: resolve(unicode_indexer_file)?,
        voice_style: resolve(voice_bin_file)?,
        provider: CString::new("cpu").unwrap(),
    };

    // Zero every family config, then fill only Supertonic. `num_threads = 2`
    // matches the Android thermal cap; provider is CPU (no accelerators in
    // the critical path — design D9).
    let config = SherpaOnnxOfflineTtsConfig {
        model: SherpaOnnxOfflineTtsModelConfig {
            vits: unsafe { std::mem::zeroed() },
            num_threads: 2,
            debug: 0,
            provider: strings.provider.as_ptr(),
            matcha: unsafe { std::mem::zeroed() },
            kokoro: unsafe { std::mem::zeroed() },
            kitten: unsafe { std::mem::zeroed() },
            zipvoice: unsafe { std::mem::zeroed() },
            pocket: unsafe { std::mem::zeroed() },
            supertonic: SherpaOnnxOfflineTtsSupertonicModelConfig {
                duration_predictor: strings.duration_predictor.as_ptr(),
                text_encoder: strings.text_encoder.as_ptr(),
                vector_estimator: strings.vector_estimator.as_ptr(),
                vocoder: strings.vocoder.as_ptr(),
                tts_json: strings.tts_json.as_ptr(),
                unicode_indexer: strings.unicode_indexer.as_ptr(),
                voice_style: strings.voice_style.as_ptr(),
            },
        },
        rule_fsts: EMPTY_C.as_ptr(),
        // Sentence-at-a-time chunking: the caller feeds one sentence chunk per
        // generate call, so this cap only bounds internal batching.
        max_num_sentences: 1,
        rule_fars: EMPTY_C.as_ptr(),
        silence_scale: 0.0,
    };
    Ok((strings, config))
}

/// An empty C string for optional `const char*` fields.
pub(crate) static EMPTY_C: &[c_char] = &[0];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::adapters::RunContract;

    fn supertonic_contract() -> RunContract {
        RunContract::SherpaTts {
            family: Some(crate::models::hf::adapters::SherpaTtsFamily::Supertonic),
            model_file: "duration_predictor.int8.onnx".to_string(),
            tokens_file: None,
            voices_file: None,
            text_encoder_file: Some("text_encoder.int8.onnx".to_string()),
            vector_estimator_file: Some("vector_estimator.int8.onnx".to_string()),
            vocoder_file: Some("vocoder.int8.onnx".to_string()),
            tts_json_file: Some("tts.json".to_string()),
            unicode_indexer_file: Some("unicode_indexer.bin".to_string()),
            voice_bin_file: Some("voice.bin".to_string()),
            data_dir: None,
        }
    }

    fn write_model_files(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        for f in [
            "duration_predictor.int8.onnx",
            "text_encoder.int8.onnx",
            "vector_estimator.int8.onnx",
            "vocoder.int8.onnx",
            "tts.json",
            "unicode_indexer.bin",
            "voice.bin",
        ] {
            std::fs::write(dir.join(f), vec![0x42; 16]).unwrap();
        }
    }

    #[test]
    fn supertonic_config_builds_absolute_paths() {
        let dir = tempfile::tempdir().unwrap();
        write_model_files(dir.path());
        let (strings, _config) = build_supertonic_config(dir.path(), &supertonic_contract())
            .expect("valid contract builds");
        let dp = strings.duration_predictor.to_str().unwrap();
        assert!(Path::new(dp).is_absolute(), "paths must be absolute: {dp}");
        assert!(dp.ends_with("duration_predictor.int8.onnx"));
        assert_eq!(strings.provider.to_str().unwrap(), "cpu");
    }

    #[test]
    fn supertonic_config_rejects_missing_files_before_ffi() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path()).unwrap();
        // Contract is well-formed but the files do not exist on disk.
        let err = build_supertonic_config(dir.path(), &supertonic_contract())
            .expect_err("missing files must be rejected before load");
        assert!(err.contains("missing"), "{err}");
    }

    #[test]
    fn supertonic_config_rejects_non_supertonic_contract() {
        let dir = tempfile::tempdir().unwrap();
        let vits = RunContract::SherpaTts {
            family: Some(crate::models::hf::adapters::SherpaTtsFamily::Vits),
            model_file: "model.onnx".to_string(),
            tokens_file: Some("tokens.txt".to_string()),
            voices_file: None,
            text_encoder_file: None,
            vector_estimator_file: None,
            vocoder_file: None,
            tts_json_file: None,
            unicode_indexer_file: None,
            voice_bin_file: None,
            data_dir: None,
        };
        let err = build_supertonic_config(dir.path(), &vits).expect_err("vits rejected in v1");
        assert!(err.contains("not a Supertonic"), "{err}");
    }

    #[test]
    fn candidate_lib_dirs_include_manifest_bin() {
        let dirs = candidate_lib_dirs();
        assert!(dirs
            .iter()
            .any(|d| d.ends_with("bin") && d.starts_with(env!("CARGO_MANIFEST_DIR"))));
    }
}
