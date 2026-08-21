// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the Android media-session reliability contract (openspec
// fix-mobile-layout-and-android-media-controls):
//   - WebViewBridgePlayer.getState() mapping (idle/buffering/ready/ended,
//     playWhenReady) and honest capabilities,
//   - MediaBridge snapshot handling (complete snapshot before start,
//     generating -> playing, playing <-> paused, stale rejection),
//   - start/stop reference-count idempotence,
//   - the merged manifest contract (intent filter, exported,
//     foregroundServiceType, POST_NOTIFICATIONS).

package com.plethora.androidtts

import android.content.Context
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * WebViewBridgePlayer is final and getState() is protected; reflection is the
 * pragmatic bridge for asserting the OS-facing state mapping.
 */
@UnstableApi
private fun exposedState(player: WebViewBridgePlayer): SimpleBasePlayer.State {
    player.refreshState()
    val method = androidx.media3.common.SimpleBasePlayer::class.java
        .getDeclaredMethod("getState")
    method.isAccessible = true
    return method.invoke(player) as SimpleBasePlayer.State
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WebViewBridgePlayerStateTest {

    private fun player(): WebViewBridgePlayer =
        WebViewBridgePlayer(RuntimeEnvironment.getApplication()) { _, _ -> }

    private fun resetBridge() {
        MediaBridge.playbackState = "idle"
        MediaBridge.isPlaying = false
        MediaBridge.durationSec = null
        MediaBridge.lastPositionSec = null
        MediaBridge.sourceId = null
        MediaBridge.sessionId = null
        MediaBridge.canSeekRelative = true
        MediaBridge.canSeekAbsolute = true
        MediaBridge.canNext = true
        MediaBridge.canPrevious = true
    }

    @Test
    fun `idle bridge state maps to STATE_IDLE and not playWhenReady`() {
        resetBridge()
        val player = player()
        val state = exposedState(player)
        assertEquals(Player.STATE_IDLE, state.playbackState)
        assertFalse(state.playWhenReady)
    }

    @Test
    fun `generating maps to buffering so no controls are advertised early`() {
        resetBridge()
        MediaBridge.playbackState = "loading"
        val player = player()
        assertEquals(Player.STATE_BUFFERING, exposedState(player).playbackState)
    }

    @Test
    fun `playing maps to READY with playWhenReady`() {
        resetBridge()
        MediaBridge.playbackState = "playing"
        MediaBridge.isPlaying = true
        val player = player()
        val state = exposedState(player)
        assertEquals(Player.STATE_READY, state.playbackState)
        assertTrue(state.playWhenReady)
    }

    @Test
    fun `paused keeps READY but stops playWhenReady`() {
        resetBridge()
        MediaBridge.playbackState = "paused"
        MediaBridge.isPlaying = false
        val player = player()
        val state = exposedState(player)
        assertEquals(Player.STATE_READY, state.playbackState)
        assertFalse(state.playWhenReady)
    }

    @Test
    fun `ended maps to STATE_ENDED`() {
        resetBridge()
        MediaBridge.playbackState = "ended"
        val player = player()
        assertEquals(Player.STATE_ENDED, exposedState(player).playbackState)
    }

    @Test
    fun `unsupported seek capabilities remove seek commands honestly`() {
        resetBridge()
        MediaBridge.playbackState = "playing"
        MediaBridge.isPlaying = true
        MediaBridge.canSeekRelative = false
        MediaBridge.canSeekAbsolute = false
        MediaBridge.canNext = false
        MediaBridge.canPrevious = false
        val player = player()
        val commands = exposedState(player).availableCommands
        assertFalse(commands.contains(Player.COMMAND_SEEK_FORWARD))
        assertFalse(commands.contains(Player.COMMAND_SEEK_BACK))
        assertFalse(commands.contains(Player.COMMAND_SEEK_TO_NEXT))
        assertFalse(commands.contains(Player.COMMAND_SEEK_TO_PREVIOUS))
        assertTrue(commands.contains(Player.COMMAND_PLAY_PAUSE))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MediaBridgeSnapshotTest {

    private fun args(block: (UpdateMediaMetadataArgs) -> Unit): UpdateMediaMetadataArgs =
        UpdateMediaMetadataArgs().also(block)

    @Test
    fun `complete snapshot before start populates every OS-facing field`() {
        MediaBridge.updateSnapshot(
            args {
                it.sourceId = "doc-1"
                it.sessionId = "session-1"
                it.title = "Project Hail Mary"
                it.artist = "Andy Weir"
                it.album = "Audiobooks"
                it.positionSec = 12.0
                it.durationSec = 600.0
                it.state = "playing"
                it.isPlaying = true
                it.updatedAt = 1_000L
            }
        )
        assertEquals("doc-1", MediaBridge.sourceId)
        assertEquals("session-1", MediaBridge.sessionId)
        assertEquals("Project Hail Mary", MediaBridge.title)
        assertEquals("Andy Weir", MediaBridge.artist)
        assertEquals(12.0, MediaBridge.lastPositionSec!!, 0.001)
        assertEquals(600.0, MediaBridge.durationSec!!, 0.001)
        assertEquals("playing", MediaBridge.playbackState)
        assertTrue(MediaBridge.isPlaying)
    }

    @Test
    fun `generating then playing transition updates playback state`() {
        MediaBridge.updateSnapshot(args { it.state = "loading"; it.isPlaying = false; it.updatedAt = 1L })
        assertEquals("loading", MediaBridge.playbackState)
        MediaBridge.updateSnapshot(args { it.state = "playing"; it.isPlaying = true; it.updatedAt = 2L })
        assertEquals("playing", MediaBridge.playbackState)
        assertTrue(MediaBridge.isPlaying)
    }

    @Test
    fun `playing and paused alternate without losing source identity`() {
        MediaBridge.updateSnapshot(args { it.sourceId = "doc-9"; it.state = "playing"; it.isPlaying = true; it.updatedAt = 10L })
        MediaBridge.updateSnapshot(args { it.state = "paused"; it.isPlaying = false; it.updatedAt = 11L })
        assertEquals("paused", MediaBridge.playbackState)
        assertFalse(MediaBridge.isPlaying)
        assertEquals("doc-9", MediaBridge.sourceId)
        MediaBridge.updateSnapshot(args { it.state = "playing"; it.isPlaying = true; it.updatedAt = 12L })
        assertTrue(MediaBridge.isPlaying)
    }

    @Test
    fun `same-session older snapshot is rejected`() {
        MediaBridge.updateSnapshot(
            args { it.sessionId = "s-1"; it.state = "playing"; it.isPlaying = true; it.updatedAt = 100L }
        )
        val applied =
            MediaBridge.updateSnapshot(
                args { it.sessionId = "s-1"; it.state = "paused"; it.isPlaying = false; it.updatedAt = 50L }
            )
        assertFalse(applied)
        assertEquals("playing", MediaBridge.playbackState)
        assertTrue(MediaBridge.isPlaying)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RemoteMediaSessionLifecycleTest {

    @Test
    fun `start-start-stop-stop keeps reference count balanced`() {
        val context = RuntimeEnvironment.getApplication()
        RemoteMediaSessionService.stop(context) // drain any leaked references first
        assertEquals(0, RemoteMediaSessionService.referenceCount())

        RemoteMediaSessionService.start(context)
        RemoteMediaSessionService.start(context)
        assertEquals(2, RemoteMediaSessionService.referenceCount())

        RemoteMediaSessionService.stop(context)
        assertEquals(1, RemoteMediaSessionService.referenceCount())

        // Second stop actually releases the session reference.
        RemoteMediaSessionService.stop(context)
        assertEquals(0, RemoteMediaSessionService.referenceCount())
    }

    @Test
    fun `start after full stop restarts cleanly`() {
        val context = RuntimeEnvironment.getApplication()
        RemoteMediaSessionService.stop(context)
        assertEquals(0, RemoteMediaSessionService.referenceCount())
        RemoteMediaSessionService.start(context)
        assertEquals(1, RemoteMediaSessionService.referenceCount())
        RemoteMediaSessionService.stop(context)
        assertEquals(0, RemoteMediaSessionService.referenceCount())
    }
}

/**
 * Manifest contract: the Media3 service registration must satisfy the
 * androidx.media3:media3-session 1.8.0 requirements (MediaSessionService
 * intent filter for media-button routing / restart-after-death, exported
 * service declaration, mediaPlayback foreground type) and declare
 * POST_NOTIFICATIONS, without which Android 13+ silently drops the media
 * notification that carries lock-screen/notification controls.
 */
class MediaManifestContractTest {

    private fun readManifestXml(): org.w3c.dom.Document {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("android/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("plugin AndroidManifest.xml not found relative to ${File(".").absolutePath}")
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
    }

    @Test
    fun `service declares the MediaSessionService intent filter and is exported`() {
        val doc = readManifestXml()
        val services = doc.getElementsByTagName("service")
        var found = false
        for (i in 0 until services.length) {
            val service = services.item(i) as org.w3c.dom.Element
            if (!service.getAttribute("android:name").endsWith("RemoteMediaSessionService")) continue
            found = true
            assertEquals("true", service.getAttribute("android:exported"))
            assertEquals("mediaPlayback", service.getAttribute("android:foregroundServiceType"))

            val actions = service.getElementsByTagName("action")
            val actionNames = (0 until actions.length).mapNotNull { idx ->
                (actions.item(idx) as org.w3c.dom.Element).getAttribute("android:name")
            }
            assertTrue(
                "missing androidx.media3.session.MediaSessionService intent action",
                actionNames.contains("androidx.media3.session.MediaSessionService"),
            )
        }
        assertTrue("RemoteMediaSessionService <service> declaration missing", found)
    }

    @Test
    fun `manifest declares POST_NOTIFICATIONS`() {
        val doc = readManifestXml()
        val permissions = doc.getElementsByTagName("uses-permission")
        val names = (0 until permissions.length).map { idx ->
            (permissions.item(idx) as org.w3c.dom.Element).getAttribute("android:name")
        }
        assertTrue(names.contains("android.permission.POST_NOTIFICATIONS"))
        assertTrue(names.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"))
    }
}
