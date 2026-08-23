package com.plethora.androidspeech

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class TranscribeAudioArgs {
    var sourceUri: String? = null
    var language: String? = null
    var sampleRateHz: Int? = null
    var channels: Int? = null
    var encoding: String? = null
}

/** Pure PCM gate for JVM tests (ML Kit Speech Basic: 16 kHz mono PCM16LE). */
object SpeechPcm {
    const val RATE = 16000
    const val CHANNELS = 1
    const val ENCODING = "pcm16le"

    fun rejectReason(rate: Int?, channels: Int?, encoding: String?): String? {
        if (rate != null && rate != RATE) return "codec_unsupported"
        if (channels != null && channels != CHANNELS) return "codec_unsupported"
        if (encoding != null && encoding != ENCODING) return "codec_unsupported"
        return null
    }
}

@TauriPlugin
class AndroidSpeechPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun speechStatus(invoke: Invoke) {
        val result = capability(
            available = Build.VERSION.SDK_INT >= 31,
            ready = false,
            reason = if (Build.VERSION.SDK_INT >= 31) "model_downloadable" else "device_unsupported",
            foregroundOnly = true,
            streaming = true,
        )
        invoke.resolve(result)
    }

    @Command
    fun transcribeAudio(invoke: Invoke) {
        val args = invoke.parseArgs(TranscribeAudioArgs::class.java)
        val uri = args.sourceUri?.trim().orEmpty()
        if (uri.isEmpty()) {
            invoke.reject("Speech source must be a persisted file URI.", "invalid_argument")
            return
        }
        SpeechPcm.rejectReason(args.sampleRateHz, args.channels, args.encoding)?.let {
            invoke.reject("ML Kit Speech needs 16 kHz mono PCM16LE", it)
            return
        }
        val mic = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.RECORD_AUDIO)
        if (mic != PackageManager.PERMISSION_GRANTED && uri.startsWith("mic:")) {
            invoke.reject("Microphone permission denied", "permission_denied")
            return
        }
        // Alpha client is compiled in; first-use download is not auto-started.
        invoke.reject("ML Kit Speech model is not downloaded on this device.", "feature_unavailable")
    }

    private fun capability(
        available: Boolean,
        ready: Boolean,
        reason: String,
        foregroundOnly: Boolean,
        streaming: Boolean,
    ): JSObject {
        val o = JSObject()
        o.put("id", "speech.transcribe")
        o.put("available", available)
        o.put("ready", ready)
        o.put("requiresDownload", available && !ready)
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", foregroundOnly)
        o.put("supportsStreaming", streaming)
        o.put("supportsImages", false)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", org.json.JSONArray().put("en-US"))
        o.put("privacy", "on-device")
        o.put("reason", reason)
        return o
    }
}
