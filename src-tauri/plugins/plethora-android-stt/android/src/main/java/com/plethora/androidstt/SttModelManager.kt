// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// On-device STT model management: resumable downloads with size+SHA-256
// verification before a model is marked ready, extraction, and delete.
// Mirrors TtsAssetManager in the android-tts plugin with two upgrades the
// STT spec requires: HTTP Range resume from the partial file, and strict
// archive-size verification in addition to the checksum.

package com.plethora.androidstt

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

sealed class SttDownloadOutcome {
    data object Success : SttDownloadOutcome()
    data class Failure(val kind: String, val message: String) : SttDownloadOutcome()
}

class SttModelManager(private val context: Context) : SttModelStore {

    val rootDir: File get() = File(context.filesDir, "stt")

    override fun modelDir(modelId: String): File = File(rootDir, modelId)

    private val cancelFlags = ConcurrentHashMap<String, Boolean>()
    private val installing = ConcurrentHashMap.newKeySet<String>()

    /** A model is ready when its extracted artifacts exist on disk. */
    override fun isReady(manifest: SttModelManifest): Boolean {
        val dir = modelDir(manifest.id)
        if (!dir.isDirectory) return false
        return findFile(dir, "model.int8.onnx") != null && findFile(dir, "tokens.txt") != null
    }

    fun readyModelIds(): Set<String> =
        SttModelRegistry.ALL.filter { isReady(it) }.map { it.id }.toSet()

    fun isInstalling(modelId: String): Boolean = modelId in installing

    fun bytesOnDisk(modelId: String): Long {
        val dir = modelDir(modelId)
        if (!dir.isDirectory) return 0L
        return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    }

    fun requestCancel(modelId: String) {
        cancelFlags[modelId] = true
    }

    /**
     * Download (resuming any partial file), verify size + SHA-256, extract,
     * and verify the model artifacts. The model is never ready before both
     * verifications pass.
     */
    fun download(
        manifest: SttModelManifest,
        onProgress: (modelId: String, bytesDownloaded: Long, totalBytes: Long) -> Unit,
    ): SttDownloadOutcome {
        if (manifest.id in installing) {
            return SttDownloadOutcome.Failure("busy", "download already running")
        }
        installing.add(manifest.id)
        cancelFlags[manifest.id] = false
        try {
            val dir = modelDir(manifest.id)
            dir.mkdirs()
            val part = File(dir, manifest.archiveName + ".part")

            // Free-space preflight: the archive and its extraction coexist
            // during install; keep a margin for the filesystem.
            val needed = manifest.archiveBytes + manifest.extractedBytes + (64L shl 20)
            if (dir.usableSpace < needed) {
                return SttDownloadOutcome.Failure("insufficient_space", "need ~${needed shr 20} MiB free")
            }

            val download = downloadResumable(manifest, part, onProgress)
            if (download is SttDownloadOutcome.Failure) return download

            if (part.length() != manifest.archiveBytes) {
                val actual = part.length()
                part.delete()
                return SttDownloadOutcome.Failure("checksum_mismatch",
                    "size $actual != expected ${manifest.archiveBytes}")
            }
            val sha = sha256(part)
            if (!sha.equals(manifest.archiveSha256, ignoreCase = true)) {
                part.delete()
                return SttDownloadOutcome.Failure("checksum_mismatch", "sha256 mismatch")
            }

            val archive = File(dir, manifest.archiveName)
            if (!part.renameTo(archive)) {
                part.delete()
                return SttDownloadOutcome.Failure("extract_failed", "cannot promote archive")
            }
            val extracted = extract(archive, dir)
            archive.delete()
            if (!extracted || !isReady(manifest)) {
                return SttDownloadOutcome.Failure("incomplete", "archive did not contain the model files")
            }
            return SttDownloadOutcome.Success
        } finally {
            installing.remove(manifest.id)
            cancelFlags.remove(manifest.id)
        }
    }

    /** Resume the .part file via HTTP Range; restart clean if unsupported. */
    private fun downloadResumable(
        manifest: SttModelManifest,
        part: File,
        onProgress: (String, Long, Long) -> Unit,
    ): SttDownloadOutcome {
        val digest = MessageDigest.getInstance("SHA-256")
        var existing = 0L
        if (part.isFile && part.length() > 0) {
            // Hash what we already have so the final digest covers the whole file.
            part.inputStream().use { input ->
                val buf = ByteArray(BUFFER)
                while (true) {
                    val read = input.read(buf)
                    if (read < 0) break
                    digest.update(buf, 0, read)
                    existing += read
                }
            }
            if (existing >= manifest.archiveBytes) {
                // A stale oversized partial cannot be valid; start over.
                part.delete()
                existing = 0
            }
        }

        val connection = URL(manifest.url).openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        if (existing > 0) connection.setRequestProperty("Range", "bytes=$existing-")

        val status = connection.responseCode
        if (status !in 200..299) {
            connection.disconnect()
            return SttDownloadOutcome.Failure("network", "HTTP $status fetching model")
        }

        val appending = status == 206
        if (!appending && existing > 0) {
            // Server ignored Range: the partial is unusable; restart clean.
            existing = 0
            digest.reset()
            part.delete()
        }

        val total = if (appending) existing + (connection.contentLengthLong.coerceAtLeast(0L))
        else connection.contentLengthLong.coerceAtLeast(0L)
        var done = existing

        try {
            FileOutputStream(part, appending).use { out ->
                val input = connection.inputStream
                val buf = ByteArray(BUFFER)
                while (true) {
                    if (cancelFlags[manifest.id] == true) {
                        return SttDownloadOutcome.Failure("cancelled", "download cancelled")
                    }
                    val read = input.read(buf)
                    if (read < 0) break
                    out.write(buf, 0, read)
                    digest.update(buf, 0, read)
                    done += read
                    onProgress(manifest.id, done, if (total > 0) total else manifest.archiveBytes)
                }
            }
        } catch (e: Exception) {
            return SttDownloadOutcome.Failure("network", e.message ?: "network error")
        } finally {
            connection.disconnect()
        }
        return SttDownloadOutcome.Success
    }

    /** tar -xjf via Android toybox (same approach as the TTS plugin). */
    private fun extract(archive: File, dir: File): Boolean = try {
        val process = ProcessBuilder("tar", "-xjf", archive.absolutePath, "-C", dir.absolutePath)
            .redirectErrorStream(true)
            .start()
        process.inputStream.readBytes() // drain so the pipe never blocks
        process.waitFor() == 0
    } catch (_: Throwable) {
        false
    }

    fun delete(modelId: String): Boolean {
        val dir = modelDir(modelId)
        return !dir.exists() || dir.deleteRecursively()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(BUFFER)
            while (true) {
                val read = input.read(buf)
                if (read < 0) break
                digest.update(buf, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun findFile(dir: File, name: String): File? =
        dir.walkTopDown().filter { it.isFile && it.name == name }.firstOrNull()

    companion object {
        private const val BUFFER = 64 * 1024
    }
}
