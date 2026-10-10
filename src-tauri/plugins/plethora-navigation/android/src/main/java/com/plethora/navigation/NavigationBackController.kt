package com.plethora.navigation

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import app.tauri.plugin.JSObject
import java.lang.ref.WeakReference
import java.util.UUID

/** Main-thread, Activity-lifecycle Back gate. It never replays an expired input. */
object NavigationBackController {
    private const val PROTOCOL_VERSION = 1
    private const val REQUEST_TIMEOUT_MS = 1500L
    private const val STARTUP_GRACE_MS = 5000L
    private const val JOURNAL_LIMIT = 256

    private data class InFlight(val id: String, val sequence: Long, val deadline: Long, var claimed: Boolean)

    private val main = Handler(Looper.getMainLooper())
    private var activityRef: WeakReference<ComponentActivity>? = null
    private var callback: OnBackPressedCallback? = null
    private var emitRequest: ((JSObject) -> Unit)? = null
    private var emitControl: ((JSObject) -> Unit)? = null
    private var epoch: String? = null
    private var sequence = 0L
    private var inFlight: InFlight? = null
    private var resumed = false
    private var startedAt = 0L
    private val timeoutToken = Any()
    private val startupToken = Any()
    private var lastDiagnosticAt = 0L
    private var recoveryDialog: AlertDialog? = null
    private val acknowledged = LinkedHashMap<String, String>()

