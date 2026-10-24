package com.plethora.androidtts

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

/** Service-owned progress storage. Dirty entries are never evicted to make room. */
class AudioPlaybackJournal(context: Context) {
    companion object {
        const val MAX_CHECKPOINTS = 128
        const val MAX_RECEIPTS = 256
        const val MAX_CAPTURES = 256
        const val FILE_NAME = "audio_playback_v1.json"
    }

    private val file = AtomicFile(File(context.applicationContext.filesDir, FILE_NAME))
    private var state: JSONObject = read()

    private fun empty(): JSONObject = JSONObject()
        .put("schemaVersion", 1).put("checkpoints", JSONObject())
        .put("sessions", JSONObject()).put("receipts", JSONArray()).put("captures", JSONArray())
        .put("owners", JSONObject())

    private fun read(): JSONObject {
        val bytes = try { file.readFully() } catch (error: FileNotFoundException) {
            if (file.baseFile.exists()) throw error
            return empty()
        }
        require(bytes.size <= 4 * 1024 * 1024) { "Audio journal exceeds storage limit" }
        val value = JSONObject(String(bytes, Charsets.UTF_8))
        require(value.getInt("schemaVersion") == 1) { "Unsupported audio journal version" }
        require(value.getJSONObject("checkpoints").length() <= MAX_CHECKPOINTS)
        require(value.getJSONArray("receipts").length() <= MAX_RECEIPTS)
        require(value.getJSONArray("captures").length() <= MAX_CAPTURES)
        if (!value.has("owners")) value.put("owners", JSONObject())
        return value
    }

