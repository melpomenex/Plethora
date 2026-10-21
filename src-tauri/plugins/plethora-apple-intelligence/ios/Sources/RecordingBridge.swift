// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// Task 0.8: Apple disk-first recording adapter with rolling 5-second WAV parts and crash recovery.

import AVFoundation
import CommonCrypto
import Foundation
import Tauri
import UIKit

public struct AppleRecordingArgs: Decodable {
  var sessionId: String?
  var assetId: String?
  var writerEpoch: String?
  var sampleRate: Int?
  var channels: Int?
  var outputDir: String?
}

public struct AppleRecordingPartRecord {
  let sequence: Int64
  let relativePath: String
  let byteLength: Int64
  let sha256: String
  let startMs: Int64
  let durationMs: Int64
  let formatJson: String
  let committedAt: String
}

public final class AppleRecordingWriter {
  public static let maxPendingBytes: Int64 = 4 * 1024 * 1024 // 4 MiB bound per D2
  public static let wavHeaderSize: Int = 44

  public let managedRoot: URL
  public let partsDir: URL
  public let sessionId: String
  public let assetId: String
  public let writerEpoch: String
  public let sampleRate: Int
  public let channels: Int
  public let partDurationMs: Int64
  public let clock: () -> Date

  private let bytesPerSample: Int
  private let bytesPerSecond: Int
  private let targetPartBytes: Int64

  private var parts: [AppleRecordingPartRecord] = []
  private var currentSequence: Int64 = 0
  private var activeStartMs: Int64 = 0

  private var activeFileHandle: FileHandle?
  private var activePartialURL: URL?
  private var activeDataBytesWritten: Int64 = 0
  private var pendingBytes: Int64 = 0

  public let createdAtIso: String
  public private(set) var finalized: Bool = false

  public init(
    baseDir: URL,
    sessionId: String,
    assetId: String,
    writerEpoch: String,
    sampleRate: Int = 16000,
    channels: Int = 1,
    partDurationMs: Int64 = 5000,
    clock: @escaping () -> Date = { Date() }
  ) throws {
    self.baseDir = baseDir
    self.sessionId = sessionId
    self.assetId = assetId
    self.writerEpoch = writerEpoch
    self.sampleRate = sampleRate
    self.channels = channels
    self.partDurationMs = partDurationMs
    self.clock = clock

    self.bytesPerSample = channels * 2
    self.bytesPerSecond = sampleRate * bytesPerSample
    self.targetPartBytes = (partDurationMs * Int64(bytesPerSecond)) / 1000

    self.managedRoot = baseDir.appendingPathComponent(sessionId, isDirectory: true)
    self.partsDir = self.managedRoot.appendingPathComponent("parts", isDirectory: true)

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    self.createdAtIso = formatter.string(from: clock())

    try FileManager.default.createDirectory(at: self.partsDir, withIntermediateDirectories: true)
  }

  private let baseDir: URL

