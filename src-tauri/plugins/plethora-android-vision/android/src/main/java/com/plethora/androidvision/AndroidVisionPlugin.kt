package com.plethora.androidvision

import android.app.Activity
import android.content.Intent
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.File

@InvokeArg
class ScanDocumentArgs {
    var maxPages: Int? = null
    var allowGallery: Boolean? = null
}

@TauriPlugin
class AndroidVisionPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun scanStatus(invoke: Invoke) {
        invoke.resolve(capability())
    }

    @Command
    fun scanDocument(invoke: Invoke) {
        val args = invoke.parseArgs(ScanDocumentArgs::class.java)
        val maxPages = (args.maxPages ?: 10).coerceIn(1, 20)
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(args.allowGallery != false)
            .setPageLimit(maxPages)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)
            .build()
        GmsDocumentScanning.getClient(options)
            .getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                val request = IntentSenderRequest.Builder(sender).build()
                startIntentSenderForResult(invoke, request, "onScanResult")
            }
            .addOnFailureListener { error ->
                invoke.reject(error.message ?: "scanner unavailable", "feature_unavailable")
            }
    }

    @ActivityCallback
    fun onScanResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Scan cancelled", "cancelled")
            return
        }
        val data: Intent = result.data ?: run {
            invoke.reject("No scanner result", "empty_output")
            return
        }
        val scanned = GmsDocumentScanningResult.fromActivityResultIntent(data)
        val pages = scanned?.pages.orEmpty()
        val out = JSArray()
        val dir = File(activity.filesDir, "scans").apply { mkdirs() }
        pages.forEachIndexed { index, page ->
            val dest = File(dir, "page-${System.currentTimeMillis()}-$index.jpg")
            activity.contentResolver.openInputStream(page.imageUri)?.use { input ->
                dest.outputStream().use { input.copyTo(it) }
            }
            val bytes = dest.readBytes()
            val obj = JSObject()
            obj.put("sourceUri", dest.absolutePath)
            obj.put("mimeType", "image/jpeg")
            obj.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            obj.put("width", 0)
            obj.put("height", 0)
            out.put(obj)
            dest.delete()
        }
        val payload = JSObject()
        payload.put("pages", out)
        invoke.resolve(payload)
    }

    private fun capability(): JSObject {
        val o = JSObject()
        o.put("id", "vision.scan")
        o.put("available", true)
        o.put("ready", true)
        o.put("requiresDownload", false)
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", true)
        o.put("supportsStreaming", false)
        o.put("supportsImages", true)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", org.json.JSONArray())
        o.put("privacy", "on-device")
        return o
    }
}
