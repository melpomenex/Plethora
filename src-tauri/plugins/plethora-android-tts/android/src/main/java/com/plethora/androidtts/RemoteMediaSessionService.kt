// Copyright 2026 Plethora
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

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import androidx.media3.common.AudioAttributes as Media3AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.Logger
import com.google.common.util.concurrent.ListenableFuture
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

// ──────────────────────────────────────────────────────────────────────────
// Shared bridge between the plugin (WebView reference, lifecycle) and the
// service (media buttons). Process-scoped singleton.
// ──────────────────────────────────────────────────────────────────────────

object MediaBridge {
    @Volatile var webView: WeakReference<android.webkit.WebView>? = null
    @Volatile var sourceId: String? = null
    @Volatile var sessionId: String? = null
    @Volatile var sourceKind: String? = null
    @Volatile var title: String = "Plethora"
    @Volatile var artist: String = "Plethora"
    @Volatile var album: String = "Library"
    @Volatile var artworkUrl: String? = null
    @Volatile var sectionId: String? = null
    @Volatile var sectionTitle: String? = null
    @Volatile var sectionIndex: Int? = null
    @Volatile var sectionAnchor: String? = null
    @Volatile var lastPositionSec: Double? = null
    @Volatile var durationSec: Double? = null
    @Volatile var playbackRate: Float = 1.0f
    @Volatile var playbackState: String = "idle"
    @Volatile var isPlaying: Boolean = false
    @Volatile var canSeekRelative: Boolean = true
    @Volatile var canSeekAbsolute: Boolean = true
    @Volatile var canNext: Boolean = true
    @Volatile var canPrevious: Boolean = true
    @Volatile var precisePosition: Boolean = true
    @Volatile var updatedAt: Long = 0L
    lateinit var queue: MediaCommandQueue

    fun ensureQueue(context: Context): MediaCommandQueue {
        if (!::queue.isInitialized) queue = MediaCommandQueue(context.applicationContext)
        return queue
    }

    /** @return true when applied, false when rejected as stale. */
    fun updateSnapshot(args: UpdateMediaMetadataArgs): Boolean {
        // Same-session snapshots are monotonic; a source switch is allowed to
        // replace the previous source even if its wall-clock value is lower.
        if (args.sessionId != null && args.sessionId == sessionId &&
            args.updatedAt != null && args.updatedAt!! < updatedAt) {
            return false
        }
        args.sourceId?.let { sourceId = it }
        args.sessionId?.let { sessionId = it }
        args.sourceKind?.let { sourceKind = it }
        args.title?.let { title = it }
        args.artist?.let { artist = it }
        args.album?.let { album = it }
        args.artworkUrl?.let { artworkUrl = it }
        args.sectionId?.let { sectionId = it }
        args.sectionTitle?.let { sectionTitle = it }
        args.sectionIndex?.let { sectionIndex = it }
        args.sectionAnchor?.let { sectionAnchor = it }
        args.positionSec?.let { lastPositionSec = it }
        args.durationSec?.let { durationSec = it }
        args.playbackRate?.let { playbackRate = it.toFloat().coerceIn(0.25f, 4.0f) }
        args.state?.let { playbackState = it }
        args.isPlaying?.let { isPlaying = it }
        args.canSeekRelative?.let { canSeekRelative = it }
        args.canSeekAbsolute?.let { canSeekAbsolute = it }
        args.canNext?.let { canNext = it }
        args.canPrevious?.let { canPrevious = it }
        args.precisePosition?.let { precisePosition = it }
        args.updatedAt?.let { updatedAt = maxOf(updatedAt, it) }
        return true
    }