  public static func buildWavHeader(dataSize: Int32, sampleRate: Int32, channels: Int16) -> Data {
    var data = Data(count: wavHeaderSize)
    data.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
      guard let ptr = raw.baseAddress else { return }
      let byteRate = sampleRate * Int32(channels) * 2
      let blockAlign = channels * 2
      let totalSize = 36 + dataSize

      ptr.storeBytes(of: 0x46464952 as UInt32, as: UInt32.self) // "RIFF" BE/LE
      ptr.advanced(by: 4).storeBytes(of: totalSize.littleEndian, as: Int32.self)
      ptr.advanced(by: 8).storeBytes(of: 0x45564157 as UInt32, as: UInt32.self) // "WAVE"
      ptr.advanced(by: 12).storeBytes(of: 0x20746d66 as UInt32, as: UInt32.self) // "fmt "
      ptr.advanced(by: 16).storeBytes(of: Int32(16).littleEndian, as: Int32.self)
      ptr.advanced(by: 20).storeBytes(of: Int16(1).littleEndian, as: Int16.self) // PCM
      ptr.advanced(by: 22).storeBytes(of: channels.littleEndian, as: Int16.self)
      ptr.advanced(by: 24).storeBytes(of: sampleRate.littleEndian, as: Int32.self)
      ptr.advanced(by: 28).storeBytes(of: byteRate.littleEndian, as: Int32.self)
      ptr.advanced(by: 32).storeBytes(of: blockAlign.littleEndian, as: Int16.self)
      ptr.advanced(by: 34).storeBytes(of: Int16(16).littleEndian, as: Int16.self)
      ptr.advanced(by: 36).storeBytes(of: 0x61746164 as UInt32, as: UInt32.self) // "data"
      ptr.advanced(by: 40).storeBytes(of: dataSize.littleEndian, as: Int32.self)
    }
    return data
  }

  public static func computeSha256(url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var context = CC_SHA256_CTX()
    CC_SHA256_Init(&context)
    while true {
      let chunk = handle.readData(ofLength: 8192)
      if chunk.isEmpty { break }
      chunk.withUnsafeBytes { buffer in
        _ = CC_SHA256_Update(&context, buffer.baseAddress, CC_LONG(buffer.count))
      }
    }
    var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    CC_SHA256_Final(&digest, &context)
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  public func appendSamples(_ pcmData: Data) throws {
    guard !finalized else {
      throw NSError(domain: "AppleRecordingWriter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Already finalized"])
    }
    guard !pcmData.isEmpty else { return }

    if pendingBytes + Int64(pcmData.count) > AppleRecordingWriter.maxPendingBytes {
      throw NSError(domain: "AppleRecordingWriter", code: 2, userInfo: [NSLocalizedDescriptionKey: "backpressure_exceeded"])
    }

    var offset = 0
    var remaining = pcmData.count

    while remaining > 0 {
      try ensureActivePart()
      let spaceInPart = Int(max(0, targetPartBytes - activeDataBytesWritten))
      if spaceInPart <= 0 {
        try closeActivePart()
        try ensureActivePart()
        continue
      }

      let toWrite = min(remaining, spaceInPart)
      let subdata = pcmData.subdata(in: offset..<(offset + toWrite))
      activeFileHandle?.write(subdata)
      activeDataBytesWritten += Int64(toWrite)
      offset += toWrite
      remaining -= toWrite

      if activeDataBytesWritten >= targetPartBytes {
        try closeActivePart()
      }
    }
  }

  private func ensureActivePart() throws {
    if activeFileHandle != nil { return }

    let fileName = String(format: "part_%06d.bin", currentSequence)
    let partialURL = partsDir.appendingPathComponent("\(fileName).partial")
    if FileManager.default.fileExists(atPath: partialURL.path) {
      try? FileManager.default.removeItem(at: partialURL)
    }

    FileManager.default.createFile(atPath: partialURL.path, contents: nil)
    let handle = try FileHandle(forWritingTo: partialURL)
    let dummyHeader = AppleRecordingWriter.buildWavHeader(dataSize: 0, sampleRate: Int32(sampleRate), channels: Int16(channels))
    handle.write(dummyHeader)

    activeFileHandle = handle
    activePartialURL = partialURL
    activeDataBytesWritten = 0
  }

  public func closeActivePart() throws {
    guard let handle = activeFileHandle, let partialURL = activePartialURL else { return }

    let dataSize = Int32(activeDataBytesWritten)
    let realHeader = AppleRecordingWriter.buildWavHeader(dataSize: dataSize, sampleRate: Int32(sampleRate), channels: Int16(channels))
    try handle.seek(toOffset: 0)
    handle.write(realHeader)
    try handle.synchronize()
    try handle.close()

    activeFileHandle = nil
    activePartialURL = nil

    let finalName = String(format: "part_%06d.bin", currentSequence)
    let finalURL = partsDir.appendingPathComponent(finalName)
    if FileManager.default.fileExists(atPath: finalURL.path) {
      try? FileManager.default.removeItem(at: finalURL)
    }
    try FileManager.default.moveItem(at: partialURL, to: finalURL)

    let sha256 = try AppleRecordingWriter.computeSha256(url: finalURL)
    let durationMs = (activeDataBytesWritten * 1000) / Int64(bytesPerSecond)
    let formatJson = "{\"sampleRate\":\(sampleRate),\"channels\":\(channels),\"encoding\":\"pcm16le\"}"
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let committedAt = formatter.string(from: clock())
    let relativePath = "parts/\(finalName)"

    let fileAttrs = try FileManager.default.attributesOfItem(atPath: finalURL.path)
    let byteLength = (fileAttrs[.size] as? NSNumber)?.int64Value ?? Int64(dataSize + 44)

    let part = AppleRecordingPartRecord(
      sequence: currentSequence,
      relativePath: relativePath,
      byteLength: byteLength,
      sha256: sha256,
      startMs: activeStartMs,
      durationMs: durationMs,
      formatJson: formatJson,
      committedAt: committedAt
    )
    parts.append(part)
    activeStartMs += durationMs
    currentSequence += 1
    activeDataBytesWritten = 0

    try writeManifestAtomic()
  }

  public func flush(isFinal: Bool = false) throws {
    if activeFileHandle != nil && activeDataBytesWritten > 0 {
      try closeActivePart()
    } else if activeFileHandle != nil {
      try? activeFileHandle?.close()
      if let partialURL = activePartialURL {
        try? FileManager.default.removeItem(at: partialURL)
      }
      activeFileHandle = nil
      activePartialURL = nil
    }
    if isFinal {
      finalized = true
    }
    try writeManifestAtomic()
  }

  private func writeManifestAtomic() throws {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    var partsDicts: [[String: Any]] = []
    for p in parts {
      partsDicts.append([
        "sequence": p.sequence,
        "relativePath": p.relativePath,
        "byteLength": p.byteLength,
        "sha256": p.sha256,
        "startMs": p.startMs,
        "durationMs": p.durationMs,
        "formatJson": p.formatJson,
        "committedAt": p.committedAt,
      ])
    }

    let manifestDict: [String: Any] = [
      "manifestVersion": 1,
      "sessionId": sessionId,
      "assetId": assetId,
      "writerEpoch": writerEpoch,
      "mime": "audio/wav",
      "sampleRate": sampleRate,
      "channels": channels,
      "finalized": finalized,
      "createdAt": createdAtIso,
      "updatedAt": formatter.string(from: clock()),
      "parts": partsDicts,
    ]

    let jsonData = try JSONSerialization.data(withJSONObject: manifestDict, options: [.prettyPrinted])
    let manifestURL = managedRoot.appendingPathComponent("manifest.json")
    let tmpURL = managedRoot.appendingPathComponent("manifest.json.tmp")

    try jsonData.write(to: tmpURL, options: .atomic)
    if FileManager.default.fileExists(atPath: manifestURL.path) {
      try? FileManager.default.removeItem(at: manifestURL)
    }
    try FileManager.default.moveItem(at: tmpURL, to: manifestURL)
  }

  public func getAcknowledgedMs() -> Int64 { activeStartMs }
  public func getPartsCount() -> Int { parts.count }
  public func getTotalBytes() -> Int64 { parts.reduce(0) { $0 + $1.byteLength } }
}

