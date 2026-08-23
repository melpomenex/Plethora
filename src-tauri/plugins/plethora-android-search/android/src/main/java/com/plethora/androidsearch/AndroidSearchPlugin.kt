package com.plethora.androidsearch

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.appsearch.app.AppSearchSchema
import androidx.appsearch.app.AppSearchSession
import androidx.appsearch.app.GenericDocument
import androidx.appsearch.app.PutDocumentsRequest
import androidx.appsearch.app.RemoveByDocumentIdRequest
import androidx.appsearch.app.SearchSpec
import androidx.appsearch.app.SetSchemaRequest
import androidx.appsearch.localstorage.LocalStorage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

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
 * displayedBySystem is never set true.
 */
object AppSearchPolicy {
    const val DISPLAYED_BY_SYSTEM = false
    const val DATABASE = "plethora-derived"
    const val SCHEMA_TYPE = "LibraryChunk"
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
    @Volatile
    private var session: AppSearchSession? = null

    @Command
    fun searchStatus(invoke: Invoke) {
        val ready = sessionOrNull() != null
        val o = JSObject()
        o.put("id", "search.semantic")
        o.put("available", ready)
        o.put("ready", ready)
        o.put("requiresDownload", false)
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", false)
        o.put("supportsStreaming", false)
        o.put("supportsImages", false)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", org.json.JSONArray())
        o.put("privacy", "on-device")
        o.put("reason", if (ready) "" else "feature_unavailable")
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
        val hits = searchHits(args.query.orEmpty(), args.k ?: 8, args.namespace)
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
            val namespace = args.namespace ?: "library"
            val text = args.text.orEmpty()
            val version = args.embeddingVersion
            DerivedIndex.upsert(id, namespace, text, version)
            putLocal(id, namespace, text, version)
        }
        invoke.resolve(JSObject())
    }

    @Command
    fun deleteDocument(invoke: Invoke) {
        val args = invoke.parseArgs(DeleteArgs::class.java)
        val id = args.id?.trim().orEmpty()
        if (id.isNotEmpty()) {
            DerivedIndex.delete(id)
            removeLocal(id)
        }
        invoke.resolve(JSObject())
    }

    @Command
    fun rebuildIndex(invoke: Invoke) {
        DerivedIndex.rebuild()
        try {
            sessionOrNull()?.setSchemaAsync(
                SetSchemaRequest.Builder()
                    .addSchemas(librarySchema())
                    .setForceOverride(true)
                    .build()
            )?.get(5, TimeUnit.SECONDS)
        } catch (e: Throwable) {
            Log.w("plethora-search", "rebuildIndex schema reset failed", e)
        }
        invoke.resolve(JSObject())
    }

    private fun searchHits(query: String, k: Int, namespace: String?): List<DerivedDocument> {
        val session = sessionOrNull() ?: return DerivedIndex.retrieve(query, k, namespace)
        return try {
            val spec = SearchSpec.Builder()
                .setTermMatch(SearchSpec.TERM_MATCH_PREFIX)
                .setResultCountPerPage(k.coerceAtLeast(0))
                .apply { if (namespace != null) addFilterNamespaces(namespace) }
                .build()
            val results = session.search(query, spec)
            val page = results.nextPageAsync.get(5, TimeUnit.SECONDS)
            page.map { hit ->
                val doc = hit.genericDocument
                DerivedDocument(
                    id = doc.id,
                    namespace = doc.namespace,
                    text = "",
                    embeddingVersion = null,
                )
            }
        } catch (e: Throwable) {
            Log.w("plethora-search", "AppSearch retrieve failed; using in-memory index", e)
            DerivedIndex.retrieve(query, k, namespace)
        }
    }

    private fun putLocal(id: String, namespace: String, text: String, embeddingVersion: String?) {
        val session = sessionOrNull() ?: return
        try {
            val document = GenericDocument.Builder<GenericDocument.Builder<*>>(
                namespace,
                id,
                AppSearchPolicy.SCHEMA_TYPE
            )
                .setPropertyString("body", text)
                .setPropertyString("embeddingVersion", embeddingVersion ?: "")
                .build()
            session.putAsync(PutDocumentsRequest.Builder().addGenericDocuments(document).build())
                .get(5, TimeUnit.SECONDS)
        } catch (e: Throwable) {
            Log.w("plethora-search", "AppSearch put failed", e)
        }
    }

    private fun removeLocal(id: String) {
        val session = sessionOrNull() ?: return
        try {
            session.removeAsync(
                RemoveByDocumentIdRequest.Builder("library").addIds(id).build()
            ).get(5, TimeUnit.SECONDS)
        } catch (e: Throwable) {
            Log.w("plethora-search", "AppSearch remove failed", e)
        }
    }

    private fun sessionOrNull(): AppSearchSession? {
        session?.let { return it }
        return try {
            val future = LocalStorage.createSearchSessionAsync(
                LocalStorage.SearchContext.Builder(activity, AppSearchPolicy.DATABASE).build()
            )
            val opened = future.get(8, TimeUnit.SECONDS)
            opened.setSchemaAsync(
                SetSchemaRequest.Builder()
                    .addSchemas(librarySchema())
                    .build()
            ).get(8, TimeUnit.SECONDS)
            session = opened
            opened
        } catch (e: Throwable) {
            Log.w("plethora-search", "AppSearch LocalStorage unavailable", e)
            null
        }
    }

    private fun librarySchema(): AppSearchSchema =
        AppSearchSchema.Builder(AppSearchPolicy.SCHEMA_TYPE)
            .addProperty(
                AppSearchSchema.StringPropertyConfig.Builder("body")
                    .setCardinality(AppSearchSchema.PropertyConfig.CARDINALITY_REQUIRED)
                    .setIndexingType(AppSearchSchema.StringPropertyConfig.INDEXING_TYPE_PREFIXES)
                    .setTokenizerType(AppSearchSchema.StringPropertyConfig.TOKENIZER_TYPE_PLAIN)
                    .build()
            )
            .addProperty(
                AppSearchSchema.StringPropertyConfig.Builder("embeddingVersion")
                    .setCardinality(AppSearchSchema.PropertyConfig.CARDINALITY_OPTIONAL)
                    .setIndexingType(AppSearchSchema.StringPropertyConfig.INDEXING_TYPE_NONE)
                    .build()
            )
            .setSchemaTypeDisplayedBySystem(AppSearchPolicy.DISPLAYED_BY_SYSTEM)
            .build()
}
