// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// JVM unit tests for the on-device embedding backend's pure logic (task 4.5):
// artifact constants, prompt templates, model-input assembly, vector math,
// status state machine, the sha256-verified download manager, the hand-rolled
// SentencePiece BPE tokenizer, and DTO serialization. Nothing here needs a
// device, LiteRT natives, or the (gated) model artifacts — the tokenizer tests
// run against a synthetic Gemma-shaped proto built below.
//
// The optional real-artifact smoke test at the bottom is enabled by pointing
// EMBEDDINGGEMMA_TOKENIZER_PATH at a downloaded sentencepiece.model; it skips
// silently in CI.

package com.plethora.androidgenai

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EmbeddingSupportTest {

    @get:Rule
    val tempDir = TemporaryFolder()

    // ──────────────────────────────────────────────────────────────────────
    // Artifact constants
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun pinned_sha256_constants_are_well_formed() {
        assertTrue(isValidSha256(EMBEDDING_MODEL_SHA256))
        assertTrue(isValidSha256(EMBEDDING_TOKENIZER_SHA256))
        assertFalse(isValidSha256("zz"))
        assertFalse(isValidSha256("ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345678")) // 63 + non-hex
    }

    @Test
    fun download_urls_are_https_and_name_the_pinned_files() {
        val modelUrls = embeddingModelUrls()
        val tokenizerUrls = embeddingTokenizerUrls()
        assertEquals(2, modelUrls.size)
        assertEquals(2, tokenizerUrls.size)
        modelUrls.forEach { url ->
            assertTrue(url.startsWith("https://"))
            assertTrue(url.endsWith(EMBEDDING_MODEL_FILE))
        }
        tokenizerUrls.forEach { url ->
            assertTrue(url.startsWith("https://"))
            assertTrue(url.endsWith(EMBEDDING_TOKENIZER_FILE))
        }
        // Canonical HF repo first, anonymous mirror as fallback.
        assertTrue(modelUrls[0].contains("huggingface.co/litert-community/embeddinggemma-300m"))
        assertTrue(modelUrls[1].contains("modelscope.cn/models/litert-community/embeddinggemma-300m"))
    }

    @Test
    fun artifact_sizes_are_sane() {
        assertTrue("model ~179 MB", EMBEDDING_MODEL_BYTES in 150_000_000L..250_000_000L)
        assertTrue("tokenizer ~4.7 MB", EMBEDDING_TOKENIZER_BYTES in 1_000_000L..10_000_000L)
        assertEquals(768, EMBEDDING_DIMENSION)
        assertEquals(512, EMBEDDING_SEQ_LEN)
        assertEquals("embeddinggemma-300m", EMBEDDING_MODEL_NAME)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Prompt templates (EmbeddingGemma model card)
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun prompt_templates_match_model_card() {
        assertEquals("title: none | text: The cat sat.", formatDocumentPrompt("The cat sat."))
        assertEquals("task: search result | query: cats", formatQueryPrompt("cats"))
        // Unknown/absent kind falls back to the document template.
        assertEquals(formatDocumentPrompt("x"), formatEmbeddingPrompt("x", null))
        assertEquals(formatDocumentPrompt("x"), formatEmbeddingPrompt("x", "document"))
        assertEquals(formatQueryPrompt("x"), formatEmbeddingPrompt("x", "query"))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Input assembly and vector math
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun model_input_assembles_bos_tokens_eos_pad() {
        val ids = buildModelInputIds(listOf(5, 6, 7), bosId = 2, eosId = 1, padId = 0, seqLen = 8)
        assertEquals(listOf(2, 5, 6, 7, 1, 0, 0, 0), ids.toList())
    }

    @Test
    fun model_input_truncates_body_to_seq_len_minus_two() {
        val ids = buildModelInputIds((1..20).toList(), bosId = 2, eosId = 1, padId = 0, seqLen = 6)
        assertEquals(listOf(2, 1, 2, 3, 4, 1), ids.toList())
    }

    @Test
    fun model_input_with_empty_tokens_is_bos_eos_pad() {
        val ids = buildModelInputIds(emptyList(), bosId = 2, eosId = 1, padId = 0, seqLen = 4)
        assertEquals(listOf(2, 1, 0, 0), ids.toList())
    }

    @Test
    fun l2_normalize_produces_unit_vectors() {
        val out = l2Normalize(floatArrayOf(3f, 4f))
        assertEquals(0.6f, out[0], 1e-6f)
        assertEquals(0.8f, out[1], 1e-6f)
        val norm = Math.sqrt(out.map { (it.toDouble() * it).toDouble() }.sum())
        assertEquals(1.0, norm, 1e-5)
    }

    @Test
    fun l2_normalize_handles_zero_and_unit_vectors() {
        val zero = l2Normalize(floatArrayOf(0f, 0f, 0f))
        assertTrue(zero.all { it == 0f })
        val unit = l2Normalize(floatArrayOf(1f, 0f, 0f))
        assertEquals(1f, unit[0], 1e-6f)
        val original = floatArrayOf(0.5f, 0.5f)
        val normalized = l2Normalize(original)
        // Input is not mutated.
        assertEquals(0.5f, original[0], 0f)
        assertTrue(normalized[0] != original[0])
    }

    // ──────────────────────────────────────────────────────────────────────
    // embedTexts argument validation
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun embed_texts_args_validation() {
        assertNotNull(embedTextsArgsError(null))
        assertNotNull(embedTextsArgsError(emptyList()))
        assertNotNull(embedTextsArgsError(listOf("ok", "  ")))
        assertTrue(embedTextsArgsError(listOf("a".repeat(EMBEDDING_MAX_TEXT_CHARS + 1)))!!
            .contains("character limit"))
        val tooMany = (1..EMBEDDING_MAX_TEXTS + 1).map { "text$it" }
        assertTrue(embedTextsArgsError(tooMany)!!.contains("at most"))
        assertNull(embedTextsArgsError(listOf("one")))
        assertNull(embedTextsArgsError((1..EMBEDDING_MAX_TEXTS).map { "t$it" }))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Status state machine
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun status_reports_feature_not_compiled_first() {
        val status = embeddingStatusOf(compiled = false, modelPresent = true, tokenizerPresent = true, partFileBytes = null)
        assertEquals("unavailable", status.status)
        assertEquals("feature_not_compiled", status.reason)
    }

    @Test
    fun status_downloadable_when_artifacts_missing() {
        val status = embeddingStatusOf(true, modelPresent = false, tokenizerPresent = false, partFileBytes = null)
        assertEquals("downloadable", status.status)
        assertEquals("model_downloadable", status.reason)
        assertEquals(EMBEDDING_MODEL_BYTES + EMBEDDING_TOKENIZER_BYTES, status.totalBytes)
        assertEquals(0L, status.bytesDownloaded)
    }

    @Test
    fun status_downloading_while_part_file_exists() {
        val tokenizerPhase = embeddingStatusOf(true, false, false, partFileBytes = 1_000L)
        assertEquals("downloading", tokenizerPhase.status)
        assertEquals("model_downloading", tokenizerPhase.reason)
        assertEquals(EMBEDDING_TOKENIZER_BYTES, tokenizerPhase.totalBytes)

        val modelPhase = embeddingStatusOf(true, false, true, partFileBytes = EMBEDDING_TOKENIZER_BYTES + 500)
        assertEquals("downloading", modelPhase.status)
        assertEquals(EMBEDDING_MODEL_BYTES, modelPhase.totalBytes)
    }

    @Test
    fun status_available_when_both_artifacts_present() {
        val status = embeddingStatusOf(true, true, true, partFileBytes = null)
        assertEquals("available", status.status)
        assertNull(status.reason)
        assertEquals(EMBEDDING_MODEL_NAME, status.model)
        assertEquals(EMBEDDING_DIMENSION, status.dimension)
    }

    @Test
    fun model_files_presence_checks_use_pinned_sizes() {
        val dir = tempDir.newFolder()
        // Tiny injected sizes so the test never allocates a 179 MB fixture.
        val files = EmbeddingModelFiles(dir, modelBytes = 10, tokenizerBytes = 4)
        assertFalse(files.modelPresent())
        assertFalse(files.tokenizerPresent())
        assertFalse(files.allPresent())
        assertNull(files.partFileBytes())

        files.modelFile.writeBytes(ByteArray(9))
        assertFalse("wrong model size must not count", files.modelPresent())

        files.modelFile.writeBytes(ByteArray(10))
        assertTrue(files.modelPresent())

        files.tokenizerFile.writeBytes(ByteArray(4))
        assertTrue(files.tokenizerPresent())
        assertTrue(files.allPresent())

        files.modelPartFile.writeBytes(ByteArray(3))
        assertEquals(3L, files.partFileBytes())

        files.modelPartFile.delete()
        files.tokenizerPartFile.writeBytes(ByteArray(1))
        assertEquals(1L, files.partFileBytes())
    }

    // ──────────────────────────────────────────────────────────────────────
    // Download manager
    // ──────────────────────────────────────────────────────────────────────

    private class FakeSource(
        override val status: Int,
        private val bytes: ByteArray,
        override val contentLength: Long = bytes.size.toLong()
    ) : HttpSource {
        override val body: InputStream = ByteArrayInputStream(bytes)
        override fun close() {}
    }

    private fun sha256Of(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test
    fun download_verifies_digest_and_promotes_artifact() {
        val content = "tokenizer-bytes".toByteArray()
        val dest = File(tempDir.newFolder(), "artifact.bin")
        val events = mutableListOf<EmbeddingProgressDto>()
        downloadVerifiedArtifact(
            opener = { FakeSource(200, content) },
            urls = listOf("https://example.test/artifact.bin"),
            dest = dest,
            fileName = "artifact.bin",
            expectedBytes = content.size.toLong(),
            expectedSha256 = sha256Of(content),
            onProgress = { events.add(it) },
            progressBytesStep = 4
        )
        assertTrue(dest.isFile)
        assertEquals(content.size.toLong(), dest.length())
        assertTrue(content.contentEquals(dest.readBytes()))
        assertEquals(100, events.last().percent)
        assertTrue(events.last().bytesDownloaded == content.size.toLong())
        assertTrue(events.first().bytesDownloaded > 0)
    }

    @Test
    fun download_falls_back_when_gate_returns_401() {
        val content = "model-bytes".toByteArray()
        val dest = File(tempDir.newFolder(), "artifact.bin")
        val statuses = mutableListOf<Int>()
        downloadVerifiedArtifact(
            opener = { url ->
                val status = if (url.contains("huggingface")) 401 else 200
                statuses.add(status)
                FakeSource(status, content)
            },
            urls = listOf(
                "https://huggingface.test/gated",
                "https://mirror.test/open"
            ),
            dest = dest,
            fileName = "artifact.bin",
            expectedBytes = content.size.toLong(),
            expectedSha256 = sha256Of(content),
            onProgress = {}
        )
        assertEquals(listOf(401, 200), statuses)
        assertTrue(content.contentEquals(dest.readBytes()))
    }

    @Test
    fun download_digest_mismatch_is_fatal() {
        val content = "corrupted".toByteArray()
        val dest = File(tempDir.newFolder(), "artifact.bin")
        try {
            downloadVerifiedArtifact(
                opener = { FakeSource(200, content) },
                urls = listOf("https://a.test/x", "https://b.test/x"),
                dest = dest,
                fileName = "artifact.bin",
                expectedBytes = content.size.toLong(),
                expectedSha256 = "ab".repeat(32),
                onProgress = {}
            )
            fail("digest mismatch must throw")
        } catch (e: EmbeddingDownloadException) {
            assertEquals("model_unavailable", e.errorCode)
            assertTrue(e.message!!, e.message!!.contains("sha256 mismatch"))
        }
        assertFalse(dest.isFile)
        assertFalse(File(dest.parentFile, dest.name + ".part").isFile)
    }

    @Test
    fun download_rejects_source_advertising_wrong_length() {
        val content = "abc".toByteArray()
        val dest = File(tempDir.newFolder(), "artifact.bin")
        try {
            downloadVerifiedArtifact(
                opener = { FakeSource(200, content, contentLength = 999) },
                urls = listOf("https://a.test/x"),
                dest = dest,
                fileName = "artifact.bin",
                expectedBytes = 3,
                expectedSha256 = sha256Of(content),
                onProgress = {}
            )
            fail("length mismatch must throw")
        } catch (e: EmbeddingDownloadException) {
            assertTrue(e.message!!, e.message!!.contains("pinned to"))
        }
    }

    @Test
    fun download_all_sources_failing_reports_model_unavailable() {
        val dest = File(tempDir.newFolder(), "artifact.bin")
        try {
            downloadVerifiedArtifact(
                opener = { FakeSource(404, ByteArray(0)) },
                urls = listOf("https://a.test/x", "https://b.test/x"),
                dest = dest,
                fileName = "artifact.bin",
                expectedBytes = 3,
                expectedSha256 = "ab".repeat(32),
                onProgress = {}
            )
            fail("all sources failing must throw")
        } catch (e: EmbeddingDownloadException) {
            assertEquals("model_unavailable", e.errorCode)
            assertTrue(e.message!!, e.message!!.contains("all download sources failed"))
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // DTO serialization
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun status_dto_serializes_camel_case() {
        val json = embeddingStatusOf(true, true, true, null).toJsObject()
        assertEquals("available", json.getString("status"))
        assertEquals(EMBEDDING_MODEL_NAME, json.getString("model"))
        assertEquals(768, json.getInt("dimension"))
        assertFalse(json.has("reason"))
        assertTrue(json.has("checkedAt"))
    }

    @Test
    fun embed_result_dto_serializes_nested_vectors() {
        val json = EmbedTextsResultDto(
            vectors = listOf(floatArrayOf(1f, 2.5f), floatArrayOf(3f)),
            dimension = 768,
            model = EMBEDDING_MODEL_NAME
        ).toJsObject()
        val vectors = json.getJSONArray("vectors")
        assertEquals(2, vectors.length())
        assertEquals(2.5, vectors.getJSONArray(0).getDouble(1), 1e-9)
        assertEquals(768, json.getInt("dimension"))
    }

    @Test
    fun progress_dto_serializes_event_envelope() {
        val json = EmbeddingProgressDto("f.bin", 10, 100, 10).toJsObject()
        assertEquals("progress", json.getString("event"))
        assertEquals("f.bin", json.getString("file"))
        assertEquals(10L, json.getLong("bytesDownloaded"))
        assertEquals(100L, json.getLong("totalBytes"))
        assertEquals(10, json.getInt("percent"))
    }

    // ──────────────────────────────────────────────────────────────────────
    // SentencePiece BPE tokenizer (synthetic Gemma-shaped proto)
    // ──────────────────────────────────────────────────────────────────────

    /** Builds a minimal ModelProto byte string. */
    private class ProtoBuilder {
        private val out = java.io.ByteArrayOutputStream()

        private fun varint(value: Long) {
            var v = value
            while (true) {
                val b = (v and 0x7F).toInt()
                v = v ushr 7
                if (v == 0L) {
                    out.write(b)
                    return
                }
                out.write(b or 0x80)
            }
        }

        private fun tag(field: Int, wire: Int) = varint(((field shl 3) or wire).toLong())

        fun varintField(field: Int, value: Long) {
            tag(field, 0)
            varint(value)
        }

        fun bytesField(field: Int, payload: ByteArray) {
            tag(field, 2)
            varint(payload.size.toLong())
            out.write(payload)
        }

        fun floatField(field: Int, value: Float) {
            tag(field, 5)
            val bits = java.lang.Float.floatToRawIntBits(value)
            out.write(bits and 0xFF)
            out.write((bits shr 8) and 0xFF)
            out.write((bits shr 16) and 0xFF)
            out.write((bits shr 24) and 0xFF)
        }

        fun build(): ByteArray = out.toByteArray()
    }

    private fun piece(piece: String, score: Float, type: Int): ByteArray =
        ProtoBuilder().apply {
            bytesField(1, piece.toByteArray(Charsets.UTF_8))
            floatField(2, score)
            varintField(3, type.toLong())
        }.build()

    private fun gemmaLikeModel(
        normalPieces: List<Pair<String, Float>>,
        byteFallback: Boolean = true,
        userDefined: List<String> = emptyList(),
        // Gemma flags: identity normalizer, no dummy prefix, no whitespace
        // collapsing, spaces escaped.
        addDummyPrefix: Boolean = false,
        removeExtraWhitespaces: Boolean = false,
        bytePieces: List<Int> = emptyList()
    ): ByteArray {
        val proto = ProtoBuilder()
        // Reserved pieces 0..3: <pad> CONTROL, <eos> CONTROL, <bos> CONTROL, <unk> UNKNOWN.
        proto.bytesField(1, piece("<pad>", 0f, SpPieceType.CONTROL))
        proto.bytesField(1, piece("<eos>", 0f, SpPieceType.CONTROL))
        proto.bytesField(1, piece("<bos>", 0f, SpPieceType.CONTROL))
        proto.bytesField(1, piece("<unk>", 0f, SpPieceType.UNKNOWN))
        bytePieces.forEach { byteValue ->
            proto.bytesField(
                1,
                piece(String.format("<0x%02X>", byteValue), 0f, SpPieceType.BYTE)
            )
        }
        userDefined.forEach { proto.bytesField(1, piece(it, 0f, SpPieceType.USER_DEFINED)) }
        normalPieces.forEach { (text, score) ->
            proto.bytesField(1, piece(text, score, SpPieceType.NORMAL))
        }
        // TrainerSpec (field 2): byte_fallback=35, unk=40, bos=41, eos=42, pad=43.
        val trainer = ProtoBuilder().apply {
            varintField(35, if (byteFallback) 1 else 0)
            varintField(40, 3) // unk
            varintField(41, 2) // bos
            varintField(42, 1) // eos
            varintField(43, 0) // pad
        }.build()
        proto.bytesField(2, trainer)
        // NormalizerSpec (field 3): add_dummy_prefix=3, remove_extra_whitespaces=4,
        // escape_whitespaces=5.
        val normalizer = ProtoBuilder().apply {
            bytesField(1, "identity".toByteArray())
            varintField(3, if (addDummyPrefix) 1 else 0)
            varintField(4, if (removeExtraWhitespaces) 1 else 0)
            varintField(5, 1)
        }.build()
        proto.bytesField(3, normalizer)
        return proto.build()
    }

    @Test
    fun tokenizer_parses_ids_and_flags_from_proto() {
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(normalPieces = listOf("a" to -0f, "b" to -1f, "ab" to -2f))
        )
        assertEquals(4 + 3, tokenizer.vocabSize)
        assertEquals(3, tokenizer.unkId)
        assertEquals(2, tokenizer.bosId)
        assertEquals(1, tokenizer.eosId)
        assertEquals(0, tokenizer.padId)
        assertTrue(tokenizer.byteFallback)
        assertFalse(tokenizer.addDummyPrefix)
        assertFalse(tokenizer.removeExtraWhitespaces)
        assertTrue(tokenizer.escapeWhitespaces)
    }

    @Test
    fun tokenizer_merges_by_rank() {
        // "abcd": cd (rank 1) merges before ab (rank 10); then abcd (rank 5).
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf(
                    "a" to -0f, "b" to -0f, "c" to -0f, "d" to -0f,
                    "ab" to -10f, "cd" to -1f, "abcd" to -5f
                )
            )
        )
        val ids = tokenizer.encode("abcd")
        assertEquals(listOf<Long>(idOf(tokenizer, "abcd").toLong()), ids.map { it.toLong() })
    }

    @Test
    fun tokenizer_breaks_rank_ties_leftmost() {
        // "abc": ab and bc share rank 1 — the leftmost pair wins, then no
        // further merges apply ("abc" not in vocab).
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf(
                    "a" to -0f, "b" to -0f, "c" to -0f,
                    "ab" to -1f, "bc" to -1f
                )
            )
        )
        val ids = tokenizer.encode("abc")
        assertEquals(
            listOf(idOf(tokenizer, "ab"), idOf(tokenizer, "c")),
            ids
        )
    }

    @Test
    fun tokenizer_escapes_spaces_without_dummy_prefix_and_is_lossless() {
        // Gemma flags: "hello world" → "hello▁world", reassembled losslessly.
        val pieces = listOf(
            "h" to -0f, "e" to -0f, "l" to -0f, "o" to -0f, "▁" to -0f,
            "w" to -0f, "r" to -0f, "d" to -0f,
            "ll" to -1f, "he" to -2f, "hell" to -3f, "hello" to -4f,
            "▁w" to -5f, "or" to -6f, "▁wor" to -7f, "▁world" to -8f
        )
        val tokenizer = SentencePieceBpeTokenizer(gemmaLikeModel(pieces))
        val ids = tokenizer.encode("hello world")
        assertTrue(ids.isNotEmpty())
        assertTrue(ids.all { it >= 0 && it < tokenizer.vocabSize })
        val joined = ids.joinToString("") { tokenizer.pieces[it].piece }
        assertEquals("hello▁world", joined)
    }

    @Test
    fun tokenizer_applies_dummy_prefix_when_configured() {
        val pieces = listOf(
            "a" to -0f, "▁" to -0f, "▁a" to -1f
        )
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(pieces, addDummyPrefix = true)
        )
        val ids = tokenizer.encode("a")
        assertEquals(listOf(idOf(tokenizer, "▁a")), ids)
    }

    @Test
    fun tokenizer_collapses_whitespace_when_configured() {
        val pieces = listOf(
            "a" to -0f, "b" to -0f, "▁" to -0f,
            "▁a" to -1f, "▁b" to -2f
        )
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(pieces, addDummyPrefix = true, removeExtraWhitespaces = true)
        )
        val ids = tokenizer.encode("  a   b  ")
        val joined = ids.joinToString("") { tokenizer.pieces[it].piece }
        assertEquals("▁a▁b", joined)
    }

    @Test
    fun tokenizer_user_defined_pieces_are_atomic() {
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf(
                    "<" to -0f, "m" to -0f, "a" to -0f, "s" to -0f,
                    "k" to -0f, ">" to -0f, "<m" to -1f, "as" to -2f
                ),
                userDefined = listOf("<mask>")
            )
        )
        val ids = tokenizer.encode("<mask>")
        assertEquals(listOf<Long>(idOf(tokenizer, "<mask>").toLong()), ids.map { it.toLong() })
    }

    @Test
    fun tokenizer_byte_fallback_for_uncovered_code_points() {
        // 'é' (U+00E9) has no piece; UTF-8 bytes are 0xC3 0xA9.
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf("a" to -0f),
                bytePieces = listOf(0xC3, 0xA9)
            )
        )
        val ids = tokenizer.encode("aé")
        assertEquals(
            listOf(idOf(tokenizer, "a"), idOf(tokenizer, "<0xC3>"), idOf(tokenizer, "<0xA9>")),
            ids
        )
    }

    @Test
    fun tokenizer_unknown_without_byte_fallback_is_unk() {
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(normalPieces = listOf("a" to -0f), byteFallback = false)
        )
        val ids = tokenizer.encode("aé")
        assertEquals(listOf<Long>(idOf(tokenizer, "a").toLong(), tokenizer.unkId.toLong()), ids.map { it.toLong() })
    }

    @Test
    fun tokenizer_never_emits_control_pieces_from_text() {
        // Literal "<eos>" in text must decompose into normal pieces, not the
        // control token.
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf(
                    "<" to -0f, "e" to -0f, "o" to -0f, "s" to -0f, ">" to -0f,
                    "eo" to -1f
                )
            )
        )
        val ids = tokenizer.encode("<eos>")
        val controlIds = listOf(tokenizer.bosId, tokenizer.eosId, tokenizer.padId, tokenizer.unkId)
        assertTrue(ids.none { it in controlIds })
        assertEquals("<eos>", ids.joinToString("") { tokenizer.pieces[it].piece })
    }

    @Test
    fun tokenizer_empty_input_encodes_to_nothing() {
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(normalPieces = listOf("a" to -0f))
        )
        assertTrue(tokenizer.encode("").isEmpty())
    }

    private fun idOf(tokenizer: SentencePieceBpeTokenizer, piece: String): Int =
        tokenizer.pieces.indexOfFirst { it.piece == piece }.also {
            assertTrue("piece $piece must exist", it >= 0)
        }

    // ──────────────────────────────────────────────────────────────────────
    // Fake inference session: drives the full text→template→tokens→vector
    // pipeline without LiteRT natives (task 4.5's fake-session requirement).
    // ──────────────────────────────────────────────────────────────────────

    /** Records every token-id input; returns a deterministic 768-dim vector. */
    private class FakeEmbeddingSession : EmbeddingSession {
        val inputs = mutableListOf<IntArray>()
        override fun embed(tokenIds: IntArray): FloatArray {
            inputs.add(tokenIds.copyOf())
            // Stable, content-dependent vector: the first 768 token ids as
            // floats (ids are < 262144, well within float precision).
            return FloatArray(EMBEDDING_DIMENSION) { i ->
                (tokenIds[i % tokenIds.size] % 997).toFloat() + 1f
            }
        }
        override fun close() {}
    }

    @Test
    fun fake_session_pipeline_templates_tokenizes_and_normalizes() {
        // Singles cover every character of the templated prompt; the
        // unreachable merge entries are harmless (BPE needs intermediate
        // pieces to reach them).
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(
                normalPieces = listOf(
                    "t" to -0f, "i" to -0f, "l" to -0f, "e" to -0f, ":" to -0f,
                    "n" to -0f, "o" to -0f, "▁" to -0f, "x" to -0f,
                    "h" to -0f, "w" to -0f, "r" to -0f, "d" to -0f,
                    "▁none" to -1f, "▁text:" to -2f, "▁title:" to -3f, "▁text" to -4f
                ),
                userDefined = listOf("title:", "none", "|")
            )
        )
        val session = FakeEmbeddingSession()
        val vectors = embedTextsWithSession(
            session = session,
            tokenizer = tokenizer,
            texts = listOf("hello world", "find cats"),
            kind = "document",
            normalize = true
        )

        assertEquals(2, vectors.size)
        assertEquals(EMBEDDING_DIMENSION, vectors[0].size)
        vectors.forEach { v ->
            val norm = Math.sqrt(v.map { (it.toDouble() * it).toDouble() }.sum())
            assertEquals("output vectors are L2-normalized", 1.0, norm, 1e-4)
        }

        // The session received exactly one shaped input per text.
        assertEquals(2, session.inputs.size)
        session.inputs.forEach { input ->
            assertEquals(EMBEDDING_SEQ_LEN, input.size)
            assertEquals("BOS first", tokenizer.bosId, input[0])
            assertEquals("padding tail", tokenizer.padId, input.last())
            assertTrue(
                "EOS present after the body",
                input.drop(1).take(EMBEDDING_SEQ_LEN - 1).contains(tokenizer.eosId)
            )
        }
        // The document template was applied before tokenization: decoding the
        // first input back to pieces yields the templated, escaped prompt.
        val decoded = session.inputs[0]
            .drop(1)
            .takeWhile { it != tokenizer.eosId && it != tokenizer.padId }
            .joinToString("") { tokenizer.pieces[it].piece }
        assertEquals(
            formatDocumentPrompt("hello world").replace(" ", "▁"),
            decoded
        )
    }

    @Test
    fun fake_session_pipeline_without_normalization_keeps_raw_vectors() {
        val tokenizer = SentencePieceBpeTokenizer(
            gemmaLikeModel(normalPieces = listOf("a" to -0f))
        )
        val session = FakeEmbeddingSession()
        val vectors = embedTextsWithSession(
            session = session,
            tokenizer = tokenizer,
            texts = listOf("aaaa"),
            kind = "query",
            normalize = false
        )
        val raw = FakeEmbeddingSession().embed(
            buildModelInputIds(
                tokenizer.encode(formatQueryPrompt("aaaa")),
                tokenizer.bosId, tokenizer.eosId, tokenizer.padId, EMBEDDING_SEQ_LEN
            )
        )
        assertEquals(1, vectors.size)
        assertTrue("normalize=false returns raw session output", vectors[0].contentEquals(raw))
        assertEquals(1, session.inputs.size)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Real-artifact smoke test (optional; enabled via env var)
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun real_gemma_tokenizer_parses_and_encodes() {
        val path = System.getenv("EMBEDDINGGEMMA_TOKENIZER_PATH")
        assumeTrue(
            "EMBEDDINGGEMMA_TOKENIZER_PATH not set; skipping real-artifact smoke test",
            path != null
        )
        val bytes = File(path!!).readBytes()
        assertEquals(EMBEDDING_TOKENIZER_BYTES, bytes.size.toLong())
        assertEquals(EMBEDDING_TOKENIZER_SHA256, sha256Of(bytes))

        val tokenizer = SentencePieceBpeTokenizer(bytes)
        assertEquals(262144, tokenizer.vocabSize)
        assertEquals(3, tokenizer.unkId)
        assertEquals(2, tokenizer.bosId)
        assertEquals(1, tokenizer.eosId)
        assertEquals(0, tokenizer.padId)
        assertTrue(tokenizer.byteFallback)
        assertFalse(tokenizer.addDummyPrefix)
        assertFalse(tokenizer.removeExtraWhitespaces)
        assertTrue(tokenizer.escapeWhitespaces)

        // Canonical Gemma behavior: no dummy prefix, spaces escape to ▁.
        val ids = tokenizer.encode("Hello world")
        assertTrue(ids.isNotEmpty())
        assertTrue(ids.all { it in 0 until tokenizer.vocabSize })
        assertEquals("Hello▁world", ids.joinToString("") { tokenizer.pieces[it].piece })

        // The full document prompt tokenizes losslessly (the piece stream
        // reassembles to the space-escaped normalized text) with BOS/EOS
        // added by the input assembler.
        val prompt = formatDocumentPrompt("The mitochondria is the powerhouse of the cell.")
        val promptIds = tokenizer.encode(prompt)
        assertTrue(promptIds.size in 8 until EMBEDDING_SEQ_LEN)
        assertEquals(
            prompt.replace(" ", "▁"),
            promptIds.joinToString("") { tokenizer.pieces[it].piece }
        )
        val input = buildModelInputIds(
            promptIds, tokenizer.bosId, tokenizer.eosId, tokenizer.padId, EMBEDDING_SEQ_LEN
        )
        assertEquals(EMBEDDING_SEQ_LEN, input.size)
        assertEquals(tokenizer.bosId, input[0])
        assertEquals(tokenizer.eosId, input[promptIds.size + 1])
        assertEquals(tokenizer.padId, input.last())
    }
}
