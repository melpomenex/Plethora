// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Foreground service that keeps the app process alive while TTS playback
// continues, so audio survives screen lock and backgrounding (spec:
// tts-local-onnx-runtime, "Background and locked-screen playback where
// supported").
//
// The engine and AudioTrack live in AndroidTtsPlugin (they must, because
// AudioTrack streaming is driven by the sherpa generation callback). This
// service only owns a foreground notification that pins the process; the
// plugin starts it when playback begins and stops it when playback ends.

package com.plethora.androidtts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import app.tauri.Logger

class TtsPlaybackService : Service() {

    companion object {
        // Channel id kept legacy: Android persists notification channels by
        // id, and renaming would strand the user's existing channel settings.
        private const val CHANNEL_ID = "incrementum_tts_playback"
        private const val NOTIFICATION_ID = 4201

        fun start(ctx: Context) {
            try {
                val intent = Intent(ctx, TtsPlaybackService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Throwable) {
                Logger.warn("TtsPlaybackService start failed: ${e.message}")
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, TtsPlaybackService::class.java))
            } catch (_: Throwable) {
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        // Everything here must be non-fatal. This runs inside
        // ActivityThread.handleCreateService, so anything thrown becomes
        // "Unable to create service ..." and kills the whole app — the caller's
        // try/catch around startForegroundService() is in a different frame and
        // cannot catch it. A foreground service can be refused for reasons we
        // do not control (background-start restrictions on API 31+, per-type
        // policy on API 34+, restricted app-standby bucket), so a refusal must
        // degrade to "no locked-screen playback" rather than crash. Audio
        // itself lives in AndroidTtsPlugin and keeps working without us.
        try {
            ensureChannel()
            val notification = buildNotification("Reading aloud")
            // The platform overload is used directly rather than
            // ServiceCompat.startForeground, which only exists in
            // androidx.core 1.12+ (this module builds against core-ktx 1.9.0).
            // Passing the type explicitly is required from API 34 on and is
            // accepted from API 29 on.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Throwable) {
            Logger.warn("TtsPlaybackService: startForeground refused (${e.message}); continuing without it")
            // Required: a service started via startForegroundService() that never
            // reaches startForeground() is killed with an ANR after ~5s. Bail out
            // immediately instead.
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // NOT sticky. A sticky restart re-creates this service with a null
        // intent when nothing is playing — the plugin's engine and AudioTrack
        // are gone at that point, so the notification would pin a process with
        // no audio behind it, and any startForeground failure would loop
        // (crash -> system restart -> crash). The plugin restarts the service
        // explicitly on the next speak().
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Read-aloud playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps reading aloud while the screen is locked."
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Incrementum")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
