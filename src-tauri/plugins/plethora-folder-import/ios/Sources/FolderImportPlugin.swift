// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// iOS implementation of the folder-import Tauri plugin.
//
// Presents UIDocumentPickerViewController through the modern
// init(forOpeningContentTypes:asCopy:) initializer (iOS 14+). The legacy
// init(documentTypes:in:) initializer is not merely deprecated on current
// iOS: presenting a folder type with it throws NSInternalInconsistencyException
// "folder import is not supported, use open" (UIDocumentPickerViewController.m
// assertion), and the uncaught ObjC exception aborts the process.
//
// Two commands:
//  - pickFolderDocuments: folder mode (UTType.folder), then walks the picked
//    directory with FileManager.enumerator (recursive) and copies each
//    supported file into <Documents>/imports/<relative-subpath>.
//  - pickFiles: multi-file mode derived from the extension allow-list
//    (asCopy: true so the picker itself stages readable copies), then each
//    picked file is copied into <Documents>/imports/.
//
// Staged files are app-private and readable by Rust std::fs, so the existing
// path-based import pipeline consumes them.

import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers

/// Decodable argument payload from Rust/JS for the folder picker.
/// `extensions` is optional and defaults to the same set as the
/// desktop/Kotlin side when empty.
struct PickFolderOptions: Decodable {
  var extensions: [String]?
}

/// Decodable argument payload for the file picker. Mirrors the Kotlin
/// plugin's pickFiles command contract.
struct PickFilesOptions: Decodable {
  var extensions: [String]?
  var multiple: Bool?
}

/// Must match DEFAULT_EXTENSIONS in src/lib.rs.
private let defaultFolderImportExtensions: Set<String> = [
  "pdf", "epub", "md", "markdown", "txt", "html", "htm", "json",
  "mp3", "wav", "m4a", "m4b", "aac", "ogg", "flac", "opus", "wma",
  "mp4", "webm", "mov", "mkv", "avi", "m4v",
]

public class FolderImportPlugin: Plugin {

  /// Held while the document picker is on screen so the completion handler
  /// can resolve the originating `Invoke`.
  private var pendingInvoke: Invoke?
  private var extensions: Set<String> = defaultFolderImportExtensions

  @objc public func pickFolderDocuments(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickFolderOptions.self)
    applyExtensions(args.extensions)
    pendingInvoke = invoke

