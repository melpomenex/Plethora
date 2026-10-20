import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  probeDesktopCaptureCapabilities,
  startDesktopCapture,
  MAX_CONCURRENT_WRITES,
  MAX_PENDING_BYTES,
  MediaRecorderLike,
} from "../desktopCapture";
import type { RecordingPart, RecordingSession } from "../../../types/recordingSession";

class FakeMediaStream {
  public tracks = [{ stop: vi.fn() }];
  getTracks() {
    return this.tracks;
  }
}

class FakeMediaRecorder implements MediaRecorderLike {
  public state: "inactive" | "recording" | "paused" = "inactive";
  public stream: MediaStream;
  public mimeType: string;
  public ondataavailable: ((event: { data: Blob | ArrayBuffer }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onstop: (() => void) | null = null;

  public pausedCount = 0;
  public resumedCount = 0;
  public stoppedCount = 0;

  constructor(stream: MediaStream, options: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = options.mimeType;
  }

  start(_timeslice?: number) {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.stoppedCount++;
    if (this.onstop) {
      this.onstop();
    }
  }

  pause() {
    this.state = "paused";
    this.pausedCount++;
  }

  resume() {
    this.state = "recording";
    this.resumedCount++;
  }

  emitData(bytes: Uint8Array) {
    if (this.ondataavailable) {
      this.ondataavailable({ data: bytes.buffer });
    }
  }
}

describe("desktopCapture adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("probeDesktopCaptureCapabilities", () => {
    it("reports unavailable when getUserMedia is missing", async () => {
      vi.stubGlobal("navigator", {});
      const caps = await probeDesktopCaptureCapabilities();
      expect(caps.available).toBe(false);
      expect(caps.reason).toBe("UnsupportedCapture");
    });

    it("reports unavailable when MediaRecorder is missing", async () => {
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
      vi.stubGlobal("window", {});
      const caps = await probeDesktopCaptureCapabilities();
      expect(caps.available).toBe(false);
      expect(caps.reason).toBe("UnsupportedCapture");
    });

    it("reports available and pauses when MediaRecorder supports WebM", async () => {
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
      const isTypeSupported = vi.fn((mime: string) => mime.includes("webm"));
      vi.stubGlobal("window", {
        MediaRecorder: Object.assign(vi.fn(), { isTypeSupported }),
      });

      const caps = await probeDesktopCaptureCapabilities();
      expect(caps.available).toBe(true);
      expect(caps.pause).toBe(true);
      expect(caps.background).toBe(false);
    });
  });

