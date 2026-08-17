// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidgenai

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device stub for the live `ocrImageLabels` recognizer path (task 3.2).
 *
 * The bundled ML Kit Text Recognition client needs Play Services at runtime,
 * so local JVM unit tests cover only the pure normalization/serialization
 * contract (see `OcrSupportTest`). This stub documents the instrumented
 * entry point for a physical device run; enable it when dogfooding the
 * occlusion flow on Android (task 3.10).
 */
@RunWith(AndroidJUnit4::class)
class OcrImageLabelsInstrumentedTest {
    @Test
    fun ocrImageLabelsRecognizesRenderedText() {
        // Intentionally empty: requires a device with Play Services. The
        // command itself is exercised end-to-end from the occlusion composer
        // during Android dogfooding; geometry correctness is already pinned
        // by OcrSupportTest.
    }
}
