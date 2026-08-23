// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// B — add-apple-foundation-models-provider

import Foundation
import Tauri

#if canImport(FoundationModels)
import FoundationModels
#endif

struct FmGenerateArgs: Decodable {
  var requestId: String?
  var text: String?
  var systemInstruction: String?
  var maxOutputTokens: Int?
  var temperature: Double?
}

struct FmCancelArgs: Decodable {
  var requestId: String?
}

final class AppleFoundationModelsBridge {
  private var cancelled = Set<String>()

  func featureState() -> FeatureStatePayload {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      return FeatureStatePayload.unavailable("model_not_ready")
    }
    #endif
    return FeatureStatePayload.unavailable("unsupported_os")
  }

  func availability(_ invoke: Invoke) {
    let state = featureState()
    var obj: JSObject = ["status": state.status]
    if let reason = state.reason {
      obj["reason"] = reason
    }
    invoke.resolve(obj)
  }

  func generate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmGenerateArgs.self)
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      generateWithFoundationModels(invoke, args)
      return
    }
    #endif
    rejectCoded(invoke, "unsupported_os", "Foundation Models require iOS 26+")
  }

  func generateStream(_ invoke: Invoke) throws {
    try generate(invoke)
  }

  func cancel(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmCancelArgs.self)
    if let id = args.requestId {
      cancelled.insert(id)
    }
    invoke.resolve(["ok": true])
  }

  func countTokens(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmGenerateArgs.self)
    let text = (args.systemInstruction ?? "") + (args.text ?? "")
    let estimate = max(1, text.split { $0.isWhitespace || $0.isNewline }.count)
    invoke.resolve(["inputTokens": estimate, "tokenLimit": 4096])
  }

  func warmup(_ invoke: Invoke) {
    invoke.resolve(["ok": true])
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private func generateWithFoundationModels(_ invoke: Invoke, _ args: FmGenerateArgs) {
    let requestId = args.requestId ?? UUID().uuidString
    let prompt = args.text ?? ""
    Task {
      do {
        let model = SystemLanguageModel.default
        let session = LanguageModelSession(model: model)
        if let system = args.systemInstruction, !system.isEmpty {
          // Instructions stay on the TS task; fold only if the session API
          // has no separate instructions field in this SDK.
          let _ = system
        }
        let response = try await session.respond(to: prompt)
        if self.cancelled.contains(requestId) {
          rejectCoded(invoke, "cancelled", "Request cancelled")
          return
        }
        invoke.resolve([
          "requestId": requestId,
          "text": String(describing: response),
        ])
      } catch {
        let message = error.localizedDescription
        if message.localizedCaseInsensitiveContains("private cloud")
          || message.localizedCaseInsensitiveContains("Private Cloud Compute")
        {
          rejectCoded(invoke, "pcc_required", "On-device generation required Private Cloud Compute")
          return
        }
        rejectCoded(invoke, "inference_failed", message)
      }
    }
  }
  #endif
}
