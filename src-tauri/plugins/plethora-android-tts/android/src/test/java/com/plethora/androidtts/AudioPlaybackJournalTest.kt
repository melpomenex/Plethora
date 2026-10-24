package com.plethora.androidtts

import android.content.Context
import android.util.AtomicFile
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AudioPlaybackJournalTest {
    private lateinit var context: Context
    @Before fun clean() {
        context = ApplicationProvider.getApplicationContext()
        AtomicFile(File(context.filesDir, AudioPlaybackJournal.FILE_NAME)).delete()
    }
    private fun source(id: String = "book", profile: String = "test") = JSONObject().put("profileKey", profile).put("kind", "audiobook").put("sourceId", id)
    private fun checkpoint(id: String = "book", sequence: Long = 1, profile: String = "test"): JSONObject = JSONObject()
        .put("schemaVersion", 1).put("sourceKey", source(id, profile)).put("ownerEpoch", "epoch")
        .put("checkpointSequence", sequence).put("sessionId", "session").put("mediaRevision", "revision")
        .put("partIndex", 0).put("timeInPart", 12.5).put("positionSec", 12.5)
        .put("durationSec", 120).put("playbackRate", 1.5).put("updatedAt", 1)

    @Test fun `reopens exact progress and does not acknowledge a newer dirty cursor`() {
        val journal = AudioPlaybackJournal(context)
        journal.checkpoint(checkpoint(sequence = 1), JSONObject().put("current", source()))
        journal.checkpoint(checkpoint(sequence = 2), JSONObject().put("current", source()))
        val restored = AudioPlaybackJournal(context)
        assertFalse(restored.acknowledge(source(), "epoch", 1))
        assertEquals(2L, restored.snapshot("test").getJSONArray("checkpoints").getJSONObject(0).getLong("checkpointSequence"))
        assertTrue(restored.acknowledge(source(), "epoch", 2))
        assertEquals(0, AudioPlaybackJournal(context).snapshot("test").getJSONArray("checkpoints").length())
    }

    @Test fun `dirty capacity refuses takeover without evicting any progress`() {
        val journal = AudioPlaybackJournal(context)
        for (index in 0 until AudioPlaybackJournal.MAX_CHECKPOINTS) journal.checkpoint(checkpoint(id = "$index"), JSONObject())
        try { journal.checkpoint(checkpoint(id = "overflow"), JSONObject()); fail("Expected capacity rejection") } catch (_: IllegalStateException) { }
        assertEquals(128, AudioPlaybackJournal(context).snapshot("test").getJSONArray("checkpoints").length())
    }

    @Test fun `profile snapshots are isolated and resolved media URLs are never serialized`() {
        val journal = AudioPlaybackJournal(context)
        journal.checkpoint(checkpoint().put("nativeUri", "https://example.test/private?token=secret"), JSONObject().put("current", source()))
        journal.checkpoint(checkpoint(id = "other", profile = "other-profile"), JSONObject())
        assertEquals(1, journal.snapshot("test").getJSONArray("checkpoints").length())
        assertFalse(File(context.filesDir, AudioPlaybackJournal.FILE_NAME).readText().contains("token=secret"))
        journal.receipt("test", "press-1")
        journal.receipt("test", "press-1")
        assertTrue(AudioPlaybackJournal(context).hasReceipt("test", "press-1"))
        assertFalse(journal.hasReceipt("other-profile", "press-1"))
    }

    @Test fun `interrupted atomic replacement retains the previous committed checkpoint`() {
        val journal = AudioPlaybackJournal(context)
        journal.checkpoint(checkpoint(), JSONObject())
        val storage = AtomicFile(File(context.filesDir, AudioPlaybackJournal.FILE_NAME))
        val unfinished = storage.startWrite()
        unfinished.write("{broken".toByteArray())
        unfinished.close()
        assertEquals(12.5, AudioPlaybackJournal(context).snapshot("test").getJSONArray("checkpoints").getJSONObject(0).getDouble("timeInPart"), 0.0)
    }

    @Test fun `command receipt and applied checkpoint survive as one atomic commit`() {
        val journal = AudioPlaybackJournal(context)
        journal.checkpoint(checkpoint(), JSONObject().put("current", source()), "seek-press")
        val restarted = AudioPlaybackJournal(context)
        assertTrue(restarted.hasReceipt("test", "seek-press"))
        assertEquals(1, restarted.snapshot("test").getJSONArray("checkpoints").length())
        val detached = restarted.snapshot("test")
        detached.getJSONObject("session").put("nativeUri", "not-durable")
        assertFalse(restarted.snapshot("test").getJSONObject("session").has("nativeUri"))
    }

    @Test fun `pending capture remains bound to original source and duplicate receipt is not replayed`() {
        val journal = AudioPlaybackJournal(context)
        val capture = JSONObject().put("eventId", "capture-1").put("command", "Next").put("sourceKey", source("old-book"))
            .put("sessionId", "old-session").put("partIndex", 2).put("positionHintSec", 32)
        journal.capture("test", capture)
        journal.capture("test", capture)
        journal.checkpoint(checkpoint("new-book"), JSONObject().put("current", source("new-book")))
        val restored = AudioPlaybackJournal(context)
        val pending = restored.snapshot("test").getJSONArray("captures")
        assertEquals(1, pending.length())
        assertEquals("old-book", pending.getJSONObject(0).getJSONObject("sourceKey").getString("sourceId"))
        assertEquals(32, pending.getJSONObject(0).getInt("positionHintSec"))
        assertFalse(restored.acknowledgeCapture("other-profile", "capture-1"))
        assertTrue(restored.acknowledgeCapture("test", "capture-1"))
        restored.capture("test", capture)
        assertEquals(0, restored.snapshot("test").getJSONArray("captures").length())
    }

    @Test fun `native owner handover remains monotonic across service recreation without wall clock ordering`() {
        val first = AudioPlaybackJournal(context)
        assertEquals(1L, first.beginOwner("test", "first"))
        assertEquals(1L, first.beginOwner("test", "first"))
        val reopened = AudioPlaybackJournal(context)
        assertEquals(2L, reopened.beginOwner("test", "second"))
        assertEquals(1L, reopened.beginOwner("other-profile", "first"))
        assertEquals(2L, reopened.snapshot("test").getJSONObject("authority").getLong("ownerSequence"))
    }
}
