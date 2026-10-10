package com.plethora.navigation

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class AttachArgs { var clientSessionId: String? = null }

@InvokeArg
class EpochArgs { var epoch: String? = null }

@InvokeArg
class RequestArgs { var epoch: String? = null; var id: String? = null }

@InvokeArg
class AcknowledgeArgs {
    var epoch: String? = null
    var id: String? = null
    var kind: String? = null
    var outcome: String? = null
    var transitionId: String? = null
}

@TauriPlugin
class NavigationPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        super.load(webView)
        NavigationBackController.bind(
            emitBack = { payload -> trigger("back-request", payload) },
            emitControl = { payload -> trigger("back-control", payload) },
        )
    }

    override fun onResume() {
        super.onResume()
        NavigationBackController.onResume()
    }

    override fun onPause() {
        NavigationBackController.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        NavigationBackController.unbind()
        super.onDestroy()
    }

    @Command
    fun attach(invoke: Invoke) {
        val args = invoke.parseArgs(AttachArgs::class.java)
        if (args.clientSessionId.isNullOrBlank()) {
            invoke.reject("clientSessionId is required", "invalid_argument")
            return
        }
        invoke.resolve(NavigationBackController.attach())
    }

    @Command
    fun claim(invoke: Invoke) {
        val args = invoke.parseArgs(RequestArgs::class.java)
        val result = NavigationBackController.claim(args.epoch, args.id)
        invoke.resolve(result)
    }

    @Command
    fun acknowledge(invoke: Invoke) {
        val args = invoke.parseArgs(AcknowledgeArgs::class.java)
        invoke.resolve(NavigationBackController.acknowledge(args))
    }

    @Command
    fun detach(invoke: Invoke) {
        val args = invoke.parseArgs(EpochArgs::class.java)
        NavigationBackController.detach(args.epoch)
        invoke.resolve(JSObject().put("detached", true))
    }
}
