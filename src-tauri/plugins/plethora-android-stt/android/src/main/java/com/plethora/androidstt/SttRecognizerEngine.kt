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
import android.os.Build
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
import org.json.JSONObject
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
class SherpaRecognizerFactory(
    private val context: Context? = null,
) : SttRecognizerFactory {

    override fun open(
        manifest: SttModelManifest,
        modelDir: File,
        language: String?,
        numThreads: Int,
    ): SttRecognizer {
        if (manifest.kind == SttModelKind.WHISTLE) {
            val whistleModel = findFile(modelDir, "whistle.cact")
                ?: throw IllegalStateException("whistle.cact not found under ${modelDir.absolutePath}")
            val needleExe = resolveNeedleExecutable(context, modelDir)
            val tempDir = context?.cacheDir ?: modelDir
            return WhistleRecognizer(needleExe, whistleModel, language, tempDir)
        }
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
                SttModelKind.WHISTLE -> {
                    throw IllegalStateException("WHISTLE model cannot be decoded by SherpaRecognizer")
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

private fun resolveNeedleExecutable(context: Context?, modelDir: File): File {
    val envBin = System.getenv("NEEDLE_BIN")
    if (!envBin.isNullOrBlank()) {
        val f = File(envBin)
        if (f.isFile) return f
    }
    if (context != null) {
        val nativeDir = File(context.applicationInfo.nativeLibraryDir)
        val inNative = File(nativeDir, "libneedle.so")
        if (inNative.isFile) {
            try {
                inNative.setExecutable(true, false)
            } catch (_: Throwable) {
            }
            return inNative
        }

        val binDir = File(context.filesDir, "bin")
        val destFile = File(binDir, "needle")
        if (destFile.isFile && destFile.canExecute()) {
            return destFile
        }

        try {
            binDir.mkdirs()
            val abis = Build.SUPPORTED_ABIS ?: emptyArray()
            val isArm64 = abis.any { it.startsWith("arm64") }
            val assetPath = if (isArm64) "needle/android-arm64/needle" else "needle/android-armv7/needle"
            context.assets.open(assetPath).use { input ->
                destFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            destFile.setExecutable(true, false)
            if (destFile.isFile) return destFile
        } catch (_: Throwable) {
        }
    }

    val inModel = File(modelDir, "needle")
    if (inModel.isFile) return inModel

    return File("needle")
}

class WhistleRecognizer(
    private val needleExe: File,
    private val modelFile: File,
    private val language: String?,
    private val tempDir: File,
) : SttRecognizer {

    override fun decode(samples: FloatArray, sampleRate: Int): SttRecognized {
        if (samples.isEmpty()) {
            return SttRecognized(text = "", tokens = emptyList(), timestamps = FloatArray(0))
        }

        val tempWav = File.createTempFile("whistle_chunk_", ".wav", tempDir)
        try {
            writePcm16Wav(tempWav, samples, sampleRate)

            val cmd = mutableListOf(
                needleExe.absolutePath,
                "--model", modelFile.absolutePath,
                "--audio", tempWav.absolutePath,
                "--audio-word-timestamps",
            )
            val lang = parseSupportedLanguage(language)
            if (lang != null) {
                cmd.add("--audio-language")
                cmd.add(lang)
            }

            val processBuilder = ProcessBuilder(cmd)
                .redirectErrorStream(true)
            val env = processBuilder.environment()
            val nativeDir = needleExe.parentFile?.absolutePath
            if (!nativeDir.isNullOrBlank()) {
                val currentLd = env["LD_LIBRARY_PATH"]
                env["LD_LIBRARY_PATH"] = if (currentLd.isNullOrBlank()) nativeDir else "$nativeDir:$currentLd"
            }
            env["TMPDIR"] = tempDir.absolutePath

            val process = processBuilder.start()

            val stdout = process.inputStream.bufferedReader().use { it.readText() }
            val exitCode = process.waitFor()
            if (exitCode != 0) {
                throw IllegalStateException("needle exited with code $exitCode: $stdout")
            }

            return parseWhistleJson(stdout)
        } finally {
            tempWav.delete()
        }
    }

    override fun close() {
    }

    companion object {
        fun parseSupportedLanguage(language: String?): String? {
            val lang = (language ?: "").trim().lowercase().take(2)
            return if (lang in setOf("en", "de", "fr", "es", "it", "nl", "pl")) lang else null
        }

        fun writePcm16Wav(file: File, samples: FloatArray, sampleRate: Int) {
            val pcmBytes = ByteArray(samples.size * 2)
            for (i in samples.indices) {
                val s = (samples[i].coerceIn(-1.0f, 1.0f) * 32767.0f).toInt().toShort()
                pcmBytes[i * 2] = (s.toInt() and 0xFF).toByte()
                pcmBytes[i * 2 + 1] = ((s.toInt() shr 8) and 0xFF).toByte()
            }
            file.outputStream().use { out ->
                val totalDataLen = pcmBytes.size + 36
                val byteRate = sampleRate * 2
                val header = ByteArray(44)
                header[0] = 'R'.code.toByte()
                header[1] = 'I'.code.toByte()
                header[2] = 'F'.code.toByte()
                header[3] = 'F'.code.toByte()
                header[4] = (totalDataLen and 0xff).toByte()
                header[5] = ((totalDataLen shr 8) and 0xff).toByte()
                header[6] = ((totalDataLen shr 16) and 0xff).toByte()
                header[7] = ((totalDataLen shr 24) and 0xff).toByte()
                header[8] = 'W'.code.toByte()
                header[9] = 'A'.code.toByte()
                header[10] = 'V'.code.toByte()
                header[11] = 'E'.code.toByte()
                header[12] = 'f'.code.toByte()
                header[13] = 'm'.code.toByte()
                header[14] = 't'.code.toByte()
                header[15] = ' '.code.toByte()
                header[16] = 16
                header[17] = 0
                header[18] = 0
                header[19] = 0
                header[20] = 1
                header[21] = 0
                header[22] = 1
                header[23] = 0
                header[24] = (sampleRate and 0xff).toByte()
                header[25] = ((sampleRate shr 8) and 0xff).toByte()
                header[26] = ((sampleRate shr 16) and 0xff).toByte()
                header[27] = ((sampleRate shr 24) and 0xff).toByte()
                header[28] = (byteRate and 0xff).toByte()
                header[29] = ((byteRate shr 8) and 0xff).toByte()
                header[30] = ((byteRate shr 16) and 0xff).toByte()
                header[31] = ((byteRate shr 24) and 0xff).toByte()
                header[32] = 2
                header[33] = 0
                header[34] = 16
                header[35] = 0
                header[36] = 'd'.code.toByte()
                header[37] = 'a'.code.toByte()
                header[38] = 't'.code.toByte()
                header[39] = 'a'.code.toByte()
                header[40] = (pcmBytes.size and 0xff).toByte()
                header[41] = ((pcmBytes.size shr 8) and 0xff).toByte()
                header[42] = ((pcmBytes.size shr 16) and 0xff).toByte()
                header[43] = ((pcmBytes.size shr 24) and 0xff).toByte()
                out.write(header)
                out.write(pcmBytes)
            }
        }

        fun parseWhistleJson(rawOutput: String): SttRecognized {
            val jsonStart = rawOutput.indexOf('{')
            val jsonEnd = rawOutput.lastIndexOf('}')
            if (jsonStart == -1 || jsonEnd == -1 || jsonEnd <= jsonStart) {
                return SttRecognized(text = rawOutput.trim(), tokens = emptyList(), timestamps = FloatArray(0))
            }
            val jsonString = rawOutput.substring(jsonStart, jsonEnd + 1)
            val obj = JSONObject(jsonString)
            val text = obj.optString("text", "").trim()
            val wordsArray = obj.optJSONArray("words")
            val tokens = mutableListOf<String>()
            val timestamps = mutableListOf<Float>()
            if (wordsArray != null) {
                for (i in 0 until wordsArray.length()) {
                    val w = wordsArray.optJSONObject(i) ?: continue
                    val word = w.optString("word", "")
                    val start = w.optDouble("start", 0.0).toFloat()
                    if (word.isNotEmpty()) {
                        tokens.add(word)
                        timestamps.add(start)
                    }
                }
            }
            return SttRecognized(
                text = text,
                tokens = tokens,
                timestamps = timestamps.toFloatArray(),
            )
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
