package com.plethora.androidtts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaFocusStateMachineTest {
    @Test
    fun `transient loss resumes only playback that was active`() {
        val policy = MediaFocusStateMachine()
        assertEquals(MediaFocusAction.PAUSE, policy.onTransientLoss(isPlaying = true))
        assertEquals(MediaFocusAction.RESTORE, policy.onGain(isPlaying = false))

        policy.onUserPlayback(isPlaying = false)
        assertEquals(MediaFocusAction.NONE, policy.onTransientLoss(isPlaying = false))
        assertEquals(MediaFocusAction.NONE, policy.onGain(isPlaying = false))
    }

    @Test
    fun `ducking does not turn playback into a pause`() {
        val policy = MediaFocusStateMachine()
        assertEquals(MediaFocusAction.DUCK, policy.onDuck(isPlaying = true))
        assertEquals(MediaFocusAction.RESTORE, policy.onGain(isPlaying = true))
    }

    @Test
    fun `headphone disconnect never auto resumes`() {
        val policy = MediaFocusStateMachine()
        assertEquals(MediaFocusAction.PAUSE, policy.onHeadphoneDisconnect(isPlaying = true))
        assertTrue(policy.wasStoppedByNoisy())
        assertEquals(MediaFocusAction.NONE, policy.onGain(isPlaying = false))
    }
}
