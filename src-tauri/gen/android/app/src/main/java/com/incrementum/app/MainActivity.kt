package com.incrementum.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import app.tauri.plugin.PluginManager
import com.incrementum.app.BuildConfig

class MainActivity : TauriActivity() {

    // Holds the WebView's pending media permission request while we wait for
    // the OS-level permission dialog. Android WebView has a TWO-layer model:
    // the OS popup appearing does NOT mean the WebView gets access — the
    // WebChromeClient must also explicitly grant RESOURCE_*_CAPTURE. Tauri's
    // generated WebView does not bridge these layers by default, so without
    // this, getUserMedia() rejects with NotAllowedError even after the user
    // taps "Allow". See tauri-apps/tauri discussion #12732.
    private var pendingWebViewPermission: PermissionRequest? = null

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val cameraGranted = grants[Manifest.permission.CAMERA] == true
        val audioGranted = grants[Manifest.permission.RECORD_AUDIO] == true
        pendingWebViewPermission?.let { request ->
            val toGrant = mutableListOf<String>()
            if (cameraGranted) toGrant.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
            if (audioGranted) toGrant.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
            if (toGrant.isNotEmpty()) {
                request.grant(toGrant.toTypedArray())
            } else {
                request.deny()
            }
            pendingWebViewPermission = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Enable edge-to-edge display - this configures the window to:
        // 1. Draw content behind system bars (status bar, navigation bar)
        // 2. Set transparent colors for system bars
        // 3. Report safe area insets to the WebView via CSS env(safe-area-inset-*)
        // Note: Must be called before super.onCreate()
        enableEdgeToEdge()

        // Register the activity-result launchers that plugins (e.g. folder-import's
        // SAF folder picker) use via Plugin.startActivityForResult(). The generated
        // TauriActivity wires every other PluginManager lifecycle hook (onResume,
        // onPause, …) but omits onActivityCreate, so the launchers stay lateinit
        // and any plugin call to startActivityForResult() crashes with
        // "lateinit property startActivityForResultLauncher has not been initialized".
        // Must run before super.onCreate() so the launchers exist before plugins
        // can fire (super.onCreate triggers the Wry/Rust webview init).
        PluginManager.onActivityCreate(this)

        super.onCreate(savedInstanceState)
        handleIntent(intent)

        // The WebView is created asynchronously during super.onCreate; install
        // the permission-bridging WebChromeClient once the view tree is ready.
        // Re-hooked in onResume because the WebView may be (re)created on
        // configuration changes / resume.
        window.decorView.post { hookWebViewPermissions() }
    }

    override fun onResume() {
        super.onResume()
        hookWebViewPermissions()
    }

    /**
     * Install a WebChromeClient that bridges WebView getUserMedia requests to
     * the OS permission layer. Used by the sync QR scanner (qr-scanner, video)
     * and the Document Assistant voice feature (Web Speech API, audio).
     *
     * NOTE: this replaces Tauri's default WebChromeClient for the permission
     * callback. We grant both RESOURCE_VIDEO_CAPTURE and RESOURCE_AUDIO_CAPTURE
     * when the corresponding OS permission is held, so the existing mic flow is
     * preserved. We deliberately do NOT set AudioManager.MODE_IN_COMMUNICATION
     * (this is a podcast/reading app; forcing that mode would disrupt media
     * playback).
     */
    private fun hookWebViewPermissions() {
        val wv = findWebView(window.decorView.rootView) ?: return
        wv.settings.mediaPlaybackRequiresUserGesture = false
        // Chrome DevTools remote debugging instrumentation adds non-trivial
        // overhead to every JS execution and DOM mutation. It must NOT be
        // enabled in release APKs — doing so caused severe, app-wide lag on
        // Android (see commit 4f7ecc09, which left it on unconditionally).
        // Gate it to debug builds only.
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        wv.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val supported = request.resources.toSet()
                    val wantCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in supported
                    val wantAudio = PermissionRequest.RESOURCE_AUDIO_CAPTURE in supported

                    val cameraGranted = !wantCamera || ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                    val audioGranted = !wantAudio || ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED

                    if (cameraGranted && audioGranted) {
                        // OS already permits everything requested — forward to WebView.
                        val toGrant = mutableListOf<String>()
                        if (wantCamera) toGrant.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                        if (wantAudio) toGrant.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                        request.grant(toGrant.toTypedArray())
                    } else {
                        // Hold the WebView request, surface the OS dialog, resolve on result.
                        pendingWebViewPermission = request
                        val toRequest = mutableListOf<String>()
                        if (wantCamera && !cameraGranted) toRequest.add(Manifest.permission.CAMERA)
                        if (wantAudio && !audioGranted) toRequest.add(Manifest.permission.RECORD_AUDIO)
                        if (toRequest.isEmpty()) {
                            request.grant(request.resources)
                            pendingWebViewPermission = null
                        } else {
                            requestPermissionsLauncher.launch(toRequest.toTypedArray())
                        }
                    }
                }
            }
        }
    }

    /**
     * Android WebView does not expose KEYCODE_VOLUME_* as DOM keyboard events.
     * Forward them while a reader explicitly opts in, and leave normal system
     * volume handling untouched everywhere else.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> "VolumeUp"
            KeyEvent.KEYCODE_VOLUME_DOWN -> "VolumeDown"
            else -> return super.dispatchKeyEvent(event)
        }

        if (event.action == KeyEvent.ACTION_DOWN) {
            val repeat = event.repeatCount > 0
            val webView = findWebView(window.decorView.rootView)
                ?: return super.dispatchKeyEvent(event)
            val script = "document.body?.dispatchEvent(new KeyboardEvent('keydown'," +
                "{key:'$key',code:'$key',repeat:$repeat,bubbles:true,cancelable:true})) ?? true"
            webView.evaluateJavascript(script) { wasNotCanceled ->
                // dispatchEvent returns false only when a configured reader
                // synchronously called preventDefault(). Otherwise reproduce
                // Android's normal volume behavior, including its system UI.
                if (wasNotCanceled != "false") {
                    adjustSystemVolume(event.keyCode)
                }
            }
        }
        return true
    }

    private fun adjustSystemVolume(keyCode: Int) {
        val direction = if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            AudioManager.ADJUST_RAISE
        } else {
            AudioManager.ADJUST_LOWER
        }
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.adjustVolume(direction, AudioManager.FLAG_SHOW_UI)
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findWebView(view.getChildAt(i))?.let { return it }
            }
        }
        return null
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent != null) {
            com.incrementum.folderimport.FolderImportPlugin.handleIncomingIntent(this, intent)
        }
    }
}
