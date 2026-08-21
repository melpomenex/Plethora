// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Durable pending media-command queue (design Decision 8).
//
// Every normalized media command received natively is appended here BEFORE it
// is emitted to the WebView, so no button press is lost when the WebView JS
// event loop is suspended (locked Android device aggressively backgrounding
// the app). The frontend acknowledges handled envelopes via
// `ack_media_commands`; on resume it drains unacked commands via
// `drain_pending_media_commands`.
//
// Storage: a single JSON file in app-private storage, written atomically
// (write-temp + rename), bounded to the last MAX_ENTRIES entries.

package com.plethora.androidtts

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class PendingMediaCommand(
    val eventId: String,
    val command: String,
    val source: String,
    val occurredAt: Long,
    val sourceId: String? = null,
    val sessionId: String? = null,
    val positionHintSec: Double?,
    val positionSec: Double? = null,
    var ackedAt: Long? = null,
)

class MediaCommandQueue(private val context: Context) {

    companion object {
        private const val TAG = "MediaCommandQueue"
        private const val FILE_NAME = "pending_media_commands.json"
        private const val MAX_ENTRIES = 100
    }

    private val file: File get() = File(context.filesDir, FILE_NAME)
    private val lock = Any()

    /** Load the persisted queue (empty on missing/corrupt file). */
    fun load(): MutableList<PendingMediaCommand> {
        synchronized(lock) {
            return try {
                val raw = file.readText()
                val arr = JSONArray(raw)
                val out = ArrayList<PendingMediaCommand>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    out.add(
                        PendingMediaCommand(
                            eventId = o.getString("eventId"),
                            command = o.getString("command"),
                            source = o.getString("source"),
                            occurredAt = o.getLong("occurredAt"),
                            sourceId = if (o.has("sourceId") && !o.isNull("sourceId")) o.getString("sourceId") else null,
                            sessionId = if (o.has("sessionId") && !o.isNull("sessionId")) o.getString("sessionId") else null,
                            positionHintSec = if (o.has("positionHintSec") && !o.isNull("positionHintSec"))
                                o.getDouble("positionHintSec") else null,
                            positionSec = if (o.has("positionSec") && !o.isNull("positionSec"))
                                o.getDouble("positionSec") else null,
                            ackedAt = if (o.has("ackedAt") && !o.isNull("ackedAt"))
                                o.getLong("ackedAt") else null,
                        )
                    )
                }
                out
            } catch (e: Throwable) {
                // Missing or corrupt file: an empty queue is the safe state.
                ArrayList()
            }
        }
    }

    /** Atomically persist the queue, bounded to the newest MAX_ENTRIES. */
    private fun persist(entries: List<PendingMediaCommand>) {
        synchronized(lock) {
            try {
                val bounded = entries.takeLast(MAX_ENTRIES)
                val arr = JSONArray()
                for (e in bounded) {
                    arr.put(
                        JSONObject()
                            .put("eventId", e.eventId)
                            .put("command", e.command)
                            .put("source", e.source)
                            .put("occurredAt", e.occurredAt)
                            .put("sourceId", e.sourceId ?: JSONObject.NULL)
                            .put("sessionId", e.sessionId ?: JSONObject.NULL)
                            .put("positionHintSec", e.positionHintSec ?: JSONObject.NULL)
                            .put("positionSec", e.positionSec ?: JSONObject.NULL)
                            .put("ackedAt", e.ackedAt ?: JSONObject.NULL)
                    )
                }
                val tmp = File(context.filesDir, "$FILE_NAME.tmp")
                tmp.writeText(arr.toString())
                if (!tmp.renameTo(file)) {
                    file.delete()
                    tmp.renameTo(file)
                }
            } catch (e: Throwable) {
                Log.w(TAG, "persist failed: ${e.message}")
            }
        }
    }

    /** Append an unacked envelope (called BEFORE WebView emission). */
    fun enqueue(entry: PendingMediaCommand) {
        synchronized(lock) {
            val entries = load()
            entries.add(entry)
            persist(entries)
        }
    }

    /** Mark envelopes acked by the frontend dispatcher. */
    fun ack(eventIds: List<String>) {
        if (eventIds.isEmpty()) return
        synchronized(lock) {
            val ids = eventIds.toHashSet()
            var changed = false
            val entries = load().map {
                if (ids.contains(it.eventId) && it.ackedAt == null) {
                    changed = true
                    it.copy(ackedAt = System.currentTimeMillis())
                } else it
            }
            if (changed) persist(entries)
        }
    }

    /** Discard a stale/mismatched/invalid command after recording the reason. */
    fun discard(eventIds: List<String>, reason: String?) {
        if (eventIds.isEmpty()) return
        synchronized(lock) {
            val ids = eventIds.toHashSet()
            val entries = load()
            val removed = entries.filter { ids.contains(it.eventId) }
            if (removed.isNotEmpty()) {
                Log.i(TAG, "discarded ${removed.size} media command(s), reason=${reason ?: "unspecified"}")
                persist(entries.filterNot { ids.contains(it.eventId) })
            }
        }
    }

    /** Unacked commands oldest-first; acked ones are pruned. */
    fun drainUnacked(): List<PendingMediaCommand> {
        synchronized(lock) {
            val entries = load()
            val unacked = entries.filter { it.ackedAt == null }
            // Drop acked entries from disk while draining.
            persist(unacked)
            return unacked
        }
    }

    /** Serialized envelope payloads for the frontend (camelCase keys). */
    fun toJsonArray(entries: List<PendingMediaCommand>): JSONArray {
        val arr = JSONArray()
        for (e in entries) {
            arr.put(
                JSONObject()
                    .put("eventId", e.eventId)
                    .put("command", e.command)
                    .put("source", e.source)
                    .put("occurredAt", e.occurredAt)
                    .put("sourceId", e.sourceId ?: JSONObject.NULL)
                    .put("sessionId", e.sessionId ?: JSONObject.NULL)
                    .put("positionHintSec", e.positionHintSec ?: JSONObject.NULL)
                    .put("positionSec", e.positionSec ?: JSONObject.NULL)
                    .put("acked", e.ackedAt != null)
            )
        }
        return arr
    }
}
