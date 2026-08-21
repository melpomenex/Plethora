// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Static catalog of on-device TTS models offered by the plugin. Each entry maps
// a stable model id (used by the frontend and stored in settings) to the
// sherpa-onnx config kind and the pinned asset manifest used by TtsAssetManager.
//
// "KittenTTS Micro" (the user-facing name in the UI) maps to sherpa-onnx's
// `kitten-nano` variant — the smallest KittenTTS export. See design.md §2.

package com.plethora.androidtts

/**
 * The sherpa-onnx config kind for a model. Maps 1:1 to the OfflineTts*ModelConfig
 * type the engine constructs.
 */
enum class TtsModelKind(val serial: String) {
    KITTEN("kitten"),
    KOKORO("kokoro");

    companion object {
        fun fromSerial(s: String): TtsModelKind? = entries.firstOrNull { it.serial == s }
    }
}

/**
 * One asset file within a model download. [sha256] is verified after download;
 * [sizeBytes] drives progress and free-space preflight.
 */
data class TtsAssetFile(
    val name: String,
    val sha256: String,
    val sizeBytes: Long,
)

/**
 * The pinned manifest for one model: where to fetch it, what files it contains,
 * and the voices it exposes. URLs/digests are pinned so a manifest bump is an
 * explicit user-facing update rather than a silent break.
 *
 * NOTE: the sha256 values below are placeholders to be filled from the actual
 * published artifacts at first download. TtsAssetManager verifies against
 * whatever the manifest declares, so an unfilled placeholder simply fails
 * verification (model stays not-installed) until the real digest is shipped.
 */
data class TtsModelManifest(
    val id: String,
    val displayName: String,
    val kind: TtsModelKind,
    val description: String,
    val isDefault: Boolean,
    val baseUrl: String,
    val files: List<TtsAssetFile>,
    /** Subdirectory under the model dir that should be passed as dataDir
     * (e.g. espeak-ng-data for Kokoro). Empty if N/A. */
    val dataDir: String,
    /** Stable voice roster used by listVoices without loading the engine. */
    val voices: List<TtsVoiceDescriptor>,
)

/** A voice in a model's roster, independent of engine state. */
data class TtsVoiceDescriptor(
    val id: String,
    val name: String,
    val language: String?,
    val gender: String?,
)

object TtsModelRegistry {

    /**
     * KittenTTS Micro — the compact default. The `kitten-nano-en-v0_1-fp16`
     * package from the sherpa-onnx tts-models release. ~27 MB compressed.
     * Ships model.fp16.onnx + voices.bin + tokens.txt + espeak-ng-data.
     */
    val KITTEN_NANO = TtsModelManifest(
        id = "kitten-nano",
        displayName = "KittenTTS Micro",
        kind = TtsModelKind.KITTEN,
        description = "Compact default English voice. Smallest download, good for first run.",
        isDefault = true,
        // baseUrl is the release-tag directory; the file name is appended by
        // TtsAssetManager ("$baseUrl/$name"). Doubling the package name here used
        // to produce a 404, so baseUrl must NOT include the asset name.
        baseUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models",
        files = listOf(
            // The package is a tar.bz2 of model + voices + tokens + espeak data;
            // we fetch the tarball, verify its SHA-256, then extract. The single-
            // archive fetch is modeled as one file.
            TtsAssetFile(
                name = "kitten-nano-en-v0_1-fp16.tar.bz2",
                sha256 = "f35dac93754fe2ac97c66e1f468311d0d2130f7f0f5a89bfa1197e09a0cbdec5",
                sizeBytes = 26_855_312L,
            ),
        ),
        // Kitten needs espeak-ng-data as dataDir, same as Kokoro.
        dataDir = "espeak-ng-data",
        voices = listOf(
            TtsVoiceDescriptor("0", "Voice 1 (default)", "en", null),
            TtsVoiceDescriptor("1", "Voice 2", "en", null),
            TtsVoiceDescriptor("2", "Voice 3", "en", null),
            TtsVoiceDescriptor("3", "Voice 4", "en", null),
        ),
    )

    /**
     * Kokoro-82M — the optional higher-quality model. The
     * `kokoro-en-v0_19` package. ~320 MB compressed, 11 voices, 24 kHz.
     * Ships model.onnx + voices.bin + tokens.txt + espeak-ng-data.
     */
    val KOKORO = TtsModelManifest(
        id = "kokoro-en-v0_19",
        displayName = "Kokoro-82M",
        kind = TtsModelKind.KOKORO,
        description = "Higher-quality English voice with more speakers. Larger download.",
        isDefault = false,
        baseUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models",
        files = listOf(
            TtsAssetFile(
                name = "kokoro-en-v0_19.tar.bz2",
                sha256 = "912804855a04745fa77a30be545b3f9a5d15c4d66db00b88cbcd4921df605ac7",
                sizeBytes = 319_625_534L,
            ),
        ),
        dataDir = "espeak-ng-data",
        voices = listOf(
            TtsVoiceDescriptor("0", "af_heart (default)", "en", "female"),
            TtsVoiceDescriptor("1", "Voice 2", "en", null),
            TtsVoiceDescriptor("2", "Voice 3", "en", null),
            TtsVoiceDescriptor("3", "Voice 4", "en", null),
            TtsVoiceDescriptor("4", "Voice 5", "en", null),
            TtsVoiceDescriptor("5", "Voice 6", "en", null),
            TtsVoiceDescriptor("6", "Voice 7", "en", null),
            TtsVoiceDescriptor("7", "Voice 8", "en", null),
            TtsVoiceDescriptor("8", "Voice 9", "en", null),
            TtsVoiceDescriptor("9", "Voice 10", "en", null),
            TtsVoiceDescriptor("10", "Voice 11", "en", null),
        ),
    )

    /** All models, in display order (default first). */
    val ALL: List<TtsModelManifest> = listOf(KITTEN_NANO, KOKORO)

    fun byId(id: String): TtsModelManifest? = ALL.firstOrNull { it.id == id }

    /** The manifest to prefer when the active model is missing. */
    val fallbackDefault: TtsModelManifest get() = KITTEN_NANO
}
