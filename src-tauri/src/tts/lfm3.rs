//! Portable local LFM3 provider. Inference owns no playback or edition state.
use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex as AsyncMutex,
};
use tokio_util::sync::CancellationToken;

const MAX_WAV: u64 = 1_440_044;
const RUNTIME_COMMIT: &str = "ac8e1694d837b11ed0aab944a6a2eee34b9c4d80";
const LANGUAGES: &[&str] = &[
    "ar", "da", "de", "el", "en", "en-gb", "es", "fi", "fr", "he", "it", "ja", "ko", "nl", "pl",
    "pt", "sv", "tr", "zh",
];

pub(crate) struct Host {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    model_id: String,
    backend: Option<String>,
    stopping: bool,
}

#[derive(Default)]
pub struct Lfm3TtsState {
    host: AsyncMutex<Option<Host>>,
    requests: Mutex<HashMap<String, (String, CancellationToken)>>,
    cancelled_ids: Mutex<HashMap<String, std::time::Instant>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lfm3Status {
    available: bool,
    loaded: bool,
    model_id: Option<String>,
    backend: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lfm3Result {
    audio_data: String,
    sample_rate: u32,
    duration_sec: f64,
    backend: String,
}

fn executable(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return None;
    }
    let name = if cfg!(windows) {
        "lfm3-host.exe"
    } else {
        "lfm3-host"
    };
    let dev = format!(
        "lfm3-host-{}{}",
        env!("TAURI_TARGET_TRIPLE"),
        if cfg!(windows) { ".exe" } else { "" }
    );
    let mut paths = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(&dev)];
    if let Ok(root) = app.path().resource_dir() {
        paths.push(root.join("bin").join(&dev));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.push(parent.join(name));
        }
    }
    paths.into_iter().find(|p| {
        p.metadata()
            .map(|m| m.is_file() && m.len() > 1024)
            .unwrap_or(false)
    })
}

fn runtime_dir(app: &AppHandle, exe: &std::path::Path) -> PathBuf {
    let adjacent = exe.parent().unwrap_or(exe).join("lfm3-runtime");
    if adjacent.is_dir() {
        return adjacent;
    }
    app.path()
        .resource_dir()
        .map(|p| p.join("bin/lfm3-runtime"))
        .unwrap_or(adjacent)
}

