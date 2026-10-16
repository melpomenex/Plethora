package com.plethora.androidspeech

import org.junit.Assert.*
import org.junit.Test

class DictationSessionTest {
    private class Fixture {
        var now = 0L
        data class Timer(val at: Long, val callback: () -> Unit, var cancelled: Boolean = false)
        val timers = mutableListOf<Timer>()
        var released = 0; var stopped = 0
        val starts = mutableListOf<String?>()
        val results = mutableListOf<Pair<String?, String?>>()
        val session = DictationSession({ delay, callback ->
            val timer = Timer(now + delay, callback); timers.add(timer)
            val cancel: () -> Unit = { timer.cancelled = true }; cancel
        }, { released++ }, { stopped++ })
        fun advance(ms: Long) {
            val target = now + ms
            while (true) {
                val timer = timers.filter { !it.cancelled && it.at <= target }.minByOrNull { it.at } ?: break
                now = timer.at; timer.cancelled = true; timer.callback()
            }
            now = target
        }
        fun start(id: String = "one") = session.reserve(id) { starts.add(it) }
        fun stop(id: String = "one") = session.stop(id) { text, error -> results.add(Pair(text, error)) }
    }
    @Test fun busyOwnerIsNotDisplaced() { val f = Fixture(); assertTrue(f.start()); assertFalse(f.start("two")); assertTrue(f.session.owns("one")); assertEquals(0, f.released) }
    @Test fun finalAfterStopIsAwaitedExactlyOnce() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.stop(); assertTrue(f.results.isEmpty()); assertEquals(1, f.stopped)
        f.session.result("one", "final words"); f.session.result("one", "duplicate")
        assertEquals(listOf(Pair("final words", null)), f.results); assertEquals(1, f.released)
    }
    @Test fun spontaneousFinalIsCachedUntilStop() { val f = Fixture(); f.start(); f.session.ready("one"); f.session.result("one", "spoken"); assertEquals(1, f.released); f.stop(); assertEquals(Pair("spoken", null), f.results.single()) }
    @Test fun cancelRejectsLateCallbacksAndDoesNotCancelOtherOwner() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.session.cancel("other"); assertEquals(0, f.released)
        f.session.cancel("one"); f.session.result("one", "late"); f.stop(); assertEquals(Pair(null, "cancelled"), f.results.single())
    }
    @Test fun initializationAndFinalizationAreBounded() {
        val f = Fixture(); f.start(); f.advance(9_999); assertTrue(f.starts.isEmpty()); f.advance(1); assertEquals("timeout", f.starts.single()); assertEquals(1, f.released)
        assertTrue(f.start("next")); f.session.ready("next"); f.stop("next"); f.advance(5_000); assertEquals(Pair(null, "timeout"), f.results.single())
    }
    @Test fun sixtySecondCaptureCapFinalizesWithoutConsumingResult() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.advance(59_999); assertEquals(0, f.stopped); f.advance(1); assertEquals(1, f.stopped)
        f.session.result("one", "capped"); assertTrue(f.results.isEmpty()); f.stop(); assertEquals(Pair("capped", null), f.results.single())
    }
    @Test fun stopTimeoutAndNoSpeechReturnTypedFailures() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.session.result("one", " "); f.stop(); assertEquals(Pair(null, "no-speech"), f.results.single())
    }
    @Test fun duplicateStopCannotInstallAnotherResultOwner() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.stop(); f.stop(); assertEquals(Pair(null, "busy"), f.results.single()); f.session.result("one", "final"); assertEquals(2, f.results.size); assertEquals(1, f.stopped)
    }
    @Test fun interruptionReleasesResourcesAndCancelsTimers() {
        val f = Fixture(); f.start(); f.session.ready("one"); f.stop(); f.session.cancel(reason = "interrupted"); f.advance(100_000)
        assertEquals(Pair(null, "interrupted"), f.results.single()); assertEquals(1, f.released); assertEquals(1, f.stopped)
    }
    @Test fun permissionFailureFreesOwnerForExplicitRetry() {
        val f = Fixture(); f.start(); f.session.result("one", null, "denied"); assertEquals("denied", f.starts.single()); assertTrue(f.start("retry"))
    }
}
