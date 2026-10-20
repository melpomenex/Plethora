package com.plethora.androidspeech

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class PartRecord(
    val sequence: Long,
    val relativePath: String,
    val byteLength: Long,
    val sha256: String,
    val startMs: Long,
    val durationMs: Long,
    val formatJson: String,
    val committedAt: String
)

class RecordingWriter(
    val baseDir: File,
    val sessionId: String,
    val assetId: String,
    val writerEpoch: String,
    val sampleRate: Int = 16000,
    val channels: Int = 1,
    val partDurationMs: Long = 5000L,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {
    companion object {
        const val MAX_PENDING_BYTES = 4 * 1024 * 1024L // 4 MiB bound per D2
        const val WAV_HEADER_SIZE = 44

        fun buildWavHeader(dataSize: Int, sampleRate: Int, channels: Int): ByteArray {
            val byteRate = sampleRate * channels * 2
            val blockAlign = channels * 2
            val totalSize = 36 + dataSize
            val header = ByteArray(WAV_HEADER_SIZE)
            val bb = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            bb.put("RIFF".toByteArray(Charsets.US_ASCII))
            bb.putInt(totalSize)
            bb.put("WAVE".toByteArray(Charsets.US_ASCII))
            bb.put("fmt ".toByteArray(Charsets.US_ASCII))
            bb.putInt(16)
            bb.putShort(1.toShort()) // PCM format
            bb.putShort(channels.toShort())
            bb.putInt(sampleRate)
            bb.putInt(byteRate)
            bb.putShort(blockAlign.toShort())
            bb.putShort(16.toShort()) // 16 bits per sample
            bb.put("data".toByteArray(Charsets.US_ASCII))
            bb.putInt(dataSize)
            return header
        }

        fun computeSha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(8192)
                var read: Int
                while (input.read(buf).also { read = it } != -1) {
                    digest.update(buf, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }

        fun formatIso8601(epochMs: Long): String {
            val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            df.timeZone = TimeZone.getTimeZone("UTC")
            return df.format(Date(epochMs))
        }
    }

    private val bytesPerSample = channels * 2 // 16-bit PCM
    private val bytesPerSecond = sampleRate * bytesPerSample
    private val targetPartBytes = (partDurationMs * bytesPerSecond) / 1000L

    val managedRoot = File(baseDir, sessionId)
    val partsDir = File(managedRoot, "parts")

    private val parts = mutableListOf<PartRecord>()
    private var currentSequence = 0L
    private var activeStartMs = 0L

    private var activeRaf: RandomAccessFile? = null
    private var activePartialFile: File? = null
    private var activeDataBytesWritten = 0L
    private var pendingBytes = 0L

    val createdAtIso: String = formatIso8601(clock())
    var finalized = false
        private set

    init {
        managedRoot.mkdirs()
        partsDir.mkdirs()
    }

    @Synchronized
    fun appendSamples(pcmData: ByteArray, offset: Int = 0, length: Int = pcmData.size) {
        if (finalized) {
            throw IllegalStateException("Recording already finalized")
        }
        if (length <= 0) return

        if (pendingBytes + length > MAX_PENDING_BYTES) {
            throw IllegalStateException("backpressure_exceeded: pending bytes exceeds limit")
        }

        var currentOffset = offset
        var remaining = length

        while (remaining > 0) {
            ensureActivePart()
            val spaceInPart = (targetPartBytes - activeDataBytesWritten).coerceAtLeast(0L).toInt()
            if (spaceInPart <= 0) {
                closeActivePart()
                ensureActivePart()
                continue
            }

            val toWrite = minOf(remaining, spaceInPart)
            activeRaf!!.write(pcmData, currentOffset, toWrite)
            activeDataBytesWritten += toWrite
            currentOffset += toWrite
            remaining -= toWrite

            if (activeDataBytesWritten >= targetPartBytes) {
                closeActivePart()
            }
        }
    }

    private fun ensureActivePart() {
        if (activeRaf != null) return

        val fileName = "part_%06d.bin".format(currentSequence)
        val partialFile = File(partsDir, "$fileName.partial")
        if (partialFile.exists()) {
            partialFile.delete()
        }

        val raf = RandomAccessFile(partialFile, "rw")
        raf.setLength(0)
        // Write initial placeholder 44-byte WAV header
        val dummyHeader = buildWavHeader(0, sampleRate, channels)
        raf.write(dummyHeader)

        activeRaf = raf
        activePartialFile = partialFile
        activeDataBytesWritten = 0L
    }

    @Synchronized
    fun closeActivePart() {
        val raf = activeRaf ?: return
        val partialFile = activePartialFile ?: return

        try {
            // Rewrite WAV header with actual dataSize
            val dataSize = activeDataBytesWritten.toInt()
            val realHeader = buildWavHeader(dataSize, sampleRate, channels)
            raf.seek(0)
            raf.write(realHeader)
            raf.fd.sync()
            raf.close()
        } finally {
            activeRaf = null
            activePartialFile = null
        }

        val finalName = "part_%06d.bin".format(currentSequence)
        val finalFile = File(partsDir, finalName)
        if (finalFile.exists()) {
            finalFile.delete()
        }

        val renamed = partialFile.renameTo(finalFile)
        if (!renamed) {
            throw java.io.IOException("Failed to rename partial part to $finalFile")
        }

        val sha256 = computeSha256(finalFile)
        val durationMs = (activeDataBytesWritten * 1000L) / bytesPerSecond
        val formatJson = "{\"sampleRate\":$sampleRate,\"channels\":$channels,\"encoding\":\"pcm16le\"}"
        val committedAt = formatIso8601(clock())
        val relativePath = "parts/$finalName"

        val part = PartRecord(
            sequence = currentSequence,
            relativePath = relativePath,
            byteLength = finalFile.length(),
            sha256 = sha256,
            startMs = activeStartMs,
            durationMs = durationMs,
            formatJson = formatJson,
            committedAt = committedAt
        )
        parts.add(part)
        activeStartMs += durationMs
        currentSequence++
        activeDataBytesWritten = 0L

        writeManifestAtomic()
    }

    @Synchronized
    fun flush(isFinal: Boolean = false) {
        if (activeRaf != null && activeDataBytesWritten > 0L) {
            closeActivePart()
        } else if (activeRaf != null) {
            // Discard empty part
            try {
                activeRaf?.close()
                activePartialFile?.delete()
            } finally {
                activeRaf = null
                activePartialFile = null
            }
        }
        if (isFinal) {
            finalized = true
        }
        writeManifestAtomic()
    }

    private fun writeManifestAtomic() {
        val manifestObj = JSONObject().apply {
            put("manifestVersion", 1)
            put("sessionId", sessionId)
            put("assetId", assetId)
            put("writerEpoch", writerEpoch)
            put("mime", "audio/wav")
            put("sampleRate", sampleRate)
            put("channels", channels)
            put("finalized", finalized)
            put("createdAt", createdAtIso)
            put("updatedAt", formatIso8601(clock()))

            val partsArray = JSONArray()
            for (p in parts) {
                partsArray.put(JSONObject().apply {
                    put("sequence", p.sequence)
                    put("relativePath", p.relativePath)
                    put("byteLength", p.byteLength)
                    put("sha256", p.sha256)
                    put("startMs", p.startMs)
                    put("durationMs", p.durationMs)
                    put("formatJson", p.formatJson)
                    put("committedAt", p.committedAt)
                })
            }
            put("parts", partsArray)
        }

        val manifestFile = File(managedRoot, "manifest.json")
        val tmpFile = File(managedRoot, "manifest.json.tmp")

        FileOutputStream(tmpFile).use { fos ->
            fos.write(manifestObj.toString(2).toByteArray(Charsets.UTF_8))
            fos.fd.sync()
        }
        if (manifestFile.exists()) {
            manifestFile.delete()
        }
        if (!tmpFile.renameTo(manifestFile)) {
            throw java.io.IOException("Failed to rename manifest temp file to $manifestFile")
        }
    }

    fun getAcknowledgedMs(): Long = activeStartMs
    fun getPartsCount(): Int = parts.size
    fun getTotalBytes(): Long = parts.sumOf { it.byteLength }
    fun getParts(): List<PartRecord> = parts.toList()
}
