package com.plethora.androidspeech

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Base64
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.audio.AudioSource
import com.google.mlkit.genai.speechrecognition.SpeechRecognition
import com.google.mlkit.genai.speechrecognition.SpeechRecognizer
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerRequest
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerResponse
import com.google.mlkit.genai.speechrecognition.speechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.speechRecognizerRequest
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

@InvokeArg
class TranscribeAudioArgs {
    var sourceUri: String? = null
    var language: String? = null
    var sampleRateHz: Int? = null
    var channels: Int? = null
    var encoding: String? = null
    /** Raw 16 kHz mono PCM16LE, standard Base64. WebM/blob URIs are not accepted by ML Kit. */
    var pcmBase64: String? = null
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

/**
 * ML Kit [AudioSource.fromPfd] currently requires real-time pacing (~32 KB/s).
 * A plain file-backed PFD is rejected.
 */
object PacedPcm {
    const val BYTES_PER_SECOND = 32_000

    fun expectedElapsedMs(bytesWritten: Int): Long =
        (bytesWritten.toLong() * 1000L) / BYTES_PER_SECOND

    fun openReadSide(pcm: ByteArray): ParcelFileDescriptor {
        val pipe = ParcelFileDescriptor.createPipe()
        val readSide = pipe[0]
        val writeSide = pipe[1]
        Thread({
            try {
                FileOutputStream(writeSide.fileDescriptor).use { out ->
                    val chunk = 3200
                    var offset = 0
                    val started = SystemClock.elapsedRealtime()
                    while (offset < pcm.size) {
                        val n = minOf(chunk, pcm.size - offset)
                        out.write(pcm, offset, n)
                        offset += n
                        val sleep =
                            expectedElapsedMs(offset) - (SystemClock.elapsedRealtime() - started)
                        if (sleep > 0) Thread.sleep(sleep)
                    }
                }
            } catch (_: Throwable) {
                /* recognizer closed the read side */
            } finally {
                try {
                    writeSide.close()
                } catch (_: Throwable) {
                }
            }
        }, "plethora-pcm-pace").start()
        return readSide
    }
}

@TauriPlugin
class AndroidSpeechPlugin(private val activity: Activity) : Plugin(activity) {
    private val io = Executors.newSingleThreadExecutor { r ->
        Thread(r, "plethora-speech").apply { isDaemon = true }
    }

    @Command
    fun speechStatus(invoke: Invoke) {
        io.execute { invoke.resolve(readCapability()) }
    }

