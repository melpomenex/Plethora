// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Catalog invariants and the D4 model-selection rule.

package com.plethora.androidstt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SttModelRegistryTest {

    @Test
    fun `catalog has the two supported models with unique ids`() {
        assertEquals(2, SttModelRegistry.ALL.size)
        assertEquals(
            2,
            SttModelRegistry.ALL.map { it.id }.toSet().size,
        )
    }

    @Test
    fun `manifests carry verified sizes and checksums`() {
        for (manifest in SttModelRegistry.ALL) {
            assertTrue(manifest.id, manifest.archiveBytes > 50_000_000L)
            assertTrue(manifest.id, manifest.archiveSha256.length == 64)
            assertTrue(manifest.id, manifest.url.startsWith("https://"))
            assertTrue(manifest.id, manifest.url.endsWith(".tar.bz2"))
            assertNotNull(SttModelKind.fromSerial(manifest.kind.serial))
        }
    }

    @Test
    fun `default model is sense voice`() {
        assertEquals(SttModelRegistry.SENSE_VOICE_MULTI, SttModelRegistry.fallbackDefault)
    }

    @Test
    fun `english selects parakeet only when both models ready`() {
        val parakeet = SttModelRegistry.defaultForLanguage(
            "en",
            setOf(SttModelRegistry.PARAKEET_EN.id, SttModelRegistry.SENSE_VOICE_MULTI.id),
        )
        assertEquals(SttModelRegistry.PARAKEET_EN, parakeet)
    }

    @Test
    fun `english falls back to sense voice when parakeet is missing`() {
        val model = SttModelRegistry.defaultForLanguage(
            "en-US",
            setOf(SttModelRegistry.SENSE_VOICE_MULTI.id),
        )
        assertEquals(SttModelRegistry.SENSE_VOICE_MULTI, model)
    }

    @Test
    fun `non-english languages use sense voice`() {
        for (lang in listOf("zh", "ja", "ko", "de", "fr")) {
            val model = SttModelRegistry.defaultForLanguage(
                lang,
                setOf(SttModelRegistry.PARAKEET_EN.id, SttModelRegistry.SENSE_VOICE_MULTI.id),
            )
            assertEquals(lang, SttModelRegistry.SENSE_VOICE_MULTI, model)
        }
    }

    @Test
    fun `byId resolves and rejects unknown ids`() {
        assertEquals(SttModelRegistry.PARAKEET_EN, SttModelRegistry.byId("parakeet-en-110m-int8"))
        assertEquals(null, SttModelRegistry.byId("nope"))
    }

    @Test
    fun `pacing maps serials with capped default`() {
        assertEquals(SttPacing.CAPPED, SttPacing.fromSerial(null))
        assertEquals(SttPacing.CAPPED, SttPacing.fromSerial("capped"))
        assertEquals(SttPacing.FULL, SttPacing.fromSerial("full"))
        assertEquals(SttPacing.CAPPED, SttPacing.fromSerial("bogus"))
        assertEquals(2, SttPacing.CAPPED.threads)
        assertEquals(4, SttPacing.FULL.threads)
    }
}
