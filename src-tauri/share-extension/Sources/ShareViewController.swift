// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// ShareViewController — principal class of the "Plethora" iOS Share Extension.
//
// Deliberately minimal (extension memory budget is ~120MB): this class does
// NO extraction, validation, or network work. It classifies the shared
// attachments, hands them to `ShareStagingWriter` for pure file copies into
// the App Group container, shows a brief confirmation, and dismisses. The
// main app consumes the staged manifests at launch with exactly-once
// semantics (plethora-folder-import/src/staged_shares.rs).
//
// Referenced from Info.plist via NSExtensionPrincipalClass.

import UIKit
import UniformTypeIdentifiers

@objc(PlethoraShareViewController)
final class ShareViewController: UIViewController {

    private let statusLabel = UILabel()
    private let brandLabel = UILabel()

    // ── UI ────────────────────────────────────────────────────────────────

    override func viewDidLoad() {
        super.viewDidLoad()
        configureChrome()
        setStatus("Saving to Plethora…")

        // Process off the main thread; file copies must never block launch UI.
        DispatchQueue.global(qos: .userInitiated).async { self.processShare() }
    }

    private func configureChrome() {
        view.backgroundColor = UIColor(red: 0.08, green: 0.09, blue: 0.11, alpha: 1)

        brandLabel.text = "Plethora"
        brandLabel.textColor = .white
        brandLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        brandLabel.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.textColor = UIColor(white: 1, alpha: 0.75)
        statusLabel.font = .systemFont(ofSize: 14)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(brandLabel)
        view.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            brandLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            brandLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -14),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: brandLabel.bottomAnchor, constant: 6),
        ])
    }

    private func setStatus(_ text: String) {
        DispatchQueue.main.async { self.statusLabel.text = text }
    }

    // ── Processing ────────────────────────────────────────────────────────

    private func processShare() {
        guard let context = extensionContext else { return finishUnsupported() }
        let providers = context.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }

        guard !providers.isEmpty else { return finishUnsupported() }

        var manifestItems: [[String: Any]] = []
        var payloadFiles: [(filename: String, sourceURL: URL)] = []

        for provider in providers {
            switch classify(provider) {
            case .url(let urlString):
                manifestItems.append([
                    "kind": "url",
                    "urlString": urlString,
                ])
            case .text(let text):
                manifestItems.append([
                    "kind": "text",
                    "text": text,
                ])
            case .file(let filename, let mimeType, let typeIdentifier):
                if let staged = stageFilePayload(
                    provider: provider,
                    filename: filename,
                    mimeType: mimeType,
                    typeIdentifier: typeIdentifier
                ) {
                    manifestItems.append(staged.manifestItem)
                    payloadFiles.append(staged.payload)
                } else {
                    // Oversize or unloadable attachment: declined gracefully
                    // rather than failing the whole share.
                    continue
                }
            case .unsupported:
                continue
            }
        }

        guard !manifestItems.isEmpty else { return finishUnsupported() }

        do {
            try ShareStagingWriter.stage(manifestItems: manifestItems, payloadFiles: payloadFiles)
        } catch {
            setStatus("Couldn't save to Plethora")
            return finishAfterDelay(success: false)
        }

        setStatus("Saved to Plethora")
        finishAfterDelay(success: true)
    }

    /// Classification of one shared attachment into a manifest item kind.
    private enum Attachment {
        case url(String)
        case text(String)
        case file(filename: String, mimeType: String, typeIdentifier: String)
        case unsupported
    }

    private func classify(_ provider: NSItemProvider) -> Attachment {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            var loaded: URL?
            let semaphore = DispatchSemaphore(value: 0)
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                loaded = item as? URL ?? (item as? NSURL as URL?)
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 5)
            if let url = loaded, let absolute = url.absoluteString.nilIfEmpty {
                return .url(absolute)
            }
            return .unsupported
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            var loaded: String?
            let semaphore = DispatchSemaphore(value: 0)
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                switch item {
                case let s as String: loaded = s
                case let d as Data: loaded = String(data: d, encoding: .utf8)
                case let ns as NSString: loaded = ns as String
                default: break
                }
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 5)
            if let text = loaded?.nilIfEmpty {
                return .text(text)
            }
            return .unsupported
        }

        // Everything else (PDF, EPUB, images, audio, video, generic documents):
        // pick the first registered type the system can hand us as a file.
        let identifiers = provider.registeredTypeIdentifiers
        guard
            let typeIdentifier = identifiers.first(where: {
                UTType($0)?.isDeclared ?? false
            }) ?? identifiers.first,
            let utType = UTType(typeIdentifier),
            !utType.conforms(to: .url),
            !utType.conforms(to: .plainText)
        else {
            return .unsupported
        }

        let baseName = provider.suggestedName ?? "shared-\(Int(Date().timeIntervalSince1970))"
        let ext = utType.preferredFilenameExtension.map { ".\($0)" } ?? ""
        let filename = "\(baseName)\(ext)".replacingOccurrences(of: "/", with: "_")
        return .file(
            filename: filename,
            mimeType: utType.preferredMIMEType ?? "application/octet-stream",
            typeIdentifier: typeIdentifier
        )
    }

    /// Load one file attachment via `loadFileRepresentation` (the system gives
    /// us a temp-file URL — no in-memory Data — keeping us inside the
    /// extension's memory budget even for large PDFs) and hand it to the
    /// staging writer with its size already validated.
    private func stageFilePayload(
        provider: NSItemProvider,
        filename: String,
        mimeType: String,
        typeIdentifier: String
    ) -> (manifestItem: [String: Any], payload: (filename: String, sourceURL: URL))? {
        var boxed: (filename: String, sourceURL: URL)?
        let semaphore = DispatchSemaphore(value: 0)
        _ = provider.loadFileRepresentation(
            forTypeIdentifier: typeIdentifier,
            completionHandler: { url, _, _ in
                if let url = url {
                    boxed = (filename: filename, sourceURL: url)
                }
                semaphore.signal()
            }
        )
        _ = semaphore.wait(timeout: .now() + 15)

        guard let payload = boxed else { return nil }

        // Enforce the per-kind size limit BEFORE copying (decline, don't OOM).
        let size = (try? payload.sourceURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= ShareStagingWriter.sizeLimit(forFilename: payload.filename) else {
            return nil
        }

        return (
            ["kind": "file", "filename": payload.filename, "mimeType": mimeType],
            payload
        )
    }

    // ── Completion ────────────────────────────────────────────────────────

    private func finishUnsupported() {
        setStatus("Nothing saveable here")
        finishAfterDelay(success: false)
    }

    private func finishAfterDelay(success: Bool) {
        DispatchQueue.main.asyncAfter(deadline: .now() + (success ? 0.6 : 0.9)) { [weak self] in
            self?.extensionContext?.completeRequest(
                returningItems: nil,
                completionHandler: nil
            )
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
