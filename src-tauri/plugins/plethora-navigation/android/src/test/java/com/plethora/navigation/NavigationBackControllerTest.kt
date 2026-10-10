package com.plethora.navigation

import android.os.Bundle
import android.os.Looper
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import app.tauri.plugin.JSObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSystemClock
import org.robolectric.shadows.ShadowDialog
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@LooperMode(LooperMode.Mode.PAUSED)
class NavigationBackControllerTest {
    class Host : ComponentActivity() {
        override fun onCreate(state: Bundle?) {
            setTheme(androidx.appcompat.R.style.Theme_AppCompat)
            super.onCreate(state)
        }
        var backgrounds = 0
        override fun moveTaskToBack(nonRoot: Boolean): Boolean { backgrounds++; return true }
    }
    private lateinit var host: Host
    private val requests = mutableListOf<JSObject>()
    private var epoch = ""

    @Before fun setup() {
        host = Robolectric.buildActivity(Host::class.java).setup().get()
        NavigationBackController.install(host)
        NavigationBackController.bind({ requests.add(it) }, {})
        NavigationBackController.onResume()
        epoch = NavigationBackController.attach().getString("epoch")
    }
    @After fun cleanup() {
        NavigationBackController.unbind()
        NavigationBackController.uninstall()
    }
    private fun back(): JSObject {
        host.onBackPressedDispatcher.onBackPressed()
        return requests.last()
    }
    private fun ack(request: JSObject, kind: String = "consumed") = AcknowledgeArgs().also {
        it.epoch = request.getString("epoch"); it.id = request.getString("id"); it.kind = kind
        if (kind == "consumed") it.outcome = "completed"
    }
    @Test fun committedInputRequiresClaimBeforeRootAndDoesNotReplay() {
        val request = back()
        assertFalse(NavigationBackController.acknowledge(ack(request, "root")).getBoolean("accepted"))
        assertEquals(0, host.backgrounds)
        assertTrue(NavigationBackController.claim(epoch, request.getString("id")).getBoolean("accepted"))
        assertTrue(NavigationBackController.acknowledge(ack(request, "root")).getBoolean("backgrounded"))
        assertTrue(NavigationBackController.acknowledge(ack(request, "root")).getBoolean("accepted"))
        assertEquals(1, host.backgrounds)
        assertFalse(NavigationBackController.acknowledge(ack(request)).getBoolean("accepted"))
    }
    @Test fun installationRestoresPrecedenceOverLateTauriCallbackWithoutStacking() {
        var competing = 0
        host.onBackPressedDispatcher.addCallback(host, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { competing++ }
        })
        NavigationBackController.install(host)
        NavigationBackController.install(host)
        back()
        host.onBackPressedDispatcher.onBackPressed()
        assertEquals(1, requests.size)
        assertEquals(0, competing)
    }
    @Test fun pauseAndExternalIntentFenceStaleRoot() {
        val old = back()
        NavigationBackController.claim(epoch, old.getString("id"))
        NavigationBackController.onPause()
        assertFalse(NavigationBackController.acknowledge(ack(old, "root")).getBoolean("accepted"))
        NavigationBackController.onResume()
        epoch = NavigationBackController.attach().getString("epoch")
        val next = back()
        NavigationBackController.claim(epoch, next.getString("id"))
        NavigationBackController.onExternalIntent()
        assertFalse(NavigationBackController.acknowledge(ack(next, "root")).getBoolean("accepted"))
        assertEquals(0, host.backgrounds)
    }
    @Test fun replacingWebViewInvalidatesOldEpoch() {
        val old = back()
        NavigationBackController.bind({ requests.add(it) }, {})
        assertFalse(NavigationBackController.claim(epoch, old.getString("id")).getBoolean("accepted"))
        epoch = NavigationBackController.attach().getString("epoch")
        assertNotEquals(old.getString("epoch"), epoch)
    }
    @Test fun expiredClaimCannotAuthorizeRoot() {
        val request = back()
        ShadowSystemClock.advanceBy(Duration.ofMillis(1501))
        assertFalse(NavigationBackController.claim(epoch, request.getString("id")).getBoolean("accepted"))
        assertFalse(NavigationBackController.acknowledge(ack(request, "root")).getBoolean("accepted"))
        assertEquals(0, host.backgrounds)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(ShadowDialog.getLatestDialog().isShowing)
    }
    @Test fun predictiveCancellationDoesNotDispatchAndCommitDispatchesOnce() {
        host.onBackPressedDispatcher.dispatchOnBackStarted(BackEventCompat(0f, 100f, 0f, BackEventCompat.EDGE_LEFT))
        host.onBackPressedDispatcher.dispatchOnBackProgressed(BackEventCompat(70f, 100f, 0.5f, BackEventCompat.EDGE_LEFT))
        host.onBackPressedDispatcher.dispatchOnBackCancelled()
        assertEquals(0, requests.size)
        assertEquals(0, host.backgrounds)
        back()
        assertEquals(1, requests.size)
    }
    @Test fun disabledControllerCannotAdvertiseReadySession() {
        NavigationBackController.uninstall()
        assertThrows(IllegalStateException::class.java) { NavigationBackController.attach() }
    }
}
