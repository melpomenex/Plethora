import CoreHaptics
import SwiftRs
import Tauri
import UIKit

private struct HapticsConfiguration: Decodable {
  let driverSessionId: String
  let revision: UInt64
  let enabled: Bool
  let intensity: String
}

private struct HapticsRequest: Decodable {
  let driverSessionId: String
  let revision: UInt64
  let interactionId: String
  let effect: String
  let ttlMs: Int
}

enum HapticsWire {
  static let effects: Set<String> = [
    "selection", "activation", "threshold", "commit", "success", "warning", "error", "completion", "celebration",
  ]
  static let intensities: Set<String> = ["subtle", "standard", "strong"]

  static func validId(_ value: String) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= 128
  }
}

public final class HapticsPlugin: Plugin {
  private let sessionId = UUID().uuidString
  private var revision: UInt64 = 0
  private var enabled = false
  private var intensity = "subtle"
  private var destroyed = false
  private var selectionGenerator: UISelectionFeedbackGenerator?
  private var notificationGenerator: UINotificationFeedbackGenerator?
  private var impactGenerators: [UIImpactFeedbackGenerator.FeedbackStyle: UIImpactFeedbackGenerator] = [:]
  private var recentIds: [String: TimeInterval] = [:]
  private var submissions: [TimeInterval] = []
  private var lastSubmission: TimeInterval = -.infinity
  private var observers: [NSObjectProtocol] = []

  public override init() {
    super.init()
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.prepareIfEnabled() })
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.releaseGenerators() })
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.releaseGenerators() })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  @objc public func getCapabilities(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics
      invoke.resolve([
        "protocolVersion": 1,
        "driver": "ios-native",
        "driverSessionId": self.sessionId,
        "configurationRevision": self.revision,
        "hardware": supported ? "available" : "unavailable",
        "systemPreference": "unknown",
        "intensityControl": "effect-style",
      ])
    }
  }

  @objc public func configure(_ invoke: Invoke) throws {
    let config = try invoke.parseArgs(HapticsConfiguration.self)
    guard HapticsWire.validId(config.driverSessionId), config.driverSessionId == sessionId,
      config.revision > 0, HapticsWire.intensities.contains(config.intensity)
    else {
      invoke.reject("invalid haptic configuration")
      return
    }
    DispatchQueue.main.async {
      guard config.revision >= self.revision else {
        invoke.reject("stale haptic configuration")
        return
      }
      self.revision = config.revision
      self.enabled = config.enabled
      self.intensity = config.intensity
      if self.enabled { self.prepareIfEnabled() } else { self.releaseGenerators() }
      invoke.resolve(["driverSessionId": self.sessionId, "revision": self.revision])
    }
  }

  @objc public func perform(_ invoke: Invoke) throws {
    let request = try invoke.parseArgs(HapticsRequest.self)
    let receivedAt = ProcessInfo.processInfo.systemUptime
    DispatchQueue.main.async {
      invoke.resolve(self.perform(request, receivedAt: receivedAt))
    }
  }

  private func perform(_ request: HapticsRequest, receivedAt: TimeInterval) -> [String: String] {
    let now = ProcessInfo.processInfo.systemUptime
    func skipped(_ reason: String) -> [String: String] { ["status": "skipped", "reason": reason] }
    guard HapticsWire.validId(request.driverSessionId), HapticsWire.validId(request.interactionId),
      request.driverSessionId == sessionId, request.revision == revision,
      (1...150).contains(request.ttlMs), HapticsWire.effects.contains(request.effect)
    else { return skipped("stale") }
    guard now - receivedAt <= Double(request.ttlMs) / 1000 else { return skipped("stale") }
    guard enabled else { return skipped("disabled") }
    guard !destroyed, UIApplication.shared.applicationState == .active else { return skipped("background") }
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return skipped("unsupported") }

    recentIds = recentIds.filter { now - $0.value < 2.0 }
    guard recentIds[request.interactionId] == nil else { return skipped("rate-limited") }
    submissions.removeAll { now - $0 >= 1.0 }
    let outcome = ["success", "warning", "error", "completion", "celebration"].contains(request.effect)
    let cooldown = outcome ? 0.25 : 0.06
    guard submissions.count < 8, now - lastSubmission >= cooldown else { return skipped("rate-limited") }

    guard deliver(request.effect) else { return skipped("unsupported") }
    recentIds[request.interactionId] = now
    if recentIds.count > 256, let oldest = recentIds.min(by: { $0.value < $1.value })?.key {
      recentIds.removeValue(forKey: oldest)
    }
    submissions.append(now)
    lastSubmission = now
    return ["status": "submitted"]
  }

  private func deliver(_ effect: String) -> Bool {
    switch effect {
    case "selection":
      selectionGenerator = selectionGenerator ?? UISelectionFeedbackGenerator()
      selectionGenerator?.selectionChanged()
    case "activation", "threshold", "commit":
      impactGenerator(for: impactStyle(effect))?.impactOccurred()
    case "success", "completion", "celebration":
      notificationGenerator = notificationGenerator ?? UINotificationFeedbackGenerator()
      notificationGenerator?.notificationOccurred(.success)
    case "warning":
      notificationGenerator = notificationGenerator ?? UINotificationFeedbackGenerator()
      notificationGenerator?.notificationOccurred(.warning)
    case "error":
      notificationGenerator = notificationGenerator ?? UINotificationFeedbackGenerator()
      notificationGenerator?.notificationOccurred(.error)
    default:
      return false
    }
    return true
  }

  private func impactStyle(_ effect: String) -> UIImpactFeedbackGenerator.FeedbackStyle {
    switch effect {
    case "activation", "threshold":
      switch intensity {
      case "subtle": return .soft
      case "strong": return .medium
      default: return .light
      }
    default:
      switch intensity {
      case "subtle": return .light
      case "strong": return .heavy
      default: return .medium
      }
    }
  }

  private func impactGenerator(for style: UIImpactFeedbackGenerator.FeedbackStyle) -> UIImpactFeedbackGenerator? {
    if #available(iOS 13.0, *) {
      if impactGenerators[style] == nil { impactGenerators[style] = UIImpactFeedbackGenerator(style: style) }
      return impactGenerators[style]
    }
    return nil
  }

  private func prepareIfEnabled() {
    guard enabled, UIApplication.shared.applicationState == .active else { return }
    selectionGenerator = selectionGenerator ?? UISelectionFeedbackGenerator()
    notificationGenerator = notificationGenerator ?? UINotificationFeedbackGenerator()
    _ = impactGenerator(for: impactStyle("activation"))
    _ = impactGenerator(for: impactStyle("commit"))
    selectionGenerator?.prepare()
    notificationGenerator?.prepare()
    impactGenerators.values.forEach { $0.prepare() }
  }

  private func releaseGenerators() {
    selectionGenerator = nil
    notificationGenerator = nil
    impactGenerators.removeAll()
    recentIds.removeAll()
    submissions.removeAll()
    lastSubmission = -.infinity
  }

}

@_cdecl("init_plugin_plethora_haptics")
func initPlugin() -> Plugin {
  HapticsPlugin()
}
