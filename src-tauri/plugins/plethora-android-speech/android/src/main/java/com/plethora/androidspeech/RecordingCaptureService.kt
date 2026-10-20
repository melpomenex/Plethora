package com.plethora.androidspeech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class RecordingCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "plethora_recording_channel"
        const val NOTIFICATION_ID = 8801

        const val ACTION_START = "com.plethora.androidspeech.action.START"
        const val ACTION_PAUSE = "com.plethora.androidspeech.action.PAUSE"
        const val ACTION_RESUME = "com.plethora.androidspeech.action.RESUME"
        const val ACTION_FINISH = "com.plethora.androidspeech.action.FINISH"

        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_ASSET_ID = "assetId"
        const val EXTRA_WRITER_EPOCH = "writerEpoch"
        const val EXTRA_BASE_DIR = "baseDir"
        const val EXTRA_SAMPLE_RATE = "sampleRate"
        const val EXTRA_CHANNELS = "channels"

        @Volatile
        var activeSessionId: String? = null
            private set

        @Volatile
        var activeWriterEpoch: String? = null
            private set

        @Volatile
        var currentState: String = "idle"
            private set

        @Volatile
        var activeWriter: RecordingWriter? = null
            private set

        private val isRecording = AtomicBoolean(false)
        private var audioRecord: AudioRecord? = null
        private var recordingThread: Thread? = null

        @Synchronized
        fun startCapture(
            context: Context,
            sessionId: String,
            assetId: String,
            writerEpoch: String,
            baseDir: File,
            sampleRate: Int = 16000,
            channels: Int = 1
        ): RecordingWriter {
            if (activeSessionId != null && activeSessionId != sessionId && currentState == "recording") {
                throw IllegalStateException("Microphone already owned by session $activeSessionId")
            }

            val writer = RecordingWriter(
                baseDir = baseDir,
                sessionId = sessionId,
                assetId = assetId,
                writerEpoch = writerEpoch,
                sampleRate = sampleRate,
                channels = channels
            )
            activeWriter = writer
            activeSessionId = sessionId
            activeWriterEpoch = writerEpoch
            currentState = "recording"

            // Start foreground service
            val intent = Intent(context, RecordingCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_ASSET_ID, assetId)
                putExtra(EXTRA_WRITER_EPOCH, writerEpoch)
                putExtra(EXTRA_SAMPLE_RATE, sampleRate)
                putExtra(EXTRA_CHANNELS, channels)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }

            startAudioLoop(sampleRate, channels, writer)
            return writer
        }

        @Synchronized
        fun pauseCapture(sessionId: String, writerEpoch: String) {
            if (activeSessionId != sessionId || activeWriterEpoch != writerEpoch) {
                throw IllegalStateException("Session token mismatch")
            }
            stopAudioLoop()
            activeWriter?.flush(isFinal = false)
            currentState = "paused"
        }

        @Synchronized
        fun resumeCapture(sessionId: String, writerEpoch: String, sampleRate: Int = 16000, channels: Int = 1) {
            if (activeSessionId != sessionId || activeWriterEpoch != writerEpoch) {
                throw IllegalStateException("Session token mismatch")
            }
            val writer = activeWriter ?: throw IllegalStateException("No active writer")
            currentState = "recording"
            startAudioLoop(sampleRate, channels, writer)
        }

        @Synchronized
        fun finishCapture(context: Context, sessionId: String, writerEpoch: String): RecordingWriter {
            if (activeSessionId != sessionId || activeWriterEpoch != writerEpoch) {
                throw IllegalStateException("Session token mismatch")
            }
            stopAudioLoop()
            val writer = activeWriter ?: throw IllegalStateException("No active writer")
            writer.flush(isFinal = true)
            currentState = "saved"

            // Stop service
            val intent = Intent(context, RecordingCaptureService::class.java).apply {
                action = ACTION_FINISH
            }
            context.startService(intent)

            activeSessionId = null
            activeWriterEpoch = null
            activeWriter = null
            return writer
        }

        @Synchronized
        fun safeStop(reason: String) {
            stopAudioLoop()
            try {
                activeWriter?.flush(isFinal = false)
            } catch (_: Throwable) {}
            currentState = if (reason == "interrupted") "interrupted" else "recoverable"
        }

        private fun startAudioLoop(sampleRate: Int, channels: Int, writer: RecordingWriter) {
            if (isRecording.getAndSet(true)) return

            val channelConfig = if (channels == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
            val minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, AudioFormat.ENCODING_PCM_16BIT)
            val bufferSize = maxOf(minBuf * 2, 4096)

            val record = try {
                AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    channelConfig,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize
                )
            } catch (e: Throwable) {
                isRecording.set(false)
                currentState = "failed"
                throw e
            }

            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                isRecording.set(false)
                currentState = "failed"
                throw IllegalStateException("AudioRecord failed to initialize")
            }

            audioRecord = record
            record.startRecording()

            val thread = Thread({
                val buffer = ByteArray(4096)
                while (isRecording.get()) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        try {
                            writer.appendSamples(buffer, 0, read)
                        } catch (e: Throwable) {
                            safeStop("storage_error")
                            break
                        }
                    } else if (read < 0) {
                        safeStop("audio_read_error")
                        break
                    }
                }
            }, "plethora-audiorecord-worker")

            recordingThread = thread
            thread.isDaemon = true
            thread.start()
        }

        private fun stopAudioLoop() {
            isRecording.set(false)
            try {
                audioRecord?.stop()
                audioRecord?.release()
            } catch (_: Throwable) {}
            audioRecord = null
            recordingThread?.interrupt()
            recordingThread = null
        }
    }

    private var audioManager: AudioManager? = null
    private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                safeStop("interrupted")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        @Suppress("DEPRECATION")
        audioManager?.requestAudioFocus(
            audioFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_FINISH -> {
                stopForeground(true)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                activeSessionId?.let { sId ->
                    activeWriterEpoch?.let { epoch ->
                        pauseCapture(sId, epoch)
                    }
                }
            }
            ACTION_RESUME -> {
                activeSessionId?.let { sId ->
                    activeWriterEpoch?.let { epoch ->
                        resumeCapture(sId, epoch)
                    }
                }
            }
        }

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        @Suppress("DEPRECATION")
        audioManager?.abandonAudioFocus(audioFocusListener)
        safeStop("service_destroyed")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "PLETHORA Recording Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Ongoing audio recording session"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pauseIntent = Intent(this, RecordingCaptureService::class.java).apply { action = ACTION_PAUSE }
        val pausePendingIntent = PendingIntent.getService(
            this, 1, pauseIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val finishIntent = Intent(this, RecordingCaptureService::class.java).apply { action = ACTION_FINISH }
        val finishPendingIntent = PendingIntent.getService(
            this, 2, finishIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PLETHORA Recording")
            .setContentText("Lecture / audio recording in progress")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Pause", pausePendingIntent)
            .addAction(android.R.drawable.ic_menu_save, "Finish", finishPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
