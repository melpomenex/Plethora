// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// Shared Foundation Models bridge logic for iOS and macOS.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

public struct FmFeatureState: Codable, Sendable {
  public let status: String
  public let reason: String?

  public static func available() -> FmFeatureState {
    FmFeatureState(status: "available", reason: nil)
  }

  public static func unavailable(_ reason: String) -> FmFeatureState {
    FmFeatureState(status: "unavailable", reason: reason)
  }

  public static func downloading(_ reason: String = "model_not_ready") -> FmFeatureState {
    FmFeatureState(status: "downloading", reason: reason)
  }
}

public struct FmGenerateRequest: Codable, Sendable {
  public var requestId: String?
  public var text: String?
  public var systemInstruction: String?
  public var maxOutputTokens: Int?
  public var temperature: Double?
  public var schemaName: String?
  public var structured: Bool?
}

public struct FmGenerateResponse: Codable, Sendable {
  public var requestId: String
  public var text: String
  public var structured: Bool?
}

public struct FmTokenCountResponse: Codable, Sendable {
  public var inputTokens: Int
  public var tokenLimit: Int
  public var contextSize: Int?
}

public enum FmBridgeError: Error, Sendable {
  case coded(String, String)

  public var code: String {
    switch self {
    case .coded(let code, _): return code
    }
  }

  public var message: String {
    switch self {
    case .coded(_, let message): return message
    }
  }
}

