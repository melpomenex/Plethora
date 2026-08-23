// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Pure-Kotlin catalog of on-device STT models (no Android imports — JVM
// testable, mirroring TtsModelRegistry in the android-tts plugin).
//
// Assets are k2-fsa/sherpa-onnx release artifacts under the `asr-models`
// tag: one tar.bz2 per model that extracts to a nested folder containing
// model.int8.onnx + tokens.txt. Archive sizes and SHA-256 checksums below
// were recorded from the published artifacts and are verified by
// SttModelManager before a model is marked ready.

package com.plethora.androidstt

/** Which sherpa-onnx OfflineModelConfig sub-config the model loads through. */
enum class SttModelKind(val serial: String) {
    SENSE_VOICE("sense-voice"),
    PARAKEET_CTC("parakeet-ctc");

    companion object {
        fun fromSerial(value: String): SttModelKind? =
            entries.firstOrNull { it.serial == value }
    }
}

/** Languages this model can transcribe: primary fast path + supported others. */
data class SttLanguageSupport(val primary: String, val others: List<String>)

data class SttModelManifest(
    val id: String,
    val displayName: String,
    val kind: SttModelKind,
    val description: String,
    val languages: SttLanguageSupport,
    /** Download URL of the single tar.bz2 archive carrying the model. */
    val url: String,
    /** Exact published archive size in bytes (verified before install). */
    val archiveBytes: Long,
    /** SHA-256 of the published archive (verified before install). */
    val archiveSha256: String,
    /** Bytes the archive occupies once extracted (shown as the on-disk size). */
    val extractedBytes: Long,
) {
    val archiveName: String get() = url.substringAfterLast('/')
}

object SttModelRegistry {

    /** Multilingual default: SenseVoice-small int8 (zh/en/ja/ko/yue). */
    val SENSE_VOICE_MULTI: SttModelManifest = SttModelManifest(
        id = "sense-voice-multi-int8",
        displayName = "SenseVoice (multilingual)",
        kind = SttModelKind.SENSE_VOICE,
        description = "Multilingual on-device speech recognition (English, Chinese, Japanese, Korean, Cantonese). Private and offline.",
        languages = SttLanguageSupport(primary = "en", others = listOf("zh", "ja", "ko", "yue")),
        url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        archiveBytes = 163_002_883L,
        archiveSha256 = "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
        // model.int8.onnx (239,233,841) + tokens.txt (315,894), rounded to KiB
        // to stay honest about padding the extractor adds.
        extractedBytes = 239_549_440L,
    )

    /** English fast path: NeMo Parakeet TDT_CTC 110M int8. */
    val PARAKEET_EN: SttModelManifest = SttModelManifest(
        id = "parakeet-en-110m-int8",
        displayName = "Parakeet (English)",
        kind = SttModelKind.PARAKEET_CTC,
        description = "Fast English-only on-device speech recognition. Private and offline.",
        languages = SttLanguageSupport(primary = "en", others = emptyList()),
        url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8.tar.bz2",
        archiveBytes = 104_337_827L,
        archiveSha256 = "17f945007b52ccd8b7200ffc7c5652e9e8e961dfdf479cefcabd06cf5703630b",
        // model.int8.onnx (131,652,171) + tokens.txt (9,953), rounded to KiB.
        extractedBytes = 131_674_112L,
    )

    val ALL: List<SttModelManifest> = listOf(SENSE_VOICE_MULTI, PARAKEET_EN)

    val fallbackDefault: SttModelManifest get() = SENSE_VOICE_MULTI

    fun byId(id: String): SttModelManifest? = ALL.firstOrNull { it.id == id }

    /**
     * Default model for a transcription language: Parakeet when the language
     * is English and both models are ready (D4 fast path), otherwise the
     * multilingual SenseVoice default. An explicit user choice always wins
     * and is resolved by the caller, never here.
     */
    fun defaultForLanguage(language: String?, readyIds: Set<String>): SttModelManifest {
        val lang = (language ?: "en").trim().lowercase().take(2)
        if (lang == "en" && PARAKEET_EN.id in readyIds && SENSE_VOICE_MULTI.id in readyIds) {
            return PARAKEET_EN
        }
        return SENSE_VOICE_MULTI
    }
}
