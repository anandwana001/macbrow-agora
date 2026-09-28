// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MacbrowAudio",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "MacbrowAudio", targets: ["MacbrowAudio"])],
    dependencies: [
        .package(url: "https://github.com/AgoraIO/AgoraRtcEngine_macOS.git", exact: "4.6.4")
    ],
    targets: [
        .executableTarget(name: "MacbrowAudio", dependencies: [
            .product(name: "RtcBasic", package: "AgoraRtcEngine_macOS")
        ])
    ]
)
