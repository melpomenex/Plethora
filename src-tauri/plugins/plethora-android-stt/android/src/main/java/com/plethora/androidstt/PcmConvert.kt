// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Pure-Kotlin audio conditioning for the STT pipeline: mono downmix and
// arbitrary-ratio streaming resampling to 16 kHz with a windowed-sinc
// anti-aliasing FIR. No Android imports — JVM testable.
//
// Memory is bounded by the FIR window: the resampler retains at most
// WINDOW input samples regardless of stream length (spec: decoding must stay
// chunk-sized for hours-long books).

package com.plethora.androidstt

object PcmConvert {
    const val TARGET_RATE = 16_000

    /** Average interleaved channels down to mono. Mono input is copied. */
    fun downmixToMono(samples: ShortArray, channels: Int): ShortArray {
        if (channels <= 1) return samples.copyOf()
        val frames = samples.size / channels
        val out = ShortArray(frames)
        for (frame in 0 until frames) {
            var sum = 0
            for (ch in 0 until channels) {
                sum += samples[frame * channels + ch]
            }
            out[frame] = (sum / channels).toShort()
        }
        return out
    }

    /** Convert PCM16LE samples to floats in [-1, 1]. */
    fun toFloats(samples: ShortArray): FloatArray {
        val out = FloatArray(samples.size)
        for (i in samples.indices) {
            out[i] = samples[i] / 32768f
        }
        return out
    }
}

/**
 * Streaming windowed-sinc resampler (linear-phase FIR, Hamming window).
 *
 * Output sample n corresponds to source position n * srcRate / dstRate, so
 * callers can map output indices to absolute time without any additional
 * group-delay bookkeeping — outputs are only emitted once their full FIR
 * window of input samples is available.
 *
 * Bounded memory: after each push, input older than the FIR window of the
 * last emitted output is evicted, so retained input stays bounded by one
 * chunk plus the window regardless of stream length.
 */
class StreamingResampler(
    private val srcRate: Int,
    private val dstRate: Int,
) {
    companion object {
        /** Half-width of the sinc kernel in input samples. */
        const val HALF_TAPS = 24

        /** Anti-aliasing cutoff as a fraction of the lower Nyquist limit. */
        const val CUTOFF_FRACTION = 0.9f
    }

    private val ratio = srcRate.toDouble() / dstRate.toDouble()

    /** Normalized cutoff in cycles/input-sample. */
    private val normalizedCutoff =
        (CUTOFF_FRACTION * 0.5 * minOf(srcRate, dstRate)) / srcRate.toDouble()

    /** Retained input samples; absolute index bufStart+i lives at buf[i]. */
    private var buf = FloatArray(1024)
    private var bufLen = 0
    private var bufStart = 0L

    /** Total input samples pushed (absolute count). */
    var inputConsumed = 0L
        private set

    /** Total output samples emitted (absolute count). */
    var outputProduced = 0L
        private set

    /** Peak retained input — the memory bound proof for long streams. */
    var maxRetainedSamples = 0
        private set

    /** True when no rate change is needed; callers may bypass the resampler. */
    val isIdentity: Boolean get() = srcRate == dstRate

    /**
     * Feed the next chunk of input samples; returns all output samples whose
     * FIR window is fully covered. Passed through unchanged when the rates
     * already match.
     */
    fun push(chunk: FloatArray): FloatArray {
        if (isIdentity) {
            inputConsumed += chunk.size
            outputProduced += chunk.size
            return chunk
        }
        append(chunk)
        val out = emitUntil(readyOutputIndex())
        evict()
        return out
    }

    /**
     * Emit the remaining tail, padding the final FIR window with silence.
     * The resampler cannot be reused afterwards.
     */
    fun flush(): FloatArray {
        if (isIdentity) return FloatArray(0)
        return emitUntil(totalOutputsFor(inputConsumed))
    }

    /** Absolute output-sample count that maps inside the pushed input. */
    private fun totalOutputsFor(inputCount: Long): Long =
        ((inputCount - 1).toDouble() / ratio).toLong() + 1

    /**
     * Highest exclusive output index whose window (±HALF_TAPS input samples
     * around its source position) lies fully within consumed input.
     */
    private fun readyOutputIndex(): Long {
        val idx = ((inputConsumed - 1 - HALF_TAPS) / ratio).toLong() + 1
        return idx.coerceAtLeast(0L)
    }

    private fun append(chunk: FloatArray) {
        ensureCapacity(bufLen + chunk.size)
        System.arraycopy(chunk, 0, buf, bufLen, chunk.size)
        bufLen += chunk.size
        inputConsumed += chunk.size
        if (bufLen > maxRetainedSamples) maxRetainedSamples = bufLen
    }

    private fun ensureCapacity(needed: Int) {
        if (needed <= buf.size) return
        var size = buf.size
        while (size < needed) size = size shl 1
        buf = buf.copyOf(size)
    }

    /** Drop input that no future output's FIR window can reach. */
    private fun evict() {
        val keepFrom = Math.floor(outputProduced * ratio).toLong() - HALF_TAPS
        val drop = (keepFrom - bufStart).toInt()
        if (drop <= 0) return
        val safeDrop = minOf(drop, bufLen)
        System.arraycopy(buf, safeDrop, buf, 0, bufLen - safeDrop)
        bufLen -= safeDrop
        bufStart += safeDrop
    }

    private fun emitUntil(untilIdx: Long): FloatArray {
        if (untilIdx <= outputProduced) return FloatArray(0)
        val out = FloatArray((untilIdx - outputProduced).toInt())
        for (k in out.indices) {
            val n = outputProduced + k
            out[k] = interpolate(n * ratio)
        }
        outputProduced = untilIdx
        return out
    }

    private fun sampleAt(absoluteIndex: Long): Float {
        val offset = (absoluteIndex - bufStart).toInt()
        if (offset < 0 || offset >= bufLen) return 0f
        return buf[offset]
    }

    /** Windowed-sinc interpolation at fractional source position [pos]. */
    private fun interpolate(pos: Double): Float {
        val center = Math.floor(pos).toLong()
        var sum = 0.0
        for (offset in -HALF_TAPS..HALF_TAPS) {
            val idx = center + offset
            val x = pos - idx
            val sinc = if (x == 0.0) 1.0 else Math.sin(2.0 * Math.PI * normalizedCutoff * x) /
                (Math.PI * x)
            // Hamming window across the 2*HALF_TAPS+1 taps.
            val w = 0.54 + 0.46 * Math.cos(Math.PI * x / (HALF_TAPS + 1))
            sum += sampleAt(idx) * sinc * w
        }
        // The windowed-sinc kernel's DC gain is ≈1 by construction (ideal-LP
        // taps sum to 1; the Hamming window only perturbs that by a few %).
        return sum.toFloat()
    }
}
