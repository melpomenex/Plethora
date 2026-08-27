// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Tauri

#if canImport(Translation)
import Translation
#endif

struct AppleTranslateRequest: Decodable {
  let text: String
  let sourceLanguage: String
  let targetLanguage: String
}

struct AppleTranslateEnvelope: Decodable {
  let request: AppleTranslateRequest
}

final class AppleTranslationBridge {
  func translate(_ invoke: Invoke) throws {
    let request = try invoke.parseArgs(AppleTranslateEnvelope.self).request
    guard #available(iOS 17.4, macOS 15.0, *) else {
      rejectCoded(invoke, "platform_unsupported", "Apple Translation requires iOS 17.4+ or macOS 15+")
      return
    }
    #if canImport(Translation)
    Task {
      do {
        let source = Locale.Language(identifier: request.sourceLanguage)
        let target = Locale.Language(identifier: request.targetLanguage)
        let session = TranslationSession(installedSource: source, target: target)
        let response = try await session.translate(request.text)
        invoke.resolve(["translatedText": response.targetText])
      } catch {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
      }
    }
    #else
    rejectCoded(invoke, "platform_unsupported", "Translation framework unavailable")
    #endif
  }
}
