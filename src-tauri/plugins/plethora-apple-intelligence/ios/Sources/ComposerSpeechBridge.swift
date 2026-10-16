import AVFoundation
import Foundation
import Speech
import Tauri
import UIKit

struct SpeechLiveArgs: Decodable {
  var purpose: String?
  var sessionId: String?
  var locale: String?
  var requireOnDevice: Bool?
  var networkConsent: Bool?
}

/** Ephemeral composer capture. Every callback is guarded by a fresh generation. */
final class ComposerSpeechBridge {
  private var owner: String?
  private var generation = UUID()
  private var engine: AVAudioEngine?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapInstalled = false
  private var startInvoke: Invoke?
  private var stopInvoke: Invoke?
  private var timer: DispatchWorkItem?
  private var text: String?
  private var failure: String?
  private var finalizing = false
  private var observers: [NSObjectProtocol] = []
  private let legacyBusy: () -> Bool
  var busy: Bool { owner != nil }

  init(legacyBusy: @escaping () -> Bool) {
    self.legacyBusy = legacyBusy
    for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
        if note.name == AVAudioSession.interruptionNotification,
           let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
           type != AVAudioSession.InterruptionType.began.rawValue { return }
        self?.invalidate("interrupted")
      })
    }
  }
  deinit { observers.forEach(NotificationCenter.default.removeObserver); timer?.cancel() }
  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }
  private func after(_ seconds: Double, _ work: @escaping () -> Void) {
    timer?.cancel()
    let item = DispatchWorkItem(block: work); timer = item
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
  }
  func status(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpeechLiveArgs.self)
    onMain {
      let locale = Locale(identifier: args.locale ?? Locale.current.identifier)
      let recognizer = SFSpeechRecognizer(locale: locale)
      let local = recognizer?.supportsOnDeviceRecognition == true
      let microphone: String
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: microphone = "granted"
      case .denied: microphone = "denied"
      default: microphone = "prompt"
      }
      let speech: String
      switch SFSpeechRecognizer.authorizationStatus() {
      case .authorized: speech = "granted"
      case .denied, .restricted: speech = "denied"
      default: speech = "prompt"
      }
      invoke.resolve(["platform": "ios", "available": recognizer?.isAvailable == true,
        "locale": locale.identifier, "processing": local ? "on-device" : "system-service",
        "microphonePermission": microphone, "speechPermission": speech])
    }
  }
  func start(_ invoke: Invoke, _ args: SpeechLiveArgs) {
    onMain {
      guard self.owner == nil, !self.legacyBusy() else { rejectCoded(invoke, "busy", "Microphone is already owned"); return }
      guard let id = args.sessionId, !id.isEmpty, id.count <= 128 else { rejectCoded(invoke, "cancelled", "Invalid dictation session"); return }
      let locale = Locale(identifier: args.locale ?? Locale.current.identifier)
      guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else { rejectCoded(invoke, "unavailable", "Speech locale unavailable"); return }
      let local = recognizer.supportsOnDeviceRecognition
      guard local || (args.requireOnDevice != true && args.networkConsent == true) else { rejectCoded(invoke, "unavailable", "On-device recognition required or network disclosure declined"); return }
      self.owner = id; self.generation = UUID(); let generation = self.generation
      self.startInvoke = invoke; self.text = nil; self.failure = nil; self.finalizing = false
      self.after(10) { [weak self] in if self?.generation == generation { self?.invalidate("timeout") } }
      AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
        self?.onMain {
          guard let self, self.generation == generation, self.owner == id else { return }
          guard granted else { self.invalidate("denied"); return }
          SFSpeechRecognizer.requestAuthorization { [weak self] status in
            self?.onMain {
              guard let self, self.generation == generation, self.owner == id else { return }
              guard status == .authorized else { self.invalidate("denied"); return }
              do { try self.begin(recognizer, local: local, generation: generation) }
              catch { self.invalidate("unavailable") }
            }
          }
        }
      }
    }
  }
  private func begin(_ recognizer: SFSpeechRecognizer, local: Bool, generation: UUID) throws {
    let audio = AVAudioSession.sharedInstance()
    try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
    try audio.setActive(true, options: .notifyOthersOnDeactivation)
    let engine = AVAudioEngine(); self.engine = engine
    let request = SFSpeechAudioBufferRecognitionRequest(); self.request = request
    request.requiresOnDeviceRecognition = local; request.shouldReportPartialResults = false
    let input = engine.inputNode
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
    tapInstalled = true
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      self?.onMain {
        guard let self, self.generation == generation, self.owner != nil, self.text == nil, self.failure == nil else { return }
        if let result, result.isFinal {
          let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
          self.finish(text.isEmpty ? nil : text, error: text.isEmpty ? "no-speech" : nil)
        } else if error != nil { self.finish(nil, error: "unavailable") }
      }
    }
    engine.prepare(); try engine.start()
    startInvoke?.resolve(["ok": true]); startInvoke = nil
    after(60) { [weak self] in guard let self, self.generation == generation else { return }; self.finalize() }
  }
  func stop(_ invoke: Invoke, id: String?) {
    onMain {
      guard let id, self.owner == id else { rejectCoded(invoke, "cancelled", "Session is no longer active"); return }
      guard self.stopInvoke == nil else { rejectCoded(invoke, "busy", "Finalization already requested"); return }
      self.stopInvoke = invoke
      if self.text != nil || self.failure != nil { self.deliver(); return }
      self.finalize()
    }
  }
  private func endAudio() {
    request?.endAudio()
    if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine?.stop(); engine = nil
  }
  private func finalize() {
    guard owner != nil, !finalizing, text == nil, failure == nil else { return }
    finalizing = true; endAudio(); task?.finish()
    let generation = self.generation
    after(5) { [weak self] in if self?.generation == generation { self?.finish(nil, error: "timeout") } }
  }
  private func releaseAudio() {
    endAudio(); task?.cancel(); task = nil; request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
  private func finish(_ text: String?, error: String?) {
    guard owner != nil, self.text == nil, failure == nil else { return }
    self.text = text; failure = error; timer?.cancel(); releaseAudio()
    if let pending = startInvoke { startInvoke = nil; rejectCoded(pending, error ?? "interrupted", "Recognition ended before capture was ready") }
    if stopInvoke != nil { deliver() }
    else {
      let generation = self.generation
      after(30) { [weak self] in if self?.generation == generation { self?.invalidate("cancelled") } }
    }
  }
  private func deliver() {
    guard let invoke = stopInvoke else { return }
    stopInvoke = nil; timer?.cancel()
    if let failure { rejectCoded(invoke, failure, "Dictation ended: \(failure)") }
    else { invoke.resolve(["text": text ?? ""]) }
    owner = nil; generation = UUID(); text = nil; failure = nil
  }
  func cancel(_ invoke: Invoke, id: String?) {
    onMain { if self.owner == id { self.invalidate("cancelled") }; invoke.resolve(["ok": true]) }
  }
  private func invalidate(_ error: String) {
    generation = UUID(); owner = nil; timer?.cancel(); releaseAudio()
    if let startInvoke { rejectCoded(startInvoke, error, "Dictation ended: \(error)") }
    if let stopInvoke { rejectCoded(stopInvoke, error, "Dictation ended: \(error)") }
    startInvoke = nil; stopInvoke = nil; text = nil; failure = nil; finalizing = false
  }
}
