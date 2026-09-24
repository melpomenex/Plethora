// swift-tools-version:5.9
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

// Package/target/product name MUST match the Rust crate name
// (`plethora-apple-intelligence`) so swift-rs links libplethora-apple-intelligence.a.
let package = Package(
  name: "plethora-apple-intelligence",
  platforms: [
    .macOS(.v13),
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
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
    .package(name: "PlethoraAppleFoundationShared", path: "../shared")
  ],
  targets: [
    .target(
      name: "plethora-apple-intelligence",
      dependencies: [
        .byName(name: "Tauri"),
        .product(
          name: "PlethoraAppleFoundationShared",
          package: "PlethoraAppleFoundationShared"
        )
      ],
      path: "Sources")
  ]
)
