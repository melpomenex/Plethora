// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// JVM tests for the STT job state machine: transitions, cancel mid-stream,
// resume-from-offset trimming, and the segment cursor contract Rust polls
// against. All collaborators are fakes; nothing Android touches this.

package com.plethora.androidstt

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SttJobManagerTest {

    @get:Rule
    val tmp = TemporaryFolder()

    // --- fakes ---

    private class FakeAudioSource(
        private val format: PcmStreamFormat,
        private val chunks: List<Pair<Long, ShortArray>>, // (presentationUs, samples)
        private val interChunkDelayMs: Long = 0,
    ) : AudioSource {
        var decodeStartedMs: Long = -1
        var observedMaxChunk = 0

        override fun probeFormat(): PcmStreamFormat = format

        override fun decode(
            startMs: Long,
            maxChunkSamples: Int,
            onChunk: (ShortArray, Long) -> Boolean,
        ): Long {
            decodeStartedMs = startMs
            observedMaxChunk = maxChunkSamples
            var lastUs = startMs * 1000
            for ((us, samples) in chunks) {
                if (us < startMs * 1000) continue
                lastUs = us
                if (!onChunk(samples, us)) return lastUs
                if (interChunkDelayMs > 0) Thread.sleep(interChunkDelayMs)
            }
            return lastUs
        }
    }

    private class FakeRecognizer : SttRecognizer {
        val calls = ArrayList<FloatArray>()
        var reply: (FloatArray) -> SttRecognized = { samples ->
            SttRecognized("text-${calls.size}", listOf("text"), floatArrayOf(samples.size / 16000f))
        }
        var closed = false

        override fun decode(samples: FloatArray, sampleRate: Int): SttRecognized {
            calls.add(samples)
            return reply(samples)
        }

        override fun close() {
            closed = true
        }
    }

    /** Emits one utterance per accept() covering the whole chunk. */
    private class FakeSegmenter(private val baseOffset: Long) : SpeechSegmenter {
        var totalSamples = 0L
        var acceptedChunks = 0

        override fun accept(samples: FloatArray): List<SttUtterance> {
            acceptedChunks++
            val start = baseOffset + totalSamples
            totalSamples += samples.size
            return listOf(SttUtterance(start, samples))
        }

        override fun flush(): List<SttUtterance> = emptyList()
    }

    private class FakeStore(private val readyIds: Set<String>) : SttModelStore {
        override fun isReady(manifest: SttModelManifest) = manifest.id in readyIds
        override fun modelDir(modelId: String): File = File("/unused/$modelId")
    }

    // --- helpers ---

    private fun manager(
        source: AudioSource,
        recognizer: FakeRecognizer,
        baseOffsetRef: (Long) -> SpeechSegmenter = { FakeSegmenter(it) },
        hooks: SttServiceHooks = SttServiceHooks(),
        store: SttModelStore = FakeStore(setOf(SttModelRegistry.SENSE_VOICE_MULTI.id)),
        threadFactory: (Runnable) -> Thread = { Thread(it) },
    ): SttJobManager = SttJobManager(
        models = store,
        recognizerFactory = { _, _, _, _ -> recognizer },
        segmenterFactory = baseOffsetRef,
        audioSourceFactory = { source },
        serviceHooks = hooks,
        threadFactory = threadFactory,
    )

    private var fileCounter = 0

    private fun audioFile(): File =
        tmp.newFile("book-${fileCounter++}.m4b").apply { writeBytes(ByteArray(16) { 1 }) }

    private fun awaitTerminal(manager: SttJobManager, jobId: String, timeoutMs: Long = 5000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val state = manager.status(jobId, 0)?.state
            if (state == SttJobState.COMPLETED || state == SttJobState.FAILED ||
                state == SttJobState.CANCELLED
            ) {
                return
            }
            Thread.sleep(10)
        }
        throw AssertionError("job did not reach a terminal state")
    }

    // --- tests ---

    @Test
    fun `job runs to completion with timed segments and cursor semantics`() {
        val rate = 16000
        val chunk1 = ShortArray(rate) { (it % 100).toShort() } // 1 s
        val chunk2 = ShortArray(rate) { ((it + 50) % 100).toShort() } // 1 s
        val source = FakeAudioSource(
            PcmStreamFormat(rate, 1, 2_000, "audio/mp4a-latm"),
            listOf(0L to chunk1, 1_000_000L to chunk2),
        )
        val recognizer = FakeRecognizer()
        val manager = manager(source, recognizer)

        manager.start(
            SttJobInfo("job-1", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-1")

        val snapshot = manager.status("job-1", 0)!!
        assertEquals(SttJobState.COMPLETED, snapshot.state)
        assertEquals(100, snapshot.progressPercent)
        assertEquals(2, snapshot.segments.size)
        assertEquals(0, snapshot.segments[0].index)
        assertEquals(1, snapshot.segments[1].index)
        // Segment spans are absolute milliseconds from stream start.
        assertEquals(0L, snapshot.segments[0].startMs)
        assertEquals(1000L, snapshot.segments[0].endMs)
        assertEquals(1000L, snapshot.segments[1].startMs)
        assertTrue(snapshot.segments[0].wordTimingsJson!!.contains("\"w\""))

        // Cursor: asking again with the returned cursor yields nothing new.
        val tail = manager.status("job-1", snapshot.nextCursor)!!
        assertTrue(tail.segments.isEmpty())
        assertEquals(snapshot.nextCursor, tail.nextCursor)

        // A stale cursor replays history (Rust retry semantics).
        val replay = manager.status("job-1", 1)!!
        assertEquals(1, replay.segments.size)
        assertTrue(recognizer.closed)
    }

    @Test
    fun `start rejects when a job is already running`() {
        val latch = CountDownLatch(1)
        val source = object : AudioSource {
            override fun probeFormat(): PcmStreamFormat =
                PcmStreamFormat(16000, 1, 60_000, "audio/mp4a-latm")

            override fun decode(
                startMs: Long,
                maxChunkSamples: Int,
                onChunk: (ShortArray, Long) -> Boolean,
            ): Long {
                latch.await(5, TimeUnit.SECONDS)
                return startMs * 1000
            }
        }
        val manager = manager(source, FakeRecognizer())
        manager.start(
            SttJobInfo("job-a", audioFile().absolutePath, "A", null,
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        try {
            val err = runCatching {
                manager.start(
                    SttJobInfo("job-b", audioFile().absolutePath, "B", null,
                        SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
                )
            }.exceptionOrNull()
            assertNotNull(err)
            assertEquals("job_running", (err as SttPluginException).kind)
        } finally {
            latch.countDown()
        }
        awaitTerminal(manager, "job-a")
    }

    @Test
    fun `start rejects unknown or unready models`() {
        val manager = manager(
            FakeAudioSource(PcmStreamFormat(16000, 1, 1000, "audio/x"), emptyList()),
            FakeRecognizer(),
            store = FakeStore(emptySet()),
        )
        val unknown = runCatching {
            manager.start(
                SttJobInfo("j", audioFile().absolutePath, "T", null,
                    "no-such-model", SttPacing.CAPPED, 0),
            )
        }.exceptionOrNull() as SttPluginException
        assertEquals("model_not_ready", unknown.kind)

        val unready = runCatching {
            manager.start(
                SttJobInfo("j", audioFile().absolutePath, "T", null,
                    SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
            )
        }.exceptionOrNull() as SttPluginException
        assertEquals("model_not_ready", unready.kind)
    }

    @Test
    fun `cancel mid stream keeps completed segments`() {
        val rate = 16000
        val chunk = ShortArray(rate) { (it % 100).toShort() }
        val source = FakeAudioSource(
            PcmStreamFormat(rate, 1, 10_000, "audio/mp4a-latm"),
            (0 until 10).map { (it * 1_000_000L) to chunk.copyOf() },
            // Pace the worker so the test can observe a segment and cancel
            // before the whole stream completes.
            interChunkDelayMs = 40,
        )
        val recognizer = FakeRecognizer()
        val manager = manager(source, recognizer)

        manager.start(
            SttJobInfo("job-c", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        // Wait for the first segment, then cancel.
        val deadline = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < deadline) {
            if ((manager.status("job-c", 0)?.totalSegments ?: 0) >= 1) break
            Thread.sleep(5)
        }
        manager.cancel()
        awaitTerminal(manager, "job-c")

        val snapshot = manager.status("job-c", 0)!!
        assertEquals(SttJobState.CANCELLED, snapshot.state)
        assertTrue("segments preserved", snapshot.totalSegments >= 1)
        assertTrue(recognizer.closed)
    }

    @Test
    fun `resume from offset seeks and trims before the checkpoint`() {
        val rate = 48000 // force a real resample pass too
        val chunkFrames = 4800 // 100 ms
        val chunk = ShortArray(chunkFrames) { (it % 97).toShort() }
        val chunks = (0 until 20).map { (it * 100_000L) to chunk.copyOf() } // 0..2 s
        val source = FakeAudioSource(
            PcmStreamFormat(rate, 1, 2_000, "audio/mp4a-latm"),
            chunks,
        )
        val recognizer = FakeRecognizer()
        val manager = manager(source, recognizer)

        val resumeFromMs = 1_000L
        manager.start(
            SttJobInfo("job-r", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, resumeFromMs),
        )
        awaitTerminal(manager, "job-r")

        // The decoder must have been told to start at the checkpoint.
        assertEquals(resumeFromMs, source.decodeStartedMs)

        val snapshot = manager.status("job-r", 0)!!
        assertEquals(SttJobState.COMPLETED, snapshot.state)
        assertTrue("segments: ${snapshot.segments}", snapshot.segments.isNotEmpty())
        // Nothing before the checkpoint may be recognized: the fake segmenter
        // emitted utterances only for trimmed 16 kHz output, rebased at the
        // resume offset.
        for (segment in snapshot.segments) {
            assertTrue("segment started at ${segment.startMs}", segment.startMs >= resumeFromMs - 5)
        }
    }

    @Test
    fun `decode failure maps to a typed error and keeps prior segments`() {
        val chunk = ShortArray(16000) { 1 }
        val source = FakeAudioSource(
            PcmStreamFormat(16000, 1, 2_000, "audio/mp4a-latm"),
            listOf(0L to chunk),
        )
        val recognizer = FakeRecognizer().apply {
            reply = { throw IllegalStateException("engine exploded") }
        }
        val manager = manager(source, recognizer)
        manager.start(
            SttJobInfo("job-f", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-f")
        val snapshot = manager.status("job-f", 0)!!
        assertEquals(SttJobState.FAILED, snapshot.state)
        assertEquals("inference_failed", snapshot.errorKind)
        assertTrue(snapshot.errorMessage!!.contains("engine exploded"))
    }

    @Test
    fun `codec errors carry their typed kind`() {
        val failing = object : AudioSource {
            override fun probeFormat(): PcmStreamFormat =
                throw PcmDecodeException.unsupported("no decoder for audio/exotic")

            override fun decode(
                startMs: Long,
                maxChunkSamples: Int,
                onChunk: (ShortArray, Long) -> Boolean,
            ): Long = 0
        }
        val manager = manager(failing, FakeRecognizer())
        manager.start(
            SttJobInfo("job-x", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-x")
        val snapshot = manager.status("job-x", 0)!!
        assertEquals(SttJobState.FAILED, snapshot.state)
        assertEquals("codec_unsupported", snapshot.errorKind)
    }

    @Test
    fun `empty recognition results produce no segments`() {
        val chunk = ShortArray(16000) { (it % 80).toShort() }
        val source = FakeAudioSource(
            PcmStreamFormat(16000, 1, 1_000, "audio/mp4a-latm"),
            listOf(0L to chunk),
        )
        val recognizer = FakeRecognizer().apply {
            reply = { SttRecognized("", emptyList(), FloatArray(0)) }
        }
        val manager = manager(source, recognizer)
        manager.start(
            SttJobInfo("job-e", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-e")
        val snapshot = manager.status("job-e", 0)!!
        assertEquals(SttJobState.COMPLETED, snapshot.state)
        assertEquals(0, snapshot.segments.size)
        assertEquals(0, snapshot.nextCursor)
        assertNull(snapshot.errorKind)
    }

    @Test
    fun `stereo input is downmixed before recognition`() {
        val frames = 16000
        val stereo = ShortArray(frames * 2) { (it / 2 % 60).toShort() }
        val source = FakeAudioSource(
            PcmStreamFormat(16000, 2, 1_000, "audio/mp4a-latm"),
            listOf(0L to stereo),
        )
        val recognizer = FakeRecognizer()
        val manager = manager(source, recognizer)
        manager.start(
            SttJobInfo("job-s", audioFile().absolutePath, "Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-s")
        assertEquals(1, recognizer.calls.size)
        assertEquals(frames, recognizer.calls[0].size)
    }

    @Test
    fun `service hooks observe start progress and finish`() {
        val events = ArrayList<String>()
        val hooks = object : SttServiceHooks() {
            override fun onJobStarted(info: SttJobInfo) {
                events.add("started:${info.title}:${info.pacing.serial}")
            }

            override fun onProgress(info: SttJobInfo, percent: Int, decodeOffsetMs: Long) {
                events.add("progress")
            }

            override fun onJobFinished(info: SttJobInfo, state: SttJobState) {
                events.add("finished:${state.serial}")
            }
        }
        val chunk = ShortArray(16000) { 1 }
        val source = FakeAudioSource(
            PcmStreamFormat(16000, 1, 1_000, "audio/mp4a-latm"),
            listOf(0L to chunk),
        )
        val manager = manager(source, FakeRecognizer(), hooks = hooks)
        manager.start(
            SttJobInfo("job-h", audioFile().absolutePath, "My Book", "en",
                SttModelRegistry.SENSE_VOICE_MULTI.id, SttPacing.CAPPED, 0),
        )
        awaitTerminal(manager, "job-h")
        assertTrue(events.first(), events.first() == "started:My Book:capped")
        assertTrue(events.last(), events.last() == "finished:completed")
        assertTrue(events.any { it == "progress" })
    }
}
