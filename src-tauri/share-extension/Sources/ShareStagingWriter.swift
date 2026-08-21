// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// ShareStagingWriter — writes one self-contained batch directory per share
// into the App Group container, with an atomic rename into the `.ready`
// queue. This is the writer side of the staged-manifest contract consumed by
// `src-tauri/plugins/plethora-folder-import/src/staged_shares.rs`; keep the
// JSON schema in sync (documented in src/types/share.ts and the Rust module).
//
// Layout (inside `group.com.plethora.app`):
//   shares/.staging/<uuid>/   written first
//   shares/.ready/<uuid>/     atomic rename when complete (manifest + files)
//
// Exactly-once discipline on the reader side relies on the rename being the
// last step: a half-written batch is never visible under `.ready`.

import Foundation

enum ShareStagingWriter {

    // Must match APP_GROUP_ID in
    // src-tauri/plugins/plethora-folder-import/src/lib.rs and the `appGroup`
    // in scripts/ios-overrides/share-extension.target.json.
    static let appGroupId = "group.com.plethora.app"

    /// Per-kind payload size limits (bytes). The activation rule already
    /// filters most oversized shares; this is the enforced backstop.
    static let sizeLimits: [(extensions: [String], limit: Int)] = [
        (["png", "jpg", "jpeg", "heic", "heif", "gif", "webp", "tiff", "bmp"], 30 * 1_000_000),
        (["mp3", "wav", "m4a", "m4b", "aac", "ogg", "flac", "opus"], 500 * 1_000_000),
        (["pdf", "epub", "md", "markdown", "txt", "html", "htm", "json"], 200 * 1_000_000),
    ]
    static let defaultSizeLimit = 200 * 1_000_000
    static let maxTextBytes = 1_000_000

    static func sizeLimit(forFilename filename: String) -> Int {
        let ext = (filename as NSString).pathExtension.lowercased()
        for entry in sizeLimits where entry.extensions.contains(ext) {
            return entry.limit
        }
        return defaultSizeLimit
    }

    /// Atomically stage one share batch. `manifestItems` is the JSON-ready
    /// item array (`{kind, urlString|text|filename+mimeType}`); `payloadFiles`
    /// maps file items to their temp-file URLs for streamed copies.
    static func stage(
        manifestItems: [[String: Any]],
        payloadFiles: [(filename: String, sourceURL: URL)]
    ) throws {
        guard let container = appGroupContainer() else {
            throw StagingError.appGroupUnavailable
        }

        let sharesRoot = container.appendingPathComponent("shares", isDirectory: true)
        let stagingRoot = sharesRoot.appendingPathComponent(".staging", isDirectory: true)
        let readyRoot = sharesRoot.appendingPathComponent(".ready", isDirectory: true)

        try FileManager.default.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: readyRoot, withIntermediateDirectories: true)

        let id = UUID().uuidString
        let batchDir = stagingRoot.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: batchDir, withIntermediateDirectories: true)

        // Streamed copies (never full-file Data loads) into the batch dir.
        for payload in payloadFiles {
            let sanitized = payload.filename
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: ":", with: "_")
            let dest = batchDir.appendingPathComponent(sanitized)
            try FileManager.default.copyItem(at: payload.sourceURL, to: dest)
        }

        // Manifest — camelCase schema shared with the Rust reader.
        let manifest: [String: Any] = [
            "id": id,
            "receivedAt": Int64(Date().timeIntervalSince1970 * 1_000),
            "attempts": 0,
            "items": manifestItems,
        ]
        let manifestURL = batchDir.appendingPathComponent("manifest.json")
        let data = try JSONSerialization.data(
            withJSONObject: manifest,
            options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: manifestURL, options: .atomic)

        // Atomic publish: rename is the last step, so `.ready` only ever
        // contains complete batches.
        try FileManager.default.moveItem(
            at: batchDir,
            to: readyRoot.appendingPathComponent(id, isDirectory: true)
        )
    }

    static func appGroupContainer() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        )
    }

    enum StagingError: Error {
        case appGroupUnavailable
    }
}
