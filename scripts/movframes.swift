// Extract frames from a QuickTime/MP4 recording, and optionally re-encode it
// smaller. macOS ships AVFoundation, so this avoids an ffmpeg dependency.
//
//   swift movframes.swift extract <in.mov> <outdir> <count> [maxWidth]
//   swift movframes.swift shrink  <in.mov> <out.mp4> <preset>
//
// preset: 640 | 960 | 1280  (AVAssetExportPreset<preset>x...)

import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: movframes.swift extract|shrink ...\n".data(using: .utf8)!)
    exit(2)
}

let mode = args[1]
let inURL = URL(fileURLWithPath: args[2])
let asset = AVURLAsset(url: inURL)

if mode == "extract" {
    let outDir = args[3]
    let count = Int(args[4]) ?? 12
    let maxW = args.count > 5 ? Int(args[5])! : 1400

    try? FileManager.default.createDirectory(atPath: outDir,
                                             withIntermediateDirectories: true)

    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    gen.maximumSize = CGSize(width: maxW, height: 0)

    let dur = CMTimeGetSeconds(asset.duration)
    // Skip the very start and end: recordings usually open and close on a
    // stationary desktop, which tells you nothing.
    let first = dur * 0.02
    let last = dur * 0.98
    let step = (last - first) / Double(max(count - 1, 1))

    for i in 0..<count {
        let t = CMTime(seconds: first + step * Double(i), preferredTimescale: 600)
        do {
            let cg = try gen.copyCGImage(at: t, actualTime: nil)
            let rep = NSBitmapImageRep(cgImage: cg)
            guard let data = rep.representation(using: .png, properties: [:]) else { continue }
            let path = String(format: "%@/f%02d.png", outDir, i)
            try data.write(to: URL(fileURLWithPath: path))
            print(String(format: "%@  t=%.1fs", path, CMTimeGetSeconds(t)))
        } catch {
            FileHandle.standardError.write("frame \(i) failed: \(error)\n".data(using: .utf8)!)
        }
    }
    exit(0)
}

if mode == "shrink" {
    let outPath = args[3]
    let preset = args.count > 4 ? args[4] : "960"
    let presetName: String
    switch preset {
    case "640":  presetName = AVAssetExportPreset640x480
    case "1280": presetName = AVAssetExportPreset1280x720
    default:     presetName = AVAssetExportPreset960x540
    }
    try? FileManager.default.removeItem(atPath: outPath)
    guard let export = AVAssetExportSession(asset: asset, presetName: presetName) else {
        FileHandle.standardError.write("cannot create export session\n".data(using: .utf8)!)
        exit(1)
    }
    export.outputURL = URL(fileURLWithPath: outPath)
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true

    let sem = DispatchSemaphore(value: 0)
    export.exportAsynchronously { sem.signal() }
    sem.wait()

    if export.status == .completed {
        let sz = (try? FileManager.default.attributesOfItem(atPath: outPath)[.size] as? Int) ?? 0
        print("wrote \(outPath) \((sz ?? 0) / 1_048_576) MB")
        exit(0)
    }
    FileHandle.standardError.write("export failed: \(String(describing: export.error))\n".data(using: .utf8)!)
    exit(1)
}

FileHandle.standardError.write("unknown mode \(mode)\n".data(using: .utf8)!)
exit(2)
