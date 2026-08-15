// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0

package com.incrementum.androidgenai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure JVM tests for the OCR label pipeline (task 3.2): normalization math,
 * id stability, result-cap clamping, and DTO serialization. The live
 * recognizer needs Play Services — see the androidTest stub for the on-device
 * path.
 */
class OcrSupportTest {

    // ── normalizeBoxToPercent ───────────────────────────────────────────────

    @Test
    fun `identity mapping keeps a full-image box at 0 0 100 100`() {
        val box = normalizeBoxToPercent(0, 0, 1000, 500, 1000, 500)
        assertEquals(0.0, box.x, 1e-9)
        assertEquals(0.0, box.y, 1e-9)
        assertEquals(100.0, box.width, 1e-9)
        assertEquals(100.0, box.height, 1e-9)
    }

    @Test
    fun `center quarter of the image normalizes to 25 25 50 50`() {
        val box = normalizeBoxToPercent(250, 125, 750, 375, 1000, 500)
        assertEquals(25.0, box.x, 1e-9)
        assertEquals(25.0, box.y, 1e-9)
        assertEquals(50.0, box.width, 1e-9)
        assertEquals(50.0, box.height, 1e-9)
    }

    @Test
    fun `boxes outside the image clamp instead of going negative or over 100`() {
        // Left half outside the frame: clips to 0..10% horizontally.
        val left = normalizeBoxToPercent(-500, 0, 100, 100, 1000, 1000)
        assertEquals(0.0, left.x, 1e-9)
        assertEquals(10.0, left.width, 1e-9)
        // Right/bottom beyond the frame: clips at 100.
        val right = normalizeBoxToPercent(900, 900, 2000, 2000, 1000, 1000)
        assertEquals(90.0, right.x, 1e-9)
        assertEquals(90.0, right.y, 1e-9)
        assertEquals(10.0, right.width, 1e-9)
        assertEquals(10.0, right.height, 1e-9)
    }

    @Test
    fun `degenerate boxes collapse to zero size, never negative`() {
        val zeroSize = normalizeBoxToPercent(100, 100, 100, 100, 1000, 1000)
        assertEquals(0.0, zeroSize.width, 1e-9)
        assertEquals(0.0, zeroSize.height, 1e-9)
        // Inverted boxes (right < left) also collapse to zero, not negative.
        val inverted = normalizeBoxToPercent(800, 800, 200, 200, 1000, 1000)
        assertTrue(inverted.width >= 0.0)
        assertTrue(inverted.height >= 0.0)
    }

    @Test
    fun `zero-dimension images are guarded against division by zero`() {
        val box = normalizeBoxToPercent(0, 0, 0, 0, 0, 0)
        assertEquals(0.0, box.x, 1e-9)
        assertEquals(0.0, box.width, 1e-9)
    }

    @Test
    fun `scaling an image keeps the same percent box`() {
        val small = normalizeBoxToPercent(25, 25, 75, 75, 100, 100)
        val large = normalizeBoxToPercent(250, 500, 750, 1500, 1000, 2000)
        assertEquals(small.x, large.x, 1e-9)
        assertEquals(small.y, large.y, 1e-9)
        assertEquals(small.width, large.width, 1e-9)
        assertEquals(small.height, large.height, 1e-9)
    }

    // ── id stability + result caps ──────────────────────────────────────────

    @Test
    fun `label ids are stable and ordinal-scoped`() {
        assertEquals(stableOcrLabelId(0, "Mitochondria"), stableOcrLabelId(0, "Mitochondria"))
        // Same text at different ordinals yields different ids.
        assertTrue(stableOcrLabelId(0, "Nucleus") != stableOcrLabelId(1, "Nucleus"))
        // Same ordinal with different text yields different ids.
        assertTrue(stableOcrLabelId(0, "Nucleus") != stableOcrLabelId(0, "Ribosome"))
        assertTrue(stableOcrLabelId(3, "Golgi").startsWith("ocr-3-"))
    }

    @Test
    fun `maxResults clamps into the bounded range`() {
        assertEquals(DEFAULT_MAX_OCR_LABELS, clampMaxOcrResults(null))
        assertEquals(1, clampMaxOcrResults(0))
        assertEquals(1, clampMaxOcrResults(-5))
        assertEquals(12, clampMaxOcrResults(12))
        assertEquals(MAX_OCR_LABELS, clampMaxOcrResults(10_000))
    }

    // ── DTO serialization ───────────────────────────────────────────────────

    @Test
    fun `label dto serializes camelCase fields with optional confidence`() {
        val json = OcrLabelDto(
            id = "ocr-0-abc",
            text = "Mitochondria",
            confidence = 0.87,
            x = 10.5,
            y = 20.25,
            width = 5.5,
            height = 3.0,
            pixelBox = intArrayOf(105, 405, 160, 465)
        ).toJsObject()
        assertEquals("ocr-0-abc", json.getString("id"))
        assertEquals("Mitochondria", json.getString("text"))
        assertEquals(0.87, json.getDouble("confidence"), 1e-9)
        assertEquals(10.5, json.getDouble("x"), 1e-9)
        assertEquals(20.25, json.getDouble("y"), 1e-9)
        assertEquals(5.5, json.getDouble("width"), 1e-9)
        assertEquals(3.0, json.getDouble("height"), 1e-9)
        assertEquals(4, json.getJSONArray("pixelBox").length())
        assertEquals(105, json.getJSONArray("pixelBox").getInt(0))
    }

    @Test
    fun `label dto omits null confidence`() {
        val json = OcrLabelDto(
            id = "ocr-1-x",
            text = "Ribosome",
            confidence = null,
            x = 1.0,
            y = 2.0,
            width = 3.0,
            height = 4.0,
            pixelBox = intArrayOf(0, 0, 1, 1)
        ).toJsObject()
        assertFalse(json.has("confidence"))
    }

    @Test
    fun `result dto serializes labels plus source dimensions and truncation`() {
        val result = OcrLabelsResultDto(
            labels = listOf(
                OcrLabelDto(
                    id = "ocr-0-a",
                    text = "Label",
                    confidence = null,
                    x = 0.0,
                    y = 0.0,
                    width = 50.0,
                    height = 10.0,
                    pixelBox = intArrayOf(0, 0, 500, 100)
                )
            ),
            sourceWidth = 1000,
            sourceHeight = 1000,
            truncated = true
        ).toJsObject()
        assertEquals(1, result.getJSONArray("labels").length())
        assertEquals(1000, result.getInt("sourceWidth"))
        assertEquals(1000, result.getInt("sourceHeight"))
        assertTrue(result.getBoolean("truncated"))
        // Nested label round-trips through the real org.json implementation.
        val label = result.getJSONArray("labels").getJSONObject(0)
        assertEquals("ocr-0-a", label.getString("id"))
        assertEquals(50.0, label.getDouble("width"), 1e-9)
        assertEquals(4, label.getJSONArray("pixelBox").length())
        JSONObject(label.toString()) // must be valid JSON text
    }
}
