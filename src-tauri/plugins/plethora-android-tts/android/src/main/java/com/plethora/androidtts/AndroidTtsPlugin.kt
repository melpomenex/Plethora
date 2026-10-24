// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Android Tauri plugin for on-device TTS via sherpa-onnx.
//
// Owns the complete native pipeline:
//   - the nine @Command handlers the frontend invokes (initialize, downloadModel,
//     cancelDownload, listModels, listVoices, speak, pause, resume, stop,
//     deleteModel),
//   - AudioTrack streaming playback (callback PCM -> WRITE_BLOCKING),
//   - audio focus + interruption handling,
//   - lifecycle cleanup (onStop/onDestroy/onLowMemory),
//   - single-engine ownership (sherpa and the System-TTS fallback, or two speak
//     calls, never speak at once),
//   - sentence chunking with prefetching,
//   - System-TTS fallback when no model is installed or inference fails,
//   - small JSON event emission to the webview (no PCM crosses IPC).
//
// All inference and download I/O run off the main thread. The IPC handlers
// return immediately and dispatch to background executors; playback-state and
// sentence-position events drive the UI.

package com.plethora.androidtts

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject

// ──────────────────────────────────────────────────────────────────────────
// Invoke argument DTOs. Field names are camelCase to match the JS payloads the
// Rust shim forwards via run_mobile_plugin.
// ──────────────────────────────────────────────────────────────────────────

@InvokeArg
class DownloadModelArgs {
    var modelId: String? = null
}

@InvokeArg
class NativeAudioRpcArgs {
    var payload: String? = null
}

@InvokeArg
class UpdateMediaMetadataArgs {
    var sourceId: String? = null
    var sessionId: String? = null
    var sourceKind: String? = null
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var artworkUrl: String? = null
    var sectionId: String? = null
    var sectionTitle: String? = null
    var sectionIndex: Int? = null
    var sectionAnchor: String? = null
    var positionSec: Double? = null
    var durationSec: Double? = null
    var playbackRate: Double? = null
    var state: String? = null
    var isPlaying: Boolean? = null
    var canSeekRelative: Boolean? = null
    var canSeekAbsolute: Boolean? = null
    var canNext: Boolean? = null
    var canPrevious: Boolean? = null
    var precisePosition: Boolean? = null
    var updatedAt: Long? = null
}

@InvokeArg
class AckMediaCommandsArgs {
    var eventIds: List<String>? = null
}

@InvokeArg
class DiscardMediaCommandsArgs {
    var eventIds: List<String>? = null
    var reason: String? = null
}

@InvokeArg
class CancelDownloadArgs {
    var modelId: String? = null
}

@InvokeArg
class ListVoicesArgs {
    var modelId: String? = null
}

@InvokeArg
class SpeakArgs {
    var sentences: Array<String>? = null
    var modelId: String? = null
    var voiceId: String? = null
    var speed: Float? = null
}

@InvokeArg
class DeleteModelArgs {
    var modelId: String? = null
}

/**
 * Playback state reported via the `tts://playback-state` event.
 */
enum class PlaybackState(val serial: String) {
    IDLE("idle"),
    LOADING("loading"),
    PLAYING("playing"),
    PAUSED("paused"),
    STOPPED("stopped"),
    ERROR("error");

    companion object {
        fun from(s: String): PlaybackState = entries.firstOrNull { it.serial == s } ?: IDLE
    }
}

@TauriPlugin
class AndroidTtsPlugin(private val activity: Activity) : Plugin(activity) {

    private val ctx: Context get() = activity.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private val assets = TtsAssetManager(ctx)
    private val engine = SherpaTtsEngine(ctx)
    private val systemFallback = SystemTtsFallback(ctx)

