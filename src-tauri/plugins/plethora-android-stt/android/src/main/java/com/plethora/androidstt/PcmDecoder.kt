// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Streaming container decode for the STT pipeline: MediaExtractor +
// MediaCodec pull any supported container (MP3/M4B/M4A/Opus/WAV) as PCM16
// at its native sample rate, in bounded-memory chunks (spec: an 8-hour book
// must never be loaded whole; chunk size bounds peak memory).
//
// Typed failure kinds surfaced to Rust: codec_unsupported, drm_protected.

package com.plethora.androidstt

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import java.nio.ByteOrder

/** Decode failure with a stable kind for the Rust error mapper. */
class PcmDecodeException(message: String, val kind: String) : Exception(message) {
    companion object {
        fun unsupported(detail: String) =
            PcmDecodeException("Cannot decode audio: $detail", "codec_unsupported")

        fun drm() =
            PcmDecodeException("DRM-protected audio cannot be transcribed on device", "drm_protected")
    }
}

data class PcmStreamFormat(
    val sampleRate: Int,
    val channelCount: Int,
    val durationMs: Long,
    val mime: String,
)

/**
 * One-shot streaming decoder for a local file. [probeFormat] and [decode]
 * each open their own extractor so a probe never disturbs a later decode.
 * Implements [AudioSource] so the job manager can fake it in JVM tests.
 */
class PcmDecoder(private val filePath: String) : AudioSource {

    override fun probeFormat(): PcmStreamFormat {
        val extractor = MediaExtractor()
        try {
            setDataSource(extractor)
            val track = selectAudioTrack(extractor)
                ?: throw PcmDecodeException.unsupported("no audio track in $filePath")
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME)
                ?: throw PcmDecodeException.unsupported("track $track has no mime")
            val rate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } else 0
            val channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            } else 1
            val durationMs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
                format.getLong(MediaFormat.KEY_DURATION) / 1000
            } else 0L
            if (rate <= 0 || channels <= 0) {
                throw PcmDecodeException.unsupported("unusable track format (rate=$rate channels=$channels)")
            }
            return PcmStreamFormat(rate, channels, durationMs, mime)
        } finally {
            try {
                extractor.release()
            } catch (_: Throwable) {
            }
        }
    }

    /**
     * Stream PCM16 chunks from [startMs] to end of file. [onChunk] receives
     * mono-mixed-interleaved-untouched native PCM (channels as encoded) with
     * the chunk's presentation time; returning false stops decoding promptly
     * (cancellation). Returns the last presentation time processed in µs.
     */
    override fun decode(
        startMs: Long,
        maxChunkSamples: Int,
        onChunk: (samples: ShortArray, presentationUs: Long) -> Boolean,
    ): Long {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            setDataSource(extractor)
            val track = selectAudioTrack(extractor)
                ?: throw PcmDecodeException.unsupported("no audio track in $filePath")
            extractor.selectTrack(track)
            if (startMs > 0) {
                extractor.seekTo(startMs * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            }
            val srcFormat = extractor.getTrackFormat(track)
            val mime = srcFormat.getString(MediaFormat.KEY_MIME)
                ?: throw PcmDecodeException.unsupported("track $track has no mime")
            // Request 16-bit PCM output explicitly (API 24+); decoders default
            // to it but float output would silently corrupt our short reads.
            val decodeFormat = MediaFormat(srcFormat)
            decodeFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            codec = try {
                MediaCodec.createDecoderByType(mime)
            } catch (e: Exception) {
                throw PcmDecodeException.unsupported("no decoder for $mime (${e.message})")
            }
            codec.configure(decodeFormat, null, null, 0)
            codec.start()

            val bufferInfo = MediaCodec.BufferInfo()
            val pending = ArrayList<Short>(maxChunkSamples * 2)
            var chunkStartUs = -1L
            var inputDone = false
            var outputDone = false
            var lastUs = startMs * 1000
            var cancelled = false
            var stalled = 0

            while (!outputDone && !cancelled) {
                var progressed = false

                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
                    if (inIdx >= 0) {
                        progressed = true
                        val buf = codec.getInputBuffer(inIdx)!!
                        buf.clear()
                        val size = extractor.readSampleData(buf, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime
                            codec.queueInputBuffer(inIdx, 0, size, pts, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIdx = codec.dequeueOutputBuffer(bufferInfo, DEQUEUE_TIMEOUT_US)
                when {
                    outIdx >= 0 -> {
                        progressed = true
                        if (bufferInfo.size > 0 &&
                            bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM == 0
                        ) {
                            val out = codec.getOutputBuffer(outIdx)!!
                            out.order(ByteOrder.nativeOrder())
                            out.position(bufferInfo.offset)
                            out.limit(bufferInfo.offset + bufferInfo.size)
                            if (chunkStartUs < 0) chunkStartUs = bufferInfo.presentationTimeUs
                            while (out.remaining() >= 2) {
                                pending.add(out.short)
                            }
                            lastUs = bufferInfo.presentationTimeUs
                            if (pending.size >= maxChunkSamples) {
                                cancelled = !onChunk(pending.toShortArray(), chunkStartUs)
                                pending.clear()
                                chunkStartUs = -1
                            }
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            outputDone = true
                        }
                    }
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> progressed = true
                    else -> Unit // TRY_AGAIN_LATER
                }

                if (progressed) {
                    stalled = 0
                } else if (++stalled > MAX_STALLED_LOOPS) {
                    throw PcmDecodeException.unsupported("decoder stalled on $filePath")
                }
            }

            if (!cancelled && pending.isNotEmpty()) {
                cancelled = !onChunk(pending.toShortArray(), chunkStartUs)
                pending.clear()
            }
            return lastUs
        } finally {
            try {
                codec?.stop()
            } catch (_: Throwable) {
            }
            try {
                codec?.release()
            } catch (_: Throwable) {
            }
            try {
                extractor.release()
            } catch (_: Throwable) {
            }
        }
    }

    private fun setDataSource(extractor: MediaExtractor) {
        try {
            extractor.setDataSource(filePath)
        } catch (e: Exception) {
            throw PcmDecodeException.unsupported("cannot open $filePath (${e.message})")
        }
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                if (extractor.drmInitData != null) throw PcmDecodeException.drm()
            } catch (e: PcmDecodeException) {
                throw e
            } catch (_: Throwable) {
                // drmInitData access failed; let decoding surface problems.
            }
        }
    }

    private fun selectAudioTrack(extractor: MediaExtractor): Int? {
        for (track in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) return track
        }
        return null
    }

    companion object {
        private const val DEQUEUE_TIMEOUT_US = 10_000L

        /** Consecutive empty dequeue rounds before giving up (~10 s). */
        private const val MAX_STALLED_LOOPS = 1_000
    }
}
