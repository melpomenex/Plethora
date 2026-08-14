// Copyright 2026 Incrementum
// SPDX-License-Identifier: Apache-2.0
//
// Android Tauri plugin for on-device generative AI via ML Kit GenAI
// (Gemini Nano through the system AICore service).
//
// Four commands, matching the Rust shim in ../../../../src/lib.rs:
//   - checkStatus    -> available | downloadable | downloading | unavailable
//   - summarizeText  -> ML Kit Summarization (bullets) / Prompt API (prose)
//   - generatePrompt -> ML Kit Prompt API, free-form completion
//   - downloadModel  -> user-initiated AICore model download
//
// Nothing here chunks text. The TypeScript side (src/lib/ai/chunkTextByTokens)
// owns the context budget and never sends more than one chunk per call; this
// plugin passes input straight through so native-side truncation never silently
// hides a caller bug.
//
// Threading: ML Kit returns Guava ListenableFutures. Every command dispatches to
// a background executor and blocks there, then resolves/rejects the Invoke.
// Inference runs on a *single* thread so two concurrent summarize/prompt calls
// queue instead of contending for the one on-device model; status checks use a
// separate thread so a long inference never stalls the UI's availability poll.

package com.incrementum.androidgenai

import android.app.Activity
import android.content.Context
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.genai.common.DownloadCallback
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.common.StreamingCallback
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.Candidate
import com.google.mlkit.genai.prompt.GenerateContentRequest
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.PromptPrefix
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures
import com.google.mlkit.genai.summarization.Summarization
import com.google.mlkit.genai.summarization.SummarizationRequest
import com.google.mlkit.genai.summarization.Summarizer
import com.google.mlkit.genai.summarization.SummarizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ExecutionException
import java.util.concurrent.Future
import java.util.concurrent.ThreadLocalRandom
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

// ──────────────────────────────────────────────────────────────────────────
// Invoke argument DTOs. Field names are camelCase to match the JSON payloads
// the Rust shim forwards via run_mobile_plugin.
// ──────────────────────────────────────────────────────────────────────────

@InvokeArg
class SummarizeArgs {
    var text: String? = null

    /** "paragraph" | "bullets". Defaults to "paragraph" when absent. */
    var format: String? = null
}

@InvokeArg
class PromptArgs {
    var prompt: String? = null
}

/** Reserved image envelope; decoding and bounds are implemented in section 10. */
class PromptImageArgs {
    var mimeType: String? = null
    var data: String? = null
}

@InvokeArg
class NativePromptArgs {
    var requestId: String? = null
    var text: String? = null
    var promptPrefix: String? = null
    var image: PromptImageArgs? = null
    var temperature: Float? = null
    var seed: Int? = null
    var maxOutputTokens: Int? = null
    var candidateCount: Int? = null
    var outputMode: String? = null
    var systemInstruction: String? = null
    var stream: Boolean? = null
}

@InvokeArg
class CancelPromptArgs {
    var requestId: String? = null
}

internal data class PromptCandidateDto(
    val text: String,
    val finishReason: String?
)

internal data class NativePromptResponseDto(
    val requestId: String,
    val text: String,
    val finishReason: String?,
    val inputTokens: Int,
    val tokenLimit: Int,
    val baseModelName: String?,
    val candidates: List<PromptCandidateDto>,
    val structured: Any? = null
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("requestId", requestId)
        put("text", text)
        finishReason?.let { put("finishReason", it) }
        put("inputTokens", inputTokens)
        put("tokenLimit", tokenLimit)
        baseModelName?.let { put("baseModelName", it) }
        put(
            "candidates",
            JSONArray().apply {
                candidates.forEach { candidate ->
                    put(JSObject().apply {
                        put("text", candidate.text)
                        candidate.finishReason?.let { put("finishReason", it) }
                    })
                }
            }
        )
        structured?.let { put("structured", it) }
    }
}

internal data class PromptTokenCountDto(
    val requestId: String,
    val inputTokens: Int,
    val tokenLimit: Int,
    val requestedOutputTokens: Int
)

internal data class PromptStartReceiptDto(
    val requestId: String,
    val queued: Boolean
)

internal data class PromptCancelReceiptDto(
    val requestId: String,
    val cancelled: Boolean
)

@InvokeArg
class DownloadArgs {
    /** "all" | "prompt" | "summarization" | "image-prompt". */
    var feature: String? = null
}

/**
 * Machine-readable error codes returned via `invoke.reject(message, code)`.
 * The TypeScript SDK matches on these; they are part of the plugin's contract.
 */
private object ErrorCode {
    /** The device or Play Services build has no on-device GenAI at all. */
    const val DEVICE_UNSUPPORTED = "device_unsupported"

    /** Feature exists but the model is not on the device yet. */
    const val MODEL_DOWNLOADABLE = "model_downloadable"

    /** AICore is downloading the model right now. */
    const val MODEL_DOWNLOADING = "model_downloading"

    /** Status was not AVAILABLE for a reason we could not classify further. */
    const val MODEL_UNAVAILABLE = "model_unavailable"

    /** The model ran but the call failed. */
    const val INFERENCE_FAILED = "inference_failed"

    /** The model ran and returned nothing usable. */
    const val EMPTY_OUTPUT = "empty_output"

    /** Caller sent a blank/missing argument. */
    const val INVALID_ARGUMENT = "invalid_argument"

    /** The selected native build does not include this progressive feature. */
    const val FEATURE_NOT_COMPILED = "feature_not_compiled"

    /** The selected device/runtime does not advertise an optional feature. */
    const val FEATURE_UNAVAILABLE = "feature_unavailable"

    /** The measured input plus reserved output exceeds the runtime limit. */
    const val CONTEXT_TOO_LARGE = "context_too_large"

    /** A structured result stopped before a complete payload was produced. */
    const val INCOMPLETE_OUTPUT = "incomplete_output"

    /** The bounded native FIFO cannot accept another inference. */
    const val QUEUE_FULL = "queue_full"

