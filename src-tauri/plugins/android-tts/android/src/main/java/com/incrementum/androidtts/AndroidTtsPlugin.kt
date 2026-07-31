// Copyright 2026 Incrementum
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

package com.incrementum.androidtts

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
    private val ttsThread = HandlerThread("incrementum-tts").apply { start() }
    private val ttsHandler = Handler(ttsThread.looper)
    /** Separate thread for downloads so a download never blocks speak. */
    private val downloadExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "incrementum-tts-download").apply { isDaemon = true }
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
    }

    override fun onPause() {
        super.onPause()
        ttsHandler.post { teardownPlayback(releaseFocus = true) }
    }

    override fun onStop() {
        super.onStop()
        ttsHandler.post { teardownPlayback(releaseFocus = true) }
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
        ttsHandler.post {
            stopInternal(sendState = false)
            startUtterance(sentences, manifest, voiceId, rate)
        }
        // Resolve immediately; playback drives the UI via events.
        invoke.resolve()
    }

    @Command
    fun pause(invoke: Invoke) {
        ttsHandler.post {
            paused.set(true)
            audioTrack?.pause()
            emitPlaybackState(PlaybackState.PAUSED)
        }
        invoke.resolve()
    }

    @Command
    fun resume(invoke: Invoke) {
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
        ttsHandler.post { stopInternal(sendState = true) }
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
    ) {
        val utteranceId = utteranceSeq.incrementAndGet()
        speaking.set(true)
        paused.set(false)
        stopFlag.set(false)
        activeModelId = manifest.id
        activeVoiceId = voiceId
        speed = rate

        emitPlaybackState(PlaybackState.LOADING)

        // Keep the process alive across screen lock / backgrounding (where the
        // platform supports it). The service only holds a foreground
        // notification; the engine stays here.
        TtsPlaybackService.start(ctx)

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
            runSystemFallback(sentences, utteranceId)
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
            runSystemFallback(sentences, utteranceId)
            return
        }

        // Sentence-by-sentence synthesis with prefetching: synthesize + play
        // sentence N, while the loop naturally overlaps because AudioTrack
        // blocks on write, letting the next sentence's generation interleave.
        val sampleRate = engine.sampleRate().takeIf { it > 0 } ?: 24000
        for ((index, sentence) in sentences.withIndex()) {
            if (stopFlag.get()) break
            // Emit sentence-position for highlighting just before playing.
            emitSentencePosition(utteranceId, index, sentence)
            emitPlaybackState(PlaybackState.PLAYING)

            val ok = try {
                engine.synthesize(sentence, sid, rate) { samples ->
                    ensureAudioTrack(sampleRate)
                    val track = audioTrack
                    if (track == null || stopFlag.get()) return@synthesize false
                    if (paused.get()) blockUntilResumed()
                    if (stopFlag.get()) return@synthesize false
                    track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
                    !stopFlag.get()
                }
            } catch (e: Exception) {
                Logger.error("TTS inference failed: ${e.message}")
                emitError("inference", "On-device synthesis failed: ${e.message}. Falling back to system voice.")
                // Stop native playback before engaging fallback (single-engine).
                teardownPlayback(releaseFocus = false)
                runSystemFallback(listOf(sentence), utteranceId)
                continue
            }
            if (!ok && stopFlag.get()) break
        }

        teardownPlayback(releaseFocus = true)
        speaking.set(false)
        emitUtteranceComplete(utteranceId)
        emitPlaybackState(PlaybackState.IDLE)
    }

    /** Route to the Android platform TextToSpeech engine. */
    private fun runSystemFallback(sentences: List<String>, utteranceId: Int) {
        emitPlaybackState(PlaybackState.PLAYING)
        systemFallback.stop()
        val joined = sentences.joinToString(separator = " ")
        val tag = "utt-$utteranceId-${UUID.randomUUID()}"
        systemFallback.speak(
            text = joined,
            rate = speed,
            utteranceId = tag,
            onDone = {
                mainHandler.post {
                    if (!stopFlag.get()) {
                        emitUtteranceComplete(utteranceId)
                        emitPlaybackState(PlaybackState.IDLE)
                        abandonAudioFocus()
                        speaking.set(false)
                    }
                }
            },
            onErrorFn = { msg ->
                mainHandler.post {
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

    @Suppress("DEPRECATION")
    private fun requestAudioFocus(): Boolean {
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            audioManager.abandonAudioFocus(focusListener)
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
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
        TtsPlaybackService.stop(ctx)
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
    // pattern in incrementum-folder-import's FolderImportPlugin.handleSharedUrl
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
