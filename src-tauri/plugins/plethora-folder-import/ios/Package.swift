// swift-tools-version:5.3
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

// IMPORTANT: the package/target/product name MUST match the Rust crate name
// (`plethora-folder-import`). tauri-utils's `link_swift_library` calls
// swift-rs's `SwiftLinker::with_package(CARGO_PKG_NAME, …)`, and swift-rs then
// emits `cargo:rustc-link-lib=static=<name>` using that same name. SwiftPM
// builds the static artifact from the package *target* name, so a mismatch
// here (e.g. the `tauri-plugin-…` prefix) produces
// `libtauri-plugin-plethora-folder-import.a` while the linker looks for
// `libplethora-folder-import.a` and fails with
// "could not find native static library".
let package = Package(
  name: "plethora-folder-import",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "plethora-folder-import",
      type: .static,
      targets: ["plethora-folder-import"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "plethora-folder-import",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
