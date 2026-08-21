// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidgenai

import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Candidate
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    // ── Structured output (outputMode "structured" + responseSchema) ────────

    @Test
    fun `structured mode is a valid output mode that requires a known schema`() {
        assertNull(
            promptArgsValidationError(
                validArgs().apply {
                    outputMode = "structured"
                    responseSchema = "learningMaterialProposal"
                }
            )
        )
        assertTrue(isStructuredOutputMode("structured"))
    }

    @Test
    fun `structured mode without or with unknown schema is invalid_argument`() {
        assertEquals(
            "responseSchema is required when outputMode is structured",
            promptArgsValidationError(validArgs().apply { outputMode = "structured" })
        )
        assertEquals(
            "responseSchema is required when outputMode is structured",
            promptArgsValidationError(
                validArgs().apply {
                    outputMode = "structured"
                    responseSchema = "  "
                }
            )
        )
        assertEquals(
            "unsupported responseSchema: psychic",
            promptArgsValidationError(
                validArgs().apply {
                    outputMode = "structured"
                    responseSchema = "psychic"
                }
            )
        )
    }

    @Test
    fun `responseSchema outside structured mode is invalid_argument`() {
        assertEquals(
            "responseSchema requires outputMode structured",
            promptArgsValidationError(
                validArgs().apply { responseSchema = "tutorTurn" }
            )
        )
    }

    @Test
    fun `every schema key resolves to a compiled envelope class`() {
        assertEquals(
            setOf(
                "learningMaterialProposal",
                "answerAssessment",
                "recallQuestionProposal",
                "occlusionLabelSelection",
                "prerequisiteAnalysis",
                "passageClassification",
                "tutorTurn"
            ),
            STRUCTURED_SCHEMA_CLASSES.keys
        )
        // Each registry entry points at a distinct @Generable root class.
        assertEquals(STRUCTURED_SCHEMA_CLASSES.size, STRUCTURED_SCHEMA_CLASSES.values.toSet().size)
    }

    @Test
    fun `not compiled falls back to the text path for structured requests`() {
        // feature_not_compiled: the graceful contract is "exactly today's
        // behavior" — text generation, structured null — not an error, so the
        // TypeScript strict-JSON fallback stays in charge on such builds.
        assertEquals(
            StructuredOutputPath.TEXT_FALLBACK,
            resolveStructuredOutputPath(
                outputMode = "structured",
                structuredOutputCompiled = false,
                structuredOutputRuntimeAvailable = true
            )
        )
    }

    @Test
    fun `runtime unavailability and non-structured modes take the text path`() {
        assertEquals(
            StructuredOutputPath.TEXT_FALLBACK,
            resolveStructuredOutputPath(
                outputMode = "structured",
                structuredOutputCompiled = true,
                structuredOutputRuntimeAvailable = false
            )
        )
        assertEquals(
            StructuredOutputPath.TEXT_FALLBACK,
            resolveStructuredOutputPath(
                outputMode = "flashcards",
                structuredOutputCompiled = true,
                structuredOutputRuntimeAvailable = true
            )
        )
        assertEquals(
            StructuredOutputPath.TEXT_FALLBACK,
            resolveStructuredOutputPath(
                outputMode = null,
                structuredOutputCompiled = true,
                structuredOutputRuntimeAvailable = true
            )
        )
    }

    @Test
    fun `typed path requires both compiled flag and runtime availability`() {
        assertEquals(
            StructuredOutputPath.TYPED,
            resolveStructuredOutputPath(
                outputMode = "structured",
                structuredOutputCompiled = true,
                structuredOutputRuntimeAvailable = true
            )
        )
    }

    @Test
    fun `malformed typed output fails closed on non-stop finish reasons`() {
        val detail = structuredFinishReasonError("structured", "max_tokens")
        assertEquals("structured output ended with max_tokens", detail)
        assertEquals("structured output ended with no finish reason", structuredFinishReasonError("structured", null))
        assertNull(structuredFinishReasonError("structured", "stop"))
        // Text mode never fails on finish reason — the caller parses leniently.
        assertNull(structuredFinishReasonError("text", "max_tokens"))
        assertNull(structuredFinishReasonError(null, null))
    }

    @Test
    fun `structured failures reuse the existing error-code contract only`() {
        // Task 1.11: no new cross-boundary codes. Every failure mode of the
        // structured path maps onto an ErrorCode that already exists on the
        // Kotlin/Rust/TS contract — the fail-closed messages above carry
        // invalid_argument (bad responseSchema), and the typed call surfaces
        // context_too_large / empty_output / incomplete_output / inference_failed
        // / safety_blocked via the same helpers as the text path. Pin the
        // classifier so structured failures can never drift off-contract.
        assertEquals("safety_blocked", mapGenAiErrorCode(999, "safety triggered"))
        assertEquals("inference_failed", mapGenAiErrorCode(999, null))
        assertEquals("context_too_large", mapGenAiErrorCode(GenAiException.ErrorCode.REQUEST_TOO_LARGE, null))
        assertEquals("busy", mapGenAiErrorCode(GenAiException.ErrorCode.BUSY, null))
    }

    // ── Image input (design D17 / task 3.1) ─────────────────────────────────

    private fun imagePayload(
        mimeType: String? = "image/png",
        data: String? = java.util.Base64.getEncoder().encodeToString(ByteArray(16))
    ) = PromptImageArgs().apply {
        this.mimeType = mimeType
        this.data = data
    }

    @Test
    fun `image payloads with supported mime types and small bodies pass`() {
        for (mime in listOf("image/jpeg", "image/png", "image/webp", " IMAGE/PNG ")) {
            assertNull(imagePayloadError(imagePayload(mimeType = mime))?.message)
        }
        assertNull(imagePayloadError(null))
    }

    @Test
    fun `bad mime types are rejected as invalid_image`() {
        for (mime in listOf(null, "", "image/gif", "image/bmp", "video/mp4")) {
            val error = imagePayloadError(imagePayload(mimeType = mime))
            assertNotNull(error)
            assertEquals("invalid_image", error!!.errorCode)
            assertEquals(
                "image mimeType must be one of jpeg, png, webp",
                error.message
            )
        }
    }

    @Test
    fun `missing or malformed base64 data is rejected as invalid_image`() {
        assertEquals(
            "image data is required",
            imagePayloadError(imagePayload(data = "   "))!!.message
        )
        assertEquals(
            "image data is not valid base64",
            imagePayloadError(imagePayload(data = "not!base64!!"))!!.message
        )
    }

    @Test
    fun `payloads above five megabytes are rejected as invalid_image`() {
        val oversize = java.util.Base64.getEncoder()
            .encodeToString(ByteArray(MAX_PROMPT_IMAGE_BYTES + 1))
        val error = imagePayloadError(imagePayload(data = oversize))
        assertNotNull(error)
        assertEquals("invalid_image", error!!.errorCode)
        assertTrue(error.message.startsWith("image payload exceeds the 5 MB limit"))
        // The boundary itself passes (5 MB exactly is allowed).
        val exactly = java.util.Base64.getEncoder()
            .encodeToString(ByteArray(MAX_PROMPT_IMAGE_BYTES))
        assertNull(imagePayloadError(imagePayload(data = exactly)))
    }

    @Test
    fun `image requests select the matching builder constructor plan`() {
        // Prompt beta4 has no addPart API: image requests MUST go through the
        // dedicated (SystemInstruction,)? ImagePart + TextPart constructors.
        assertEquals(PromptRequestPlan.TEXT_ONLY, promptRequestPlan(hasImage = false, hasSystemInstruction = false))
        assertEquals(PromptRequestPlan.TEXT_ONLY, promptRequestPlan(hasImage = false, hasSystemInstruction = true))
        assertEquals(PromptRequestPlan.IMAGE_PLUS_TEXT, promptRequestPlan(hasImage = true, hasSystemInstruction = false))
        assertEquals(
            PromptRequestPlan.SYSTEM_IMAGE_PLUS_TEXT,
            promptRequestPlan(hasImage = true, hasSystemInstruction = true)
        )
    }

    @Test
    fun `decodePromptImageBytes round-trips base64 payloads`() {
        val original = ByteArray(64) { it.toByte() }
        val encoded = java.util.Base64.getEncoder().encodeToString(original)
        assertArrayEquals(original, decodePromptImageBytes(imagePayload(data = encoded)))
    }
}