    DispatchQueue.main.async {
      // `.folder` lets the user pick a directory (iOS 13+). asCopy: false
      // keeps the current contract: a security-scoped URL the delegate
      // walks and stages itself, so unsupported files are never copied.
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [UTType.folder], asCopy: false)
      picker.allowsMultipleSelection = false
      picker.modalPresentationStyle = .fullScreen
      picker.delegate = self
      self.manager.viewController?.present(picker, animated: true, completion: nil)
    }
  }

  @objc public func pickFiles(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickFilesOptions.self)
    applyExtensions(args.extensions)
    pendingInvoke = invoke

    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: Self.contentTypes(forExtensions: self.extensions),
        asCopy: true)
      picker.allowsMultipleSelection = args.multiple ?? false
      picker.modalPresentationStyle = .fullScreen
      picker.delegate = self
      self.manager.viewController?.present(picker, animated: true, completion: nil)
    }
  }

  /// Build the picker's content-type filter from the extension allow-list.
  /// `UTType(filenameExtension:)` resolves registered extensions and returns
  /// a dynamic type for unregistered ones (both are valid filters); if
  /// nothing resolves at all, fall back to "any file" and rely on the
  /// extension check at staging time.
  private static func contentTypes(forExtensions exts: Set<String>) -> [UTType] {
    var types: [UTType] = []
    var seen = Set<String>()
    for ext in exts.sorted() {
      guard let type = UTType(filenameExtension: ext) else { continue }
      guard seen.insert(type.identifier).inserted else { continue }
      types.append(type)
    }
    return types.isEmpty ? [.item] : types
  }

  private func applyExtensions(_ raw: [String]?) {
    if let raw, !raw.isEmpty {
      extensions = Set(
        raw.map { $0.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")) })
    } else {
      extensions = Self.defaultExtensions
    }
  }

  /// Recursively copy supported files from [url] (a directory) into the app's
  /// Documents/imports folder, returning the staged file descriptors.
  private func stageFiles(from url: URL) -> [[String: String]] {
    let fileManager = FileManager.default
    // App-private Documents dir; mirrors the import_document_from_bytes
    // staging location used by the existing mobile single-file import.
    let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    let importRoot = docs.appendingPathComponent("imports", isDirectory: true)

    var staged: [[String: String]] = []
    guard
      let enumerator = fileManager.enumerator(
        at: url,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles])
    else {
      return []
    }

    for case let fileURL as URL in enumerator {
      var isDir: ObjCBool = false
      guard fileManager.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue
      else { continue }

      // Relative path under the picked folder root.
      let relativePath = fileURL.path.replacingOccurrences(of: url.path + "/", with: "")
      guard hasSupportedExtension(fileURL.path) else { continue }

      let dest = importRoot.appendingPathComponent(relativePath)
      do {
        try fileManager.createDirectory(
          at: dest.deletingLastPathComponent(),
          withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: dest.path) {
          try fileManager.removeItem(at: dest)
        }
        try fileManager.copyItem(at: fileURL, to: dest)
        staged.append([
          "path": dest.path,
          "relativePath": relativePath,
          "fileName": fileURL.lastPathComponent,
        ])
      } catch {
        // Skip files we can't copy (permissions, etc.) but keep going.
        continue
      }
    }

    staged.sort { $0["relativePath"] ?? "" < $1["relativePath"] ?? "" }
    return staged
  }

  /// Copy individually picked files (asCopy: true, so the picker already
  /// handed us readable temporary copies) into Documents/imports.
  private func stageIndividualFiles(_ urls: [URL]) -> [[String: String]] {
    let fileManager = FileManager.default
    let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    let importRoot = docs.appendingPathComponent("imports", isDirectory: true)

    var staged: [[String: String]] = []
    for url in urls {
      guard hasSupportedExtension(url.path) else { continue }
      let dest = importRoot.appendingPathComponent(url.lastPathComponent)
      do {
        try fileManager.createDirectory(at: importRoot, withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: dest.path) {
          try fileManager.removeItem(at: dest)
        }
        try fileManager.copyItem(at: url, to: dest)
        staged.append([
          "path": dest.path,
          "relativePath": url.lastPathComponent,
          "fileName": url.lastPathComponent,
        ])
      } catch {
        continue
      }
    }
    return staged
  }

  private func hasSupportedExtension(_ path: String) -> Bool {
    guard let dot = path.lastIndex(of: ".") else { return false }
    let ext = String(path[path.index(after: dot)...]).lowercased()
    return extensions.contains(ext)
  }

  /// Must match DEFAULT_EXTENSIONS in src/lib.rs.
  static let defaultExtensions: Set<String> = defaultFolderImportExtensions
}

// MARK: - UIDocumentPickerDelegate

extension FolderImportPlugin: UIDocumentPickerDelegate {
  public func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let invoke = pendingInvoke else { return }
    pendingInvoke = nil

    guard let first = urls.first else {
      invoke.resolve(["files": []])
      return
    }

    // The folder picker (asCopy: false) returns security-scoped URLs that
    // need explicit access; the file picker (asCopy: true) returns plain
    // readable copies. hasDirectoryPath routes each to its staging path.
    let staged: [[String: String]]
    if first.hasDirectoryPath {
      let didStart = first.startAccessingSecurityScopedResource()
      defer {
        if didStart { first.stopAccessingSecurityScopedResource() }
      }
      staged = stageFiles(from: first)
    } else {
      staged = stageIndividualFiles(urls)
    }
    invoke.resolve(["files": staged])
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingInvoke?.resolve(["files": []])
    pendingInvoke = nil
  }
}

@_cdecl("init_plugin_plethora_folder_import")
func initPlugin() -> Plugin {
  return FolderImportPlugin()
}