    private fun persist(next: JSONObject) {
        val bytes = next.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= 4 * 1024 * 1024) { "Audio journal exceeds storage limit" }
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
            state = next
        } catch (error: Throwable) {
            file.failWrite(stream)
            throw error
        }
    }

    private fun copy(): JSONObject = JSONObject(state.toString())
    private fun identity(source: JSONObject): String {
        require(source.getString("profileKey").isNotBlank())
        require(source.getString("sourceId").isNotBlank())
        require(source.getString("kind") in setOf("audiobook", "podcast", "audio_edition", "recording"))
        return JSONArray().put(source.getString("profileKey")).put(source.getString("kind")).put(source.getString("sourceId")).toString()
    }

    @Synchronized fun ensureCapacity(source: JSONObject) {
        val key = identity(source)
        val checkpoints = state.getJSONObject("checkpoints")
        check(checkpoints.has(key) || checkpoints.length() < MAX_CHECKPOINTS) { "Reconcile unsaved audio before loading another source" }
    }

    /** Durable per-profile handover counter orders incarnations without relying on the wall clock. */
    @Synchronized fun beginOwner(profile: String, epoch: String): Long {
        require(profile.isNotBlank() && epoch.isNotBlank())
        val owners = state.getJSONObject("owners")
        val current = owners.optJSONObject(profile)
        if (current?.getString("ownerEpoch") == epoch) return current.getLong("ownerSequence")
        check(owners.has(profile) || owners.length() < MAX_CHECKPOINTS) { "Audio profile storage is full" }
        val sequence = Math.addExact(current?.getLong("ownerSequence") ?: 0L, 1L)
        val next = copy()
        next.getJSONObject("owners").put(profile, JSONObject().put("ownerEpoch", epoch).put("ownerSequence", sequence))
        persist(next)
        return sequence
    }

    /** Commit before acknowledging a native pause/seek/source switch. No URI is journaled. */
    @Synchronized fun checkpoint(checkpoint: JSONObject, session: JSONObject, requestId: String? = null) {
        require(checkpoint.getInt("schemaVersion") == 1)
        val source = checkpoint.getJSONObject("sourceKey")
        ensureCapacity(source)
        require(checkpoint.getLong("checkpointSequence") >= 0)
        require(checkpoint.getDouble("timeInPart").let { it.isFinite() && it >= 0 })
        val existing = state.getJSONObject("checkpoints").optJSONObject(identity(source))
        if (existing != null && existing.getString("ownerEpoch") == checkpoint.getString("ownerEpoch") && existing.getLong("checkpointSequence") >= checkpoint.getLong("checkpointSequence")) return
        // Whitelist the durable wire fields. Resolved paths and signed URLs stay in memory.
        val fields = arrayOf("schemaVersion", "sourceKey", "ownerEpoch", "checkpointSequence", "sessionId", "mediaRevision", "partIndex", "timeInPart", "positionSec", "durationSec", "playbackRate", "updatedAt")
        val safe = JSONObject()
        fields.forEach { safe.put(it, checkpoint.get(it)) }
        safe.put("sourceKey", safeSource(source))
        val next = copy()
        next.getJSONObject("checkpoints").put(identity(source), safe)
        val sessions = next.getJSONObject("sessions")
        check(sessions.has(source.getString("profileKey")) || sessions.length() < MAX_CHECKPOINTS) { "Audio profile storage is full" }
        val safeSession = JSONObject()
        arrayOf("schemaVersion", "current", "queue", "playbackRate", "volume", "sleepDeadlineMs", "updatedAt").forEach { field ->
            if (session.has(field)) safeSession.put(field, session.get(field))
        }
        // Session callers supply identity-only current/queue records, never a resolved manifest.
        safeSession.optJSONObject("current")?.let { current ->
            require(current.getString("profileKey") == source.getString("profileKey"))
            safeSession.put("current", safeSource(current))
        }
        safeSession.optJSONArray("queue")?.let { queue ->
            require(queue.length() <= 256)
            val safeQueue = JSONArray()
            for (index in 0 until queue.length()) {
                val key = queue.getJSONObject(index)
                require(key.getString("profileKey") == source.getString("profileKey"))
                safeQueue.put(safeSource(key))
            }
            safeSession.put("queue", safeQueue)
        }
        next.getJSONObject("sessions").put(source.getString("profileKey"), safeSession)
        if (requestId != null) appendReceipt(next, source.getString("profileKey"), requestId)
        persist(next)
    }

    private fun safeSource(source: JSONObject): JSONObject {
        identity(source)
        return JSONObject().put("profileKey", source.getString("profileKey")).put("kind", source.getString("kind")).put("sourceId", source.getString("sourceId"))
    }

    private fun appendReceipt(next: JSONObject, profile: String, requestId: String) {
        require(requestId.isNotBlank() && requestId.length <= 512)
        val entries = next.getJSONArray("receipts")
        if ((0 until entries.length()).any { entries.getJSONObject(it).let { entry -> entry.getString("profileKey") == profile && entry.getString("requestId") == requestId } }) return
        entries.put(JSONObject().put("profileKey", profile).put("requestId", requestId))
        if (entries.length() > MAX_RECEIPTS) entries.remove(0)
    }

    @Synchronized fun hasReceipt(profile: String, requestId: String): Boolean {
        val entries = state.getJSONArray("receipts")
        return (0 until entries.length()).any { entries.getJSONObject(it).let { entry -> entry.getString("profileKey") == profile && entry.getString("requestId") == requestId } }
    }

    @Synchronized fun receipt(profile: String, requestId: String) {
        if (hasReceipt(profile, requestId)) return
        val next = copy()
        appendReceipt(next, profile, requestId)
        persist(next)
    }

    @Synchronized fun capture(profile: String, envelope: JSONObject) {
        val next = copy()
        val entries = next.getJSONArray("captures")
        val eventId = envelope.getString("eventId")
        require(eventId.isNotBlank() && eventId.length <= 512)
        if (hasReceipt(profile, eventId) || (0 until entries.length()).any { entries.getJSONObject(it).let { entry -> entry.getString("profileKey") == profile && entry.getString("eventId") == eventId } }) return
        check(entries.length() < MAX_CAPTURES) { "Reconcile pending study actions before capturing more" }
        val safe = JSONObject().put("profileKey", profile)
        arrayOf("eventId", "command", "studyAction", "sourceKey", "sessionId", "generation", "section", "partIndex", "positionHintSec", "positionSec", "occurredAt").forEach { field ->
            if (envelope.has(field)) safe.put(field, envelope.get(field))
        }
        safe.optJSONObject("sourceKey")?.let { key ->
            require(key.getString("profileKey") == profile)
            safe.put("sourceKey", safeSource(key))
        }
        entries.put(safe)
        appendReceipt(next, profile, eventId)
        persist(next)
    }

    @Synchronized fun acknowledgeCapture(profile: String, eventId: String): Boolean {
        val next = copy()
        val entries = next.getJSONArray("captures")
        val index = (0 until entries.length()).firstOrNull { entries.getJSONObject(it).let { entry -> entry.getString("profileKey") == profile && entry.getString("eventId") == eventId } } ?: return false
        entries.remove(index)
        persist(next)
        return true
    }

    /** Only an exact DB-committed cursor may clear a dirty record. */
    @Synchronized fun acknowledge(source: JSONObject, epoch: String, sequence: Long): Boolean {
        return acknowledgeBatch(JSONArray().put(JSONObject().put("sourceKey", source).put("ownerEpoch", epoch).put("checkpointSequence", sequence))) == 1
    }

    @Synchronized fun acknowledgeBatch(cursors: JSONArray): Int {
        require(cursors.length() <= MAX_CHECKPOINTS)
        val next = copy()
        val checkpoints = next.getJSONObject("checkpoints")
        var acknowledged = 0
        for (index in 0 until cursors.length()) {
            val cursor = cursors.getJSONObject(index)
            val key = identity(cursor.getJSONObject("sourceKey"))
            val checkpoint = checkpoints.optJSONObject(key) ?: continue
            if (checkpoint.getString("ownerEpoch") == cursor.getString("ownerEpoch") && checkpoint.getLong("checkpointSequence") == cursor.getLong("checkpointSequence")) {
                checkpoints.remove(key)
                acknowledged++
            }
        }
        if (acknowledged > 0) persist(next)
        return acknowledged
    }

    @Synchronized fun snapshot(profile: String): JSONObject {
        val session = state.getJSONObject("sessions").optJSONObject(profile)
        val result = JSONObject().put("schemaVersion", 1).put("session", if (session == null) JSONObject.NULL else JSONObject(session.toString()))
        val authority = state.getJSONObject("owners").optJSONObject(profile)
        result.put("authority", if (authority == null) JSONObject.NULL else JSONObject(authority.toString()))
        val checkpoints = JSONArray()
        val dirty = state.getJSONObject("checkpoints")
        dirty.keys().forEach { key ->
            val checkpoint = dirty.getJSONObject(key)
            if (checkpoint.getJSONObject("sourceKey").getString("profileKey") == profile) checkpoints.put(JSONObject(checkpoint.toString()))
        }
        val captures = JSONArray()
        val pending = state.getJSONArray("captures")
        for (index in 0 until pending.length()) if (pending.getJSONObject(index).getString("profileKey") == profile) captures.put(JSONObject(pending.getJSONObject(index).toString()))
        return result.put("checkpoints", checkpoints).put("captures", captures)
    }
}
