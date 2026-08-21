// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// Android implementation of the folder-import Tauri plugin.
//
// Uses Android's Storage Access Framework (ACTION_OPEN_DOCUMENT_TREE) to let
// the user pick a folder, then recursively walks the selected tree with
// DocumentFile, copying every supported file into the app's private storage
// (`<filesDir>/imports/<relative-subpath>`) so Rust's std::fs can read it
// later (content:// URIs are not readable as filesystem paths).
//
// Mirrors the contract of tauri-plugin-dialog's DialogPlugin.kt:
// `@Command` handlers receive an `app.tauri.plugin.Invoke`, resolve/reject it,
// and `startActivityForResult(invoke, intent, "<callbackMethod>")` defers the
// result to an `@ActivityCallback`-annotated method.

package com.plethora.folderimport

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.documentfile.provider.DocumentFile
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@InvokeArg
class PickFolderOptions {
  var extensions: Array<String>? = null
}

@InvokeArg
class PickFilesOptions {
  var extensions: Array<String>? = null
  var multiple: Boolean = false
}

@InvokeArg
class InstallApkOptions {
  var filePath: String? = null
}

@InvokeArg
class CaptureRenderedDomOptions {
  var url: String? = null
  var timeoutMs: Int? = null
}

/**
 * Result of an offscreen rendered-DOM capture, serialized back to Rust.
 * Field names must match the Rust `CaptureOutcome` camelCase struct.
 */
data class CaptureOutcome(
  val html: String,
  val finalUrl: String,
  val durationMs: Long,
)

/**
 * One staged file, serialized back to Rust as JSON. Field names must match the
 * Rust `StagedFile` struct (camelCase via serde rename_all = "camelCase"):
 * path, relativePath, fileName.
 */
data class StagedFile(
  val path: String,
  val relativePath: String,
  val fileName: String,
)

@TauriPlugin
class FolderImportPlugin(private val activity: Activity) : Plugin(activity) {

