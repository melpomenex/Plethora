// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidgenai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Serialization round-trips for the structured-output envelopes. These run on
 * the JVM against the real org.json (testImplementation), verifying the exact
 * camelCase wire shape NativePromptResponse.structured carries to the
 * TypeScript schemas — no ML Kit runtime involved.
 */
class StructuredSchemaTest {

    private fun sampleCard(
        clozeText: String? = null,
        clozeRanges: List<String>? = null,
        imageRefId: String? = null
    ) = CardCandidate(
        cardType = clozeText?.let { "cloze" } ?: "qa",
        question = clozeText ?: "What buffers intracellular calcium?",
        answer = "the sarcoplasmic reticulum",
        clozeText = clozeText,
        clozeRanges = clozeRanges,
        conceptKeys = listOf("calcium-homeostasis"),
        imageRefId = imageRefId
    )

    @Test
    fun `learning material proposal round-trips with nested cards`() {
        val proposal = LearningMaterialProposal(
            importance = 0.82,
            knowledgeType = "definition",
            concepts = listOf("sarcoplasmic reticulum", "calcium"),
            suggestedCards = listOf(
                sampleCard(),
                sampleCard(
                    clozeText = "The {{c1::sarcoplasmic reticulum}} stores calcium",
                    clozeRanges = listOf("c1")
                )
            ),
            prerequisites = listOf("cell membrane transport"),
            tags = listOf("physiology", "cells"),
            rationale = "Definitions anchor later mechanism cards."
        )

        val json = structuredEnvelopeToJson(proposal)
        assertEquals(0.82, json.getDouble("importance"), 1e-9)
        assertEquals("definition", json.getString("knowledgeType"))
        assertEquals("physiology", json.getJSONArray("tags").getString(0))
        assertEquals("Definitions anchor later mechanism cards.", json.getString("rationale"))

        val plain = json.getJSONArray("suggestedCards").getJSONObject(0)
        assertEquals("qa", plain.getString("cardType"))
        assertEquals("the sarcoplasmic reticulum", plain.getString("answer"))
        assertFalse(plain.has("clozeText"))
        assertFalse(plain.has("clozeRanges"))
        assertFalse(plain.has("imageRefId"))

        val cloze = json.getJSONArray("suggestedCards").getJSONObject(1)
        assertEquals("cloze", cloze.getString("cardType"))
        assertEquals(
            "The {{c1::sarcoplasmic reticulum}} stores calcium",
            cloze.getString("clozeText")
        )
        assertEquals("c1", cloze.getJSONArray("clozeRanges").getString(0))

        // Full round-trip: the emitted text must parse back into the same
        // envelope shape (this is the exact string sent as `text`).
        val reparsed = JSONObject(json.toString())
        assertEquals(0.82, reparsed.getDouble("importance"), 1e-9)
        assertEquals(
            "cell membrane transport",
            reparsed.getJSONArray("prerequisites").getString(0)
        )
    }

    @Test
    fun `answer assessment omits null optionals and keeps required scores`() {
        val assessment = AnswerAssessment(
            classification = "partial",
            score = 0.55,
            completeness = 0.6,
            confidence = 0.9,
            missingConcepts = listOf("osmotic gradient"),
            misconception = null,
            feedback = "You described the pump but not the gradient.",
            suggestedCorrection = null
        )
        val json = structuredEnvelopeToJson(assessment)
        assertEquals("partial", json.getString("classification"))
        assertEquals(0.55, json.getDouble("score"), 1e-9)
        assertEquals(0.6, json.getDouble("completeness"), 1e-9)
        assertEquals(0.9, json.getDouble("confidence"), 1e-9)
        assertEquals("osmotic gradient", json.getJSONArray("missingConcepts").getString(0))
        assertEquals("You described the pump but not the gradient.", json.getString("feedback"))
        assertFalse(json.has("misconception"))
        assertFalse(json.has("suggestedCorrection"))

        val withMisconception = assessment.copy(
            classification = "misconception",
            misconception = "confuses SR with lysosome",
            suggestedCorrection = "The SR, not the lysosome, buffers Ca2+."
        )
        val json2 = structuredEnvelopeToJson(withMisconception)
        assertEquals("confuses SR with lysosome", json2.getString("misconception"))
        assertEquals("The SR, not the lysosome, buffers Ca2+.", json2.getString("suggestedCorrection"))
    }

