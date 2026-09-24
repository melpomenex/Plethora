// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// iOS implementation of the Apple on-device intelligence Tauri plugin.
// Deployment target stays iOS 14; iOS 17/18/26/27 APIs are gated.

import Foundation
import Tauri
import UIKit

struct EmptyArgs: Decodable {}

struct FeatureStatePayload {
  let status: String
  let reason: String?

  func asObject() -> JSObject {
    var obj: JSObject = ["status": status]
    if let reason {
      obj["reason"] = reason
    }
    return obj
  }

  static func unavailable(_ reason: String) -> FeatureStatePayload {
    FeatureStatePayload(status: "unavailable", reason: reason)
  }

  static func available() -> FeatureStatePayload {
    FeatureStatePayload(status: "available", reason: nil)
  }
}

func rejectCoded(_ invoke: Invoke, _ code: String, _ message: String) {
  invoke.reject("\(code): \(message)")
}

public class AppleIntelligencePlugin: Plugin {
  let speech = AppleSpeechBridge()
  let vision = AppleVisionBridge()
  let spotlight = AppleSpotlightBridge()
  let nl = AppleNaturalLanguageBridge()
  let foundation = AppleFoundationModelsBridge()
  let coreAI = AppleCoreAIBridge()
  let translation = AppleTranslationBridge()

  override public init() {
    super.init()
    foundation.plugin = self
  }

  @objc public func capabilities(_ invoke: Invoke) throws {
    let _ = try? invoke.parseArgs(EmptyArgs.self)
    let snap = currentSnapshot()
    invoke.resolve(snap)
  }

  @objc public func fmAvailability(_ invoke: Invoke) throws { foundation.availability(invoke) }
  @objc public func fmGenerate(_ invoke: Invoke) throws { try foundation.generate(invoke) }
  @objc public func fmGenerateStream(_ invoke: Invoke) throws { try foundation.generateStream(invoke) }
  @objc public func fmCancel(_ invoke: Invoke) throws { try foundation.cancel(invoke) }
  @objc public func fmCountTokens(_ invoke: Invoke) throws { try foundation.countTokens(invoke) }
  @objc public func fmWarmup(_ invoke: Invoke) throws { foundation.warmup(invoke) }

  @objc public func speechStatus(_ invoke: Invoke) throws { speech.status(invoke) }
  @objc public func speechEnsureAssets(_ invoke: Invoke) throws { speech.ensureAssets(invoke) }
  @objc public func speechTranscribeFile(_ invoke: Invoke) throws { try speech.transcribeFile(invoke) }
  @objc public func speechStartLive(_ invoke: Invoke) throws { try speech.startLive(invoke) }
  @objc public func speechStopLive(_ invoke: Invoke) throws { speech.stopLive(invoke) }
  @objc public func speechCancel(_ invoke: Invoke) throws { speech.cancel(invoke) }

  @objc public func visionStatus(_ invoke: Invoke) throws { vision.status(invoke) }
  @objc public func visionPresentScanner(_ invoke: Invoke) throws { vision.presentScanner(invoke) }
  @objc public func visionRecognizeDocument(_ invoke: Invoke) throws { try vision.recognizeDocument(invoke) }
  @objc public func visionCancel(_ invoke: Invoke) throws { vision.cancel(invoke) }

  @objc public func spotlightStatus(_ invoke: Invoke) throws { spotlight.status(invoke) }
  @objc public func spotlightDonate(_ invoke: Invoke) throws { try spotlight.donate(invoke) }
  @objc public func spotlightDelete(_ invoke: Invoke) throws { try spotlight.delete(invoke) }
  @objc public func spotlightDeleteDomain(_ invoke: Invoke) throws { try spotlight.deleteDomain(invoke) }
  @objc public func spotlightQuery(_ invoke: Invoke) throws { try spotlight.query(invoke) }
  @objc public func spotlightRebuild(_ invoke: Invoke) throws { spotlight.rebuild(invoke) }

  @objc public func nlStatus(_ invoke: Invoke) throws { nl.status(invoke) }
  @objc public func nlRequestAssets(_ invoke: Invoke) throws { nl.requestAssets(invoke) }
  @objc public func nlEmbedTexts(_ invoke: Invoke) throws { try nl.embedTexts(invoke) }

  @objc public func coreaiStatus(_ invoke: Invoke) throws { coreAI.status(invoke) }
  @objc public func coreaiCatalog(_ invoke: Invoke) throws { coreAI.catalog(invoke) }
  @objc public func coreaiDownloadStart(_ invoke: Invoke) throws { try coreAI.downloadStart(invoke) }
  @objc public func coreaiDownloadCancel(_ invoke: Invoke) throws { coreAI.downloadCancel(invoke) }
  @objc public func coreaiInstallCommit(_ invoke: Invoke) throws { coreAI.installCommit(invoke) }
  @objc public func coreaiDelete(_ invoke: Invoke) throws { try coreAI.delete(invoke) }
  @objc public func coreaiSetActive(_ invoke: Invoke) throws { try coreAI.setActive(invoke) }
  @objc public func coreaiSessionStart(_ invoke: Invoke) throws { try coreAI.sessionStart(invoke) }
  @objc public func coreaiPrompt(_ invoke: Invoke) throws { try coreAI.prompt(invoke) }
  @objc public func coreaiCancel(_ invoke: Invoke) throws { coreAI.cancel(invoke) }
  @objc public func coreaiCountTokens(_ invoke: Invoke) throws { try coreAI.countTokens(invoke) }
  @objc public func coreaiWarmup(_ invoke: Invoke) throws { coreAI.warmup(invoke) }

  @objc public func translateSentence(_ invoke: Invoke) throws { try translation.translate(invoke) }

  private func currentSnapshot() -> JSObject {
    let fm = foundation.featureState()
    let speechState = speech.featureState()
    let visionState = vision.featureState()
    let spotlightState = spotlight.featureState()
    let nlState = nl.featureState()
    let core = coreAI.featureState()
    var snap: JSObject = [
      "appleOs": true,
      "foundationModels": fm.asObject(),
      "speech": speechState.asObject(),
      "visionDocuments": visionState.asObject(),
      "spotlightSemantic": spotlightState.asObject(),
      "naturalLanguageEmbeddings": nlState.asObject(),
      "coreAi": core.asObject(),
      "checkedAt": Int(Date().timeIntervalSince1970 * 1000),
    ]
    if let reason = fm.reason {
      snap["foundationReason"] = reason
    }
    return snap
  }
}

@_cdecl("init_plugin_plethora_apple_intelligence")
func initPlugin() -> Plugin {
  return AppleIntelligencePlugin()
}
