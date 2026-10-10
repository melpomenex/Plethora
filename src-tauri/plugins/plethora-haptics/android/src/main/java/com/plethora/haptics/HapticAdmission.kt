package com.plethora.haptics

/** Pure monotonic-clock guard, shared by the real View delivery and JVM tests. */
internal class HapticAdmission {
    private val recentIds = LinkedHashMap<String, Long>()
    private val submissions = ArrayDeque<Pair<Long, Boolean>>()
    private var lastSubmission: Long? = null

    fun admit(id: String, effect: String, now: Long): Boolean {
        recentIds.entries.removeIf { now - it.value >= 2_000L }
        while (submissions.isNotEmpty() && now - submissions.first().first >= 1_000L) submissions.removeFirst()
        val outcome = effect in OUTCOMES
        val previous = lastSubmission
        if (recentIds.containsKey(id) || submissions.size >= 8 ||
            (outcome && submissions.count { it.second } >= 4) ||
            (previous != null && now - previous < if (outcome) 120L else 60L)) return false
        // Remember refused platform attempts too; the same identity cannot retry.
        recentIds[id] = now
        if (recentIds.size > 256) recentIds.remove(recentIds.entries.first().key)
        return true
    }

    fun submitted(effect: String, now: Long) {
        submissions.addLast(now to (effect in OUTCOMES))
        lastSubmission = now
    }

    fun clear() {
        recentIds.clear()
        submissions.clear()
        lastSubmission = null
    }

    companion object {
        private val OUTCOMES = setOf("success", "warning", "error", "completion", "celebration")
    }
}
