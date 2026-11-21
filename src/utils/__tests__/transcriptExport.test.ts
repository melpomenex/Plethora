import { describe, it, expect, vi } from "vitest";
import {
  serializeTranscriptToPlainText,
  serializeTranscriptToMarkdown,
  serializeTranscriptToSRT,
  serializeTranscriptToVTT,
  serializeTranscriptToJSON,
  serializeTranscript,
  buildTranscriptFilename,
  exportTranscriptToFile,
  formatSegmentWithTimestamp,
  fromMsSegments,
  fromSessionSegments,
  type ExportableTranscriptSegment,
} from "../transcriptExport";

const sampleSegments: ExportableTranscriptSegment[] = [
  {
    id: "seg-1",
    start: 0,
    end: 4.5,
    speaker: "Host",
    text: "Welcome to the neural networks lecture.",
  },
  {
    id: "seg-2",
    start: 65.25,
    end: 72.8,
    speaker: "Guest",
    text: "Today we will build micrograd from scratch.",
  },
];

describe("transcriptExport", () => {
  it("serializes transcript to Plain Text (.txt) with timestamps and speakers", () => {
    const txt = serializeTranscriptToPlainText(sampleSegments);
    expect(txt).toBe(
      "[00:00] Host: Welcome to the neural networks lecture.\n" +
        "[01:05] Guest: Today we will build micrograd from scratch."
    );
  });

  it("serializes transcript to Markdown (.md)", () => {
    const md = serializeTranscriptToMarkdown(sampleSegments, {
      title: "Micrograd Lecture",
      sourceUrl: "https://youtube.com/watch?v=VMj-3S1tku0",
    });
    expect(md).toContain("# Micrograd Lecture");
    expect(md).toContain("**Source:** https://youtube.com/watch?v=VMj-3S1tku0");
    expect(md).toContain("- **[00:00]** **Host:** Welcome to the neural networks lecture.");
    expect(md).toContain("- **[01:05]** **Guest:** Today we will build micrograd from scratch.");
  });

  it("serializes transcript to SubRip (.srt)", () => {
    const srt = serializeTranscriptToSRT(sampleSegments);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:04,500\nHost: Welcome to the neural networks lecture.");
    expect(srt).toContain("2\n00:01:05,250 --> 00:01:12,800\nGuest: Today we will build micrograd from scratch.");
  });

  it("serializes transcript to WebVTT (.vtt)", () => {
    const vtt = serializeTranscriptToVTT(sampleSegments);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:04.500\n<v Host>Welcome to the neural networks lecture.");
    expect(vtt).toContain("00:01:05.250 --> 00:01:12.800\n<v Guest>Today we will build micrograd from scratch.");
  });

  it("serializes transcript to JSON (.json)", () => {
    const jsonStr = serializeTranscriptToJSON(sampleSegments, {
      title: "Test Transcript",
      exportedAt: "2026-11-21T00:00:00.000Z",
    });
    const parsed = JSON.parse(jsonStr);
    expect(parsed.title).toBe("Test Transcript");
    expect(parsed.segmentCount).toBe(2);
    expect(parsed.segments[0]).toEqual({
      id: "seg-1",
      start: 0,
      end: 4.5,
      speaker: "Host",
      text: "Welcome to the neural networks lecture.",
    });
  });

  it("formats a single segment with timestamp and builds clean filenames", () => {
    expect(formatSegmentWithTimestamp(sampleSegments[1])).toBe(
      "[01:05] Guest: Today we will build micrograd from scratch."
    );
    expect(buildTranscriptFilename("Micrograd: Zero to Hero!", "srt")).toBe(
      "micrograd-zero-to-hero-transcript.srt"
    );
    expect(buildTranscriptFilename(undefined, "txt")).toBe("transcript.txt");
  });

  it("triggers browser file download via exportTranscriptToFile", () => {
    const createObjectURLSpy = vi.fn(() => "blob:test-transcript");
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: createObjectURLSpy,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: revokeObjectURLSpy,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const res = exportTranscriptToFile(sampleSegments, "vtt", { title: "Lecture 1" });
    expect(res.filename).toBe("lecture-1-transcript.vtt");
    expect(res.content).toContain("WEBVTT");
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("normalizes millisecond and session segments", () => {
    const msNormalized = fromMsSegments([
      { start_ms: 1500, end_ms: 4000, text: "Audiobook line" },
    ]);
    expect(msNormalized[0]).toEqual({
      id: "seg-1",
      start: 1.5,
      end: 4,
      text: "Audiobook line",
      speaker: undefined,
    });

    const sessionNormalized = fromSessionSegments([
      {
        segmentKey: "s1",
        text: "Session timed line",
        speakerId: "Alice",
        timing: { kind: "measured", startMs: 10000, endMs: 15000 },
      },
      {
        segmentKey: "s2",
        text: "Session untimed line",
        timing: { kind: "none" },
      },
    ]);
    expect(sessionNormalized[0].start).toBe(10);
    expect(sessionNormalized[0].speaker).toBe("Alice");
    expect(sessionNormalized[1].start).toBeUndefined();
    expect(serializeTranscript(sessionNormalized, "txt")).toContain(
      "[00:10] Alice: Session timed line\nSession untimed line"
    );
  });
});
