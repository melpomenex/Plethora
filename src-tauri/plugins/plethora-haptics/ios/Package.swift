// swift-tools-version:5.3
// IMPORTANT: package, product and target names match the Rust crate so SwiftPM
// produces the static library name expected by swift-rs.
import PackageDescription

let package = Package(
  name: "plethora-haptics",
  platforms: [.iOS(.v14)],
  products: [
    .library(name: "plethora-haptics", type: .static, targets: ["plethora-haptics"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(name: "plethora-haptics", dependencies: [.byName(name: "Tauri")], path: "Sources"),
    .testTarget(
      name: "plethora-haptics-tests",
      dependencies: [.byName(name: "plethora-haptics")],
      path: "Tests",
      resources: [.copy("bridge-contract.json")]
    )
  ]
)