    @Test
    fun `recall question proposal serializes grounding refs`() {
        val recall = RecallQuestionProposal(
            question = "Which organelle buffers cytosolic calcium?",
            expectedAnswer = "The sarcoplasmic reticulum",
            conceptKeys = listOf("calcium-homeostasis", "organelles"),
            chunkRefs = listOf("chunk-17", "chunk-18")
        )
        val json = structuredEnvelopeToJson(recall)
        assertEquals("Which organelle buffers cytosolic calcium?", json.getString("question"))
        assertEquals("The sarcoplasmic reticulum", json.getString("expectedAnswer"))
        assertEquals(2, json.getJSONArray("conceptKeys").length())
        assertEquals("chunk-18", json.getJSONArray("chunkRefs").getString(1))
    }

    @Test
    fun `occlusion label selection round-trips selections and rejections`() {
        val selection = OcclusionLabelSelection(
            appropriate = true,
            selections = listOf(
                OcclusionSelection(
                    labelIds = listOf("label-3", "label-4"),
                    question = "Which label marks the SR?",
                    answer = "C"
                )
            ),
            rejected = listOf(
                OcclusionRejection(labelId = "label-9", reason = "axis tick, not a structure")
            )
        )
        val json = structuredEnvelopeToJson(selection)
        assertTrue(json.getBoolean("appropriate"))
        val first = json.getJSONArray("selections").getJSONObject(0)
        assertEquals("label-4", first.getJSONArray("labelIds").getString(1))
        assertEquals("Which label marks the SR?", first.getString("question"))
        assertEquals("C", first.getString("answer"))
        val rejected = json.getJSONArray("rejected").getJSONObject(0)
        assertEquals("label-9", rejected.getString("labelId"))
        assertEquals("axis tick, not a structure", rejected.getString("reason"))

        // The `appropriate: false` verdict path must survive verbatim — the
        // UI treats it as a terminal answer, not an error.
        val inappropriate = selection.copy(appropriate = false, selections = emptyList())
        assertFalse(structuredEnvelopeToJson(inappropriate).getBoolean("appropriate"))
    }

    @Test
    fun `prerequisite analysis serializes concept and why`() {
        val analysis = PrerequisiteAnalysis(
            prerequisites = listOf(
                PrerequisiteEntry(concept = "action potential", why = "Needed before excitation-contraction coupling")
            )
        )
        val json = structuredEnvelopeToJson(analysis)
        val entry = json.getJSONArray("prerequisites").getJSONObject(0)
        assertEquals("action potential", entry.getString("concept"))
        assertEquals("Needed before excitation-contraction coupling", entry.getString("why"))
    }

    @Test
    fun `passage classification serializes worthiness and action`() {
        val passage = PassageClassification(
            type = "definition",
            extractWorthiness = 0.9,
            reason = "Dense definitional content",
            suggestedLearningAction = "extract"
        )
        val json = structuredEnvelopeToJson(passage)
        assertEquals("definition", json.getString("type"))
        assertEquals(0.9, json.getDouble("extractWorthiness"), 1e-9)
        assertEquals("Dense definitional content", json.getString("reason"))
        assertEquals("extract", json.getString("suggestedLearningAction"))
    }

    @Test
    fun `tutor turn omits absent promotion and keeps hint bounds fields`() {
        val turn = TutorTurn(
            move = "hint",
            content = "Think about where the cell stores ions.",
            hintLevel = 2,
            stuckDetected = true,
            promoteToCard = null
        )
        val json = structuredEnvelopeToJson(turn)
        assertEquals("hint", json.getString("move"))
        assertEquals(2, json.getInt("hintLevel"))
        assertTrue(json.getBoolean("stuckDetected"))
        assertFalse(json.has("promoteToCard"))

        val promoted = turn.copy(
            move = "wrap-up",
            promoteToCard = sampleCard().copy(cardType = "definition")
        )
        val json2 = structuredEnvelopeToJson(promoted)
        assertEquals("wrap-up", json2.getString("move"))
        assertEquals("definition", json2.getJSONObject("promoteToCard").getString("cardType"))
    }

    @Test
    fun `unknown envelope type fails closed`() {
        assertThrows(IllegalArgumentException::class.java) {
            structuredEnvelopeToJson(mapOf("not" to "an envelope"))
        }
    }
}