@available(iOS 26.0, macOS 26.0, *)
public actor FmBridgeCore {
  private var cancelled = Set<String>()
  private var tasks: [String: Task<String, Error>] = [:]

  public init() {}

  public func featureState() -> FmFeatureState {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      let availability = SystemLanguageModel.default.availability
      switch availability {
      case .available:
        return .available()
      case .unavailable(let reason):
        switch reason {
        case .modelNotReady:
          return .downloading("model_not_ready")
        case .deviceNotEligible:
          return .unavailable("device_not_eligible")
        case .appleIntelligenceNotEnabled:
          return .unavailable("apple_intelligence_disabled")
        @unknown default:
          return .unavailable("unavailable")
        }
      @unknown default:
        return .unavailable("unavailable")
      }
    }
    #endif
    return .unavailable("unsupported_os")
  }

  public func availabilityDetail() async -> [String: Any] {
    let state = featureState()
    var result: [String: Any] = ["status": state.status]
    if let reason = state.reason {
      result["reason"] = reason
    }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *), state.status == "available" {
      let model = SystemLanguageModel.default
      result["contextSize"] = model.contextSize
      result["tokenLimit"] = model.contextSize
    } else {
      result["tokenLimit"] = 4096
    }
    #else
    result["tokenLimit"] = 4096
    #endif
    return result
  }

  public func cancel(requestId: String) {
    cancelled.insert(requestId)
    tasks[requestId]?.cancel()
    tasks.removeValue(forKey: requestId)
  }

  public typealias PartialHandler = @Sendable (String) -> Void

  public func warmup() async {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      let model = SystemLanguageModel.default
      guard case .available = model.availability else { return }
      let session = LanguageModelSession(model: model)
      session.prewarm()
    }
    #endif
  }

  public func countTokens(_ args: FmGenerateRequest) async throws -> FmTokenCountResponse {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      let model = SystemLanguageModel.default
      let prompt = args.text ?? ""
      let instructions = args.systemInstruction ?? ""
      if #available(iOS 26.4, macOS 26.4, *) {
        var total = 0
        if !instructions.isEmpty {
          total += try await model.tokenCount(for: instructions)
        }
        if !prompt.isEmpty {
          total += try await model.tokenCount(for: prompt)
        }
        return FmTokenCountResponse(
          inputTokens: max(1, total),
          tokenLimit: model.contextSize,
          contextSize: model.contextSize
        )
      }
      let text = instructions + prompt
      let estimate = max(1, text.split { $0.isWhitespace || $0.isNewline }.count)
      return FmTokenCountResponse(
        inputTokens: estimate,
        tokenLimit: model.contextSize,
        contextSize: model.contextSize
      )
    }
    #endif
    let text = (args.systemInstruction ?? "") + (args.text ?? "")
    let estimate = max(1, text.split { $0.isWhitespace || $0.isNewline }.count)
    return FmTokenCountResponse(inputTokens: estimate, tokenLimit: 4096, contextSize: nil)
  }

  public func generate(_ args: FmGenerateRequest) async throws -> FmGenerateResponse {
    let requestId = args.requestId ?? UUID().uuidString
    let task = Task {
      try await self.generateInner(args, requestId: requestId, onPartial: nil)
    }
    tasks[requestId] = task
    defer { tasks.removeValue(forKey: requestId) }
    let text = try await task.value
    return FmGenerateResponse(requestId: requestId, text: text, structured: args.structured)
  }

  public func generateStream(
    _ args: FmGenerateRequest,
    onPartial: @escaping PartialHandler
  ) async throws -> FmGenerateResponse {
    let requestId = args.requestId ?? UUID().uuidString
    let task = Task {
      try await self.generateInner(args, requestId: requestId, onPartial: onPartial)
    }
    tasks[requestId] = task
    defer { tasks.removeValue(forKey: requestId) }
    let text = try await task.value
    return FmGenerateResponse(requestId: requestId, text: text, structured: args.structured)
  }

  private func generateInner(
    _ args: FmGenerateRequest,
    requestId: String,
    onPartial: PartialHandler?
  ) async throws -> String {
    try Task.checkCancellation()
    if cancelled.contains(requestId) {
      throw FmBridgeError.coded("cancelled", "Request cancelled")
    }

    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
    let model = SystemLanguageModel.default
    let availability = model.availability
    guard case .available = availability else {
      let state = featureState()
      throw FmBridgeError.coded(state.reason ?? "unavailable", "Foundation Models unavailable")
    }

    let prompt = args.text ?? ""
    var options = GenerationOptions()
    if let maxOut = args.maxOutputTokens {
      options.maximumResponseTokens = maxOut
    }
    if let temp = args.temperature {
      options.temperature = temp
    }

    let session: LanguageModelSession
    if let instructions = args.systemInstruction, !instructions.isEmpty {
      session = LanguageModelSession(model: model, instructions: instructions)
    } else {
      session = LanguageModelSession(model: model)
    }

    if args.structured == true, let schemaName = args.schemaName {
      return try await generateStructured(
        session: session,
        prompt: prompt,
        schemaName: schemaName,
        options: options,
        requestId: requestId,
        onPartial: onPartial
      )
    }

    if let onPartial {
      var accumulated = ""
      let stream = session.streamResponse(to: prompt, options: options)
      for try await snapshot in stream {
        try Task.checkCancellation()
        if cancelled.contains(requestId) {
          throw FmBridgeError.coded("cancelled", "Request cancelled")
        }
        accumulated = snapshot.content
        onPartial(accumulated)
      }
      return accumulated
    }

    let response = try await session.respond(to: prompt, options: options)
    if cancelled.contains(requestId) {
      throw FmBridgeError.coded("cancelled", "Request cancelled")
    }
    return response.content
    }
    #endif
    throw FmBridgeError.coded("unsupported_os", "Foundation Models require OS 26+")
  }

  @available(iOS 26.0, macOS 26.0, *)
  private func generateStructured(
    session: LanguageModelSession,
    prompt: String,
    schemaName: String,
    options: GenerationOptions,
    requestId: String,
    onPartial: PartialHandler?
  ) async throws -> String {
    switch schemaName {
    case "smartTagging":
      let response = try await session.respond(to: prompt, generating: AppleFmSmartTaggingOutput.self, options: options)
      if cancelled.contains(requestId) { throw FmBridgeError.coded("cancelled", "Request cancelled") }
      let json = response.rawContent.jsonString
      onPartial?(json)
      return json
    case "libraryAnswer":
      let response = try await session.respond(to: prompt, generating: AppleFmLibraryAnswer.self, options: options)
      if cancelled.contains(requestId) { throw FmBridgeError.coded("cancelled", "Request cancelled") }
      let json = response.rawContent.jsonString
      onPartial?(json)
      return json
    case "generatedFlashcards":
      let response = try await session.respond(to: prompt, generating: AppleFmFlashcardsOutput.self, options: options)
      if cancelled.contains(requestId) { throw FmBridgeError.coded("cancelled", "Request cancelled") }
      let json = response.rawContent.jsonString
      onPartial?(json)
      return json
    default:
      throw FmBridgeError.coded("unsupported_schema", "Unknown structured schema: \(schemaName)")
    }
  }

  public func mapError(_ error: Error) -> FmBridgeError {
    if let fm = error as? FmBridgeError { return fm }
    let message = error.localizedDescription
    if message.localizedCaseInsensitiveContains("private cloud")
      || message.localizedCaseInsensitiveContains("Private Cloud Compute") {
      return .coded("pcc_required", "On-device generation required Private Cloud Compute")
    }
    if let genError = error as? LanguageModelSession.GenerationError {
      switch genError {
      case .refusal(_, _):
        return .coded("safety_blocked", "Generation blocked by safety guardrails")
      case .unsupportedLanguageOrLocale(_):
        return .coded("unsupported_language", "Unsupported language for Apple Intelligence")
      case .exceededContextWindowSize(_):
        return .coded("context_too_large", "Input exceeds context window")
      default:
        return .coded("inference_failed", message)
      }
    }
    return .coded("inference_failed", message)
  }
}
