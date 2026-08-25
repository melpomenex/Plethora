// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "plethora-apple-fm-macos",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "plethora-apple-fm-macos", type: .static, targets: ["plethora-apple-fm-macos"])
  ],
  targets: [
    .target(
      name: "plethora-apple-fm-macos",
      path: ".",
      sources: ["Sources", "../shared"],
      publicHeadersPath: "include"
    )
  ]
)
