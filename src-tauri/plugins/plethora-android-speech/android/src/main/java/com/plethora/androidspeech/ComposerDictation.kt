package com.plethora.androidspeech

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.Locale

@InvokeArg
class DictationArgs {
    var sessionId: String = ""
    var locale: String = Locale.getDefault().toLanguageTag()
    var requireOnDevice: Boolean = false
    var networkConsent: Boolean = false
}

/** All recognizer creation, listening and destruction stays on the main looper. */
internal class ComposerDictation(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private val session = DictationSession({ delay, callback ->
        val runnable = Runnable { callback() }; main.postDelayed(runnable, delay)
        val cancel: () -> Unit = { main.removeCallbacks(runnable) }
        cancel
    }, { destroy() }, { recognizer?.stopListening() })
    private var pending: Pair<Invoke, DictationArgs>? = null
    private fun onMain(action: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() } }
    private fun localAvailable() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
    fun status(invoke: Invoke) = onMain {
        val args = invoke.parseArgs(DictationArgs::class.java)
        val local = localAvailable()
        val available = local || SpeechRecognizer.isRecognitionAvailable(activity)
        val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        invoke.resolve(JSObject().apply {
            put("platform", "android"); put("available", available); put("locale", args.locale)
            put("processing", if (local) "on-device" else "system-service")
            put("microphonePermission", if (granted) "granted" else "prompt")
            put("reason", if (available) "locale-unverified" else "unavailable")
        })
    }
    /** Reserve before prompting, so another composer cannot displace the owner. */
    fun prepare(invoke: Invoke, requestPermission: () -> Unit) = onMain {
        val args = invoke.parseArgs(DictationArgs::class.java)
        if (args.sessionId.isEmpty() || args.sessionId.length > 128) { invoke.reject("Invalid dictation session", "cancelled"); return@onMain }
        if (!session.reserve(args.sessionId) { error -> if (error == null) invoke.resolve(JSObject().apply { put("ok", true) }) else invoke.reject("Dictation $error", error) }) {
            invoke.reject("Microphone is already owned", "busy"); return@onMain
        }
        val local = localAvailable()
        if ((!local && args.requireOnDevice) || (!local && !args.networkConsent) || (!local && !SpeechRecognizer.isRecognitionAvailable(activity))) {
            session.result(args.sessionId, null, "unavailable"); return@onMain
        }
        pending = Pair(invoke, args)
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) requestPermission()
        else permissionResult(invoke)
    }
    fun permissionResult(invoke: Invoke) = onMain {
        val request = pending
        if (request?.first !== invoke || !session.owns(request.second.sessionId)) return@onMain
        pending = null
        val args = request.second
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            session.result(args.sessionId, null, "denied"); return@onMain
        }
        try {
            val local = localAvailable()
            if (!local && (args.requireOnDevice || !args.networkConsent)) { session.result(args.sessionId, null, "unavailable"); return@onMain }
            val client = if (local && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(activity) else SpeechRecognizer.createSpeechRecognizer(activity)
            recognizer = client
            client.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { if (recognizer === client) session.ready(args.sessionId) }
                override fun onResults(results: Bundle?) { if (recognizer === client) session.result(args.sessionId, results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()) }
                override fun onError(error: Int) { if (recognizer === client) session.result(args.sessionId, null, when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "denied"
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
                    else -> "unavailable"
                }) }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            client.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, args.locale)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            })
        } catch (_: Throwable) { session.result(args.sessionId, null, "unavailable") }
    }
    fun stop(invoke: Invoke) = onMain {
        val args = invoke.parseArgs(DictationArgs::class.java)
        session.stop(args.sessionId) { text, error -> if (error != null) invoke.reject("Dictation $error", error) else invoke.resolve(JSObject().apply { put("text", text ?: "") }) }
    }
    fun cancel(invoke: Invoke) = onMain {
        val args = invoke.parseArgs(DictationArgs::class.java)
        session.cancel(args.sessionId)
        if (pending?.second?.sessionId == args.sessionId) pending = null
        invoke.resolve(JSObject().apply { put("ok", true) })
    }
    fun interrupt() = onMain { pending = null; session.cancel(reason = "interrupted") }
    private fun destroy() {
        val client = recognizer; recognizer = null
        try { client?.cancel() } catch (_: Throwable) {}
        try { client?.destroy() } catch (_: Throwable) {}
    }
}
