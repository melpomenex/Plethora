// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// E — add-apple-speech-transcription

import AVFoundation
import Foundation
import Speech
import Tauri

struct SpeechFileArgs: Decodable {
  var path: String?
  var locale: String?
}

final class AppleSpeechBridge: NSObject {
  private var liveTask: SFSpeechRecognitionTask?
  private var liveEngine: AVAudioEngine?
  private var liveRequest: SFSpeechAudioBufferRecognitionRequest?
  private var liveSegments: [[String: Any]] = []

  func featureState() -> FeatureStatePayload {
    if #available(iOS 26.0, *) {
      return SFSpeechRecognizer.authorizationStatus() == .denied
        ? FeatureStatePayload.unavailable("permission_denied")
        : FeatureStatePayload.available()
    }
    if SFSpeechRecognizer() != nil {
      return FeatureStatePayload.available()
    }
    return FeatureStatePayload.unavailable("unsupported_os")
  }

  func status(_ invoke: Invoke) {
    let state = featureState()
    var obj: JSObject = ["status": state.status]
    if let reason = state.reason { obj["reason"] = reason }
    invoke.resolve(obj)
  }

  func ensureAssets(_ invoke: Invoke) {
    invoke.resolve(["ok": true, "status": featureState().status])
  }

  func transcribeFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpeechFileArgs.self)
    guard let path = args.path, !path.isEmpty else {
      rejectCoded(invoke, "invalid_argument", "Missing audio path")
      return
    }
    let locale = Locale(identifier: args.locale ?? Locale.current.identifier)
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
      rejectCoded(invoke, "unsupported_language", "Speech locale not supported")
      return
    }
    let url = URL(fileURLWithPath: path)
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false
    recognizer.recognitionTask(with: request) { result, error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      guard let result, result.isFinal else { return }
      let text = result.bestTranscription.formattedString
      var segments: [JSObject] = []
      for (i, seg) in result.bestTranscription.segments.enumerated() {
        segments.append([
          "id": "seg-\(i)",
          "text": seg.substring,
          "startMs": Int(seg.timestamp * 1000),
          "endMs": Int((seg.timestamp + seg.duration) * 1000),
        ])
      }
      invoke.resolve([
        "text": text,
        "segments": segments,
        "source": "measured",
      ])
    }
  }

  func startLive(_ invoke: Invoke) throws {
    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else {
        rejectCoded(invoke, "permission_denied", "Speech recognition not authorized")
        return
      }
      do {
        try self.beginLive()
        invoke.resolve(["ok": true])
      } catch {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
      }
    }
  }

  func stopLive(_ invoke: Invoke) {
    liveTask?.finish()
    teardownLive()
    invoke.resolve(["text": joinedText(), "segments": liveSegments])
  }

  func cancel(_ invoke: Invoke) {
    liveTask?.cancel()
    teardownLive()
    invoke.resolve(["ok": true])
  }

  private func beginLive() throws {
    teardownLive()
    liveSegments = []
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }
    guard let recognizer = SFSpeechRecognizer() else {
      throw NSError(domain: "plethora-apple-intelligence", code: 1)
    }
    liveTask = recognizer.recognitionTask(with: request) { [weak self] result, _ in
      guard let self, let result else { return }
      self.liveSegments = result.bestTranscription.segments.enumerated().map { i, seg in
        [
          "id": "seg-\(i)",
          "text": seg.substring,
          "startMs": Int(seg.timestamp * 1000),
          "endMs": Int((seg.timestamp + seg.duration) * 1000),
        ]
      }
    }
    engine.prepare()
    try engine.start()
    liveEngine = engine
    liveRequest = request
  }

  private func teardownLive() {
    liveRequest?.endAudio()
    liveEngine?.inputNode.removeTap(onBus: 0)
    liveEngine?.stop()
    liveEngine = nil
    liveRequest = nil
    liveTask = nil
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  private func joinedText() -> String {
    liveSegments.compactMap { $0["text"] as? String }.joined(separator: " ")
  }
}
