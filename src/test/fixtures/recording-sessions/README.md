# Recording session fixtures

Task 0.1 foundation for `unified-recording-ingestion-and-learning-studio`.
Original text, fixture annotations and generated speech are dedicated to CC0-1.0.
There are no third-party recordings, network requests or user content.

`source.json` is the authored source. `lecture.wav` is real small generated speech:
mono PCM16 at16kHz. The first three transcript paragraphs correspond to separately
generated speech units. Speaker labels/confidence are **injected test metadata**,
not claims that a recognizer diarized the audio. The technical fourth paragraph
is deliberately untimed and has no audio; do not invent alignment for it.
Native recognizer quality is not tested by string-equality against these fixtures.

Regenerate from the repository root with:

```bash
python3 src/test/fixtures/recording-sessions/generate.py
npm run test:run -- src/test/fixtures/recording-sessions/contracts.test.ts
```

The committed bytes were generated using eSpeak NG1.52.0 (`en-us`,160wpm) and
FFmpeg n9.0.2 (bitexact PCM output), recorded in manifest.json. Regeneration on
another tool version can change synthesized bytes: inspect the diff and
regenerate the manifest rather than claiming a native-ASR regression. No runtime
dependency was added; ordinary tests use committed bytes and need neither tool.
The generator processes one short paragraph at a time, never hours of PCM.

`transcript.json` and `evidence.json` freeze the canonical source/quote/range DTOs.
`cues.srt`, `cues.vtt` and `transcript.txt` cover multiline, overlap, cue settings,
Unicode/equations and untimed paragraphs. Parser tests can derive BOM/CRLF and
malformed variants without maintaining duplicate fixture files.

`harness.ts` supplies an injected clock, independently faultable file/manifest/DB
seams and a manually released provider (including late replies after cancellation).
Its lazy90-minute timeline yields one320-byte synthetic chunk per event; those
bytes are **not encoded audio**. Use the WAV for codec tests, the timeline for
bounded-memory/control-flow tests, and real devices for capture certification.

The manifest lists A01–A18 as **planned** validation journeys, not passing tests.
The exact future assertions/device matrix live in the change's validation.md.
