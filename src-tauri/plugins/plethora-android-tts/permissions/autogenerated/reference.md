## Default Permission

Allows the android-tts plugin's on-device TTS commands to be invoked from the
frontend. On Android these drive native sherpa-onnx synthesis, AudioTrack
playback, model downloads, and System-TTS fallback; on desktop every command
returns an Android-only error and Pocket TTS is used instead.

#### This default permission set includes the following:

- `allow-initialize`
- `allow-download-model`
- `allow-cancel-download`
- `allow-list-models`
- `allow-list-voices`
- `allow-speak`
- `allow-pause`
- `allow-resume`
- `allow-stop`
- `allow-delete-model`
- `allow-start-media-session`
- `allow-stop-media-session`
- `allow-update-media-metadata`
- `allow-ack-media-commands`
- `allow-discard-media-commands`
- `allow-drain-pending-media-commands`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`plethora-android-tts:allow-ack-media-commands`

</td>
<td>

Enables the ack_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-ack-media-commands`

</td>
<td>

Denies the ack_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-cancel-download`

</td>
<td>

Enables the cancel_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-cancel-download`

</td>
<td>

Denies the cancel_download command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-delete-model`

</td>
<td>

Enables the delete_model command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-delete-model`

</td>
<td>

Denies the delete_model command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-discard-media-commands`

</td>
<td>

Enables the discard_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-discard-media-commands`

</td>
<td>

Denies the discard_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-download-model`

</td>
<td>

Enables the download_model command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-download-model`

</td>
<td>

Denies the download_model command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-drain-pending-media-commands`

</td>
<td>

Enables the drain_pending_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-drain-pending-media-commands`

</td>
<td>

Denies the drain_pending_media_commands command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-initialize`

</td>
<td>

Enables the initialize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-initialize`

</td>
<td>

Denies the initialize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-list-models`

</td>
<td>

Enables the list_models command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-list-models`

</td>
<td>

Denies the list_models command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-list-voices`

</td>
<td>

Enables the list_voices command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-list-voices`

</td>
<td>

Denies the list_voices command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-pause`

</td>
<td>

Enables the pause command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-pause`

</td>
<td>

Denies the pause command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-resume`

</td>
<td>

Enables the resume command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-resume`

</td>
<td>

Denies the resume command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-speak`

</td>
<td>

Enables the speak command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-speak`

</td>
<td>

Denies the speak command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-start-media-session`

</td>
<td>

Enables the start_media_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-start-media-session`

</td>
<td>

Denies the start_media_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-stop`

</td>
<td>

Enables the stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-stop`

</td>
<td>

Denies the stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-stop-media-session`

</td>
<td>

Enables the stop_media_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-stop-media-session`

</td>
<td>

Denies the stop_media_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:allow-update-media-metadata`

</td>
<td>

Enables the update_media_metadata command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`plethora-android-tts:deny-update-media-metadata`

</td>
<td>

Denies the update_media_metadata command without any pre-configured scope.

</td>
</tr>
</table>
