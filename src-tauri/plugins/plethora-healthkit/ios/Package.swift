// swift-tools-version:5.5
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

let package = Package(
  name: "plethora-healthkit",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "plethora-healthkit",
      type: .static,
      targets: ["plethora-healthkit"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "plethora-healthkit",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
