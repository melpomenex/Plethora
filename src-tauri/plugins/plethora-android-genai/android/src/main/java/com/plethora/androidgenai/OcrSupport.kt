// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// ML Kit Text Recognition v2 (Latin, bundled) support for the android-genai
// plugin (design D18 / task 3.2).
//
// `ocrImageLabels` turns one base64 image into text labels with bounding
// boxes NORMALIZED TO PERCENT 0–100 of the source bitmap. The percent boxes
// are the only geometry the OCR-backed occlusion flow ever trusts: the
// generative model receives these boxes by id and never produces coordinates
// of its own.
//
// Everything geometric is implemented as pure JVM functions so local unit
// tests can pin the normalization math without a device or Play Services.

package com.plethora.androidgenai

import app.tauri.annotation.InvokeArg
import app.tauri.plugin.JSObject
import org.json.JSONArray

/** Arguments for the `ocrImageLabels` plugin command. */
@InvokeArg
class OcrImageArgs {
    /** Base64-encoded image bytes (jpeg, png, or webp; no data-url prefix). */
    var base64Image: String? = null

    /** Cap on returned labels; clamped into 1..MAX_OCR_LABELS. */
    var maxResults: Int? = null
}

/** Default label cap: dense diagrams produce dozens of lines, Nano prompt
 * space is scarce, and more than this is noise for card authoring. */
internal const val DEFAULT_MAX_OCR_LABELS = 24

/** Absolute cap regardless of what the caller asked for. */
internal const val MAX_OCR_LABELS = 64

/** A text label with its box normalized to percent 0–100 of the source image. */
internal data class OcrLabelDto(
    /** Stable id: ordinal + hash of the text (task contract). */
    val id: String,
    val text: String,
    /** Recognizer confidence 0–1, or null when the recognizer reported none. */
    val confidence: Double?,
    /** Left edge, percent of image width. */
    val x: Double,
    /** Top edge, percent of image height. */
    val y: Double,
    /** Width, percent of image width. */
    val width: Double,
    /** Height, percent of image height. */
    val height: Double,
    /** Raw pixel box (left, top, right, bottom) for diagnostics. */
    val pixelBox: IntArray
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("id", id)
        put("text", text)
        confidence?.let { put("confidence", it) }
        put("x", x)
        put("y", y)
        put("width", width)
        put("height", height)
        put("pixelBox", JSONArray(pixelBox.toList()))
    }
}

/** Complete `ocrImageLabels` result: labels plus the source bitmap dims the
 * percents were normalized against (callers need them for re-rendering). */
internal data class OcrLabelsResultDto(
    val labels: List<OcrLabelDto>,
    val sourceWidth: Int,
    val sourceHeight: Int,
    /** True when labels were dropped because `maxResults` capped the list. */
    val truncated: Boolean
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("labels", JSONArray(labels.map { it.toJsObject() }))
        put("sourceWidth", sourceWidth)
        put("sourceHeight", sourceHeight)
        put("truncated", truncated)
    }
}

/** Percent rectangle (0–100, clamped) of the source image. */
internal data class PercentBox(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double
)

/**
 * Normalize one pixel box to percent 0–100 of the image and clamp to bounds:
 * a box partially outside the image clips to the image edge, and a
 * degenerate/zero-dimension input collapses to zero width/height (never
 * negative, never > 100).
 */
internal fun normalizeBoxToPercent(
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    imageWidth: Int,
    imageHeight: Int
): PercentBox {
    val width = imageWidth.coerceAtLeast(1).toDouble()
    val height = imageHeight.coerceAtLeast(1).toDouble()

    fun percent(value: Int, total: Double): Double =
        (value / total * 100.0).coerceIn(0.0, 100.0)

    val x = percent(left, width)
    val y = percent(top, height)
    val rightPercent = percent(right, width)
    val bottomPercent = percent(bottom, height)
    return PercentBox(
        x = x,
        y = y,
        width = Math.max(0.0, rightPercent - x),
        height = Math.max(0.0, bottomPercent - y)
    )
}

/**
 * Stable label id: ordinal + signed 32-bit hash of the text. Two runs over
 * the same image produce the same ids in the same order, which is what the
 * label-reference validation on the TypeScript side relies on.
 */
internal fun stableOcrLabelId(ordinal: Int, text: String): String {
    val hash = java.lang.Integer.toHexString(text.hashCode())
    return "ocr-$ordinal-$hash"
}

/** Clamp a caller-requested label cap into [1, MAX_OCR_LABELS]. */
internal fun clampMaxOcrResults(requested: Int?): Int =
    (requested ?: DEFAULT_MAX_OCR_LABELS).coerceIn(1, MAX_OCR_LABELS)
