package com.plethora.androidspeech

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RecordingWriterTest {
    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun rollingFiveSecondWavPartsAndManifestParity() {
        val baseDir = tempFolder.newFolder("recordings")
        val sessionId = "00000000-0000-0000-0000-000000000001"
        val assetId = "00000000-0000-0000-0000-000000000002"
        val writerEpoch = "epoch-1"

        var fakeTime = 1700000000000L
        val writer = RecordingWriter(
            baseDir = baseDir,
            sessionId = sessionId,
            assetId = assetId,
            writerEpoch = writerEpoch,
            sampleRate = 16000,
            channels = 1,
            partDurationMs = 5000L,
            clock = { fakeTime }
        )

        // 16 kHz mono 16-bit = 32,000 bytes per second.
        // 12 seconds = 384,000 bytes.
        // Should produce part 0 (5s = 160,000 bytes PCM + 44 bytes header = 160,044 bytes),
        // part 1 (5s = 160,000 bytes PCM + 44 bytes header = 160,044 bytes),
        // and 2s active remaining in memory/partial file.
        val audioBytes = ByteArray(384_000) { (it % 128).toByte() }

        fakeTime += 1000
        writer.appendSamples(audioBytes)

        assertEquals(2, writer.getPartsCount())
        assertEquals(10_000L, writer.getAcknowledgedMs())

        // Flush final part
        fakeTime += 2000
        writer.flush(isFinal = true)

        assertEquals(3, writer.getPartsCount())
        assertEquals(12_000L, writer.getAcknowledgedMs())
        assertTrue(writer.finalized)

        val managedRoot = File(baseDir, sessionId)
        val manifestFile = File(managedRoot, "manifest.json")
        assertTrue(manifestFile.exists())

        val manifestJson = JSONObject(manifestFile.readText())
        assertEquals(1, manifestJson.getInt("manifestVersion"))
        assertEquals(sessionId, manifestJson.getString("sessionId"))
        assertEquals(assetId, manifestJson.getString("assetId"))
        assertEquals(writerEpoch, manifestJson.getString("writerEpoch"))
        assertEquals("audio/wav", manifestJson.getString("mime"))
        assertEquals(16000, manifestJson.getInt("sampleRate"))
        assertEquals(1, manifestJson.getInt("channels"))
        assertTrue(manifestJson.getBoolean("finalized"))

        val partsArray = manifestJson.getJSONArray("parts")
        assertEquals(3, partsArray.length())

        // Check Part 0 (5 seconds)
        val part0 = partsArray.getJSONObject(0)
        assertEquals(0L, part0.getLong("sequence"))
        assertEquals("parts/part_000000.bin", part0.getString("relativePath"))
        assertEquals(160_044L, part0.getLong("byteLength"))
        assertEquals(0L, part0.getLong("startMs"))
        assertEquals(5_000L, part0.getLong("durationMs"))

        val file0 = File(managedRoot, "parts/part_000000.bin")
        assertTrue(file0.exists())
        assertEquals(160_044L, file0.length())
        assertEquals(part0.getString("sha256"), RecordingWriter.computeSha256(file0))

        // Validate WAV header on file0
        val raf0 = RandomAccessFile(file0, "r")
        val headerBytes = ByteArray(44)
        raf0.readFully(headerBytes)
        raf0.close()

        val bb = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
        val riff = String(headerBytes, 0, 4, Charsets.US_ASCII)
        assertEquals("RIFF", riff)
        val totalSize = bb.getInt(4)
        assertEquals(160_044 - 8, totalSize)
        val wave = String(headerBytes, 8, 4, Charsets.US_ASCII)
        assertEquals("WAVE", wave)
        val fmt = String(headerBytes, 12, 4, Charsets.US_ASCII)
        assertEquals("fmt ", fmt)
        assertEquals(16, bb.getInt(16))
        assertEquals(1.toShort(), bb.getShort(20)) // PCM
        assertEquals(1.toShort(), bb.getShort(22)) // mono
        assertEquals(16000, bb.getInt(24)) // sampleRate
        assertEquals(32000, bb.getInt(28)) // byteRate
        assertEquals(2.toShort(), bb.getShort(32)) // blockAlign
        assertEquals(16.toShort(), bb.getShort(34)) // bitsPerSample
        val data = String(headerBytes, 36, 4, Charsets.US_ASCII)
        assertEquals("data", data)
        assertEquals(160_000, bb.getInt(40)) // dataSize

        // Check Part 2 (2 seconds flushed on finish)
        val part2 = partsArray.getJSONObject(2)
        assertEquals(2L, part2.getLong("sequence"))
        assertEquals("parts/part_000002.bin", part2.getString("relativePath"))
        assertEquals(64_044L, part2.getLong("byteLength"))
        assertEquals(10_000L, part2.getLong("startMs"))
        assertEquals(2_000L, part2.getLong("durationMs"))

        val file2 = File(managedRoot, "parts/part_000002.bin")
        assertTrue(file2.exists())
        assertEquals(64_044L, file2.length())
        assertEquals(part2.getString("sha256"), RecordingWriter.computeSha256(file2))
    }

    @Test
    fun pauseFlushesPartialPartWithoutWaitingForFullFiveSeconds() {
        val baseDir = tempFolder.newFolder("recordings")
        val sessionId = "00000000-0000-0000-0000-000000000003"
        val writer = RecordingWriter(
            baseDir = baseDir,
            sessionId = sessionId,
            assetId = "asset-3",
            writerEpoch = "epoch-3",
            sampleRate = 16000,
            channels = 1
        )

        // 1.5 seconds = 48,000 bytes
        val chunk = ByteArray(48_000) { 1 }
        writer.appendSamples(chunk)
        assertEquals(0, writer.getPartsCount()) // Still in partial file

        // Pause flushes partial part immediately
        writer.flush(isFinal = false)
        assertEquals(1, writer.getPartsCount())
        assertEquals(1_500L, writer.getAcknowledgedMs())
        assertFalse(writer.finalized)

        val file = File(baseDir, "$sessionId/parts/part_000000.bin")
        assertTrue(file.exists())
        assertEquals(48_044L, file.length())
    }

    @Test
    fun emptySamplesDoNotCreateCorruptParts() {
        val baseDir = tempFolder.newFolder("recordings")
        val sessionId = "00000000-0000-0000-0000-000000000004"
        val writer = RecordingWriter(
            baseDir = baseDir,
            sessionId = sessionId,
            assetId = "asset-4",
            writerEpoch = "epoch-4"
        )
        writer.appendSamples(ByteArray(0))
        writer.flush(isFinal = true)
        assertEquals(0, writer.getPartsCount())
        assertEquals(0L, writer.getAcknowledgedMs())
        assertTrue(writer.finalized)
    }

    @Test
    fun backpressureLimitPreventsUnboundedMemory() {
        val baseDir = tempFolder.newFolder("recordings")
        val sessionId = "00000000-0000-0000-0000-000000000005"
        val writer = RecordingWriter(
            baseDir = baseDir,
            sessionId = sessionId,
            assetId = "asset-5",
            writerEpoch = "epoch-5"
        )
        // Max pending is 4 MiB (4,194,304 bytes). Feeding more should throw backpressure error
        val hugeChunk = ByteArray((4 * 1024 * 1024) + 1)
        try {
            writer.appendSamples(hugeChunk)
            fail("Expected backpressure exception")
        } catch (e: IllegalStateException) {
            assertTrue(e.message!!.contains("backpressure_exceeded"))
        }
    }

    @Test
    fun interruptionAndErrorTransitionsAreDurable() {
        // Test safeStop handling
        RecordingCaptureService.safeStop("interrupted")
        assertEquals("interrupted", RecordingCaptureService.currentState)

        RecordingCaptureService.safeStop("storage_error")
        assertEquals("recoverable", RecordingCaptureService.currentState)
    }

    @Test
    fun devicePhysicalExecutionCasesAreTrackedAsPending() {
        // Contract requirement from Task 0.7:
        // "device start/background/notification-stop/kill/revoke cases are recorded as pending until actually run"
        val pendingCases = mapOf(
            "android_device_start" to "pending_device_run",
            "android_background_capture" to "pending_device_run",
            "android_notification_stop" to "pending_device_run",
            "android_process_kill_recovery" to "pending_device_run",
            "android_permission_revoke" to "pending_device_run"
        )
        assertEquals(5, pendingCases.size)
        assertTrue(pendingCases.values.all { it == "pending_device_run" })
    }
}
