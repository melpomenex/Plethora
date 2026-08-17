// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Structured-output envelopes for the ML Kit GenAI Prompt API, processed by
// the declared KSP `genai-schema-compiler` (task `ksp`d in build.gradle.kts).
//
// Annotations (verified against com.google.mlkit:genai-schema:1.0.0-alpha1):
//   - @Generable(description) marks a class as a schema root; the compiler
//     emits `<ClassName>_GeneratedProvider` implementing GenerableProvider
//     plus a META-INF/services entry the GenAI runtime loads.
//   - @Guide(...) constrains a constructor property: description, enumValues,
//     minimum/maximum, minItems/maxItems. Applied with an explicit @param:
//     use-site (its targets are VALUE_PARAMETER and FIELD; the compiler reads
//     the constructor parameter, and the explicit target pins that and avoids
//     the Kotlin 2.2 first-applied-target warning).
//
// The wire JSON field names ARE the Kotlin property names — the schema
// compiler copies them into GenerableDetail.GuideDetail.name — so every
// property below is spelled in the camelCase shape the TypeScript schemas
// (src/lib/ai/schemas/) and the Rust shim expect. There is no @SerialName
// equivalent in this annotation family.
//
// Supported property types (per the compiler's supported-type table): String,
// Boolean, Int, Long, Float, Double, List<supported | @Generable class>, and
// nullable variants of those. Nested envelopes must themselves be @Generable.
//
// These classes are pure data: no defaults, so reflection-based construction
// by the ML Kit runtime never depends on Kotlin default-parameter handling.

package com.plethora.androidgenai

import com.google.mlkit.genai.schema.annotations.Generable
import com.google.mlkit.genai.schema.annotations.Guide
import kotlin.reflect.KClass
import org.json.JSONArray
import org.json.JSONObject

// ──────────────────────────────────────────────────────────────────────────
// Envelope: LearningMaterialProposal (Learn this, design D16)
// ──────────────────────────────────────────────────────────────────────────

/** Proposed learning material for a selected passage (Learn this, D16). */
@Generable(description = "Proposed learning material for a passage")
data class LearningMaterialProposal(
    @param:Guide(description = "Importance of the material from 0.0 to 1.0", minimum = 0.0, maximum = 1.0)
    val importance: Double,
    @param:Guide(
        description = "Kind of knowledge the passage contains",
        enumValues = [
            "definition", "enumeration", "process", "comparison", "formula",
            "causeEffect", "dateEvent", "example", "concept", "fact", "other"
        ]
    )
    val knowledgeType: String,
    @param:Guide(description = "Key concepts named in the material", minItems = 1)
    val concepts: List<String>,
    @param:Guide(description = "Suggested flashcard candidates derived from the material")
    val suggestedCards: List<CardCandidate>,
    @param:Guide(description = "Concepts the reader should understand first")
    val prerequisites: List<String>,
    @param:Guide(description = "Tags for organizing the material")
    val tags: List<String>,
    @param:Guide(description = "Why this material is worth learning")
    val rationale: String
)

