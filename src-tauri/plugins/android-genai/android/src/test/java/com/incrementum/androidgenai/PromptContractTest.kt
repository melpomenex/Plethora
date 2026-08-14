// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0

package com.incrementum.androidgenai

import com.google.mlkit.genai.prompt.Candidate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptContractTest {
    private fun validArgs() = NativePromptArgs().apply {
        requestId = "req-1"
        text = "hello"
        outputMode = "text"
    }

    @Test
    fun `valid option bounds are accepted`() {
        val args = validArgs().apply {
            temperature = 2f
            candidateCount = 8
            maxOutputTokens = 4096
        }
        assertNull(promptArgsValidationError(args))
    }

    @Test
    fun `invalid option bounds are rejected`() {
        assertEquals(
            "temperature must be between 0 and 2",
            promptArgsValidationError(validArgs().apply { temperature = Float.NaN })
        )
        assertEquals(
            "candidateCount must be between 1 and 8",
            promptArgsValidationError(validArgs().apply { candidateCount = 9 })
        )
        assertEquals(
            "maxOutputTokens must be between 1 and 4096",
            promptArgsValidationError(validArgs().apply { maxOutputTokens = 0 })
        )
    }

    @Test
    fun `measured request reserves output tokens`() {
        assertFalse(exceedsTokenBudget(3000, 1096, 4096))
        assertTrue(exceedsTokenBudget(3001, 1096, 4096))
        assertTrue(exceedsTokenBudget(Int.MAX_VALUE, 1, Int.MAX_VALUE))
    }

    @Test
    fun `finish reasons are stable strings and structured output fails closed`() {
        assertEquals("stop", finishReasonName(Candidate.FinishReason.STOP))
        assertEquals("max_tokens", finishReasonName(Candidate.FinishReason.MAX_TOKENS))
        assertEquals("other", finishReasonName(Candidate.FinishReason.OTHER))
        assertTrue(isStructuredOutputMode("flashcards"))
        assertFalse(isStructuredOutputMode("text"))
    }
}
