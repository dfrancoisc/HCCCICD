// Encode a sequence of PNG frames into an H.264 MP4.
//
// macOS ships AVFoundation and swift, so this avoids an ffmpeg dependency for
// the one thing Pillow cannot do. Called by gif-to-mp4.py.
//
//   swift mp4encode.swift out.mp4 <width> <height> <fps> frame0.png frame1.png ...
//
// Frames are held by repetition — the caller decides how many copies of each
// still to pass in, so timing lives in one place rather than two.

import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count > 5 else {
    FileHandle.standardError.write("usage: mp4encode.swift out.mp4 W H FPS frames...\n".data(using: .utf8)!)
    exit(2)
}

let outPath = args[1]
let width   = Int(args[2])!
let height  = Int(args[3])!
let fps     = Int32(args[4])!
let frames  = Array(args[5...])

try? FileManager.default.removeItem(atPath: outPath)

let writer = try! AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)

let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        // Slides are static, so quality per bit is very high. This is plenty
        // for crisp text at 1000px wide and keeps the file small enough to
        // sit in a git repository without complaint.
        AVVideoAverageBitRateKey: 1_400_000,
        AVVideoMaxKeyFrameIntervalKey: fps * 2,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]

let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false

let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ]
)

writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(from path: String) -> CVPixelBuffer? {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return nil }

    var pb: CVPixelBuffer?
    let attrs: [String: Any] = [
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ]
    CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                        kCVPixelFormatType_32ARGB, attrs as CFDictionary, &pb)
    guard let buffer = pb else { return nil }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    ) else { return nil }

    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buffer
}

var frameIndex: Int64 = 0
for path in frames {
    guard let buffer = pixelBuffer(from: path) else {
        FileHandle.standardError.write("could not read \(path)\n".data(using: .utf8)!)
        exit(1)
    }
    // Back-pressure: the writer input is not real time, but it still has a
    // finite queue and silently drops appends made while it is not ready.
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.005)
    }
    adaptor.append(buffer, withPresentationTime: CMTime(value: frameIndex, timescale: fps))
    frameIndex += 1
}

input.markAsFinished()

let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()

if writer.status != .completed {
    FileHandle.standardError.write("encode failed: \(writer.error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(1)
}
