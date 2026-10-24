package com.plethora.androidtts

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID

/** Ordinary audio owner, constructed/released by the existing MediaSessionService only. */
@OptIn(UnstableApi::class)
internal class PlaybackCoordinator(
    context: Context,
    private val requestFocus: () -> Boolean,
    private val observe: (JSONObject) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val journal = AudioPlaybackJournal(app)
    private val ownerEpoch = UUID.randomUUID().toString()
    private var ownerSequence = 0L
    private val decoder = ExoPlayer.Builder(app).setLooper(Looper.getMainLooper())
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), false)
        .setWakeMode(C.WAKE_MODE_LOCAL).build()
    private var manifest: JSONObject? = null
    private var sessionId = ""
    private var generation = 0L
    private var revision = 0L
    private var sequence = 0L
    private var userRevision = 0L
    private val focusPolicy = MediaFocusStateMachine()
    private var userVolume = 1.0f
    private var ducked = false
    private var resumeInterruption: Pair<Long, Long>? = null
    private var pauseReason: String? = null
    private var failure: JSONObject? = null
    private var sleepDeadline: Long? = null
    private var lastCheckpoint = ""
    private var lastCheckpointAt = 0L
    private var observing = false
    private var observedSession = ""
    private var disposed = false
    private var retryAt: Long? = null
    private var retryAttempt = 0
    private var commandInProgress = false
    private var loading = false
    private var endedSession = ""
    private var lastAppliedReceipt: JSONObject? = null
    private var queueKeys = JSONArray()
    private val preparedQueue = mutableMapOf<String, JSONObject>()
    private var studyConfig: JSONObject? = null

    /** Session commands enter the same journaled authority as frontend/system RPCs. */
    val sessionPlayer: Player = object : ForwardingPlayer(decoder) {
        override fun play() { transport("Play") }
        override fun pause() { transport("Pause") }
        override fun setPlayWhenReady(playWhenReady: Boolean) { transport(if (playWhenReady) "Play" else "Pause") }
        override fun seekTo(positionMs: Long) { systemPartSeek(decoder.currentMediaItemIndex, positionMs / 1000.0) }
        override fun seekTo(mediaItemIndex: Int, positionMs: Long) { systemPartSeek(mediaItemIndex, positionMs / 1000.0) }
        override fun seekForward() { transport("SeekForward") }
        override fun seekBack() { transport("SeekBackward") }
        override fun seekToNextMediaItem() { transport("Next") }
        override fun seekToPreviousMediaItem() { transport("Previous") }
        override fun setPlaybackSpeed(speed: Float) { systemAction(UUID.randomUUID().toString()) { setRate(speed.toDouble()) } }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (disposed) return
            if (manifest != null) {
                if (sleepExpired() && decoder.playWhenReady) systemAction { pause("sleep") }
                if (retryAt?.let { now() >= it } == true) {
                    retryAt = null
                    try { checkpoint() } catch (error: Throwable) { reportFailure(error) }
                } else if (decoder.isPlaying && now() - lastCheckpointAt >= 5000) {
                    try { checkpoint() } catch (error: Throwable) { reportFailure(error) }
                }
                if (observing && decoder.isPlaying) publish()
            }
            handler.postDelayed(this, 1000)
        }
    }

    init {
        checkMain()
        decoder.addListener(object : Player.Listener {
            override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                if (manifest == null) return
                val window = Timeline.Window()
                for (index in 0 until minOf(timeline.windowCount, parts().length())) {
                    val milliseconds = timeline.getWindow(index, window).durationMs
                    if (milliseconds != C.TIME_UNSET && milliseconds >= 0) parts().getJSONObject(index).put("durationSec", milliseconds / 1000.0)
                }
            }
            override fun onEvents(player: Player, events: Player.Events) {
                if (manifest == null || disposed || loading) return
                if (sleepExpired()) systemAction { pause("sleep") }
                if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) || events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)) {
                    if (decoder.playbackState == Player.STATE_ENDED) {
                        systemAction { sourceEnded() }
                        return
                    }
                    if (retryAt == null) try { checkpoint() } catch (error: Throwable) { reportFailure(error) }
                    publish()
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                if (disposed) return
                failure = JSONObject().put("code", "corrupt_media").put("message", error.message ?: "Audio decoding failed")
                decoder.pause()
                try { checkpoint() } catch (failure: Throwable) { reportFailure(failure) }
                publish()
            }
        })
        handler.post(tick)
    }

    private fun checkMain() { check(Looper.myLooper() == Looper.getMainLooper()) { "Audio command must run on the service main looper" } }
    private fun parts(): JSONArray = manifest!!.getJSONArray("parts")
    private fun source(): JSONObject = manifest!!.getJSONObject("sourceKey")
    private fun profile(): String = source().getString("profileKey")
    private fun number(value: JSONObject, key: String): Double? = if (value.isNull(key)) null else value.optDouble(key).takeIf { it.isFinite() && it >= 0 }
    private fun globalStart(index: Int): Double? {
        var sum = 0.0
        for (part in 0 until index) sum += number(parts().getJSONObject(part), "durationSec") ?: return null
        return sum
    }
    private fun duration(): Double? {
        var sum = 0.0
        for (index in 0 until parts().length()) sum += number(parts().getJSONObject(index), "durationSec") ?: return null
        return sum
    }
    private fun sleepExpired(): Boolean = sleepDeadline?.let { now() >= it } ?: false

    /** The Rust bridge must mint/consume authorization before this internal service entry point. */
    fun loadAuthorized(item: JSONObject, intent: String, partIndex: Int = 0, localSeconds: Double = 0.0, requestGeneration: Long? = null, continuation: Boolean = false): JSONObject {
        checkMain()
        require(item.getInt("schemaVersion") == 1 && intent in setOf("play", "paused"))
        val playlist = item.getJSONArray("parts")
        require(playlist.length() in 1..4096 && partIndex in 0 until playlist.length())
        require(localSeconds.isFinite() && localSeconds >= 0)
        require(requestGeneration == null || requestGeneration > generation) { "Stale audio load generation" }
        journal.ensureCapacity(item.getJSONObject("sourceKey"))
        val media = (0 until playlist.length()).map { index ->
            val part = playlist.getJSONObject(index)
            val uri = Uri.parse(part.getString("nativeUri"))
            require(uri.scheme in setOf("file", "content", "https", "http")) { "Unsupported native audio URI" }
            if (uri.scheme == "file") require(File(uri.path!!).isFile) { "Native audio file missing" }
            if (uri.scheme == "content") require(app.contentResolver.persistedUriPermissions.any { it.isReadPermission && it.uri == uri }) { "Audio content permission unavailable" }
            MediaItem.Builder().setMediaId(part.getString("partId")).setUri(uri)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(part.optString("title", item.getString("title"))).setArtist(item.optString("artist", "Plethora")).build()).build()
        }
        loading = true
        try {
        decoder.pause()
        check(!decoder.playWhenReady) { "Previous audio did not pause" }
        checkpoint(captureTransition = true)
        if (!continuation) installQueue(item)
        ownerSequence = journal.beginOwner(item.getJSONObject("sourceKey").getString("profileKey"), ownerEpoch)
        generation = requestGeneration ?: generation + 1
        userRevision++
        focusPolicy.onUserPlayback(false)
        ducked = false
        decoder.volume = userVolume
        resumeInterruption = null
        if (!continuation) sleepDeadline = null
        manifest = JSONObject(item.toString()).also { it.remove("queueEntries"); it.remove("queueKeys") }
        if (!continuation) studyConfig = item.optJSONObject("studyConfig")
        else if (item.has("studyConfig")) studyConfig = item.optJSONObject("studyConfig")
        endedSession = ""
        sessionId = UUID.randomUUID().toString()
        failure = null
        pauseReason = "user"
        lastCheckpoint = ""
        decoder.setMediaItems(media, partIndex, (localSeconds * 1000).toLong())
        decoder.prepare()
        checkpoint()
        if (intent == "play" && !sleepExpired()) play()
        else if (sleepExpired()) pauseReason = "sleep"
        } finally { loading = false }
        return publish()
    }

    fun snapshot(): JSONObject? {
        checkMain()
        val item = manifest ?: return null
        val index = decoder.currentMediaItemIndex.coerceIn(0, parts().length() - 1)
        val local = decoder.currentPosition.coerceAtLeast(0) / 1000.0
        val start = globalStart(index)
        val global = start?.plus(local)
        val state = when {
            failure != null -> "error"
            decoder.playbackState == Player.STATE_ENDED -> "ended"
            decoder.playWhenReady && decoder.playbackState == Player.STATE_BUFFERING -> "buffering"
            decoder.isPlaying -> "playing"
            else -> "paused"
        }
        return JSONObject().put("schemaVersion", 1).put("sourceKey", JSONObject(source().toString()))
            .put("metadata", JSONObject().put("sourceId", source().getString("sourceId")).put("sourceKind", source().getString("kind")).put("sessionId", sessionId).put("title", item.getString("title")).put("artist", item.optString("artist", "Plethora")).also { if (!item.isNull("artworkUrl")) it.put("artworkUrl", item.getString("artworkUrl")) })
            .put("queue", JSONArray(queueKeys.toString()))
            .put("generation", generation).put("revision", revision).put("state", state)
            .put("ownerEpoch", ownerEpoch)
            .put("ownerSequence", ownerSequence)
            .put("playIntent", decoder.playWhenReady).put("pauseReason", pauseReason ?: JSONObject.NULL)
            .put("partIndex", index).put("timeInPart", local).put("globalPositionSec", global ?: JSONObject.NULL)
            .put("positionSec", global ?: local).put("durationSec", duration() ?: JSONObject.NULL)
            .put("playbackRate", decoder.playbackParameters.speed.toDouble()).put("volume", userVolume.toDouble())
            .put("mediaRevision", item.getString("mediaRevision")).put("checkpointSequence", sequence)
            .put("section", JSONObject().put("id", parts().getJSONObject(index).getString("partId")).put("index", index).put("title", parts().getJSONObject(index).optString("title", item.getString("title"))))
            .put("sleepDeadlineMs", sleepDeadline ?: JSONObject.NULL).put("updatedAt", now())
            .put("capabilities", JSONObject().put("canPlay", true).put("canPause", true).put("canResume", true)
                .put("canSeekRelative", decoder.isCurrentMediaItemSeekable).put("canSeekAbsolute", start != null && decoder.isCurrentMediaItemSeekable)
                .put("precisePosition", true).put("canNext", index + 1 < parts().length()).put("canPrevious", index > 0))
            .also { if (failure != null) it.put("error", failure) }
    }

    private fun publish(): JSONObject {
        if (commandInProgress) return snapshot() ?: JSONObject()
        revision++
        val value = snapshot() ?: JSONObject().put("schemaVersion", 1).put("ownerEpoch", ownerEpoch).put("ownerSequence", ownerSequence).put("generation", generation).put("revision", revision).put("snapshot", JSONObject.NULL)
        val receipt = lastAppliedReceipt
        lastAppliedReceipt = null
        if (receipt != null) value.put("appliedTransport", receipt)
        if (observing) {
            // Emit bounded presentation metadata on source changes only, never
            // the prepared queue URIs and never the whole manifest on ticks.
            if (manifest != null && observedSession != sessionId) { value.put("item", describe()); observedSession = sessionId }
            observe(value)
        }
        return value
    }

    /** Reattachment metadata excludes decoder locations and all transcript text. */
    fun describe(): JSONObject? {
        checkMain()
        val item = manifest ?: return null
        val summary = JSONObject(item.toString())
        summary.remove("schemaVersion")
        val summaryParts = summary.getJSONArray("parts")
        for (index in 0 until summaryParts.length()) {
            summaryParts.getJSONObject(index).remove("nativeUri")
            summaryParts.getJSONObject(index).put("globalStartSec", globalStart(index) ?: JSONObject.NULL)
        }
        return summary
    }

    private fun checkpoint(requestId: String? = null, closeSession: Boolean = false, captureTransition: Boolean = false) {
        if (commandInProgress && requestId == null && !captureTransition) return
        val value = snapshot() ?: return
        val signature = JSONArray().put(queueKeys).put(value.getInt("partIndex")).put(value.getDouble("timeInPart")).put(value.get("durationSec")).put(value.getDouble("playbackRate")).put(value.getDouble("volume")).put(sleepDeadline ?: JSONObject.NULL).put(value.getBoolean("playIntent")).put(value.opt("pauseReason")).put(closeSession).toString()
        if (requestId == null && signature == lastCheckpoint) return
        val key = value.getJSONObject("sourceKey")
        val checkpoint = JSONObject().put("schemaVersion", 1).put("sourceKey", key).put("ownerEpoch", ownerEpoch)
            .put("checkpointSequence", sequence + 1).put("sessionId", sessionId).put("mediaRevision", value.getString("mediaRevision"))
            .put("partIndex", value.getInt("partIndex")).put("timeInPart", value.getDouble("timeInPart"))
            .put("positionSec", value.get("globalPositionSec")).put("durationSec", value.get("durationSec"))
            .put("playbackRate", value.getDouble("playbackRate")).put("updatedAt", now())
        val session = JSONObject().put("schemaVersion", 1).put("current", if (closeSession) JSONObject.NULL else key).put("queue", JSONArray(queueKeys.toString()))
            .put("playbackRate", value.getDouble("playbackRate")).put("volume", value.getDouble("volume"))
            .put("sleepDeadlineMs", sleepDeadline ?: JSONObject.NULL).put("updatedAt", now())
        journal.checkpoint(checkpoint, session, requestId)
        sequence++
        lastCheckpoint = signature
        lastCheckpointAt = now()
        retryAt = null
        retryAttempt = 0
        if (failure?.optString("code") == "persistence") failure = null
    }

    fun play() {
        checkMain()
        check(manifest != null) { "No native audio session" }
        userRevision++
        focusPolicy.onUserPlayback(true)
        resumeInterruption = null
        if (sleepExpired()) sleepDeadline = null
        if (decoder.playWhenReady) return
        check(requestFocus()) { "Audio focus or foreground service unavailable" }
        if (decoder.playbackState == Player.STATE_ENDED) { endedSession = ""; decoder.seekTo(0, 0) }
        pauseReason = null
        failure = null
        decoder.play()
        checkpoint()
        publish()
    }

    fun pause(reason: String = "user") {
        checkMain()
        if (reason != "focus") { userRevision++; resumeInterruption = null; focusPolicy.onUserPlayback(false) }
        decoder.pause()
        pauseReason = reason
        checkpoint()
        publish()
    }

    fun selectPart(index: Int, local: Double) {
        checkMain()
        require(index in 0 until parts().length() && local.isFinite() && local >= 0)
        decoder.seekTo(index, (local * 1000).toLong())
        checkpoint()
        publish()
    }

    private fun systemPartSeek(index: Int, local: Double) {
        val requestId = UUID.randomUUID().toString()
        lastAppliedReceipt = JSONObject().put("eventId", requestId).put("command", "SeekTo").put("transportApplied", true).put("occurredAt", now())
        systemAction(requestId) {
            selectPart(index, local)
        }
    }

    private fun seek(seconds: Double) {
        require(seconds.isFinite())
        val target = seconds.coerceAtLeast(0.0).coerceAtMost(duration() ?: Double.MAX_VALUE)
        for (index in parts().length() - 1 downTo 0) {
            val start = globalStart(index) ?: continue
            if (target >= start) {
                val length = number(parts().getJSONObject(index), "durationSec")
                require(length == null || target - start <= length) { "Cannot seek across an unknown part boundary" }
                selectPart(index, target - start)
                return
            }
        }
        error("Cannot seek across an unknown part boundary")
    }

    fun setRate(rate: Double) {
        checkMain()
        require(rate.isFinite() && rate in 0.5..3.0)
        decoder.setPlaybackSpeed(rate.toFloat())
        checkpoint()
        publish()
    }

    fun setVolume(volume: Double) {
        checkMain()
        require(volume.isFinite() && volume in 0.0..1.0)
        userVolume = volume.toFloat()
        decoder.volume = userVolume * if (ducked) 0.2f else 1.0f
        checkpoint()
        publish()
    }

    fun stopAndClose(requestId: String) {
        checkMain()
        decoder.pause()
        resumeInterruption = null
        focusPolicy.onUserPlayback(false)
        sleepDeadline = null
        pauseReason = "user"
        checkpoint(requestId, closeSession = true)
        generation++
        decoder.stop()
        decoder.clearMediaItems()
        manifest = null
        queueKeys = JSONArray(); preparedQueue.clear()
        publish()
    }

    fun setSleep(deadline: Long?) {
        checkMain()
        require(deadline == null || deadline >= 0)
        sleepDeadline = deadline
        checkpoint()
        if (sleepExpired()) pause("sleep")
        publish()
    }

    fun command(request: JSONObject): JSONObject {
        checkMain()
        require(request.getInt("schemaVersion") == 1)
        val id = request.getString("requestId")
        if (manifest == null || request.getString("sessionId") != sessionId || request.getLong("generation") != generation || (request.has("expectedRevision") && request.getLong("expectedRevision") != revision)) return JSONObject().put("disposition", "stale").put("snapshot", snapshot() ?: JSONObject.NULL)
        if (journal.hasReceipt(profile(), id)) return JSONObject().put("disposition", "duplicate").put("snapshot", snapshot())
        val action = request.getJSONObject("action")
        return systemAction(id) {
            when (action.getString("command")) {
                "play" -> play()
                "pause" -> {
                    val reason = action.optString("reason", "user")
                    require(reason in setOf("user", "focus", "headphones", "sleep", "source-switch", "suspend", "account", "ended"))
                    // Application focus revocation must invalidate a pending OS interruption resume.
                    userRevision++
                    resumeInterruption = null
                    focusPolicy.onUserPlayback(false)
                    pause(reason)
                }
                "toggle" -> if (decoder.playWhenReady) pause() else play()
                "seekTo" -> seek(action.getDouble("value"))
                "seekRelative" -> {
                    val delta = action.getDouble("value")
                    require(delta.isFinite())
                    val current = snapshot()!!
                    if (current.isNull("globalPositionSec")) selectPart(decoder.currentMediaItemIndex, (current.getDouble("timeInPart") + delta).coerceAtLeast(0.0)) else seek(current.getDouble("globalPositionSec") + delta)
                }
                "setRate" -> setRate(action.getDouble("value"))
                "setVolume" -> setVolume(action.getDouble("value"))
                "sleep" -> setSleep(if (action.isNull("deadlineMs")) null else action.getLong("deadlineMs"))
                "next" -> selectPart(decoder.currentMediaItemIndex + 1, 0.0)
                "previous" -> selectPart(decoder.currentMediaItemIndex - 1, 0.0)
                "selectChapter" -> selectPart(action.getInt("index"), 0.0)
                "queueNext" -> moveQueue(1, decoder.playWhenReady)
                "queuePrevious" -> moveQueue(-1, decoder.playWhenReady)
                "stop" -> stopAndClose(id)
                else -> error("Unsupported native command")
            }
        }
    }

    private fun defaultStudyAction(key: String): String = when (key) {
        "next" -> "save_recent_extract"
        "previous" -> "replay_recent_passage"
        "seekForward" -> "skip_forward"
        "seekBackward" -> "skip_backward"
        else -> "none"
    }

    /** Press-time Study Mode mapping; transport commands are never remapped. */
    private fun studyActionFor(command: String): String? {
        val config = studyConfig ?: return null
        if (!config.optBoolean("enabled", false)) return null
        val key = when (command) {
            "Next" -> "next"
            "Previous" -> "previous"
            "SeekForward" -> "seekForward"
            "SeekBackward" -> "seekBackward"
            else -> return null
        }
        val mappings = config.optJSONObject("mappings")
        return (mappings?.optString(key)?.takeIf { it.isNotBlank() } ?: defaultStudyAction(key))
    }

    private fun isDeferredStudyAction(action: String): Boolean =
        action in setOf("save_recent_extract", "bookmark", "mark_interesting", "mark_confusing", "ask_plethora")

    /** Navigation study actions execute here; capture actions stay durable until JS is available. */
    private fun applyStudyAction(action: String) {
        val window = studyConfig?.optInt("captureWindowSec", 30)?.coerceIn(1, 120) ?: 30
        when (action) {
            "replay_recent_passage" -> seekByDelta(-window.toDouble())
            "skip_forward" -> seekByDelta(30.0)
            "skip_backward" -> seekByDelta(-15.0)
            "next_chapter" -> {
                val next = decoder.currentMediaItemIndex + 1
                if (next < parts().length()) selectPart(next, 0.0)
            }
            "previous_chapter" -> {
                val previous = decoder.currentMediaItemIndex - 1
                if (previous >= 0) selectPart(previous, 0.0)
            }
            else -> Unit
        }
    }

    private fun seekByDelta(delta: Double) {
        val current = snapshot() ?: return
        if (current.isNull("globalPositionSec")) selectPart(decoder.currentMediaItemIndex, (current.getDouble("timeInPart") + delta).coerceAtLeast(0.0))
        else seek(current.getDouble("globalPositionSec") + delta)
    }

    /** Journals the original press-time source/part/anchor before any JS observer exists. */
    private fun queueDeferredCapture(command: String, action: String, requestId: String): JSONObject = try {
        val index = decoder.currentMediaItemIndex.coerceIn(0, parts().length() - 1)
        val local = decoder.currentPosition.coerceAtLeast(0) / 1000.0
        val part = parts().getJSONObject(index)
        val current = snapshot()
        val envelope = JSONObject()
            .put("eventId", requestId)
            .put("command", command)
            .put("studyAction", action)
            .put("sourceKey", JSONObject(source().toString()))
            .put("sessionId", sessionId)
            .put("generation", generation)
            .put("section", JSONObject()
                .put("id", part.getString("partId"))
                .put("index", index)
                .put("title", part.optString("title", manifest!!.optString("title", ""))))
            .put("partIndex", index)
            .put("positionHintSec", local)
            .put("positionSec", current?.let { if (it.isNull("globalPositionSec")) JSONObject.NULL else it.getDouble("globalPositionSec") } ?: JSONObject.NULL)
            .put("occurredAt", now())
        journal.capture(profile(), envelope)
        lastAppliedReceipt = null
        JSONObject().put("disposition", "accepted").put("eventId", requestId)
            .put("captureQueued", true).put("snapshot", snapshot() ?: JSONObject.NULL)
    } catch (error: Throwable) {
        reportFailure(error)
        JSONObject().put("disposition", "failed").put("error", failure).put("snapshot", snapshot())
    }

    fun transport(command: String, seconds: Double? = null, requestId: String = UUID.randomUUID().toString()): JSONObject {
        checkMain()
        if (manifest == null) return JSONObject().put("disposition", "stale")
        if (journal.hasReceipt(profile(), requestId)) return JSONObject().put("disposition", "duplicate").put("snapshot", snapshot())
        val study = studyActionFor(command)
        if (study != null && isDeferredStudyAction(study)) return queueDeferredCapture(command, study, requestId)
        if (study == "none") {
            lastAppliedReceipt = null
            return JSONObject().put("disposition", "accepted").put("eventId", requestId).put("snapshot", snapshot())
        }
        lastAppliedReceipt = JSONObject().put("eventId", requestId).put("command", command).put("transportApplied", true).put("occurredAt", now())
        return systemAction(requestId) {
        if (study != null) {
            applyStudyAction(study)
            return@systemAction
        }
        when (command) {
            "Play" -> play()
            "Pause" -> pause()
            "TogglePlayPause" -> if (decoder.playWhenReady) pause() else play()
            "SeekTo" -> seek(requireNotNull(seconds))
            "SeekForward", "SeekBackward" -> seekByDelta(if (command == "SeekForward") 30.0 else -15.0)
            "Next" -> {
                val nextIndex = decoder.currentMediaItemIndex + 1
                if (nextIndex < parts().length()) selectPart(nextIndex, 0.0)
                else moveQueue(1, decoder.playWhenReady)
            }
            "Previous" -> {
                val prevIndex = decoder.currentMediaItemIndex - 1
                if (prevIndex >= 0) selectPart(prevIndex, 0.0)
                else selectPart(0, 0.0)
            }
            else -> error("Unsupported native transport")
        }
        }.also { result ->
            result.put("eventId", requestId)
            if (result.optString("disposition") == "accepted") result.put("transportApplied", true)
            else lastAppliedReceipt = null
        }
    }

    private fun identity(key: JSONObject): String = JSONArray().put(key.getString("profileKey")).put(key.getString("kind")).put(key.getString("sourceId")).toString()

    private fun installQueue(item: JSONObject) {
        val current = item.getJSONObject("sourceKey")
        val keys = item.optJSONArray("queueKeys") ?: JSONArray()
        require(keys.length() <= 128) { "Audio queue is too large" }
        val seen = mutableSetOf<String>()
        for (index in 0 until keys.length()) {
            val key = keys.getJSONObject(index)
            require(key.getString("profileKey") == current.getString("profileKey") && seen.add(identity(key))) { "Invalid audio queue identity" }
        }
        require(keys.length() == 0 || seen.contains(identity(current))) { "Audio queue does not contain current source" }
        val ready = mutableMapOf<String, JSONObject>()
        val entries = item.optJSONArray("queueEntries") ?: JSONArray()
        require(entries.length() <= 128)
        for (index in 0 until entries.length()) {
            val entry = entries.getJSONObject(index)
            val id = identity(entry.getJSONObject("sourceKey"))
            require(seen.contains(id)) { "Prepared audio is outside this queue" }
            ready[id] = JSONObject(entry.toString())
        }
        val summary = JSONObject(item.toString()).also { it.remove("queueEntries"); it.remove("queueKeys") }
        ready[identity(current)] = summary
        queueKeys = JSONArray(keys.toString())
        preparedQueue.clear(); preparedQueue.putAll(ready)
    }

    internal fun sourceEnded(expectedGeneration: Long = generation) {
        if (manifest == null || expectedGeneration != generation || endedSession == sessionId) return
        endedSession = sessionId
        val continuePlaying = decoder.playWhenReady && !sleepExpired()
        decoder.pause()
        pauseReason = if (sleepExpired()) "sleep" else "ended"
        checkpoint()
        if (!continuePlaying) { publish(); return }
        if (!manifest!!.optBoolean("complete", true)) {
            preparationBoundary()
            return
        }
        if (!moveQueue(1, true)) publish()
    }

    private fun preparationBoundary() {
        decoder.pause()
        pauseReason = "ended"
        failure = JSONObject().put("code", "source_missing").put("message", "Open Plethora to prepare the next section")
        checkpoint()
        publish()
    }

    private fun moveQueue(direction: Int, play: Boolean): Boolean {
        val id = identity(source())
        val index = (0 until queueKeys.length()).firstOrNull { identity(queueKeys.getJSONObject(it)) == id } ?: return false
        val next = index + direction
        if (next !in 0 until queueKeys.length()) return false
        val item = preparedQueue[identity(queueKeys.getJSONObject(next))]
        if (item == null) { preparationBoundary(); return false }
        loadAuthorized(item, if (play && !sleepExpired()) "play" else "paused", requestGeneration = generation + 1, continuation = true)
        return true
    }

    private fun reportFailure(error: Throwable) {
        resumeInterruption = null
        focusPolicy.onUserPlayback(false)
        failure = JSONObject().put("code", if (error is IOException) "persistence" else "focus_denied").put("message", error.message ?: "Audio command failed")
        if (decoder.playWhenReady) decoder.pause()
        if (error is IOException && retryAt == null) {
            val delays = longArrayOf(1000, 2000, 4000, 8000, 30000)
            if (retryAttempt < delays.size) retryAt = now() + delays[retryAttempt++]
        }
        publish()
    }

    private fun systemAction(requestId: String? = null, action: () -> Unit): JSONObject = try {
        val previous = commandInProgress
        commandInProgress = previous || requestId != null
        try { action() } finally { commandInProgress = previous }
        if (requestId != null) checkpoint(requestId)
        publish()
        JSONObject().put("disposition", "accepted").put("snapshot", snapshot() ?: JSONObject.NULL)
    } catch (error: Throwable) {
        lastAppliedReceipt = null
        reportFailure(error)
        JSONObject().put("disposition", "failed").put("error", failure).put("snapshot", snapshot())
    }

    fun onFocusTransient() {
        checkMain()
        if (focusPolicy.onTransientLoss(decoder.playWhenReady) == MediaFocusAction.PAUSE) {
            resumeInterruption = generation to userRevision
            systemAction { pause("focus") }
        }
    }

    fun onFocusPermanent() {
        checkMain()
        focusPolicy.onPermanentLoss(decoder.playWhenReady)
        resumeInterruption = null
        ducked = false
        decoder.volume = userVolume
        systemAction { pause("focus") }
    }

    fun onHeadphoneDisconnect() {
        checkMain()
        resumeInterruption = null
        if (focusPolicy.onHeadphoneDisconnect(decoder.playWhenReady) == MediaFocusAction.PAUSE) {
            systemAction { pause("headphones") }
        }
    }

    fun onDuck() {
        checkMain()
        if (focusPolicy.onDuck(decoder.playWhenReady) == MediaFocusAction.DUCK) {
            ducked = true
            decoder.volume = userVolume * 0.2f
            publish()
        }
    }

    fun onFocusGain() {
        checkMain()
        val resume = resumeInterruption
        resumeInterruption = null
        val action = focusPolicy.onGain(decoder.playWhenReady)
        if (ducked) { ducked = false; decoder.volume = userVolume; publish() }
        if (action == MediaFocusAction.RESTORE && resume != null && resume.first == generation && resume.second == userRevision) {
            decoder.play()
            pauseReason = null
            try { checkpoint() } catch (error: Throwable) { reportFailure(error) }
            publish()
        }
    }

    fun setObserving(enabled: Boolean) { checkMain(); observing = enabled }
    fun dirtyJournal(profile: String): JSONObject { checkMain(); return journal.snapshot(profile) }
    fun acknowledge(source: JSONObject, epoch: String, sequence: Long): Boolean { checkMain(); return journal.acknowledge(source, epoch, sequence) }
    fun acknowledgeBatch(cursors: JSONArray): Int { checkMain(); return journal.acknowledgeBatch(cursors) }



    fun dispose() {
        checkMain()
        decoder.pause()
        try { checkpoint() } finally {
            disposed = true
            resumeInterruption = null
            observing = false
            handler.removeCallbacks(tick)
            decoder.release()
            manifest = null
        }
    }
}
