// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import Foundation

#if canImport(Translation)
import Translation
#endif

private struct AppleTranslatePayload: Decodable {
  let text: String
  let sourceLanguage: String
  let targetLanguage: String
}

private struct AppleTranslateEnvelope: Decodable {
  let request: AppleTranslatePayload
}

@_cdecl("plethora_translate_sentence")
public func plethora_translate_sentence(_ argsJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  guard let argsJson else { return strdupJson(errorJson(code: "invalid_argument", message: "Missing args")) }
  let raw = String(cString: argsJson)
  guard let data = raw.data(using: .utf8),
        let envelope = try? JSONDecoder().decode(AppleTranslateEnvelope.self, from: data) else {
    return strdupJson(errorJson(code: "invalid_argument", message: "Invalid translate args"))
  }
  guard #available(macOS 15.0, *) else {
    return strdupJson(errorJson(code: "platform_unsupported", message: "Apple Translation requires macOS 15+"))
  }
  #if canImport(Translation)
  let sem = DispatchSemaphore(value: 0)
  var result = errorJson(code: "inference_failed", message: "Unknown error")
  Task {
    do {
      let request = envelope.request
      let source = Locale.Language(identifier: request.sourceLanguage)
      let target = Locale.Language(identifier: request.targetLanguage)
      let session = TranslationSession(installedSource: source, target: target)
      let response = try await session.translate(request.text)
      result = jsonString(["translatedText": response.targetText])
    } catch {
      result = errorJson(code: "inference_failed", message: error.localizedDescription)
    }
    sem.signal()
  }
  sem.wait()
  return strdupJson(result)
  #else
  return strdupJson(errorJson(code: "platform_unsupported", message: "Translation framework unavailable"))
  #endif
}

private func jsonString(_ obj: Any) -> String {
  guard JSONSerialization.isValidJSONObject(obj),
        let data = try? JSONSerialization.data(withJSONObject: obj),
        let str = String(data: data, encoding: .utf8) else {
    return "{}"
  }
  return str
}

private func errorJson(code: String, message: String) -> String {
  jsonString(["code": code, "message": message])
}

private func strdupJson(_ str: String) -> UnsafeMutablePointer<CChar>? {
  str.withCString { cstr in
    let len = strlen(cstr) + 1
    let buf = UnsafeMutablePointer<CChar>.allocate(capacity: len)
    buf.initialize(from: cstr, count: len)
    return buf
  }
}
