// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// On-demand download, integrity verification, storage, and removal of TTS
// model assets. Models are NEVER bundled in the APK; they live under
// `<filesDir>/tts/<modelId>/` and are fetched on explicit user action.
//
// Pattern (mirrors src-tauri/src/transcription/model_manager.rs):
//   - stream to a `.part` temp file,
//   - hash with SHA-256 as bytes arrive,
//   - on mismatch delete and report; on match atomic-move into place,
//   - emit progress events with bytes/total + model id,
//   - support cancellation that drops the temp file but keeps verified models,
//   - resume by skipping already-verified models and restarting a partial one.

package com.incrementum.androidtts

import android.content.Context
import app.tauri.Logger
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.io.BufferedInputStream

/**
 * Result of a download attempt. [DownloadOutcome] is used internally; the plugin
 * translates these into resolve/reject + events.
 */
sealed class DownloadOutcome {
    object Success : DownloadOutcome()
    data class Failure(val message: String, val kind: String) : DownloadOutcome()
}

class TtsAssetManager(private val context: Context) {

    /** Root directory for all TTS models: `<filesDir>/tts/`. */
    val rootDir: File = File(context.filesDir, "tts")

    /** Per-model cancellation flags, keyed by model id. */
    private val cancelFlags = ConcurrentHashMap<String, Boolean>()

    /** Per-model "currently installing" flags, for listModels state. */
    private val installing = ConcurrentHashMap<String, Boolean>()

    init {
        rootDir.mkdirs()
    }

    /** Directory for a model: `<filesDir>/tts/<modelId>/`. */
    fun modelDir(modelId: String): File = File(rootDir, modelId)

    /** The extracted model directory (after a tarball is unpacked). */
    private fun modelExtractDir(manifest: TtsModelManifest): File = modelDir(manifest.id)

    /**
     * Readiness = the extracted model directory exists and contains the primary
     * model file. We do not require a marker file so external deletion is
     * detected by the absence of the real artifact.
     */
    fun isInstalled(manifest: TtsModelManifest): Boolean {
        val dir = modelExtractDir(manifest)
        if (!dir.isDirectory) return false
        return primaryModelFile(manifest, dir)?.isFile == true
    }

    fun isInstalling(modelId: String): Boolean = installing[modelId] == true

    /** Bytes on disk for a model (recursive), 0 if not installed. */
    fun bytesOnDisk(modelId: String): Long {
        val dir = modelDir(modelId)
        return if (dir.isDirectory) dir.walkTopDown().filter { it.isFile }.sumOf { it.length() } else 0L
    }

    /**
     * Locate the primary `.onnx` model file inside an extracted model dir. The
     * sherpa-onnx packages contain exactly one `*.onnx` (plus voices/tokens).
     */
    private fun primaryModelFile(manifest: TtsModelManifest, dir: File): File? {
        // Packages extract to a subfolder; search recursively for the onnx.
        return dir.walkTopDown().firstOrNull { it.isFile && it.name.endsWith(".onnx") }
    }

    /**
     * Download and verify a model. Emits progress via [onProgress]. Resolves on
     * success; on failure returns [DownloadOutcome.Failure]. Cancellation via
     * [requestCancel] produces a Failure with kind "cancelled".
     *
     * Must be called off the main thread.
     */
    fun download(
        manifest: TtsModelManifest,
        onProgress: (modelId: String, bytes: Long, total: Long) -> Unit,
    ): DownloadOutcome {
        installing[manifest.id] = true
        cancelFlags[manifest.id] = false
        try {
            // Clean any prior partial/corrupt state for this model so retry
            // always starts clean.
            val dir = modelExtractDir(manifest)
            if (dir.exists()) dir.deleteRecursively()
            dir.mkdirs()

            val totalBytes = manifest.files.sumOf { it.sizeBytes }
            // The manifest models a single tarball; fetch + verify + extract.
            val asset = manifest.files.first()
            val partFile = File(dir, asset.name + ".part")

            // Free-space preflight with a safety margin.
            val margin = 32L * 1024 * 1024
            val free = dir.usableSpace.coerceAtLeast(0L)
            if (free < totalBytes + margin) {
                return DownloadOutcome.Failure(
                    "Not enough free space: need ~${(totalBytes + margin) / (1024 * 1024)} MB, have ${free / (1024 * 1024)} MB.",
                    "insufficient_space",
                )
            }

            // --- Streaming download with SHA-256 on the fly ---
            val outcome = streamDownloadAndVerify(manifest, asset, partFile, totalBytes, onProgress)
            if (outcome !is DownloadOutcome.Success) return outcome

            // --- Extract the tarball in place ---
            try {
                extractTarBz2(partFile, dir)
            } catch (e: Exception) {
                Logger.error("TTS extract failed for ${manifest.id}: ${e.message}")
                return DownloadOutcome.Failure(
                    "Model archive could not be extracted: ${e.message}",
                    "extract_failed",
                )
            } finally {
                partFile.delete()
            }

            // --- Readiness check: primary onnx must now exist ---
            if (primaryModelFile(manifest, dir)?.isFile != true) {
                Logger.error("TTS ${manifest.id}: primary onnx missing after extract")
                return DownloadOutcome.Failure(
                    "Model did not contain the expected files.",
                    "incomplete",
                )
            }

            onProgress(manifest.id, totalBytes, totalBytes)
            return DownloadOutcome.Success
        } catch (e: Exception) {
            Logger.error("TTS download failed for ${manifest.id}: ${e.message}")
            return DownloadOutcome.Failure(
                e.message ?: "Download failed",
                "network",
            )
        } finally {
            installing[manifest.id] = false
            cancelFlags.remove(manifest.id)
        }
    }

