// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Remote Media Session Service (design Decision 6/8; tasks 6.1 + 10.1).
//
// A real AndroidX Media3 MediaSessionService hosting a MediaSession bound to
// a forwarding/no-op Player. Audio itself keeps rendering in the WebView (no
// native ExoPlayer migration); the session exists strictly for command and
// metadata routing:
//
// - Media buttons from Bluetooth/wired/car remotes and lock-screen/
//   notification action buttons arrive on the session and are normalized into
//   the canonical command enum (Play/Pause/TogglePlayPause/Next/Previous/
//   SeekForward/SeekBackward).
// - Every command is durably appended to the plugin-owned pending-command
//   queue BEFORE being emitted to the WebView as a `media://remote-command`
//   CustomEvent carrying the full envelope (eventId/source/occurredAt/
//   positionHintSec), so a press received while the WebView is suspended is
//   never lost (frontend reconciles on resume; see MediaCommandQueue).
// - The service holds media audio-focus conventions: transient loss emits a
//   Pause envelope (the WebView audio ducks/stops), gain after a transient
//   loss emits Play.
//
// Kotlin unit tests cover the keycode normalization + queue persistence
// (MediaButtonNormalizerTest / MediaCommandQueueTest).

package com.plethora.androidtts

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Looper
import android.view.KeyEvent
import androidx.media3.common.AudioAttributes as Media3AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.Logger
import com.google.common.util.concurrent.ListenableFuture
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.Executor
import org.json.JSONObject

// ──────────────────────────────────────────────────────────────────────────
// Shared bridge between the plugin (WebView reference, lifecycle) and the
// service (media buttons). Process-scoped singleton.
// ──────────────────────────────────────────────────────────────────────────

object MediaBridge {
    @Volatile var webView: WeakReference<android.webkit.WebView>? = null
    @Volatile var lastPositionSec: Double? = null
    @Volatile var isPlaying: Boolean = false
    lateinit var queue: MediaCommandQueue

    fun ensureQueue(context: Context): MediaCommandQueue {
        if (!::queue.isInitialized) queue = MediaCommandQueue(context.applicationContext)
        return queue
    }

