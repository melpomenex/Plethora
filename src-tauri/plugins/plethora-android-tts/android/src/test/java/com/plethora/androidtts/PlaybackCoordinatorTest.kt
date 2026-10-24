package com.plethora.androidtts

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PlaybackCoordinatorTest {
    private lateinit var context: Context
    @Before fun prepare() {
        context = ApplicationProvider.getApplicationContext()
        android.util.AtomicFile(File(context.filesDir, AudioPlaybackJournal.FILE_NAME)).delete()
    }

    private fun manifest(): JSONObject {
        val samples = 8000 * 2 * 2
        val bytes = ByteBuffer.allocate(44 + samples).order(ByteOrder.LITTLE_ENDIAN)
        bytes.put("RIFF".toByteArray()).putInt(36 + samples).put("WAVEfmt ".toByteArray()).putInt(16)
            .putShort(1).putShort(1).putInt(8000).putInt(16000).putShort(2).putShort(16)
            .put("data".toByteArray()).putInt(samples)
        val audio = File(context.filesDir, "deterministic-two-seconds.wav")
        audio.writeBytes(bytes.array())
        val parts = JSONArray()
        for (index in 0..1) parts.put(JSONObject().put("partId", "part-$index").put("sourceRevision", "fixture-v1").put("nativeUri", audio.toURI().toString()).put("durationSec", 2.0))
        return JSONObject().put("schemaVersion", 1).put("sourceKey", JSONObject().put("profileKey", "test").put("kind", "audiobook").put("sourceId", "book"))
            .put("title", "Deterministic fixture").put("mediaRevision", "fixture-v1").put("parts", parts).put("complete", true)
    }

    private fun queuedManifest(includeReady: Boolean = true): JSONObject {
        val first = manifest()
        val next = manifest().also { it.getJSONObject("sourceKey").put("sourceId", "next-book"); it.put("title", "Next fixture") }
        first.put("queueKeys", JSONArray().put(JSONObject(first.getJSONObject("sourceKey").toString())).put(JSONObject(next.getJSONObject("sourceKey").toString())))
        first.put("queueEntries", if (includeReady) JSONArray().put(next) else JSONArray())
        return first
    }

    @Test fun `prepared queue progresses once without JS and journals the previous source`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(queuedManifest(), "play", requestGeneration = 10)
            owner.selectPart(1, 1.75)
            owner.sourceEnded(10)
            assertEquals("next-book", owner.snapshot()!!.getJSONObject("sourceKey").getString("sourceId"))
            assertEquals(11, owner.snapshot()!!.getInt("generation"))
            assertTrue(owner.snapshot()!!.getBoolean("playIntent"))
            owner.sourceEnded(10)
            assertEquals(11, owner.snapshot()!!.getInt("generation"))
            val journal = owner.dirtyJournal("test")
            assertEquals(2, journal.getJSONObject("session").getJSONArray("queue").length())
            assertFalse(journal.toString().contains("nativeUri"))
            val old = (0 until journal.getJSONArray("checkpoints").length()).map { journal.getJSONArray("checkpoints").getJSONObject(it) }
                .first { it.getJSONObject("sourceKey").getString("sourceId") == "book" }
            assertEquals(1.75, old.getDouble("timeInPart"), 0.001)
        } finally { owner.dispose() }
    }

    @Test fun `unprepared queue boundary stops rather than skipping or invoking JS`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(queuedManifest(false), "play")
            owner.sourceEnded()
            assertEquals("book", owner.snapshot()!!.getJSONObject("sourceKey").getString("sourceId"))
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals("source_missing", owner.snapshot()!!.getJSONObject("error").getString("code"))
        } finally { owner.dispose() }
    }

    @Test fun `sleep wins over queue and paused queue skip is distinct from a chapter`() {
        var time = 1000L
        val owner = PlaybackCoordinator(context, { true }, {}, { time })
        try {
            owner.loadAuthorized(queuedManifest(), "play")
            owner.setSleep(1500)
            time = 1500
            owner.sourceEnded()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals("book", owner.snapshot()!!.getJSONObject("sourceKey").getString("sourceId"))
            val current = owner.snapshot()!!
            val result = owner.command(JSONObject().put("schemaVersion", 1).put("requestId", "queue-next")
                .put("sessionId", current.getJSONObject("metadata").getString("sessionId")).put("generation", current.getLong("generation"))
                .put("action", JSONObject().put("command", "queueNext")))
            assertEquals("accepted", result.getString("disposition"))
            assertEquals("next-book", owner.snapshot()!!.getJSONObject("sourceKey").getString("sourceId"))
            assertEquals(0, owner.snapshot()!!.getInt("partIndex"))
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
        } finally { owner.dispose() }
    }

    @Test fun `paused native load seeks across parts and deduplicates physical command identity without JS`() {
        val owner = PlaybackCoordinator(context, { false }, {})
        try {
            owner.loadAuthorized(manifest(), "paused")
            val result = owner.transport("SeekTo", 2.5, "seek-one")
            assertEquals("accepted", result.getString("disposition"))
            assertTrue(result.getBoolean("transportApplied"))
            assertEquals(1, owner.snapshot()!!.getInt("partIndex"))
            assertEquals(0.5, owner.snapshot()!!.getDouble("timeInPart"), 0.001)
            owner.transport("SeekTo", 0.25, "seek-two")
            assertEquals("duplicate", owner.transport("SeekTo", 2.5, "seek-one").getString("disposition"))
            assertEquals(0.25, owner.snapshot()!!.getDouble("timeInPart"), 0.001)
            assertEquals(1, owner.dirtyJournal("test").getJSONArray("checkpoints").length())
        } finally { owner.dispose() }
    }

    @Test fun `focus refusal is a failed paused result rather than a false playback acknowledgement`() {
        val owner = PlaybackCoordinator(context, { false }, {})
        try {
            owner.loadAuthorized(manifest(), "paused")
            assertEquals("failed", owner.transport("Play", requestId = "play-one").getString("disposition"))
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertFalse(AudioPlaybackJournal(context).hasReceipt("test", "play-one"))
        } finally { owner.dispose() }
    }

    @Test fun `pause after transient loss cancels gain resume and observations follow durable receipt`() {
        lateinit var owner: PlaybackCoordinator
        var checking = false
        owner = PlaybackCoordinator(context, { true }, { value ->
            if (checking && value.optBoolean("playIntent")) assertTrue(AudioPlaybackJournal(context).hasReceipt("test", "play-journal-first"))
        })
        try {
            owner.loadAuthorized(manifest(), "paused")
            owner.setObserving(true)
            checking = true
            owner.transport("Play", requestId = "play-journal-first")
            checking = false
            owner.onFocusTransient()
            val current = owner.snapshot()!!
            owner.command(JSONObject().put("schemaVersion", 1).put("requestId", "app-revoked-focus").put("sessionId", current.getJSONObject("metadata").getString("sessionId"))
                .put("generation", current.getLong("generation")).put("action", JSONObject().put("command", "pause").put("reason", "focus")))
            owner.onFocusGain()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
        } finally { owner.dispose() }
    }

    @Test fun `stop removes decoder playlist and stores cold recovery as closed`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(manifest(), "paused", requestGeneration = 10)
            owner.transport("SeekTo", 2.75, "before-stop")
            val current = owner.snapshot()!!
            val result = owner.command(JSONObject().put("schemaVersion", 1).put("requestId", "stop-one").put("sessionId", current.getJSONObject("metadata").getString("sessionId"))
                .put("generation", 10).put("action", JSONObject().put("command", "stop")))
            assertEquals("accepted", result.getString("disposition"))
            assertNull(owner.snapshot())
            val journal = AudioPlaybackJournal(context).snapshot("test")
            assertTrue(journal.getJSONObject("session").isNull("current"))
            assertEquals(0.75, journal.getJSONArray("checkpoints").getJSONObject(0).getDouble("timeInPart"), 0.001)
            assertTrue(AudioPlaybackJournal(context).hasReceipt("test", "stop-one"))
        } finally { owner.dispose() }
    }

    @Test fun `duck changes real decoder gain without changing saved user volume`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(manifest(), "play")
            owner.setVolume(0.8)
            owner.onDuck()
            assertEquals(0.16f, owner.sessionPlayer.volume, 0.001f)
            assertEquals(0.8, owner.snapshot()!!.getDouble("volume"), 0.001)
            owner.pause("user")
            owner.onFocusGain()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals(0.8f, owner.sessionPlayer.volume, 0.001f)
        } finally { owner.dispose() }
    }

    @Test fun `repeated interruption can resume only its original unchanged generation`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(manifest(), "play")
            owner.onFocusTransient()
            owner.onFocusTransient()
            owner.onFocusGain()
            assertTrue(owner.snapshot()!!.getBoolean("playIntent"))
            owner.onFocusTransient()
            owner.loadAuthorized(manifest(), "paused")
            owner.onFocusGain()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
        } finally { owner.dispose() }
    }

    @Test fun `sleep and exact paused seek are durable without an observer`() {
        var time = 1000L
        val owner = PlaybackCoordinator(context, { true }, {}, { time })
        try {
            owner.loadAuthorized(manifest(), "play")
            owner.setRate(1.5)
            owner.setSleep(time)
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals("sleep", owner.snapshot()!!.getString("pauseReason"))
            owner.transport("SeekTo", 2.5, "sleep-seek")
            val saved = AudioPlaybackJournal(context).snapshot("test").getJSONArray("checkpoints").getJSONObject(0)
            assertEquals(1, saved.getInt("partIndex"))
            assertEquals(0.5, saved.getDouble("timeInPart"), 0.001)
            assertEquals(1.5, saved.getDouble("playbackRate"), 0.001)
        } finally { owner.dispose() }
    }

    @Test fun `commands reject a non service looper`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            val error = java.util.concurrent.atomic.AtomicReference<Throwable?>()
            val thread = Thread { try { owner.loadAuthorized(manifest(), "paused") } catch (failure: Throwable) { error.set(failure) } }
            thread.start(); thread.join()
            assertTrue(error.get() is IllegalStateException)
            assertNull(owner.snapshot())
        } finally { owner.dispose() }
    }

    @Test fun `unchanged paused playback produces no periodic journal writes`() {
        var time = 1000L
        val owner = PlaybackCoordinator(context, { true }, {}, { time })
        try {
            owner.loadAuthorized(manifest(), "paused")
            val initial = owner.snapshot()!!.getLong("checkpointSequence")
            time += 60_000
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(60))
            assertEquals(initial, owner.snapshot()!!.getLong("checkpointSequence"))
        } finally { owner.dispose() }
    }

    @Test fun `suspended JS physical play pause and rapid distinct seeks apply once and publish observation receipts`() {
        val observations = mutableListOf<JSONObject>()
        val owner = PlaybackCoordinator(context, { true }, { observations.add(it) })
        try {
            owner.loadAuthorized(manifest().apply {
                val longParts = JSONArray()
                val audio = File(context.filesDir, "deterministic-two-seconds.wav").toURI().toString()
                longParts.put(JSONObject().put("partId", "part-0").put("sourceRevision", "fixture-v1").put("nativeUri", audio).put("durationSec", 120.0))
                longParts.put(JSONObject().put("partId", "part-1").put("sourceRevision", "fixture-v1").put("nativeUri", audio).put("durationSec", 120.0))
                put("parts", longParts)
            }, "paused")
            // Simulate locked/suspended WebView: observing disabled while hardware transport arrives.
            owner.setObserving(false)
            owner.sessionPlayer.play()
            assertTrue(owner.snapshot()!!.getBoolean("playIntent"))
            owner.sessionPlayer.seekForward()
            owner.sessionPlayer.seekForward()
            assertEquals(60.0, owner.snapshot()!!.getDouble("positionSec"), 0.001)
            owner.sessionPlayer.seekBack()
            assertEquals(45.0, owner.snapshot()!!.getDouble("positionSec"), 0.001)
            owner.sessionPlayer.pause()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertTrue(observations.isEmpty())

            // Boundary Next/Previous on sessionPlayer never throw or fault the session.
            owner.sessionPlayer.seekToPreviousMediaItem()
            assertEquals(0, owner.snapshot()!!.getInt("partIndex"))
            assertFalse(owner.snapshot()!!.has("error"))
            owner.sessionPlayer.seekToNextMediaItem()
            assertEquals(1, owner.snapshot()!!.getInt("partIndex"))
            owner.sessionPlayer.seekToNextMediaItem()
            assertEquals(1, owner.snapshot()!!.getInt("partIndex"))
            assertFalse(owner.snapshot()!!.has("error"))

            // Re-enable observation and verify live transport publishes appliedTransport receipt.
            owner.setObserving(true)
            val seekReceipt = owner.transport("SeekTo", 75.0, "distinct-seek-75")
            assertEquals("accepted", seekReceipt.getString("disposition"))
            assertTrue(seekReceipt.getBoolean("transportApplied"))
            val observedReceipt = observations.last().getJSONObject("appliedTransport")
            assertEquals("distinct-seek-75", observedReceipt.getString("eventId"))
            assertEquals("SeekTo", observedReceipt.getString("command"))
            assertTrue(observedReceipt.getBoolean("transportApplied"))
            assertEquals(75.0, observations.last().getDouble("positionSec"), 0.001)
        } finally { owner.dispose() }
    }

    @Test fun `permanent focus loss and headphone disconnect prevent stale gain resume while preserving non-playing reason`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            owner.loadAuthorized(manifest(), "play")
            owner.onDuck()
            owner.onFocusPermanent()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals("focus", owner.snapshot()!!.getString("pauseReason"))
            assertEquals(1.0f, owner.sessionPlayer.volume, 0.001f)
            owner.onFocusGain()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))

            // Transient loss followed by headphone disconnect clears pending interruption resume.
            owner.play()
            owner.onFocusTransient()
            owner.onHeadphoneDisconnect()
            owner.onFocusGain()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))

            // Active playback headphone disconnect sets reason=headphones; already-paused sleep keeps reason=sleep.
            owner.play()
            owner.onHeadphoneDisconnect()
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
            assertEquals("headphones", owner.snapshot()!!.getString("pauseReason"))
            owner.pause("sleep")
            owner.onHeadphoneDisconnect()
            assertEquals("sleep", owner.snapshot()!!.getString("pauseReason"))
        } finally { owner.dispose() }
    }
    @Test fun `study mode journals press-time provenance and executes navigation mappings once`() {
        val owner = PlaybackCoordinator(context, { true }, {})
        try {
            val config = JSONObject()
                .put("schemaVersion", 1).put("enabled", true).put("captureWindowSec", 15)
                .put("mappings", JSONObject()
                    .put("next", "save_recent_extract")
                    .put("previous", "replay_recent_passage")
                    .put("seekForward", "skip_forward")
                    .put("seekBackward", "next_chapter"))
            owner.loadAuthorized(manifest().apply { put("studyConfig", config) }, "paused")
            owner.sessionPlayer.seekTo(0, 700L)

            // Next is a capture action: no transport, but a durable record with provenance.
            val captured = owner.transport("Next", null, "capture-next-1")
            assertEquals("accepted", captured.getString("disposition"))
            assertTrue(captured.getBoolean("captureQueued"))
            assertFalse(captured.has("transportApplied"))
            assertEquals(0, owner.snapshot()!!.getInt("partIndex"))
            val pending = owner.dirtyJournal("test").getJSONArray("captures")
            assertEquals(1, pending.length())
            val entry = pending.getJSONObject(0)
            assertEquals("book", entry.getJSONObject("sourceKey").getString("sourceId"))
            assertEquals(0, entry.getInt("partIndex"))
            assertEquals(0.7, entry.getDouble("positionHintSec"), 0.05)
            assertEquals("save_recent_extract", entry.getString("studyAction"))

            // The native receipt prevents replay while the capture stays dirty.
            assertEquals("duplicate", owner.transport("Next", null, "capture-next-1").getString("disposition"))
            assertEquals(1, owner.dirtyJournal("test").getJSONArray("captures").length())

            // A later source switch never rebinds the pending capture.
            owner.loadAuthorized(manifest().also { it.getJSONObject("sourceKey").put("sourceId", "book-2") }.apply { put("studyConfig", config) }, "paused")
            assertEquals("book", owner.dirtyJournal("test").getJSONArray("captures").getJSONObject(0).getJSONObject("sourceKey").getString("sourceId"))

            // Navigation mappings execute natively once and publish an applied receipt.
            val chapter = owner.transport("SeekBackward", null, "chapter-once")
            assertEquals("accepted", chapter.getString("disposition"))
            assertTrue(chapter.getBoolean("transportApplied"))
            assertEquals(1, owner.snapshot()!!.getInt("partIndex"))
            owner.transport("Previous", null, "replay-once")
            assertEquals(0.0, owner.snapshot()!!.getDouble("positionSec"), 0.01)

            // Explicit Play/Pause are never remapped by Study Mode.
            owner.transport("Pause", null, "pause-once")
            assertFalse(owner.snapshot()!!.getBoolean("playIntent"))
        } finally { owner.dispose() }
    }

}