    /** Emit a normalized command envelope to the WebView + durable queue. */
    fun emitCommand(
        context: Context,
        command: String,
        positionSec: Double? = null,
        occurredAt: Long = System.currentTimeMillis(),
    ) {
        Log.d(AndroidTtsPlugin.MEDIA_LOG_TAG, "command received -> $command")
        val envelope = JSONObject()
            .put("command", command)
            .put("eventId", UUID.randomUUID().toString())
            .put("source", "android")
            .put("occurredAt", occurredAt)
            .put("sourceId", sourceId ?: JSONObject.NULL)
            .put("sessionId", sessionId ?: JSONObject.NULL)
        lastPositionSec?.let { envelope.put("positionHintSec", it) }
        positionSec?.let { envelope.put("positionSec", it) }

        // Durable append BEFORE delivery (Decision 8).
        try {
            ensureQueue(context).enqueue(
                PendingMediaCommand(
                    eventId = envelope.getString("eventId"),
                    command = command,
                    source = "android",
                    occurredAt = occurredAt,
                    sourceId = sourceId,
                    sessionId = sessionId,
                    positionHintSec = lastPositionSec,
                    positionSec = positionSec,
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

    fun emitAudioFocusState(context: Context, state: String) {
        val view = webView?.get() ?: return
        try {
            val payload = JSONObject().put("state", state)
            val literal = JSONObject.quote(payload.toString())
            val js = "(function(){try{window.dispatchEvent(new CustomEvent('media://audio-focus',{detail:JSON.parse($literal)}));}catch(e){}})();"
            view.post { view.evaluateJavascript(js, null) }
        } catch (e: Throwable) {
            Logger.warn("MediaBridge audio-focus event failed: ${e.message}")
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
    private val onCommand: (String, Double?) -> Unit,
) : androidx.media3.common.SimpleBasePlayer(Looper.getMainLooper()) {

    private val voidFuture: ListenableFuture<Void?> get() = CompletedFuture(null)

    /** Last (state, playing) pair we logged; keeps diagnostics non-spammy. */
    private var lastLoggedState: Pair<String, Boolean>? = null

    fun refreshState() {
        invalidateState()
        val current = MediaBridge.playbackState to MediaBridge.isPlaying
        if (current != lastLoggedState) {
            Log.i(
                AndroidTtsPlugin.MEDIA_LOG_TAG,
                "player state -> ${current.first} playing=${current.second} " +
                    "source=${MediaBridge.sourceId}"
            )
            lastLoggedState = current
        }
    }

    override fun getState(): State {
        val durationMs = ((MediaBridge.durationSec ?: 0.0).coerceAtLeast(0.0) * 1000.0).toLong()
        val durationUs = if (durationMs > 0) durationMs * 1000L else C.TIME_UNSET
        val mediaMetadata = MediaMetadata.Builder()
            .setTitle(MediaBridge.title)
            .setArtist(MediaBridge.artist)
            .setAlbumTitle(MediaBridge.album)
            .setSubtitle(MediaBridge.sectionTitle)
            .setDurationMs(if (durationMs > 0) durationMs else null)
            .apply {
                MediaBridge.artworkUrl?.let { setArtworkUri(android.net.Uri.parse(it)) }
            }
            .build()
        val mediaItem = MediaItem.Builder()
            .setMediaId(MediaBridge.sourceId ?: MediaBridge.sessionId ?: "plethora")
            .setUri("about:blank")
            .setMediaMetadata(mediaMetadata)
            .build()
        val periodUid = "plethora-period-${MediaBridge.sessionId ?: "default"}"
        val period = SimpleBasePlayer.PeriodData.Builder(periodUid)
            .setDurationUs(durationUs)
            .build()
        val mediaItemData = SimpleBasePlayer.MediaItemData.Builder(mediaItem.mediaId)
            .setMediaItem(mediaItem)
            .setMediaMetadata(mediaMetadata)
            .setIsSeekable(MediaBridge.canSeekAbsolute)
            .setDurationUs(durationUs)
            .setPeriods(listOf(period))
            .build()
        val commands = Player.Commands.Builder()
            .add(Player.COMMAND_PLAY_PAUSE)
            .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
            .add(Player.COMMAND_GET_TIMELINE)
            // Required by DefaultMediaNotificationProvider: without it the
            // provider skips reading mediaMetadata entirely and posts the
            // notification with null title/text ("null" on the lock screen).
            .add(Player.COMMAND_GET_METADATA)
            .add(Player.COMMAND_SET_MEDIA_ITEM)
            .addIf(Player.COMMAND_SEEK_TO_NEXT, MediaBridge.canNext)
            .addIf(Player.COMMAND_SEEK_TO_PREVIOUS, MediaBridge.canPrevious)
            .addIf(Player.COMMAND_SEEK_FORWARD, MediaBridge.canSeekRelative)
            .addIf(Player.COMMAND_SEEK_BACK, MediaBridge.canSeekRelative)
            .addIf(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, MediaBridge.canSeekAbsolute)
            .build()
        val state = when (MediaBridge.playbackState) {
            "loading", "buffering" -> Player.STATE_BUFFERING
            "ended" -> Player.STATE_ENDED
            "idle", "stopped" -> Player.STATE_IDLE
            else -> Player.STATE_READY
        }
        return State.Builder()
            .setAvailableCommands(commands)
            .setPlaylist(listOf(mediaItemData))
            .setCurrentMediaItemIndex(0)
            .setContentPositionMs(((MediaBridge.lastPositionSec ?: 0.0).coerceAtLeast(0.0) * 1000.0).toLong())
            .setPlaybackParameters(PlaybackParameters(MediaBridge.playbackRate))
            .setPlaybackState(state)
            .setSeekForwardIncrementMs(30_000L)
            .setSeekBackIncrementMs(15_000L)
            .setPlayWhenReady(MediaBridge.isPlaying, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .build()
    }

    override fun handlePrepare(): ListenableFuture<*> = voidFuture

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        MediaBridge.isPlaying = playWhenReady
        RemoteMediaSessionService.focusPolicy.onUserPlayback(playWhenReady)
        invalidateState()
        // Notification/assistant play-pause controls arrive as player calls
        // (not raw keycodes); surface them as the same normalized commands so
        // every entry point produces identical envelopes.
        onCommand(if (playWhenReady) "Play" else "Pause", null)
        return voidFuture
    }

    override fun handleStop(): ListenableFuture<*> {
        MediaBridge.isPlaying = false
        RemoteMediaSessionService.focusPolicy.onUserPlayback(false)
        invalidateState()
        onCommand("Pause", null)
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
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM -> "SeekTo"
            else -> null
        }
        if (command != null) onCommand(command, if (command == "SeekTo") positionMs / 1000.0 else null)
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
        private val startReferences = AtomicInteger(0)
        private var audioFocusRequest: AudioFocusRequest? = null
        private var wasPlayingBeforeInterruption = false
        private var ducked = false

        /**
         * Set when the service could only be started via
         * startForegroundService() (i.e. the app was in the background), which
         * obliges us to call startForeground() within the system's ~5s window.
         * In the normal foreground path we use plain startService() and let
         * Media3 own foreground promotion once the bridge player reports an
         * active/paused media session — no user-visible notification exists
         * before then.
         */
        @Volatile private var needsCompliantStartForeground = false

        val focusPolicy = MediaFocusStateMachine()

        /**
         * Must match androidx.media3.session.DefaultMediaNotificationProvider
         * .DEFAULT_NOTIFICATION_ID: the bootstrap notification below satisfies
         * the startForegroundService() contract immediately, and Media3's own
         * rich media notification (posted under this same id once playback is
         * active) replaces it seamlessly instead of stacking a second entry.
         */
        private const val FOREGROUND_NOTIFICATION_ID = 100
        private const val CHANNEL_ID = "plethora_media_session"

        fun start(ctx: Context) {
            startReferences.incrementAndGet()
            try {
                val intent = Intent(ctx, RemoteMediaSessionService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        // Normal path: the app is foregrounded when playback
                        // starts, so plain startService is legal and carries
                        // no startForeground obligation. Media3 promotes the
                        // service (and posts the media notification) when the
                        // forwarding player reports ready/playing state.
                        needsCompliantStartForeground = false
                        ctx.startService(intent)
                    } catch (e: IllegalStateException) {
                        // Backgrounded start (e.g. headset resume): the
                        // startForegroundService contract applies, so onCreate
                        // must post a compliant notification immediately.
                        Log.i(AndroidTtsPlugin.MEDIA_LOG_TAG,
                            "background start; using startForegroundService contract"
                        )
                        needsCompliantStartForeground = true
                        ctx.startForegroundService(intent)
                    }
                } else {
                    needsCompliantStartForeground = false
                    ctx.startService(intent)
                }
            } catch (e: Throwable) {
                Log.w(AndroidTtsPlugin.MEDIA_LOG_TAG, "start failed: ${e.message}")
            }
        }

        fun stop(ctx: Context) {
            if (startReferences.decrementAndGet() > 0) return
            startReferences.set(0)
            try {
                ctx.stopService(Intent(ctx, RemoteMediaSessionService::class.java))
            } catch (_: Throwable) {
            }
        }

        fun refresh() {
            bridgePlayer?.refreshState()
        }

        /** Test/diagnostics hook: current reference count. */
        fun referenceCount(): Int = startReferences.get()
    }

    private val audioManager: AudioManager by lazy {
        getSystemService(AUDIO_SERVICE) as AudioManager
    }
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
            if (focusPolicy.onHeadphoneDisconnect(MediaBridge.isPlaying) == MediaFocusAction.PAUSE) {
                wasPlayingBeforeInterruption = false
                MediaBridge.emitCommand(this@RemoteMediaSessionService, "Pause")
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        activeSession

    /**
     * Post a minimal silent notification and enter foreground right away.
     * Media3's DefaultMediaNotificationProvider later replaces it (same
     * notification id) with the full media controls once playback starts.
     * Failure is non-fatal: without promotion the service degrades to a
     * background service instead of crashing the process.
     */
    private fun enterForegroundImmediately() {
        try {
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "Playback",
                        NotificationManager.IMPORTANCE_LOW,
                    )
                )
            }
            val smallIcon = applicationInfo.icon.takeIf { it != 0 }
                ?: android.R.drawable.ic_media_play
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
                .setContentTitle(MediaBridge.title)
                .setContentText("Playback session active")
                .setSmallIcon(smallIcon)
                .setOngoing(true)
                .setContentIntent(
                    PendingIntent.getActivity(
                        this,
                        0,
                        packageManager.getLaunchIntentForPackage(packageName),
                        PendingIntent.FLAG_IMMUTABLE,
                    )
                )
            val notification: Notification = builder.build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    FOREGROUND_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification)
            }
        } catch (e: Throwable) {
            Log.w(AndroidTtsPlugin.MEDIA_LOG_TAG, "foreground promotion failed: ${e.message}")
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(AndroidTtsPlugin.MEDIA_LOG_TAG, "service created")
        // Only satisfy the startForegroundService() contract when it actually
        // applies (backgrounded start). In the normal foreground path Media3
        // owns promotion once the bridge player reports ready/playing, so no
        // user-visible notification exists before a real media session does.
        if (needsCompliantStartForeground) {
            enterForegroundImmediately()
        }
        // Everything here must be non-fatal: a foreground service refusal must
        // degrade to "no native media session" rather than crash the process.
        try {
            val player = WebViewBridgePlayer(this) { command, positionSec ->
                MediaBridge.emitCommand(this, command, positionSec)
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
                                when (command) {
                                    "Play" -> focusPolicy.onUserPlayback(true)
                                    "Pause" -> focusPolicy.onUserPlayback(false)
                                    "TogglePlayPause" -> focusPolicy.onUserPlayback(!MediaBridge.isPlaying)
                                    else -> Unit
                                }
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
            Log.i(
                AndroidTtsPlugin.MEDIA_LOG_TAG,
                "session created source=${MediaBridge.sourceId} " +
                    "state=${MediaBridge.playbackState} playing=${MediaBridge.isPlaying}"
            )

            player.setAudioAttributes(
                Media3AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                /* handleAudioFocus = */ false, // focus handled natively below
            )

            requestFocus()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(
                    noisyReceiver,
                    IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                    Context.RECEIVER_NOT_EXPORTED,
                )
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
            }
        } catch (e: Throwable) {
            Log.w(AndroidTtsPlugin.MEDIA_LOG_TAG, "create failed: ${e.message}")
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
                        wasPlayingBeforeInterruption = false
                        ducked = false
                        MediaBridge.emitAudioFocusState(this, "lost")
                        if (focusPolicy.onPermanentLoss(MediaBridge.isPlaying) == MediaFocusAction.STOP) {
                            MediaBridge.emitCommand(this, "Pause")
                        }
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                        val action = focusPolicy.onTransientLoss(MediaBridge.isPlaying)
                        wasPlayingBeforeInterruption = action == MediaFocusAction.PAUSE
                        MediaBridge.emitAudioFocusState(this, "transient_loss")
                        if (action == MediaFocusAction.PAUSE) MediaBridge.emitCommand(this, "Pause")
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        ducked = focusPolicy.onDuck(MediaBridge.isPlaying) == MediaFocusAction.DUCK
                        MediaBridge.emitAudioFocusState(this, "duck")
                    }
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        val action = focusPolicy.onGain(MediaBridge.isPlaying)
                        val shouldResume = action == MediaFocusAction.RESTORE
                        wasPlayingBeforeInterruption = false
                        if (ducked) {
                            ducked = false
                            MediaBridge.emitAudioFocusState(this, "gain")
                        }
                        if (shouldResume && !MediaBridge.isPlaying) {
                            MediaBridge.emitCommand(this, "Play")
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(listener)
                    .build()
                audioFocusRequest = request
                audioManager.requestAudioFocus(request)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(listener, android.media.AudioAttributes.USAGE_MEDIA, AudioManager.AUDIOFOCUS_GAIN)
            }
        } catch (e: Throwable) {
            Log.w(AndroidTtsPlugin.MEDIA_LOG_TAG, "focus request failed: ${e.message}")
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
        Log.i(AndroidTtsPlugin.MEDIA_LOG_TAG, "service destroyed (session teardown)")
        abandonFocus()
        try {
            unregisterReceiver(noisyReceiver)
        } catch (_: Throwable) {
        }
        try {
            activeSession?.release()
        } catch (_: Throwable) {
        }
        activeSession = null
        bridgePlayer = null
        startReferences.set(0)
        super.onDestroy()
    }
}
