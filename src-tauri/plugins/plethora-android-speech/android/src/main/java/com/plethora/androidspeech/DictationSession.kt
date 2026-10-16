package com.plethora.androidspeech

/** Ephemeral single-owner state; Android callbacks and timers carry its identity. */
internal class DictationSession(
    private val schedule: (Long, () -> Unit) -> (() -> Unit),
    private val releaseAudio: () -> Unit,
    private val stopAudio: () -> Unit,
) {
    private data class Owner(val id: String, val started: (String?) -> Unit,
        var stop: ((String?, String?) -> Unit)? = null, var text: String? = null,
        var error: String? = null, var ready: Boolean = false, var finalizing: Boolean = false,
        var cancelTimer: (() -> Unit)? = null)
    private var owner: Owner? = null
    fun owns(id: String) = owner?.id == id
    fun reserve(id: String, started: (String?) -> Unit): Boolean {
        if (owner != null) return false
        val next = Owner(id, started)
        owner = next
        next.cancelTimer = schedule(10_000) { if (owner === next && !next.ready) finish(next, null, "timeout") }
        return true
    }
    fun ready(id: String) {
        val current = owner ?: return
        if (current.id != id || current.ready || current.error != null || current.text != null) return
        current.cancelTimer?.invoke(); current.ready = true
        current.started(null)
        current.cancelTimer = schedule(60_000) { autoStop(id) }
    }
    fun result(id: String, text: String?, error: String? = null) {
        val current = owner ?: return
        if (current.id != id || current.text != null || current.error != null) return
        finish(current, text?.trim()?.takeIf { it.isNotEmpty() }, error ?: if (text.isNullOrBlank()) "no-speech" else null)
    }
    private fun finish(current: Owner, text: String?, error: String?) {
        if (owner !== current) return
        current.cancelTimer?.invoke(); current.text = text; current.error = error
        releaseAudio()
        if (!current.ready) { owner = null; current.started(error ?: "interrupted"); current.stop?.invoke(null, error ?: "interrupted"); return }
        val waiting = current.stop
        current.stop = null
        if (waiting != null) { owner = null; waiting(text, error) }
        else current.cancelTimer = schedule(30_000) { if (owner === current) owner = null }
    }
    fun stop(id: String, completed: (String?, String?) -> Unit) {
        val current = owner
        if (current == null || current.id != id) { completed(null, "cancelled"); return }
        if (current.text != null || current.error != null) { owner = null; current.cancelTimer?.invoke(); completed(current.text, current.error); return }
        if (current.stop != null) { completed(null, "busy"); return }
        current.stop = completed
        if (!current.finalizing) {
            current.finalizing = true; current.cancelTimer?.invoke()
            current.cancelTimer = schedule(5_000) { if (owner === current) finish(current, null, "timeout") }
            stopAudio()
        }
    }
    /** Auto-stop finalizes but leaves the result available to the JS owner's Stop. */
    fun autoStop(id: String) {
        val current = owner ?: return
        if (current.id != id || current.finalizing || current.text != null || current.error != null) return
        current.finalizing = true; current.cancelTimer?.invoke()
        current.cancelTimer = schedule(5_000) { if (owner === current) finish(current, null, "timeout") }
        stopAudio()
    }
    fun cancel(id: String? = null, reason: String = "cancelled") {
        val current = owner ?: return
        if (id != null && id != current.id) return
        owner = null; current.cancelTimer?.invoke(); releaseAudio()
        if (!current.ready) current.started(reason)
        current.stop?.invoke(null, reason)
    }
}