    /** AICore is temporarily serving another client. */
    const val BUSY = "busy"

    /** Per-app AICore battery quota is exhausted. */
    const val BATTERY_QUOTA_EXCEEDED = "battery_quota_exceeded"

    /** Foreground-only inference was attempted while backgrounded. */
    const val BACKGROUND_USE_BLOCKED = "background_use_blocked"

    /** Native safety controls rejected the input or completion. */
    const val SAFETY_BLOCKED = "safety_blocked"

    /** Image bytes could not be accepted by ML Kit. */
    const val INVALID_IMAGE = "invalid_image"

    /** Queued or active work was explicitly cancelled. */
    const val CANCELLED = "cancelled"
}

/** Serialized status strings shared with the Rust and TypeScript layers. */
private object StatusName {
    const val AVAILABLE = "available"
    const val DOWNLOADABLE = "downloadable"
    const val DOWNLOADING = "downloading"
    const val UNAVAILABLE = "unavailable"
}

/** A single independently routable ML Kit feature state. */
internal data class FeatureStateDto(
    val status: String,
    val reason: String? = null
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("status", status)
        reason?.let { put("reason", it) }
    }
}

/** Optional Prompt features negotiated independently from base availability. */
internal data class PromptFeatureFlagsDto(
    val structuredOutputCompiled: Boolean,
    val structuredOutput: Boolean,
    val systemInstructions: Boolean,
    val prefixCaching: Boolean,
    val imageInput: Boolean,
    val multiImage: Boolean,
    val streaming: Boolean
)

/** Complete native capability payload returned to Rust. */
internal data class CapabilitySnapshotDto(
    val prompt: FeatureStateDto,
    val summarization: FeatureStateDto,
    val imagePrompt: FeatureStateDto,
    val features: PromptFeatureFlagsDto,
    val baseModelName: String? = null,
    val tokenLimit: Int? = null,
    val checkedAt: Long = System.currentTimeMillis()
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("prompt", prompt.toJsObject())
        put("summarization", summarization.toJsObject())
        put("imagePrompt", imagePrompt.toJsObject())
        put("structuredOutputCompiled", features.structuredOutputCompiled)
        put("structuredOutput", features.structuredOutput)
        put("systemInstructions", features.systemInstructions)
        put("prefixCaching", features.prefixCaching)
        put("imageInput", features.imageInput)
        put("multiImage", features.multiImage)
        put("streaming", features.streaming)
        baseModelName?.let { put("baseModelName", it) }
        tokenLimit?.let { put("tokenLimit", it) }
        put("checkedAt", checkedAt)
    }
}

/** Pure status mapping kept outside the plugin so JVM unit tests need no Activity. */
internal fun featureStateForStatus(status: Int): FeatureStateDto = when (status) {
    FeatureStatus.AVAILABLE -> FeatureStateDto(StatusName.AVAILABLE)
    FeatureStatus.DOWNLOADABLE ->
        FeatureStateDto(StatusName.DOWNLOADABLE, ErrorCode.MODEL_DOWNLOADABLE)
    FeatureStatus.DOWNLOADING ->
        FeatureStateDto(StatusName.DOWNLOADING, ErrorCode.MODEL_DOWNLOADING)
    else -> FeatureStateDto(StatusName.UNAVAILABLE, ErrorCode.DEVICE_UNSUPPORTED)
}

internal fun unavailableFeature(reason: String): FeatureStateDto =
    FeatureStateDto(StatusName.UNAVAILABLE, reason)

/** Pure optional-feature negotiation for deterministic JVM tests. */
internal fun negotiatePromptFeatures(
    promptAvailable: Boolean,
    structuredOutputCompiled: Boolean,
    structuredOutputAvailable: Boolean,
    systemInstructionsAvailable: Boolean,
    prefixCachingAvailable: Boolean,
    imagePromptCompiled: Boolean,
    multiImageCompiled: Boolean,
    streamingCompiled: Boolean
): PromptFeatureFlagsDto = PromptFeatureFlagsDto(
    structuredOutputCompiled = structuredOutputCompiled,
    structuredOutput =
        promptAvailable && structuredOutputCompiled && structuredOutputAvailable,
    systemInstructions = promptAvailable && systemInstructionsAvailable,
    prefixCaching = promptAvailable && prefixCachingAvailable,
    imageInput = promptAvailable && imagePromptCompiled,
    multiImage = promptAvailable && imagePromptCompiled && multiImageCompiled,
    streaming = promptAvailable && streamingCompiled
)

internal fun finishReasonName(reason: Int?): String? = when (reason) {
    Candidate.FinishReason.STOP -> "stop"
    Candidate.FinishReason.MAX_TOKENS -> "max_tokens"
    Candidate.FinishReason.OTHER -> "other"
    null -> null
    else -> "other"
}

internal fun isStructuredOutputMode(mode: String?): Boolean = when (mode ?: OUTPUT_MODE_TEXT) {
    "flashcards", "tags", "occlusions" -> true
    else -> false
}

internal fun promptArgsValidationError(args: NativePromptArgs): String? {
    if (args.requestId.isNullOrBlank()) return "requestId is required"
    if (args.text.isNullOrBlank()) return "text is required"
    args.temperature?.let {
        if (!it.isFinite() || it < 0f || it > 2f) return "temperature must be between 0 and 2"
    }
    args.candidateCount?.let {
        if (it !in 1..8) return "candidateCount must be between 1 and 8"
    }
    args.maxOutputTokens?.let {
        if (it !in 1..4096) return "maxOutputTokens must be between 1 and 4096"
    }
    if ((args.outputMode ?: OUTPUT_MODE_TEXT) !in OUTPUT_MODES) {
        return "unsupported outputMode"
    }
    return null
}

internal fun exceedsTokenBudget(
    inputTokens: Int,
    requestedOutputTokens: Int,
    tokenLimit: Int
): Boolean = inputTokens.toLong() + requestedOutputTokens.toLong() > tokenLimit.toLong()

