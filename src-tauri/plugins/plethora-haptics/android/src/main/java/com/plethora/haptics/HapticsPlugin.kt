package com.plethora.haptics

import android.app.Activity
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.View
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.lang.ref.WeakReference
import java.util.LinkedHashMap
import java.util.UUID

@InvokeArg
class HapticConfigurationArgs {
    var driverSessionId: String? = null
    var revision: Long = 0
    var enabled: Boolean = false
    var intensity: String? = null
}

@InvokeArg
class HapticRequestArgs {
    var driverSessionId: String? = null
    var revision: Long = 0
    var interactionId: String? = null
    var effect: String? = null
    var ttlMs: Int = 0
}

@TauriPlugin
class HapticsPlugin(private val activity: Activity) : Plugin(activity) {
    private val controller = HapticController(activity)

    override fun load(webView: WebView) {
        super.load(webView)
        controller.bind(webView)
    }

    override fun onResume() {
        super.onResume()
        controller.setForeground(true)
    }

    override fun onPause() {
        controller.setForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        controller.destroy()
        super.onDestroy()
    }

    @Command
    fun getCapabilities(invoke: Invoke) {
        invoke.resolve(controller.capabilities())
    }

    @Command
    fun configure(invoke: Invoke) {
        val args = invoke.parseArgs(HapticConfigurationArgs::class.java)
        val result = controller.configure(args)
        if (result == null) invoke.reject("stale or invalid haptic configuration", "stale")
        else invoke.resolve(result)
    }

    @Command
    fun perform(invoke: Invoke) {
        val args = invoke.parseArgs(HapticRequestArgs::class.java)
        val receivedAt = android.os.SystemClock.elapsedRealtime()
        activity.runOnUiThread { invoke.resolve(controller.perform(args, receivedAt)) }
    }
}

internal class HapticController(private val activity: Activity) {
    private val sessionId = UUID.randomUUID().toString()
    private var webView = WeakReference<WebView>(null)
    private var foreground = false
    private var destroyed = false
    private var configured = false
    private var enabled = false
    private var intensity = "subtle"
    private var revision = 0L
    private val recentIds = object : LinkedHashMap<String, Long>(256, 0.75f, true) {}
    private val submissions = ArrayDeque<Long>()
    private var lastSubmission = Long.MIN_VALUE

    fun bind(view: WebView) { webView = WeakReference(view) }
    fun setForeground(value: Boolean) { foreground = value && !destroyed }

    fun capabilities(): JSObject {
        val motor = try {
            vibrator()?.hasVibrator()?.let { if (it) "available" else "unavailable" } ?: "unknown"
        } catch (_: RuntimeException) { "unknown" }
        val preference = try {
            val setting = Settings.System.getInt(activity.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED)
            if (setting == 0) "disabled" else "enabled"
        } catch (_: Exception) { "unknown" }
        return JSObject()
            .put("protocolVersion", 1)
            .put("driver", "android-native")
            .put("driverSessionId", sessionId)
            .put("configurationRevision", revision)
            .put("hardware", motor)
            .put("systemPreference", preference)
            .put("intensityControl", "effect-style")
    }

    fun configure(args: HapticConfigurationArgs): JSObject? {
        val requestedSession = args.driverSessionId
        val requestedIntensity = args.intensity
        if (requestedSession != sessionId || args.revision <= 0 || requestedIntensity !in setOf("subtle", "standard", "strong")) return null
        if (configured && args.revision < revision) return null
        if (args.revision == revision && configured) return JSObject().put("driverSessionId", sessionId).put("revision", revision)
        revision = args.revision
        enabled = args.enabled
        intensity = requestedIntensity!!
        configured = true
        return JSObject().put("driverSessionId", sessionId).put("revision", revision)
    }

    fun perform(args: HapticRequestArgs, receivedAt: Long): JSObject {
        val now = android.os.SystemClock.elapsedRealtime()
        fun skipped(reason: String) = JSObject().put("status", "skipped").put("reason", reason)
        if (args.driverSessionId != sessionId || !configured || args.revision != revision || args.ttlMs !in 1..150) return skipped("stale")
        if (now - receivedAt > args.ttlMs) return skipped("stale")
        if (!enabled) return skipped("disabled")
        if (!foreground || destroyed) return skipped("background")
        val view = webView.get()
        if (view == null || !view.isAttachedToWindow || view.windowVisibility != View.VISIBLE || !view.isShown) return skipped("background")
        if (vibrator()?.hasVibrator() != true) return skipped("unsupported")
        val effect = args.effect
        val id = args.interactionId
        if (effect !in EFFECTS || id.isNullOrBlank() || id.length > 128) return skipped("unsupported")
        recentIds.entries.removeIf { now - it.value > 2_000L }
        if (recentIds.containsKey(id)) return skipped("rate-limited")
        while (submissions.isNotEmpty() && now - submissions.first() >= 1_000L) submissions.removeFirst()
        val cooldown = if (effect == "error" || effect == "warning") 250L else 60L
        if (submissions.size >= 8 || now - lastSubmission < cooldown) return skipped("rate-limited")

        recentIds[id] = now
        while (recentIds.size > 256) recentIds.remove(recentIds.entries.first().key)
        val constant = HapticMapping.constant(effect!!, intensity) ?: return skipped("unsupported")
        val invoked = try { view.performHapticFeedback(constant) } catch (_: RuntimeException) { false }
        if (!invoked) return skipped("system-suppressed")
        submissions.addLast(now)
        lastSubmission = now
        return JSObject().put("status", "submitted")
    }

    fun destroy() {
        foreground = false
        destroyed = true
        enabled = false
        configured = false
        webView.clear()
        recentIds.clear()
        submissions.clear()
    }

    private fun vibrator(): Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        activity.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        activity.getSystemService(Vibrator::class.java)
    }

    companion object { private val EFFECTS = setOf("selection", "activation", "threshold", "commit", "success", "warning", "error", "completion", "celebration") }
}
