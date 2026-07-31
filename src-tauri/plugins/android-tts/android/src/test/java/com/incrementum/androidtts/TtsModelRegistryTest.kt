// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the model registry catalog. These run as plain JVM JUnit tests
// (no Android device needed) because TtsModelRegistry is pure data.

package com.incrementum.androidtts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TtsModelRegistryTest {

    @Test
    fun `kitten-nano is the default and first in catalog`() {
        assertEquals("kitten-nano", TtsModelRegistry.KITTEN_NANO.id)
        assertTrue(TtsModelRegistry.KITTEN_NANO.isDefault)
        assertEquals(TtsModelRegistry.KITTEN_NANO, TtsModelRegistry.ALL.first())
        assertEquals(TtsModelRegistry.KITTEN_NANO, TtsModelRegistry.fallbackDefault)
    }

    @Test
    fun `kokoro is optional and not default`() {
        assertEquals("kokoro-en-v0_19", TtsModelRegistry.KOKORO.id)
        assertFalse(TtsModelRegistry.KOKORO.isDefault)
    }

    @Test
    fun `byId resolves known models`() {
        assertNotNull(TtsModelRegistry.byId("kitten-nano"))
        assertNotNull(TtsModelRegistry.byId("kokoro-en-v0_19"))
        assertNull(TtsModelRegistry.byId("does-not-exist"))
    }

    @Test
    fun `kitten maps to kitten kind, kokoro maps to kokoro kind`() {
        assertEquals(TtsModelKind.KITTEN, TtsModelRegistry.KITTEN_NANO.kind)
        assertEquals(TtsModelKind.KOKORO, TtsModelRegistry.KOKORO.kind)
    }

    @Test
    fun `kind serializes to lowercase strings`() {
        assertEquals("kitten", TtsModelKind.KITTEN.serial)
        assertEquals("kokoro", TtsModelKind.KOKORO.serial)
        assertEquals(TtsModelKind.KITTEN, TtsModelKind.fromSerial("kitten"))
        assertNull(TtsModelKind.fromSerial("unknown"))
    }

    @Test
    fun `every model declares a non-empty voice roster`() {
        for (m in TtsModelRegistry.ALL) {
            assertTrue("model ${m.id} has no voices", m.voices.isNotEmpty())
        }
    }

    @Test
    fun `every model has at least one asset file`() {
        for (m in TtsModelRegistry.ALL) {
            assertTrue("model ${m.id} has no files", m.files.isNotEmpty())
            assertTrue("model ${m.id} download size <= 0", m.files.sumOf { it.sizeBytes } > 0)
        }
    }
}