private const val OUTPUT_MODE_TEXT = "text"
private val OUTPUT_MODES = setOf(OUTPUT_MODE_TEXT, "flashcards", "tags", "occlusions")

private class PromptContractException(
    val errorCode: String,
    message: String,
    val metadata: JSObject? = null
) : Exception(message)

internal enum class StreamEnqueueResult { ACCEPTED, DUPLICATE, FULL }
internal enum class StreamCancelState { QUEUED, ACTIVE, MISSING }

internal data class StreamCancelOutcome(
    val state: StreamCancelState,
    val future: Future<*>? = null
)

/**
 * Thread-safe, bounded FIFO bookkeeping for streaming inference. The worker is
 * still the plugin's single inference executor; this registry adds removal,
 * real-future cancellation, and a terminal gate that an executor queue alone
 * cannot provide.
 */
internal class StreamRequestRegistry<T>(private val maxEntries: Int) {
    private enum class State { QUEUED, ACTIVE }
    private data class Record<T>(
        val payload: T,
        var state: State,
        var future: Future<*>? = null
    )

    private val queue = java.util.ArrayDeque<String>()
    private val records = mutableMapOf<String, Record<T>>()
    private var activeId: String? = null

    init {
        require(maxEntries > 0) { "maxEntries must be positive" }
    }

    @Synchronized
    fun enqueue(requestId: String, payload: T): StreamEnqueueResult {
        if (requestId in records || requestId == activeId) return StreamEnqueueResult.DUPLICATE
        if (records.size >= maxEntries) return StreamEnqueueResult.FULL
        records[requestId] = Record(payload, State.QUEUED)
        queue.addLast(requestId)
        return StreamEnqueueResult.ACCEPTED
    }

    @Synchronized
    fun activateNext(): Pair<String, T>? {
        if (activeId != null) return null
        while (queue.isNotEmpty()) {
            val requestId = queue.removeFirst()
            val record = records[requestId] ?: continue
            record.state = State.ACTIVE
            activeId = requestId
            return requestId to record.payload
        }
        return null
    }

    @Synchronized
    fun attachFuture(requestId: String, future: Future<*>): Boolean {
        val record = records[requestId]
        if (record == null || record.state != State.ACTIVE || activeId != requestId) return false
        record.future = future
        return true
    }

    @Synchronized
    fun isActive(requestId: String): Boolean =
        activeId == requestId && records[requestId]?.state == State.ACTIVE

    /** Claim the only worker-owned terminal event for this request. */
    @Synchronized
    fun claimTerminal(requestId: String): Boolean {
        val record = records[requestId] ?: return false
        if (record.state != State.ACTIVE || activeId != requestId) return false
        records.remove(requestId)
        activeId = null
        (this as java.lang.Object).notifyAll()
        return true
    }

    /** Cancellation owns the terminal event and removes the live record. */
    @Synchronized
    fun cancel(requestId: String): StreamCancelOutcome {
        val record = records.remove(requestId)
            ?: return StreamCancelOutcome(StreamCancelState.MISSING)
        return when (record.state) {
            State.QUEUED -> {
                queue.remove(requestId)
                (this as java.lang.Object).notifyAll()
                StreamCancelOutcome(StreamCancelState.QUEUED)
            }
            State.ACTIVE -> {
                // Keep activeId occupied until the worker observes cancellation
                // and leaves; the next model call must not overlap it.
                (this as java.lang.Object).notifyAll()
                StreamCancelOutcome(StreamCancelState.ACTIVE, record.future)
            }
        }
    }

    /** Always called by the worker, including after cancellation or teardown. */
    @Synchronized
    fun releaseWorker(requestId: String) {
        records.remove(requestId)
        if (activeId == requestId) activeId = null
        (this as java.lang.Object).notifyAll()
    }

    /** Wait for retry delay, waking immediately when the request is cancelled. */
    @Synchronized
    fun awaitActive(requestId: String, delayMs: Long): Boolean {
        if (!isActive(requestId)) return false
        (this as java.lang.Object).wait(delayMs)
        return isActive(requestId)
    }

    @Synchronized
    fun cancelAll(): List<Future<*>> {
        val futures = records.values.mapNotNull { it.future }
        records.clear()
        queue.clear()
        activeId = null
        (this as java.lang.Object).notifyAll()
        return futures
    }

    @Synchronized
    fun size(): Int = records.size
}

/** Stable app error code for an ML Kit error code/message pair. */
internal fun mapGenAiErrorCode(errorCode: Int, message: String?): String {
    if (message?.contains("safety", ignoreCase = true) == true) return ErrorCode.SAFETY_BLOCKED
    return when (errorCode) {
        GenAiException.ErrorCode.BUSY -> ErrorCode.BUSY
        GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED ->
            ErrorCode.BATTERY_QUOTA_EXCEEDED
        GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED -> ErrorCode.BACKGROUND_USE_BLOCKED
        GenAiException.ErrorCode.CANCELLED -> ErrorCode.CANCELLED
        GenAiException.ErrorCode.REQUEST_TOO_LARGE -> ErrorCode.CONTEXT_TOO_LARGE
        GenAiException.ErrorCode.INVALID_INPUT_IMAGE -> ErrorCode.INVALID_IMAGE
        GenAiException.ErrorCode.NOT_AVAILABLE,
        GenAiException.ErrorCode.NOT_SUPPORTED,
        GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE,
        GenAiException.ErrorCode.AICORE_INCOMPATIBLE -> ErrorCode.MODEL_UNAVAILABLE
        else -> ErrorCode.INFERENCE_FAILED
    }
}

/** Delay after a busy failure, or null when the retry budget is exhausted. */
internal fun busyRetryDelayMs(failedAttempt: Int, jitterUnit: Double): Long? {
    if (failedAttempt !in 0 until MAX_BUSY_RETRIES) return null
    val boundedJitter = jitterUnit.coerceIn(0.0, 1.0)
    val exponential = (BUSY_RETRY_BASE_MS * (1L shl failedAttempt))
        .coerceAtMost(BUSY_RETRY_MAX_MS)
    return (exponential * (0.75 + boundedJitter * 0.5)).toLong()
}

