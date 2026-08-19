// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidtts

import org.junit.Assert.assertEquals
import org.junit.Test

/** Word-position offset math for the System-TTS fallback's onRangeStart events. */
class WordPositionOffsetsTest {
    private val sentences = listOf("Alpha beta.", "Second sentence here.", "Third.")

    @Test
    fun joinedTextMatchesOffsets() {
        val starts = WordPositionOffsets.sentenceStarts(sentences)
        val joined = WordPositionOffsets.joinSentences(sentences)
        // Each sentence begins exactly where its start offset claims.
        for (i in sentences.indices) {
            assertEquals(sentences[i], joined.substring(starts[i], starts[i] + sentences[i].length))
        }
    }

    @Test
    fun charOffsetResolvesToItsSentence() {
        val starts = WordPositionOffsets.sentenceStarts(sentences)
        // Offset 0 → sentence 0 start.
        assertEquals(0, WordPositionOffsets.resolve(sentences, starts, 0, 5).first)
        // Offset in the middle of sentence 1.
        val mid = starts[1] + 7
        val (index, within, length) = WordPositionOffsets.resolve(sentences, starts, mid, 8)
        assertEquals(1, index)
        assertEquals(7, within)
        // Length clamps to the remainder of the sentence.
        assertEquals(sentences[1].length - 7, length)
    }

    @Test
    fun offsetsPastTheEndClampToTheLastSentence() {
        val starts = WordPositionOffsets.sentenceStarts(sentences)
        val (index, _, length) = WordPositionOffsets.resolve(sentences, starts, 10_000, 5)
        assertEquals(sentences.lastIndex, index)
        assertEquals(0, length)
    }
}
