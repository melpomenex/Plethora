// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// On-device embedding backend support for the android-genai plugin
// (design D10 / task 4.5): EmbeddingGemma 300M run through LiteRT.
//
// The model is NEVER bundled. Both artifacts are downloaded on explicit user
// action into app-private storage and sha256-verified before use:
//   - embeddinggemma-300M_seq512_mixed-precision.tflite (~179 MB)
//   - sentencepiece.model tokenizer (~4.7 MB)
//
// The official Hugging Face repo (litert-community/embeddinggemma-300m) is
// license-gated (`gated: auto` — the user must be logged in with an accepted
// Gemma license), so anonymous app downloads get HTTP 401. The identical bytes
// (same sizes, same content sha256) are mirrored on ModelScope anonymously;
// the downloader tries the canonical HF URL first and falls back to the
// mirror. Both sources are pinned to the same digests, so the provenance of
// the bytes is verified either way. Google's Gemma terms apply to the weights
// regardless of which host served them.
//
// Everything here is pure JVM — no android.* and no LiteRT imports — so local
// unit tests can pin the tokenizer math, download state machine, and DTOs
// without a device or native libraries. The LiteRT session wrapper lives in
// LiteRtEmbeddingSession.kt and is exercised only on-device.

package com.plethora.androidgenai

import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import java.io.File
import java.io.InputStream
import org.json.JSONArray

// ──────────────────────────────────────────────────────────────────────────
// Arguments and DTOs
// ──────────────────────────────────────────────────────────────────────────

/** Arguments for the `embedTexts` plugin command. */
@InvokeArg
class EmbedTextsArgs {
    /** Raw input texts (the Gemma prompt template is applied natively). */
    var texts: List<String>? = null

    /**
     * "document" (default) applies the `title: none | text:` prefix used for
     * indexed chunks; "query" applies the `task: search result | query:`
     * prefix used at retrieval time.
     */
    var kind: String? = null

    /** L2-normalize each vector (default true; the index stores unit vectors). */
    var normalize: Boolean? = null
}

/** Arguments for the `embedTextsDownload` plugin command. */
@InvokeArg
class EmbedDownloadArgs {
    /** Optional per-file progress channel. */
    var onEvent: Channel? = null
}

/** Complete `embedTextsStatus` result. Mirrors the Rust `EmbeddingStatus`. */
internal data class EmbeddingStatusDto(
    /** available | downloadable | downloading | unavailable */
    val status: String,
    val reason: String? = null,
    val model: String = EMBEDDING_MODEL_NAME,
    val dimension: Int? = null,
    val bytesDownloaded: Long? = null,
    val totalBytes: Long? = null,
    val checkedAt: Long = System.currentTimeMillis()
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("status", status)
        reason?.let { put("reason", it) }
        put("model", model)
        dimension?.let { put("dimension", it) }
        bytesDownloaded?.let { put("bytesDownloaded", it) }
        totalBytes?.let { put("totalBytes", it) }
        put("checkedAt", checkedAt)
    }
}

/** Result of `embedTexts`: one vector per input text, in order. */
internal data class EmbedTextsResultDto(
    val vectors: List<FloatArray>,
    val dimension: Int,
    val model: String
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put(
            "vectors",
            JSONArray().apply {
                vectors.forEach { v ->
                    put(JSONArray(v.toList()))
                }
            }
        )
        put("dimension", dimension)
        put("model", model)
    }
}

