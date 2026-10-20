import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CaptureHandle, SessionLearningDraft, SessionSourceEvidence, SessionTranscriptSegment,
  SessionTranscriptTiming,
} from "../../../types/recordingSession";
import { createRecordingTestClock, createRecordingTestIO, createRecordingTestProvider, recordingTimeline } from "./harness";
import manifest from "./manifest.json";
import transcript from "./transcript.json";
import evidence from "./evidence.json";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));

describe("recording session fixture contracts", () => {
  it("preserves the intended typed timing and draft boundaries", () => {
    expectTypeOf<CaptureHandle["finish"]>().returns.resolves.toEqualTypeOf<{ assetId: string; incomplete: boolean }>();
    expectTypeOf<Extract<SessionLearningDraft, { kind: "card" }>["payload"]["kind"]>().toEqualTypeOf<"card">();
    const untimed: SessionTranscriptTiming = { kind: "none" };
    // @ts-expect-error Untimed text must not acquire fake zero-second precision.
    const invalid: SessionTranscriptTiming = { kind: "none", startMs: 0, endMs: 0 };
    expect(untimed).toEqual({ kind: "none" });
    expect(invalid.kind).toBe("none");
  });

  it("matches every committed asset to its manifest checksum", () => {
    for (const [name, asset] of Object.entries(manifest.assets)) {
      const data = readFileSync(join(fixtureDirectory, name));
      expect(data.byteLength, name).toBe(asset.bytes);
      expect(createHash("sha256").update(data).digest("hex"), name).toBe(asset.sha256);
    }
    expect(Object.keys(manifest.cases)).toEqual(Array.from({ length: 18 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`));
    expect(Object.values(manifest.cases).every((c) => c.status === "planned")).toBe(true);
  });

  it("retains real PCM samples and untimed technical text separately", () => {
    const wav = readFileSync(join(fixtureDirectory, "lecture.wav"));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(manifest.frameCount * 2);
    expect(wav.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(transcript.at(-1)?.timing).toEqual({ kind: "none" });
    expect(transcript.at(-1)?.text).toContain("E = mc²");
    expect(transcript.at(-1)?.text).toContain("🤔");
  });

  it("reconstructs immutable evidence from owned stable segment ranges", () => {
    const fixture = evidence as SessionSourceEvidence;
    const quotes = fixture.ranges.map((range) => {
      const segment = transcript.find((s) => s.segmentKey === range.segmentKey)!;
      expect(fixture.segmentKeys).toContain(segment.segmentKey);
      expect(segment.revision).toBe(fixture.transcriptRevision);
      expect(createHash("sha256").update(segment.text).digest("hex")).toBe(fixture.fingerprint);
      return segment.text.slice(range.startUtf16, range.endUtf16);
    });
    expect(quotes.join("\n")).toBe(fixture.quote);
    expect(new Set(transcript.map((s) => s.segmentKey)).size).toBe(transcript.length);
  });

  it("streams a 90-minute timeline with bounded per-event bytes", () => {
    const clock = createRecordingTestClock();
    let count = 0;
    for (const part of recordingTimeline()) {
      expect(part.startMs).toBe(clock.now());
      expect(part.bytes.byteLength).toBe(320);
      clock.advance(part.durationMs);
      count += 1;
    }
    expect(count).toBe(1080);
    expect(clock.now()).toBe(90 * 60_000);
  });

  it("can fault DB acknowledgement after independent file persistence", () => {
    const io = createRecordingTestIO();
    const bytes = Uint8Array.of(1, 2, 3);
    io.write("part.partial", bytes);
    bytes[0] = 99;
    io.sync();
    io.rename("part.partial", "part.wav");
    io.failNext("database");
    expect(() => io.acknowledge("part-0")).toThrow("Injected database failure");
    expect(io.files.get("part.wav")).toEqual(Uint8Array.of(1, 2, 3));
    expect(io.acknowledgements.size).toBe(0);
  });

  it("can deliver a late provider response after a cancellation", async () => {
    const provider = createRecordingTestProvider();
    const controller = new AbortController();
    const request = provider.transcribe("unit-0", controller.signal);
    controller.abort();
    provider.completeNext(transcript as SessionTranscriptSegment[]);
    expect(await request).toEqual(transcript);
    expect(provider.calls[0].signal?.aborted).toBe(true);
    // Future worker tests must reject this stale response; the fake must allow it.
  });
});
