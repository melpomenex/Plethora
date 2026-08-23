// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidgenai

import com.google.mlkit.genai.common.FeatureStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CapabilityMappingTest {
    @Test
    fun `summarization can be available when prompt is not`() {
        // Galaxy S25-class: specialized allowlist without Prompt.
        val prompt = featureStateForStatus(FeatureStatus.UNAVAILABLE)
        val summary = featureStateForStatus(FeatureStatus.AVAILABLE)
        assertEquals("unavailable", prompt.status)
        assertEquals("available", summary.status)
    }

    @Test
    fun `feature statuses map independently`() {
        val prompt = featureStateForStatus(FeatureStatus.AVAILABLE)
        val summary = featureStateForStatus(FeatureStatus.DOWNLOADABLE)

        assertEquals("available", prompt.status)
        assertNull(prompt.reason)
        assertEquals("downloadable", summary.status)
        assertEquals("model_downloadable", summary.reason)
    }

    @Test
    fun `unsupported optional feature does not disable prompt`() {
        val flags = negotiatePromptFeatures(
            promptAvailable = true,
            structuredOutputCompiled = true,
            structuredOutputAvailable = false,
            systemInstructionsAvailable = true,
            prefixCachingAvailable = false,
            imagePromptCompiled = true,
            multiImageCompiled = true,
            streamingCompiled = true
        )

        assertFalse(flags.structuredOutput)
        assertTrue(flags.systemInstructions)
        assertFalse(flags.prefixCaching)
        assertTrue(flags.imageInput)
        assertTrue(flags.multiImage)
        assertTrue(flags.streaming)
    }

    @Test
    fun `base prompt unavailability disables all runtime prompt features`() {
        val flags = negotiatePromptFeatures(
            promptAvailable = false,
            structuredOutputCompiled = true,
            structuredOutputAvailable = true,
            systemInstructionsAvailable = true,
            prefixCachingAvailable = true,
            imagePromptCompiled = true,
            multiImageCompiled = true,
            streamingCompiled = true
        )

        assertTrue(flags.structuredOutputCompiled)
        assertFalse(flags.structuredOutput)
        assertFalse(flags.systemInstructions)
        assertFalse(flags.prefixCaching)
        assertFalse(flags.imageInput)
        assertFalse(flags.multiImage)
        assertFalse(flags.streaming)
    }
}