/** One progress event while downloading an artifact. */
internal data class EmbeddingProgressDto(
    val file: String,
    val bytesDownloaded: Long,
    /** -1 when the server did not advertise a content length. */
    val totalBytes: Long,
    val percent: Int
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("event", "progress")
        put("file", file)
        put("bytesDownloaded", bytesDownloaded)
        put("totalBytes", totalBytes)
        put("percent", percent)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Model artifact constants (verified against litert-community/embeddinggemma-300m)
// ──────────────────────────────────────────────────────────────────────────

/** Model identity shared with the Rust embedding version (ON_DEVICE_MODEL). */
internal const val EMBEDDING_MODEL_NAME = "embeddinggemma-300m"

/**
 * Generic (device-independent) seq512 mixed-precision CPU variant. Chunks are
 * ~200–260 tokens by design D12, so seq512 covers prompt template + BOS/EOS
 * without truncation. Device-specific NPU builds (tensor_g5/mediatek/qualcomm)
 * remain a future optimization behind the same download manager.
 */
internal const val EMBEDDING_MODEL_FILE = "embeddinggemma-300M_seq512_mixed-precision.tflite"

internal const val EMBEDDING_TOKENIZER_FILE = "sentencepiece.model"

/** EmbeddingGemma output dimension (full 768; MRL truncation is a later seam). */
internal const val EMBEDDING_DIMENSION = 768

/** Input sequence length of the seq512 artifact. */
internal const val EMBEDDING_SEQ_LEN = 512

/** Hard cap on texts per `embedTexts` call (bounds the IPC payload). */
internal const val EMBEDDING_MAX_TEXTS = 32

/** Hard cap per input text; longer inputs are rejected, never silently cut. */
internal const val EMBEDDING_MAX_TEXT_CHARS = 8192

internal const val EMBEDDING_MODEL_BYTES = 179_132_472L

internal const val EMBEDDING_TOKENIZER_BYTES = 4_683_319L

/**
 * sha256 of the model artifact, verified after download and before load.
 * Confirmed against the byte-identical HF/ModelScope mirrors (same sizes and
 * content digests on both hosts).
 */
internal const val EMBEDDING_MODEL_SHA256 =
    "ad09e81557203cb0e177abf9bf8727dfe138a7d394aa0f70f0b2ed16432e121a"

/**
 * sha256 of the Gemma SentencePiece tokenizer (verified locally over the
 * downloaded 4,683,319 bytes).
 */
internal const val EMBEDDING_TOKENIZER_SHA256 =
    "d6daa52d93d7aad10e8388bd526c4e501d914b47177398d1d9621f1fe48438c7"

private const val HF_BASE =
    "https://huggingface.co/litert-community/embeddinggemma-300m/resolve/main"
private const val MODELSCOPE_BASE =
    "https://modelscope.cn/models/litert-community/embeddinggemma-300m/resolve/master"

/** Download sources in priority order: canonical HF first, anonymous mirror fallback. */
internal fun embeddingModelUrls(): List<String> = listOf(
    "$HF_BASE/$EMBEDDING_MODEL_FILE",
    "$MODELSCOPE_BASE/$EMBEDDING_MODEL_FILE"
)

internal fun embeddingTokenizerUrls(): List<String> = listOf(
    "$HF_BASE/$EMBEDDING_TOKENIZER_FILE",
    "$MODELSCOPE_BASE/$EMBEDDING_TOKENIZER_FILE"
)

/** True when the string is a plausible pinned sha256 (64 lowercase hex chars). */
internal fun isValidSha256(value: String): Boolean =
    value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }

// ──────────────────────────────────────────────────────────────────────────
// Prompt formatting (EmbeddingGemma input templates)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Document-side input template from the EmbeddingGemma model card. Chunks are
 * indexed without titles, so the title slot is always "none".
 */
internal fun formatDocumentPrompt(text: String): String = "title: none | text: $text"

/** Query-side input template used at retrieval time. */
internal fun formatQueryPrompt(text: String): String = "task: search result | query: $text"

/** Select the template for a `kind` argument ("document" default). */
internal fun formatEmbeddingPrompt(text: String, kind: String?): String =
    if (kind == "query") formatQueryPrompt(text) else formatDocumentPrompt(text)

// ──────────────────────────────────────────────────────────────────────────
// Input assembly and vector math (pure, JVM-testable)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Assemble the model input for one text: BOS + truncated token ids + EOS,
 * padded to `seqLen` with the pad id. Mirrors PreprocessTokens in Google's
 * litert-samples semantic-similarity client.
 */