public final class AppleRecordingBridge: NSObject {
  /// Continuous recording while the app is backgrounded is NOT certified.
  /// Keeping this false makes `background` an honest capability probe: the
  /// bridge safe-stops and commits on background/interruption (D2/D12). Flip
  /// only after audio-session, entitlement, interruption and lock-screen
  /// evidence has been recorded for the supported iOS build.
  private static let backgroundCaptureCertified = false

  private let queue = DispatchQueue(label: "com.plethora.recording.writer", qos: .userInitiated)

  private var activeSessionId: String?
  private var activeWriterEpoch: String?
  private var currentState: String = "idle"
  private var activeWriter: AppleRecordingWriter?

  private var audioEngine: AVAudioEngine?
  private let composerBusyCheck: () -> Bool

  public init(composerBusyCheck: @escaping () -> Bool = { false }) {
    self.composerBusyCheck = composerBusyCheck
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
  }

  @objc private func handleInterruption(notification: Notification) {
    guard let info = notification.userInfo,
          let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

    if type == .began {
      queue.async { [weak self] in
        self?.safeStop(reason: "interrupted")
      }
    }
  }

  @objc private func handleBackground() {
    // Commit on background by default per D2/Task 0.8
    queue.async { [weak self] in
      if self?.currentState == "recording" {
        self?.safeStop(reason: "interrupted")
      }
    }
  }

  public func status(_ invoke: Invoke) {
    queue.async { [weak self] in
      guard let self = self else { return }
      let permission = AVAudioSession.sharedInstance().recordPermission
      let granted = (permission == .granted)
      let ackMs = self.activeWriter?.getAcknowledgedMs() ?? 0

      invoke.resolve([
        "platform": "ios",
        "available": true,
        "pause": true,
        "background": AppleRecordingBridge.backgroundCaptureCertified,
        "liveCaptions": false,
        "state": self.currentState,
        "sessionId": self.activeSessionId as Any,
        "writerEpoch": self.activeWriterEpoch as Any,
        "acknowledgedMs": ackMs,
        "pendingBytes": 0,
        "microphonePermission": granted ? "granted" : "prompt",
      ])
    }
  }

  public func start(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AppleRecordingArgs.self)
    guard let sessionId = args.sessionId, !sessionId.isEmpty,
          let epoch = args.writerEpoch, !epoch.isEmpty else {
      rejectCoded(invoke, "invalid_argument", "Missing sessionId or writerEpoch")
      return
    }

    if composerBusyCheck() {
      rejectCoded(invoke, "busy", "Microphone is already owned by composer")
      return
    }

