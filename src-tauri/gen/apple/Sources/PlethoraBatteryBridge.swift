import Foundation
import UIKit

/**
 * Native iOS Battery and Thermal Bridge for Plethora.
 * Provides battery level, charging status, low-power mode, and ProcessInfo thermalState.
 */
@objc public class PlethoraBatteryBridge: NSObject {

    @objc public static func enableMonitoring() {
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    @objc public static func getBatteryLevel() -> Float {
        enableMonitoring()
        let level = UIDevice.current.batteryLevel
        return level >= 0 ? level : 1.0
    }

    @objc public static func isCharging() -> Bool {
        enableMonitoring()
        let state = UIDevice.current.batteryState
        return state == .charging || state == .full
    }

    @objc public static func isLowPowerMode() -> Bool {
        return ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    @objc public static func getThermalStatus() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal:
            return "normal"
        case .fair:
            return "light"
        case .serious:
            return "severe"
        case .critical:
            return "critical"
        @unknown default:
            return "normal"
        }
    }

    @objc public static func getBatteryInfoJson() -> String {
        enableMonitoring()
        let level = getBatteryLevel()
        let charging = isCharging()
        let lowPower = isLowPowerMode()
        let thermal = getThermalStatus()
        let isPresent = UIDevice.current.batteryState != .unknown

        let dict: [String: Any] = [
            "isPresent": isPresent,
            "level": level,
            "isCharging": charging,
            "isPowerSave": lowPower,
            "thermalStatus": thermal
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let json = String(data: data, encoding: .utf8) else {
            return "{\"isPresent\":true,\"level\":1.0,\"isCharging\":true,\"isPowerSave\":false,\"thermalStatus\":\"normal\"}"
        }
        return json
    }
}

@_cdecl("plethora_get_ios_battery_info")
public func plethora_get_ios_battery_info() -> UnsafeMutablePointer<CChar>? {
    let json = PlethoraBatteryBridge.getBatteryInfoJson()
    return strdup(json)
}
