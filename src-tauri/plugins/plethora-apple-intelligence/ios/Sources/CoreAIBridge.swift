// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// H — add-apple-core-ai-custom-models (iOS 27; flag default off)

import Foundation
import Tauri

struct CoreAIIdArgs: Decodable {
  var modelId: String?
  var requestId: String?
  var text: String?
}

final class AppleCoreAIBridge {
  func featureState() -> FeatureStatePayload {
    if #available(iOS 27.0, *) {
      return FeatureStatePayload.unavailable("model_not_ready")
    }
    return FeatureStatePayload.unavailable("unsupported_os")
  }

  func status(_ invoke: Invoke) {
    let state = featureState()
    var obj: JSObject = ["status": state.status]
    if let reason = state.reason { obj["reason"] = reason }
    invoke.resolve(obj)
  }

  func catalog(_ invoke: Invoke) {
    invoke.resolve(["models": [] as [JSObject]])
  }

  func downloadStart(_ invoke: Invoke) throws {
    let _ = try invoke.parseArgs(CoreAIIdArgs.self)
    rejectCoded(invoke, "not_implemented", "Core AI catalog download requires iOS 27")
  }

  func downloadCancel(_ invoke: Invoke) {
    invoke.resolve(["ok": true])
  }

  func installCommit(_ invoke: Invoke) {
    rejectCoded(invoke, "not_implemented", "Core AI install requires iOS 27")
  }

  func delete(_ invoke: Invoke) throws {
    let _ = try invoke.parseArgs(CoreAIIdArgs.self)
    rejectCoded(invoke, "not_implemented", "Core AI delete requires iOS 27")
  }

  func setActive(_ invoke: Invoke) throws {
    let _ = try invoke.parseArgs(CoreAIIdArgs.self)
    rejectCoded(invoke, "not_implemented", "Core AI set_active requires iOS 27")
  }

  func sessionStart(_ invoke: Invoke) throws {
    rejectCoded(invoke, "not_implemented", "Core AI sessions require iOS 27")
  }

  func prompt(_ invoke: Invoke) throws {
    rejectCoded(invoke, "not_implemented", "Core AI prompt requires iOS 27")
  }

  func cancel(_ invoke: Invoke) {
    invoke.resolve(["ok": true])
  }

  func countTokens(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CoreAIIdArgs.self)
    let estimate = max(1, (args.text ?? "").split { $0.isWhitespace }.count)
    invoke.resolve(["inputTokens": estimate])
  }

  func warmup(_ invoke: Invoke) {
    invoke.resolve(["ok": true])
  }
}
