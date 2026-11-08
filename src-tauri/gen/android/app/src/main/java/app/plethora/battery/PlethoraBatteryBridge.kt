package app.plethora.battery

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.annotation.RequiresApi
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native Android Battery, Charger and Thermal Management Bridge for Plethora.
 * Provides real-time energy state and thermal pressure signals to the Rust backend.
 */
object PlethoraBatteryBridge {
    private val cachedThermalStatus = AtomicInteger(0)
    private var isListenerRegistered = false

    @JvmStatic
    fun getBatteryCapacity(context: Context): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    }

    @JvmStatic
    fun isCharging(context: Context): Boolean {
        val intentFilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val batteryStatus: Intent? = context.registerReceiver(null, intentFilter)
        val status = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
    }

    @JvmStatic
    fun isPowerSaveMode(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return pm?.isPowerSaveMode ?: false
    }

    @JvmStatic
    fun getThermalStatus(context: Context): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val currentStatus = pm?.currentThermalStatus ?: cachedThermalStatus.get()
            return mapThermalStatusToString(currentStatus)
        }
        return "normal"
    }

    @JvmStatic
    fun registerThermalListener(context: Context) {
        if (isListenerRegistered || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        try {
            pm.addThermalStatusListener(context.mainExecutor) { status ->
                cachedThermalStatus.set(status)
                try {
                    nativeOnThermalStatusChanged(status)
                } catch (_: UnsatisfiedLinkError) {
                    // Rust bridge not attached in testing environment
                }
            }
            isListenerRegistered = true
        } catch (_: Exception) {
            // Ignore listener registration failures on unsupported OEM ROMs
        }
    }

    @JvmStatic
    fun mapThermalStatusToString(status: Int): String {
        return when (status) {
            PowerManager.THERMAL_STATUS_NONE -> "normal"
            PowerManager.THERMAL_STATUS_LIGHT -> "light"
            PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
            PowerManager.THERMAL_STATUS_SEVERE -> "severe"
            PowerManager.THERMAL_STATUS_CRITICAL,
            PowerManager.THERMAL_STATUS_EMERGENCY,
            PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
            else -> "normal"
        }
    }

    @JvmStatic
    fun getBatteryInfoJson(context: Context): String {
        val capacity = getBatteryCapacity(context)
        val level = if (capacity in 0..100) capacity / 100.0f else 1.0f
        val charging = isCharging(context)
        val powerSave = isPowerSaveMode(context)
        val thermal = getThermalStatus(context)

        val json = JSONObject()
        json.put("isPresent", capacity >= 0)
        json.put("level", level)
        json.put("isCharging", charging)
        json.put("isPowerSave", powerSave)
        json.put("thermalStatus", thermal)

        return json.toString()
    }

    @JvmStatic
    private external fun nativeOnThermalStatusChanged(statusCode: Int)
}