internal fun buildModelInputIds(
    tokenIds: List<Int>,
    bosId: Int,
    eosId: Int,
    padId: Int,
    seqLen: Int
): IntArray {
    require(seqLen >= 2) { "seqLen must leave room for BOS and EOS" }
    val body = minOf(tokenIds.size, seqLen - 2)
    val out = IntArray(seqLen)
    out[0] = bosId
    for (i in 0 until body) out[i + 1] = tokenIds[i]
    out[body + 1] = eosId
    for (i in body + 2 until seqLen) out[i] = padId
    return out
}

/** L2-normalize a vector in float precision; a zero vector is returned as-is. */
internal fun l2Normalize(vector: FloatArray): FloatArray {
    var sumSquares = 0.0
    for (x in vector) sumSquares += x.toDouble() * x.toDouble()
    val norm = kotlin.math.sqrt(sumSquares)
    if (norm <= 0.0 || !norm.isFinite()) return vector.copyOf()
    val out = FloatArray(vector.size)
    for (i in vector.indices) out[i] = (vector[i] / norm).toFloat()
    return out
}

/** Validation failure for `embedTexts` arguments, or null when acceptable. */
internal fun embedTextsArgsError(texts: List<String>?): String? {
    if (texts == null || texts.isEmpty()) return "texts must be a non-empty array"
    if (texts.size > EMBEDDING_MAX_TEXTS) {
        return "texts must contain at most $EMBEDDING_MAX_TEXTS entries (got ${texts.size})"
    }
    texts.forEachIndexed { index, text ->
        if (text.isBlank()) return "texts[$index] is blank"
        if (text.length > EMBEDDING_MAX_TEXT_CHARS) {
            return "texts[$index] exceeds the $EMBEDDING_MAX_TEXT_CHARS-character limit"
        }
    }
    return null
}

/**
 * Embed raw texts through one session: apply the Gemma prompt template per
 * text, tokenize, run inference, and L2-normalize when asked. Pure glue over
 * the [EmbeddingSession] interface so JVM tests can drive the whole pipeline
 * with a fake session (no LiteRT natives).
 */
internal fun embedTextsWithSession(
    session: EmbeddingSession,
    tokenizer: SentencePieceBpeTokenizer,
    texts: List<String>,
    kind: String?,
    normalize: Boolean
): List<FloatArray> = texts.map { text ->
    val prompt = formatEmbeddingPrompt(text, kind)
    val tokenIds = tokenizer.encode(prompt)
    val input = buildModelInputIds(
        tokenIds = tokenIds,
        bosId = tokenizer.bosId,
        eosId = tokenizer.eosId,
        padId = tokenizer.padId,
        seqLen = EMBEDDING_SEQ_LEN
    )
    val vector = session.embed(input)
    if (normalize) l2Normalize(vector) else vector
}

// ──────────────────────────────────────────────────────────────────────────
// Status state machine (pure)
// ──────────────────────────────────────────────────────────────────────────

