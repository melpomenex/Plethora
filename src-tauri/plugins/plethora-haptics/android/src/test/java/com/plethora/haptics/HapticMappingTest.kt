package com.plethora.haptics

import android.view.HapticFeedbackConstants
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class HapticMappingTest {
    @Test fun mapsSemanticEffectsAcrossSdkBands() {
        assertEquals(HapticFeedbackConstants.CLOCK_TICK, HapticMapping.constant("selection", "subtle", 33))
        assertEquals(HapticFeedbackConstants.SEGMENT_FREQUENT_TICK, HapticMapping.constant("selection", "subtle", 34))
        assertEquals(HapticFeedbackConstants.SEGMENT_TICK, HapticMapping.constant("selection", "strong", 36))
        assertEquals(HapticFeedbackConstants.CONTEXT_CLICK, HapticMapping.constant("activation", "strong", 26))
        assertEquals(HapticFeedbackConstants.GESTURE_START, HapticMapping.constant("threshold", "standard", 30))
        assertEquals(HapticFeedbackConstants.CONTEXT_CLICK, HapticMapping.constant("threshold", "standard", 29))
        assertEquals(HapticFeedbackConstants.CONFIRM, HapticMapping.constant("commit", "subtle", 34))
        assertEquals(HapticFeedbackConstants.CONFIRM, HapticMapping.constant("celebration", "strong", 30))
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, HapticMapping.constant("success", "standard", 29))
        assertEquals(HapticFeedbackConstants.REJECT, HapticMapping.constant("warning", "subtle", 34))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, HapticMapping.constant("error", "strong", 29))
        assertEquals(null, HapticMapping.constant("unknown", "standard", 36))
    }

    @Test fun intensityDoesNotInventMotorStrengthOrRetryFallbacks() {
        assertEquals(HapticMapping.constant("activation", "subtle", 36), HapticMapping.constant("activation", "strong", 36))
        assertEquals(HapticMapping.constant("commit", "subtle", 30), HapticMapping.constant("commit", "strong", 30))
        assertNotNull(HapticMapping.constant("selection", "subtle", 34))
    }

    @Test fun sharedFixtureUsesTheRustCamelCaseWireContract() {
        val fixtureText = javaClass.classLoader!!.getResourceAsStream("bridge-contract.json")!!
            .bufferedReader().use { it.readText() }
        val fixture = JSONObject(fixtureText)
        val caps = fixture.getJSONObject("capabilities")
        assertEquals(1, caps.getInt("protocolVersion"))
        assertEquals("android-native", caps.getString("driver"))
        val request = fixture.getJSONObject("request")
        assertEquals("commit", request.getString("effect"))
        assertEquals("fixture-session-1", request.getString("driverSessionId"))
        assertEquals("submitted", fixture.getJSONObject("submitted").getString("status"))
    }
}
