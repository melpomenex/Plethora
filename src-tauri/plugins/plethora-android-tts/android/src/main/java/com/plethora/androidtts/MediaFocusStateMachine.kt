package com.plethora.androidtts

/**
 * Pure policy for Android audio focus and noisy-headset transitions. Keeping
 * intent here separate from AudioManager makes the resume guarantee testable:
 * gain only resumes playback that the system interrupted, never user-paused
 * playback or a session stopped by a headphone disconnect.
 */
enum class MediaFocusAction {
    NONE,
    PAUSE,
    DUCK,
    RESTORE,
    STOP,
}
class MediaFocusStateMachine {
    private var interruptedPlaying = false
    private var ducked = false
    private var userPaused = false
    private var stoppedByNoisy = false

    fun onUserPlayback(isPlaying: Boolean) {
        userPaused = !isPlaying
        if (isPlaying) {
            stoppedByNoisy = false
            interruptedPlaying = false
        }
    }

    fun onPermanentLoss(isPlaying: Boolean): MediaFocusAction {
        interruptedPlaying = false
        ducked = false
        stoppedByNoisy = false
        return if (isPlaying) MediaFocusAction.STOP else MediaFocusAction.NONE
    }

    fun onTransientLoss(isPlaying: Boolean): MediaFocusAction {
        interruptedPlaying = isPlaying && !userPaused
        return if (interruptedPlaying) MediaFocusAction.PAUSE else MediaFocusAction.NONE
    }

    fun onDuck(isPlaying: Boolean): MediaFocusAction {
        ducked = isPlaying && !userPaused
        return if (ducked) MediaFocusAction.DUCK else MediaFocusAction.NONE
    }

    fun onGain(isPlaying: Boolean): MediaFocusAction {
        if (ducked) {
            ducked = false
            return MediaFocusAction.RESTORE
        }
        if (interruptedPlaying && !userPaused && !isPlaying) {
            interruptedPlaying = false
            return MediaFocusAction.RESTORE
        }
        interruptedPlaying = false
        return MediaFocusAction.NONE
    }

    fun onHeadphoneDisconnect(isPlaying: Boolean): MediaFocusAction {
        interruptedPlaying = false
        ducked = false
        stoppedByNoisy = isPlaying
        userPaused = true
        return if (isPlaying) MediaFocusAction.PAUSE else MediaFocusAction.NONE
    }

    fun wasStoppedByNoisy(): Boolean = stoppedByNoisy
}
