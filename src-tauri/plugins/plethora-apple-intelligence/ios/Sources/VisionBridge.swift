// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// F — add-apple-vision-document-scan

import Foundation
import Tauri
import UIKit
import Vision
import VisionKit

struct VisionRecognizeArgs: Decodable {
  var source: String?
  var bytesBase64: String?
  var path: String?
  var locale: String?
}

final class AppleVisionBridge: NSObject, VNDocumentCameraViewControllerDelegate {
  private var pendingScanner: Invoke?

  func featureState() -> FeatureStatePayload {
    if VNDocumentCameraViewController.isSupported {
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

  func presentScanner(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard VNDocumentCameraViewController.isSupported else {
        rejectCoded(invoke, "vision_unavailable", "Document camera is not supported")
        return
      }
      guard let presenter = Self.topViewController() else {
        rejectCoded(invoke, "inference_failed", "No view controller to present scanner")
        return
      }
      self.pendingScanner = invoke
      let scanner = VNDocumentCameraViewController()
      scanner.delegate = self
      presenter.present(scanner, animated: true)
    }
  }

  func recognizeDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(VisionRecognizeArgs.self)
    if args.source == "camera" {
      presentScanner(invoke)
      return
    }
    if let path = args.path, !path.isEmpty {
      guard let image = UIImage(contentsOfFile: path), let cg = image.cgImage else {
        rejectCoded(invoke, "invalid_image", "Could not decode image at path")
        return
      }
      recognize(cgImage: cg, invoke: invoke)
      return
    }
    guard let b64 = args.bytesBase64, let data = Data(base64Encoded: b64),
          let image = UIImage(data: data), let cg = image.cgImage
    else {
      rejectCoded(invoke, "invalid_image", "Missing or invalid image bytes")
      return
    }
    recognize(cgImage: cg, invoke: invoke)
  }

  func cancel(_ invoke: Invoke) {
    DispatchQueue.main.async {
      Self.topViewController()?.dismiss(animated: true)
      if let pending = self.pendingScanner {
        rejectCoded(pending, "cancelled", "Vision scan cancelled")
        self.pendingScanner = nil
      }
    }
    invoke.resolve(["ok": true])
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFinishWith scan: VNDocumentCameraScan
  ) {
    controller.dismiss(animated: true)
    guard let invoke = pendingScanner else { return }
    pendingScanner = nil
    guard scan.pageCount > 0, let cg = scan.imageOfPage(at: 0).cgImage else {
      rejectCoded(invoke, "ocr_failed", "Scanner returned no pages")
      return
    }
    recognize(cgImage: cg, invoke: invoke, pageCount: scan.pageCount)
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    if let invoke = pendingScanner {
      rejectCoded(invoke, "cancelled", "User cancelled document scan")
      pendingScanner = nil
    }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFailWithError error: Error
  ) {
    controller.dismiss(animated: true)
    if let invoke = pendingScanner {
      rejectCoded(invoke, "ocr_failed", error.localizedDescription)
      pendingScanner = nil
    }
  }

  private func recognize(cgImage: CGImage, invoke: Invoke, pageCount: Int = 1) {
    let request = VNRecognizeTextRequest { (request: VNRequest, error: Error?) in
      if let error {
        rejectCoded(invoke, "ocr_failed", error.localizedDescription)
        return
      }
      let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
      var lines: [String] = []
      var blocks: [JSObject] = []
      for (i, obs) in observations.enumerated() {
        guard let top = obs.topCandidates(1).first else { continue }
        lines.append(top.string)
        let box = obs.boundingBox
        blocks.append([
          "id": "block-\(i)",
          "text": top.string,
          "confidence": Double(top.confidence),
          "x": box.origin.x,
          "y": box.origin.y,
          "width": box.size.width,
          "height": box.size.height,
        ])
      }
      invoke.resolve([
        "text": lines.joined(separator: "\n"),
        "html": lines.map { "<p>\($0)</p>" }.joined(),
        "blocks": blocks,
        "pageCount": pageCount,
        "handwritingAdvertised": false,
      ])
    }
    request.recognitionLevel = VNRequestTextRecognitionLevel.accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try handler.perform([request])
      } catch {
        rejectCoded(invoke, "ocr_failed", error.localizedDescription)
      }
    }
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
