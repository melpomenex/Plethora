// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// On-device STT job state machine: startJob → decode (MediaCodec, streamed)
// → downmix/resample to 16 kHz mono → VAD segmentation → per-utterance
// recognition → buffered timed segments. Rust polls jobStatus(cursor) and
// persists segments as they appear; cancel stops promptly and keeps all
// completed output (design.md D2/D5).
//
// The audio source, recognizer, and segmenter are injected interfaces so the
// whole machine is JVM-testable with fakes; only PcmDecoder, Sherpa*, and
// MediaCodec touch Android.

package com.plethora.androidstt

import java.io.File
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.min

enum class SttJobState(val serial: String) {
    RUNNING("running"),
    COMPLETED("completed"),
    CANCELLED("cancelled"),
    FAILED("failed");

    companion object {
        fun fromSerial(value: String): SttJobState? = entries.firstOrNull { it.serial == value }
    }
}

/** Thermal pacing modes (spec: capped default keeps sustained draw low). */
enum class SttPacing(val serial: String, val threads: Int) {
    CAPPED("capped", 2),
    FULL("full", 4);

    companion object {
        fun fromSerial(value: String?): SttPacing =
            entries.firstOrNull { it.serial == value } ?: CAPPED
    }
}

/** One timed segment, in absolute stream milliseconds. */
data class SttSegment(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val text: String,
    /** Token/word timings in JSON (absolute ms), when the model produced them. */
    val wordTimingsJson: String?,
)

class SttJobInfo(
    val jobId: String,
    val sourcePath: String,
    val title: String,
    val language: String?,
    val modelId: String,
    val pacing: SttPacing,
    val resumeFromMs: Long,
)

class SttJobSnapshot(
    val jobId: String,
    val state: SttJobState,
    val progressPercent: Int,
    val decodeOffsetMs: Long,
    val durationMs: Long,
    val totalSegments: Int,
    val segments: List<SttSegment>,
    val nextCursor: Int,
    val errorKind: String?,
    val errorMessage: String?,
)

/** Decode interface implemented by PcmDecoder; faked in JVM tests. */
interface AudioSource {
    fun probeFormat(): PcmStreamFormat
    fun decode(
        startMs: Long,
        maxChunkSamples: Int,
        onChunk: (samples: ShortArray, presentationUs: Long) -> Boolean,
    ): Long
}

/** Hooks the foreground service uses to mirror job state into the notification. */
open class SttServiceHooks {
    open fun onJobStarted(info: SttJobInfo) {}
    open fun onProgress(info: SttJobInfo, percent: Int, decodeOffsetMs: Long) {}
    open fun onJobFinished(info: SttJobInfo, state: SttJobState) {}
}

/** Model storage surface the job manager needs; SttModelManager implements it. */
interface SttModelStore {
    fun isReady(manifest: SttModelManifest): Boolean
    fun modelDir(modelId: String): File
}

/**
 * Runs at most one job at a time; the previous job's terminal snapshot stays
 * readable (Rust keeps polling until it observes a terminal state).
 */
