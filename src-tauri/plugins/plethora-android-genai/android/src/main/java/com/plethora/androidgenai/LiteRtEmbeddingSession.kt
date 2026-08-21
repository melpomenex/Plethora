// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// LiteRT inference session for EmbeddingGemma (design D10 / task 4.5).
//
// This is the ONLY file in the plugin that touches the LiteRT Kotlin API, so
// JVM unit tests (which cannot load litert_jni) can exercise everything else
// through the EmbeddingSession interface with a fake. The session loads the
// downloaded .tflite artifact once, lazily, and reuses its tensor buffers for
// every text: one int32 [1, 512] token input in, one pooled float32 [1, 768]
// embedding out (the artifact pools internally — no mean-pool on this side,
// matching Google's litert-samples semantic-similarity client).

package com.plethora.androidgenai

import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel
import com.google.ai.edge.litert.TensorBuffer

/**
 * One loaded embedding model. Implementations must be confined to a single
 * thread (the plugin's embedding executor). Tokenization/template glue lives
 * in [embedTextsWithSession], which drives the session through [embed].
 */
internal interface EmbeddingSession : AutoCloseable {
    /** Embed one pre-tokenized input; returns EMBEDDING_DIMENSION floats. */
    fun embed(tokenIds: IntArray): FloatArray
}

/**
 * LiteRT-backed session over the verified artifacts.
 *
 * @param modelPath downloaded .tflite artifact (sha256-verified at download)
 * @param tokenizer parsed SentencePiece model (used by the shared glue, kept
 *   here so session and tokenizer load/reload together)
 * @param seqLen input sequence length baked into the artifact
 */
internal class LiteRtEmbeddingSession(
    modelPath: String,
    @Suppress("UNUSED_PARAMETER") tokenizer: SentencePieceBpeTokenizer,
    private val seqLen: Int = EMBEDDING_SEQ_LEN
) : EmbeddingSession {

    private val model: CompiledModel = CompiledModel.create(
        modelPath,
        CompiledModel.Options(Accelerator.CPU)
    )
    private val inputBuffer: TensorBuffer = model.createInputBuffers().first()
    private val outputBuffers: List<TensorBuffer> = model.createOutputBuffers()

    override fun embed(tokenIds: IntArray): FloatArray {
        require(tokenIds.size == seqLen) { "input must be exactly $seqLen token ids" }
        inputBuffer.writeInt(tokenIds)
        model.run(listOf(inputBuffer), outputBuffers)
        val output = outputBuffers.first().readFloat()
        check(output.size == EMBEDDING_DIMENSION) {
            "embedding model returned ${output.size} floats, expected $EMBEDDING_DIMENSION"
        }
        return output
    }

    override fun close() {
        inputBuffer.close()
        outputBuffers.forEach { it.close() }
        model.close()
    }
}
