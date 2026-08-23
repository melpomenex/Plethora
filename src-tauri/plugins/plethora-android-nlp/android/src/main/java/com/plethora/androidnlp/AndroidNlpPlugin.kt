package com.plethora.androidnlp

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions

@InvokeArg
class IdentifyLanguageArgs {
    var text: String? = null
}

@InvokeArg
class TranslateSentenceArgs {
    var text: String? = null
    var sourceLanguage: String? = null
    var targetLanguage: String? = null
}

@TauriPlugin
class AndroidNlpPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun languageIdStatus(invoke: Invoke) {
        invoke.resolve(cap("language.identify", true))
    }

    @Command
    fun identifyLanguage(invoke: Invoke) {
        val text = invoke.parseArgs(IdentifyLanguageArgs::class.java).text.orEmpty()
        if (text.isBlank()) {
            val o = JSObject()
            o.put("language", "und")
            o.put("confidence", 0)
            invoke.resolve(o)
            return
        }
        LanguageIdentification.getClient().identifyLanguage(text)
            .addOnSuccessListener { code ->
                val o = JSObject()
                o.put("language", if (code == "und") "und" else code)
                invoke.resolve(o)
            }
            .addOnFailureListener { e ->
                invoke.reject(e.message ?: "language id failed", "inference_failed")
            }
    }

    @Command
    fun translateSentence(invoke: Invoke) {
        val args = invoke.parseArgs(TranslateSentenceArgs::class.java)
        val text = args.text.orEmpty()
        val source = langTag(args.sourceLanguage ?: "en")
        val target = langTag(args.targetLanguage ?: "es")
        if (source == null || target == null) {
            invoke.reject("unsupported language tag", "invalid_argument")
            return
        }
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(source)
            .setTargetLanguage(target)
            .build()
        val translator = Translation.getClient(options)
        translator.downloadModelIfNeeded()
            .continueWithTask { translator.translate(text) }
            .addOnSuccessListener { translated ->
                val o = JSObject()
                o.put("translatedText", translated)
                invoke.resolve(o)
            }
            .addOnFailureListener { e ->
                invoke.reject(e.message ?: "translate failed", "inference_failed")
            }
    }

    private fun langTag(tag: String): String? {
        return when (tag.lowercase().substringBefore('-')) {
            "en" -> TranslateLanguage.ENGLISH
            "es" -> TranslateLanguage.SPANISH
            "fr" -> TranslateLanguage.FRENCH
            "de" -> TranslateLanguage.GERMAN
            "ja" -> TranslateLanguage.JAPANESE
            "zh" -> TranslateLanguage.CHINESE
            else -> null
        }
    }

    private fun cap(id: String, ready: Boolean): JSObject {
        val o = JSObject()
        o.put("id", id)
        o.put("available", true)
        o.put("ready", ready)
        o.put("requiresDownload", id == "translate.sentence")
        o.put("onDevice", true)
        o.put("networkRequired", false)
        o.put("foregroundOnly", false)
        o.put("supportsStreaming", false)
        o.put("supportsImages", false)
        o.put("supportsStructuredOutput", false)
        o.put("supportedLanguages", org.json.JSONArray().put("en"))
        o.put("privacy", "on-device")
        return o
    }
}
