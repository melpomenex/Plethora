package com.plethora.haptics

import android.os.Build
import android.view.HapticFeedbackConstants

internal object HapticMapping {
    fun constant(effect: String, intensity: String, sdk: Int = Build.VERSION.SDK_INT): Int? = when (effect) {
        "selection" -> if (sdk >= 34 && intensity == "subtle") {
            HapticFeedbackConstants.SEGMENT_FREQUENT_TICK
        } else if (sdk >= 34) {
            HapticFeedbackConstants.SEGMENT_TICK
        } else {
            HapticFeedbackConstants.CLOCK_TICK
        }
        "activation" -> HapticFeedbackConstants.CONTEXT_CLICK
        "threshold" -> if (sdk >= 30) HapticFeedbackConstants.GESTURE_START else HapticFeedbackConstants.CONTEXT_CLICK
        "commit", "success", "completion", "celebration" -> if (sdk >= 30) {
            HapticFeedbackConstants.CONFIRM
        } else {
            HapticFeedbackConstants.VIRTUAL_KEY
        }
        "warning", "error" -> if (sdk >= 30) {
            HapticFeedbackConstants.REJECT
        } else {
            HapticFeedbackConstants.LONG_PRESS
        }
        else -> null
    }
}
