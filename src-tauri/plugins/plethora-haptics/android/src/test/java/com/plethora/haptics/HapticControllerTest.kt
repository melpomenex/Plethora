package com.plethora.haptics

import android.app.Activity
import android.os.SystemClock
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@LooperMode(LooperMode.Mode.PAUSED)
class HapticControllerTest {
    class TestActivity : Activity(), LifecycleOwner {
        private val registry = LifecycleRegistry(this)
        override fun getLifecycle(): Lifecycle = registry
    }

    class FeedbackView(activity: Activity) : WebView(activity) {
        var feedbackCalls = 0
        var lastConstant: Int? = null
        var accepted = true
        override fun performHapticFeedback(feedbackConstant: Int): Boolean {
            feedbackCalls += 1
            lastConstant = feedbackConstant
            return accepted && isHapticFeedbackEnabled
        }
    }

    private lateinit var activity: TestActivity
    private lateinit var view: FeedbackView
    private lateinit var controller: HapticController

    @Before fun setup() {
        val host = Robolectric.buildActivity(TestActivity::class.java).setup().visible()
        activity = host.get()
        (activity.getLifecycle() as LifecycleRegistry).currentState = Lifecycle.State.RESUMED
        view = FeedbackView(activity)
        activity.setContentView(view)
        Shadows.shadowOf(activity.getSystemService(VibratorManager::class.java).defaultVibrator).setHasVibrator(true)
        controller = HapticController(activity)
        controller.bind(view)
        assertTrue(view.isAttachedToWindow)
        assertTrue(view.isShown)
    }

    private fun configure(enabled: Boolean = true, revision: Long = 1) {
        val config = HapticConfigurationArgs().apply {
            driverSessionId = controller.capabilities().getString("driverSessionId")
            this.revision = revision
            this.enabled = enabled
            intensity = "standard"
        }
        assertEquals(revision, controller.configure(config)!!.getLong("revision"))
    }

    private fun request(id: String = "operation", revision: Long = 1): HapticRequestArgs = HapticRequestArgs().apply {
        driverSessionId = controller.capabilities().getString("driverSessionId")
        this.revision = revision
        interactionId = id
        effect = "completion"
        ttlMs = 150
    }

    @Test fun lateRegistrationInResumedActivityReachesTheActualViewApi() {
        // No plugin onResume callback: lifecycle state must already be recognized.
        configure()
        val result = controller.perform(request(), SystemClock.elapsedRealtime())
        assertEquals("submitted", result.getString("status"))
        assertEquals(1, view.feedbackCalls)
        assertEquals(HapticFeedbackConstants.CONFIRM, view.lastConstant)
        assertTrue(result.getJSONObject("nativeState").getBoolean("platformAccepted"))
        val state = controller.capabilities().getJSONObject("nativeState")
        assertTrue(state.getBoolean("foreground"))
        assertTrue(state.getBoolean("webViewAttached"))
        assertTrue(state.getBoolean("configured"))
    }

    @Test fun platformRefusalAndViewPreferenceRemainSuppressedWithoutFallback() {
        configure()
        view.isHapticFeedbackEnabled = false
        val result = controller.perform(request(), SystemClock.elapsedRealtime())
        assertEquals("system-suppressed", result.getString("reason"))
        assertFalse(result.getJSONObject("nativeState").getBoolean("platformAccepted"))
        assertEquals(1, view.feedbackCalls)
        assertFalse(controller.capabilities().getJSONObject("nativeState").getBoolean("viewHapticsEnabled"))
    }

    @Test fun disabledAndForeignSessionAndObsoleteRevisionNeverReachView() {
        configure(false)
        assertEquals("disabled", controller.perform(request(), SystemClock.elapsedRealtime()).getString("reason"))
        configure(true, 2)
        assertEquals("stale", controller.perform(request(revision = 1), SystemClock.elapsedRealtime()).getString("reason"))
        val foreign = request(revision = 2).apply { driverSessionId = "old-plugin-session" }
        assertEquals("stale", controller.perform(foreign, SystemClock.elapsedRealtime()).getString("reason"))
        assertEquals(0, view.feedbackCalls)
    }

    @Test fun duplicateAndExpiredWorkAreDiscarded() {
        configure()
        val now = SystemClock.elapsedRealtime()
        assertEquals("submitted", controller.perform(request(), now).getString("status"))
        assertEquals("rate-limited", controller.perform(request(), now).getString("reason"))
        assertEquals("stale", controller.perform(request("expired"), now - 151).getString("reason"))
        assertEquals(1, view.feedbackCalls)
    }

    @Test fun pauseEpochDiscardsWorkThatWasQueuedBeforePauseEvenAfterResume() {
        configure()
        val oldEpoch = controller.lifecycleEpoch
        controller.setForeground(false)
        (activity.getLifecycle() as LifecycleRegistry).currentState = Lifecycle.State.STARTED
        assertEquals("background", controller.perform(request(), SystemClock.elapsedRealtime()).getString("reason"))
        (activity.getLifecycle() as LifecycleRegistry).currentState = Lifecycle.State.RESUMED
        controller.setForeground(true)
        assertEquals("stale", controller.perform(request(), SystemClock.elapsedRealtime(), oldEpoch).getString("reason"))
        assertEquals(0, view.feedbackCalls)
        assertEquals("submitted", controller.perform(request("fresh"), SystemClock.elapsedRealtime()).getString("status"))
    }
}