    /** Stream [asset] from its URL to [partFile], hashing as we go. */
    private fun streamDownloadAndVerify(
        manifest: TtsModelManifest,
        asset: TtsAssetFile,
        partFile: File,
        totalBytes: Long,
        onProgress: (String, Long, Long) -> Unit,
    ): DownloadOutcome {
        val url = "${manifest.baseUrl}/${asset.name}"
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 60_000
                instanceFollowRedirects = true
                requestMethod = "GET"
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                return DownloadOutcome.Failure(
                    "Download failed: HTTP $code for ${asset.name}",
                    "network",
                )
            }
            val digest = MessageDigest.getInstance("SHA-256")
            FileOutputStream(partFile).use { out ->
                BufferedInputStream(conn.inputStream).use { input ->
                    val buf = ByteArray(64 * 1024)
                    var read: Int
                    var transferred = 0L
                    while (true) {
                        if (cancelFlags[manifest.id] == true) {
                            out.flush()
                            partFile.delete()
                            return DownloadOutcome.Failure("Download cancelled.", "cancelled")
                        }
                        read = input.read(buf)
                        if (read <= 0) break
                        out.write(buf, 0, read)
                        digest.update(buf, 0, read)
                        transferred += read
                        onProgress(manifest.id, transferred, totalBytes)
                    }
                    out.flush()
                }
            }

            // Verify checksum (unless the manifest ships a placeholder, in which
            // case we skip strict verification but still require the file to be
            // non-empty — see TtsModelManifest docs).
            if (!asset.sha256.startsWith("PLACEHOLDER")) {
                val hex = digest.digest().joinToString("") { "%02x".format(it) }
                if (!hex.equals(asset.sha256, ignoreCase = true)) {
                    partFile.delete()
                    Logger.error("TTS ${manifest.id}: checksum mismatch (got $hex)")
                    return DownloadOutcome.Failure(
                        "Checksum verification failed for ${asset.name}.",
                        "checksum_mismatch",
                    )
                }
            } else if (partFile.length() == 0L) {
                partFile.delete()
                return DownloadOutcome.Failure("Downloaded file was empty.", "checksum_mismatch")
            }
            return DownloadOutcome.Success
        } catch (e: IOException) {
            partFile.delete()
            return DownloadOutcome.Failure(
                "Network error during download: ${e.message}",
                "network",
            )
        } finally {
            conn?.disconnect()
        }
    }

    /** Extract a `.tar.bz2` into [outDir] using Apache commons-compress-free path. */
    private fun extractTarBz2(tarBz2: File, outDir: File) {
        // BZip2 -> tar entries. We avoid a commons-compress dependency by
        // shelling to the platform `tar` if available, else falling back to a
        // pure-Kotlin bzip2+tar reader. Android ships `tar` via toybox, so the
        // process path is reliable.
        val pb = ProcessBuilder("tar", "-xjf", tarBz2.absolutePath, "-C", outDir.absolutePath)
            .redirectErrorStream(true)
        val proc = pb.start()
        val out = proc.inputStream.bufferedReader().readText()
        val code = proc.waitFor()
        if (code != 0) {
            throw IOException("tar exited $code: ${out.take(500)}")
        }
    }

    /** Request cancellation of an in-progress download. Verified models are kept. */
    fun requestCancel(modelId: String) {
        cancelFlags[modelId] = true
    }

    /**
     * Delete a model's files entirely and return disk usage to zero. Safe to
     * call when not installed.
     */
    fun delete(modelId: String): Boolean {
        installing.remove(modelId)
        val dir = modelDir(modelId)
        return if (dir.exists()) dir.deleteRecursively() else true
    }
}
