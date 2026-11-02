import type { CapabilityLevel, DeclaredCodecSupport, MediaRuntimeCapabilities } from "./types";

function levelFromCanPlay(result: CanPlayTypeResult, exactCodec: boolean): CapabilityLevel {
  if (result === "probably") return "supported";
  if (result === "") return "unsupported";
  if (result === "maybe") return exactCodec ? "unknown" : "supported";
  return "unknown";
}

function query(
  element: HTMLVideoElement | HTMLAudioElement,
  mime: string,
  exactCodec: boolean,
  evidence: string[],
): CapabilityLevel {
  let result: CanPlayTypeResult = "";
  try {
    result = element.canPlayType(mime);
  } catch {
    result = "";
  }
  evidence.push(`${mime} => ${result || "(empty)"}`);
  return levelFromCanPlay(result, exactCodec);
}

/**
 * Query the webview with exact codec strings. A bare container "maybe" is a
 * container declaration only; it never marks a codec supported.
 */
export function detectDeclaredSupport(): DeclaredCodecSupport {
  const evidence: string[] = [];
  if (typeof document === "undefined") {
    return {
      h264: "unknown",
      hevc: "unknown",
      av1: "unknown",
      vp9: "unknown",
      aac: "unknown",
      ac3: "unknown",
      eac3: "unknown",
      dts: "unknown",
      truehd: "unknown",
      opus: "unknown",
      flac: "unknown",
      mp3: "unknown",
      vorbis: "unknown",
      bitmapSubtitles: "unknown",
      textSubtitles: "unknown",
      containers: {},
      evidence: ["no_document"],
    };
  }

  const video = document.createElement("video");
  const audio = document.createElement("audio");

  const hevcMain = query(video, 'video/mp4; codecs="hvc1.1.6.L120.90"', true, evidence);
  const hevcMain10 = query(video, 'video/mp4; codecs="hvc1.2.4.L153.B0"', true, evidence);
  const vp9 = query(video, 'video/webm; codecs="vp9"', true, evidence);
  const vp9Profile = query(video, 'video/webm; codecs="vp09.00.10.08"', true, evidence);
  const opusWebm = query(audio, 'audio/webm; codecs="opus"', true, evidence);
  const opusOgg = query(audio, 'audio/ogg; codecs="opus"', true, evidence);
  const flacMp4 = query(audio, 'audio/mp4; codecs="flac"', true, evidence);
  const flacOgg = query(audio, 'audio/ogg; codecs="flac"', true, evidence);

  return {
    h264: query(video, 'video/mp4; codecs="avc1.42E01E"', true, evidence),
    hevc: hevcMain === "supported" || hevcMain10 === "supported" ? "supported" : hevcMain,
    av1: query(video, 'video/mp4; codecs="av01.0.05M.08"', true, evidence),
    vp9: vp9 === "supported" || vp9Profile === "supported" ? "supported" : vp9,
    aac: query(audio, 'audio/mp4; codecs="mp4a.40.2"', true, evidence),
    ac3: query(audio, 'audio/mp4; codecs="ac-3"', true, evidence),
    eac3: query(audio, 'audio/mp4; codecs="ec-3"', true, evidence),
    dts: "unknown",
    truehd: "unknown",
    opus: opusWebm === "supported" || opusOgg === "supported" ? "supported" : "unknown",
    flac: flacMp4 === "supported" || flacOgg === "supported" ? "supported" : "unknown",
    mp3: query(audio, "audio/mpeg", true, evidence),
    vorbis: query(audio, 'audio/webm; codecs="vorbis"', true, evidence),
    bitmapSubtitles: "unknown",
    textSubtitles: query(video, "text/vtt", true, evidence),
    containers: {
      matroska: query(video, "video/x-matroska", false, evidence),
      mp4: query(video, "video/mp4", false, evidence),
      webm: query(video, "video/webm", false, evidence),
      ogg: query(video, "video/ogg", false, evidence),
      avi: query(video, "video/x-msvideo", false, evidence),
      mpegts: query(video, "video/mp2t", false, evidence),
    },
    evidence,
  };
}

export interface CapabilityRow {
  label: string;
  level: CapabilityLevel;
  evidence: string;
}

/** Human-readable rows for the Media & Playback diagnostics panel. */
export function formatCapabilityRows(report: MediaRuntimeCapabilities): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  for (const [codec, level] of Object.entries(report.decoders).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push({ label: `${codec} decode`, level, evidence: "runtime registry" });
  }
  for (const [container, level] of Object.entries(report.demuxers).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push({ label: `${container} container`, level, evidence: "runtime registry" });
  }
  rows.push({
    label: "FFmpeg",
    level: report.ffmpeg.available ? "supported" : "unsupported",
    evidence: report.ffmpeg.version ?? "not installed",
  });
  rows.push({
    label: "FFprobe",
    level: report.ffmpeg.ffprobeAvailable ? "supported" : "unsupported",
    evidence: report.ffmpeg.ffprobeAvailable ? "available" : "not installed",
  });
  if (report.gstreamer) {
    rows.push({
      label: "GStreamer registry",
      level: report.gstreamer.inspectAvailable ? "supported" : "unknown",
      evidence: report.gstreamer.inspectAvailable ? "gst-inspect available" : "gst-inspect unavailable",
    });
  }
  return rows;
}