private const val STREAM_QUEUE_CAPACITY = 8
private const val MAX_BUSY_RETRIES = 3
private const val BUSY_RETRY_BASE_MS = 200L
private const val BUSY_RETRY_MAX_MS = 1_600L
private const val STREAM_EVENT_TEXT = "ondevice-genai://text"
private const val STREAM_EVENT_COMPLETE = "ondevice-genai://complete"
private const val STREAM_EVENT_ERROR = "ondevice-genai://error"
private const val STREAM_EVENT_RETRY = "ondevice-genai://retry"

@TauriPlugin
class AndroidGenAiPlugin(private val activity: Activity) : Plugin(activity) {

    private val ctx: Context get() = activity.applicationContext

    /**
     * One inference at a time. ML Kit's clients are themselves reusable across
     * calls, but the underlying AICore model is a single shared resource — and
     * a single-threaded executor is the cheapest way to guarantee two commands
     * never interleave on it.
     */
    private val inferenceExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "incrementum-genai-inference").apply { isDaemon = true }
    }

    /** Status checks must not queue behind a multi-second inference. */
    private val statusExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "incrementum-genai-status").apply { isDaemon = true }
    }

    // Clients are created lazily on first use and reused; construction touches
    // Play Services, so doing it eagerly in the constructor would cost startup
    // time on every device including those with no GenAI support at all.
    // Guarded by `clientLock` because status and inference run on two threads.
    private val clientLock = Any()
    private var summarizerBullets: Summarizer? = null
    private var promptModel: GenerativeModel? = null
    private var promptFutures: GenerativeModelFutures? = null
    private var closed = false
    private val streamRegistry = StreamRequestRegistry<NativePromptArgs>(STREAM_QUEUE_CAPACITY)

    private fun summarizer(): Summarizer = synchronized(clientLock) {
        check(!closed) { "plugin torn down" }
        summarizerBullets ?: Summarization.getClient(
            SummarizerOptions.builder(ctx)
                .setInputType(SummarizerOptions.InputType.ARTICLE)
                // ML Kit's Summarizer only emits bullet output types; prose is
                // produced through the Prompt API instead (see summarizeText).
                .setOutputType(SummarizerOptions.OutputType.THREE_BULLETS)
                .setLanguage(SummarizerOptions.Language.ENGLISH)
                // The TypeScript layer chunks to the budget before calling, so
                // native truncation would only ever mask a caller bug.
                .setLongInputAutoTruncationEnabled(false)
                .build()
        ).also { summarizerBullets = it }
    }

    private fun prompt(): GenerativeModelFutures = synchronized(clientLock) {
        check(!closed) { "plugin torn down" }
        promptFutures ?: run {
            val model = Generation.getClient()
            promptModel = model
            GenerativeModelFutures.from(model).also { promptFutures = it }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Commands
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Report on-device GenAI status. Never throws and never starts a download:
     * any failure is reported as `unavailable` with a machine-readable reason,
     * because "we could not tell" and "this device cannot" are the same thing
     * from the caller's point of view.
     */
    @Command
    fun checkStatus(invoke: Invoke) {
        statusExecutor.execute {
            val result = JSObject()
            try {
                // Compatibility wrapper for the first bridge contract. New
                // callers use getCapabilities(), which never collapses these
                // states. Keeping this wrapper avoids breaking old call sites
                // while they migrate.
                val snapshot = capabilitySnapshot()
                val combined = legacyCombinedState(snapshot)
                result.put("status", combined.status)
                // Runtime-visible build capability. A later per-feature check
                // combines this with ML Kit's device capability; this flag
                // alone never claims the current device supports the feature.
                result.put(
                    "structuredOutputCompiled",
                    BuildConfig.STRUCTURED_OUTPUT_COMPILED
                )
                combined.reason?.let { result.put("reason", it) }
                invoke.resolve(result)
            } catch (e: Throwable) {
                // Every failure here means the same thing to the caller: no
                // on-device AI right now. A GenAiException, a missing Play
                // Services GenAI module (NoClassDefFoundError), and an AICore
                // that refuses to answer are indistinguishable and equally
                // final, so they all report `device_unsupported` rather than
                // throwing.
                Logger.error("genai", "checkStatus failed", e)
                result.put("status", StatusName.UNAVAILABLE)
                result.put("reason", ErrorCode.DEVICE_UNSUPPORTED)
                result.put(
                    "structuredOutputCompiled",
                    BuildConfig.STRUCTURED_OUTPUT_COMPILED
                )
                invoke.resolve(result)
            }
        }
    }

    /** Return independently usable feature states and optional Prompt metadata. */
    @Command
    fun getCapabilities(invoke: Invoke) {
        statusExecutor.execute {
            // capabilitySnapshot isolates each native read, so this command
            // resolves even if one adapter or optional metadata call fails.
            invoke.resolve(capabilitySnapshot().toJsObject())
        }
    }

    /** Execute one configured, non-streaming Prompt request. */
    @Command
    fun generateConfiguredPrompt(invoke: Invoke) {
        val args = invoke.parseArgs(NativePromptArgs::class.java)
        promptArgsValidationError(args)?.let {
            invoke.reject(it, ErrorCode.INVALID_ARGUMENT)
            return
        }
        if (args.stream == true) {
            invoke.reject(
                "streaming requests must use the start command",
                ErrorCode.INVALID_ARGUMENT
            )
            return
        }

        inferenceExecutor.execute {
            try {
                invoke.resolveObject(executePrompt(args))
            } catch (e: PromptContractException) {
                invoke.reject(e.message, e.errorCode, e.metadata)
            } catch (e: Throwable) {
                rejectInference(invoke, "generateConfiguredPrompt", e)
            }
        }
    }

    /** Count the complete configured request without starting inference. */
    @Command
    fun countPromptTokens(invoke: Invoke) {
        val args = invoke.parseArgs(NativePromptArgs::class.java)
        promptArgsValidationError(args)?.let {
            invoke.reject(it, ErrorCode.INVALID_ARGUMENT)
            return
        }

        inferenceExecutor.execute {
            try {
                val request = buildPromptRequest(args)
                val inputTokens = prompt().countTokens(request).get().totalTokens
                val tokenLimit = prompt().getTokenLimit().get()
                invoke.resolveObject(
                    PromptTokenCountDto(
                        requestId = requireNotNull(args.requestId),
                        inputTokens = inputTokens,
                        tokenLimit = tokenLimit,
                        requestedOutputTokens = request.maxOutputTokens
                    )
                )
            } catch (e: PromptContractException) {
                invoke.reject(e.message, e.errorCode, e.metadata)
            } catch (e: Throwable) {
                rejectInference(invoke, "countPromptTokens", e)
            }
        }
    }

    /** Explicit foreground warm-up; performs no generation. */
    @Command
    fun warmUpPrompt(invoke: Invoke) {
        inferenceExecutor.execute {
            try {
                prompt().warmup().get()
                invoke.resolve()
            } catch (e: Throwable) {
                rejectInference(invoke, "warmUpPrompt", e)
            }
        }
    }

    /** Enqueue one request-scoped streaming Prompt run and acknowledge quickly. */
    @Command
    fun startPromptStream(invoke: Invoke) {
        val args = invoke.parseArgs(NativePromptArgs::class.java)
        promptArgsValidationError(args)?.let {
            invoke.reject(it, ErrorCode.INVALID_ARGUMENT)
            return
        }
        args.stream = true
        val requestId = requireNotNull(args.requestId)
        when (streamRegistry.enqueue(requestId, args)) {
            StreamEnqueueResult.DUPLICATE -> {
                invoke.reject("requestId is already active or queued", ErrorCode.INVALID_ARGUMENT)
                return
            }
            StreamEnqueueResult.FULL -> {
                invoke.reject("on-device inference queue is full", ErrorCode.QUEUE_FULL)
                return
            }
            StreamEnqueueResult.ACCEPTED -> Unit
        }

        // The initiating Invoke is only an enqueue receipt. Text and the sole
        // terminal result are delivered through plugin listener events.
        invoke.resolveObject(PromptStartReceiptDto(requestId, queued = true))
        inferenceExecutor.execute { drainStreamQueue() }
    }

    /** Cancel queued work or the actual ML Kit future for an active request. */
    @Command
    fun cancelPromptRequest(invoke: Invoke) {
        val args = invoke.parseArgs(CancelPromptArgs::class.java)
        val requestId = args.requestId?.takeIf { it.isNotBlank() }
        if (requestId == null) {
            invoke.reject("requestId is required", ErrorCode.INVALID_ARGUMENT)
            return
        }

        val outcome = streamRegistry.cancel(requestId)
        val cancelled = outcome.state != StreamCancelState.MISSING
        if (cancelled) {
            outcome.future?.cancel(true)
            emitStreamError(requestId, ErrorCode.CANCELLED, "on-device request cancelled")
        }
        invoke.resolveObject(PromptCancelReceiptDto(requestId, cancelled))
    }

    /**
     * Summarize a single chunk of text.
     *
     * `format = "bullets"` uses ML Kit's Summarization API. `format =
     * "paragraph"` goes through the Prompt API: SummarizerOptions.OutputType
     * offers only ONE_BULLET / TWO_BULLETS / THREE_BULLETS, so there is no prose
     * output type to ask for.
     */
    @Command
    fun summarizeText(invoke: Invoke) {
        val args = invoke.parseArgs(SummarizeArgs::class.java)
        val text = args.text?.takeIf { it.isNotBlank() }
        if (text == null) {
            invoke.reject("summarizeText requires non-empty text", ErrorCode.INVALID_ARGUMENT)
            return
        }
        val bullets = args.format == "bullets"

        inferenceExecutor.execute {
            try {
                val output = if (bullets) {
                    val request = SummarizationRequest.builder(text).build()
                    summarizer().runInference(request).get().summary
                } else {
                    generate(PROSE_SUMMARY_INSTRUCTION + "\n\n" + text)
                }
                if (output.isNullOrBlank()) {
                    invoke.reject("the model returned an empty summary", ErrorCode.EMPTY_OUTPUT)
                } else {
                    invoke.resolve(JSObject().put("text", output))
                }
            } catch (e: PromptContractException) {
                invoke.reject(e.message, e.errorCode, e.metadata)
            } catch (e: Throwable) {
                rejectInference(invoke, "summarizeText", e)
            }
        }
    }

    /**
     * Download the on-device model. Only ever called from an explicit user
     * action — a several-hundred-megabyte download over someone's mobile data
     * is not something a capability check gets to start on its own.
     *
     * Resolves when both features are downloaded; the caller re-checks status.
     */
    @Command
    fun downloadModel(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        val feature = args.feature ?: DOWNLOAD_ALL
        if (feature !in DOWNLOAD_FEATURES) {
            invoke.reject("unknown on-device feature: $feature", ErrorCode.INVALID_ARGUMENT)
            return
        }

        inferenceExecutor.execute {
            try {
                if (feature == DOWNLOAD_ALL || feature == DOWNLOAD_SUMMARIZATION) {
                    summarizer().downloadFeature(NoopDownloadCallback).get()
                }
                if (
                    feature == DOWNLOAD_ALL ||
                    feature == DOWNLOAD_PROMPT ||
                    feature == DOWNLOAD_IMAGE_PROMPT
                ) {
                    // Image Prompt shares the base Prompt adapter/model.
                    prompt().download(NoopDownloadCallback).get()
                }
                invoke.resolve()
            } catch (e: Throwable) {
                Logger.error("genai", "downloadModel failed", e)
                val cause = (e as? ExecutionException)?.cause ?: e
                invoke.reject(
                    cause.message ?: "on-device model download failed",
                    ErrorCode.MODEL_UNAVAILABLE
                )
            }
        }
    }

    /** Run a free-form prompt through the ML Kit Prompt API. */
    @Command
    fun generatePrompt(invoke: Invoke) {
        val args = invoke.parseArgs(PromptArgs::class.java)
        val text = args.prompt?.takeIf { it.isNotBlank() }
        if (text == null) {
            invoke.reject("generatePrompt requires a non-empty prompt", ErrorCode.INVALID_ARGUMENT)
            return
        }

        inferenceExecutor.execute {
            try {
                val output = generate(text)
                if (output.isNullOrBlank()) {
                    invoke.reject("the model returned no completion", ErrorCode.EMPTY_OUTPUT)
                } else {
                    invoke.resolve(JSObject().put("text", output))
                }
            } catch (e: PromptContractException) {
                invoke.reject(e.message, e.errorCode, e.metadata)
            } catch (e: Throwable) {
                rejectInference(invoke, "generatePrompt", e)
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────

    private data class PreparedPrompt(
        val request: GenerateContentRequest,
        val inputTokens: Int,
        val tokenLimit: Int
    )

    /** Drain the explicit FIFO on the one inference executor. */
    private fun drainStreamQueue() {
        while (true) {
            val next = streamRegistry.activateNext() ?: return
            val (requestId, args) = next
            try {
                processStreamingRequest(requestId, args)
            } finally {
                streamRegistry.releaseWorker(requestId)
            }
        }
    }

    /** Execute one streaming request with a bounded busy-only retry policy. */
    private fun processStreamingRequest(requestId: String, args: NativePromptArgs) {
        var failedAttempt = 0
        while (streamRegistry.isActive(requestId)) {
            var emittedText = false
            try {
                val prepared = preparePrompt(args)
                val callback = object : StreamingCallback {
                    override fun onNewText(text: String) {
                        if (text.isEmpty() || !streamRegistry.isActive(requestId)) return
                        emittedText = true
                        trigger(
                            STREAM_EVENT_TEXT,
                            JSObject().apply {
                                put("requestId", requestId)
                                put("text", text)
                            }
                        )
                    }
                }
                val future = prompt().generateContent(prepared.request, callback)
                if (!streamRegistry.attachFuture(requestId, future)) {
                    future.cancel(true)
                    return
                }
                val response = future.get()
                val result = promptResponse(args, prepared, response)
                if (streamRegistry.claimTerminal(requestId)) {
                    trigger(STREAM_EVENT_COMPLETE, result.toJsObject())
                }
                return
            } catch (error: Throwable) {
                val failure = classifyPromptFailure(error)
                val retryDelay = if (failure.code == ErrorCode.BUSY && !emittedText) {
                    busyRetryDelayMs(failedAttempt, ThreadLocalRandom.current().nextDouble())
                } else {
                    null
                }
                if (retryDelay != null && streamRegistry.isActive(requestId)) {
                    trigger(
                        STREAM_EVENT_RETRY,
                        JSObject().apply {
                            put("requestId", requestId)
                            put("attempt", failedAttempt + 1)
                            put("delayMs", retryDelay)
                        }
                    )
                    failedAttempt += 1
                    if (streamRegistry.awaitActive(requestId, retryDelay)) continue
                    return
                }

                if (streamRegistry.claimTerminal(requestId)) {
                    Logger.error("genai", "streaming Prompt failed (${failure.code})", failure.cause)
                    emitStreamError(requestId, failure.code, failure.message)
                }
                return
            }
        }
    }

    private data class ClassifiedFailure(
        val code: String,
        val message: String,
        val cause: Throwable
    )

    private fun classifyPromptFailure(error: Throwable): ClassifiedFailure {
        val cause = when (error) {
            is ExecutionException -> error.cause ?: error
            else -> error
        }
        return when (cause) {
            is PromptContractException -> ClassifiedFailure(
                cause.errorCode,
                cause.message ?: "on-device Prompt request failed",
                cause
            )
            is java.util.concurrent.CancellationException -> ClassifiedFailure(
                ErrorCode.CANCELLED,
                "on-device request cancelled",
                cause
            )
            is GenAiException -> ClassifiedFailure(
                mapGenAiErrorCode(cause.errorCode, cause.message),
                cause.message ?: "on-device inference failed",
                cause
            )
            else -> ClassifiedFailure(
                ErrorCode.INFERENCE_FAILED,
                cause.message ?: "on-device inference failed",
                cause
            )
        }
    }

    private fun emitStreamError(requestId: String, code: String, message: String) {
        trigger(
            STREAM_EVENT_ERROR,
            JSObject().apply {
                put("requestId", requestId)
                put("code", code)
                put("message", message)
            }
        )
    }

    /** Build one ML Kit request from the cross-language envelope. */
    private fun buildPromptRequest(args: NativePromptArgs): GenerateContentRequest {
        if (args.image != null) {
            throw PromptContractException(
                ErrorCode.FEATURE_UNAVAILABLE,
                "image Prompt payload preparation is not available yet"
            )
        }

        val text = requireNotNull(args.text)
        val systemInstruction = args.systemInstruction?.takeIf { it.isNotBlank() }
        if (
            systemInstruction != null &&
            optionalMetadata("system instructions") {
                prompt().isSystemPromptAvailable().get()
            } != true
        ) {
            throw PromptContractException(
                ErrorCode.FEATURE_UNAVAILABLE,
                "system instructions are not supported by this runtime"
            )
        }

        val builder = if (systemInstruction == null) {
            GenerateContentRequest.Builder(TextPart(text))
        } else {
            GenerateContentRequest.Builder(
                SystemInstruction(systemInstruction),
                TextPart(text)
            )
        }

        args.promptPrefix?.takeIf { it.isNotBlank() }?.let { prefix ->
            val cachingAvailable = optionalMetadata("prefix caching") {
                runBlocking { prompt().getGenerativeModel().isCachingFeatureAvailable() }
            } ?: false
            if (!cachingAvailable) {
                throw PromptContractException(
                    ErrorCode.FEATURE_UNAVAILABLE,
                    "prompt prefix caching is not supported by this runtime"
                )
            }
            builder.promptPrefix = PromptPrefix(prefix)
        }
        args.temperature?.let { builder.temperature = it }
        args.seed?.let { builder.seed = it }
        args.candidateCount?.let { builder.candidateCount = it }
        args.maxOutputTokens?.let { builder.maxOutputTokens = it }
        return builder.build()
    }

    /** Build, count, and enforce the real context budget before inference. */
    private fun preparePrompt(args: NativePromptArgs): PreparedPrompt {
        val request = buildPromptRequest(args)
        val inputTokens = prompt().countTokens(request).get().totalTokens
        val tokenLimit = prompt().getTokenLimit().get()
        val requestedOutputTokens = request.maxOutputTokens

        if (exceedsTokenBudget(inputTokens, requestedOutputTokens, tokenLimit)) {
            val metadata = JSObject().apply {
                put("inputTokens", inputTokens)
                put("tokenLimit", tokenLimit)
                put("requestedOutputTokens", requestedOutputTokens)
            }
            throw PromptContractException(
                ErrorCode.CONTEXT_TOO_LARGE,
                "request needs $inputTokens input tokens plus " +
                    "$requestedOutputTokens output tokens; runtime limit is $tokenLimit",
                metadata
            )
        }

        return PreparedPrompt(request, inputTokens, tokenLimit)
    }

    /** Convert ML Kit's final candidates into the stable cross-language DTO. */
    private fun promptResponse(
        args: NativePromptArgs,
        prepared: PreparedPrompt,
        response: com.google.mlkit.genai.prompt.GenerateContentResponse
    ): NativePromptResponseDto {
        val candidates = response.candidates.map {
            PromptCandidateDto(it.text, finishReasonName(it.finishReason))
        }
        val first = candidates.firstOrNull()
            ?: throw PromptContractException(
                ErrorCode.EMPTY_OUTPUT,
                "the model returned no candidates"
            )

        if (isStructuredOutputMode(args.outputMode) && first.finishReason != "stop") {
            throw PromptContractException(
                ErrorCode.INCOMPLETE_OUTPUT,
                "structured output ended with ${first.finishReason ?: "no finish reason"}"
            )
        }

        return NativePromptResponseDto(
            requestId = requireNotNull(args.requestId),
            text = first.text,
            finishReason = first.finishReason,
            inputTokens = prepared.inputTokens,
            tokenLimit = prepared.tokenLimit,
            baseModelName = optionalMetadata("base model name") {
                prompt().getBaseModelName().get()
            },
            candidates = candidates
        )
    }

    /** Count, enforce the real context budget, then run one native inference. */
    private fun executePrompt(args: NativePromptArgs): NativePromptResponseDto {
        val prepared = preparePrompt(args)
        val response = prompt().generateContent(prepared.request).get()
        return promptResponse(args, prepared, response)
    }

    /**
     * Read every capability independently. Optional-feature failures are
     * represented as false/absent and never downgrade base Prompt.
     */
    private fun capabilitySnapshot(): CapabilitySnapshotDto {
        val summarizationState = readFeatureState("summarization") {
            summarizer().checkFeatureStatus().get()
        }
        val promptState = readFeatureState("prompt") {
            prompt().checkStatus().get()
        }
        val promptAvailable = promptState.status == StatusName.AVAILABLE

        val imagePromptState = if (BuildConfig.IMAGE_PROMPT_COMPILED) {
            // Prompt beta4 has no independent image-status API. Image input is
            // part of the same Prompt feature, so it gets its own routable state
            // while inheriting the adapter's runtime availability.
            promptState.copy()
        } else {
            unavailableFeature(ErrorCode.FEATURE_NOT_COMPILED)
        }

        val futures = if (promptAvailable) optionalMetadata("prompt client") { prompt() } else null
        val model = futures?.let {
            optionalMetadata("prompt model") { it.getGenerativeModel() }
        }
        val structuredOutput =
            BuildConfig.STRUCTURED_OUTPUT_COMPILED && model != null &&
                (optionalMetadata("structured output") {
                    runBlocking { model.isStructuredOutputFeatureAvailable() }
                } ?: false)
        val prefixCaching = model != null &&
            (optionalMetadata("prefix caching") {
                runBlocking { model.isCachingFeatureAvailable() }
            } ?: false)

        val systemInstructions = futures?.let {
            optionalMetadata("system instructions") {
                it.isSystemPromptAvailable().get()
            }
        } ?: false

        return CapabilitySnapshotDto(
            prompt = promptState,
            summarization = summarizationState,
            imagePrompt = imagePromptState,
            features = negotiatePromptFeatures(
                promptAvailable = promptAvailable,
                structuredOutputCompiled = BuildConfig.STRUCTURED_OUTPUT_COMPILED,
                structuredOutputAvailable = structuredOutput,
                systemInstructionsAvailable = systemInstructions,
                prefixCachingAvailable = prefixCaching,
                imagePromptCompiled = BuildConfig.IMAGE_PROMPT_COMPILED,
                multiImageCompiled = BuildConfig.MULTI_IMAGE_COMPILED,
                streamingCompiled = BuildConfig.STREAMING_COMPILED
            ),
            baseModelName = futures?.let {
                optionalMetadata("base model name") { it.getBaseModelName().get() }
            },
            tokenLimit = futures?.let {
                optionalMetadata("token limit") { it.getTokenLimit().get() }
            }
        )
    }

    private fun readFeatureState(label: String, check: () -> Int): FeatureStateDto = try {
        featureStateForStatus(check())
    } catch (e: Throwable) {
        Logger.error("genai", "$label capability check failed", e)
        unavailableFeature(ErrorCode.DEVICE_UNSUPPORTED)
    }

    private fun <T> optionalMetadata(label: String, read: () -> T): T? = try {
        read()
    } catch (e: Throwable) {
        Logger.error("genai", "$label metadata check failed", e)
        null
    }

    /** Legacy status only: new routing consumes each state independently. */
    private fun legacyCombinedState(snapshot: CapabilitySnapshotDto): FeatureStateDto {
        val states = listOf(snapshot.prompt, snapshot.summarization)
        return states.minByOrNull { legacySeverity(it.status) }
            ?: unavailableFeature(ErrorCode.DEVICE_UNSUPPORTED)
    }

    private fun legacySeverity(status: String): Int = when (status) {
        StatusName.AVAILABLE -> 3
        StatusName.DOWNLOADING -> 2
        StatusName.DOWNLOADABLE -> 1
        else -> 0
    }

    /** Blocking prompt call. Must be called from a background executor. */
    private fun generate(text: String): String? = executePrompt(
        NativePromptArgs().apply {
            requestId = "compat-${System.nanoTime()}"
            this.text = text
            outputMode = OUTPUT_MODE_TEXT
            stream = false
        }
    ).text

    /**
     * The bridge reports one status for two ML Kit features, so it reports the
     * more restrictive of the two. Order of severity:
     * UNAVAILABLE < DOWNLOADABLE < DOWNLOADING < AVAILABLE.
     */
    private fun weakestStatus(a: Int, b: Int): Int =
        if (severity(a) <= severity(b)) a else b

    private fun severity(status: Int): Int = when (status) {
        FeatureStatus.AVAILABLE -> 3
        FeatureStatus.DOWNLOADING -> 2
        FeatureStatus.DOWNLOADABLE -> 1
        else -> 0
    }

    private fun statusName(status: Int): String = when (status) {
        FeatureStatus.AVAILABLE -> StatusName.AVAILABLE
        FeatureStatus.DOWNLOADABLE -> StatusName.DOWNLOADABLE
        FeatureStatus.DOWNLOADING -> StatusName.DOWNLOADING
        else -> StatusName.UNAVAILABLE
    }

    private fun statusReason(status: Int): String = when (status) {
        FeatureStatus.DOWNLOADABLE -> ErrorCode.MODEL_DOWNLOADABLE
        FeatureStatus.DOWNLOADING -> ErrorCode.MODEL_DOWNLOADING
        FeatureStatus.UNAVAILABLE -> ErrorCode.DEVICE_UNSUPPORTED
        else -> ErrorCode.MODEL_UNAVAILABLE
    }

    /**
     * Map an inference failure to a typed code. Re-checking the feature status
     * distinguishes "the model is not here" from "the model is here and the run
     * failed", which is the difference between offering a download and offering
     * a retry.
     */
    private fun rejectInference(invoke: Invoke, what: String, e: Throwable) {
        Logger.error("genai", "$what failed", e)
        val cause = (e as? ExecutionException)?.cause ?: e
        val code = when (val status = currentStatusOrNull()) {
            FeatureStatus.AVAILABLE, null -> ErrorCode.INFERENCE_FAILED
            else -> statusReason(status)
        }
        invoke.reject(cause.message ?: "on-device inference failed", code)
    }

    /** Best-effort status read used only to classify an error. */
    private fun currentStatusOrNull(): Int? = try {
        weakestStatus(summarizer().checkFeatureStatus().get(), prompt().checkStatus().get())
    } catch (e: Throwable) {
        Logger.error("genai", "status re-check during error mapping failed", e)
        null
    }

    // ──────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────────

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        release()
    }

    private fun release() {
        streamRegistry.cancelAll().forEach { it.cancel(true) }
        val (summarizerToClose, modelToClose) = synchronized(clientLock) {
            if (closed) return
            closed = true
            val s = summarizerBullets
            val m = promptModel
            summarizerBullets = null
            promptModel = null
            promptFutures = null
            s to m
        }
        // Closing releases the AICore session; a leaked one keeps the system
        // service warm for a process that is going away.
        runCatching { summarizerToClose?.close() }
            .onFailure { Logger.error("genai", "summarizer close failed", it) }
        runCatching { modelToClose?.close() }
            .onFailure { Logger.error("genai", "prompt model close failed", it) }
        inferenceExecutor.shutdown()
        statusExecutor.shutdown()
    }

    /**
     * ML Kit requires a callback on `downloadFeature`/`download`, but the
     * command resolves off the returned future — progress is not surfaced to
     * the webview, so there is nothing for the callback to do.
     *
     * The four methods are Java `default`s, which Kotlin does not inherit as
     * implementations, so they are spelled out.
     */
    private object NoopDownloadCallback : DownloadCallback {
        override fun onDownloadStarted(bytesToDownload: Long) {}
        override fun onDownloadProgress(totalBytesDownloaded: Long) {}
        override fun onDownloadCompleted() {}
        override fun onDownloadFailed(e: GenAiException) {
            Logger.error("genai", "model download failed", e)
        }
    }

    private companion object {
        const val DOWNLOAD_ALL = "all"
        const val DOWNLOAD_PROMPT = "prompt"
        const val DOWNLOAD_SUMMARIZATION = "summarization"
        const val DOWNLOAD_IMAGE_PROMPT = "image-prompt"
        val DOWNLOAD_FEATURES = setOf(
            DOWNLOAD_ALL,
            DOWNLOAD_PROMPT,
            DOWNLOAD_SUMMARIZATION,
            DOWNLOAD_IMAGE_PROMPT
        )

        /**
         * Prose-summary instruction for the Prompt API path. Kept terse: every
         * instruction token competes with the document for Nano's small window.
         */
        const val PROSE_SUMMARY_INSTRUCTION =
            "Summarize the following text in a single short paragraph of prose. " +
                "Do not use bullet points, headings, or a preamble. Reply with the summary only."
    }
}
