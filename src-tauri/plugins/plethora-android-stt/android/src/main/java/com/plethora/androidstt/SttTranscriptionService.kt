// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Transcription foreground service: keeps on-device jobs alive while the app
// is backgrounded/screen-off (spec) with a visible notification (document
// title + progress) and a Cancel action. Uses the mediaProcessing FGS type
// on API 35+ (6 h/24 h runtime cap — onTimeout stops the job gracefully and
// leaves a resumable checkpoint) and dataSync below.

package com.plethora.androidstt

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Bridge the manifest-declared receiver / service use to reach the manager. */
object SttServiceBridge {
    @Volatile
    var manager: SttJobManager? = null

    /** Hook chain the plugin installs into the manager; the service plugs in here. */
    @Volatile
    var delegatingHooks: DelegatingHooks? = null
}

/** Forwards hook callbacks to whichever service instance is alive. */
class DelegatingHooks : SttServiceHooks() {
    @Volatile
    var delegate: SttServiceHooks? = null

    override fun onJobStarted(info: SttJobInfo) {
        delegate?.onJobStarted(info)
    }

    override fun onProgress(info: SttJobInfo, percent: Int, decodeOffsetMs: Long) {
        delegate?.onProgress(info, percent, decodeOffsetMs)
    }

    override fun onJobFinished(info: SttJobInfo, state: SttJobState) {
        delegate?.onJobFinished(info, state)
    }
}

class SttTranscriptionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Transcription",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "On-device transcription progress"
                }
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        SttServiceBridge.delegatingHooks?.delegate = ServiceHooks(this)
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Transcription"
        startInForeground(title, 0)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (SttServiceBridge.delegatingHooks?.delegate is ServiceHooks) {
            SttServiceBridge.delegatingHooks?.delegate = null
        }
        super.onDestroy()
    }

    /**
     * API 35+ mediaProcessing timeout: stop the job gracefully — completed
     * segments and the decode checkpoint survive for the next window.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        SttServiceBridge.manager?.cancelForTimeout()
    }

    override fun onTimeout(startId: Int) {
        SttServiceBridge.manager?.cancelForTimeout()
    }

    private fun startInForeground(title: String, percent: Int) {
        val notification = buildNotification(title, percent)
        when {
            Build.VERSION.SDK_INT >= 35 -> startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
            )
            Build.VERSION.SDK_INT >= 29 -> startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
            else -> startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(title: String, percent: Int): Notification {
        val cancelIntent = PendingIntent.getBroadcast(
            this,
            0,
            Intent(this, SttCancelReceiver::class.java).setAction(SttCancelReceiver.ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setContentText("$percent%")
            .setProgress(100, percent, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .addAction(0, "Cancel", cancelIntent)
            .build()
    }

    private class ServiceHooks(private val service: SttTranscriptionService) : SttServiceHooks() {
        private var lastTitle: String = ""
        private var lastPercent = -1

        override fun onJobStarted(info: SttJobInfo) {
            lastTitle = info.title.ifEmpty { "Transcription" }
            lastPercent = -1
            service.startInForeground(lastTitle, 0)
        }

        override fun onProgress(info: SttJobInfo, percent: Int, decodeOffsetMs: Long) {
            if (percent == lastPercent) return
            lastPercent = percent
            val manager = service.getSystemService(NotificationManager::class.java)
            manager.notify(
                NOTIFICATION_ID,
                service.buildNotification(info.title.ifEmpty { "Transcription" }, percent),
            )
        }

        override fun onJobFinished(info: SttJobInfo, state: SttJobState) {
            service.stopForeground(STOP_FOREGROUND_REMOVE)
            service.stopSelf()
        }
    }

    companion object {
        private const val CHANNEL_ID = "plethora_stt"
        private const val NOTIFICATION_ID = 4200
        private const val EXTRA_TITLE = "title"

        /** Start while the app is foregrounded (jobs are user-initiated, D6). */
        fun start(context: Context, title: String) {
            val intent = Intent(context, SttTranscriptionService::class.java)
                .putExtra(EXTRA_TITLE, title)
            try {
                context.startService(intent)
            } catch (_: IllegalStateException) {
                // Backgrounded fallback: the compliant FGS start.
                context.startForegroundService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SttTranscriptionService::class.java))
        }
    }
}

/** Notification Cancel action → prompt job cancellation. */
class SttCancelReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_CANCEL) SttServiceBridge.manager?.cancel()
    }

    companion object {
        const val ACTION_CANCEL = "com.plethora.androidstt.CANCEL"
    }
}
