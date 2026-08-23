package com.plethora.androidspeech

import org.junit.Assert.assertEquals
import org.junit.Test

class PacedPcmTest {
    @Test
    fun realtimeBudgetMatchesSixteenKhzPcm16le() {
        assertEquals(1000L, PacedPcm.expectedElapsedMs(PacedPcm.BYTES_PER_SECOND))
        assertEquals(100L, PacedPcm.expectedElapsedMs(3200))
    }
}