class SttJobManager(
    private val models: SttModelStore,
    private val recognizerFactory: SttRecognizerFactory,
    private val segmenterFactory: (baseSampleOffset: Long) -> SpeechSegmenter,
    private val audioSourceFactory: (String) -> AudioSource = { PcmDecoder(it) },
    private val serviceHooks: SttServiceHooks = SttServiceHooks(),
    private val threadFactory: (Runnable) -> Thread = { r ->
        Thread(r, "plethora-stt-job").apply { isDaemon = true }
    },
) {

    private val lock = ReentrantLock()

    private var job: SttJobInfo? = null
    private var state: SttJobState = SttJobState.COMPLETED
    private var progressPercent: Int = 0
    private var decodeOffsetMs: Long = 0
    private var durationMs: Long = 0
    private var errorKind: String? = null
    private var errorMessage: String? = null
    private val segments = Collections.synchronizedList(ArrayList<SttSegment>())

    private val cancelled = AtomicBoolean(false)
    private val timeout = AtomicBoolean(false)
    private var worker: Thread? = null

    val currentJobId: String? get() = lock.withLock { job?.jobId }
    val currentState: SttJobState get() = lock.withLock { state }

    /**
     * Validate and launch a job. Rejects when a job is already running or the
     * model is not ready; throws [SttPluginException] with a typed kind.
     */
    fun start(info: SttJobInfo) {
        lock.withLock {
            if (state == SttJobState.RUNNING) {
                throw SttPluginException("A transcription job is already running", "job_running")
            }
            val manifest = SttModelRegistry.byId(info.modelId)
                ?: throw SttPluginException("Unknown model ${info.modelId}", "model_not_ready")
            if (!models.isReady(manifest)) {
                throw SttPluginException("Model ${info.modelId} is not downloaded", "model_not_ready")
            }
            if (!File(info.sourcePath).isFile) {
                throw SttPluginException("Audio file not found: ${info.sourcePath}", "not_found")
            }
            job = info
            state = SttJobState.RUNNING
            progressPercent = 0
            decodeOffsetMs = info.resumeFromMs
            durationMs = 0
            errorKind = null
            errorMessage = null
            segments.clear()
            cancelled.set(false)
        }
        serviceHooks.onJobStarted(info)
        worker = threadFactory(Runnable { runJob(info) })
        worker?.start()
    }

    /** Request prompt cancellation; completed segments are preserved. */
    fun cancel() {
        cancelled.set(true)
    }

    /**
     * Graceful stop for the FGS runtime timeout (API 35+ mediaProcessing
     * 6 h/24 h cap): the job ends FAILED with kind `service_timeout` so the
     * orchestrator leaves a resumable checkpoint instead of a hard failure.
     */
    fun cancelForTimeout() {
        timeout.set(true)
        cancelled.set(true)
    }

    /**
     * Snapshot job state; [cursor] is the number of segments the caller has
     * already consumed, so only newer segments are returned.
     */
    fun status(jobId: String?, cursor: Int): SttJobSnapshot? {
        lock.withLock {
            val current = job ?: return null
            if (jobId != null && current.jobId != jobId) return null
            val all = synchronized(segments) { segments.toList() }
            return SttJobSnapshot(
                jobId = current.jobId,
                state = state,
                progressPercent = if (state == SttJobState.COMPLETED) 100 else progressPercent,
                decodeOffsetMs = decodeOffsetMs,
                durationMs = durationMs,
                totalSegments = all.size,
                segments = all.drop(cursor),
                nextCursor = all.size,
                errorKind = errorKind,
                errorMessage = errorMessage,
            )
        }
    }

    // --- pipeline ---

    private fun runJob(info: SttJobInfo) {
        var recognizer: SttRecognizer? = null
        try {
            val manifest = SttModelRegistry.byId(info.modelId)!!
            val source = audioSourceFactory(info.sourcePath)
            val format = source.probeFormat()
            lock.withLock { durationMs = format.durationMs }

            val resampler = StreamingResampler(format.sampleRate, PcmConvert.TARGET_RATE)
            val segmenter = segmenterFactory(info.resumeFromMs * PcmConvert.TARGET_RATE / 1000)
            recognizer = recognizerFactory.open(
                manifest,
                models.modelDir(manifest.id),
                info.language,
                info.pacing.threads,
            )

            var trimUntilUs = info.resumeFromMs * 1000
            var nextIndex = 0

            source.decode(info.resumeFromMs, MAX_CHUNK_SAMPLES) { raw, presentationUs ->
                var samples = raw
                var chunkUs = presentationUs
                // Exact resume boundary: drop pre-checkpoint samples after the
                // keyframe seek so no audio is decoded twice.
                if (trimUntilUs > 0 && chunkUs < trimUntilUs) {
                    val skipSamples =
                        ((trimUntilUs - chunkUs) * format.sampleRate / 1_000_000L).toInt()
                    when {
                        skipSamples >= samples.size -> return@decode true
                        else -> {
                            samples = samples.copyOfRange(skipSamples, samples.size)
                            chunkUs += skipSamples * 1_000_000L / format.sampleRate
                            trimUntilUs = 0
                        }
                    }
                } else if (chunkUs >= trimUntilUs) {
                    trimUntilUs = 0
                }

                val mono = PcmConvert.downmixToMono(samples, format.channelCount)
                val floats = PcmConvert.toFloats(mono)
                val out16k = resampler.push(floats)
                if (out16k.isNotEmpty()) {
                    for (utterance in segmenter.accept(out16k)) {
                        nextIndex = processUtterance(recognizer, utterance, nextIndex)
                    }
                }
                lock.withLock { decodeOffsetMs = chunkUs / 1000 }
                pushProgress(info)
                !cancelled.get()
            }

            if (cancelled.get()) {
                if (timeout.get()) {
                    finish(info, SttJobState.FAILED, "service_timeout",
                        "foreground service timeout; retry to resume from checkpoint")
                } else {
                    finish(info, SttJobState.CANCELLED, null, null)
                }
                return
            }

            val tail = resampler.flush()
            if (tail.isNotEmpty()) {
                for (utterance in segmenter.accept(tail)) {
                    nextIndex = processUtterance(recognizer, utterance, nextIndex)
                }
            }
            for (utterance in segmenter.flush()) {
                nextIndex = processUtterance(recognizer, utterance, nextIndex)
            }

            finish(info, SttJobState.COMPLETED, null, null)
        } catch (e: PcmDecodeException) {
            finish(info, SttJobState.FAILED, e.kind, e.message)
        } catch (e: Throwable) {
            finish(info, SttJobState.FAILED, "inference_failed", e.message)
        } finally {
            try {
                recognizer?.close()
            } catch (_: Throwable) {
            }
        }
    }

    /**
     * Recognize one utterance, splitting defensively at the decode ceiling,
     * and append non-empty timed segments. Returns the next segment index.
     */
    private fun processUtterance(
        recognizer: SttRecognizer,
        utterance: SttUtterance,
        startIndex: Int,
    ): Int {
        var index = startIndex
        val maxSamples = (SherpaVadSegmenter.MAX_SPEECH_SECONDS * PcmConvert.TARGET_RATE).toInt()
        var offset = 0
        while (offset < utterance.samples.size) {
            if (cancelled.get()) return index
            val len = min(maxSamples, utterance.samples.size - offset)
            val piece = utterance.samples.copyOfRange(offset, offset + len)
            val recognized = try {
                recognizer.decode(piece, PcmConvert.TARGET_RATE)
            } catch (e: Throwable) {
                throw IllegalStateException("recognition failed: ${e.message}", e)
            }
            val text = recognized.text.trim()
            if (text.isNotEmpty()) {
                val startMs = (utterance.startSample + offset) * 1000 / PcmConvert.TARGET_RATE
                val vadEndMs =
                    (utterance.startSample + offset + len) * 1000 / PcmConvert.TARGET_RATE
                // Word timestamps when the model returns them; VAD boundary
                // otherwise (design.md D4 fallback).
                val tokenEndMs = startMs + (recognized.lastTokenSeconds * 1000f).toLong()
                val endMs = if (recognized.lastTokenSeconds > 0f) tokenEndMs else vadEndMs
                segments.add(
                    SttSegment(
                        index = index,
                        startMs = startMs,
                        endMs = maxOf(endMs, startMs + 1),
                        text = text,
                        wordTimingsJson = buildWordTimings(recognized, utterance.startSample + offset),
                    )
                )
                index++
            }
            offset += len
        }
        return index
    }

    private fun buildWordTimings(recognized: SttRecognized, startSample: Long): String? {
        if (recognized.timestamps.isEmpty()) return null
        val sb = StringBuilder("[")
        var first = true
        for (i in recognized.tokens.indices) {
            if (i >= recognized.timestamps.size) break
            val token = recognized.tokens[i]
            // Skip SenseVoice/CTC markup tags; strip the sentencepiece marker.
            if (token.isEmpty() || token.startsWith("<|")) continue
            val word = token.trimStart('▁')
            if (word.isEmpty()) continue
            val atMs = startSample * 1000 / PcmConvert.TARGET_RATE +
                (recognized.timestamps[i] * 1000f).toLong()
            if (!first) sb.append(',')
            sb.append("{\"w\":\"").append(word.replace("\"", "\\\""))
                .append("\",\"t\":").append(atMs).append('}')
            first = false
        }
        sb.append(']')
        return if (first) null else sb.toString()
    }

    private fun pushProgress(info: SttJobInfo) {
        val (percent, offset) = lock.withLock {
            val p = progressPercentInternal()
            progressPercent = p
            p to decodeOffsetMs
        }
        serviceHooks.onProgress(info, percent, offset)
    }

    private fun progressPercentInternal(): Int {
        if (durationMs <= 0) return 0
        val raw = (decodeOffsetMs * 100 / durationMs).toInt()
        return raw.coerceIn(0, 99)
    }

    private fun finish(info: SttJobInfo, finalState: SttJobState, kind: String?, message: String?) {
        lock.withLock {
            state = finalState
            errorKind = kind
            errorMessage = message
        }
        serviceHooks.onJobFinished(info, finalState)
    }

    companion object {
        /** Decode chunk ceiling in frames (~0.2 s at 48 kHz) — bounds memory. */
        const val MAX_CHUNK_SAMPLES = 9_600
    }
}

/** Typed plugin error: kind is surfaced to Rust for the queue UI mapper. */
class SttPluginException(message: String, val kind: String) : Exception(message)