    let session = AVAudioSession.sharedInstance()
    session.requestRecordPermission { [weak self] granted in
      guard let self = self else { return }
      guard granted else {
        rejectCoded(invoke, "permission_denied", "Microphone permission denied")
        return
      }

      self.queue.async {
        do {
          let baseDir: URL
          if let outDir = args.outputDir, !outDir.isEmpty {
            baseDir = URL(fileURLWithPath: outDir, isDirectory: true)
          } else {
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            baseDir = docs.appendingPathComponent("recordings", isDirectory: true)
          }

          let assetId = args.assetId ?? UUID().uuidString
          let writer = try AppleRecordingWriter(
            baseDir: baseDir,
            sessionId: sessionId,
            assetId: assetId,
            writerEpoch: epoch,
            sampleRate: args.sampleRate ?? 16000,
            channels: args.channels ?? 1
          )

          try self.beginAudioEngine(sampleRate: Double(args.sampleRate ?? 16000), writer: writer)

          self.activeSessionId = sessionId
          self.activeWriterEpoch = epoch
          self.activeWriter = writer
          self.currentState = "recording"

          invoke.resolve([
            "ok": true,
            "sessionId": sessionId,
            "assetId": assetId,
            "writerEpoch": epoch,
          ])
        } catch {
          self.currentState = "failed"
          rejectCoded(invoke, "recording_failed", error.localizedDescription)
        }
      }
    }
  }

  public func pause(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AppleRecordingArgs.self)
    queue.async { [weak self] in
      guard let self = self else { return }
      guard self.activeSessionId == args.sessionId && self.activeWriterEpoch == args.writerEpoch else {
        rejectCoded(invoke, "invalid_argument", "Session token mismatch")
        return
      }

      self.stopAudioEngine()
      try? self.activeWriter?.flush(isFinal: false)
      self.currentState = "paused"

      invoke.resolve([
        "ok": true,
        "state": "paused",
        "acknowledgedMs": self.activeWriter?.getAcknowledgedMs() ?? 0,
      ])
    }
  }

  public func resume(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AppleRecordingArgs.self)
    queue.async { [weak self] in
      guard let self = self else { return }
      guard self.activeSessionId == args.sessionId && self.activeWriterEpoch == args.writerEpoch else {
        rejectCoded(invoke, "invalid_argument", "Session token mismatch")
        return
      }
      guard let writer = self.activeWriter else {
        rejectCoded(invoke, "invalid_state", "No active writer")
        return
      }

      do {
        try self.beginAudioEngine(sampleRate: Double(writer.sampleRate), writer: writer)
        self.currentState = "recording"
        invoke.resolve(["ok": true, "state": "recording"])
      } catch {
        rejectCoded(invoke, "resume_failed", error.localizedDescription)
      }
    }
  }

  public func finish(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AppleRecordingArgs.self)
    queue.async { [weak self] in
      guard let self = self else { return }
      guard self.activeSessionId == args.sessionId && self.activeWriterEpoch == args.writerEpoch else {
        rejectCoded(invoke, "invalid_argument", "Session token mismatch")
        return
      }

      self.stopAudioEngine()
      do {
        try self.activeWriter?.flush(isFinal: true)
        self.currentState = "saved"

        let assetId = self.activeWriter?.assetId ?? ""
        let ackMs = self.activeWriter?.getAcknowledgedMs() ?? 0
        let partsCount = self.activeWriter?.getPartsCount() ?? 0
        let totalBytes = self.activeWriter?.getTotalBytes() ?? 0

        self.activeSessionId = nil
        self.activeWriterEpoch = nil
        self.activeWriter = nil

        invoke.resolve([
          "assetId": assetId,
          "incomplete": false,
          "acknowledgedMs": ackMs,
          "partsCount": partsCount,
          "totalBytes": totalBytes,
        ])
      } catch {
        rejectCoded(invoke, "finish_failed", error.localizedDescription)
      }
    }
  }

  public func safeStop(reason: String) {
    stopAudioEngine()
    try? activeWriter?.flush(isFinal: false)
    currentState = (reason == "interrupted") ? "interrupted" : "recoverable"
  }

  private func beginAudioEngine(sampleRate: Double, writer: AppleRecordingWriter) throws {
    stopAudioEngine()
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)

    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] (buffer: AVAudioPCMBuffer, _) in
      guard let channelData = buffer.int16ChannelData else { return }
      let frameCount = Int(buffer.frameLength)
      let byteCount = frameCount * MemoryLayout<Int16>.size
      let data = Data(bytes: channelData[0], count: byteCount)

      self?.queue.async {
        try? writer.appendSamples(data)
      }
    }

    engine.prepare()
    try engine.start()
    self.audioEngine = engine
  }

  private func stopAudioEngine() {
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
