package com.plethora.haptics

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HapticAdmissionTest {
    @Test fun firstEffectAtRealisticUptimeIsNeverBlockedBySentinelOverflow() {
        val guard = HapticAdmission()
        assertTrue(guard.admit("first", "completion", 42_000L))
        guard.submitted("completion", 42_000L)
        assertFalse(guard.admit("second", "selection", 42_059L))
        assertTrue(guard.admit("third", "selection", 42_060L))
    }

    @Test fun refusesDuplicatePlatformAttemptsWithoutRetry() {
        val guard = HapticAdmission()
        assertTrue(guard.admit("refused", "commit", 1_000L))
        assertFalse(guard.admit("refused", "commit", 1_500L))
        assertTrue(guard.admit("refused", "commit", 3_000L))
    }

    @Test fun enforcesEightMicroEffectsAndFourOutcomesPerRollingSecond() {
        val guard = HapticAdmission()
        repeat(8) { index ->
            val now = 1_000L + index * 60L
            assertTrue(guard.admit("micro-$index", "selection", now))
            guard.submitted("selection", now)
        }
        assertFalse(guard.admit("overflow", "selection", 1_480L))
        assertTrue(guard.admit("later", "selection", 2_000L))
        guard.clear()
        repeat(4) { index ->
            val now = 3_000L + index * 120L
            assertTrue(guard.admit("outcome-$index", "success", now))
            guard.submitted("success", now)
        }
        assertFalse(guard.admit("outcome-overflow", "error", 3_480L))
    }

    @Test fun pauseClearsLimitsAndDoesNotDelayNextForegroundEffect() {
        val guard = HapticAdmission()
        assertTrue(guard.admit("first", "error", 1_000L))
        guard.submitted("error", 1_000L)
        guard.clear()
        assertTrue(guard.admit("resumed", "completion", 1_001L))
    }
}
