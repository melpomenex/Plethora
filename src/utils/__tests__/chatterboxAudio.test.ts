import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkChatterboxHealth,
  concatenateWavBlobs,
  splitTextForChatterbox,
  CHATTERBOX_MAX_CHARS_PER_REQUEST,
} from "../chatterboxAudio";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Build a minimal 24 kHz mono 16-bit PCM WAV of `frames` silent frames. */
function makeWav(frames: number, sampleRate = 24000): ArrayBuffer {
  const pcmBytes = frames * 2;
  const buf = new ArrayBuffer(44 + pcmBytes);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcmBytes, true);
  return buf;
}

function readWavMeta(buf: ArrayBuffer) {
  const view = new DataView(buf);
  return {
    riff: String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
    dataSize: view.getUint32(40, true),
    sampleRate: view.getUint32(24, true),
  };
}

describe("checkChatterboxHealth", () => {
  it("reports ok on a healthy service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const res = await checkChatterboxHealth("http://localhost:8000/v1");
    expect(res).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/health",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("reports the recovery guidance on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const res = await checkChatterboxHealth("http://localhost:8000/v1", undefined, undefined, {
      platform: "unknown",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("answered 503");
    expect(res.error).toContain("Base URL");
    expect(res.error).not.toContain("systemctl");
  });

  it("reports the recovery guidance when unreachable (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const res = await checkChatterboxHealth("http://localhost:8000/v1", undefined, undefined, {
      platform: "unknown",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Cannot reach");
    expect(res.error).not.toContain("systemctl");
  });

  it("mentions systemd only as a Linux example", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const res = await checkChatterboxHealth("http://localhost:8000/v1", undefined, undefined, {
      platform: "linux",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("systemctl --user start chatterbox-tts");
  });

  it("strips a /v1 suffix for the health probe", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", spy);
    await checkChatterboxHealth("http://localhost:8000/v1");
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:8000/health",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("rejects an empty base URL without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await checkChatterboxHealth("   ");
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("splitTextForChatterbox", () => {
  it("returns short text as a single chunk", () => {
    expect(splitTextForChatterbox("Hello world")).toEqual(["Hello world"]);
  });

  it("returns no chunks for blank input", () => {
    expect(splitTextForChatterbox("   ")).toEqual([]);
  });

  it("splits long text on sentence boundaries within the cap", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} carries some words.`).join(" ");
    const chunks = splitTextForChatterbox(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("hard-splits a single over-long sentence", () => {
    const text = "x".repeat(2500);
    const chunks = splitTextForChatterbox(text, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(text);
  });

  it("defaults to the module chunk cap", () => {
    expect(CHATTERBOX_MAX_CHARS_PER_REQUEST).toBe(500);
    const text = `${"a".repeat(999)}. ${"b".repeat(999)}.`;
    const chunks = splitTextForChatterbox(text);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });
});

describe("concatenateWavBlobs", () => {
  it("merges same-format chunks with a correct header", () => {
    const merged = concatenateWavBlobs([makeWav(100), makeWav(200), makeWav(50)]);
    const meta = readWavMeta(merged);
    expect(meta.riff).toBe("RIFF");
    expect(meta.dataSize).toBe(350 * 2);
    expect(merged.byteLength).toBe(44 + 350 * 2);
  });

  it("passes a single chunk through with an intact header", () => {
    const merged = concatenateWavBlobs([makeWav(60)]);
    expect(merged.byteLength).toBe(44 + 120);
    expect(readWavMeta(merged).sampleRate).toBe(24000);
  });

  it("throws on empty input", () => {
    expect(() => concatenateWavBlobs([])).toThrow(/Nothing to concatenate/);
  });

  it("throws on non-WAV input", () => {
    expect(() => concatenateWavBlobs([new ArrayBuffer(100)])).toThrow(/not a supported/);
  });

  it("throws on sample-rate mismatch", () => {
    expect(() => concatenateWavBlobs([makeWav(10, 24000), makeWav(10, 16000)])).toThrow(
      /format mismatch/
    );
  });
});
