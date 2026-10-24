use crate::database::Repository;
use crate::services::audio_playback::{
    self, AudioCheckpoint, AudioSourceKey, CheckpointDisposition, SavedAudioSession,
    SavedAudioSessionRecord,
};
use tauri::State;

#[tauri::command]
pub async fn claim_audio_owner(
    profile_key: String,
    owner_epoch: String,
    previous_owner_epoch: Option<String>,
    repo: State<'_, Repository>,
) -> Result<bool, String> {
    audio_playback::claim_owner(
        repo.pool(),
        &profile_key,
        &owner_epoch,
        previous_owner_epoch.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn commit_audio_checkpoint(
    checkpoint: AudioCheckpoint,
    repo: State<'_, Repository>,
) -> Result<CheckpointDisposition, String> {
    audio_playback::commit_checkpoint(repo.pool(), &checkpoint)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_audio_checkpoint(
    source_key: AudioSourceKey,
    repo: State<'_, Repository>,
) -> Result<Option<AudioCheckpoint>, String> {
    audio_playback::get_checkpoint(repo.pool(), &source_key)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_audio_session(
    profile_key: String,
    repo: State<'_, Repository>,
) -> Result<Option<SavedAudioSessionRecord>, String> {
    audio_playback::get_session(repo.pool(), &profile_key)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_audio_session(
    profile_key: String,
    owner_epoch: String,
    session: SavedAudioSession,
    repo: State<'_, Repository>,
) -> Result<bool, String> {
    audio_playback::save_session(repo.pool(), &profile_key, &owner_epoch, &session)
        .await
        .map_err(|error| error.to_string())
}

/// Native is authoritative. Import progress before acknowledging any dirty service cursor.
#[tauri::command]
pub async fn reconcile_native_audio_journal(
    profile_key: String,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Audio reconciliation belongs to the main window".into());
    }
    let app = app_handle.clone();
    let profile = profile_key.clone();
    let initial = tauri::async_runtime::spawn_blocking(move || {
        plethora_android_tts::read_native_audio_journal(&app, &profile)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    let journal = initial
        .get("journal")
        .ok_or("Native audio journal unavailable")?;
    let authority = match journal.get("authority").filter(|value| !value.is_null()) {
        Some(authority) => authority,
        None => return Ok(initial),
    };
    let epoch = authority
        .get("ownerEpoch")
        .and_then(serde_json::Value::as_str)
        .ok_or("Invalid native audio epoch")?;
    let sequence = authority
        .get("ownerSequence")
        .and_then(serde_json::Value::as_i64)
        .ok_or("Invalid native audio handover")?;
    if !audio_playback::claim_native_owner(repo.pool(), &profile_key, epoch, sequence)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("Native audio authority changed during reconciliation".into());
    }
    let checkpoints = journal
        .get("checkpoints")
        .and_then(serde_json::Value::as_array)
        .ok_or("Invalid native checkpoints")?;
    if checkpoints.len() > 128 {
        return Err("Native checkpoint capacity exceeded".into());
    }
    let mut acknowledgements = Vec::new();
    let mut imported = Vec::new();
    for value in checkpoints {
        let checkpoint: AudioCheckpoint =
            serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        if checkpoint.source_key.profile_key != profile_key {
            return Err("Native audio profile mismatch".into());
        }
        let disposition = audio_playback::import_native_checkpoint(repo.pool(), &checkpoint, epoch)
            .await
            .map_err(|error| error.to_string())?;
        if disposition == CheckpointDisposition::Stale {
            return Err("Native audio authority changed during import".into());
        }
        acknowledgements.push(serde_json::json!({ "sourceKey": checkpoint.source_key, "ownerEpoch": checkpoint.owner_epoch, "checkpointSequence": checkpoint.checkpoint_sequence }));
        imported.push(checkpoint);
    }
    if let Some(value) = journal.get("session").filter(|value| !value.is_null()) {
        let session: SavedAudioSession =
            serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        if !audio_playback::save_session(repo.pool(), &profile_key, epoch, &session)
            .await
            .map_err(|error| error.to_string())?
        {
            return Err("Native audio session changed during import".into());
        }
    }
    if !acknowledgements.is_empty() {
        let app = app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            plethora_android_tts::acknowledge_native_audio_checkpoint(
                &app,
                serde_json::json!({ "schemaVersion": 1, "acknowledgements": acknowledgements }),
            )
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    }
    let mut current = tauri::async_runtime::spawn_blocking(move || {
        plethora_android_tts::read_native_audio_journal(&app_handle, &profile_key)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    current["importedCheckpoints"] =
        serde_json::to_value(imported).map_err(|error| error.to_string())?;
    Ok(current)
}
