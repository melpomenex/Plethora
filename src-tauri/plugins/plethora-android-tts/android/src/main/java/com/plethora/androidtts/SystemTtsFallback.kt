// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Zero-download fallback: Android platform TextToSpeech. Used when no local
// model is installed, when a model fails to load, or when inference errors
// mid-utterance. Distinct from the webview's SpeechSynthesis provider — this
// lives entirely on the native side and is the fallback *under* the native
// provider. Single-engine ownership in AndroidTtsPlugin ensures the two never
// speak at once.

package com.plethora.androidtts

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import app.tauri.Logger
import java.util.Locale

/**
 * Wraps Android TextToSpeech. Async to initialize (the engine binds to the
 * system TTS service); callers use [speak] which waits until ready.
 */
class SystemTtsFallback(context: Context) {

    private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    private val initLock = Object()

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            synchronized(initLock) {
                if (status == TextToSpeech.SUCCESS) {
                    ready = true
                    Logger.info("SystemTTS fallback ready")
                } else {
                    Logger.warn("SystemTTS fallback init failed: status=$status")
                }
                (initLock as Object).notifyAll()
            }
        }
    }

    /** Block (briefly) until the engine is ready or a timeout elapses. */
    private fun awaitReady() {
        if (ready) return
        synchronized(initLock) {
            if (ready) return
            (initLock as Object).wait(2000)
        }
    }

    /**
     * Speak [text] via the platform engine. [utteranceId] correlates with
     * completion/progress callbacks. Returns true if the utterance was queued.
     * [onDone]/[onErrorFn] fire from the engine's progress listener, so they
     * must be thread-safe (the plugin routes them onto its event emitter).
     */
    fun speak(
        text: String,
        rate: Float,
        utteranceId: String,
        onDone: (() -> Unit)?,
        onErrorFn: ((String) -> Unit)?,
    ): Boolean {
        awaitReady()
        val instance = tts ?: run {
            onErrorFn?.invoke("System TTS not initialized")
            return false
        }
        if (!ready) {
            onErrorFn?.invoke("System TTS not available on this device")
            return false
        }
        instance.setSpeechRate(rate.coerceIn(0.1f, 4f))
        currentUtteranceId = utteranceId

        instance.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { if (id == utteranceId) onDone?.invoke() }
            @Deprecated("required override on older API levels", ReplaceWith(""))
            override fun onError(id: String?) {
                if (id == utteranceId) onErrorFn?.invoke("System TTS playback failed")
            }
            override fun onError(utteranceId: String?, errorCode: Int) {
                if (utteranceId == this@SystemTtsFallback.currentUtteranceId) {
                    onErrorFn?.invoke("System TTS error code=$errorCode")
                }
            }
        })

        val res = instance.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (res != TextToSpeech.SUCCESS) {
            onErrorFn?.invoke("System TTS speak() returned $res")
            return false
        }
        return true
    }

    fun stop() {
        try {
            tts?.stop()
        } catch (e: Throwable) {
            Logger.warn("SystemTTS stop threw ${e.message}")
        }
    }

    /** Last utterance id handed to the engine, for progress-listener correlation. */
    @Volatile private var currentUtteranceId: String = ""

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (e: Throwable) {
            Logger.warn("SystemTTS shutdown threw ${e.message}")
        }
        tts = null
        ready = false
    }
}
