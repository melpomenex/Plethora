package com.plethora.androidspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeechPcmTest {
    @Test
    fun acceptsSixteenKhzMonoPcm16le() {
        assertNull(SpeechPcm.rejectReason(16000, 1, "pcm16le"))
    }

    @Test
    fun rejectsOtherRates() {
        assertEquals("codec_unsupported", SpeechPcm.rejectReason(44100, 1, "pcm16le"))
        assertEquals("codec_unsupported", SpeechPcm.rejectReason(16000, 2, "pcm16le"))
    }
}
