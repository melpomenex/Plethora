// swift-tools-version:5.9
// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0

import PackageDescription

let package = Package(
  name: "PlethoraAppleFoundationShared",
  platforms: [
    .macOS(.v13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "PlethoraAppleFoundationShared",
      targets: ["PlethoraAppleFoundationShared"]
    )
  ],
  targets: [
    .target(
      name: "PlethoraAppleFoundationShared",
      path: ".",
      sources: ["FmBridgeCore.swift", "FmGenerables.swift"]
    )
  ]
)
