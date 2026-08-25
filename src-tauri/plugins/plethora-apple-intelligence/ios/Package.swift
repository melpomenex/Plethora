// swift-tools-version:5.3
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

// Package/target/product name MUST match the Rust crate name
// (`plethora-apple-intelligence`) so swift-rs links libplethora-apple-intelligence.a.
let package = Package(
  name: "plethora-apple-intelligence",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "plethora-apple-intelligence",
      type: .static,
      targets: ["plethora-apple-intelligence"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "plethora-apple-intelligence",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: ".",
      sources: ["Sources", "../shared"])
  ]
)
