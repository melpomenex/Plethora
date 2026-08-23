// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// On-device STT plugin command surface. Kotlin owns decode → resample →
// VAD → recognize inside a foreground service; Rust polls sttJobStatus and
// persists segments (design.md D2). Only control messages and finished
// segments (as JSON) cross the bridge — never PCM.

package com.plethora.androidstt

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@InvokeArg
class SttStartJobArgs {
    var jobId: String? = null
    var sourcePath: String? = null
    var title: String? = null
    var language: String? = null
    var modelId: String? = null
    var pacing: String? = null
    var resumeFromMs: Long? = null
}

@InvokeArg
class SttJobStatusArgs {
    var jobId: String? = null
    var cursor: Int? = null
}

@InvokeArg
class SttModelArgs {
    var modelId: String? = null
}

@TauriPlugin
class AndroidSttPlugin(private val activity: Activity) : Plugin(activity) {

    @Volatile
    private var webView: WebView? = null

    private val io: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "plethora-stt").apply { isDaemon = true }
    }
    private val downloadThread: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "plethora-stt-download").apply { isDaemon = true }
    }

    private val models = SttModelManager(activity)
    private val hooks = DelegatingHooks()
    private val jobs: SttJobManager = SttJobManager(
        models = models,
        recognizerFactory = SherpaRecognizerFactory(),
        segmenterFactory = { baseOffset -> SherpaVadSegmenter(activity, baseOffset) },
        audioSourceFactory = { PcmDecoder(it) },
        serviceHooks = hooks,
    )

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        SttServiceBridge.manager = jobs
        SttServiceBridge.delegatingHooks = hooks
    }

    // --- capability ---

    @Command
    fun sttStatus(invoke: Invoke) {
        io.execute {
            val ready = models.readyModelIds()
            val o = JSObject()
            o.put("id", "stt.transcribe")
            o.put("available", true)
            o.put("ready", ready.isNotEmpty())
            o.put("requiresDownload", ready.isEmpty())
            o.put("onDevice", true)
            o.put("networkRequired", false)
            o.put("foregroundOnly", false)
            o.put("supportsWordTimestamps", true)
            o.put("readyModelIds", JSONArray(ready))
            o.put("activeJobId", jobs.currentJobId ?: JSONObject.NULL)
            invoke.resolve(o)
        }
    }

    // --- job control ---

    @Command
    fun sttStartJob(invoke: Invoke) {
        val args = invoke.parseArgs(SttStartJobArgs::class.java)
        val sourcePath = args.sourcePath?.trim().orEmpty()
        if (sourcePath.isEmpty()) {
            invoke.reject("sourcePath is required", "invalid_argument")
            return
        }
        val jobId = args.jobId?.trim().orEmpty().ifEmpty { "stt-${System.nanoTime()}" }
        io.execute {
            try {
                // Model selection (D4): explicit choice wins; otherwise the
                // language default among ready models.
                val requested = args.modelId?.trim().orEmpty()
                val readyIds = models.readyModelIds()
                val modelId = if (requested.isNotEmpty()) {
                    requested
                } else {
                    SttModelRegistry.defaultForLanguage(args.language, readyIds).id
                }
                val info = SttJobInfo(
                    jobId = jobId,
                    sourcePath = sourcePath,
                    title = args.title?.trim().orEmpty().ifEmpty { "Transcription" },
                    language = args.language?.trim().orEmpty().ifEmpty { null },
                    modelId = modelId,
                    pacing = SttPacing.fromSerial(args.pacing?.trim()),
                    resumeFromMs = args.resumeFromMs?.coerceAtLeast(0L) ?: 0L,
                )
                jobs.start(info)
                ensureNotificationPermission()
                try {
                    SttTranscriptionService.start(activity, info.title)
                } catch (e: Throwable) {
                    // The job is already running; a service-start failure only
                    // costs the notification (background survival), so degrade
                    // gracefully instead of failing the started job.
                    Logger.warn("Stt: foreground service start failed: ${e.message}")
                }
                val o = JSObject()
                o.put("jobId", jobId)
                o.put("modelId", modelId)
                invoke.resolve(o)
            } catch (e: SttPluginException) {
                invoke.reject(e.message ?: "failed to start job", e.kind)
            } catch (e: Throwable) {
                invoke.reject(e.message ?: "failed to start job", "inference_failed")
            }
        }
    }

    @Command
    fun sttJobStatus(invoke: Invoke) {
        val args = invoke.parseArgs(SttJobStatusArgs::class.java)
        io.execute {
            val snapshot = jobs.status(args.jobId?.trim().orEmpty().ifEmpty { null }, args.cursor ?: 0)
            if (snapshot == null) {
                invoke.reject("No such job", "not_found")
                return@execute
            }
            val o = JSObject()
            o.put("jobId", snapshot.jobId)
            o.put("status", snapshot.state.serial)
            o.put("progress", snapshot.progressPercent)
            o.put("decodeOffsetMs", snapshot.decodeOffsetMs)
            o.put("durationMs", snapshot.durationMs)
            o.put("totalSegments", snapshot.totalSegments)
            o.put("nextCursor", snapshot.nextCursor)
            val segments = JSONArray()
            for (segment in snapshot.segments) {
                val s = JSObject()
                s.put("index", segment.index)
                s.put("startMs", segment.startMs)
                s.put("endMs", segment.endMs)
                s.put("text", segment.text)
                if (segment.wordTimingsJson != null) {
                    s.put("words", JSONArray(segment.wordTimingsJson))
                }
                segments.put(s)
            }
            o.put("segments", segments)
            if (snapshot.errorKind != null) {
                o.put("errorKind", snapshot.errorKind)
                o.put("error", snapshot.errorMessage ?: "")
            }
            invoke.resolve(o)
        }
    }

    @Command
    fun sttCancelJob(invoke: Invoke) {
        io.execute {
            jobs.cancel()
            invoke.resolve(JSObject().put("cancelled", true))
        }
    }

    // --- model management ---

    @Command
    fun sttListModels(invoke: Invoke) {
        io.execute {
            val arr = JSONArray()
            for (manifest in SttModelRegistry.ALL) {
                val m = JSObject()
                m.put("id", manifest.id)
                m.put("name", manifest.displayName)
                m.put("kind", manifest.kind.serial)
                m.put("ready", models.isReady(manifest))
                m.put("installing", models.isInstalling(manifest.id))
                m.put("bytesOnDisk", models.bytesOnDisk(manifest.id))
                m.put("downloadBytes", manifest.archiveBytes)
                m.put("description", manifest.description)
                m.put("languages", manifest.languages.primary)
                m.put("default", manifest.id == SttModelRegistry.fallbackDefault.id)
                arr.put(m)
            }
            invoke.resolve(JSObject().put("models", arr))
        }
    }

    @Command
    fun sttPrepareModel(invoke: Invoke) {
        val args = invoke.parseArgs(SttModelArgs::class.java)
        val modelId = args.modelId?.trim().orEmpty()
        if (modelId.isEmpty()) {
            invoke.reject("modelId is required", "invalid_argument")
            return
        }
        val manifest = SttModelRegistry.byId(modelId)
        if (manifest == null) {
            invoke.reject("Unknown model $modelId", "invalid_argument")
            return
        }
        downloadThread.execute {
            if (models.isReady(manifest)) {
                invoke.resolve(JSObject().put("ready", true))
                return@execute
            }
            val outcome = models.download(manifest) { _, bytes, total ->
                dispatchDownloadProgress(manifest.id, bytes, total)
            }
            when (outcome) {
                is SttDownloadOutcome.Success -> {
                    dispatchDownloadProgress(manifest.id, manifest.archiveBytes, manifest.archiveBytes)
                    invoke.resolve(JSObject().put("ready", true))
                }
                is SttDownloadOutcome.Failure ->
                    invoke.reject("download:${outcome.kind}:${outcome.message}", outcome.kind)
            }
        }
    }

    @Command
    fun sttDeleteModel(invoke: Invoke) {
        val args = invoke.parseArgs(SttModelArgs::class.java)
        val modelId = args.modelId?.trim().orEmpty()
        if (modelId.isEmpty()) {
            invoke.reject("modelId is required", "invalid_argument")
            return
        }
        io.execute {
            if (SttModelRegistry.byId(modelId) == null) {
                invoke.reject("Unknown model $modelId", "invalid_argument")
                return@execute
            }
            val snapshot = jobs.status(null, 0)
            if (snapshot != null && snapshot.state == SttJobState.RUNNING) {
                invoke.reject("A transcription job is running", "job_running")
                return@execute
            }
            val deleted = models.delete(modelId)
            invoke.resolve(JSObject().put("deleted", deleted))
        }
    }

    // --- internals ---

    /**
     * Kotlin cannot reach Tauri's event system, so download progress rides a
     * DOM CustomEvent (same bridge the TTS plugin uses). Raw JSON splicing
     * breaks on quotes, so the payload is JSON.parse'd from a quoted literal.
     */
    private fun dispatchDownloadProgress(modelId: String, bytes: Long, total: Long) {
        val view = webView ?: return
        val payload = JSONObject()
            .put("modelId", modelId)
            .put("bytes", bytes)
            .put("totalBytes", total)
        val js = "(function(){try{window.dispatchEvent(new CustomEvent('stt://model-download-progress'," +
            "{detail:JSON.parse(${JSONObject.quote(payload.toString())})}));}catch(e){}})();"
        view.post { view.evaluateJavascript(js, null) }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 8422)
        }
    }
}
