// swift-tools-version:5.3
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

// IMPORTANT: the package/target/product name MUST match the Rust crate name
// (`plethora-storekit`). tauri-utils's `link_swift_library` calls swift-rs's
// `SwiftLinker::with_package(CARGO_PKG_NAME, …)`, and swift-rs then emits
// `cargo:rustc-link-lib=static=<name>` using that same name. SwiftPM builds
// the static artifact from the package *target* name, so a mismatch here
// produces `libtauri-plugin-plethora-storekit.a` while the linker looks for
// `libplethora-storekit.a` and fails with "could not find native static
// library".
let package = Package(
  name: "plethora-storekit",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "plethora-storekit",
      type: .static,
      targets: ["plethora-storekit"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "plethora-storekit",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