  companion object {
    private var webView: android.webkit.WebView? = null
    private var pendingUrl: String? = null
    private val pendingBatches = mutableListOf<JSObject>()
    private var isFrontendReady: Boolean = false

    /** Single-flight queue for rendered-DOM captures: one capture WebView at
     *  a time so concurrent imports never stack multiple WebViews. */
    private val captureSerialExecutor by lazy {
      java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "inc-article-capture").apply { isDaemon = true }
      }
    }

    fun handleSharedUrl(url: String) {
      val view = webView
      if (view != null && isFrontendReady) {
        view.post {
          val escapedUrl = url.replace("'", "\\'")
          view.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-shared-url', { detail: '$escapedUrl' }));", null)
        }
      } else {
        pendingUrl = url
      }
    }

    fun handleIncomingIntent(context: android.content.Context, intent: Intent?) {
      if (intent == null) return
      val action = intent.action ?: return
      if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE && action != Intent.ACTION_VIEW) {
        return
      }

      val items = mutableListOf<JSObject>()
      val importRoot = File(context.filesDir, "imports")
      val title = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        ?: intent.getStringExtra(Intent.EXTRA_TITLE)

      if (action == Intent.ACTION_SEND) {
        val streamUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(Intent.EXTRA_STREAM)
        } ?: intent.data

        val rawText = intent.getStringExtra(Intent.EXTRA_TEXT)

        if (streamUri != null) {
          val mimeType = intent.type ?: context.contentResolver.getType(streamUri) ?: "application/octet-stream"
          val fileName = queryDisplayName(context, streamUri) ?: "shared_${System.currentTimeMillis()}"
          val staged = stageFileByUri(context, streamUri, fileName, fileName, importRoot)
          if (staged != null) {
            val item = JSObject()
            item.put("type", "file")
            item.put("filePath", staged.path)
            item.put("fileName", staged.fileName)
            item.put("mimeType", mimeType)
            if (title != null) item.put("title", title)
            if (rawText != null && rawText.isNotBlank()) item.put("text", rawText)
            val fileObj = File(staged.path)
            if (fileObj.exists()) item.put("fileSize", fileObj.length())
            items.add(item)
          }
        } else if (rawText != null) {
          val urlRegex = Regex("""https?://[^\s]+""")
          val match = urlRegex.find(rawText)
          if (match != null) {
            val url = match.value
            val item = JSObject()
            item.put("type", "url")
            item.put("url", url)
            if (title != null) item.put("title", title)
            val note = rawText.replace(url, "").trim()
            if (note.isNotEmpty()) item.put("text", note)
            items.add(item)
            handleSharedUrl(url)
          } else {
            val item = JSObject()
            item.put("type", "text")
            item.put("text", rawText)
            if (title != null) item.put("title", title)
            items.add(item)
          }
        }
      } else if (action == Intent.ACTION_SEND_MULTIPLE) {
        val streamUris: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }
        val rawText = intent.getStringExtra(Intent.EXTRA_TEXT)

        if (streamUris != null) {
          for (uri in streamUris) {
            val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val fileName = queryDisplayName(context, uri) ?: "shared_${System.currentTimeMillis()}"
            val staged = stageFileByUri(context, uri, fileName, fileName, importRoot)
            if (staged != null) {
              val item = JSObject()
              item.put("type", "file")
              item.put("filePath", staged.path)
              item.put("fileName", staged.fileName)
              item.put("mimeType", mimeType)
              if (title != null) item.put("title", title)
              if (rawText != null && rawText.isNotBlank()) item.put("text", rawText)
              val fileObj = File(staged.path)
              if (fileObj.exists()) item.put("fileSize", fileObj.length())
              items.add(item)
            }
          }
        }
      } else if (action == Intent.ACTION_VIEW) {
        val viewUri = intent.data
        if (viewUri != null) {
          if (viewUri.scheme == "http" || viewUri.scheme == "https") {
            val url = viewUri.toString()
            val item = JSObject()
            item.put("type", "url")
            item.put("url", url)
            items.add(item)
            handleSharedUrl(url)
          } else {
            val mimeType = intent.type ?: context.contentResolver.getType(viewUri) ?: "application/octet-stream"
            val fileName = queryDisplayName(context, viewUri) ?: "view_${System.currentTimeMillis()}"
            val staged = stageFileByUri(context, viewUri, fileName, fileName, importRoot)
            if (staged != null) {
              val item = JSObject()
              item.put("type", "file")
              item.put("filePath", staged.path)
              item.put("fileName", staged.fileName)
              item.put("mimeType", mimeType)
              val fileObj = File(staged.path)
              if (fileObj.exists()) item.put("fileSize", fileObj.length())
              items.add(item)
            }
          }
        }
      }

      if (items.isNotEmpty()) {
        val batch = JSObject()
        batch.put("timestamp", System.currentTimeMillis())
        val arr = JSArray()
        for (it in items) {
          arr.put(it)
        }
        batch.put("items", arr)

        val view = webView
        if (view != null && isFrontendReady) {
          view.post {
            val jsonStr = batch.toString().replace("'", "\\'")
            view.evaluateJavascript("window.dispatchEvent(new CustomEvent('incrementum-native-share', { detail: JSON.parse('$jsonStr') }));", null)
          }
        } else {
          synchronized(pendingBatches) {
            pendingBatches.add(batch)
          }
        }
      }
    }

    /** Resolve a content URI's human-readable display name. */
    fun queryDisplayName(context: android.content.Context, uri: Uri): String? {
      return try {
        context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) c.getString(0) else null
        }
      } catch (ex: Exception) {
        null
      }
    }

    /**
     * Copy a single content:// URI's bytes into `<filesDir>/imports/<relativePath>`,
     * returning the staged [StagedFile] or null on copy failure. Native-side copy
     * (like [stageFile] for folders) — no IPC byte transfer.
     */
    fun stageFileByUri(
      context: android.content.Context,
      uri: Uri,
      fileName: String,
      relativePath: String,
      importRoot: File,
    ): StagedFile? {
      val dest = uniqueDest(importRoot, relativePath)
      return try {
        context.contentResolver.openInputStream(uri)?.use { input ->
          FileOutputStream(dest).use { output ->
            input.copyTo(output)
          }
        } ?: return null
        StagedFile(
          path = dest.absolutePath,
          relativePath = relativePath,
          fileName = fileName,
        )
      } catch (ex: Exception) {
        Logger.error("Failed to stage $relativePath: ${ex.message}")
        null
      }
    }

    fun uniqueDest(importRoot: File, relativePath: String): File {
      val base = File(importRoot, relativePath)
      base.parentFile?.mkdirs()
      if (!base.exists()) return base
      val dot = relativePath.lastIndexOf('.')
      val stem = if (dot > 0) relativePath.substring(0, dot) else relativePath
      val ext = if (dot > 0) relativePath.substring(dot) else ""
      var i = 1
      while (true) {
        val candidate = File(importRoot, "$stem ($i)$ext")
        if (!candidate.exists()) return candidate
        i++
      }
    }

    // Must match DEFAULT_EXTENSIONS in src/lib.rs.
    private val DEFAULT_EXTENSIONS = arrayOf(
      "pdf", "epub", "md", "markdown", "txt", "html", "htm", "json",
      "mp3", "wav", "m4a", "m4b", "aac", "ogg", "flac", "opus", "wma",
      "mp4", "webm", "mov", "mkv", "avi", "m4v",
    )
  }

  override fun load(webView: android.webkit.WebView) {
    super.load(webView)
    Companion.webView = webView
  }

  @Command
  fun registerShareListener(invoke: Invoke) {
    isFrontendReady = true
    val response = JSObject()
    val url = pendingUrl
    if (url != null) {
      pendingUrl = null
      response.put("url", url)
    } else {
      response.put("url", null)
    }

    val batchesArr = JSArray()
    synchronized(pendingBatches) {
      for (b in pendingBatches) {
        batchesArr.put(b)
      }
      pendingBatches.clear()
    }
    response.put("batches", batchesArr)

    invoke.resolve(response)
  }

  @Command
  fun getPendingShares(invoke: Invoke) {
    val response = JSObject()
    val batchesArr = JSArray()
    synchronized(pendingBatches) {
      for (b in pendingBatches) {
        batchesArr.put(b)
      }
      pendingBatches.clear()
    }
    response.put("batches", batchesArr)
    invoke.resolve(response)
  }

  /** Extension allow-list captured while the picker is shown, applied on result. */
  private var pendingExtensions: Set<String> = emptySet()
  /** Whether the current file pick allows multiple selection. */
  private var pendingMultiple: Boolean = false
  /** Whether the current picker is picking a folder or files. */
  private var isFolderPick: Boolean = false

  @Command
  fun pickFolderDocuments(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PickFolderOptions::class.java)
      pendingExtensions = normalizeExtensions(args.extensions)
      isFolderPick = true

      // Persistable permission so re-picking later doesn't re-prompt; harmless
      // if the provider doesn't grant it.
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION
            or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        )
      }

      startActivityForResult(invoke, intent, "pickerResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to open folder picker"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /**
   * Pick one or more FILES (not a folder) via Android's Storage Access Framework
   * (ACTION_OPEN_DOCUMENT), copy each natively into `<filesDir>/imports/<name>`
   * — exactly like [stageFile] does for folder imports — and return the staged
   * filesystem paths. This is the mobile single-file/multi-file path: the copy
   * happens in native Kotlin with no bytes crossing the Tauri IPC (which on
   * Android is JSON-only and would hang/OOM on large files). Mirrors what native
   * audiobook players do.
   */
  @Command
  fun pickFiles(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PickFilesOptions::class.java)
      pendingExtensions = normalizeExtensions(args.extensions)
      pendingMultiple = args.multiple
      isFolderPick = false

      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        type = "*/*"
        if (pendingExtensions.isNotEmpty()) {
          // SAF matches EXTRA_MIME_TYPES against MIME; we also constrain by
          // extension after the pick. Allow any so files aren't greyed out.
          putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("*/*"))
        }
        if (args.multiple) {
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        addCategory(Intent.CATEGORY_OPENABLE)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      startActivityForResult(invoke, intent, "pickerResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to open file picker"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  private fun handleFilePickerResult(invoke: Invoke, result: androidx.activity.result.ActivityResult) {
    try {
      if (result.resultCode != Activity.RESULT_OK) {
        return invoke.reject("File picker cancelled")
      }
      val data = result.data
      val uris = mutableListOf<Uri>()
      if (data?.clipData != null) {
        val clip = data.clipData!!
        for (i in 0 until clip.itemCount) {
          uris.add(clip.getItemAt(i).uri)
        }
      } else {
        val singleUri = data?.data
        if (singleUri != null) {
          uris.add(singleUri)
        }
      }
      if (uris.isEmpty()) {
        return invoke.reject("File picker cancelled")
      }

      val importRoot = File(activity.filesDir, "imports")
      val staged = mutableListOf<StagedFile>()
      for (uri in uris) {
        val fileName = queryDisplayName(uri) ?: "file_${System.currentTimeMillis()}"
        // Enforce the extension allow-list post-pick (SAF may surface other types).
        if (!hasSupportedExtension(fileName)) continue
        stageFileByUri(uri, fileName, fileName, importRoot)?.let(staged::add)
      }

      if (staged.isEmpty()) {
        return invoke.reject("No supported files selected")
      }

      val arr = JSArray()
      for (f in staged) {
        val obj = JSObject()
        obj.put("path", f.path)
        obj.put("relativePath", f.relativePath)
        obj.put("fileName", f.fileName)
        arr.put(obj)
      }
      val out = JSObject()
      out.put("files", arr)
      invoke.resolve(out)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to import files"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    return Companion.queryDisplayName(activity, uri)
  }

  private fun stageFileByUri(
    uri: Uri,
    fileName: String,
    relativePath: String,
    importRoot: File,
  ): StagedFile? {
    return Companion.stageFileByUri(activity, uri, fileName, relativePath, importRoot)
  }

  private fun uniqueDest(importRoot: File, relativePath: String): File {
    return Companion.uniqueDest(importRoot, relativePath)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Rendered-DOM capture for the article-import fallback (offscreen WebView)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Capture a page's rendered DOM with a bare offscreen WebView.
   *
   * This WebView is NOT the Tauri webview and has no bridge/IPC — remote JS
   * gets zero app access. Stability detection mirrors the shared
   * script (stabilityScript.ts): wait for page load, sample
   * (nodes|textLen|images) every 250 ms via evaluateJavascript, capture after
   * 750 ms of no change, bounded by a 6 s post-load cap and the overall
   * timeout. The WebView is removed and destroyed in a guaranteed path on
   * success, failure, and timeout alike. Cancellation: the frontend aborts
   * by ignoring the result; the timeout here bounds the WebView's lifetime.
   */
  @Command
  fun captureRenderedDom(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(CaptureRenderedDomOptions::class.java)
    } catch (ex: Exception) {
      return invoke.reject("UNAVAILABLE: bad arguments: ${ex.message}")
    }
    val targetUrl = args.url ?: return invoke.reject("UNAVAILABLE: url is required")
    val timeoutMs = (args.timeoutMs ?: 20000).coerceIn(1000, 20000)

    captureSerialExecutor.execute {
      val latch = java.util.concurrent.CountDownLatch(1)
      val handler = android.os.Handler(android.os.Looper.getMainLooper())
      val startedAt = android.os.SystemClock.elapsedRealtime()

      handler.post {
        var webView: android.webkit.WebView? = null
        var finished = false
        var settled = false
        var lastSample: String? = null
        var stableSince = 0L
        var loadedAt = 0L

        fun finish(block: () -> Unit) {
          if (settled) return
          settled = true
          handler.removeCallbacksAndMessages(null)
          try {
            block()
          } finally {
            webView?.let { view ->
              (view.parent as? android.view.ViewGroup)?.removeView(view)
              try {
                view.destroy()
              } catch (ignored: Exception) {
              }
            }
            latch.countDown()
          }
        }

        try {
          webView = android.webkit.WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = true
            layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
            alpha = 0f
          }
          (activity.window.decorView as? android.view.ViewGroup)?.addView(webView)
            ?: run {
              finish { invoke.reject("UNAVAILABLE: no decor view to attach capture WebView") }
              return@post
            }

          val sampler = object : Runnable {
            override fun run() {
              if (settled) return
              val view = webView ?: return
              val now = android.os.SystemClock.elapsedRealtime()
              if (now - startedAt >= timeoutMs) {
                finish { invoke.reject("TIMEOUT: capture budget exceeded") }
                return
              }
              if (loadedAt > 0L && now - loadedAt > 6000L) {
                // Stabilization cap: proceed with the DOM as it stands.
                captureNow(view)
                return
              }
              view.evaluateJavascript(
                "(function(){try{return document.getElementsByTagName('*').length+'|'+(document.body?(document.body.innerText||'').length:0)+'|'+document.images.length}catch(e){return 'err'}})()"
              ) { value ->
                if (settled) return@evaluateJavascript
                if (value == lastSample) {
                  if (stableSince != 0L && android.os.SystemClock.elapsedRealtime() - stableSince >= 750L) {
                    captureNow(view)
                    return@evaluateJavascript
                  }
                } else {
                  lastSample = value
                  stableSince = android.os.SystemClock.elapsedRealtime()
                }
                handler.postDelayed(this, 250L)
              }
            }

            fun captureNow(view: android.webkit.WebView) {
              view.evaluateJavascript(
                "(function(){try{return location.href+'\\n'+'<!doctype html>'+document.documentElement.outerHTML}catch(e){return ''}})()"
              ) { encoded ->
                val payload = unquoteJsonString(encoded)
                if (payload.isNullOrBlank()) {
                  finish { invoke.reject("CAPTURE_FAILED: empty DOM capture") }
                } else {
                  val newline = payload.indexOf('\n')
                  val finalUrl = if (newline > 0) payload.substring(0, newline) else targetUrl
                  val html = if (newline > 0) payload.substring(newline + 1) else payload
                  val duration = android.os.SystemClock.elapsedRealtime() - startedAt
                  finish {
                    val res = JSObject()
                    res.put("html", html)
                    res.put("finalUrl", finalUrl)
                    res.put("durationMs", duration)
                    invoke.resolve(res)
                  }
                }
              }
            }
          }

          webView.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView?, url: String?) {
              if (finished || settled) return
              finished = true
              loadedAt = android.os.SystemClock.elapsedRealtime()
              handler.postDelayed(sampler, 250L)
            }

            @Deprecated("Deprecated in Java")
            override fun onReceivedError(
              view: android.webkit.WebView?,
              errorCode: Int,
              description: String?,
              failingUrl: String?
            ) {
              if (failingUrl == targetUrl || failingUrl == view?.url) {
                finish { invoke.reject("CAPTURE_FAILED: $description") }
              }
            }
          }

          webView.loadUrl(targetUrl)

          // Overall timeout watchdog.
          handler.postDelayed({
            finish { invoke.reject("TIMEOUT: capture budget exceeded") }
          }, timeoutMs.toLong())
        } catch (ex: Exception) {
          finish { invoke.reject("CAPTURE_FAILED: ${ex.message}") }
        }
      }

      // The executor thread waits so captures stay strictly single-flight.
      latch.await(timeoutMs + 2000L, java.util.concurrent.TimeUnit.MILLISECONDS)
    }
  }

  /** evaluateJavascript returns a JSON string literal (or null); decode it. */
  private fun unquoteJsonString(encoded: String?): String? {
    if (encoded == null) return null
    return try {
      val token = org.json.JSONTokener(encoded).nextValue()
      token?.toString()
    } catch (ex: Exception) {
      encoded
    }
  }

  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallApkOptions::class.java)
      val filePath = args.filePath
        ?: return invoke.reject("filePath is required")
      val apkFile = File(filePath)
      if (!apkFile.exists()) {
        return invoke.reject("APK file does not exist at: $filePath")
      }

      val context = activity.applicationContext

      // 1. Copy the APK to the external cache directory to make it readable by the system package installer.
      // System package installers on many Android variants (and OS versions 10+) are blocked from accessing
      // another app's private internal storage (/data/user/0/...) even when using FileProvider.
      val externalCacheDir = context.externalCacheDir
      val targetApkFile = if (externalCacheDir != null) {
        val destFile = File(externalCacheDir, "update.apk")
        try {
          apkFile.inputStream().use { input ->
            destFile.outputStream().use { output ->
              input.copyTo(output)
            }
          }
          destFile
        } catch (ex: Exception) {
          Logger.error("Failed to copy APK to external cache, using original: ${ex.message}")
          apkFile
        }
      } else {
        apkFile
      }

      // 2. Check and request install permissions on Android 8.0 (Oreo) and above
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
          // Open settings to let the user enable 'Install unknown apps' for this app
          val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${activity.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          activity.startActivity(intent)
          return invoke.reject("INSTALL_PERMISSION_REQUIRED")
        }
      }

      // 3. Generate secure FileProvider content URI
      val apkUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        targetApkFile
      )

      // 4. Fire package installer intent
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(apkUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("Failed to trigger installation: ${e.message}")
    }
  }


  @Command
  fun backupDbToDownloads(invoke: Invoke) {
    try {
      val context = activity.applicationContext
      // Current db filename first; the legacy incrementum.db is kept as a
      // fallback for one release (the app renames it on first open).
      var dbFile = File(context.filesDir, "plethora.db")
      if (!dbFile.exists()) {
        dbFile = File(context.filesDir, "incrementum.db")
      }
      if (!dbFile.exists()) {
        return invoke.reject("Database file does not exist at: ${dbFile.absolutePath}")
      }

      val resolver = context.contentResolver
      val contentValues = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, "Plethora_Backup_Auto.db")
        put(MediaStore.MediaColumns.MIME_TYPE, "application/x-sqlite3")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Plethora")
        }
      }

      val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        MediaStore.Downloads.EXTERNAL_CONTENT_URI
      } else {
        @Suppress("DEPRECATION")
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val plethoraDir = File(downloadsDir, "Plethora")
        plethoraDir.mkdirs()
        val destFile = File(plethoraDir, "Plethora_Backup_Auto.db")
        dbFile.inputStream().use { input ->
          destFile.outputStream().use { output ->
            input.copyTo(output)
          }
        }
        val res = JSObject()
        res.put("path", destFile.absolutePath)
        return invoke.resolve(res)
      }

      // Query if the file already exists in MediaStore and delete it to overwrite
      val projection = arrayOf(MediaStore.MediaColumns._ID)
      val selection = "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
      val selectionArgs = arrayOf("Plethora_Backup_Auto.db", Environment.DIRECTORY_DOWNLOADS + "/Plethora/")
      resolver.query(collection, projection, selection, selectionArgs, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
          val deleteUri = ContentUris.withAppendedId(collection, id)
          resolver.delete(deleteUri, null, null)
        }
      }

      val fileUri = resolver.insert(collection, contentValues)
        ?: return invoke.reject("Failed to insert media store record")

      resolver.openOutputStream(fileUri)?.use { outputStream ->
        dbFile.inputStream().use { inputStream ->
          inputStream.copyTo(outputStream)
        }
      }

      var pathResult = ""
      val pathProjection = arrayOf(MediaStore.MediaColumns.DATA)
      resolver.query(fileUri, pathProjection, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          pathResult = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)) ?: ""
        }
      }

      val res = JSObject()
      res.put("path", if (pathResult.isNotEmpty()) pathResult else "/sdcard/Download/Plethora/Plethora_Backup_Auto.db")
      invoke.resolve(res)
    } catch (e: Exception) {
      invoke.reject("Failed to backup database: ${e.message}")
    }
  }


  @ActivityCallback
  fun pickerResult(invoke: Invoke, result: androidx.activity.result.ActivityResult) {
    if (isFolderPick) {
      handleFolderPickerResult(invoke, result)
    } else {
      handleFilePickerResult(invoke, result)
    }
  }

  private fun handleFolderPickerResult(invoke: Invoke, result: androidx.activity.result.ActivityResult) {
    try {
      val data = result.data
      val treeUri: Uri = data?.data
        ?: return invoke.reject("Folder picker cancelled")
      if (result.resultCode != Activity.RESULT_OK) {
        return invoke.reject("Folder picker cancelled")
      }

      // Persist read access (best-effort).
      try {
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
        activity.contentResolver.takePersistableUriPermission(treeUri, flags)
      } catch (ignored: SecurityException) {
        // Some providers don't return persistable grants; non-fatal.
      }

      val root = DocumentFile.fromTreeUri(activity, treeUri)
        ?: return invoke.reject("Failed to access selected folder")

      val importRoot = File(activity.filesDir, "imports")
      val staged = mutableListOf<StagedFile>()

      // Walk the tree depth-first, preserving the subdirectory layout.
      walkAndStage(root, "", importRoot, staged)

      // Sort for stable ordering regardless of provider iteration order.
      staged.sortBy { it.relativePath }

      val arr = JSArray()
      for (f in staged) {
        val obj = JSObject()
        obj.put("path", f.path)
        obj.put("relativePath", f.relativePath)
        obj.put("fileName", f.fileName)
        arr.put(obj)
      }
      val out = JSObject()
      out.put("files", arr)
      invoke.resolve(out)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to import folder"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /**
   * Recursively walk [dir], copying each supported file into [importRoot] under
   * its [relativePath]. [prefix] is the directory path relative to the picked
   * tree root, built up as we descend.
   */
  private fun walkAndStage(
    dir: DocumentFile,
    prefix: String,
    importRoot: File,
    out: MutableList<StagedFile>,
  ) {
    for (child in dir.listFiles()) {
      val name = child.name ?: continue
      val childRel = if (prefix.isEmpty()) name else "$prefix/$name"
      if (child.isDirectory) {
        walkAndStage(child, childRel, importRoot, out)
      } else if (child.isFile && hasSupportedExtension(name)) {
        stageFile(child, name, childRel, importRoot)?.let(out::add)
      }
    }
  }

  /**
   * Copy one DocumentFile's bytes into `<filesDir>/imports/<relativePath>`,
   * returning the staged [StagedFile] or null on copy failure.
   */
  private fun stageFile(
    file: DocumentFile,
    fileName: String,
    relativePath: String,
    importRoot: File,
  ): StagedFile? {
    val dest = File(importRoot, relativePath).apply {
      parentFile?.mkdirs()
    }
    return try {
      activity.contentResolver.openInputStream(file.uri)?.use { input ->
        FileOutputStream(dest).use { output ->
          input.copyTo(output)
        }
      } ?: return null
      StagedFile(
        path = dest.absolutePath,
        relativePath = relativePath,
        fileName = fileName,
      )
    } catch (ex: Exception) {
      Logger.error("Failed to stage $relativePath: ${ex.message}")
      null
    }
  }

  private fun hasSupportedExtension(name: String): Boolean {
    val dot = name.lastIndexOf('.')
    if (dot < 0) return false
    val ext = name.substring(dot + 1).lowercase()
    return pendingExtensions.contains(ext)
  }

  private fun normalizeExtensions(raw: Array<String>?): Set<String> {
    val cleaned = raw
      ?.filter { it.isNotBlank() }
      ?.map { it.trimStart('.').lowercase() }
      ?.toHashSet()
      ?: emptySet()
    return cleaned.ifEmpty { DEFAULT_EXTENSIONS.toSet() }
  }


}