  describe("startDesktopCapture execution and bounded memory", () => {
    it("advances 90 minutes with bounded pending bytes and no full-audio buffer", async () => {
      const stream = new FakeMediaStream() as unknown as MediaStream;
      let fakeRecorder!: FakeMediaRecorder;

      const committedParts: RecordingPart[] = [];
      let maxPendingSeen = 0;

      const appendPartFn = vi.fn(async (params) => {
        const part: RecordingPart = {
          assetId: "asset-90min",
          writerEpoch: params.writerEpoch,
          sequence: params.sequence,
          relativePath: `parts/part_${params.sequence}.bin`,
          byteLength: (params.bytes as number[]).length,
          sha256: "fake-hash",
          startMs: params.startMs,
          durationMs: params.durationMs,
          formatJson: params.formatJson,
          committedAt: new Date().toISOString(),
        };
        committedParts.push(part);
        return part;
      });

      const finalizeSessionFn = vi.fn(async (id: string, expectedVersion: number) => {
        return {
          id,
          documentId: "doc-1",
          origin: "recorded",
          contentType: "lecture",
          profileJson: "{}",
          captureState: "saved",
          ingestionState: "saved",
          transcriptId: null,
          mediaAssetId: "asset-90min",
          transcriptRevision: 0,
          overviewJson: null,
          overviewRevision: null,
          createdAt: "2026-10-20T00:00:00Z",
          updatedAt: "2026-10-20T00:00:00Z",
          version: expectedVersion + 1,
        } as unknown as RecordingSession;
      });

      const handle = await startDesktopCapture({
        sessionId: "sess-90min",
        stream,
        recorderFactory: (s, opts) => {
          fakeRecorder = new FakeMediaRecorder(s, opts);
          return fakeRecorder;
        },
        appendPartFn,
        finalizeSessionFn,
        onHealthChange: (health) => {
          if (health.pendingBytes > maxPendingSeen) {
            maxPendingSeen = health.pendingBytes;
          }
        },
      });

      // Simulate 5,400 one-second timeslices (90 minutes) with 16 KiB per second
      const chunkSize = 16 * 1024; // 16 KiB
      const chunkData = new Uint8Array(chunkSize);

      for (let sec = 0; sec < 5400; sec++) {
        fakeRecorder.emitData(chunkData);
        // Yield to microtask queue for async appendPartFn resolution
        if (sec % 50 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // Finish the capture session
      const finishResult = await handle.finish();

      expect(finishResult.assetId).toBe("asset-90min");
      expect(finishResult.incomplete).toBe(false);
      expect(committedParts.length).toBe(5400);

      // Verify bounded memory: pending bytes never exceeded the backpressure cap
      expect(maxPendingSeen).toBeLessThanOrEqual(MAX_PENDING_BYTES);

      // Verify duration reached 90 minutes (5,400,000 ms)
      const lastPart = committedParts[committedParts.length - 1];
      expect(lastPart.startMs + lastPart.durationMs).toBe(5400 * 1000);

      // Tracks stopped on finish
      expect(stream.getTracks()[0].stop).toHaveBeenCalled();
    });

    it("applies backpressure when I/O is delayed and resumes on drain", async () => {
      const stream = new FakeMediaStream() as unknown as MediaStream;
      let fakeRecorder!: FakeMediaRecorder;

      let resolveWrite: (() => void) | null = null;
      let writeCallCount = 0;

      const appendPartFn = vi.fn(async (params) => {
        writeCallCount++;
        // Hold the first 2 writes unresolved to simulate delayed I/O
        if (writeCallCount <= MAX_CONCURRENT_WRITES) {
          await new Promise<void>((resolve) => {
            resolveWrite = resolve;
          });
        }
        return {
          assetId: "asset-1",
          writerEpoch: params.writerEpoch,
          sequence: params.sequence,
          relativePath: `parts/part_${params.sequence}.bin`,
          byteLength: (params.bytes as number[]).length,
          sha256: "hash",
          startMs: params.startMs,
          durationMs: params.durationMs,
          formatJson: params.formatJson,
          committedAt: new Date().toISOString(),
        };
      });

      const handle = await startDesktopCapture({
        sessionId: "sess-backpressure",
        stream,
        recorderFactory: (s, opts) => {
          fakeRecorder = new FakeMediaRecorder(s, opts);
          return fakeRecorder;
        },
        appendPartFn,
      });

      // Emit 4 chunks of 3 MiB each (total 12 MiB > 8 MiB MAX_PENDING_BYTES)
      const bigChunk = new Uint8Array(3 * 1024 * 1024);
      fakeRecorder.emitData(bigChunk);
      fakeRecorder.emitData(bigChunk);
      fakeRecorder.emitData(bigChunk);

      // Backpressure should pause the recorder
      expect(fakeRecorder.pausedCount).toBeGreaterThanOrEqual(1);

      // Now release delayed writes
      if (resolveWrite) {
        resolveWrite();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // As queue drains below threshold, recorder should resume
      expect(fakeRecorder.resumedCount).toBeGreaterThanOrEqual(1);

      await handle.pause();
      expect(fakeRecorder.state).toBe("paused");
      await handle.resume();
      expect(fakeRecorder.state).toBe("recording");
    });

    it("handles multiple finish() calls idempotently and drains in-flight writes", async () => {
      const stream = new FakeMediaStream() as unknown as MediaStream;
      let fakeRecorder!: FakeMediaRecorder;

      const appendPartFn = vi.fn(async (params) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          assetId: "asset-race",
          writerEpoch: params.writerEpoch,
          sequence: params.sequence,
          relativePath: `parts/part_${params.sequence}.bin`,
          byteLength: (params.bytes as number[]).length,
          sha256: "hash",
          startMs: params.startMs,
          durationMs: params.durationMs,
          formatJson: params.formatJson,
          committedAt: new Date().toISOString(),
        };
      });

      const finalizeSessionFn = vi.fn(async () => ({
        id: "sess-race",
        documentId: "doc-1",
        origin: "recorded",
        contentType: "lecture",
        profileJson: "{}",
        captureState: "saved",
        ingestionState: "saved",
        transcriptId: null,
        mediaAssetId: "asset-race",
        transcriptRevision: 0,
        overviewJson: null,
        overviewRevision: null,
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-20T00:00:00Z",
        version: 2,
      } as unknown as RecordingSession));

      const handle = await startDesktopCapture({
        sessionId: "sess-race",
        stream,
        recorderFactory: (s, opts) => {
          fakeRecorder = new FakeMediaRecorder(s, opts);
          return fakeRecorder;
        },
        appendPartFn,
        finalizeSessionFn,
      });

      fakeRecorder.emitData(new Uint8Array([1, 2, 3]));
      fakeRecorder.emitData(new Uint8Array([4, 5, 6]));

      // Simultaneous finish calls
      const [res1, res2] = await Promise.all([handle.finish(), handle.finish()]);

      expect(res1).toEqual(res2);
      expect(res1.assetId).toBe("asset-race");
      expect(finalizeSessionFn).toHaveBeenCalledOnce();
      expect(fakeRecorder.stoppedCount).toBe(1);
    });
  });
});
