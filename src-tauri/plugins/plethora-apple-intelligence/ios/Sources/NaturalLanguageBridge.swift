// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// G — add-apple-naturallanguage-embeddings

import Foundation
import NaturalLanguage
import Tauri

struct NlEmbedArgs: Decodable {
  var texts: [String]?
  var language: String?
}

final class AppleNaturalLanguageBridge {
  func featureState() -> FeatureStatePayload {
    if #available(iOS 17.0, *) {
      return FeatureStatePayload.available()
    }
    if NLEmbedding.wordEmbedding(for: .english) != nil {
      return FeatureStatePayload.available()
    }
    return FeatureStatePayload.unavailable("unsupported_os")
  }

  func status(_ invoke: Invoke) {
    let state = featureState()
    var obj: JSObject = [
      "status": state.status,
      "provider": "naturallanguage",
      "revision": "nl-1",
    ]
    if let reason = state.reason { obj["reason"] = reason }
    invoke.resolve(obj)
  }

  func requestAssets(_ invoke: Invoke) {
    invoke.resolve(["ok": true, "status": featureState().status])
  }

  func embedTexts(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(NlEmbedArgs.self)
    let texts = args.texts ?? []
    let language = NLLanguage(rawValue: args.language ?? NLLanguage.english.rawValue)
    guard let embedding = NLEmbedding.sentenceEmbedding(for: language)
      ?? NLEmbedding.wordEmbedding(for: language)
    else {
      rejectCoded(invoke, "unsupported_language", "No NaturalLanguage embedding for locale")
      return
    }
    var vectors: [[Double]] = []
    for text in texts {
      if let vec = embedding.vector(for: text) {
        vectors.append(vec.map { Double($0) })
      } else {
        let tokens = text.split { $0.isWhitespace }
        var acc: [Double] = []
        var n = 0
        for token in tokens {
          guard let v = embedding.vector(for: String(token)) else { continue }
          if acc.isEmpty { acc = v.map { Double($0) } }
          else {
            for i in 0..<min(acc.count, v.count) { acc[i] += Double(v[i]) }
          }
          n += 1
        }
        if n > 0 {
          vectors.append(acc.map { $0 / Double(n) })
        } else {
          vectors.append(Array(repeating: 0, count: embedding.dimension))
        }
      }
    }
    invoke.resolve([
      "vectors": vectors,
      "dimension": embedding.dimension,
      "provider": "naturallanguage",
      "language": language.rawValue,
      "revision": "nl-1",
    ])
  }
}
