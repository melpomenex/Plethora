// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// JVM tests for the STT audio conditioning: mono downmix and streaming
// windowed-sinc resampling (44.1 kHz and 48 kHz → 16 kHz) against generated
// tones, plus a long-stream pass proving chunked processing completes with
// the same bounded history (spec: decode memory stays chunk-sized).

package com.plethora.androidstt

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmConvertTest {

    private fun sine(freqHz: Double, rate: Int, seconds: Double, amplitude: Double = 0.5): FloatArray {
        val n = (seconds * rate).toInt()
        val out = FloatArray(n)
        for (i in 0 until n) {
            out[i] = (amplitude * sin(2 * PI * freqHz * i / rate)).toFloat()
        }
        return out
    }

    /** Goertzel magnitude at [freqHz] — cheap single-bin DFT for tone checks. */
    private fun goertzelPower(samples: FloatArray, rate: Int, freqHz: Double): Double {
        val k = 2.0 * cos(2 * PI * freqHz / rate)
        var s0 = 0.0
        var s1 = 0.0
        var s2 = 0.0
        for (x in samples) {
            s0 = x + k * s1 - s2
            s2 = s1
            s1 = s0
        }
        return s1 * s1 + s2 * s2 - k * s1 * s2
    }

    @Test
    fun `stereo downmix averages channels`() {
        val stereo = shortArrayOf(
            1000, -1000, // frame 0 cancels
            1000, 1000, // frame 1 averages to 1000
            -2000, 0, // frame 2 averages to -1000
        )
        val mono = PcmConvert.downmixToMono(stereo, 2)
        assertEquals(3, mono.size.toLong())
        assertEquals(0, mono[0].toInt())
        assertEquals(1000, mono[1].toInt())
        assertEquals(-1000, mono[2].toInt())
    }

    @Test
    fun `mono downmix copies mono input`() {
        val mono = shortArrayOf(7, -7, 100)
        assertEquals(mono.toList(), PcmConvert.downmixToMono(mono, 1).toList())
    }

    @Test
    fun `440 Hz sine at 44100 keeps its frequency at 16000`() {
        val input = sine(440.0, 44100, 2.0)
        val resampler = StreamingResampler(44100, 16000)
        val output = resampler.push(input) + resampler.flush()

        val expected = (2.0 * 16000).toInt()
        assertTrue("output ${output.size}", abs(output.size - expected) < 160)
        val at440 = goertzelPower(output, 16000, 440.0)
        val at600 = goertzelPower(output, 16000, 600.0)
        val at300 = goertzelPower(output, 16000, 300.0)
        assertTrue("440 power $at440 vs 600 $at600", at440 > at600 * 10)
        assertTrue("440 power $at440 vs 300 $at300", at440 > at300 * 10)
    }

    @Test
    fun `48000 to 16000 is exact decimation of a 1 kHz tone`() {
        val input = sine(1000.0, 48000, 1.0)
        val resampler = StreamingResampler(48000, 16000)
        val output = resampler.push(input) + resampler.flush()
        assertEquals(16000, output.size.toLong())
        val at1000 = goertzelPower(output, 16000, 1000.0)
        val at1400 = goertzelPower(output, 16000, 1400.0)
        assertTrue("1000 power $at1000 vs 1400 $at1400", at1000 > at1400 * 20)
        for (sample in output) {
            assertTrue(sample.isFinite())
            assertTrue(abs(sample) <= 1.0f)
        }
    }

    @Test
    fun `resampled sweep stays finite and bounded`() {
        val rate = 48000
        val seconds = 4
        val input = FloatArray(rate * seconds)
        for (i in input.indices) {
            val t = i.toDouble() / rate
            val freq = 100.0 + (2900.0 - 100.0) * t / seconds
            // Phase-integrated sweep so frequency actually slides.
            input[i] = (0.5 * sin(2 * PI * (100.0 * t + (2900.0 - 100.0) * t * t / (2 * seconds)))).toFloat()
        }
        val resampler = StreamingResampler(rate, 16000)
        val output = resampler.push(input) + resampler.flush()
        assertEquals(16000 * seconds.toLong(), output.size.toLong())
        for (sample in output) {
            assertTrue(sample.isFinite())
        }
    }

    @Test
    fun `long stream processes in bounded chunks with constant history`() {
        val rate = 44100
        val chunk = 8192
        val totalChunks = 220 // ~41 s of audio, longer than any buffer a
        // non-streaming implementation would accidentally tolerate.
        val resampler = StreamingResampler(rate, 16000)
        var produced = 0L
        for (c in 0 until totalChunks) {
            val input = FloatArray(chunk) { i ->
                (0.5 * sin(2 * PI * 330.0 * (c * chunk + i) / rate)).toFloat()
            }
            produced += resampler.push(input).size
        }
        produced += resampler.flush().size
        val expected = totalChunks.toLong() * chunk * 16000 / rate
        assertTrue("produced $produced vs $expected", abs(produced - expected) < 320)
        // Memory stays bounded by one chunk plus the FIR window, no matter
        // how long the stream runs (spec: chunk-sized memory for 8 h books).
        val bound = chunk + 2 * StreamingResampler.HALF_TAPS + 100
        assertTrue(
            "retained ${resampler.maxRetainedSamples} > bound $bound",
            resampler.maxRetainedSamples <= bound,
        )
        // And the total input/output counts track each other.
        assertEquals(totalChunks.toLong() * chunk, resampler.inputConsumed)
        assertEquals(produced, resampler.outputProduced)
    }

    @Test
    fun `identity passthrough when rates match`() {
        val resampler = StreamingResampler(16000, 16000)
        val input = floatArrayOf(0.1f, -0.2f, 0.3f)
        assertEquals(input.toList(), resampler.push(input).toList())
        assertTrue(resampler.flush().isEmpty())
    }

    @Test
    fun `toFloats maps pcm16 range`() {
        val floats = PcmConvert.toFloats(shortArrayOf(0, 16384, -16384, Short.MIN_VALUE, Short.MAX_VALUE))
        assertEquals(0.0f, floats[0], 1e-6f)
        assertEquals(0.5f, floats[1], 0.01f)
        assertEquals(-0.5f, floats[2], 0.01f)
        assertTrue(floats[3] <= -0.99f)
        assertTrue(floats[4] >= 0.99f)
    }

    private operator fun FloatArray.plus(other: FloatArray): FloatArray {
        return FloatArray(size + other.size).also {
            System.arraycopy(this, 0, it, 0, size)
            System.arraycopy(other, 0, it, size, other.size)
        }
    }
}
