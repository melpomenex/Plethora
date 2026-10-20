"""Generate small original speech/transcript fixtures; no network or huge PCM buffer."""
import hashlib
import json
import re
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = json.loads((ROOT / "source.json").read_text())


def write_json(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    espeak_version = re.search(r"\d+\.\d+\.\d+", subprocess.check_output(["espeak", "--version"], text=True)).group()
    ffmpeg_version = subprocess.check_output(["ffmpeg", "-version"], text=True).split()[2]
    segments = []
    frame_cursor = 0
    with tempfile.TemporaryDirectory() as directory:
        with wave.open(str(ROOT / "lecture.wav"), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            for ordinal, section in enumerate(SOURCE["sections"]):
                raw = Path(directory) / "speech.wav"
                pcm = Path(directory) / "normalized.wav"
                subprocess.run(["espeak", "-v", "en-us", "-s", "160", "-w", str(raw), section["text"]], check=True)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(pcm)], check=True)
                with wave.open(str(pcm), "rb") as part:
                    frames = part.getnframes()
                    output.writeframes(part.readframes(frames))
                segments.append({
                    "segmentKey": f"1:fixture-{ordinal}:0", "transcriptId": 1,
                    "ordinal": ordinal, "revision": 0, "text": section["text"],
                    "timing": {"kind": "measured", "startMs": frame_cursor * 1000 // 16000,
                               "endMs": (frame_cursor + frames) * 1000 // 16000},
                    "speakerId": section["speakerId"], "confidence": 0.9,
                })
                frame_cursor += frames
    # Injected provider output, not an assertion about native ASR timing/accuracy.
    segments.append({"segmentKey": "1:technical:0", "transcriptId": 1, "ordinal": 3,
                     "revision": 0, "text": SOURCE["technicalParagraph"], "timing": {"kind": "none"}})
    write_json("transcript.json", segments)
    segment = segments[0]
    quote = "Retrieval practice means recalling an answer before checking it."
    start = segment["text"].index(quote)
    write_json("evidence.json", {
        "version": 1, "documentId": "fixture-document", "sessionId": "fixture-session",
        "assetId": "fixture-asset", "transcriptId": 1, "transcriptRevision": 0,
        "segmentKeys": [segment["segmentKey"]], "quote": quote,
        "ranges": [{"segmentKey": segment["segmentKey"], "startUtf16": start, "endUtf16": start + len(quote)}],
        "time": segment["timing"], "speakerId": "speaker-1", "markerIds": [], "precision": "segment",
        "fingerprint": hashlib.sha256(segment["text"].encode()).hexdigest(),
    })
    assets = {}
    for name in ["lecture.wav", "source.json", "transcript.json", "evidence.json", "cues.srt", "cues.vtt", "transcript.txt"]:
        data = (ROOT / name).read_bytes()
        assets[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    write_json("manifest.json", {
        "version": 1, "sourceLicense": "CC0-1.0", "sampleRate": 16000,
        "frameCount": frame_cursor, "durationMs": frame_cursor * 1000 // 16000,
        "generator": {"espeak": espeak_version, "ffmpeg": ffmpeg_version}, "assets": assets,
        "cases": {f"A{i:02}": {"status": "planned", "contract": "validation.md acceptance matrix"} for i in range(1, 19)},
    })


if __name__ == "__main__":
    main()
