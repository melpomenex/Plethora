package com.plethora.app

import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebView
import org.json.JSONObject

/** Bounded, content-free console channel independent of Tauri IPC. */
internal class StartupTrace {
    @Volatile private var epoch = 0L
    @Volatile private var usable = false
    private var consoleRecords = 0

    fun begin() {
        epoch = SystemClock.elapsedRealtimeNanos()
        usable = false
        consoleRecords = 0
        mark("activity-create")
        if (BuildConfig.STARTUP_BENCH || BuildConfig.STARTUP_TRACE_STACKS) observeStall(epoch)
    }

    private fun observeStall(launchEpoch: Long) {
        Thread({
            for (delayMs in listOf(2_000L, 8_000L)) {
                Thread.sleep(delayMs)
                if (usable || epoch != launchEpoch) return@Thread
                // ADB debuggerd requires root on the reference phone. Capture the
                // JVM side of the UI/JavaBridge call chain from this independent
                // thread, without posting to the potentially blocked UI or IPC.
                Thread.getAllStackTraces().entries
                    .filter { it.key.name == "main" || it.key.name.contains("JavaBridge") || it.key.name.startsWith("Thread-") }
                    .sortedBy { if (it.key.name == "main") 0 else if (it.key.name.contains("JavaBridge")) 1 else 2 }
                    .take(8)
                    .forEach { (thread, frames) ->
                        Log.i("PlethoraStartup", JSONObject().apply {
                            put("phase", "stalled-jvm-thread")
                            put("clock", "activity")
                            put("elapsedMs", elapsedMs())
                            put("thread", thread.name)
                            put("state", thread.state.name)
                            put("frames", org.json.JSONArray(frames.take(16).map { it.toString().take(180) }))
                        }.toString())
                    }
            }
        }, "PlethoraStartupWatchdog").apply { isDaemon = true }.start()
    }

    private fun elapsedMs() = (SystemClock.elapsedRealtimeNanos() - epoch) / 1_000_000

    fun mark(phase: String) {
        Log.i("PlethoraStartup", JSONObject().apply {
            put("phase", phase)
            put("elapsedMs", elapsedMs())
            put("clock", "activity")
            put("android", Build.VERSION.RELEASE)
            put("webview", WebView.getCurrentWebViewPackage()?.versionName ?: "unknown")
            put("debug", BuildConfig.DEBUG)
            put("thread", Thread.currentThread().name)
        }.toString())
    }

    fun console(message: ConsoleMessage): Boolean {
        val prefix = "[startup:android] "
        if (!message.message().startsWith(prefix) || consoleRecords >= 256) return false
        return try {
            val trace = JSONObject(message.message().removePrefix(prefix))
            if (trace.optString("phase") == "interaction-ready") usable = true
            // Emission/receipt clock pair; receipt latency is included.
            trace.put("activityElapsedMs", elapsedMs())
            trace.put("clock", "frontend")
            Log.i("PlethoraStartup", trace.toString())
            consoleRecords++
            true
        } catch (_: Exception) { false }
    }
}
