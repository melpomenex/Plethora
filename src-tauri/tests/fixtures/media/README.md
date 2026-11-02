# Local media compatibility fixtures

These fixtures are **synthetic**, small, and generated from FFmpeg lavfi
sources (`testsrc2` + `sine`). They are not shipped in release bundles and must
never contain copyrighted movie content.

## Generate

```bash
scripts/media-fixtures/generate.sh
scripts/media-fixtures/verify.sh
```

Generated files go to `src-tauri/tests/fixtures/media/generated/` (git-ignored).
`generate.sh --list` prints the fixture names without requiring FFmpeg.

Always generated when FFmpeg is available:

- `mp4-h264-aac.mp4`
- `webm-vp9-opus.webm`
- `mkv-h264-aac.mkv`
- `mkv-h264-aac-srt.mkv`
- `mkv-h264-aac-multi-audio.mkv`
- `mkv-h264-aac-cover.mkv`

Generated only when the required encoders exist:

- `mkv-hevc-aac.mkv` (`libx265`)
- `mkv-hevc-dts.mkv` (`libx265` + `dca`)
- `mkv-av1-opus.mkv` (`libsvtav1`/`libaom-av1` + `libopus`)
- `hdr10-hevc.mp4` (`libx265` with HDR parameters)

## Bitmap subtitles (PGS)

FFmpeg has no PGS encoder. PGS coverage uses either:

- an externally supplied, legally obtained fixture:
  `PLETHORA_PGS_FIXTURE=/path/to/file.mkv`; or
- the golden FFprobe JSON fixtures in `src-tauri/tests/fixtures/probe/`, which
  preserve the reported file shape without copying movie bytes.

The verified real-file reproduction is documented in the OpenSpec change
`reliable-local-video-playback-and-codec-compatibility`; it is evidence, not a
committed fixture.
