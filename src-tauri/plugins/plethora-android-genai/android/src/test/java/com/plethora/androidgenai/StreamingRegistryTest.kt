// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

package com.plethora.androidgenai

import com.google.mlkit.genai.common.GenAiException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingRegistryTest {

    @Test
    fun `enqueue accepts within capacity and rejects duplicates or when full`() {
        val registry = StreamRequestRegistry<String>(2)
        assertEquals(StreamEnqueueResult.ACCEPTED, registry.enqueue("req-1", "data-1"))
        assertEquals(StreamEnqueueResult.DUPLICATE, registry.enqueue("req-1", "data-1"))
        assertEquals(StreamEnqueueResult.ACCEPTED, registry.enqueue("req-2", "data-2"))
        assertEquals(StreamEnqueueResult.FULL, registry.enqueue("req-3", "data-3"))
        assertEquals(2, registry.size())
    }

    @Test
    fun `activateNext pops in FIFO order and prevents concurrent active entries`() {
        val registry = StreamRequestRegistry<String>(3)
        registry.enqueue("req-1", "data-1")
        registry.enqueue("req-2", "data-2")

        val first = registry.activateNext()
        assertNotNull(first)
        assertEquals("req-1", first?.first)
        assertEquals("data-1", first?.second)

        // While req-1 is active, activateNext returns null
        assertNull(registry.activateNext())

        assertTrue(registry.isActive("req-1"))
        assertFalse(registry.isActive("req-2"))

        // Releasing req-1 allows req-2 to activate
        registry.releaseWorker("req-1")
        val second = registry.activateNext()
        assertNotNull(second)
        assertEquals("req-2", second?.first)
        assertEquals("data-2", second?.second)
    }

    @Test
    fun `queued cancellation removes request and permits new enqueues`() {
        val registry = StreamRequestRegistry<String>(2)
        registry.enqueue("req-1", "data-1")
        registry.enqueue("req-2", "data-2")

        val outcome = registry.cancel("req-2")
        assertEquals(StreamCancelState.QUEUED, outcome.state)
        assertNull(outcome.future)
        assertEquals(1, registry.size())

        // Capacity freed
        assertEquals(StreamEnqueueResult.ACCEPTED, registry.enqueue("req-3", "data-3"))
    }

    @Test
    fun `active cancellation returns active state and attached future`() {
        val registry = StreamRequestRegistry<String>(2)
        registry.enqueue("req-1", "data-1")
        val active = registry.activateNext()
        assertEquals("req-1", active?.first)

        val executor = Executors.newSingleThreadExecutor()
        val dummyFuture: Future<*> = executor.submit { Thread.sleep(100) }

        assertTrue(registry.attachFuture("req-1", dummyFuture))

        val outcome = registry.cancel("req-1")
        assertEquals(StreamCancelState.ACTIVE, outcome.state)
        assertEquals(dummyFuture, outcome.future)

        executor.shutdownNow()
    }

    @Test
    fun `claimTerminal succeeds only once per active request`() {
        val registry = StreamRequestRegistry<String>(2)
        registry.enqueue("req-1", "data-1")
        registry.activateNext()

        assertTrue(registry.claimTerminal("req-1"))
        // Second claim fails (request already removed from records)
        assertFalse(registry.claimTerminal("req-1"))
    }

    @Test
    fun `cancelAll returns all attached futures and clears queue`() {
        val registry = StreamRequestRegistry<String>(3)
        registry.enqueue("req-1", "data-1")
        registry.enqueue("req-2", "data-2")

        val active = registry.activateNext()
        assertEquals("req-1", active?.first)

        val executor = Executors.newSingleThreadExecutor()
        val dummyFuture: Future<*> = executor.submit { Thread.sleep(100) }
        registry.attachFuture("req-1", dummyFuture)

        val futures = registry.cancelAll()
        assertEquals(1, futures.size)
        assertEquals(dummyFuture, futures[0])
        assertEquals(0, registry.size())

        executor.shutdownNow()
    }

    @Test
    fun `mapGenAiErrorCode maps ML Kit codes to stable app codes`() {
        assertEquals("busy", mapGenAiErrorCode(GenAiException.ErrorCode.BUSY, null))
        assertEquals("battery_quota_exceeded", mapGenAiErrorCode(GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED, null))
        assertEquals("background_use_blocked", mapGenAiErrorCode(GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED, null))
        assertEquals("cancelled", mapGenAiErrorCode(GenAiException.ErrorCode.CANCELLED, null))
        assertEquals("context_too_large", mapGenAiErrorCode(GenAiException.ErrorCode.REQUEST_TOO_LARGE, null))
        assertEquals("invalid_image", mapGenAiErrorCode(GenAiException.ErrorCode.INVALID_INPUT_IMAGE, null))
        assertEquals("safety_blocked", mapGenAiErrorCode(999, "safety triggered"))
        assertEquals("model_unavailable", mapGenAiErrorCode(GenAiException.ErrorCode.NOT_AVAILABLE, null))
    }

    @Test
    fun `busyRetryDelayMs bounds exponential backoff with jitter and respects max retries`() {
        // Attempt 0: base 200ms
        val delay0Min = busyRetryDelayMs(0, 0.0)
        val delay0Max = busyRetryDelayMs(0, 1.0)
        assertNotNull(delay0Min)
        assertNotNull(delay0Max)
        assertEquals(150L, delay0Min) // 200 * 0.75
        assertEquals(250L, delay0Max) // 200 * 1.25

        // Attempt 1: 400ms base -> 300ms..500ms
        assertEquals(300L, busyRetryDelayMs(1, 0.0))
        assertEquals(500L, busyRetryDelayMs(1, 1.0))

        // Attempt 2: 800ms base -> 600ms..1000ms
        assertEquals(600L, busyRetryDelayMs(2, 0.0))
        assertEquals(1000L, busyRetryDelayMs(2, 1.0))

        // Attempt 3 (or beyond): max retries exhausted -> null
        assertNull(busyRetryDelayMs(3, 0.5))
        assertNull(busyRetryDelayMs(4, 0.5))
    }
}