    /** Single background thread for all inference + playback work. */
    private val ttsThread = HandlerThread("plethora-tts").apply { start() }
    private val ttsHandler = Handler(ttsThread.looper)
    /** Separate thread for downloads so a download never blocks speak. */
    private val downloadExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "plethora-tts-download").apply { isDaemon = true }
    }

    private val audioManager: AudioManager =
        ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /** Active AudioTrack, or null when idle. Owned by ttsThread. */
    @Volatile private var audioTrack: AudioTrack? = null
    /** The active model id, for listModels/voice selection. */
    @Volatile private var activeModelId: String? = null
    /** The active voice id (speaker index as string). */
    @Volatile private var activeVoiceId: String = "0"
    /** Current playback speed. */
    @Volatile private var speed: Float = 1.0f

    /** True while a speak/queue is actively producing audio. Guards single-engine ownership. */
    private val speaking = AtomicBoolean(false)
    /** True while playback is paused. */
    private val paused = AtomicBoolean(false)
    /** Stop flag checked by the generation loop. */
    private val stopFlag = AtomicBoolean(false)
    /** Monotonic utterance counter for sentence-position + completion correlation. */
    private val utteranceSeq = AtomicInteger(0)
    private val speechRequest = AtomicInteger(0)
    private val speechFocusPolicy = MediaFocusStateMachine()

    /** Audio focus request (API 26+), held while playing. */
    private var focusRequest: AudioFocusRequest? = null

    /** WebView reference for emitting global events to the frontend. */
    @Volatile private var webView: android.webkit.WebView? = null

    // ──────────────────────────────────────────────────────────────────
    // Lifecycle: release resources on background/destroy/memory pressure.
    // Uses the Tauri Plugin base-class hooks (load/onPause/onStop/onDestroy)
    // rather than ProcessLifecycleOwner, so no extra lifecycle dependency is
    // needed.
    // ──────────────────────────────────────────────────────────────────

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        this.webView = webView
        // The Media3 session service emits normalized media-button envelopes
        // to this WebView; register it on the shared bridge.
        MediaBridge.ensureQueue(ctx)
        MediaBridge.webView = java.lang.ref.WeakReference(webView)
    }

    override fun onPause() {
        super.onPause()
        if (MediaBridge.webView?.get() === webView) RemoteMediaSessionService.currentNativeOwner()?.setObserving(false)
    }

    override fun onStop() {
        super.onStop()
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        super.onDestroy(activity)
        ttsHandler.post {
            stopInternal(sendState = false)
            engine.unload()
            systemFallback.shutdown()
        }
    }

    /** Called by the host activity on memory pressure (wired from onLowMemory). */
    fun onLowMemory() {
        ttsHandler.post {
            stopInternal(sendState = true)
            engine.unload()
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Commands
    // ──────────────────────────────────────────────────────────────────

    @Command
    fun initialize(invoke: Invoke) {
        val installed = TtsModelRegistry.ALL.filter { assets.isInstalled(it) }.map { it.id }
        if (activeModelId == null) {
            activeModelId = installed.firstOrNull() ?: TtsModelRegistry.fallbackDefault.id
        }
        val res = JSObject()
        res.put("available", true)
        res.put("activeModelId", activeModelId)
        res.put("installedModelIds", JSONArray(installed))
        invoke.resolve(res)
    }

    @Command
    fun downloadModel(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadModelArgs::class.java)
        val modelId = args.modelId ?: return invoke.reject("modelId is required")
        val manifest = TtsModelRegistry.byId(modelId)
            ?: return invoke.reject("Unknown model: $modelId")

        downloadExecutor.execute {
            emitDownloadState(modelId, installing = true)
            val outcome = assets.download(manifest) { id, bytes, total ->
                emitDownloadProgress(id, bytes, total)
            }
            emitDownloadState(modelId, installing = false)
            when (outcome) {
                DownloadOutcome.Success -> {
                    // Auto-select the freshly installed model if nothing active.
                    if (activeModelId == null || activeModelId == TtsModelRegistry.fallbackDefault.id) {
                        activeModelId = modelId
                    }
                    invoke.resolve()
                }
                is DownloadOutcome.Failure -> {
                    if (outcome.kind == "cancelled") invoke.reject("cancelled")
                    else invoke.reject("download:${outcome.kind}:${outcome.message}")
                }
            }
        }
    }

    @Command
    fun cancelDownload(invoke: Invoke) {
        val args = invoke.parseArgs(CancelDownloadArgs::class.java)
        val modelId = args.modelId ?: return invoke.reject("modelId is required")
        assets.requestCancel(modelId)
        invoke.resolve()
    }

    @Command
    fun listModels(invoke: Invoke) {
        val arr = JSArray()
        for (m in TtsModelRegistry.ALL) {
            val o = JSObject()
            o.put("id", m.id)
            o.put("name", m.displayName)
            o.put("kind", m.kind.serial)
            o.put("installed", assets.isInstalled(m))
            o.put("installing", assets.isInstalling(m.id))
            o.put("bytesOnDisk", assets.bytesOnDisk(m.id))
            o.put("downloadBytes", m.files.sumOf { it.sizeBytes })
            o.put("description", m.description)
            o.put("default", m.isDefault)
            arr.put(o)
        }
        val out = JSObject()
        out.put("models", arr)
        invoke.resolve(out)
    }

    @Command
    fun listVoices(invoke: Invoke) {
        val args = invoke.parseArgs(ListVoicesArgs::class.java)
        val modelId = args.modelId ?: return invoke.reject("modelId is required")
        val manifest = TtsModelRegistry.byId(modelId)
            ?: return invoke.reject("Unknown model: $modelId")

        // Prefer the engine's runtime count if loaded; fall back to the manifest.
        val voices = manifest.voices
        val arr = JSArray()
        for (v in voices) {
            val o = JSObject()
            o.put("id", v.id)
            o.put("name", v.name)
            o.put("modelId", modelId)
            o.put("language", v.language ?: JSONObject.NULL)
            o.put("gender", v.gender ?: JSONObject.NULL)
            arr.put(o)
        }
        val out = JSObject()
        out.put("voices", arr)
        invoke.resolve(out)
    }

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        val sentencesRaw = args.sentences ?: return invoke.reject("sentences is required")
        val sentences = sentencesRaw.filter { it.isNotBlank() }
        if (sentences.isEmpty()) return invoke.reject("sentences is empty")

        val modelId = args.modelId ?: activeModelId ?: TtsModelRegistry.fallbackDefault.id
        val manifest = TtsModelRegistry.byId(modelId) ?: TtsModelRegistry.fallbackDefault
        val voiceId = (args.voiceId ?: activeVoiceId).let { it.ifBlank { "0" } }
        val rate = args.speed ?: speed

        // Single-engine ownership: cancel any in-flight speak first.
        val request = speechRequest.incrementAndGet()
        interruptSpeechOutput()
        ttsHandler.post {
            if (speechRequest.get() != request) return@post
            stopInternal(sendState = false)
            startUtterance(sentences, manifest, voiceId, rate, request)
        }
        // Resolve immediately; playback drives the UI via events.
        invoke.resolve()
    }

    @Command
    fun pause(invoke: Invoke) {
        speechFocusPolicy.onUserPlayback(false)
        if (MediaBridge.nativeClientId != null) {
            paused.set(true)
            audioTrack?.pause()
            if (audioTrack == null) { interruptSpeechOutput(); emitPlaybackState(PlaybackState.STOPPED) }
            else emitPlaybackState(PlaybackState.PAUSED)
            invoke.resolve()
        } else ttsHandler.post {
            paused.set(true)
            audioTrack?.pause()
            emitPlaybackState(PlaybackState.PAUSED)
        }
        if (MediaBridge.nativeClientId == null) invoke.resolve()
    }

    @Command
    fun resume(invoke: Invoke) {
        speechFocusPolicy.onUserPlayback(true)
        if (MediaBridge.nativeClientId != null) {
            if (audioTrack != null && paused.get()) { paused.set(false); audioTrack?.play(); emitPlaybackState(PlaybackState.PLAYING) }
            invoke.resolve()
            return
        }
        ttsHandler.post {
            val track = audioTrack
            if (track != null && paused.get()) {
                paused.set(false)
                // AudioTrack.play() resumes from the paused position.
                track.play()
                emitPlaybackState(PlaybackState.PLAYING)
            }
        }
        invoke.resolve()
    }

    @Command
    fun stop(invoke: Invoke) {
        speechFocusPolicy.onUserPlayback(false)
        speechRequest.incrementAndGet()
        interruptSpeechOutput()
        ttsHandler.post {
            try { stopInternal(sendState = true); invoke.resolve() }
            catch (error: Throwable) { invoke.reject(error.message ?: "Native speech did not stop") }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Remote media session commands (tasks 6.1 + 10.1): the frontend player
    // starts/stops the Media3 session with its own playback and feeds it
    // position/metadata so media-button envelopes can carry a position hint.
    // ──────────────────────────────────────────────────────────────────

    companion object {
        private const val REQUEST_POST_NOTIFICATIONS = 8_421
        /** Release-visible log tag (app.tauri.Logger is DEBUG-gated and silent in release builds). */
        const val MEDIA_LOG_TAG = "PlethoraMedia"
    }

    /**
     * Android 13+ (API 33) requires a runtime grant before ANY notification is
     * shown — including the MediaStyle media notification that carries
     * lock-screen/notification media controls. Without it the foreground
     * service runs fine but the controls never appear. Requests once per
     * process, at first playback-session start (not app launch). No-op below
     * API 33 where notifications are granted at install.
     */
    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            ctx,
            android.Manifest.permission.POST_NOTIFICATIONS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) return
        Log.i(MEDIA_LOG_TAG, "requesting POST_NOTIFICATIONS for media controls")
        try {
            androidx.core.app.ActivityCompat.requestPermissions(
                activity,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_POST_NOTIFICATIONS,
            )
        } catch (e: Throwable) {
            Log.w(MEDIA_LOG_TAG, "POST_NOTIFICATIONS request failed: ${e.message}")
        }
    }

    @Command
    fun startMediaSession(invoke: Invoke) {
        // Media3 MediaSessionService notifications are exempt from POST_NOTIFICATIONS
        // runtime denial on Android 13+; request opportunistically for non-exempt
        // notifications without failing playback if denied.
        ensureNotificationPermission()
        MediaBridge.ensureQueue(ctx)
        Log.i(MEDIA_LOG_TAG, "starting RemoteMediaSessionService")
        if (!RemoteMediaSessionService.start(ctx)) {
            invoke.reject("Media service could not start. Open Plethora and try Play again.")
            return
        }
        invoke.resolve()
    }

    @Command
    fun getAudioSnapshot(invoke: Invoke) {
        Handler(Looper.getMainLooper()).post {
            try {
                val args = invoke.parseArgs(NativeAudioRpcArgs::class.java)
                val payload = JSONObject(args.payload ?: "{}")
                require(payload.getInt("schemaVersion") == 1)
                val profile = payload.getString("profileKey")
                require(profile.isNotBlank())
                val owner = RemoteMediaSessionService.currentNativeOwner()
                val active = owner?.snapshot()
                val snapshot = active?.takeIf { it.getJSONObject("sourceKey").getString("profileKey") == profile }
                if (payload.optBoolean("observing", false)) {
                    check(MediaBridge.webView?.get() === webView) { "Audio observer was replaced" }
                    check(!RemoteMediaSessionService.nativeStopPending) { "Audio service is stopping" }
                    check(active == null || snapshot != null) { "Stop the previous profile before attaching audio" }
                    val client = payload.getString("clientId")
                    require(client.isNotBlank())
                    if (MediaBridge.nativeClientId != client) MediaBridge.nativeGenerationFloor = active?.getLong("generation") ?: 0L
                    MediaBridge.nativeClientId = client
                    MediaBridge.nativeClientProfile = profile
                }
                if (snapshot != null && payload.has("observing") && payload.optString("clientId") == MediaBridge.nativeClientId) owner.setObserving(payload.getBoolean("observing"))
                val journal = owner?.dirtyJournal(profile) ?: AudioPlaybackJournal(ctx).snapshot(profile)
                invoke.resolve(JSObject(JSONObject().put("schemaVersion", 1).put("activeProfileKey", active?.getJSONObject("sourceKey")?.getString("profileKey") ?: JSONObject.NULL).put("generationFloor", MediaBridge.nativeGenerationFloor).put("item", if (snapshot != null) owner.describe() else JSONObject.NULL).put("snapshot", snapshot ?: JSONObject.NULL).put("journal", journal).toString()))
            } catch (error: Throwable) { invoke.reject(error.message ?: "Native audio snapshot unavailable") }
        }
    }

    private fun currentAudioClient(payload: JSONObject): Boolean =
        MediaBridge.webView?.get() === webView && payload.optString("clientId") == MediaBridge.nativeClientId && payload.optString("profileKey") == MediaBridge.nativeClientProfile

    @Command
    fun loadAudio(invoke: Invoke) {
        val handler = Handler(Looper.getMainLooper())
        handler.post {
            try {
                val payload = JSONObject(invoke.parseArgs(NativeAudioRpcArgs::class.java).payload ?: "{}")
                require(payload.getInt("schemaVersion") == 1)
                check(currentAudioClient(payload)) { "Audio client is no longer active" }
                val generation = payload.getLong("generation")
                if (generation < MediaBridge.nativeGenerationFloor) { invoke.resolve(JSObject().put("disposition", "stale")); return@post }
                MediaBridge.nativeGenerationFloor = generation
                val manifest = payload.getJSONObject("manifest")
                require(manifest.getJSONObject("sourceKey").getString("profileKey") == payload.getString("profileKey"))
                val deadline = android.os.SystemClock.elapsedRealtime() + 5000
                var started = false
                val pending = object : Runnable {
                    override fun run() {
                        try {
                            if (!currentAudioClient(payload) || generation != MediaBridge.nativeGenerationFloor) { invoke.resolve(JSObject().put("disposition", "stale")); return }
                            if (android.os.SystemClock.elapsedRealtime() >= deadline) { invoke.reject("Media service could not start. Open Plethora and try Play again."); return }
                            if (RemoteMediaSessionService.nativeStopPending) { handler.postDelayed(this, 50); return }
                            val service = RemoteMediaSessionService.currentService()
                            if (service == null) {
                                if (!started) {
                                    started = true
                                    ensureNotificationPermission()
                                    RemoteMediaSessionService.nativeStartupRequested = true
                                    MediaBridge.title = manifest.getString("title")
                                    if (!RemoteMediaSessionService.start(ctx)) {
                                        RemoteMediaSessionService.nativeStartupRequested = false
                                        invoke.reject("Media service could not start. Open Plethora and try Play again.")
                                        return
                                    }
                                }
                                handler.postDelayed(this, 50)
                                return
                            }
                            val owner = service.nativePlaybackOwner()
                            owner.setObserving(true)
                            val before = owner.snapshot()
                            if (before != null && generation <= before.getLong("generation")) { invoke.resolve(JSObject().put("disposition", "stale").put("snapshot", before)); return }
                            val resume = manifest.optJSONObject("resume")
                            owner.loadAuthorized(manifest, "paused", resume?.optInt("partIndex", 0) ?: 0, resume?.optDouble("timeInPart", 0.0) ?: 0.0, generation)
                            var result = JSONObject().put("disposition", "accepted").put("snapshot", owner.snapshot())
                            if (!payload.isNull("explicitPosition")) {
                                val snapshot = owner.snapshot()!!
                                result = owner.command(JSONObject().put("schemaVersion", 1).put("requestId", UUID.randomUUID().toString()).put("sessionId", snapshot.getJSONObject("metadata").getString("sessionId")).put("generation", snapshot.getLong("generation")).put("action", JSONObject().put("command", "seekTo").put("value", payload.getDouble("explicitPosition"))))
                            }
                            if (result.getString("disposition") == "accepted" && payload.getString("intent") == "play") result = owner.transport("Play")
                            invoke.resolve(JSObject(result.toString()))
                        } catch (error: Throwable) { invoke.reject(error.message ?: "Native audio load failed") }
                    }
                }
                pending.run()
            } catch (error: Throwable) { invoke.reject(error.message ?: "Native audio load failed") }
        }
    }

    @Command
    fun audioCommand(invoke: Invoke) {
        val handler = Handler(Looper.getMainLooper())
        handler.post {
            try {
                val payload = JSONObject(invoke.parseArgs(NativeAudioRpcArgs::class.java).payload ?: "{}")
                require(payload.getInt("schemaVersion") == 1)
                check(currentAudioClient(payload)) { "Audio client is no longer active" }
                val owner = RemoteMediaSessionService.currentNativeOwner()
                if (!payload.isNull("takeoverGeneration")) {
                    val generation = payload.getLong("takeoverGeneration")
                    if (generation < MediaBridge.nativeGenerationFloor) { invoke.resolve(JSObject().put("disposition", "stale")); return@post }
                    MediaBridge.nativeGenerationFloor = generation
                    owner?.pause("source-switch")
                }
                val request = payload.optJSONObject("request")
                if (request == null) { invoke.resolve(JSObject().put("disposition", "accepted").put("snapshot", owner?.snapshot() ?: JSONObject.NULL)); return@post }
                if (owner == null || owner.snapshot()?.getJSONObject("sourceKey")?.getString("profileKey") != payload.getString("profileKey")) {
                    val duplicate = AudioPlaybackJournal(ctx).hasReceipt(payload.getString("profileKey"), request.getString("requestId"))
                    invoke.resolve(JSObject().put("disposition", if (duplicate) "duplicate" else "stale").put("snapshot", JSONObject.NULL))
                    return@post
                }
                val result = owner.command(request)
                if (request.getJSONObject("action").getString("command") == "stop" && result.getString("disposition") == "accepted") {
                    RemoteMediaSessionService.nativeStopPending = true
                    MediaBridge.nativeGenerationFloor = maxOf(MediaBridge.nativeGenerationFloor, request.getLong("generation") + 1)
                    ctx.stopService(android.content.Intent(ctx, RemoteMediaSessionService::class.java))
                    val deadline = android.os.SystemClock.elapsedRealtime() + 2000
                    val wait = object : Runnable {
                        override fun run() {
                            if (RemoteMediaSessionService.currentNativeOwner() == null) { invoke.resolve(JSObject(result.toString())); return }
                            if (android.os.SystemClock.elapsedRealtime() >= deadline) { invoke.reject("Audio service did not stop"); return }
                            handler.postDelayed(this, 25)
                        }
                    }
                    wait.run()
                } else invoke.resolve(JSObject(result.toString()))
            } catch (error: Throwable) { invoke.reject(error.message ?: "Native audio command failed") }
        }
    }

    @Command
    fun reconcileAudioCheckpoint(invoke: Invoke) {
        Handler(Looper.getMainLooper()).post {
            try {
                val args = invoke.parseArgs(NativeAudioRpcArgs::class.java)
                val payload = JSONObject(args.payload ?: "{}")
                require(payload.getInt("schemaVersion") == 1)
                if (payload.has("acknowledgedCaptures")) {
                    val profile = payload.getString("profileKey")
                    require(profile.isNotBlank())
                    val ids = payload.getJSONArray("acknowledgedCaptures")
                    require(ids.length() <= 256)
                    val journal = AudioPlaybackJournal(ctx)
                    var count = 0
                    for (index in 0 until ids.length()) if (journal.acknowledgeCapture(profile, ids.getString(index))) count += 1
                    invoke.resolve(JSObject().put("acknowledgedCaptureCount", count))
                    return@post
                }
                if (payload.has("acknowledgements")) {
                    val cursors = payload.getJSONArray("acknowledgements")
                    val count = RemoteMediaSessionService.currentNativeOwner()?.acknowledgeBatch(cursors)
                        ?: AudioPlaybackJournal(ctx).acknowledgeBatch(cursors)
                    invoke.resolve(JSObject().put("acknowledgedCount", count))
                    return@post
                }
                val source = payload.getJSONObject("sourceKey")
                val epoch = payload.getString("ownerEpoch")
                val sequence = payload.getLong("checkpointSequence")
                val owner = RemoteMediaSessionService.currentNativeOwner()
                val acknowledged = owner?.acknowledge(source, epoch, sequence)
                    ?: AudioPlaybackJournal(ctx).acknowledge(source, epoch, sequence)
                invoke.resolve(JSObject().put("acknowledged", acknowledged))
            } catch (error: Throwable) { invoke.reject(error.message ?: "Native audio journal acknowledgement failed") }
        }
    }

    @Command
    fun stopMediaSession(invoke: Invoke) {
        Log.i(MEDIA_LOG_TAG, "stopping RemoteMediaSessionService")
        RemoteMediaSessionService.stop(ctx)
        invoke.resolve()
    }

    @Command
    fun updateMediaMetadata(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateMediaMetadataArgs::class.java)
            val applied = MediaBridge.updateSnapshot(args)
            RemoteMediaSessionService.refresh()
            if (!applied) {
                Log.w(
                    MEDIA_LOG_TAG,
                    "metadata snapshot rejected (stale or invalid) " +
                        "source=${args.sourceId} session=${args.sessionId} state=${args.state}"
                )
            } else {
                Log.d(
                    MEDIA_LOG_TAG,
                    "snapshot applied source=${args.sourceId} " +
                        "state=${args.state} playing=${args.isPlaying} " +
                        "title=${args.title} artist=${args.artist} album=${args.album}"
                )
            }
        } catch (e: Throwable) {
            // Never swallow integration breaks silently: a dropped snapshot
            // leaves the OS surface idle/paused forever with no controls.
            Log.w(MEDIA_LOG_TAG, "update_media_metadata failed: ${e.message}")
        }
        invoke.resolve()
    }

    /** Acknowledge envelopes the frontend dispatcher accepted (Decision 8). */
    @Command
    fun ackMediaCommands(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AckMediaCommandsArgs::class.java)
            val ids = args.eventIds ?: emptyList()
            MediaBridge.ensureQueue(ctx).ack(ids)
        } catch (e: Throwable) {
            Logger.warn("ack_media_commands failed: ${e.message}")
        }
        invoke.resolve()
    }

    /** Drain unacked commands (oldest-first) for frontend reconcile on resume. */
    @Command
    fun drainPendingMediaCommands(invoke: Invoke) {
        try {
            val queue = MediaBridge.ensureQueue(ctx)
            val unacked = queue.drainUnacked()
            val res = JSObject()
            res.put("commands", queue.toJsonArray(unacked))
            invoke.resolve(res)
        } catch (e: Throwable) {
            Logger.warn("drain_pending_media_commands failed: ${e.message}")
            invoke.resolve(JSObject().put("commands", org.json.JSONArray()))
        }
    }

    /** Remove commands that cannot safely be replayed into the active source. */
    @Command
    fun discardMediaCommands(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DiscardMediaCommandsArgs::class.java)
            MediaBridge.ensureQueue(ctx).discard(args.eventIds ?: emptyList(), args.reason)
        } catch (e: Throwable) {
            Logger.warn("discard_media_commands failed: ${e.message}")
        }
        invoke.resolve()
    }

    @Command
    fun deleteModel(invoke: Invoke) {
        val args = invoke.parseArgs(DeleteModelArgs::class.java)
        val modelId = args.modelId ?: return invoke.reject("modelId is required")
        // If the active model is being deleted, stop playback first.
        if (activeModelId == modelId) {
            ttsHandler.post { stopInternal(sendState = true); engine.unload() }
        }
        assets.delete(modelId)
        // Repoint active model if needed.
        val stillInstalled = TtsModelRegistry.ALL.filter { assets.isInstalled(it) }.map { it.id }
        if (activeModelId == modelId) {
            activeModelId = stillInstalled.firstOrNull() ?: TtsModelRegistry.fallbackDefault.id
        }
        invoke.resolve()
    }

    // ──────────────────────────────────────────────────────────────────
    // Speak pipeline (runs on ttsThread)
    // ──────────────────────────────────────────────────────────────────

    private fun startUtterance(
        sentences: List<String>,
        manifest: TtsModelManifest,
        voiceId: String,
        rate: Float,
        requestEpoch: Int,
    ) {
        val utteranceId = utteranceSeq.incrementAndGet()
        speaking.set(true)
        speechFocusPolicy.onUserPlayback(true)
        paused.set(false)
        stopFlag.set(false)
        activeModelId = manifest.id
        activeVoiceId = voiceId
        speed = rate

        emitPlaybackState(PlaybackState.LOADING)

        // Acquire audio focus before producing any sound.
        if (!requestAudioFocus()) {
            emitError("audio_focus", "Could not acquire audio focus.")
            speaking.set(false)
            emitPlaybackState(PlaybackState.IDLE)
            return
        }

        val sid = voiceId.toIntOrNull() ?: 0

        // Decide engine path: sherpa if installed, else System-TTS fallback.
        val installed = assets.isInstalled(manifest)
        if (!installed) {
            runSystemFallback(sentences, utteranceId, requestEpoch)
            return
        }

        try {
            // Ensure the engine is loaded for this model (lazy load).
            if (engine.currentModelId != manifest.id) {
                engine.load(manifest, assets.modelDir(manifest.id))
            }
        } catch (e: Exception) {
            Logger.error("TTS engine load failed (${manifest.id}): ${e.message}")
            emitError("model_load", "Model failed to load: ${e.message}. Using system voice.")
            runSystemFallback(sentences, utteranceId, requestEpoch)
            return
        }

        // Sentence-by-sentence synthesis with prefetching: synthesize + play
        // sentence N, while the loop naturally overlaps because AudioTrack
        // blocks on write, letting the next sentence's generation interleave.
        val sampleRate = engine.sampleRate().takeIf { it > 0 } ?: 24000
        for ((index, sentence) in sentences.withIndex()) {
            if (stopFlag.get() || speechRequest.get() != requestEpoch) break
            // Emit sentence-position for highlighting just before playing.
            emitSentencePosition(utteranceId, index, sentence)
            emitPlaybackState(PlaybackState.PLAYING)

            val ok = try {
                engine.synthesize(sentence, sid, rate) { samples ->
                    if (stopFlag.get()) return@synthesize false
                    ensureAudioTrack(sampleRate)
                    val track = audioTrack
                    if (track == null || stopFlag.get()) return@synthesize false
                    if (paused.get()) blockUntilResumed()
                    if (stopFlag.get()) return@synthesize false
                    track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
                    !stopFlag.get()
                }
            } catch (e: Exception) {
                if (stopFlag.get() || speechRequest.get() != requestEpoch) return
                Logger.error("TTS inference failed: ${e.message}")
                emitError("inference", "On-device synthesis failed: ${e.message}. Falling back to system voice.")
                // Stop native playback before engaging fallback (single-engine).
                teardownPlayback(releaseFocus = false)
                runSystemFallback(sentences.drop(index), utteranceId, requestEpoch, index)
                return
            }
            if (!ok && stopFlag.get()) break
        }

        teardownPlayback(releaseFocus = true)
        speaking.set(false)
        if (speechRequest.get() == requestEpoch) {
            emitUtteranceComplete(utteranceId)
            emitPlaybackState(PlaybackState.IDLE)
        }
    }

    /** Route to the Android platform TextToSpeech engine. */
    private fun runSystemFallback(sentences: List<String>, utteranceId: Int, requestEpoch: Int, sentenceOffset: Int = 0) {
        if (speechRequest.get() != requestEpoch) return
        stopFlag.set(false)
        emitPlaybackState(PlaybackState.PLAYING)
        systemFallback.stop()
        // Track each sentence's start offset in the joined text so word
        // charIndex offsets (joined-text space) resolve to their sentence.
        val starts = WordPositionOffsets.sentenceStarts(sentences)
        val joined = WordPositionOffsets.joinSentences(sentences)
        val tag = "utt-$utteranceId-${UUID.randomUUID()}"
        systemFallback.speak(
            text = joined,
            rate = speed,
            utteranceId = tag,
            onWordPosition = { _, charIndex, charLength ->
                if (speechRequest.get() != requestEpoch || stopFlag.get()) return@speak
                val (sentenceIndex, within, length) = WordPositionOffsets
                    .resolve(sentences, starts, charIndex, charLength)
                emitWordPosition(utteranceId, sentenceIndex + sentenceOffset, within, length)
            },
            onDone = {
                mainHandler.post {
                    if (!stopFlag.get() && speechRequest.get() == requestEpoch) {
                        emitUtteranceComplete(utteranceId)
                        emitPlaybackState(PlaybackState.IDLE)
                        abandonAudioFocus()
                        speaking.set(false)
                    }
                }
            },
            onErrorFn = { msg ->
                mainHandler.post {
                    if (speechRequest.get() != requestEpoch || stopFlag.get()) return@post
                    emitError("system_tts", msg)
                    emitPlaybackState(PlaybackState.IDLE)
                    abandonAudioFocus()
                    speaking.set(false)
                }
            },
        )
    }

    // ──────────────────────────────────────────────────────────────────
    // AudioTrack + audio focus
    // ──────────────────────────────────────────────────────────────────

    /** Lazily create (or reuse) the AudioTrack for [sampleRate]. */
    private fun ensureAudioTrack(sampleRate: Int) {
        val existing = audioTrack
        if (existing != null) {
            try {
                if (existing.sampleRate == sampleRate && existing.playState != AudioTrack.PLAYSTATE_STOPPED) {
                    if (existing.playState != AudioTrack.PLAYSTATE_PLAYING) existing.play()
                    return
                }
                existing.stop(); existing.release()
            } catch (e: Throwable) {
                Logger.warn("AudioTrack reuse cleanup failed: ${e.message}")
            }
            audioTrack = null
        }
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
        ).coerceAtLeast(sampleRate * 2)
        val attr = AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .build()
        val fmt = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setSampleRate(sampleRate)
            .build()
        val track = AudioTrack(
            attr,
            fmt,
            minBuf,
            AudioTrack.MODE_STREAM,
            AudioManager.AUDIO_SESSION_ID_GENERATE,
        )
        track.play()
        audioTrack = track
    }

    /** Spin (sleeping briefly) while paused, until resumed or stopped. */
    private fun blockUntilResumed() {
        while (paused.get() && !stopFlag.get()) {
            try { Thread.sleep(50) } catch (_: InterruptedException) { break }
        }
    }

    @Volatile private var speechFocusDelegatedToService = false

    @Suppress("DEPRECATION")
    private fun requestAudioFocus(): Boolean {
        if (MediaBridge.nativeClientId != null || RemoteMediaSessionService.currentService() != null) {
            val granted = RemoteMediaSessionService.requestSpeechFocus(ctx, focusListener)
            speechFocusDelegatedToService = granted
            return granted
        }
        speechFocusDelegatedToService = false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attr = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attr)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = req
            audioManager.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            val res = audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            )
            res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    @Suppress("DEPRECATION")
    private fun abandonAudioFocus() {
        if (speechFocusDelegatedToService || MediaBridge.nativeClientId != null) {
            speechFocusDelegatedToService = false
            RemoteMediaSessionService.abandonSpeechFocus(focusListener)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            audioManager.abandonAudioFocus(focusListener)
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (MediaBridge.nativeClientId != null) {
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    if (speechFocusPolicy.onTransientLoss(speaking.get() && !paused.get()) == MediaFocusAction.PAUSE) {
                        paused.set(true)
                        audioTrack?.pause()
                        if (audioTrack == null) { speechFocusPolicy.onUserPlayback(false); interruptSpeechOutput(); emitPlaybackState(PlaybackState.STOPPED) }
                        else emitPlaybackState(PlaybackState.PAUSED)
                    }
                }
                AudioManager.AUDIOFOCUS_LOSS -> {
                    speechFocusPolicy.onPermanentLoss(speaking.get())
                    speechRequest.incrementAndGet()
                    interruptSpeechOutput()
                    ttsHandler.post { stopInternal(sendState = true) }
                }
                AudioManager.AUDIOFOCUS_GAIN -> if (speechFocusPolicy.onGain(speaking.get() && !paused.get()) == MediaFocusAction.RESTORE && speaking.get() && !stopFlag.get()) {
                    paused.set(false); audioTrack?.play(); emitPlaybackState(PlaybackState.PLAYING)
                }
            }
            return@OnAudioFocusChangeListener
        }
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Pause on transitory loss; the user can resume.
                ttsHandler.post {
                    paused.set(true)
                    audioTrack?.pause()
                    emitPlaybackState(PlaybackState.PAUSED)
                }
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                // Permanent loss: stop entirely.
                ttsHandler.post { stopInternal(sendState = true) }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                // Regained: resume if we were paused by a transitory loss.
                ttsHandler.post {
                    if (speaking.get() && paused.get()) {
                        paused.set(false)
                        audioTrack?.play()
                        emitPlaybackState(PlaybackState.PLAYING)
                    }
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Teardown / stop
    // ──────────────────────────────────────────────────────────────────

    private fun teardownPlayback(releaseFocus: Boolean) {
        stopFlag.set(true)
        audioTrack?.let { track ->
            try {
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
                track.stop()
                track.flush()
                track.release()
            } catch (e: Throwable) {
                Logger.warn("AudioTrack release failed: ${e.message}")
            }
        }
        audioTrack = null
        systemFallback.stop()
        if (releaseFocus) abandonAudioFocus()
    }

    /** Cancel the producer before queuing teardown behind a potentially blocking PCM write. */
    private fun interruptSpeechOutput() {
        stopFlag.set(true)
        paused.set(false)
        try { audioTrack?.pause(); audioTrack?.flush(); audioTrack?.stop() } catch (_: Throwable) { }
        systemFallback.stop()
    }

    private fun stopInternal(sendState: Boolean) {
        teardownPlayback(releaseFocus = true)
        speaking.set(false)
        paused.set(false)
        if (sendState) emitPlaybackState(PlaybackState.STOPPED)
    }

    // ──────────────────────────────────────────────────────────────────
    // Event emission (small JSON payloads; NO audio bytes)
    //
    // Events are delivered to the frontend by evaluating JavaScript on the
    // WebView that dispatches a global CustomEvent. The TS bridge subscribes
    // with window.addEventListener("tts://...", ...). This mirrors the proven
    // pattern in plethora-folder-import's FolderImportPlugin.handleSharedUrl
    // and avoids needing the Tauri global-event (plugin:event|emit) path from
    // Kotlin (which is a Rust core command, not reachable from a mobile plugin).
    // ──────────────────────────────────────────────────────────────────

    private fun dispatchEvent(event: String, payload: JSONObject) {
        mainHandler.post {
            val view = webView ?: return@post
            try {
                // Pass the payload as a JSON *string literal* and parse it in the
                // page, rather than splicing raw JSON in as an object literal.
                // Sentence text is user content straight out of the book: a
                // double quote (JSON-escaped to \") spliced into JS source would
                // close the string early and make the whole script a syntax
                // error — which the inner try/catch cannot catch, because a
                // script that fails to parse never runs at all. Dialogue in an
                // epub would silently kill sentence highlighting. JSONObject.quote
                // produces a correctly escaped literal for exactly this.
                val literal = JSONObject.quote(payload.toString())
                val js = "(function(){try{window.dispatchEvent(new CustomEvent('$event',{detail:JSON.parse($literal)}));}catch(e){}})();"
                view.evaluateJavascript(js, null)
            } catch (e: Throwable) {
                Logger.warn("dispatchEvent($event) failed: ${e.message}")
            }
        }
    }

    private fun emitPlaybackState(state: PlaybackState) {
        dispatchEvent("tts://playback-state", JSONObject().put("state", state.serial))
    }

    private fun emitSentencePosition(utteranceId: Int, index: Int, sentence: String) {
        dispatchEvent(
            "tts://sentence-position",
            JSONObject()
                .put("utteranceId", utteranceId)
                .put("index", index)
                .put("sentence", sentence),
        )
    }

    /** Exact spoken-word position from the System-TTS fallback engine. */
    private fun emitWordPosition(
        utteranceId: Int,
        sentenceIndex: Int,
        charIndex: Int,
        charLength: Int,
    ) {
        dispatchEvent(
            "tts://word-position",
            JSONObject()
                .put("utteranceId", utteranceId)
                .put("sentenceIndex", sentenceIndex)
                .put("charIndex", charIndex)
                .put("charLength", charLength),
        )
    }

    private fun emitUtteranceComplete(utteranceId: Int) {
        dispatchEvent("tts://utterance-complete", JSONObject().put("utteranceId", utteranceId))
    }

    private fun emitError(kind: String, message: String) {
        dispatchEvent(
            "tts://error",
            JSONObject().put("kind", kind).put("message", message),
        )
    }

    private fun emitDownloadProgress(modelId: String, bytes: Long, total: Long) {
        dispatchEvent(
            "tts://download-progress",
            JSONObject().put("modelId", modelId).put("bytes", bytes).put("total", total),
        )
    }

    private fun emitDownloadState(modelId: String, installing: Boolean) {
        dispatchEvent(
            "tts://download-state",
            JSONObject().put("modelId", modelId).put("installing", installing),
        )
    }

}

/** Pure offset math for word-position events: joined-text char offsets →
 * (sentence index, within-sentence char index, clamped length). Extracted for
 * JVM unit testing; mirrors the SystemTtsFallback joined-speak space. */
internal object WordPositionOffsets {
    fun sentenceStarts(sentences: List<String>): IntArray {
        val starts = IntArray(sentences.size)
        var length = 0
        for (i in sentences.indices) {
            starts[i] = length
            length += sentences[i].length + 1 // + joining space
        }
        return starts
    }

    fun joinSentences(sentences: List<String>): String = sentences.joinToString(" ")

    fun resolve(
        sentences: List<String>,
        starts: IntArray,
        charIndex: Int,
        charLength: Int,
    ): Triple<Int, Int, Int> {
        var lo = 0
        var hi = starts.size - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) ushr 1
            if (starts[mid] <= charIndex) lo = mid else hi = mid - 1
        }
        val within = charIndex - starts[lo]
        val sentenceLength = sentences.getOrNull(lo)?.length ?: 0
        val length = charLength.coerceAtMost((sentenceLength - within).coerceAtLeast(0))
        return Triple(lo, within.coerceAtLeast(0), length)
    }
}
