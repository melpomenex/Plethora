// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Native sherpa-onnx TTS engine wrapper. Owns the OfflineTts instance, streams
// callback PCM to a sink (the AudioTrack owned by the plugin), and exposes
// load/unload lifecycle so sessions are released under memory pressure.
//
// Inference always runs on a background thread (see AndroidTtsPlugin). This
// class is single-threaded by convention: the plugin serializes all calls.

package com.plethora.androidtts

import android.content.Context
import app.tauri.Logger
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import java.io.File

/**
 * Callback invoked for each chunk of generated PCM. Receives float samples in
 * [-1, 1]. Return true to continue generating, false to abort promptly.
 */
typealias PcmSink = (samples: FloatArray) -> Boolean

class SherpaTtsEngine(private val context: Context) {

    /** Loaded engine, or null when no model is loaded. */
    @Volatile
    private var tts: OfflineTts? = null

    /** The model id currently loaded, for guards. */
    @Volatile
    private var loadedModelId: String? = null

    val isLoaded: Boolean get() = tts != null
    val currentModelId: String? get() = loadedModelId

    /**
     * Load a model from its extracted directory. If a different model is already
     * loaded it is released first. Throws on any failure to load (caller falls
     * back to System TTS).
     */
    @Synchronized
    fun load(manifest: TtsModelManifest, modelDir: File) {
        if (loadedModelId == manifest.id && tts != null) return
        unload()
        val onnx = findPrimaryOnnx(modelDir)
            ?: throw IllegalStateException("model.onnx not found under ${modelDir.absolutePath}")
        val tokens = findFile(modelDir, "tokens.txt")
            ?: throw IllegalStateException("tokens.txt not found under ${modelDir.absolutePath}")
        val voices = findFile(modelDir, "voices.bin") ?: findFile(modelDir, "voices.npz")
        val dataDir = if (manifest.dataDir.isNotEmpty()) {
            findDir(modelDir, manifest.dataDir)?.absolutePath ?: ""
        } else ""

        val modelConfig = OfflineTtsModelConfig().apply {
            numThreads = 2 // capped per upstream thermal guidance (design.md §3)
            debug = false
            provider = "cpu"
            when (manifest.kind) {
                TtsModelKind.KITTEN -> {
                    kitten = OfflineTtsKittenModelConfig().apply {
                        model = onnx.absolutePath
                        this.tokens = tokens.absolutePath
                        if (voices != null) this.voices = voices.absolutePath
                        if (dataDir.isNotEmpty()) this.dataDir = dataDir
                    }
                }
                TtsModelKind.KOKORO -> {
                    kokoro = OfflineTtsKokoroModelConfig().apply {
                        model = onnx.absolutePath
                        this.tokens = tokens.absolutePath
                        if (voices != null) this.voices = voices.absolutePath
                        if (dataDir.isNotEmpty()) this.dataDir = dataDir
                    }
                }
            }
        }
        val config = OfflineTtsConfig().apply { model = modelConfig }
        val instance = OfflineTts(assetManager = null, config = config)
        tts = instance
        loadedModelId = manifest.id
        Logger.info("TTS: loaded ${manifest.id} (${manifest.kind.serial}), sampleRate=${instance.sampleRate()}, speakers=${instance.numSpeakers()}")
    }

    /** Release the current engine, if any. Safe to call when not loaded. */
    @Synchronized
    fun unload() {
        val cur = tts ?: return
        try {
            cur.release()
        } catch (e: Throwable) {
            Logger.warn("TTS: unload threw ${e.message}")
        }
        tts = null
        loadedModelId = null
    }

    /** Sample rate of the loaded model; 0 when not loaded. */
    fun sampleRate(): Int = tts?.sampleRate() ?: 0

    /** Number of speakers in the loaded model; 0 when not loaded. */
    fun numSpeakers(): Int = tts?.numSpeakers() ?: 0

    /**
     * Synthesize [text], streaming PCM to [sink]. Returns true if synthesis
     * completed, false if it was aborted by the sink or a stop request.
     */
    fun synthesize(text: String, voiceId: Int, speed: Float, sink: PcmSink): Boolean {
        val instance = tts ?: throw IllegalStateException("SherpaTtsEngine: no model loaded")
        var aborted = false
        val audio: GeneratedAudio = instance.generateWithCallback(
            text = text,
            sid = voiceId,
            speed = speed,
        ) { samples ->
            // Return non-zero to continue, 0 to stop (per sherpa JNI convention).
            if (aborted) return@generateWithCallback 0
            val keepGoing = sink(samples)
            if (!keepGoing) aborted = true
            if (aborted) 0 else 1
        }
        // Flush any final tail samples that arrived after the last callback.
        // (GeneratedAudio.samples holds the full output; the callback already
        // streamed the incremental chunks, so we do NOT write it again here.)
        // Suppress unused-warning; audio is the completed result.
        @Suppress("UNUSED_VARIABLE")
        val completed = audio
        return !aborted
    }

    // ──────────────────────────────────────────────────────────────────
    // File lookup helpers (packages extract to a nested folder)
    // ──────────────────────────────────────────────────────────────────

    private fun findPrimaryOnnx(root: File): File? =
        root.walkTopDown().firstOrNull { it.isFile && it.name.endsWith(".onnx") }

    private fun findFile(root: File, name: String): File? =
        root.walkTopDown().firstOrNull { it.isFile && it.name == name }

    private fun findDir(root: File, name: String): File? =
        root.walkTopDown().firstOrNull { it.isDirectory && it.name == name }
}
