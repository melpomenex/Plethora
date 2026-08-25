// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// macOS desktop C ABI bridge to FoundationModels.

import Foundation

private let core = FmBridgeCore()

public typealias plethora_fm_stream_cb = @convention(c) (
  UnsafePointer<CChar>?,
  UnsafePointer<CChar>?,
  UnsafeMutableRawPointer?
) -> Void

private func jsonString(_ obj: Any) -> String {
  guard JSONSerialization.isValidJSONObject(obj),
        let data = try? JSONSerialization.data(withJSONObject: obj),
        let str = String(data: data, encoding: .utf8) else {
    return "{}"
  }
  return str
}

private func errorJson(code: String, message: String, requestId: String = "") -> String {
  jsonString(["code": code, "message": message, "requestId": requestId])
}

private func decodeArgs(_ json: UnsafePointer<CChar>?) -> FmGenerateRequest? {
  guard let json, let data = String(cString: json).data(using: .utf8) else { return FmGenerateRequest() }
  return try? JSONDecoder().decode(FmGenerateRequest.self, from: data)
}

private func strdupJson(_ str: String) -> UnsafeMutablePointer<CChar>? {
  str.withCString { cstr in
    let len = strlen(cstr) + 1
    let buf = UnsafeMutablePointer<CChar>.allocate(capacity: len)
    buf.initialize(from: cstr, count: len)
    return buf
  }
}

@_cdecl("plethora_fm_availability")
public func plethora_fm_availability() -> UnsafeMutablePointer<CChar>? {
  let sem = DispatchSemaphore(value: 0)
  var result = "{}"
  Task {
    let detail = await core.availabilityDetail()
    result = jsonString(detail)
    sem.signal()
  }
  sem.wait()
  return strdupJson(result)
}

@_cdecl("plethora_fm_generate")
public func plethora_fm_generate(_ argsJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  let args = decodeArgs(argsJson) ?? FmGenerateRequest()
  let sem = DispatchSemaphore(value: 0)
  var result = errorJson(code: "inference_failed", message: "Unknown error")
  Task {
    do {
      let response = try await core.generate(args)
      let data = try JSONEncoder().encode(response)
      result = String(data: data, encoding: .utf8) ?? result
    } catch {
      let mapped = await core.mapError(error)
      result = errorJson(code: mapped.code, message: mapped.message)
    }
    sem.signal()
  }
  sem.wait()
  return strdupJson(result)
}

@_cdecl("plethora_fm_generate_stream")
public func plethora_fm_generate_stream(
  _ argsJson: UnsafePointer<CChar>?,
  _ cb: plethora_fm_stream_cb?,
  _ ctx: UnsafeMutableRawPointer?
) -> UnsafeMutablePointer<CChar>? {
  guard let cb else {
    return strdupJson(errorJson(code: "invalid_argument", message: "Missing stream callback"))
  }
  let args = decodeArgs(argsJson) ?? FmGenerateRequest()
  let sem = DispatchSemaphore(value: 0)
  var result = "{}"
  Task {
    do {
      let response = try await core.generateStream(args) { partial in
        let payload = jsonString(["requestId": args.requestId ?? "", "text": partial])
        cb("text", payload, ctx)
      }
      let data = try JSONEncoder().encode(response)
      let payload = String(data: data, encoding: .utf8) ?? "{}"
      cb("complete", payload, ctx)
      result = "{}"
    } catch {
      let mapped = await core.mapError(error)
      cb("error", errorJson(code: mapped.code, message: mapped.message, requestId: args.requestId ?? ""), ctx)
      result = errorJson(code: mapped.code, message: mapped.message)
    }
    sem.signal()
  }
  sem.wait()
  return strdupJson(result)
}

@_cdecl("plethora_fm_cancel")
public func plethora_fm_cancel(_ argsJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  if let argsJson, let data = String(cString: argsJson).data(using: .utf8),
     let obj = try? JSONDecoder().decode([String: String].self, from: data),
     let requestId = obj["requestId"] {
    Task { await core.cancel(requestId: requestId) }
  }
  return strdupJson(jsonString(["ok": true]))
}

@_cdecl("plethora_fm_count_tokens")
public func plethora_fm_count_tokens(_ argsJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  let args = decodeArgs(argsJson) ?? FmGenerateRequest()
  let sem = DispatchSemaphore(value: 0)
  var result = "{}"
  Task {
    do {
      let count = try await core.countTokens(args)
      let data = try JSONEncoder().encode(count)
      result = String(data: data, encoding: .utf8) ?? result
    } catch {
      let mapped = await core.mapError(error)
      result = errorJson(code: mapped.code, message: mapped.message)
    }
    sem.signal()
  }
  sem.wait()
  return strdupJson(result)
}

@_cdecl("plethora_fm_warmup")
public func plethora_fm_warmup() -> UnsafeMutablePointer<CChar>? {
  let sem = DispatchSemaphore(value: 0)
  Task {
    await core.warmup()
    sem.signal()
  }
  sem.wait()
  return strdupJson(jsonString(["ok": true]))
}

@_cdecl("plethora_fm_free_string")
public func plethora_fm_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
  ptr?.deallocate()
}
