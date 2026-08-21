// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for media-button keycode normalization and the durable
// pending-command queue (task 11.8: envelope normalization / queue
// persistence where automatable without an emulator).

package com.plethora.androidtts

import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Pure keycode normalization — no Android runtime needed beyond KeyEvent
 * constants, which are plain ints in the SDK stub jar.
 */
class MediaButtonNormalizerTest {

    private fun key(code: Int, action: Int = KeyEvent.ACTION_DOWN) =
        MediaButtonNormalizer.fromKeyCode(code, action)

    @Test
    fun `maps standard media keys to canonical commands`() {
        assertEquals("Play", key(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals("Pause", key(KeyEvent.KEYCODE_MEDIA_PAUSE))
        assertEquals("TogglePlayPause", key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals("TogglePlayPause", key(KeyEvent.KEYCODE_HEADSETHOOK))
        assertEquals("Next", key(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertEquals("Previous", key(KeyEvent.KEYCODE_MEDIA_PREVIOUS))
        assertEquals("SeekForward", key(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
        assertEquals("SeekBackward", key(KeyEvent.KEYCODE_MEDIA_REWIND))
    }

    @Test
    fun `ignores key-up events so one press yields one command`() {
        assertNull(
            MediaButtonNormalizer.fromKeyCode(
                KeyEvent.KEYCODE_MEDIA_NEXT,
                KeyEvent.ACTION_UP
            )
        )
    }

    @Test
    fun `non-media keys are ignored`() {
        assertNull(key(KeyEvent.KEYCODE_VOLUME_UP))
        assertNull(key(KeyEvent.KEYCODE_A))
    }
}

/**
 * The queue persists via the real filesystem — Robolectric provides a temp
 * app-private files dir. If Robolectric is unavailable in a given build
 * environment, this class is still compiled; only its RUN requires the
 * robolectric dependency (declared in build.gradle.kts).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MediaCommandQueueTest {

    private fun newQueue(): MediaCommandQueue {
        val context = org.robolectric.Robolectric.buildActivity(
            android.app.Activity::class.java
        ).get()
        return MediaCommandQueue(context)
    }

    private fun entry(id: String, command: String = "Next") =
        PendingMediaCommand(
            eventId = id,
            command = command,
            source = "android",
            occurredAt = 1_000L,
            sourceId = "source-1",
            sessionId = "session-1",
            positionHintSec = 42.5,
        )

    @Test
    fun `enqueue persists before emit and survives reload`() {
        val queue = newQueue()
        queue.enqueue(entry("e1", "Next"))
        // A fresh instance (as after process death) sees the same entry.
        val reloaded = newQueue().load()
        assertEquals(1, reloaded.size)
        assertEquals("e1", reloaded[0].eventId)
        assertEquals("Next", reloaded[0].command)
        assertEquals(42.5, reloaded[0].positionHintSec!!, 0.001)
        assertEquals("source-1", reloaded[0].sourceId)
        assertEquals("session-1", reloaded[0].sessionId)
        assertNull(reloaded[0].ackedAt)
    }

    @Test
    fun `ack marks entries and drain returns only unacked oldest-first`() {
        val queue = newQueue()
        queue.enqueue(entry("e1"))
        queue.enqueue(entry("e2"))
        queue.enqueue(entry("e3"))

        queue.ack(listOf("e2"))

        val drained = newQueue().drainUnacked()
        assertEquals(listOf("e1", "e3"), drained.map { it.eventId })
        // Acked entries are pruned from disk during drain.
        assertEquals(listOf("e1", "e3"), newQueue().load().map { it.eventId })
    }

    @Test
    fun `drained commands persist until acked by the dispatcher`() {
        val queue = newQueue()
        queue.enqueue(entry("e1"))
        // Drain returns the same unacked press until the frontend acks it —
        // reconcile replays rather than silently dropping.
        assertEquals(1, queue.drainUnacked().size)
        assertEquals(1, queue.drainUnacked().size)
        queue.ack(listOf("e1"))
        assertTrue(queue.drainUnacked().isEmpty())
    }

    @Test
    fun `queue is bounded to the last 100 entries`() {
        val queue = newQueue()
        for (i in 0 until 130) {
            queue.enqueue(entry("e$i"))
        }
        val all = queue.load()
        assertEquals(100, all.size)
        assertEquals("e30", all.first().eventId)
        assertEquals("e129", all.last().eventId)
    }

    @Test
    fun `json envelopes use the canonical frontend shape`() {
        val queue = newQueue()
        queue.enqueue(entry("e1"))
        val arr: JSONArray = queue.toJsonArray(queue.load())
        val o: JSONObject = arr.getJSONObject(0)
        assertEquals("e1", o.getString("eventId"))
        assertEquals("Next", o.getString("command"))
        assertEquals("android", o.getString("source"))
        assertEquals(42.5, o.getDouble("positionHintSec"), 0.001)
        assertEquals("source-1", o.getString("sourceId"))
        assertEquals("session-1", o.getString("sessionId"))
        assertFalse(o.getBoolean("acked"))
    }
}