    @Command
    fun downloadSpeechModel(invoke: Invoke) {
        io.execute {
            var client: SpeechRecognizer? = null
            try {
                if (Build.VERSION.SDK_INT < 31) {
                    invoke.reject("ML Kit Speech needs API 31+", "device_unsupported")
                    return@execute
                }
                client = openClient("en-US")
                runBlocking {
                    client.download().collect { status ->
                        if (status is DownloadStatus.DownloadFailed) {
                            throw (status as DownloadStatus.DownloadFailed).let { failed ->
                                Exception(failed.toString())
                            }
                        }
                    }
                }
                invoke.resolve(readCapability())
            } catch (e: Throwable) {
                invoke.reject(e.message ?: "speech model download failed", "feature_unavailable")
            } finally {
                try {
                    client?.close()
                } catch (_: Throwable) {
                }
            }
        }
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
        val liveMic = uri.startsWith("mic:")
        val micGranted =
            ContextCompat.checkSelfPermission(activity, android.Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        if (liveMic && !micGranted) {
            invoke.reject("Microphone permission denied", "permission_denied")
            return
        }

        io.execute {
            var readPfd: ParcelFileDescriptor? = null
            var client: SpeechRecognizer? = null
            try {
                if (Build.VERSION.SDK_INT < 31) {
                    invoke.reject("ML Kit Speech needs API 31+", "device_unsupported")
                    return@execute
                }
                client = openClient(args.language)
                when (runBlocking { client.checkStatus() }) {
                    FeatureStatus.DOWNLOADABLE -> {
                        invoke.reject("ML Kit Speech model is downloadable.", "model_downloadable")
                        return@execute
                    }
                    FeatureStatus.DOWNLOADING -> {
                        invoke.reject("ML Kit Speech model is downloading.", "model_downloading")
                        return@execute
                    }
                    FeatureStatus.AVAILABLE -> Unit
                    else -> {
                        invoke.reject(
                            "ML Kit Speech is not available on this device.",
                            "feature_unavailable"
                        )
                        return@execute
                    }
                }

                val source = if (liveMic) {
                    AudioSource.fromMic()
                } else {
                    val pcm = decodePcm(args.pcmBase64)
                    if (pcm == null || pcm.isEmpty()) {
                        invoke.reject(
                            "File STT needs raw 16 kHz mono PCM16LE (pcmBase64). Encoded containers are not accepted.",
                            "codec_unsupported"
                        )
                        return@execute
                    }
                    readPfd = PacedPcm.openReadSide(pcm)
                    AudioSource.fromPfd(readPfd)
                }

                val request = speechRecognizerRequest {
                    audioSource = source
                }
                val responses = runBlocking { client.startRecognition(request).toList() }
                val finals = ArrayList<String>()
                for (response in responses) {
                    when (response) {
                        is SpeechRecognizerResponse.FinalTextResponse ->
                            finals.add(response.text)
                        is SpeechRecognizerResponse.ErrorResponse -> {
                            invoke.reject(response.toString(), "inference_failed")
                            return@execute
                        }
                        else -> Unit
                    }
                }
                val text = finals.joinToString(" ").trim()
                val result = JSObject()
                val segments = JSONArray()
                if (text.isNotEmpty()) {
                    val seg = JSObject()
                    seg.put("id", "s0")
                    seg.put("text", text)
                    segments.put(seg)
                }
                result.put("segments", segments)
                result.put("language", args.language ?: "en-US")
                result.put("incomplete", text.isEmpty())
                invoke.resolve(result)
            } catch (e: Throwable) {
                invoke.reject(e.message ?: "speech recognition failed", "inference_failed")
            } finally {
                try {
                    readPfd?.close()
                } catch (_: Throwable) {
                }
                try {
                    client?.close()
                } catch (_: Throwable) {
                }
            }
        }
    }

    private fun decodePcm(b64: String?): ByteArray? {
        val raw = b64?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return try {
            Base64.decode(raw, Base64.DEFAULT)
        } catch (_: Throwable) {
            null
        }
    }

    private fun openClient(language: String?): SpeechRecognizer {
        val tag = language?.trim().orEmpty().ifEmpty { "en-US" }.replace('_', '-')
        val loc = try {
            Locale.forLanguageTag(tag)
        } catch (_: Throwable) {
            Locale.US
        }
        val options = speechRecognizerOptions {
            locale = loc
        }
        return SpeechRecognition.getClient(options)
    }

    private fun readCapability(): JSObject {
        if (Build.VERSION.SDK_INT < 31) {
            return capability(available = false, ready = false, reason = "device_unsupported")
        }
        return try {
            val client = openClient("en-US")
            try {
                when (runBlocking { client.checkStatus() }) {
                    FeatureStatus.AVAILABLE -> capability(true, true, "")
                    FeatureStatus.DOWNLOADABLE -> capability(true, false, "model_downloadable")
                    FeatureStatus.DOWNLOADING -> capability(true, false, "model_downloading")
                    else -> capability(false, false, "feature_unavailable")
                }
            } finally {
                client.close()
            }
        } catch (_: Throwable) {
            capability(true, false, "feature_unavailable")
        }
    }

    private fun capability(available: Boolean, ready: Boolean, reason: String): JSObject {
        val o = JSObject()
        o.put("id", "speech.transcribe")
        o.put("available", available)
        o.put("ready", ready)
        o.put("requiresDownload", available && !ready)
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", true)
        o.put("supportsStreaming", true)
        o.put("supportsImages", false)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", JSONArray().put("en-US"))
        o.put("privacy", "on-device")
        if (reason.isNotEmpty()) o.put("reason", reason)
        return o
    }
}