fn command(app: &AppHandle, exe: &std::path::Path) -> Command {
    let root = runtime_dir(app, exe);
    let mut cmd = Command::new(exe);
    cmd.env_clear().kill_on_drop(true).stderr(Stdio::null());
    for key in [
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "HOME",
        "LANG",
        "LC_ALL",
        "CUDA_VISIBLE_DEVICES",
    ] {
        if let Some(value) = std::env::var_os(key) {
            cmd.env(key, value);
        }
    }
    cmd.env("LD_LIBRARY_PATH", &root)
        .env("DYLD_LIBRARY_PATH", &root);
    let mut search = vec![root];
    if let Some(system) = std::env::var_os("SYSTEMROOT") {
        search.push(PathBuf::from(system).join("System32"));
    }
    if let Ok(path) = std::env::join_paths(search) {
        cmd.env("PATH", path);
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
    cmd
}

async fn read_message(reader: &mut (impl AsyncRead + Unpin)) -> Result<Value, String> {
    let mut frame = Vec::with_capacity(512);
    for _ in 0..65_536 {
        let byte = reader
            .read_u8()
            .await
            .map_err(|_| "LFM3 runtime closed its response pipe".to_string())?;
        if byte == b'\n' {
            return serde_json::from_slice(&frame)
                .map_err(|_| "Invalid LFM3 runtime response".into());
        }
        frame.push(byte);
    }
    Err("LFM3 runtime response exceeds the protocol limit".into())
}

fn validate_handshake(value: &Value) -> Result<(), String> {
    if value["protocol"] != 1
        || value["runtimeCommit"] != RUNTIME_COMMIT
        || !value["backends"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    {
        return Err("LFM3 runtime version is incompatible; reinstall the runtime".into());
    }
    Ok(())
}

async fn retire(slot: &mut Option<Host>) -> Result<(), String> {
    if let Some(host) = slot.as_mut() {
        host.stopping = true;
        let stopped = match tokio::time::timeout(Duration::from_secs(2), host.child.kill()).await {
            Ok(Ok(())) => true,
            Ok(Err(_)) => host.child.try_wait().ok().flatten().is_some(),
            Err(_) => false,
        };
        if !stopped {
            return Err("LFM3 is still stopping; retry after its process exits".into());
        }
        // kill() waits for the child; try_wait also covers an already-exited child.
    }
    *slot = None;
    Ok(())
}

async fn reply(host: &mut Host, token: &CancellationToken, seconds: u64) -> Result<Value, String> {
    tokio::select! {
        _ = token.cancelled() => Err("LFM3 synthesis cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(seconds), read_message(&mut host.output)) =>
            result.map_err(|_| "LFM3 synthesis timed out".to_string())?,
    }
}

async fn synthesize(
    app: &AppHandle,
    state: &Lfm3TtsState,
    id: &str,
    model_id: &str,
    text: &str,
    voice: &str,
    language: &str,
    token: &CancellationToken,
) -> Result<Lfm3Result, String> {
    let mut slot = tokio::select! {
        _ = token.cancelled() => return Err("LFM3 synthesis cancelled".into()),
        guard = state.host.lock() => guard,
    };
    if let Some(host) = slot.as_mut() {
        if host.stopping && host.child.try_wait().ok().flatten().is_none() {
            return Err("LFM3 is still stopping".into());
        }
        if host.stopping
            || host.model_id != model_id
            || host.child.try_wait().ok().flatten().is_some()
        {
            retire(&mut slot).await?;
        }
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("lfm3-tts");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| e.to_string())?;
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|e| e.to_string())?;
    if slot.is_none() {
        let repo = app.state::<crate::database::Repository>();
        let (install_dir, contract) =
            crate::models::hf::manager::resolve_installed_tts(repo.pool(), model_id)
                .await
                .ok_or("Install the LFM3 model from Settings first")?;
        if !matches!(
            contract,
            crate::models::hf::RunContract::Lfm3AudioTts { .. }
        ) {
            return Err("Selected model is not LFM3".into());
        }
        let dir = tokio::fs::canonicalize(&install_dir)
            .await
            .map_err(|_| "LFM3 model files are missing")?;
        let mut paths = Vec::new();
        for file in contract.contract_files() {
            let path = tokio::fs::canonicalize(dir.join(file))
                .await
                .map_err(|_| "LFM3 model files are missing")?;
            if !path.starts_with(&dir) {
                return Err("LFM3 model path escapes its installation".into());
            }
            paths.push(path);
        }
        let exe = executable(app).ok_or("LFM3 runtime is unavailable in this app build")?;
        let mut child = command(app, &exe)
            .args(&paths)
            .arg(&root)
            .arg(runtime_dir(app, &exe))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|_| "LFM3 runtime could not start")?;
        let input = child.stdin.take().ok_or("LFM3 input pipe unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("LFM3 output pipe unavailable")?);
        *slot = Some(Host {
            child,
            input,
            output,
            model_id: model_id.into(),
            backend: None,
            stopping: false,
        });
        let loaded = reply(slot.as_mut().unwrap(), token, 90).await.and_then(|value| {
            validate_handshake(&value)?;
            if value["ready"] != true { return Err("LFM3 could not load the model; check its installation and available memory".into()); }
            Ok(value)
        });
        match loaded {
            Ok(value) => {
                slot.as_mut().unwrap().backend = value["backend"].as_str().map(String::from)
            }
            Err(error) => {
                retire(&mut slot).await?;
                return Err(error);
            }
        }
    }
    let output = root.join(format!("{id}.wav"));
    let host = slot.as_mut().unwrap();
    let frame = format!(
        "{}\n",
        json!({"id":id,"text":text,"voice":voice,"language":language})
    );
    let sent = tokio::select! {
        _ = token.cancelled() => Err("LFM3 synthesis cancelled"),
        result = tokio::time::timeout(Duration::from_secs(5), host.input.write_all(frame.as_bytes())) => match result {
            Ok(Ok(())) => Ok(()),
            _ => Err("LFM3 runtime input closed or timed out"),
        }
    };
    if let Err(error) = sent {
        retire(&mut slot).await?;
        return Err(error.into());
    }
    let response = reply(host, token, 65).await;
    let result = match response {
        Ok(value) if value["id"] == id && value["ok"] == true => {
            read_wav(&output, value["backend"].as_str().unwrap_or("CPU")).await
        }
        Ok(_) => Err("LFM3 could not generate this segment; shorten the text or retry".into()),
        Err(error) => {
            retire(&mut slot).await?;
            Err(error)
        }
    };
    let _ = tokio::fs::remove_file(output).await;
    result
}

async fn read_wav(path: &std::path::Path, backend: &str) -> Result<Lfm3Result, String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "LFM3 audio file is missing")?;
    let mut bytes = Vec::new();
    file.take(MAX_WAV + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Could not read LFM3 audio")?;
    if bytes.len() < 46
        || (bytes.len() - 44) % 2 != 0
        || bytes.len() as u64 > MAX_WAV
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || bytes[20..24] != [1, 0, 1, 0]
        || u32::from_le_bytes(bytes[24..28].try_into().unwrap()) != 24000
        || bytes[34..36] != [16, 0]
        || u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize != bytes.len() - 44
    {
        return Err("LFM3 returned invalid audio".into());
    }
    Ok(Lfm3Result {
        duration_sec: (bytes.len() - 44) as f64 / 48_000.0,
        sample_rate: 24000,
        backend: backend.into(),
        audio_data: format!(
            "data:audio/wav;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    })
}

#[tauri::command]
pub async fn lfm3_tts_status(
    app: AppHandle,
    state: State<'_, Lfm3TtsState>,
) -> Result<Lfm3Status, String> {
    let mut status = Lfm3Status {
        available: false,
        loaded: false,
        model_id: None,
        backend: None,
        error: None,
    };
    if let Some(exe) = executable(&app) {
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            command(&app, &exe)
                .arg("--probe")
                .arg(runtime_dir(&app, &exe))
                .output(),
        )
        .await;
        status.available = result
            .ok()
            .and_then(Result::ok)
            .and_then(|out| serde_json::from_slice::<Value>(&out.stdout).ok())
            .is_some_and(|value| validate_handshake(&value).is_ok());
    }
    if !status.available {
        status.error =
            Some("LFM3 runtime is not included or compatible with this app build".into());
    }
    if let Ok(slot) = state.host.try_lock() {
        if let Some(host) = slot.as_ref().filter(|h| !h.stopping) {
            status.loaded = true;
            status.model_id = Some(host.model_id.clone());
            status.backend = host.backend.clone();
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn lfm3_tts_synthesize(
    app: AppHandle,
    state: State<'_, Lfm3TtsState>,
    request_id: String,
    model_id: String,
    text: String,
    voice: String,
    language: String,
) -> Result<Lfm3Result, String> {
    if request_id.is_empty()
        || request_id.len() > 64
        || model_id.len() > 256
        || text.len() > 2800
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || text.is_empty()
        || text.chars().count() > 700
        || text.contains("<|")
        || !["female", "male"].contains(&voice.as_str())
        || !LANGUAGES.contains(&language.as_str())
    {
        return Err("Invalid LFM3 text, voice or language".into());
    }
    let token = CancellationToken::new();
    {
        let mut requests = state.requests.lock().unwrap_or_else(|p| p.into_inner());
        if state
            .cancelled_ids
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&request_id)
            .is_some()
        {
            return Err("LFM3 synthesis cancelled".into());
        }
        if requests.len() >= 8 || requests.contains_key(&request_id) {
            return Err("LFM3 is busy; retry shortly".into());
        }
        requests.insert(request_id.clone(), (model_id.clone(), token.clone()));
    }
    let result = synthesize(
        &app,
        &state,
        &request_id,
        &model_id,
        &text,
        &voice,
        &language,
        &token,
    )
    .await;
    state
        .requests
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&request_id);
    result
}

#[tauri::command]
pub async fn lfm3_tts_cancel(
    state: State<'_, Lfm3TtsState>,
    request_id: String,
) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid LFM3 request id".into());
    }
    let requests = state.requests.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((_, token)) = requests.get(&request_id) {
        token.cancel();
    } else {
        let mut cancelled = state
            .cancelled_ids
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(120));
        if cancelled.len() >= 64 {
            if let Some(oldest) = cancelled
                .iter()
                .min_by_key(|(_, at)| **at)
                .map(|(id, _)| id.clone())
            {
                cancelled.remove(&oldest);
            }
        }
        cancelled.insert(request_id, std::time::Instant::now());
    }
    Ok(())
}

#[tauri::command]
pub async fn lfm3_tts_unload(state: State<'_, Lfm3TtsState>) -> Result<(), String> {
    state.shutdown().await
}

impl Lfm3TtsState {
    pub async fn shutdown(&self) -> Result<(), String> {
        for (_, token) in self
            .requests
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
        {
            token.cancel();
        }
        retire(&mut *self.host.lock().await).await
    }

    pub async fn prepare_uninstall(
        &self,
        model_id: &str,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<Host>>, String> {
        let mut slot = self
            .host
            .try_lock()
            .map_err(|_| "LFM3 is busy; stop speech before removing the model".to_string())?;
        if self
            .requests
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
            .any(|(id, _)| id == model_id)
        {
            return Err("LFM3 model is in use; stop speech before removing it".into());
        }
        if slot.as_ref().is_some_and(|host| host.model_id == model_id) {
            retire(&mut slot).await?;
        }
        // Keep inference excluded until the manager has removed files and registry metadata.
        Ok(slot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handshake_requires_version_commit_and_a_runnable_backend() {
        let mut value = json!({"protocol":1,"runtimeCommit":RUNTIME_COMMIT,"backends":[{"name":"CPU","gpu":false}]});
        assert!(validate_handshake(&value).is_ok());
        value["runtimeCommit"] = json!("other");
        assert!(validate_handshake(&value).is_err());
        value["runtimeCommit"] = json!(RUNTIME_COMMIT);
        value["backends"] = json!([]);
        assert!(validate_handshake(&value).is_err());
    }
    #[tokio::test]
    async fn response_frames_are_bounded() {
        let (mut writer, mut reader) = tokio::io::duplex(70_000);
        writer.write_all(&vec![b'x'; 65_537]).await.unwrap();
        assert!(read_message(&mut reader)
            .await
            .unwrap_err()
            .contains("protocol limit"));
    }
    #[tokio::test]
    async fn wav_result_checks_real_header_and_sample_count() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.wav");
        let wave = super::super::wav::encode_wav_mono_i16(&[0.1; 240], 24000);
        tokio::fs::write(&path, &wave).await.unwrap();
        let result = read_wav(&path, "CPU").await.unwrap();
        assert_eq!(result.sample_rate, 24000);
        assert!((result.duration_sec - 0.01).abs() < 0.00001);
        tokio::fs::write(&path, &wave[..wave.len() - 1])
            .await
            .unwrap();
        assert!(read_wav(&path, "CPU").await.is_err());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn retiring_host_kills_and_reaps_before_slot_is_reused() {
        let mut child = Command::new("sh")
            .args(["-c", "exec sleep 60"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut slot = Some(Host {
            child,
            input,
            output,
            model_id: "fixture".into(),
            backend: None,
            stopping: false,
        });
        retire(&mut slot).await.unwrap();
        assert!(slot.is_none());
    }
}
