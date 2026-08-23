package com.plethora.androidsearch

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class RetrieveArgs {
    var query: String? = null
    var k: Int? = null
    var namespace: String? = null
    var enabled: Boolean? = null
}

@InvokeArg
class UpsertArgs {
    var id: String? = null
    var namespace: String? = null
    var text: String? = null
    var embeddingVersion: String? = null
}

@InvokeArg
class DeleteArgs {
    var id: String? = null
}

/**
 * Derived AppSearch index. Default off — SQLite / ai_learning is source of truth.
 * displayedBySystem is never set true. In-memory until LocalStorage is wired.
 */
object AppSearchPolicy {
    const val DISPLAYED_BY_SYSTEM = false
    fun enabled(flag: Boolean?): Boolean = flag == true
}

data class DerivedDocument(
    val id: String,
    val namespace: String,
    val text: String,
    val embeddingVersion: String?,
)

object DerivedIndex {
    private val docs = ConcurrentHashMap<String, DerivedDocument>()

    fun upsert(id: String, namespace: String, text: String, embeddingVersion: String?) {
        docs[id] = DerivedDocument(id, namespace, text, embeddingVersion)
    }

    fun delete(id: String) {
        docs.remove(id)
    }

    fun rebuild() {
        docs.clear()
    }

    fun retrieve(query: String, k: Int, namespace: String?): List<DerivedDocument> {
        val needle = query.lowercase()
        return docs.values
            .asSequence()
            .filter { namespace == null || it.namespace == namespace }
            .filter { it.text.lowercase().contains(needle) }
            .take(k.coerceAtLeast(0))
            .toList()
    }
}

@TauriPlugin
class AndroidSearchPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun searchStatus(invoke: Invoke) {
        val o = JSObject()
        o.put("id", "search.semantic")
        o.put("available", false)
        o.put("ready", false)
        o.put("requiresDownload", false)
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", false)
        o.put("supportsStreaming", false)
        o.put("supportsImages", false)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", org.json.JSONArray())
        o.put("privacy", "on-device")
        o.put("reason", "feature_unavailable")
        o.put("displayedBySystem", AppSearchPolicy.DISPLAYED_BY_SYSTEM)
        invoke.resolve(o)
    }

    @Command
    fun retrieve(invoke: Invoke) {
        val args = invoke.parseArgs(RetrieveArgs::class.java)
        if (!AppSearchPolicy.enabled(args.enabled)) {
            invoke.resolve(JSArray())
            return
        }
        val hits = DerivedIndex.retrieve(args.query.orEmpty(), args.k ?: 8, args.namespace)
        val out = JSArray()
        hits.forEach { doc ->
            val o = JSObject()
            o.put("id", doc.id)
            o.put("namespace", doc.namespace)
            out.put(o)
        }
        invoke.resolve(out)
    }

    @Command
    fun upsertDocument(invoke: Invoke) {
        val args = invoke.parseArgs(UpsertArgs::class.java)
        val id = args.id?.trim().orEmpty()
        if (id.isNotEmpty()) {
            DerivedIndex.upsert(id, args.namespace ?: "library", args.text.orEmpty(), args.embeddingVersion)
        }
        invoke.resolve(JSObject())
    }

    @Command
    fun deleteDocument(invoke: Invoke) {
        val args = invoke.parseArgs(DeleteArgs::class.java)
        args.id?.trim()?.takeIf { it.isNotEmpty() }?.let { DerivedIndex.delete(it) }
        invoke.resolve(JSObject())
    }

    @Command
    fun rebuildIndex(invoke: Invoke) {
        DerivedIndex.rebuild()
        invoke.resolve(JSObject())
    }
}
