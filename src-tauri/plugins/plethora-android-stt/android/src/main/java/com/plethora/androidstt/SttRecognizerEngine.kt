// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// sherpa-onnx OfflineRecognizer wrapper for the two catalog models
// (SenseVoice int8 multilingual default, Parakeet TDT_CTC 110M int8 English
// fast path), plus the silero VAD speech segmenter. Both sit behind tiny
// interfaces so the job state machine can be JVM-tested with fakes (the
// real classes are JNI-backed and only run on a device).

package com.plethora.androidstt

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeechSegment
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File

/** Recognition result for one utterance. Timestamps are seconds from utterance start. */
class SttRecognized(
    val text: String,
    val tokens: List<String>,
    val timestamps: FloatArray,
) {
    /** Last token timestamp in seconds, or 0 when the model returned none. */
    val lastTokenSeconds: Float get() = timestamps.maxOrNull() ?: 0f
}

/** A decoder instance for one model; one utterance per [decode] call. */
interface SttRecognizer : AutoCloseable {
    fun decode(samples: FloatArray, sampleRate: Int): SttRecognized
}

/** Opens recognizers for installed models. Replaced with a fake in JVM tests. */
fun interface SttRecognizerFactory {
    fun open(manifest: SttModelManifest, modelDir: File, language: String?, numThreads: Int): SttRecognizer
}

/**
 * Builds the sherpa `OfflineRecognizer` config per model kind and runs
 * per-utterance decoding through a fresh `OfflineStream` (the sherpa
 * contract: acceptWaveform → decode → getResult).
 */
class SherpaRecognizerFactory : SttRecognizerFactory {

    override fun open(
        manifest: SttModelManifest,
        modelDir: File,
        language: String?,
        numThreads: Int,
    ): SttRecognizer {
        val modelFile = findFile(modelDir, "model.int8.onnx") ?: findPrimaryOnnx(modelDir)
            ?: throw IllegalStateException("model.int8.onnx not found under ${modelDir.absolutePath}")
        val tokensFile = findFile(modelDir, "tokens.txt")
            ?: throw IllegalStateException("tokens.txt not found under ${modelDir.absolutePath}")
        // SenseVoice "" asks it to auto-detect; unsupported user languages
        // fall back to it (zh/en/ja/ko/yue are native).
        val senseVoiceLang = senseVoiceLanguage(language)

        val recognizerModelConfig = OfflineModelConfig().apply {
            this.numThreads = numThreads
            this.debug = false
            this.provider = "cpu"
            this.tokens = tokensFile.absolutePath
            when (manifest.kind) {
                SttModelKind.SENSE_VOICE -> {
                    senseVoice = OfflineSenseVoiceModelConfig().apply {
                        this.model = modelFile.absolutePath
                        this.language = senseVoiceLang
                        useInverseTextNormalization = false
                    }
                }
                SttModelKind.PARAKEET_CTC -> {
                    nemo = OfflineNemoEncDecCtcModelConfig().apply {
                        this.model = modelFile.absolutePath
                    }
                }
            }
        }
        val config = OfflineRecognizerConfig().apply {
            featConfig = FeatureConfig().apply {
                this.sampleRate = PcmConvert.TARGET_RATE
                this.featureDim = 80
            }
            modelConfig = recognizerModelConfig
        }
        val recognizer = OfflineRecognizer(assetManager = null, config = config)
        return SherpaRecognizer(recognizer)
    }

    private fun senseVoiceLanguage(language: String?): String {
        val lang = (language ?: "").trim().lowercase().take(2)
        return if (lang in setOf("zh", "en", "ja", "ko", "yu")) lang else ""
    }

    private fun findPrimaryOnnx(dir: File): File? =
        dir.walkTopDown().filter { it.isFile && it.extension == "onnx" }.firstOrNull()

    private fun findFile(dir: File, name: String): File? =
        dir.walkTopDown().filter { it.isFile && it.name == name }.firstOrNull()

    private class SherpaRecognizer(
        private val recognizer: OfflineRecognizer,
    ) : SttRecognizer {

        override fun decode(samples: FloatArray, sampleRate: Int): SttRecognized {
            var stream: OfflineStream? = null
            try {
                stream = recognizer.createStream()
                stream.acceptWaveform(samples, sampleRate)
                recognizer.decode(stream)
                val result = recognizer.getResult(stream)
                return SttRecognized(
                    text = result.text.trim(),
                    tokens = result.tokens.toList(),
                    timestamps = result.timestamps,
                )
            } finally {
                try {
                    stream?.release()
                } catch (_: Throwable) {
                }
            }
        }

        override fun close() {
            try {
                recognizer.release()
            } catch (_: Throwable) {
            }
        }
    }
}

/** One VAD-detected utterance, in absolute 16 kHz sample coordinates. */
class SttUtterance(val startSample: Long, val samples: FloatArray) {
    val endSample: Long get() = startSample + samples.size
}

/** Segments a 16 kHz mono stream into utterances. Replaced with a fake in tests. */
interface SpeechSegmenter {
    /** Feed samples; returns utterances completed by this chunk. */
    fun accept(samples: FloatArray): List<SttUtterance>

    /** Emit any trailing speech padded through end-of-stream. */
    fun flush(): List<SttUtterance>
}

/**
 * silero VAD (v5 model shipped in APK assets) driven through sherpa's `Vad`.
 * [baseSampleOffset] rebases sherpa's per-instance sample indices onto the
 * absolute stream timeline when a job resumes from a checkpoint.
 */
class SherpaVadSegmenter(
    context: Context,
    baseSampleOffset: Long,
    threshold: Float = 0.5f,
    maxSpeechSeconds: Float = MAX_SPEECH_SECONDS,
) : SpeechSegmenter {

    private val vad: Vad = Vad(
        assetManager = context.assets,
        config = VadModelConfig().apply {
            sileroVadModelConfig = SileroVadModelConfig().apply {
                model = "silero_vad_v5.onnx"
                this.threshold = threshold
                minSilenceDuration = 0.5f
                minSpeechDuration = 0.25f
                windowSize = 512
                maxSpeechDuration = maxSpeechSeconds
            }
            sampleRate = PcmConvert.TARGET_RATE
            numThreads = 1
        },
    )

    private val base = baseSampleOffset
    private val window = FloatArray(512)
    private var windowFill = 0

    override fun accept(samples: FloatArray): List<SttUtterance> {
        var read = 0
        val out = ArrayList<SttUtterance>()
        while (read < samples.size) {
            val n = minOf(window.size - windowFill, samples.size - read)
            System.arraycopy(samples, read, window, windowFill, n)
            windowFill += n
            read += n
            if (windowFill == window.size) {
                vad.acceptWaveform(window.copyOf())
                windowFill = 0
                out.addAll(drain())
            }
        }
        return out
    }

    override fun flush(): List<SttUtterance> {
        if (windowFill > 0) {
            vad.acceptWaveform(window.copyOf(windowFill))
            windowFill = 0
        }
        vad.flush()
        return drain()
    }

    private fun drain(): List<SttUtterance> {
        val out = ArrayList<SttUtterance>()
        while (!vad.empty()) {
            val seg: SpeechSegment = vad.front()
            out.add(SttUtterance(base + seg.start, seg.samples))
            vad.pop()
        }
        return out
    }

    companion object {
        /** VAD split ceiling; keeps every recognizer decode under 30 s. */
        const val MAX_SPEECH_SECONDS = 28f
    }
}