internal fun embeddingStatusOf(
    compiled: Boolean,
    modelPresent: Boolean,
    tokenizerPresent: Boolean,
    partFileBytes: Long?
): EmbeddingStatusDto {
    if (!compiled) {
        return EmbeddingStatusDto(
            status = "unavailable",
            reason = "feature_not_compiled"
        )
    }
    if (partFileBytes != null) {
        // A partial download exists: report in-flight bytes. The total is the
        // remaining bytes of whichever artifact was mid-flight (the small
        // tokenizer downloads first, then the model).
        val total = if (partFileBytes > EMBEDDING_TOKENIZER_BYTES) {
            EMBEDDING_MODEL_BYTES
        } else {
            EMBEDDING_TOKENIZER_BYTES
        }
        return EmbeddingStatusDto(
            status = "downloading",
            reason = "model_downloading",
            bytesDownloaded = partFileBytes,
            totalBytes = total
        )
    }
    if (modelPresent && tokenizerPresent) {
        return EmbeddingStatusDto(
            status = "available",
            model = EMBEDDING_MODEL_NAME,
            dimension = EMBEDDING_DIMENSION
        )
    }
    return EmbeddingStatusDto(
        status = "downloadable",
        reason = "model_downloadable",
        bytesDownloaded = 0,
        totalBytes = EMBEDDING_MODEL_BYTES + EMBEDDING_TOKENIZER_BYTES
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Model files on disk
// ──────────────────────────────────────────────────────────────────────────

/**
 * Layout of the app-private model directory (`<part>` files track in-flight
 * downloads; completed artifacts are atomically renamed into place). The
 * expected sizes are injectable so JVM tests can use tiny fixtures.
 */
internal class EmbeddingModelFiles(
    private val dir: File,
    private val modelBytes: Long = EMBEDDING_MODEL_BYTES,
    private val tokenizerBytes: Long = EMBEDDING_TOKENIZER_BYTES
) {
    val modelFile: File get() = File(dir, EMBEDDING_MODEL_FILE)
    val tokenizerFile: File get() = File(dir, EMBEDDING_TOKENIZER_FILE)
    val modelPartFile: File get() = File(dir, "$EMBEDDING_MODEL_FILE.part")
    val tokenizerPartFile: File get() = File(dir, "$EMBEDDING_TOKENIZER_FILE.part")

    fun modelPresent(): Boolean = fileMatches(modelFile, modelBytes)

    fun tokenizerPresent(): Boolean = fileMatches(tokenizerFile, tokenizerBytes)

    fun allPresent(): Boolean = modelPresent() && tokenizerPresent()

    /** Bytes of any in-flight partial download, or null when idle. */
    fun partFileBytes(): Long? =
        listOf(modelPartFile, tokenizerPartFile)
            .firstOrNull { it.isFile }
            ?.let { it.length() }

    private fun fileMatches(file: File, expectedBytes: Long): Boolean =
        file.isFile && file.length() == expectedBytes
}

// ──────────────────────────────────────────────────────────────────────────
// Download manager (pure JVM; HTTP opened through an injectable connector)
// ──────────────────────────────────────────────────────────────────────────

/** One opened HTTP response. */
internal interface HttpSource : AutoCloseable {
    val status: Int
    /** -1 when the server did not advertise a length. */
    val contentLength: Long
    val body: InputStream
}

/** Opens URLs. Production uses HttpURLConnection; tests inject fakes. */
internal fun interface HttpGetOpener {
    @Throws(Exception::class)
    fun open(url: String): HttpSource
}

/** Fatal download failure carrying the plugin error code to reject with. */
internal class EmbeddingDownloadException(
    val errorCode: String,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

/**
 * Download one verified artifact into `dest`.
 *
 * Sources are tried in order: HTTP failures (the HF license gate answers 401,
 * a bad mirror 404/5xx) and connection errors fall through to the next source.
 * A completed download whose size or sha256 does not match the pinned digest
 * is FATAL — integrity failures never fall through to another host, because
 * every host is expected to serve the identical pinned bytes.
 */
internal fun downloadVerifiedArtifact(
    opener: HttpGetOpener,
    urls: List<String>,
    dest: File,
    fileName: String,
    expectedBytes: Long,
    expectedSha256: String,
    onProgress: (EmbeddingProgressDto) -> Unit,
    progressBytesStep: Long = 1 shl 20
) {
    dest.parentFile?.mkdirs()
    val part = File(dest.parentFile, dest.name + ".part")

    var lastFailure: Exception? = null
    for ((sourceIndex, url) in urls.withIndex()) {
        val isLastSource = sourceIndex == urls.lastIndex
        try {
            downloadFromSource(
                opener, url, part, fileName, expectedBytes, expectedSha256,
                onProgress, progressBytesStep
            )
            // Verified: promote into place.
            if (!part.renameTo(dest)) {
                part.delete()
                throw EmbeddingDownloadException(
                    "model_unavailable",
                    "could not move the verified artifact into place"
                )
            }
            onProgress(
                EmbeddingProgressDto(fileName, expectedBytes, expectedBytes, 100)
            )
            return
        } catch (e: EmbeddingDownloadException) {
            part.delete()
            throw e
        } catch (e: Exception) {
            part.delete()
            lastFailure = e
            if (isLastSource) break
        }
    }
    throw EmbeddingDownloadException(
        "model_unavailable",
        "all download sources failed for $fileName: ${lastFailure?.message ?: "unknown error"}",
        lastFailure
    )
}

private fun downloadFromSource(
    opener: HttpGetOpener,
    url: String,
    part: File,
    fileName: String,
    expectedBytes: Long,
    expectedSha256: String,
    onProgress: (EmbeddingProgressDto) -> Unit,
    progressBytesStep: Long
) {
    opener.open(url).use { source ->
        if (source.status !in 200..299) {
            throw IllegalStateException("HTTP ${source.status} from the download source")
        }
        val advertised = source.contentLength
        if (advertised in 1..Long.MAX_VALUE && advertised != expectedBytes) {
            throw EmbeddingDownloadException(
                "model_unavailable",
                "source advertises $advertised bytes but $fileName is pinned to $expectedBytes"
            )
        }
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        var written = 0L
        var nextProgressAt = 0L
        part.outputStream().use { out ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = source.body.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                digest.update(buffer, 0, read)
                written += read
                if (written >= nextProgressAt) {
                    val total = if (advertised > 0) advertised else expectedBytes
                    onProgress(
                        EmbeddingProgressDto(
                            file = fileName,
                            bytesDownloaded = written,
                            totalBytes = total,
                            percent = if (total > 0) {
                                ((written * 100) / total).toInt().coerceIn(0, 100)
                            } else {
                                -1
                            }
                        )
                    )
                    nextProgressAt = written + progressBytesStep
                }
            }
            out.flush()
        }
        if (written != expectedBytes) {
            throw EmbeddingDownloadException(
                "model_unavailable",
                "downloaded $written bytes but $fileName is pinned to $expectedBytes"
            )
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(expectedSha256, ignoreCase = true)) {
            throw EmbeddingDownloadException(
                "model_unavailable",
                "sha256 mismatch for $fileName: got $actual, expected $expectedSha256"
            )
        }
    }
}

/** HTTP GET via HttpURLConnection; follows redirects (HF resolve → CDN). */
internal val httpGetOpener: HttpGetOpener = HttpGetOpener { url ->
    val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
    connection.connectTimeout = 30_000
    connection.readTimeout = 60_000
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "Incrementum-AndroidGenAi/1.0")
    val status = connection.responseCode
    object : HttpSource {
        override val status: Int = status
        override val contentLength: Long = connection.contentLengthLong
        override val body: InputStream =
            if (status in 200..299) connection.inputStream else java.io.ByteArrayInputStream(ByteArray(0))
        override fun close() {
            connection.disconnect()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SentencePiece BPE tokenizer (pure Kotlin, Gemma-compatible)
// ──────────────────────────────────────────────────────────────────────────
//
// Why hand-rolled: the Gemma tokenizer ships as a SentencePiece proto
// (sentencepiece.model) and SentencePiece has no usable Android Maven
// artifact — the official C++/JNI library is not published, the DJL binding
// lacks Android natives (deepjavalibrary/djl#3742), and LiteRT-LM only reads
// .litertlm bundles. The model is a BPE model_type with byte fallback, an
// identity normalizer, add_dummy_prefix=false and remove_extra_whitespaces=
// false (verified by parsing the real artifact), which this implementation
// reproduces: normalize → longest USER_DEFINED prefix match / code-point
// split → rank-based pair merging (score descending, leftmost tie-break,
// exactly sentencepiece's bpe_model.cc SymbolPair agenda) → byte fallback for
// uncovered code points.

/** SentencePiece piece types (sentencepiece_model.proto ModelProto.SentencePiece.Type). */
internal object SpPieceType {
    const val NORMAL = 1
    const val UNKNOWN = 2
    const val CONTROL = 3
    const val USER_DEFINED = 4
    const val UNUSED = 5
    const val BYTE = 6
}

/**
 * A parsed SentencePiece BPE model. Thread-safe after construction: encode()
 * only reads immutable maps.
 */
internal class SentencePieceBpeTokenizer(modelBytes: ByteArray) {

    internal class PieceInfo(val piece: String, val score: Float, val type: Int)

    val pieces: List<PieceInfo>
    val vocabSize: Int get() = pieces.size

    /** Mergeable dictionary: NORMAL pieces only (reserved types never merge). */
    private val normalIds: HashMap<String, Int> = HashMap()
    private val userDefinedIds: HashMap<String, Int> = HashMap()
    private val userDefinedMaxChars: Int
    private val byteIds: HashMap<Int, Int> = HashMap()

    val unkId: Int
    val bosId: Int
    val eosId: Int
    val padId: Int
    val byteFallback: Boolean
    val addDummyPrefix: Boolean
    val removeExtraWhitespaces: Boolean
    val escapeWhitespaces: Boolean

    init {
        var unk = 0
        var bos = 1
        var eos = 2
        var pad = -1
        var byteFallback = false
        var addDummyPrefix = true
        var removeExtraWhitespaces = true
        var escapeWhitespaces = true
        val pieceList = ArrayList<PieceInfo>(1 shl 18)

        val root = ProtoReader(modelBytes)
        while (true) {
            when (root.nextTag() ?: break) {
                1 -> pieceList.add(parsePiece(root.readLengthDelimited()))
                2 -> {
                    val trainer = ProtoReader(root.readLengthDelimited())
                    while (true) {
                        when (trainer.nextTag() ?: break) {
                            35 -> byteFallback = trainer.readVarint() != 0L
                            40 -> unk = trainer.readVarint().toInt()
                            41 -> bos = trainer.readVarint().toInt()
                            42 -> eos = trainer.readVarint().toInt()
                            43 -> pad = trainer.readVarint().toInt()
                            else -> trainer.skipPayload()
                        }
                    }
                }
                3 -> {
                    val normalizer = ProtoReader(root.readLengthDelimited())
                    while (true) {
                        when (normalizer.nextTag() ?: break) {
                            3 -> addDummyPrefix = normalizer.readVarint() != 0L
                            4 -> removeExtraWhitespaces = normalizer.readVarint() != 0L
                            5 -> escapeWhitespaces = normalizer.readVarint() != 0L
                            else -> normalizer.skipPayload()
                        }
                    }
                }
                else -> root.skipPayload()
            }
        }

        pieces = pieceList
        unkId = unk
        bosId = bos
        eosId = eos
        padId = pad
        this.byteFallback = byteFallback
        this.addDummyPrefix = addDummyPrefix
        this.removeExtraWhitespaces = removeExtraWhitespaces
        this.escapeWhitespaces = escapeWhitespaces

        var maxUserChars = 0
        pieces.forEachIndexed { id, info ->
            when (info.type) {
                SpPieceType.NORMAL -> normalIds[info.piece] = id
                SpPieceType.USER_DEFINED -> {
                    userDefinedIds[info.piece] = id
                    if (info.piece.length > maxUserChars) maxUserChars = info.piece.length
                }
                SpPieceType.BYTE -> {
                    parseBytePiece(info.piece)?.let { value -> byteIds[value] = id }
                }
                // CONTROL/UNKNOWN/UNUSED are reserved: never matched from text,
                // never formed by merges.
            }
        }
        userDefinedMaxChars = maxUserChars
    }

    /** "<0x41>" → 65, or null for a malformed byte piece. */
    private fun parseBytePiece(piece: String): Int? {
        if (piece.length != 6 || !piece.startsWith("<0x") || !piece.endsWith(">")) return null
        val value = piece.substring(3, 5).toIntOrNull(16) ?: return null
        return if (value in 0..255) value else null
    }

    /** Normalize the raw input per the model's normalizer spec (Gemma: identity). */
    internal fun normalize(text: String): String {
        var s = text
        if (removeExtraWhitespaces) {
            s = s.trim().replace(WHITESPACE_RUN, " ")
        }
        if (addDummyPrefix) s = " $s"
        if (escapeWhitespaces) s = s.replace(' ', '▁')
        return s
    }

    /**
     * Encode raw text into piece ids, mirroring
     * SentencePieceProcessor::Encode for a BPE model with byte fallback.
     */
    fun encode(text: String): List<Int> {
        val normalized = normalize(text)
        if (normalized.isEmpty()) return emptyList()

        // Initial symbols: longest USER_DEFINED prefix match (frozen), else
        // one Unicode code point.
        val syms = ArrayList<String>()
        val symIds = ArrayList<Int>()
        val frozen = ArrayList<Boolean>()
        var i = 0
        while (i < normalized.length) {
            val cpLength = Character.charCount(normalized.codePointAt(i))
            var matched: String? = null
            if (userDefinedIds.isNotEmpty()) {
                val window = minOf(userDefinedMaxChars, normalized.length - i)
                for (len in window downTo 1) {
                    val candidate = normalized.substring(i, i + len)
                    if (userDefinedIds.containsKey(candidate)) {
                        matched = candidate
                        break
                    }
                }
            }
            if (matched != null) {
                syms.add(matched)
                symIds.add(userDefinedIds[matched]!!)
                frozen.add(true)
                i += matched.length
            } else {
                val single = normalized.substring(i, i + cpLength)
                syms.add(single)
                symIds.add(normalIds[single] ?: -1)
                frozen.add(false)
                i += cpLength
            }
        }

        val count = syms.size
        val prev = IntArray(count) { it - 1 }
        val next = IntArray(count) { if (it == count - 1) -1 else it + 1 }
        val alive = BooleanArray(count) { true }

        // Merge agenda ordered exactly like sentencepiece's SymbolPair
        // comparator: higher score first; ties resolve to the leftmost pair.
        val agenda = java.util.PriorityQueue<MergeCandidate>(count)
        fun offerCandidate(left: Int, right: Int) {
            if (left < 0 || right < 0 || !alive[left] || !alive[right]) return
            if (frozen[left] || frozen[right]) return
            val merged = syms[left] + syms[right]
            val id = normalIds[merged] ?: return
            agenda.offer(MergeCandidate(pieces[id].score, left, right, merged.length))
        }
        for (index in 0 until count - 1) offerCandidate(index, index + 1)

        while (true) {
            val top = agenda.poll() ?: break
            if (!alive[top.left] || !alive[top.right]) continue
            if (syms[top.left].length + syms[top.right].length != top.size) continue
            // Merge right into left.
            syms[top.left] = syms[top.left] + syms[top.right]
            symIds[top.left] = normalIds[syms[top.left]] ?: -1
            alive[top.right] = false
            next[top.left] = next[top.right]
            if (next[top.right] >= 0) prev[next[top.right]] = top.left
            offerCandidate(prev[top.left], top.left)
            offerCandidate(top.left, next[top.left])
        }

        // Walk the linked list and emit ids with byte fallback for unknowns.
        val out = ArrayList<Int>(count)
        var index = 0
        while (index != -1 && index < count) {
            val id = symIds[index]
            if (id >= 0) {
                out.add(id)
            } else {
                appendUnknown(syms[index], out)
            }
            index = next[index]
        }
        return out
    }

    private fun appendUnknown(piece: String, out: MutableList<Int>) {
        if (byteFallback) {
            val bytes = piece.toByteArray(Charsets.UTF_8)
            for (b in bytes) {
                val id = byteIds[b.toInt() and 0xFF]
                if (id != null) {
                    out.add(id)
                } else {
                    out.add(unkId)
                    return
                }
            }
        } else {
            out.add(unkId)
        }
    }

    private class MergeCandidate(
        val score: Float,
        val left: Int,
        val right: Int,
        val size: Int
    ) : Comparable<MergeCandidate> {
        override fun compareTo(other: MergeCandidate): Int {
            val byScore = other.score.compareTo(score) // higher score first
            if (byScore != 0) return byScore
            return this.left.compareTo(other.left) // leftmost first
        }
    }

    private companion object {
        val WHITESPACE_RUN = Regex("\\s+")
    }
}

/**
 * Minimal protobuf wire-format reader over one message. Usage:
 * `while (true) { when (reader.nextTag() ?: break) { 1 -> handle(reader.readLengthDelimited()); else -> reader.skipPayload() } }`.
 * After `nextTag()` the cursor sits at the field payload; exactly one payload
 * read (or `skipPayload()`) must follow before the next `nextTag()`.
 */
private class ProtoReader(private val buf: ByteArray) {
    private var pos = 0

    /** Next field number, or null at end of buffer / malformed input. */
    fun nextTag(): Int? {
        if (pos >= buf.size) return null
        val tag = readVarintRaw()
        val field = (tag ushr 3).toInt()
        if (field <= 0) return null
        currentWire = (tag and 0x7).toInt()
        return when (currentWire) {
            WIRE_VARINT, WIRE_F32, WIRE_F64 -> field
            WIRE_LEN -> {
                val length = readVarintRaw().toInt()
                lenEnd = pos + length
                if (length < 0 || lenEnd > buf.size) {
                    pos = buf.size
                    null
                } else {
                    field
                }
            }
            else -> {
                // Unsupported wire type (groups): stop parsing this message.
                pos = buf.size
                null
            }
        }
    }

    private fun readVarintRaw(): Long {
        var result = 0L
        var shift = 0
        while (true) {
            if (pos >= buf.size) return result
            val b = buf[pos++].toInt() and 0xFF
            result = result or ((b and 0x7F).toLong() shl shift)
            if (b and 0x80 == 0) return result
            shift += 7
            if (shift > 63) return result
        }
    }

    /** Varint payload. */
    fun readVarint(): Long = readVarintRaw()

    /** Fixed32 payload as a float (SentencePiece piece scores). */
    fun readFixed32(): Float =
        java.lang.Float.intBitsToFloat(
            (buf[pos].toInt() and 0xFF) or
                ((buf[pos + 1].toInt() and 0xFF) shl 8) or
                ((buf[pos + 2].toInt() and 0xFF) shl 16) or
                ((buf[pos + 3].toInt() and 0xFF) shl 24)
        ).also { pos += 4 }

    /** Length-delimited payload bytes. */
    fun readLengthDelimited(): ByteArray {
        val end = if (lenEnd >= 0) lenEnd else pos
        val slice = buf.copyOfRange(pos, end)
        pos = end
        return slice
    }

    /** Skip the current field's payload (unknown fields). */
    fun skipPayload() {
        when (currentWire) {
            WIRE_VARINT -> readVarintRaw()
            WIRE_F32 -> pos += 4
            WIRE_F64 -> pos += 8
            WIRE_LEN -> pos = lenEnd
        }
        lenEnd = -1
    }

    private var lenEnd = -1
    private var currentWire = -1

    companion object {
        const val WIRE_VARINT = 0
        const val WIRE_F64 = 1
        const val WIRE_LEN = 2
        const val WIRE_F32 = 5
    }
}

/** Parse one SentencePiece message: piece (1, string), score (2, fixed32), type (3, varint). */
private fun parsePiece(bytes: ByteArray): SentencePieceBpeTokenizer.PieceInfo {
    var piece = ""
    var score = 0f
    var type = SpPieceType.NORMAL
    val reader = ProtoReader(bytes)
    while (true) {
        when (reader.nextTag() ?: break) {
            1 -> piece = String(reader.readLengthDelimited(), Charsets.UTF_8)
            2 -> score = reader.readFixed32()
            3 -> type = reader.readVarint().toInt()
            else -> reader.skipPayload()
        }
    }
    return SentencePieceBpeTokenizer.PieceInfo(piece, score, type)
}