    fun install(activity: ComponentActivity) = onMain {
        if (activityRef?.get() === activity && callback?.isEnabled == true) {
            // AndroidX dispatches to the most recently added enabled callback.
            // Re-adding this same callback keeps it above callbacks installed
            // later by Tauri plugins without ever stacking duplicate handlers.
            callback?.remove()
            activity.onBackPressedDispatcher.addCallback(activity, callback!!)
            return@onMain
        }
        uninstall()
        activityRef = WeakReference(activity)
        startedAt = SystemClock.elapsedRealtime()
        val next = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { handleBack() }
        }
        callback = next
        diagnostic("controller-installed")
        activity.onBackPressedDispatcher.addCallback(activity, next)
        main.postAtTime({
            if (!isReady() && activityRef?.get() === activity) showRecovery()
        }, startupToken, SystemClock.uptimeMillis() + STARTUP_GRACE_MS)
    }

    fun uninstall() = onMain {
        main.removeCallbacksAndMessages(timeoutToken)
        main.removeCallbacksAndMessages(startupToken)
        callback?.remove()
        callback = null
        inFlight = null
        epoch = null
        resumed = false
        recoveryDialog?.dismiss()
        recoveryDialog = null
        activityRef = null
    }

    fun bind(emitBack: (JSObject) -> Unit, emitControl: (JSObject) -> Unit) = onMain {
        invalidateSession()
        emitRequest = emitBack
        this.emitControl = emitControl
        activityRef?.get()?.let { install(it) }
    }

    fun unbind() = onMain { emitRequest = null; emitControl = null; invalidateSession() }

    fun onResume() = onMain {
        resumed = true
        if (epoch == null) emitControl?.invoke(JSObject().also { it.put("type", "session-invalidated") })
    }

    fun onPause() = onMain { resumed = false; invalidateSession() }

    fun onExternalIntent() = onMain { invalidateSession() }

    fun attach(): JSObject = onMainResult {
        check(callback?.isEnabled == true) { "Native Back controller disabled in this APK" }
        check(resumed) { "Native Back session requires a resumed Activity" }
        epoch = UUID.randomUUID().toString()
        acknowledged.clear()
        diagnostic("session-attached")
        sequence = 0L
        inFlight = null
        recoveryDialog?.dismiss()
        recoveryDialog = null
        JSObject().also { it.put("protocolVersion", PROTOCOL_VERSION); it.put("epoch", epoch) }
    }

    fun claim(requestEpoch: String?, id: String?): JSObject = onMainResult {
        val current = inFlight
        val valid = requestEpoch != null && requestEpoch == epoch && id != null &&
            current != null && current.id == id && resumed && SystemClock.elapsedRealtime() < current.deadline
        if (valid) current!!.claimed = true
        val remaining = if (valid) (current!!.deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0L) else 0L
        JSObject().also {
            it.put("accepted", valid)
            it.put("remainingMs", remaining)
            it.put("expiresAtEpochMs", System.currentTimeMillis() + remaining)
        }
    }

    fun acknowledge(args: AcknowledgeArgs): JSObject = onMainResult {
        fun response(accepted: Boolean, backgrounded: Boolean = false) = JSObject().also {
            it.put("accepted", accepted); it.put("backgrounded", backgrounded)
        }
        val id = args.id ?: return@onMainResult response(false)
        val epochValue = args.epoch ?: return@onMainResult response(false)
        val kind = args.kind ?: return@onMainResult response(false)
        val signature = "$kind|${args.outcome.orEmpty()}|${args.transitionId.orEmpty()}"
        if (epochValue != epoch) return@onMainResult response(false)
        acknowledged[id]?.let { return@onMainResult response(it == signature) }
        val current = inFlight ?: return@onMainResult response(false)
        if (epochValue != epoch || current.id != id || !current.claimed ||
            SystemClock.elapsedRealtime() >= current.deadline || !resumed) return@onMainResult response(false)
        if (kind !in setOf("consumed", "root", "unavailable")) return@onMainResult response(false)
        rememberAck(id, signature)
        inFlight = null
        var backgrounded = false
        when (kind) {
            "root" -> {
                val moved = activityRef?.get()?.moveTaskToBack(true) == true
                backgrounded = moved
                if (!moved) showRecovery()
            }
            "unavailable" -> showRecovery()
        }
        diagnostic("ack-$kind")
        response(true, backgrounded)
    }

    fun detach(requestEpoch: String?) = onMain {
        if (requestEpoch == epoch) invalidateSession()
    }

    private fun handleBack() = onMain {
        if (!resumed) return@onMain
        if (!isReady()) {
            if (SystemClock.elapsedRealtime() - startedAt >= STARTUP_GRACE_MS) showRecovery()
            return@onMain
        }
        if (inFlight != null) return@onMain
        val currentEpoch = epoch ?: return@onMain
        sequence += 1
        val id = "$currentEpoch-$sequence"
        val pending = InFlight(id, sequence, SystemClock.elapsedRealtime() + REQUEST_TIMEOUT_MS, false)
        inFlight = pending
        main.postAtTime({
            if (inFlight === pending && SystemClock.elapsedRealtime() >= pending.deadline) {
                inFlight = null
                showRecovery()
            }
        }, timeoutToken, SystemClock.uptimeMillis() + REQUEST_TIMEOUT_MS)
        try {
            emitRequest?.invoke(
                JSObject()
                    .put("protocolVersion", PROTOCOL_VERSION)
                    .put("epoch", currentEpoch)
                    .put("sequence", sequence)
                    .put("id", id)
            )
        } catch (_: Throwable) {
            inFlight = null
            showRecovery()
        }
    }

    private fun isReady() = resumed && epoch != null && emitRequest != null

    private fun invalidateSession() {
        main.removeCallbacksAndMessages(timeoutToken)
        val hadSession = epoch != null
        epoch = null
        inFlight = null
        if (hadSession) emitControl?.invoke(JSObject().also { it.put("type", "session-invalidated") })
        recoveryDialog?.dismiss()
        recoveryDialog = null
    }

    private fun rememberAck(id: String, signature: String) {
        acknowledged[id] = signature
        while (acknowledged.size > JOURNAL_LIMIT) acknowledged.remove(acknowledged.keys.first())
    }

    private fun showRecovery(): Unit = onMain {
        val activity = activityRef?.get() ?: return@onMain
        if (!resumed) return@onMain
        if (activity.isFinishing || recoveryDialog?.isShowing == true) return@onMain
        recoveryDialog = AlertDialog.Builder(activity)
            .setTitle(R.string.navigation_recovery_title)
            .setMessage(R.string.navigation_recovery_message)
            .setCancelable(false)
            .setPositiveButton(R.string.navigation_recovery_retry) { dialog, _ ->
                dialog.dismiss()
                recoveryDialog = null
                epoch = null
                emitControl?.invoke(JSObject().also { it.put("type", "retry") })
            }
            .setNegativeButton(R.string.navigation_recovery_stay) { dialog, _ ->
                dialog.dismiss()
                recoveryDialog = null
            }
            .setNeutralButton(R.string.navigation_recovery_background) { dialog, _ ->
                dialog.dismiss()
                recoveryDialog = null
                if (activity.moveTaskToBack(true).not()) showRecovery()
            }
            .create()
        recoveryDialog?.show()
    }

    private fun diagnostic(stage: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastDiagnosticAt < 1000L) return
        lastDiagnosticAt = now
        Log.d("PlethoraBack", "$stage resumed=$resumed installed=${callback != null} session=${epoch != null}")
    }

    private fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post(action)
    }

    private fun <T> onMainResult(action: () -> T): T {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Back protocol commands must run on the main thread" }
        return action()
    }
}
