// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Pux",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "PuxCore", targets: ["PuxCore"]),
        .executable(name: "PuxBar", targets: ["PuxBar"]),
        .executable(name: "PuxCoreCheck", targets: ["PuxCoreCheck"]),
    ],
    targets: [
        .target(name: "PuxCore"),
        .executableTarget(name: "PuxBar", dependencies: ["PuxCore"]),
        .executableTarget(name: "PuxCoreCheck", dependencies: ["PuxCore"]),
    ]
)
