// Native audio lifecycle based on AgoraIO/API-Examples macOS JoinChannelVideo.
// This helper has no UI: Node sends short-lived RTC credentials over stdin.
import AppKit
import AVFoundation
import AgoraRtcKit

let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock()
    defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data + Data([10]))
}

final class AudioConsole: NSObject, AgoraRtcEngineDelegate {
    private var engine: AgoraRtcEngineKit?
    private var closing = false
    private var agentUid: UInt = 0
    private var signals: [DispatchSourceSignal] = []

    func run() {
        for number in [SIGINT, SIGTERM] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.stop() }
            source.resume()
            signals.append(source)
        }
        // EOF also shuts down if the parent crashes. Credentials never enter argv or a file.
        DispatchQueue.global().async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                DispatchQueue.main.async { self.command(message) }
            }
            DispatchQueue.main.async { self.stop() }
        }
    }

    func command(_ message: [String: Any]) {
        guard !closing else { return }
        switch message["command"] as? String {
        case "join":
            guard engine == nil else { return }
            let listenOnly = message["listenOnly"] as? Bool ?? false
            if listenOnly { join(message); return }
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: join(message)
            case .notDetermined:
                emit(["event": "permission", "message": "Allow microphone access in the macOS prompt."])
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        if granted { self.join(message) } else { self.fail("Microphone permission denied. Enable access in System Settings > Privacy & Security > Microphone.") }
                    }
                }
            default: fail("Microphone permission denied. Enable access in System Settings > Privacy & Security > Microphone.")
            }
        case "renew":
            if let token = message["token"] as? String { check(engine?.renewToken(token) ?? -1, "Token renewal") }
        case "stop": stop()
        default: break
        }
    }

    func join(_ message: [String: Any]) {
        guard !closing, engine == nil,
              let appId = message["app_id"] as? String,
              let channel = message["channel_name"] as? String,
              let token = message["token"] as? String,
              let uidText = message["uid"] as? String, let uid = UInt(uidText),
              let agentText = message["agent_uid"] as? String, let agent = UInt(agentText) else { return }
        agentUid = agent
        let config = AgoraRtcEngineConfig()
        config.appId = appId
        config.audioScenario = .aiClient
        let kit = AgoraRtcEngineKit.sharedEngine(with: config, delegate: self)
        engine = kit
        kit.disableVideo()
        kit.enableAudio()
        kit.setAudioProfile(.speechStandard)
        let listenOnly = message["listenOnly"] as? Bool ?? false
        kit.enableLocalAudio(!listenOnly)
        if listenOnly { kit.adjustPlaybackSignalVolume(0) }
        let options = AgoraRtcChannelMediaOptions()
        options.channelProfile = .liveBroadcasting
        options.clientRoleType = .broadcaster
        options.publishCameraTrack = false
        options.publishMicrophoneTrack = !listenOnly
        options.autoSubscribeAudio = true
        options.autoSubscribeVideo = false
        check(kit.joinChannel(byToken: token, channelId: channel, uid: uid, mediaOptions: options), "RTC join")
    }

    func check(_ code: Int32, _ operation: String) {
        if code != 0 { fail("\(operation) failed (Agora code \(code)).") }
    }

    func fail(_ message: String) {
        guard !closing else { return }
        emit(["event": "error", "message": message])
        stop(code: 1)
    }

    func stop(code: Int32 = 0) {
        guard !closing else { return }
        closing = true
        engine?.muteLocalAudioStream(true)
        engine?.leaveChannel(nil)
        // Destroy outside SDK callbacks to avoid deadlocking the SDK callback thread.
        DispatchQueue.main.async {
            AgoraRtcEngineKit.destroy()
            emit(["event": "closed"])
            exit(code)
        }
    }

    func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinChannel channel: String, withUid uid: UInt, elapsed: Int) {
        emit(["event": "joined"])
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinedOfUid uid: UInt, elapsed: Int) {
        if uid == agentUid { emit(["event": "agent-joined"]) }
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, didOfflineOfUid uid: UInt, reason: AgoraUserOfflineReason) {
        if uid == agentUid { emit(["event": "agent-left"]) }
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, didOccurError errorCode: AgoraErrorCode) {
        DispatchQueue.main.async { self.fail("Agora RTC error \(errorCode.rawValue).") }
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, tokenPrivilegeWillExpire token: String) {
        emit(["event": "renew-token"])
    }
    func rtcEngineRequestToken(_ engine: AgoraRtcEngineKit) { emit(["event": "renew-token"]) }
    func rtcEngine(_ engine: AgoraRtcEngineKit, connectionChangedTo state: AgoraConnectionState, reason: AgoraConnectionChangedReason) {
        emit(["event": "connection", "state": state.rawValue])
        if state == .failed { DispatchQueue.main.async { self.fail("RTC connection failed (reason \(reason.rawValue)).") } }
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, remoteAudioStateChangedOfUid uid: UInt, state: AgoraAudioRemoteState, reason: AgoraAudioRemoteReason, elapsed: Int) {
        if uid == agentUid && state == .decoding { emit(["event": "agent-audio"]) }
    }
    func rtcEngine(_ engine: AgoraRtcEngineKit, receiveStreamMessageFromUid uid: UInt, streamId: Int, data: Data) {
        guard uid == agentUid, data.count <= 65536, let text = String(data: data, encoding: .utf8) else { return }
        emit(["event": "transcript-data", "text": text])
    }
}

if CommandLine.arguments.contains("--check") {
    print("macbrow native audio helper: Agora RTC SDK \(AgoraRtcEngineKit.getSdkVersion())")
    exit(0)
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let console = AudioConsole()
console.run()
app.run()