/** One proposed card inside a LearningMaterialProposal (card types per D16). */
@Generable(description = "A single proposed flashcard")
data class CardCandidate(
    @param:Guide(
        description = "Type of card to create",
        enumValues = [
            "qa", "cloze", "definition", "comparison", "enumeration", "process",
            "causeEffect", "formula", "example", "occlusion-ref"
        ]
    )
    val cardType: String,
    @param:Guide(description = "Question text, or the cloze sentence for cloze cards")
    val question: String,
    @param:Guide(description = "Answer text")
    val answer: String,
    @param:Guide(description = "Cloze sentence with deletions; only for cloze cards")
    val clozeText: String?,
    @param:Guide(description = "Cloze deletion ranges; only for cloze cards")
    val clozeRanges: List<String>?,
    @param:Guide(description = "Concepts this card covers", minItems = 1)
    val conceptKeys: List<String>,
    @param:Guide(description = "Referenced image asset id; only for image occlusion cards")
    val imageRefId: String?
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: AnswerAssessment (free-response grading, design D20)
// ──────────────────────────────────────────────────────────────────────────

/** Advisory assessment of a free-response answer (D20; never a grade input). */
@Generable(description = "Assessment of a free-response answer")
data class AnswerAssessment(
    @param:Guide(
        description = "Overall verdict on the answer",
        enumValues = ["correct", "partial", "incorrect", "misconception"]
    )
    val classification: String,
    @param:Guide(description = "Overall score from 0.0 to 1.0", minimum = 0.0, maximum = 1.0)
    val score: Double,
    @param:Guide(description = "How complete the answer is, from 0.0 to 1.0", minimum = 0.0, maximum = 1.0)
    val completeness: Double,
    @param:Guide(description = "Confidence in the assessment, from 0.0 to 1.0", minimum = 0.0, maximum = 1.0)
    val confidence: Double,
    @param:Guide(description = "Concepts the answer is missing")
    val missingConcepts: List<String>,
    @param:Guide(description = "The misconception the answer reveals, if any")
    val misconception: String?,
    @param:Guide(description = "Short feedback for the learner")
    val feedback: String,
    @param:Guide(description = "A corrected answer, when the answer was wrong or partial")
    val suggestedCorrection: String?
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: RecallQuestionProposal (active recall, design D19)
// ──────────────────────────────────────────────────────────────────────────

/** A generated active-recall question grounded in already-read chunks (D19). */
@Generable(description = "A single active-recall question")
data class RecallQuestionProposal(
    @param:Guide(description = "The recall question")
    val question: String,
    @param:Guide(description = "The expected answer")
    val expectedAnswer: String,
    @param:Guide(description = "Concepts the question targets", minItems = 1)
    val conceptKeys: List<String>,
    @param:Guide(description = "Ids of the source chunks the question is grounded in", minItems = 1)
    val chunkRefs: List<String>
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: OcclusionLabelSelection (OCR-backed occlusion, design D18)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Model selection among OCR labels for image-occlusion cards (D18). The model
 * only selects label ids and words cards; geometry always comes from OCR.
 */
@Generable(description = "Selection of OCR labels for image occlusion cards")
data class OcclusionLabelSelection(
    @param:Guide(description = "Whether the image is appropriate for occlusion cards at all")
    val appropriate: Boolean,
    @param:Guide(description = "Proposed occlusion cards, grouping one or more labels")
    val selections: List<OcclusionSelection>,
    @param:Guide(description = "Labels rejected as not educationally useful")
    val rejected: List<OcclusionRejection>
)

/** One proposed occlusion card; every labelId must reference a real OCR id. */
@Generable(description = "One proposed occlusion card")
data class OcclusionSelection(
    @param:Guide(description = "Ids of the OCR labels this card covers", minItems = 1)
    val labelIds: List<String>,
    @param:Guide(description = "Question text for the card")
    val question: String,
    @param:Guide(description = "Answer text for the card")
    val answer: String
)

/** A rejected OCR label with the reason. */
@Generable(description = "A rejected OCR label")
data class OcclusionRejection(
    @param:Guide(description = "Id of the rejected OCR label")
    val labelId: String,
    @param:Guide(description = "Why the label was rejected")
    val reason: String
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: PrerequisiteAnalysis (design D23)
// ──────────────────────────────────────────────────────────────────────────

/** Candidate prerequisite concepts for selected content (D23). */
@Generable(description = "Analysis of prerequisite concepts for content")
data class PrerequisiteAnalysis(
    @param:Guide(description = "Candidate prerequisite concepts")
    val prerequisites: List<PrerequisiteEntry>
)

/** One candidate prerequisite concept. */
@Generable(description = "One candidate prerequisite")
data class PrerequisiteEntry(
    @param:Guide(description = "Name of the prerequisite concept")
    val concept: String,
    @param:Guide(description = "Why this concept appears to be a prerequisite")
    val why: String
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: PassageClassification (extract-worthiness, design D23)
// ──────────────────────────────────────────────────────────────────────────

/** Passage type and extract-worthiness score for a viewport chunk (D23). */
@Generable(description = "Classification of a reading passage")
data class PassageClassification(
    @param:Guide(description = "Type of the passage, e.g. definition, example, narrative")
    val type: String,
    @param:Guide(description = "How worth extracting the passage is, from 0.0 to 1.0", minimum = 0.0, maximum = 1.0)
    val extractWorthiness: Double,
    @param:Guide(description = "Why the passage received this classification")
    val reason: String,
    @param:Guide(description = "Suggested follow-up learning action for the passage")
    val suggestedLearningAction: String
)

// ──────────────────────────────────────────────────────────────────────────
// Envelope: TutorTurn (Socratic tutoring, design D24)
// ──────────────────────────────────────────────────────────────────────────

/** One Socratic-tutoring turn (D24). */
@Generable(description = "One tutoring turn")
data class TutorTurn(
    @param:Guide(
        description = "The tutor's move for this turn",
        enumValues = ["question", "hint", "explain", "wrap-up"]
    )
    val move: String,
    @param:Guide(description = "The tutor's message for this turn")
    val content: String,
    @param:Guide(description = "Hint level from 0 (none) to 3 (most explicit)", minimum = 0.0, maximum = 3.0)
    val hintLevel: Int,
    @param:Guide(description = "Whether the learner appears stuck")
    val stuckDetected: Boolean,
    @param:Guide(description = "Card to promote from this turn, when the learner asks to keep it")
    val promoteToCard: CardCandidate?
)

// ──────────────────────────────────────────────────────────────────────────
// Wire registry: outputMode "structured" + responseSchema -> envelope class
// ──────────────────────────────────────────────────────────────────────────

/**
 * Wire keys accepted by `NativePromptArgs.responseSchema`. Part of the
 * cross-language contract: TypeScript sends one of these strings, Kotlin maps
 * it to the compiled schema class. Unknown keys are rejected with
 * `invalid_argument` before any inference starts.
 */
internal object StructuredSchemaKey {
    const val LEARNING_MATERIAL_PROPOSAL = "learningMaterialProposal"
    const val ANSWER_ASSESSMENT = "answerAssessment"
    const val RECALL_QUESTION_PROPOSAL = "recallQuestionProposal"
    const val OCCLUSION_LABEL_SELECTION = "occlusionLabelSelection"
    const val PREREQUISITE_ANALYSIS = "prerequisiteAnalysis"
    const val PASSAGE_CLASSIFICATION = "passageClassification"
    const val TUTOR_TURN = "tutorTurn"
}

/** Envelope lookup for building typed ML Kit requests. */
internal val STRUCTURED_SCHEMA_CLASSES: Map<String, KClass<*>> = mapOf(
    StructuredSchemaKey.LEARNING_MATERIAL_PROPOSAL to LearningMaterialProposal::class,
    StructuredSchemaKey.ANSWER_ASSESSMENT to AnswerAssessment::class,
    StructuredSchemaKey.RECALL_QUESTION_PROPOSAL to RecallQuestionProposal::class,
    StructuredSchemaKey.OCCLUSION_LABEL_SELECTION to OcclusionLabelSelection::class,
    StructuredSchemaKey.PREREQUISITE_ANALYSIS to PrerequisiteAnalysis::class,
    StructuredSchemaKey.PASSAGE_CLASSIFICATION to PassageClassification::class,
    StructuredSchemaKey.TUTOR_TURN to TutorTurn::class
)

// ──────────────────────────────────────────────────────────────────────────
// JSON serialization into NativePromptResponse.structured
// ──────────────────────────────────────────────────────────────────────────

/**
 * Serialize a typed envelope returned by ML Kit into the camelCase JSON the
 * TypeScript layer expects in `NativePromptResponse.structured`.
 *
 * Null optional fields are omitted (not written as JSON null) to keep the
 * payload minimal and match the TS canonical types where they are optional.
 *
 * Unknown types cannot occur from a schema-constrained generation; the
 * IllegalArgumentException fails closed through the generic inference error
 * path rather than emitting a malformed object.
 */
internal fun structuredEnvelopeToJson(envelope: Any): JSONObject = when (envelope) {
    is LearningMaterialProposal -> envelope.toJson()
    is AnswerAssessment -> envelope.toJson()
    is RecallQuestionProposal -> envelope.toJson()
    is OcclusionLabelSelection -> envelope.toJson()
    is PrerequisiteAnalysis -> envelope.toJson()
    is PassageClassification -> envelope.toJson()
    is TutorTurn -> envelope.toJson()
    else -> throw IllegalArgumentException(
        "unknown structured envelope: ${envelope.javaClass.name}"
    )
}

private fun LearningMaterialProposal.toJson(): JSONObject = JSONObject().apply {
    put("importance", importance)
    put("knowledgeType", knowledgeType)
    put("concepts", JSONArray(concepts))
    put("suggestedCards", JSONArray(suggestedCards.map { it.toJson() }))
    put("prerequisites", JSONArray(prerequisites))
    put("tags", JSONArray(tags))
    put("rationale", rationale)
}

private fun CardCandidate.toJson(): JSONObject = JSONObject().apply {
    put("cardType", cardType)
    put("question", question)
    put("answer", answer)
    clozeText?.let { put("clozeText", it) }
    clozeRanges?.let { put("clozeRanges", JSONArray(it)) }
    put("conceptKeys", JSONArray(conceptKeys))
    imageRefId?.let { put("imageRefId", it) }
}

private fun AnswerAssessment.toJson(): JSONObject = JSONObject().apply {
    put("classification", classification)
    put("score", score)
    put("completeness", completeness)
    put("confidence", confidence)
    put("missingConcepts", JSONArray(missingConcepts))
    misconception?.let { put("misconception", it) }
    put("feedback", feedback)
    suggestedCorrection?.let { put("suggestedCorrection", it) }
}

private fun RecallQuestionProposal.toJson(): JSONObject = JSONObject().apply {
    put("question", question)
    put("expectedAnswer", expectedAnswer)
    put("conceptKeys", JSONArray(conceptKeys))
    put("chunkRefs", JSONArray(chunkRefs))
}

private fun OcclusionLabelSelection.toJson(): JSONObject = JSONObject().apply {
    put("appropriate", appropriate)
    put("selections", JSONArray(selections.map { it.toJson() }))
    put("rejected", JSONArray(rejected.map { it.toJson() }))
}

private fun OcclusionSelection.toJson(): JSONObject = JSONObject().apply {
    put("labelIds", JSONArray(labelIds))
    put("question", question)
    put("answer", answer)
}

private fun OcclusionRejection.toJson(): JSONObject = JSONObject().apply {
    put("labelId", labelId)
    put("reason", reason)
}

private fun PrerequisiteAnalysis.toJson(): JSONObject = JSONObject().apply {
    put("prerequisites", JSONArray(prerequisites.map { it.toJson() }))
}

private fun PrerequisiteEntry.toJson(): JSONObject = JSONObject().apply {
    put("concept", concept)
    put("why", why)
}

private fun PassageClassification.toJson(): JSONObject = JSONObject().apply {
    put("type", type)
    put("extractWorthiness", extractWorthiness)
    put("reason", reason)
    put("suggestedLearningAction", suggestedLearningAction)
}

private fun TutorTurn.toJson(): JSONObject = JSONObject().apply {
    put("move", move)
    put("content", content)
    put("hintLevel", hintLevel)
    put("stuckDetected", stuckDetected)
    promoteToCard?.let { put("promoteToCard", it.toJson()) }
}
