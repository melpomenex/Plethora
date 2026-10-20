import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TRANSCRIPT_BYTES,
  TranscriptParseError,
  detectTranscriptFormat,
  importTranscriptFileToSession,
  parseTimestampToMs,
  parseTranscript,
  stripCueMarkup,
} from "../transcriptImport";
import * as recordingSessionsApi from "../../../api/recordingSessions";

describe("transcriptImport (Task 1.4 Truthful Transcript Parser)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Markup stripping and timestamp parsing", () => {
    it("strips WebVTT voice tags, style tags, and timestamp annotations", () => {
      const raw = "<v Speaker 1>Hello <b>world</b>!</v> And <i class='highlight'>more</i> text <00:01.500>here.";
      const cleaned = stripCueMarkup(raw);
      expect(cleaned).toBe("Speaker 1: Hello world! And more text here.");
    });

    it("parses timestamps in HH:MM:SS.mmm and MM:SS.mmm formats", () => {
      expect(parseTimestampToMs("00:01:23.456")).toBe(83456);
      expect(parseTimestampToMs("00:01:23,456")).toBe(83456); // SRT comma
      expect(parseTimestampToMs("02:15.500")).toBe(135500); // VTT short
      expect(parseTimestampToMs("01:00:00.000")).toBe(3600000);
    });

    it("throws on invalid timestamp", () => {
      expect(() => parseTimestampToMs("invalid-time")).toThrow(TranscriptParseError);
    });
  });

  describe("Format detection", () => {
    it("detects format by file extension or content", () => {
      expect(detectTranscriptFormat("WEBVTT\n\n00:01.000 --> 00:02.000\nHi")).toBe("vtt");
      expect(detectTranscriptFormat("1\n00:00:01,000 --> 00:00:02,000\nHi", "sample.srt")).toBe("srt");
      expect(detectTranscriptFormat("Just some notes.", "notes.txt")).toBe("txt");
    });
  });

  describe("WebVTT Parsing", () => {
    it("parses valid WebVTT with BOM, cue settings, comments, multiline text, and overlapping cues", () => {
      const vttContent = `\uFEFFWEBVTT - Sample Lecture

NOTE
This is an introductory comment that should be skipped.

1
00:00:01.000 --> 00:00:04.000 position:10% line:0 align:start
First line of cue 1.
Second line with $E = mc^2$ and Unicode: 🚀 こんにちは!

cue-2
00:00:03.000 --> 00:00:06.000
Overlapping second cue while cue 1 is still playing.
`;

      const cues = parseTranscript(vttContent, "vtt");
      expect(cues).toHaveLength(2);

      // Cue 1
      expect(cues[0].segmentKey).toBe("seg_1");
      expect(cues[0].ordinal).toBe(0);
      expect(cues[0].startMs).toBe(1000);
      expect(cues[0].endMs).toBe(4000);
      expect(cues[0].text).toContain("First line of cue 1.\nSecond line with $E = mc^2$ and Unicode: 🚀 こんにちは!");
      expect(cues[0].timingKind).toBe("imported");

      // Cue 2 (overlapping timestamp preserved)
      expect(cues[1].segmentKey).toBe("seg_2");
      expect(cues[1].ordinal).toBe(1);
      expect(cues[1].startMs).toBe(3000);
      expect(cues[1].endMs).toBe(6000);
      expect(cues[1].text).toBe("Overlapping second cue while cue 1 is still playing.");
    });
  });

  describe("SubRip (SRT) Parsing", () => {
    it("parses valid SRT with CRLF line endings, font tags, math equations, and multiple blocks", () => {
      const srtContent =
        "1\r\n" +
        "00:00:05,200 --> 00:00:08,750\r\n" +
        "<font color=\"#ff0000\">Welcome</font> to the <b>physics lecture</b>.\r\n\r\n" +
        "2\r\n" +
        "00:00:09,000 --> 00:00:12,500\r\n" +
        "We discuss \\int_0^\\infty e^{-x} dx = 1.\r\n";

      const cues = parseTranscript(srtContent, "srt");
      expect(cues).toHaveLength(2);

      expect(cues[0].segmentKey).toBe("seg_1");
      expect(cues[0].startMs).toBe(5200);
      expect(cues[0].endMs).toBe(8750);
      expect(cues[0].text).toBe("Welcome to the physics lecture.");

      expect(cues[1].segmentKey).toBe("seg_2");
      expect(cues[1].startMs).toBe(9000);
      expect(cues[1].endMs).toBe(12500);
      expect(cues[1].text).toBe("We discuss \\int_0^\\infty e^{-x} dx = 1.");
    });
  });

  describe("Plain Text (TXT) Timing Honesty", () => {
    it("parses plain paragraphs without inventing synthetic timestamps (timing_kind: 'none')", () => {
      const txtContent = `\uFEFFParagraph one introduces the main argument and context.

Paragraph two elaborates on key findings with $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$.

Paragraph three concludes the discussion.`;

      const cues = parseTranscript(txtContent, "txt");
      expect(cues).toHaveLength(3);

      for (let i = 0; i < cues.length; i++) {
        expect(cues[i].segmentKey).toBe(`seg_${i + 1}`);
        expect(cues[i].ordinal).toBe(i);
        expect(cues[i].startMs).toBeNull();
        expect(cues[i].endMs).toBeNull();
        expect(cues[i].timingKind).toBe("none");
      }
      expect(cues[1].text).toContain("Paragraph two elaborates");
    });
  });

  describe("Size boundaries and error handling", () => {
    it("rejects files exceeding 20 MiB limit", () => {
      const bigString = "a".repeat(MAX_TRANSCRIPT_BYTES + 10);
      expect(() => parseTranscript(bigString, "txt")).toThrow(/exceeds the 20 MiB limit/);
    });

    it("rejects empty or corrupt files", () => {
      expect(() => parseTranscript("", "txt")).toThrow(TranscriptParseError);
      expect(() => parseTranscript("   \n\n  ", "txt")).toThrow(TranscriptParseError);
      expect(() => parseTranscript("NOT_A_VTT", "vtt")).toThrow(/Missing 'WEBVTT' signature/);
    });
  });

  describe("Atomic Database Import", () => {
    it("imports parsed cues and commits revision atomically", async () => {
      const importSpy = vi
        .spyOn(recordingSessionsApi, "importSessionTranscript")
        .mockResolvedValue(2);

      const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n\n00:00:03.500 --> 00:00:05.000\nWorld";
      const res = await importTranscriptFileToSession("sess-123", vtt, "lecture.vtt");

      expect(res.count).toBe(2);
      expect(importSpy).toHaveBeenCalledWith(
        "sess-123",
        expect.arrayContaining([
          expect.objectContaining({ segmentKey: "seg_1", text: "Hello", timingKind: "imported" }),
          expect.objectContaining({ segmentKey: "seg_2", text: "World", timingKind: "imported" }),
        ])
      );
    });

    it("leaves prior revision intact if parser throws on malformed replacement input", async () => {
      const importSpy = vi.spyOn(recordingSessionsApi, "importSessionTranscript");

      const malformedVtt = "INVALID_HEADER\n\n00:00:01.000 --> 00:00:02.000\nHello";
      await expect(
        importTranscriptFileToSession("sess-123", malformedVtt, "bad.vtt")
      ).rejects.toThrow(TranscriptParseError);

      // importSessionTranscript is never called on parse failure
      expect(importSpy).not.toHaveBeenCalled();
    });
  });
});
