// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// B — add-apple-foundation-models-provider (iOS wrapper over shared core)

import Foundation
import PlethoraAppleFoundationShared
import Tauri

struct FmGenerateArgs: Decodable {
  var requestId: String?
  var text: String?
  var systemInstruction: String?
  var maxOutputTokens: Int?
  var temperature: Double?
  var schemaName: String?
  var structured: Bool?
}

struct FmCancelArgs: Decodable {
  var requestId: String?
}

final class AppleFoundationModelsBridge {
  private let core = FmBridgeCore()

  func featureState() -> FeatureStatePayload {
    let sem = DispatchSemaphore(value: 0)
    var state = FeatureStatePayload.unavailable("unsupported_os")
    Task {
      state = Self.mapState(await core.featureState())
      sem.signal()
    }
    sem.wait()
    return state
  }

  func availability(_ invoke: Invoke) {
    Task {
      let detail = await core.availabilityDetail()
      invoke.resolve(detail)
    }
  }

  func generate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmGenerateArgs.self)
    Task {
      do {
        let request = Self.toRequest(args)
        let response = try await core.generate(request)
        invoke.resolve([
          "requestId": response.requestId,
          "text": response.text,
        ])
      } catch {
        let mapped = await core.mapError(error)
        rejectCoded(invoke, mapped.code, mapped.message)
      }
    }
  }

  func generateStream(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmGenerateArgs.self)
    Task {
      do {
        let request = Self.toRequest(args)
        let response = try await core.generateStream(request) { partial in
          invoke.emit("apple-fm://text", [
            "requestId": request.requestId ?? "",
            "text": partial,
          ])
        }
        invoke.resolve([
          "requestId": response.requestId,
          "text": response.text,
        ])
        invoke.emit("apple-fm://complete", [
          "requestId": response.requestId,
          "text": response.text,
        ])
      } catch {
        let mapped = await core.mapError(error)
        invoke.emit("apple-fm://error", [
          "requestId": args.requestId ?? "",
          "code": mapped.code,
          "message": mapped.message,
        ])
        rejectCoded(invoke, mapped.code, mapped.message)
      }
    }
  }

  func cancel(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmCancelArgs.self)
    if let id = args.requestId {
      Task { await core.cancel(requestId: id) }
    }
    invoke.resolve(["ok": true])
  }

  func countTokens(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FmGenerateArgs.self)
    Task {
      do {
        let count = try await core.countTokens(Self.toRequest(args))
        invoke.resolve([
          "inputTokens": count.inputTokens,
          "tokenLimit": count.tokenLimit,
          "contextSize": count.contextSize as Any,
        ])
      } catch {
        let mapped = await core.mapError(error)
        rejectCoded(invoke, mapped.code, mapped.message)
      }
    }
  }

  func warmup(_ invoke: Invoke) {
    Task {
      await core.warmup()
      invoke.resolve(["ok": true])
    }
  }

  private static func toRequest(_ args: FmGenerateArgs) -> FmGenerateRequest {
    FmGenerateRequest(
      requestId: args.requestId,
      text: args.text,
      systemInstruction: args.systemInstruction,
      maxOutputTokens: args.maxOutputTokens,
      temperature: args.temperature,
      schemaName: args.schemaName,
      structured: args.structured
    )
  }

  private static func mapState(_ state: FmFeatureState) -> FeatureStatePayload {
    FeatureStatePayload(status: state.status, reason: state.reason)
  }
}