    /** Emit a normalized command envelope to the WebView + durable queue. */
    fun emitCommand(context: Context, command: String, occurredAt: Long = System.currentTimeMillis()) {
        val envelope = JSONObject()
            .put("command", command)
            .put("eventId", UUID.randomUUID().toString())
            .put("source", "android")
            .put("occurredAt", occurredAt)
        lastPositionSec?.let { envelope.put("positionHintSec", it) }

        // Durable append BEFORE delivery (Decision 8).
        try {
            ensureQueue(context).enqueue(
                PendingMediaCommand(
                    eventId = envelope.getString("eventId"),
                    command = command,
                    source = "android",
                    occurredAt = occurredAt,
                    positionHintSec = lastPositionSec,
                )
            )
        } catch (e: Throwable) {
            Logger.warn("MediaBridge: queue append failed: ${e.message}")
        }

        val view = webView?.get()
        if (view == null) {
            Logger.info("MediaBridge: no WebView; command stays queued ($command)")
            return
        }
        try {
            val literal = JSONObject.quote(envelope.toString())
            val js = "(function(){try{window.dispatchEvent(new CustomEvent('media://remote-command',{detail:JSON.parse($literal)}));}catch(e){}})();"
            view.post { view.evaluateJavascript(js, null) }
        } catch (e: Throwable) {
            Logger.warn("MediaBridge: emit failed: ${e.message}")
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Keycode → canonical command normalization (unit-tested).
// ──────────────────────────────────────────────────────────────────────────

object MediaButtonNormalizer {
    /** Canonical-cased command names matching the TS `RemoteMediaCommand` union. */
    fun fromKeyCode(keyCode: Int, action: Int): String? {
        if (action != KeyEvent.ACTION_DOWN) return null
        return when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY -> "Play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "Pause"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "TogglePlayPause"
            KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> "Next"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> "Previous"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "SeekForward"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "SeekBackward"
            else -> null
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// A completed future without a Guava dependency (media3-common only ships
// the listenablefuture *interface*).
// ──────────────────────────────────────────────────────────────────────────

@UnstableApi
class CompletedFuture<T>(private val value: T?) : ListenableFuture<T> {
    override fun addListener(listener: Runnable, executor: Executor) {
        try {
            executor.execute(listener)
        } catch (_: Throwable) {
        }
    }

    override fun cancel(mayInterruptIfRunning: Boolean): Boolean = false
    override fun isCancelled(): Boolean = false
    override fun isDone(): Boolean = true
    override fun get(): T = value as T
    override fun get(timeout: Long, unit: java.util.concurrent.TimeUnit): T = value as T
}

// ──────────────────────────────────────────────────────────────────────────
// Forwarding/no-op player: strictly for command & metadata routing. No
// media items, no rendering — the WebView owns actual audio.
// ──────────────────────────────────────────────────────────────────────────

@UnstableApi
class WebViewBridgePlayer(
    private val context: Context,
    private val onCommand: (String) -> Unit,
) : androidx.media3.common.SimpleBasePlayer(Looper.getMainLooper()) {

    private val voidFuture: ListenableFuture<Void?> get() = CompletedFuture(null)

    override fun getState(): State {
        return State.Builder()
            .setAvailableCommands(
                Player.Commands.Builder()
                    .add(Player.COMMAND_PLAY_PAUSE)
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_FORWARD)
                    .add(Player.COMMAND_SEEK_BACK)
                    .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                    .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
                    .add(Player.COMMAND_GET_TIMELINE)
                    .add(Player.COMMAND_SET_MEDIA_ITEM)
                    .build()
            )
            .setPlayWhenReady(MediaBridge.isPlaying, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .build()
    }

    override fun handlePrepare(): ListenableFuture<*> = voidFuture

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        MediaBridge.isPlaying = playWhenReady
        invalidateState()
        // Notification/assistant play-pause controls arrive as player calls
        // (not raw keycodes); surface them as the same normalized commands so
        // every entry point produces identical envelopes.
        onCommand(if (playWhenReady) "Play" else "Pause")
        return voidFuture
    }

    override fun handleStop(): ListenableFuture<*> {
        MediaBridge.isPlaying = false
        invalidateState()
        return voidFuture
    }

    override fun handleRelease(): ListenableFuture<*> = voidFuture
    override fun handleSetVolume(volume: Float): ListenableFuture<*> = voidFuture
    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> = voidFuture
    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> = voidFuture

    /** Transport routing: player-level seeks (notification Next/Previous etc.) */
    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val command = when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> "Next"
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> "Previous"
            Player.COMMAND_SEEK_FORWARD -> "SeekForward"
            Player.COMMAND_SEEK_BACK -> "SeekBackward"
            else -> null
        }
        if (command != null) onCommand(command)
        return voidFuture
    }
}

// ──────────────────────────────────────────────────────────────────────────
// The Media3 foreground service.
// ──────────────────────────────────────────────────────────────────────────

@OptIn(UnstableApi::class)
class RemoteMediaSessionService : MediaSessionService() {

    companion object {
        @Volatile private var activeSession: MediaSession? = null
        @Volatile private var bridgePlayer: WebViewBridgePlayer? = null
        private var audioFocusRequest: AudioFocusRequest? = null
        private var lostFocusTransiently = false

        fun start(ctx: Context) {
            try {
                val intent = Intent(ctx, RemoteMediaSessionService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Throwable) {
                Logger.warn("RemoteMediaSessionService start failed: ${e.message}")
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, RemoteMediaSessionService::class.java))
            } catch (_: Throwable) {
            }
        }
    }

    private val audioManager: AudioManager by lazy {
        getSystemService(AUDIO_SERVICE) as AudioManager
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        activeSession

    override fun onCreate() {
        super.onCreate()
        // Everything here must be non-fatal: a foreground service refusal must
        // degrade to "no native media session" rather than crash the process.
        try {
            val player = WebViewBridgePlayer(this) { command ->
                MediaBridge.emitCommand(this, command)
            }
            bridgePlayer = player

            val session = MediaSession.Builder(this, player)
                .setSessionActivity(
                    android.app.PendingIntent.getActivity(
                        this,
                        0,
                        packageManager.getLaunchIntentForPackage(packageName),
                        android.app.PendingIntent.FLAG_IMMUTABLE,
                    )
                )
                .setCallback(object : MediaSession.Callback {
                    override fun onMediaButtonEvent(
                        mediaSession: MediaSession,
                        controllerInfo: MediaSession.ControllerInfo,
                        intent: Intent,
                    ): Boolean {
                        val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                        if (event != null) {
                            val command = MediaButtonNormalizer.fromKeyCode(event.keyCode, event.action)
                            if (command != null) {
                                MediaBridge.emitCommand(this@RemoteMediaSessionService, command)
                                return true // consumed — one physical press, one envelope
                            }
                        }
                        return super.onMediaButtonEvent(mediaSession, controllerInfo, intent)
                    }
                })
                .build()
            activeSession = session
            addSession(session)

            player.setAudioAttributes(
                Media3AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                /* handleAudioFocus = */ false, // focus handled natively below
            )

            requestFocus()
        } catch (e: Throwable) {
            Logger.warn("RemoteMediaSessionService create failed: ${e.message}")
            stopSelf()
        }
    }

    private fun requestFocus() {
        try {
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val listener = AudioManager.OnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        lostFocusTransiently = false
                        MediaBridge.emitCommand(this, "Pause")
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        lostFocusTransiently = true
                        MediaBridge.emitCommand(this, "Pause")
                    }
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        if (lostFocusTransiently) {
                            lostFocusTransiently = false
                            MediaBridge.emitCommand(this, "Play")
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(listener)
                    .build()
                audioFocusRequest = request
                audioManager.requestAudioFocus(request)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(listener, android.media.AudioAttributes.USAGE_MEDIA, AudioManager.AUDIOFOCUS_GAIN)
            }
        } catch (e: Throwable) {
            Logger.warn("RemoteMediaSessionService focus request failed: ${e.message}")
        }
    }

    private fun abandonFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            }
            audioFocusRequest = null
        } catch (_: Throwable) {
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = activeSession?.player
        if (player == null || !player.playWhenReady) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        abandonFocus()
        try {
            activeSession?.release()
        } catch (_: Throwable) {
        }
        activeSession = null
        bridgePlayer = null
        super.onDestroy()
    }
}
